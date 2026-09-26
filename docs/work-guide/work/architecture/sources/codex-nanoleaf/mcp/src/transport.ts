import http from 'node:http';
import { spawn } from 'node:child_process';
import type { Config } from './config.js';
export const EXCHANGE_MS = 6000, MAX_RESPONSE = 524288;
export type ExchangeResult = {
    status: number;
    body: unknown;
};
export type Operation = 'snapshot' | 'command';
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
    if (!Number.isInteger(config.controllerPort) || config.controllerPort < 1024 || config.controllerPort > 65535 || !(/^[A-Za-z0-9._-]{1,128}$/.test(config.deviceId)) || !(/^[A-Za-z0-9_-]{43,512}$/.test(token)) || !['snapshot', 'command'].includes(operation))
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
    if (config.transport === 'windows-http')
        return direct(config, operation, token, body);
    if (config.transport !== 'wsl-helper' || !config.windowsPython || !config.windowsHelper)
        throw new TransportFailure(false);
    return helper(config, operation, token, request);
}
function direct(config: Config, operation: Operation, token: string, body: string): Promise<ExchangeResult> {
    return new Promise((resolve, reject) => {
        let finished = false, possible = false;
        let response: http.IncomingMessage | undefined;
        const req = http.request({ hostname: '127.0.0.1', port: config.controllerPort, method: operation === 'snapshot' ? 'GET' : 'POST', path: operation === 'snapshot' ? `/controller/v1/snapshot?deviceId=${encodeURIComponent(config.deviceId)}` : '/controller/v1/commands', agent: false, headers: { Host: `127.0.0.1:${config.controllerPort}`, Authorization: `Bearer ${token}`, ...(operation === 'command' ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
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
        req.on('socket', socket => socket.once('connect', () => { possible = operation === 'command'; }));
        req.end(operation === 'command' ? body : undefined);
    });
}
function helper(config: Config, operation: Operation, token: string, request: unknown): Promise<ExchangeResult> {
    return new Promise((resolve, reject) => {
        let possible = false, finished = false, bytes = 0, errors = 0;
        const chunks: Buffer[] = [];
        const child = spawn(config.windowsPython!, [config.windowsHelper!], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const timer = setTimeout(() => finish(), EXCHANGE_MS);
        function finish(value?: ExchangeResult) { if (finished)
            return; finished = true; clearTimeout(timer); if (child.exitCode === null)
            child.kill('SIGKILL'); value ? resolve(value) : reject(new TransportFailure(possible)); }
        child.on('error', () => finish());
        child.on('spawn', () => { possible = operation === 'command'; });
        child.stdin.on('error', () => finish());
        child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_RESPONSE + 128) {
            finish();
            return;
        } chunks.push(chunk); });
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.length; if (errors > 4096)
            finish(); });
        child.on('close', code => { if (finished)
            return; try {
            if (code !== 0)
                throw new Error('Helper failure');
            const value = safeJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as ExchangeResult;
            if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'body,status' || !Number.isInteger(value.status) || value.status < 200 || value.status >= 600 || (value.status >= 300 && value.status < 400))
                throw new Error('Invalid helper response');
            finish(value);
        }
        catch {
            finish();
        } });
        const input = JSON.stringify({ operation, port: config.controllerPort, deviceId: config.deviceId, token, ...(operation === 'command' ? { request } : {}) });
        if (Buffer.byteLength(input) > 65536) {
            possible = false;
            finish();
            return;
        }
        child.stdin.end(input);
    });
}
