import { request } from 'node:http';
import { isIPv4 } from 'node:net';
import type { FailureCode } from './contracts.js';

export class DeviceRequestError extends Error {
  constructor(readonly code: FailureCode, readonly details?: { httpStatus?: number; deviceCode?: number }) {
    super(code); this.name = 'DeviceRequestError';
  }
}
export type DeviceTransport = (body: Record<string, unknown>, signal: AbortSignal) => Promise<Record<string, unknown>>;

export function validateDeviceIp(ip: string): string {
  if (!isIPv4(ip)) throw new TypeError('PIXOO_DEVICE_IP must be a canonical private IPv4 address');
  const [a, b] = ip.split('.').map(Number);
  if (!(a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168))) {
    throw new TypeError('PIXOO_DEVICE_IP must be a canonical private IPv4 address');
  }
  return ip;
}
export function createDeviceTransport(ip: string): DeviceTransport {
  const host = validateDeviceIp(ip);
  return (body, signal) => sendJson(host, 80, body, signal);
}

/** Internal low-level helper; loopback/ephemeral ports are used by fake-server tests only. */
export function sendJson(host: string, port: number, body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    let result: Record<string, unknown> | undefined;
    let failure: DeviceRequestError | undefined;
    // Honor the runtime's proxy opt-in; Connection: close prevents connection reuse.
    const req = request({ host, port, path: '/post', method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'close' },
    }, res => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 16 * 1024) {
          failure = new DeviceRequestError('protocol-error'); req.destroy(); return;
        }
        chunks.push(chunk);
      });
      res.on('error', () => { failure ??= new DeviceRequestError('protocol-error'); });
      res.on('end', () => {
        if (failure) return;
        try {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) throw new DeviceRequestError('http-error', { httpStatus: res.statusCode ?? 0 });
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DeviceRequestError('protocol-error');
          const value = parsed as Record<string, unknown>;
          if (!Number.isSafeInteger(value.error_code)) throw new DeviceRequestError('protocol-error');
          if (value.error_code !== 0) throw new DeviceRequestError('device-error', { deviceCode: value.error_code as number });
          result = value;
        } catch (error) { failure = error instanceof DeviceRequestError ? error : new DeviceRequestError('protocol-error'); }
      });
    });
    req.on('error', () => { failure ??= new DeviceRequestError('offline'); });
    // Keep the writer until the local request is closed, including after abort/destroy.
    req.on('close', () => {
      if (failure || !result) reject(failure ?? new DeviceRequestError('protocol-error'));
      else resolve(result);
    });
    req.end(payload);
  });
}
