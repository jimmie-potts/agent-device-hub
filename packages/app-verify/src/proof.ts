// Opt-in proof transport. It owns no listener: the adapter mounts this handler
// on the application listener, so it shares that process's lease and shutdown.
import {constants} from 'node:fs';
import {open, type FileHandle} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {resolve} from 'node:path';
import {validateReceipt} from './receipt.js';
import type {Receipt} from './types.js';
import {hex256} from './util.js';

export const PROOF_PREFIX = '/__app-verify/proof/';
const CAPTURE_PATH = /^capture-[1-9]\d*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const META_LIMIT = 16 * 1024 * 1024;
const FILE_LIMIT = 128 * 1024 * 1024;

export interface ProofLink {capture: number; step: string; path: string; url: string}
export interface ProofHandler {
  prefix: typeof PROOF_PREFIX;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

function captureFiles(receipt: Receipt): {capture: number; step: string; path: string}[] {
  return receipt.captures.filter(c => c.set === 'verified' && c.outcome === 'passed').flatMap(c =>
    [c.screenshot, c.video, c.log, ...(c.attachments ?? [])].flatMap(path =>
      path?.startsWith('verified/') && CAPTURE_PATH.test(path.slice(9)) && path.startsWith(`verified/capture-${c.n}/`)
        ? [{capture: c.n, step: c.step, path}] : []));
}

/** Links only to passed frozen captures; adapters opt in after mounting the handler. */
export function proofLinks(receipt: Receipt): ProofLink[] {
  if (!receipt.proof.frozenAt || !receipt.preview) return [];
  const origin = new URL(receipt.preview.url).origin;
  return captureFiles(receipt).map(file => ({...file, url: `${origin}${PROOF_PREFIX}${receipt.runId}/${file.path.slice(9)}`}));
}

/** Open each directory relative to an already pinned directory, never following a link. */
async function directory(path: string): Promise<FileHandle> {
  if (process.platform !== 'linux' || resolve(path) !== path) throw new Error('unavailable');
  let parent = await open('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of path.split('/').filter(Boolean)) {
      const child = await open(`/proc/self/fd/${parent.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await parent.close(); parent = child;
    }
    return parent;
  } catch (error) {await parent.close(); throw error;}
}

async function read(parent: FileHandle, path: string, limit = META_LIMIT): Promise<Buffer> {
  const handles: FileHandle[] = [];
  try {
    const parts = path.split('/');
    if (parts.some(p => !p || p === '.' || p === '..')) throw new Error('unavailable');
    let dir = parent;
    for (const part of parts.slice(0, -1)) {
      dir = await open(`/proc/self/fd/${dir.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      handles.push(dir);
    }
    const file = await open(`/proc/self/fd/${dir.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    handles.push(file);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('unavailable');
    // Read a bounded snapshot, then hash and send these same bytes. A file that
    // changes during the read cannot pass its recorded digest by a path race.
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const part = await file.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size !== info.size) throw new Error('unavailable');
    return bytes.subarray(0, size);
  } finally {for (const handle of handles.reverse()) await handle.close();}
}

function receipt(bytes: Buffer): Receipt {
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!validateReceipt(value).ok) throw new Error('unavailable');
  return value as Receipt;
}

async function frozenFile(root: FileHandle, runId: string, path: string): Promise<Buffer> {
  const live = receipt(await read(root, 'receipt.json'));
  if (live.runId !== runId || live.state !== 'running' || !live.proof.frozenAt || !live.preview || Date.parse(live.preview.expiresAt) <= Date.now()) throw new Error('unavailable');
  const events = (await read(root, 'events.jsonl')).toString('utf8').split('\n');
  let frozen: {frozenAt?: unknown; manifest?: unknown} | undefined;
  for (const line of events) {
    try {const event = JSON.parse(line); if (event?.event === 'frozen') frozen = event;} catch { /* A torn line is not a freeze. */ }
  }
  // Pin verified/ once. All manifest, receipt and artifact reads use this same
  // directory even if another process renames or replaces it during the read.
  const verified = await open(`/proc/self/fd/${root.fd}/verified`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const manifest = await read(verified, 'SHA256SUMS');
    if (frozen?.frozenAt !== live.proof.frozenAt || frozen?.manifest !== `sha256:${hex256(manifest)}`) throw new Error('unavailable');
    const sums = new Map<string, string>();
    for (const line of manifest.toString('utf8').trimEnd().split('\n')) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (!match || sums.has(match[2])) throw new Error('unavailable');
      sums.set(match[2], match[1]);
    }
    const copyBytes = await read(verified, 'receipt.json');
    if (sums.get('receipt.json') !== hex256(copyBytes)) throw new Error('unavailable');
    const copy = receipt(copyBytes);
    if (copy.runId !== runId || copy.startedAt !== live.startedAt || copy.proof.frozenAt !== live.proof.frozenAt || !captureFiles(copy).some(f => f.path === `verified/${path}`)) throw new Error('unavailable');
    const bytes = await read(verified, path, FILE_LIMIT);
    if (sums.get(path) !== hex256(bytes)) throw new Error('unavailable');
    return bytes;
  } finally {await verified.close();}
}

const TYPES: Record<string, string> = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', mp4: 'video/mp4'};

/** Linux-only, read-only frozen proof. No CORS, directory listing or writable route. */
export function createProofHandler({proofDir, runId}: {proofDir: string; runId: string}): ProofHandler {
  // At most two bounded snapshots at once, independently of the app's request budget.
  let active = 0;
  return {prefix: PROOF_PREFIX, async handle(req, res) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'none'; media-src 'self'; img-src 'self'; sandbox; frame-ancestors 'none'; base-uri 'none'");
    const finish = (status: number) => {res.writeHead(status); res.end();};
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {res.setHeader('allow', 'GET, HEAD'); finish(405); return;}
    const host = `127.0.0.1:${req.socket.localPort}`;
    const site = req.headers['sec-fetch-site'];
    const navigation = req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== host || (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) ||
      (site !== undefined && site !== 'none' && site !== 'same-origin' && !navigation)) {finish(403); return;}
    const prefix = `${PROOF_PREFIX}${runId}/`, path = req.url?.startsWith(prefix) ? req.url.slice(prefix.length) : '';
    // Match the raw target before URL normalization or decoding can erase traversal.
    if (!CAPTURE_PATH.test(path)) {finish(404); return;}
    if (active >= 2) {finish(503); return;}
    active++;
    let root: FileHandle | undefined;
    try {
      root = await directory(proofDir);
      const bytes = await frozenFile(root, runId, path);
      if (res.destroyed) return;
      const name = path.split('/').at(-1)!;
      const type = TYPES[name.split('.').at(-1)!.toLowerCase()];
      // The browser's image/video document needs its own origin to load the
      // media. Scripts remain forbidden; unknown types keep the opaque sandbox.
      if (type) res.setHeader('content-security-policy', "default-src 'none'; media-src 'self'; img-src 'self'; sandbox allow-same-origin; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader('content-type', type ?? 'application/octet-stream');
      res.setHeader('content-disposition', `${type ? 'inline' : 'attachment'}; filename="${name}"`);
      res.setHeader('accept-ranges', 'bytes');
      let start = 0, end = bytes.length - 1, status = 200;
      if (req.headers.range !== undefined) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!range || (!range[1] && !range[2])) {res.setHeader('content-range', `bytes */${bytes.length}`); finish(416); return;}
        if (!range[1]) start = Math.max(0, bytes.length - Number(range[2]));
        else {start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2]));}
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {res.setHeader('content-range', `bytes */${bytes.length}`); finish(416); return;}
        status = 206; res.setHeader('content-range', `bytes ${start}-${end}/${bytes.length}`);
      }
      res.setHeader('content-length', end - start + 1);
      res.writeHead(status); res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
    } catch {if (!res.destroyed) finish(404);} finally {await root?.close(); active--;}
  }};
}
