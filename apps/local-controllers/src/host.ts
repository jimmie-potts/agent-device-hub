import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { authorize, validate, type FailureCode, type Receipt } from '@jimmie-potts/device-contracts';
import { LifxController, type BulbConfig, type Transport } from '@jimmie-potts/lifx-controller';
import type { DisplayConnection } from '@jimmie-potts/tidbyt-controller';
import { acquireWriterLease, startStatusRunner } from '@jimmie-potts/tidbyt-controller/runner';
import { TIDBYT_DEVICE_ID, type Credential, type HostConfig, type Scope } from './config.js';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_IN_FLIGHT = 32;
export const MAX_JSON_DEPTH = 32;
/** How long a command waits for its terminal receipt before answering `queued`; below the hub client's 2 s timeout. */
export const SETTLE_MS = 1000;
const DEFAULT_LIFX_LEASE_ROOT = join(homedir(), '.local/state/agent-device-hub/lifx');

export type HostOptions = {
  tidbyt?: { connection?: DisplayConnection; leaseRoot?: string };
  lifx?: { transportFactory?: (bulb: Readonly<BulbConfig>) => Transport; leaseRoot?: string; now?: () => number };
  settleMs?: number;
};
export type LocalControllers = { readonly url: string; close(): Promise<void> };

type Submission = { decision: string; reserved: boolean; receipt?: Receipt; done?: Promise<Receipt> };
type Answer = { status: number; body: unknown };

// The contract's HTTP mapping for rejections; any other terminal receipt answers 200.
const STATUS: Partial<Record<FailureCode, number>> = {
  'invalid-request': 400, unauthenticated: 401, forbidden: 403, 'unknown-device': 404, 'revision-conflict': 409,
  'stale-generation': 409, 'request-conflict': 409, 'request-order': 409, 'request-expired': 410,
  'unsupported-capability': 422, capacity: 429,
};
const failure = (code: FailureCode): Answer => ({ status: STATUS[code] ?? 503, body: { failure: { code } } });
const receiptStatus = (receipt: Receipt) => (receipt.failure && STATUS[receipt.failure.code]) || 200;
const V1 = '/controller/v1/';
const LIGHTING = '/controller/lifx-light/v1/';

function depth(value: unknown, level = 1): number {
  if (!value || typeof value !== 'object') return level - 1;
  let deepest = level;
  for (const child of Object.values(value)) deepest = Math.max(deepest, depth(child, level + 1));
  return deepest;
}

/** Read at most `MAX_BODY_BYTES`; undefined means the limit was exceeded. */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Serve controller v1, and the LIFX lighting profile, for the configured in-process controllers on one loopback port.
 * The host is the only writer for these devices: it runs the Tidbyt runner (its publishers and lease) in-process and holds one lease per bulb address.
 */
export async function startLocalControllers(config: HostConfig, options: HostOptions = {}): Promise<LocalControllers> {
  const settleMs = options.settleMs ?? SETTLE_MS;
  const releases: (() => void)[] = [];
  let lifx: LifxController | undefined;
  let runner: ReturnType<typeof startStatusRunner> | undefined;
  const credentials = new Map<string, Credential>(config.credentials.map(c => [c.digest, c]));
  try {
    // Every lease before any listener, feed read or device request.
    for (const bulb of config.lifx?.bulbs ?? []) releases.push(acquireWriterLease('lifx:' + bulb.address, options.lifx?.leaseRoot ?? DEFAULT_LIFX_LEASE_ROOT));
    if (config.lifx) {
      lifx = new LifxController({ ...config.lifx, ...(options.lifx?.transportFactory ? { transportFactory: options.lifx.transportFactory } : {}),
        ...(options.lifx?.now ? { now: options.lifx.now } : {}) });
    }
    if (config.tidbyt) runner = startStatusRunner(config.tidbyt, { ...(options.tidbyt?.connection ? { connection: options.tidbyt.connection } : {}),
      ...(options.tidbyt?.leaseRoot ? { leaseRoot: options.tidbyt.leaseRoot } : {}) });
  } catch {
    lifx?.close();
    for (const release of releases) release();
    throw new Error('local-controllers-start-failed');
  }
  const kind = (deviceId: string) => deviceId === TIDBYT_DEVICE_ID && runner ? 'tidbyt' : lifx && config.lifx!.bulbs.some(b => b.deviceId === deviceId) ? 'lifx' : undefined;

  let origin = '';
  let active = 0;

  function principal(req: IncomingMessage): Credential | undefined {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
    if (!match) return undefined;
    const digest = createHash('sha256').update(match[1]!).digest();
    for (const credential of credentials.values()) {
      if (timingSafeEqual(digest, Buffer.from(credential.digest, 'hex'))) return credential;
    }
    return undefined;
  }

  /** A machine request names this listener as its host and carries no browser origin or cross-site fetch metadata. */
  function headers(req: IncomingMessage) {
    const site = req.headers['sec-fetch-site'];
    return { hostAllowed: req.headers.host === origin.slice('http://'.length), originPresent: req.headers.origin !== undefined,
      originAllowed: false, fetchMetadataAllowed: site === undefined || site === 'none' };
  }

  /** The contract's authorization decision for a known credential, device and scope. */
  function allowed(req: IncomingMessage, credential: Credential, deviceId: string, scope: Scope): boolean {
    return authorize({
      credential: { kind: 'machine', status: 'active', declared: true, devices: credential.devices, scopes: credential.scopes },
      deviceId, scope, ...headers(req),
    }).decision === 'allowed';
  }

  async function submitted(submission: Submission): Promise<Answer> {
    if (!submission.receipt) return failure(submission.decision as FailureCode);
    if (submission.decision !== 'queued' && submission.decision !== 'join') return { status: receiptStatus(submission.receipt), body: submission.receipt };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([submission.done!, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), settleMs); })]);
    clearTimeout(timer);
    return settled ? { status: receiptStatus(settled), body: settled } : { status: 202, body: submission.receipt };
  }

  async function route(req: IncomingMessage, url: URL): Promise<Answer> {
    const credential = principal(req);
    if (!credential) return failure('unauthenticated');
    // Header checks come before the query or body is read; the device and scope are checked once they are known.
    const h = headers(req);
    if (!h.hostAllowed || h.originPresent || !h.fetchMetadataAllowed) return failure('forbidden');
    const lighting = url.pathname.startsWith(LIGHTING);
    const operation = url.pathname.slice(lighting ? LIGHTING.length : url.pathname.startsWith(V1) ? V1.length : url.pathname.length);
    if (req.method === 'GET' && operation === 'snapshot') {
      const deviceId = url.searchParams.get('deviceId');
      if ([...url.searchParams.keys()].length !== 1 || !validate('id', deviceId)) return failure('invalid-request');
      if (!allowed(req, credential, deviceId!, 'read')) return failure('forbidden');
      const device = kind(deviceId!);
      if (device === 'tidbyt' && !lighting) return { status: 200, body: runner!.controller.snapshot().controller };
      if (device === 'lifx') return { status: 200, body: lighting ? lifx!.snapshot(deviceId!) : lifx!.snapshot(deviceId!).controller };
      return failure('unknown-device');
    }
    if (req.method !== 'POST' || operation !== 'commands' || url.search) return failure('invalid-request');
    const bytes = await readBody(req);
    if (!bytes) return failure('capacity');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return failure('invalid-request'); }
    if (depth(value) > MAX_JSON_DEPTH || !value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid-request');
    const deviceId = (value as Record<string, unknown>).deviceId;
    if (!validate('id', deviceId)) return failure('invalid-request');
    if (!allowed(req, credential, deviceId as string, 'control')) return failure('forbidden');
    const device = kind(deviceId as string);
    if (!lighting) {
      // Only common controller v1 requests; Tidbyt display writes stay with the host's publishers.
      if (!validate('request', value)) return failure('invalid-request');
      if (device === 'tidbyt') return submitted(runner!.controller.submit(value));
      if (device === 'lifx') return submitted(lifx!.submit(value));
      return failure('unknown-device');
    }
    if (device !== 'lifx') return failure('unknown-device');
    if (!Object.hasOwn(value, 'profile')) return failure('invalid-request');
    return submitted(lifx!.submit(value));
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reply = ({ status, body }: Answer) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (active >= MAX_IN_FLIGHT) { reply(failure('capacity')); return; }
    active++;
    void (async () => {
      try { reply(await route(req, new URL(req.url ?? '/', origin))); }
      catch { reply({ status: 503, body: { failure: { code: 'transport-failure' } } }); }
      finally { active--; }
    })();
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 64;

  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    try {
      lifx?.close();
      await runner?.stop();
    } finally { for (const release of releases) release(); }
  })();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch {
    await close().catch(() => {});
    throw new Error('local-controllers-start-failed');
  }
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url: origin, close };
}
