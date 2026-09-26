import http from 'node:http';
import type { Config } from './config.js';
export const EXCHANGE_MS = 6000, MAX_RESPONSE = 524288;
export type ExchangeResult = {
    status: number;
    body: unknown;
};
export type Operation = 'snapshot' | 'command' | 'scenes' | 'animations' | 'extension-command';
const WRITES: readonly Operation[] = ['command', 'extension-command'];
export class TransportFailure extends Error {
    constructor(readonly possible: boolean) { super('Controller exchange unavailable'); }
}
export function safeJson(text: string): unknown {
    const result: unknown = JSON.parse(text);
    const pending: [
        unknown,
        number
    ][] = [[result, 0]];
    while (pending.length) {
        const [value, depth] = pending.pop()!;
        if (depth > 32)
            throw new Error('JSON limit');
        if (typeof value === 'number' && !Number.isFinite(value))
            throw new Error('Invalid JSON');
        if (value && typeof value === 'object')
            for (const child of Object.values(value))
                pending.push([child, depth + 1]);
    }
    return result;
}
export async function exchange(config: Config, operation: Operation, token: string, request?: unknown): Promise<ExchangeResult> {
    if (!Number.isInteger(config.controllerPort) || config.controllerPort < 1024 || config.controllerPort > 65535 || !(/^[A-Za-z0-9._-]{1,128}$/.test(config.deviceId)) || !(/^[A-Za-z0-9_-]{43,512}$/.test(token)) || !['snapshot', 'command', 'scenes', 'animations', 'extension-command'].includes(operation))
        throw new TransportFailure(false);
    let body: string;
    try {
        body = JSON.stringify(request ?? null);
        safeJson(body);
        if (Buffer.byteLength(body) > 65536)
            throw new Error('Body limit');
    }
    catch {
        throw new TransportFailure(false);
    }
    if (config.transport !== 'loopback-http')
        throw new TransportFailure(false);
    return direct(config, operation, token, body);
}
function direct(config: Config, operation: Operation, token: string, body: string): Promise<ExchangeResult> {
    return new Promise((resolve, reject) => {
        let finished = false, possible = false;
        let response: http.IncomingMessage | undefined;
        const path = operation === 'snapshot' ? `/controller/v1/snapshot?deviceId=${encodeURIComponent(config.deviceId)}`
            : operation === 'scenes' ? `/controller/integration/v1/snapshot?deviceId=${encodeURIComponent(config.deviceId)}`
                : operation === 'animations' ? `/controller/integration/v1/animations?deviceId=${encodeURIComponent(config.deviceId)}`
                    : operation === 'extension-command' ? '/controller/integration/v1/commands'
                        : '/controller/v1/commands';
        const write = WRITES.includes(operation);
        const req = http.request({ hostname: '127.0.0.1', port: config.controllerPort, method: write ? 'POST' : 'GET', path, agent: false, headers: { Host: `127.0.0.1:${config.controllerPort}`, Authorization: `Bearer ${token}`, ...(write ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
            response = res;
            let length = 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => { length += chunk.length; if (length > MAX_RESPONSE) {
                finish();
                return;
            } chunks.push(chunk); });
            res.on('aborted', () => finish());
            res.on('error', () => finish());
            res.on('end', () => { if (finished)
                return; try {
                if (res.statusCode! < 200 || res.statusCode! >= 600 || res.statusCode! >= 300 && res.statusCode! < 400)
                    throw new Error('Invalid response');
                finish({ status: res.statusCode!, body: safeJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) });
            }
            catch {
                finish();
            } });
        });
        const timer = setTimeout(() => finish(), EXCHANGE_MS);
        function finish(value?: ExchangeResult) { if (finished)
            return; finished = true; clearTimeout(timer); req.destroy(); response?.destroy(); value ? resolve(value) : reject(new TransportFailure(possible)); }
        req.on('error', () => finish());
        req.on('socket', socket => socket.once('connect', () => { possible = write; }));
        req.end(write ? body : undefined);
    });
}
