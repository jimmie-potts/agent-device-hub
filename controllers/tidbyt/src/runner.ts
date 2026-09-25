import { constants, openSync, closeSync, fstatSync, readSync, realpathSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateSnapshot, type Snapshot } from '@jimmie-potts/agent-state';
import { INSTALLATION_ID, TidbytCloudConnection, type DisplayConnection } from './connection.js';
import { parseTidbytCredentials, type TidbytCredentials } from './credentials.js';
import { TidbytController } from './controller.js';
import { parsePlaybackSnapshot, type PlaybackSnapshot } from './nowplaying.js';
import { TidbytNowPlayingPublisher, type PlaybackFeed } from './nowplaying-publisher.js';
import { TidbytStatusPublisher, type StatusFeed } from './publisher.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HUB_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_FEED = 1024 * 1024;
const MAX_PLAYBACK = 64 * 1024;
export const DEFAULT_NOW_PLAYING_INSTALLATION_ID = 'nowplaying';
const fail = (code: string): never => { throw new Error(code); };

/** No redirect, remote host, URL credentials, query, fragment or alternate route. */
function hubOrigin(value: unknown): string {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/.test(value)) return fail('invalid-runner-config');
  try { return new URL(value).origin; } catch { return fail('invalid-runner-config'); }
}

function hubToken(value: unknown): string {
  return typeof value === 'string' && TOKEN.test(value) ? value : fail('invalid-runner-config');
}

/** One authenticated GET within 2.5 s and `limit` bytes; anything else is `feed-unavailable`. */
async function hubJson(url: string, token: string, limit: number): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2500);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: abort.signal });
    if (!response.ok || !response.body) return fail('feed-unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) return fail('feed-unavailable');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return fail('feed-unavailable'); }
  finally { clearTimeout(timer); abort.abort(); }
}

export class HubStatusFeed implements StatusFeed {
  readonly #url: string;
  readonly #owner: string;
  readonly #token: string;
  constructor(options: { hubUrl: string; ownerId: string; token: string }) {
    this.#url = hubOrigin(options.hubUrl) + '/api/monitor/v1/sessions';
    this.#token = hubToken(options.token);
    if (typeof options.ownerId !== 'string' || !HUB_ID.test(options.ownerId)) fail('invalid-runner-config');
    this.#owner = options.ownerId;
  }
  async snapshot(): Promise<Snapshot> {
    const value = await hubJson(this.#url, this.#token, MAX_FEED) as Record<string, unknown> | null;
    if (!value || value.apiVersion !== '1.0' || value.ownerId !== this.#owner || value.connection !== 'current') return fail('feed-unavailable');
    const valid = validateSnapshot(value.snapshot);
    return valid.ok ? valid.value : fail('feed-unavailable');
  }
}

/** The hub's shared playback snapshot for one configured source. */
export class HubPlaybackFeed implements PlaybackFeed {
  readonly #url: string;
  readonly #source: string;
  readonly #token: string;
  constructor(options: { hubUrl: string; sourceId: string; token: string }) {
    this.#url = hubOrigin(options.hubUrl) + '/api/playback/v1/snapshot';
    this.#token = hubToken(options.token);
    if (typeof options.sourceId !== 'string' || !HUB_ID.test(options.sourceId)) fail('invalid-runner-config');
    this.#source = options.sourceId;
  }
  async snapshot(): Promise<PlaybackSnapshot> {
    return parsePlaybackSnapshot(await hubJson(this.#url, this.#token, MAX_PLAYBACK), this.#source) ?? fail('feed-unavailable');
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

/** Read one private file through a no-follow descriptor; errors never include path or contents. Shared with the local controller host. */
export function privateText(path: unknown): string {
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

export type NowPlayingConfig = { token: string; sourceId: string; installationId: string };
export type RunnerConfig = { hubUrl: string; ownerId: string; token: string; credentials: TidbytCredentials; nowPlaying?: NowPlayingConfig };

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

function nowPlayingConfig(value: unknown, hubUrl: string, statusInstallation: string): NowPlayingConfig {
  if (!plainObject(value) || !keysAre(value, ['tokenFile', 'sourceId'], ['installationId'])) return fail('invalid-runner-config');
  const installationId = value.installationId ?? DEFAULT_NOW_PLAYING_INSTALLATION_ID;
  if (typeof installationId !== 'string' || !INSTALLATION_ID.test(installationId) || installationId === statusInstallation) return fail('invalid-runner-config');
  const token = privateText(value.tokenFile).trim();
  new HubPlaybackFeed({ hubUrl, sourceId: value.sourceId as string, token });
  return { token, sourceId: value.sourceId as string, installationId };
}

export function loadRunnerConfig(path: string): RunnerConfig {
  try {
    const value = JSON.parse(privateText(path));
    if (!plainObject(value) || !keysAre(value, ['credentialsFile', 'hubUrl', 'ownerId', 'tokenFile'], ['nowPlaying'])) return fail('invalid-runner-config');
    const hubUrl = hubOrigin(value.hubUrl);
    const token = privateText(value.tokenFile).trim();
    const credentials = parseTidbytCredentials(privateText(value.credentialsFile));
    new HubStatusFeed({ hubUrl, ownerId: value.ownerId as string, token });
    const nowPlaying = value.nowPlaying === undefined ? undefined : nowPlayingConfig(value.nowPlaying, hubUrl, credentials.installationId);
    const config: RunnerConfig = { hubUrl, ownerId: value.ownerId as string, token, credentials, ...(nowPlaying ? { nowPlaying } : {}) };
    // Validate cloud configuration before acquiring the lease or making any request.
    runnerConnection(config);
    return config;
  } catch { return fail('invalid-runner-config'); }
}

/** The cloud connection for a runner: the status installation, plus the now-playing one when configured. */
export function runnerConnection(config: RunnerConfig): TidbytCloudConnection {
  return new TidbytCloudConnection({
    ...config.credentials,
    additionalInstallationIds: config.nowPlaying ? [config.nowPlaying.installationId] : [],
  });
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
    const controller = new TidbytController({ controllerId: 'tidbyt-status', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', connection: options.connection ?? runnerConnection(config) });
    const publisher = new TidbytStatusPublisher({ feed, controller });
    const nowPlaying = config.nowPlaying && new TidbytNowPlayingPublisher({
      feed: new HubPlaybackFeed({ hubUrl: config.hubUrl, sourceId: config.nowPlaying.sourceId, token: config.nowPlaying.token }),
      controller, installation: config.nowPlaying.installationId,
    });
    let stopping: Promise<void> | undefined;
    publisher.start();
    nowPlaying?.start();
    return {
      /** The device's one queue. A host may serve its snapshot and submit controller v1 requests; display writes stay with the publishers. */
      controller,
      state: () => ({ ...publisher.state(), ...(nowPlaying ? { nowPlaying: nowPlaying.state() } : {}) }),
      stop: () => stopping ??= (async () => {
        publisher.stop();
        nowPlaying?.stop();
        controller.close();
        try { await Promise.all([publisher.whenIdle(), nowPlaying?.whenIdle()]); } finally { release(); }
      })(),
    };
  } catch { release(); return fail('runner-start-failed'); }
}
