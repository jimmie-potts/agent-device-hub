import { constants, openSync, closeSync, fstatSync, readSync, realpathSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateSnapshot, type Snapshot } from '@jimmie-potts/agent-state';
import { TidbytCloudConnection, type DisplayConnection } from './connection.js';
import { parseTidbytCredentials, type TidbytCredentials } from './credentials.js';
import { TidbytController } from './controller.js';
import { TidbytStatusPublisher, type StatusFeed } from './publisher.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_FEED = 1024 * 1024;
const fail = (code: string): never => { throw new Error(code); };

/** No redirect, remote host, URL credentials, query, fragment or alternate route. */
function hubOrigin(value: unknown): string {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/.test(value)) return fail('invalid-runner-config');
  try { return new URL(value).origin; } catch { return fail('invalid-runner-config'); }
}

export class HubStatusFeed implements StatusFeed {
  readonly #url: string;
  readonly #owner: string;
  readonly #token: string;
  constructor(options: { hubUrl: string; ownerId: string; token: string }) {
    this.#url = hubOrigin(options.hubUrl) + '/api/monitor/v1/sessions';
    if (!TOKEN.test(options.token) || !/^[A-Za-z0-9_.-]{1,128}$/.test(options.ownerId)) fail('invalid-runner-config');
    this.#owner = options.ownerId;
    this.#token = options.token;
  }
  async snapshot(): Promise<Snapshot> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2500);
    try {
      const response = await fetch(this.#url, { headers: { Authorization: `Bearer ${this.#token}` }, redirect: 'error', signal: abort.signal });
      if (!response.ok || !response.body) return fail('feed-unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > MAX_FEED) return fail('feed-unavailable');
        chunks.push(next.value);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || value.apiVersion !== '1.0' || value.ownerId !== this.#owner || value.connection !== 'current') return fail('feed-unavailable');
      const valid = validateSnapshot(value.snapshot);
      if (!valid.ok) return fail('feed-unavailable');
      return valid.value;
    } catch { return fail('feed-unavailable'); }
    finally { clearTimeout(timer); abort.abort(); }
  }
}

function outsideCheckout(path: string): void {
  let directory = dirname(realpathSync(path));
  for (;;) {
    const marker = join(directory, '.git');
    if (existsSync(marker) && (lstatSync(marker).isFile() || existsSync(join(marker, 'HEAD')))) fail('unsafe-private-file');
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

/** Read through one no-follow descriptor; errors never include path or contents. */
function privateText(path: unknown): string {
  let fd: number | undefined;
  try {
    if (typeof path !== 'string' || !isAbsolute(path)) return fail('unsafe-private-file');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 16_384) return fail('unsafe-private-file');
    outsideCheckout(path);
    const bytes = Buffer.alloc(16_385);
    let count = 0;
    for (;;) {
      const size = readSync(fd, bytes, count, bytes.length - count, null);
      count += size;
      if (count > 16_384) return fail('unsafe-private-file');
      if (size === 0) return bytes.subarray(0, count).toString('utf8');
    }
  } catch { return fail('unsafe-private-file'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export type RunnerConfig = { hubUrl: string; ownerId: string; token: string; credentials: TidbytCredentials };
export function loadRunnerConfig(path: string): RunnerConfig {
  try {
    const value = JSON.parse(privateText(path));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'credentialsFile,hubUrl,ownerId,tokenFile') return fail('invalid-runner-config');
    const hubUrl = hubOrigin(value.hubUrl);
    const token = privateText(value.tokenFile).trim();
    const credentials = parseTidbytCredentials(privateText(value.credentialsFile));
    new HubStatusFeed({ hubUrl, ownerId: value.ownerId, token });
    // Validate cloud configuration before acquiring the lease or making any request.
    new TidbytCloudConnection(credentials);
    return { hubUrl, ownerId: value.ownerId, token, credentials };
  } catch { return fail('invalid-runner-config'); }
}

// Never open/close another descriptor for an inode this process has locked:
// POSIX close would release SQLite's process-wide file locks.
const heldLeases = new Set<string>();

/** Dedicated lock database, never a shared-state/controller database. */
export function acquireWriterLease(deviceId: string, root = join(homedir(), '.local/state/agent-device-hub/tidbyt')): () => void {
  let db: DatabaseSync | undefined;
  let heldPath: string | undefined;
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = lstatSync(root);
    if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) return fail('writer-unavailable');
    const path = join(realpathSync(root), createHash('sha256').update(deviceId).digest('hex') + '.sqlite');
    if (heldLeases.has(path)) return fail('writer-unavailable');
    heldLeases.add(path);
    heldPath = path;
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) return fail('writer-unavailable');
    } finally { closeSync(fd); }
    outsideCheckout(path);
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    let released = false;
    return () => { if (!released) { released = true; try { db!.close(); } finally { heldLeases.delete(path); } } };
  } catch {
    db?.close();
    if (heldPath) heldLeases.delete(heldPath);
    return fail('writer-unavailable');
  }
}

export function startStatusRunner(config: RunnerConfig, options: { connection?: DisplayConnection; leaseRoot?: string } = {}) {
  const release = acquireWriterLease(config.credentials.deviceId, options.leaseRoot);
  try {
    const feed = new HubStatusFeed(config);
    const controller = new TidbytController({ controllerId: 'tidbyt-status', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', connection: options.connection ?? new TidbytCloudConnection(config.credentials) });
    const publisher = new TidbytStatusPublisher({ feed, controller });
    let stopping: Promise<void> | undefined;
    publisher.start();
    return {
      state: () => publisher.state(),
      stop: () => stopping ??= (async () => {
        publisher.stop();
        controller.close();
        try { await publisher.whenIdle(); } finally { release(); }
      })(),
    };
  } catch { release(); return fail('runner-start-failed'); }
}
