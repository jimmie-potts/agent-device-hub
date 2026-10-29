// Keep released local producer files compatible. Remote producers explicitly select private HTTPS and require a
// matching installed receipt; changing an old endpoint alone never activates remote publication (Hub #566).
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, type FileHandle} from 'node:fs/promises';
import {dirname, join} from 'node:path';

/** The largest producer file and receipt the hook reads, as the old hook did. */
export const MAX_PRODUCER_BYTES = 8192;
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
/** The path every 1.x producer's endpoint names, which the runtime retired (#835): only its host and port are used. */
export const PRODUCER_PATH = '/api/monitor/v1/events';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MEMBERS = 'enabled,endpoint,qualified,source,token';

/** The lifecycle version a producer selected: none (1.0), 1.1 or 1.2. */
export type LifecycleVersion = '1.1' | '1.2';
/** What the 2.0 hook needs from a producer file. */
export type Producer = {
  /** The qualified runtime origin: legacy loopback HTTP, or explicitly selected private HTTPS. */
  edge: string;
  token: string;
  /** The producer's source configuration, which the hook completes with each hook's name for the normalizers. */
  configuration: Readonly<Record<string, unknown>>;
  /** The source the producer's credential acts as at the edge: see `producerSource`. */
  source: string;
  lifecycleVersion?: LifecycleVersion;
};

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The Hub's canonical JSON (apps/hub/src/common.ts): object keys sorted at every depth. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isFields(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * The ID of a producer's credential, as the Hub's setup names it (`producerPrincipal` in apps/hub/src/setup.ts): `hub-`
 * and the first 32 hex digits of the SHA-256 of its source configuration without the hook's name, as canonical JSON.
 */
export function producerCredentialId(configuration: Readonly<Record<string, unknown>>): string {
  const {hook: _hook, ...source} = configuration;
  return `hub-${createHash('sha256').update(canonical(source)).digest('hex').slice(0, 32)}`;
}

/**
 * The source a producer's credential acts as at the runtime's edge: `bunny/parts/<credential ID>`, as the cutover's
 * `convertHubEdge` names a converted credential. The ID is already in routing form, so the conversion keeps it as it is.
 */
export const producerSource = (configuration: Readonly<Record<string, unknown>>): string => `bunny/parts/${producerCredentialId(configuration)}`;

/** What `readPrivateJson` gives for a file that does not exist. */
const MISSING = Symbol('missing');

/** Reads a private JSON file of at most `limit` bytes, `MISSING` when there is none, or undefined when it is not one. */
export async function readPrivateJson(path: string, limit: number): Promise<unknown> {
  let file: FileHandle;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    return (error as {code?: unknown}).code === 'ENOENT' ? MISSING : undefined;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > limit) return undefined;
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    for (;;) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > limit) return undefined;
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, size))) as unknown;
  } catch {
    return undefined;
  } finally {
    await file.close().catch(() => {});
  }
}

/** The qualified endpoint's origin; a remote endpoint never inherits the old loopback qualification. */
function edgeOf(endpoint: unknown, transport: unknown): string | undefined {
  if (typeof endpoint !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== PRODUCER_PATH) return undefined;
  if (transport === undefined) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '') return undefined;
  } else if (transport !== 'private-https' || url.protocol !== 'https:') return undefined;
  return url.origin;
}

/**
 * Whether the receipt beside the producer file lets it emit. Setup's intent gates emission across a crash between enabling
 * the producer and its final receipt; a standalone producer file from the earlier migration API has no receipt.
 */
async function receiptAllows(path: string, producer: Fields): Promise<boolean> {
  const receipt = await readPrivateJson(join(dirname(path), 'receipt.json'), MAX_RECEIPT_BYTES);
  if (receipt === MISSING) return producer.transport === undefined;
  if (!isFields(receipt)) return false;
  const input = receipt.input;
  return receipt.version === 1 && receipt.state === 'installed' && receipt.token === producer.token && isFields(input) &&
    input.directory === dirname(path) && input.endpoint === producer.endpoint && input.qualified === true &&
    input.lifecycleVersion === producer.lifecycleVersion && input.transport === producer.transport && canonical(input.source) === canonical(producer.source);
}

/**
 * The producer at `path`, or undefined when the hook must not emit: the file is not private, not the known shape, not
 * enabled and qualified, has no qualified endpoint or token, or its required receipt is not installed or does not match.
 */
export async function readProducer(path: string): Promise<Producer | undefined> {
  const value = await readPrivateJson(path, MAX_PRODUCER_BYTES);
  if (!isFields(value)) return undefined;
  const {lifecycleVersion, enabled, qualified, token, source} = value;
  if (Object.keys(value).filter(key => key !== 'lifecycleVersion' && key !== 'transport').sort().join(',') !== MEMBERS) return undefined;
  if (lifecycleVersion !== undefined && lifecycleVersion !== '1.1' && lifecycleVersion !== '1.2') return undefined;
  if (enabled !== true || qualified !== true || typeof token !== 'string' || !TOKEN.test(token) || !isFields(source)) return undefined;
  const edge = edgeOf(value.endpoint, value.transport);
  if (edge === undefined || !await receiptAllows(path, value)) return undefined;
  return {edge, token, configuration: source, source: producerSource(source), ...(lifecycleVersion === undefined ? {} : {lifecycleVersion})};
}
