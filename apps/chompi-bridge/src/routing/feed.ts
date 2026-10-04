import { systemClock, type Clock } from '../clock.js';
import { readBoundedFile } from './files.js';

/**
 * Read-only client for the Hub's session feed. It reads `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and follows
 * `GET /api/monitor/v1/changes`, refetching a whole snapshot on every notification instead of replaying anything. It
 * never sends anything but these two GETs, so it cannot ingest, acknowledge, label or approve.
 */

export type Provider = 'codex' | 'claude';
export interface SessionIdentity { provider: Provider; client: 'cli' | 'desktop' | 'code'; hostId: string; sourceId: string; sessionId: string }
export type Activity = 'unknown' | 'active' | 'idle' | 'interrupted' | 'ended';
export type AttentionKind = 'question' | 'input' | 'approval';

/** The parts of one snapshot session that routing and lights use. Labels are not used: Codex verification needs its own title. */
export interface FeedSession {
  identity: SessionIdentity;
  /** False only when the Hub knows a parent; unknown parentage is not evidence of a child. */
  root: boolean;
  activity: Activity;
  attention: readonly AttentionKind[];
  /** Completion notices no consumer has acknowledged. */
  unacknowledgedNotices: number;
  read: 'unknown' | 'read' | 'unread';
  freshness: 'current' | 'uncertain';
  restartUncertain: boolean;
  title: string | null;
  /** Claude Desktop `local_<id>` (snapshot 1.3, root sessions only); null when absent or malformed. */
  hostSessionId: string | null;
  lastEvidenceAtMs: number;
}

export type FeedStatus = 'unavailable' | 'current' | 'stale';
export interface FeedView {
  status: FeedStatus;
  revision: number | null;
  snapshotVersion: '1.2' | '1.3' | null;
  /** The last good snapshot's sessions, kept while stale for display. */
  sessions: readonly FeedSession[];
  /** Why the feed is not current; null when current. Never contains the token. */
  reason: string | null;
}

export type NormalizedSnapshot =
  | { ok: true; revision: number; snapshotVersion: '1.2' | '1.3'; collector: string; sessions: FeedSession[]; skipped: number }
  | { ok: false; reason: string };

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
/** The Desktop session ID goes into a link, so it is held to a URI-safe subset of the Hub's identifier grammar. */
export const HOST_SESSION_ID = /^local_[A-Za-z0-9-]{1,122}$/;
const ACTIVITY = new Set(['unknown', 'active', 'idle', 'interrupted', 'ended']);
const ATTENTION = new Set(['question', 'input', 'approval']);
const READ = new Set(['unknown', 'read', 'unread']);
const COLLECTOR = new Set(['running', 'quiesced', 'faulted', 'closed']);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function identity(value: unknown): SessionIdentity | undefined {
  if (!isObject(value)) return undefined;
  const { provider, client, hostId, sourceId, sessionId } = value;
  if (provider !== 'codex' && provider !== 'claude') return undefined;
  if (provider === 'codex' ? client !== 'cli' && client !== 'desktop' : client !== 'code') return undefined;
  for (const id of [hostId, sourceId, sessionId]) if (typeof id !== 'string' || !ID.test(id)) return undefined;
  return { provider, client: client as SessionIdentity['client'], hostId: hostId as string, sourceId: sourceId as string, sessionId: sessionId as string };
}

function session(value: unknown): FeedSession | undefined {
  if (!isObject(value)) return undefined;
  const id = identity(value.identity);
  const parent = isObject(value.parent) ? value.parent.status : undefined;
  if (!id || !['unknown', 'top-level', 'known'].includes(parent as string)) return undefined;
  if (!ACTIVITY.has(value.activity as string) || !READ.has(value.read as string)) return undefined;
  if (value.freshness !== 'current' && value.freshness !== 'uncertain') return undefined;
  if (typeof value.restartUncertain !== 'boolean' || !isCount(value.lastEvidenceAtMs)) return undefined;
  if (!Array.isArray(value.attention) || !Array.isArray(value.notices)) return undefined;
  const attention: AttentionKind[] = [];
  for (const entry of value.attention) {
    if (!isObject(entry) || !ATTENTION.has(entry.kind as string)) return undefined;
    attention.push(entry.kind as AttentionKind);
  }
  let unacknowledged = 0;
  for (const notice of value.notices) {
    if (!isObject(notice) || !Array.isArray(notice.acknowledgedBy)) return undefined;
    if (notice.acknowledgedBy.length === 0) unacknowledged++;
  }
  let title: string | null = null;
  if (value.title !== undefined) {
    if (!isObject(value.title) || typeof value.title.value !== 'string' || value.title.value.length === 0 || [...value.title.value].length > 160) return undefined;
    title = value.title.value;
  }
  const root = parent !== 'known';
  const host = value.hostSessionId;
  const hostSessionId = root && typeof host === 'string' && HOST_SESSION_ID.test(host) ? host : null;
  return {
    identity: id, root, activity: value.activity as Activity, attention, unacknowledgedNotices: unacknowledged, read: value.read as FeedSession['read'],
    freshness: value.freshness, restartUncertain: value.restartUncertain, title, hostSessionId, lastEvidenceAtMs: value.lastEvidenceAtMs,
  };
}

/** Validates the Hub's sessions envelope (snapshot 1.2 or 1.3) and keeps what routing uses. Malformed sessions are skipped. */
export function normalizeSnapshot(envelope: unknown): NormalizedSnapshot {
  if (!isObject(envelope) || !isObject(envelope.snapshot)) return { ok: false, reason: 'snapshot-malformed' };
  const snapshot = envelope.snapshot;
  if (snapshot.apiVersion !== '1.2' && snapshot.apiVersion !== '1.3') return { ok: false, reason: 'snapshot-version' };
  if (!isCount(snapshot.revision) || !COLLECTOR.has(snapshot.collector as string) || !Array.isArray(snapshot.sessions) || snapshot.sessions.length > 128) {
    return { ok: false, reason: 'snapshot-malformed' };
  }
  const sessions: FeedSession[] = [];
  let skipped = 0;
  for (const entry of snapshot.sessions) {
    const normalized = session(entry);
    if (normalized) sessions.push(normalized);
    else skipped++;
  }
  return { ok: true, revision: snapshot.revision, snapshotVersion: snapshot.apiVersion, collector: snapshot.collector as string, sessions, skipped };
}

export class FeedConfigError extends Error {
  readonly code = 'invalid-feed-config';
}

/** The Hub accepts only its numeric loopback host; the bridge talks to nothing else. */
export function validateOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new FeedConfigError('hub origin must be http://127.0.0.1:<port>');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new FeedConfigError('hub origin must be http://127.0.0.1:<port>');
  }
  return url.origin;
}

const TOKEN = /^[\x21-\x7e]{1,1024}$/;

/**
 * Reads the bearer token from a private file: one printable token of at most 1024 characters. On POSIX the file must
 * not be group- or world-accessible; on Windows its privacy is the user profile ACL. Errors never contain the token.
 */
export async function readTokenFile(path: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  let file: { text: string; mode: number };
  try {
    file = await readBoundedFile(path, 4096);
  } catch (error) {
    throw new Error((error as Error).message === 'file-too-large' ? 'token-file-invalid' : 'token-file-unreadable');
  }
  if (platform !== 'win32' && (file.mode & 0o077) !== 0) throw new Error('token-file-not-private');
  const token = file.text.trim();
  if (!TOKEN.test(token)) throw new Error('token-file-invalid');
  return token;
}

export interface FeedTiming {
  /** Per snapshot request; the Hub's own request limit is three seconds. */
  requestTimeoutMs: number;
  /** Without any stream bytes for this long (the Hub heartbeats every second) the stream is dropped. */
  streamIdleMs: number;
  /** Delay before retrying a failed snapshot or reconnecting. */
  retryMs: number;
  maxSnapshotBytes: number;
  maxLineBytes: number;
}

export const DEFAULT_FEED_TIMING: Readonly<FeedTiming> = Object.freeze({
  requestTimeoutMs: 3000, streamIdleMs: 5000, retryMs: 2000, maxSnapshotBytes: 2 * 1024 * 1024, maxLineBytes: 64 * 1024,
});

export interface HubFeedOptions {
  origin: string;
  tokenFile: string;
  /** Replaces the token file read, for tests. */
  readToken?: () => Promise<string>;
  clock?: Clock;
  fetch?: typeof fetch;
  timing?: Partial<FeedTiming>;
}

export interface HubFeed {
  start(): void;
  stop(): Promise<void>;
  view(): FeedView;
  /** Called after every snapshot and status change. Returns an unsubscribe function. */
  subscribe(listener: (view: FeedView) => void): () => void;
}

export function createHubFeed(options: HubFeedOptions): HubFeed {
  return new Feed(options);
}

const SESSIONS_PATH = '/api/monitor/v1/sessions';
const CHANGES_PATH = '/api/monitor/v1/changes';
const TOKEN_REASONS = new Set(['token-file-unreadable', 'token-file-not-private', 'token-file-invalid']);

class FeedFailure extends Error {}

class Feed implements HubFeed {
  readonly #origin: string;
  readonly #readToken: () => Promise<string>;
  readonly #clock: Clock;
  readonly #fetch: typeof fetch;
  readonly #timing: FeedTiming;
  readonly #listeners = new Set<(view: FeedView) => void>();
  #running = false;
  #token: string | undefined;
  #version: '1.2' | '1.3' = '1.3';
  #sessions: readonly FeedSession[] = [];
  #revision: number | null = null;
  #snapshotVersion: '1.2' | '1.3' | null = null;
  #haveSnapshot = false;
  #snapshotOk = false;
  #collectorRunning = false;
  #streamOpen = false;
  #reason: string | null = null;
  #stream: AbortController | undefined;
  #requests = new Set<AbortController>();
  #idleTimer: unknown;
  #retryTimer: unknown;
  #reconnectTimer: unknown;
  #snapshotBusy = false;
  #snapshotPending = false;
  #tasks = new Set<Promise<unknown>>();

  constructor(options: HubFeedOptions) {
    this.#origin = validateOrigin(options.origin);
    this.#readToken = options.readToken ?? (() => readTokenFile(options.tokenFile));
    this.#clock = options.clock ?? systemClock;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timing = { ...DEFAULT_FEED_TIMING, ...options.timing };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#track(this.#connect());
  }

  async stop(): Promise<void> {
    this.#running = false;
    for (const timer of [this.#idleTimer, this.#retryTimer, this.#reconnectTimer]) if (timer !== undefined) this.#clock.clearTimeout(timer);
    this.#idleTimer = this.#retryTimer = this.#reconnectTimer = undefined;
    this.#stream?.abort(new FeedFailure('stopped'));
    for (const request of this.#requests) request.abort(new FeedFailure('stopped'));
    await Promise.allSettled([...this.#tasks]);
    this.#listeners.clear();
  }

  view(): FeedView {
    const status: FeedStatus = !this.#haveSnapshot ? 'unavailable' : this.#snapshotOk && this.#streamOpen && this.#collectorRunning ? 'current' : 'stale';
    return { status, revision: this.#revision, snapshotVersion: this.#snapshotVersion, sessions: this.#sessions, reason: status === 'current' ? null : this.#reason ?? 'connecting' };
  }

  subscribe(listener: (view: FeedView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #track(task: Promise<unknown>): void {
    const tracked = task.catch(() => undefined).finally(() => this.#tasks.delete(tracked));
    this.#tasks.add(tracked);
  }

  #publish(): void {
    if (!this.#running) return;
    const view = this.view();
    for (const listener of [...this.#listeners]) {
      try { listener(view); } catch { /* a listener failure must not stop the feed */ }
    }
  }

  #fail(reason: string): void {
    this.#reason = reason;
    this.#publish();
  }

  async #connect(): Promise<void> {
    if (!this.#running) return;
    try {
      this.#token = await this.#readToken();
    } catch (error) {
      const message = (error as Error).message;
      this.#fail(TOKEN_REASONS.has(message) ? message : 'token-file-unreadable');
      return this.#scheduleReconnect();
    }
    if (!this.#running) return;
    if (!(await this.#snapshot())) return this.#scheduleReconnect();
    await this.#follow();
  }

  #scheduleReconnect(): void {
    if (!this.#running || this.#reconnectTimer !== undefined) return;
    this.#reconnectTimer = this.#clock.setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#track(this.#connect());
    }, this.#timing.retryMs);
  }

  #headers(accept: string): Record<string, string> {
    return { authorization: `Bearer ${this.#token}`, accept };
  }

  /** Coalesces notifications: one snapshot in flight and at most one more pending. */
  #requestSnapshot(): void {
    if (this.#snapshotBusy) { this.#snapshotPending = true; return; }
    this.#track(this.#snapshot());
  }

  /** Fetches one snapshot. Returns whether it succeeded; a failure while following schedules a retry. */
  async #snapshot(): Promise<boolean> {
    if (this.#snapshotBusy) { this.#snapshotPending = true; return false; }
    this.#snapshotBusy = true;
    let ok = false;
    try {
      let envelope = await this.#getSnapshot(this.#version);
      if (envelope === 'version-refused' && this.#version === '1.3') {
        this.#version = '1.2';
        envelope = await this.#getSnapshot('1.2');
      }
      if (envelope === 'version-refused') throw new FeedFailure('snapshot-http-400');
      const normalized = normalizeSnapshot(envelope);
      if (!normalized.ok) throw new FeedFailure(normalized.reason);
      this.#sessions = Object.freeze(normalized.sessions);
      this.#revision = normalized.revision;
      this.#snapshotVersion = normalized.snapshotVersion;
      this.#haveSnapshot = true;
      this.#snapshotOk = true;
      this.#collectorRunning = normalized.collector === 'running';
      this.#reason = this.#collectorRunning ? null : `collector-${normalized.collector}`;
      ok = this.#collectorRunning;
      this.#publish();
    } catch (error) {
      if (!this.#running) return false;
      this.#snapshotOk = false;
      this.#fail(error instanceof FeedFailure ? error.message : 'snapshot-failed');
    } finally {
      this.#snapshotBusy = false;
    }
    if (!this.#running) return false;
    if (!ok) {
      // A pending notification joins the retry rather than hammering a failing Hub.
      this.#snapshotPending = false;
      if (this.#streamOpen) this.#scheduleRetry();
      return this.#haveSnapshot && this.#snapshotOk;
    }
    if (this.#snapshotPending) {
      this.#snapshotPending = false;
      this.#requestSnapshot();
    }
    return true;
  }

  #scheduleRetry(): void {
    if (!this.#running || this.#retryTimer !== undefined) return;
    this.#retryTimer = this.#clock.setTimeout(() => {
      this.#retryTimer = undefined;
      if (this.#streamOpen) this.#requestSnapshot();
    }, this.#timing.retryMs);
  }

  async #getSnapshot(version: '1.2' | '1.3'): Promise<unknown> {
    const controller = new AbortController();
    this.#requests.add(controller);
    let timedOut = false;
    const timer = this.#clock.setTimeout(() => { timedOut = true; controller.abort(new FeedFailure('snapshot-timeout')); }, this.#timing.requestTimeoutMs);
    try {
      const response = await this.#fetch(`${this.#origin}${SESSIONS_PATH}?snapshotVersion=${version}`, {
        method: 'GET', headers: this.#headers('application/json'), signal: controller.signal, redirect: 'error',
      });
      if (response.status === 400 && version === '1.3') {
        await response.body?.cancel().catch(() => undefined);
        return 'version-refused';
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new FeedFailure(`snapshot-http-${response.status}`);
      }
      const text = await readLimited(response, this.#timing.maxSnapshotBytes);
      try {
        return JSON.parse(text);
      } catch {
        throw new FeedFailure('snapshot-malformed');
      }
    } catch (error) {
      if (timedOut) throw new FeedFailure('snapshot-timeout');
      if (error instanceof FeedFailure) throw error;
      throw new FeedFailure('snapshot-unreachable');
    } finally {
      this.#clock.clearTimeout(timer);
      this.#requests.delete(controller);
    }
  }

  async #follow(): Promise<void> {
    if (!this.#running) return;
    const controller = new AbortController();
    this.#stream = controller;
    let reason = 'stream-closed';
    try {
      const response = await this.#fetch(`${this.#origin}${CHANGES_PATH}`, {
        method: 'GET', headers: this.#headers('text/event-stream'), signal: controller.signal, redirect: 'error',
      });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new FeedFailure(`stream-http-${response.status}`);
      }
      this.#streamOpen = true;
      this.#armIdle(controller);
      this.#publish();
      if (!this.#snapshotOk || !this.#collectorRunning) this.#scheduleRetry();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.#armIdle(controller);
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line === '') {
            if (event === 'state' || event === 'resync') this.#requestSnapshot();
            event = '';
          } else if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          }
          // `id:`, `data:` and `:` comment lines carry nothing routing needs: the snapshot is the state.
        }
        if (buffer.length > this.#timing.maxLineBytes) throw new FeedFailure('stream-line-too-long');
      }
    } catch (error) {
      const cause = controller.signal.aborted ? controller.signal.reason : error;
      reason = cause instanceof FeedFailure ? cause.message : 'stream-unreachable';
    } finally {
      if (this.#idleTimer !== undefined) this.#clock.clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
      if (this.#stream === controller) this.#stream = undefined;
      controller.abort(new FeedFailure(reason));
      this.#streamOpen = false;
    }
    if (!this.#running) return;
    this.#fail(reason);
    this.#scheduleReconnect();
  }

  #armIdle(controller: AbortController): void {
    if (this.#idleTimer !== undefined) this.#clock.clearTimeout(this.#idleTimer);
    this.#idleTimer = this.#clock.setTimeout(() => {
      this.#idleTimer = undefined;
      controller.abort(new FeedFailure('stream-silent'));
    }, this.#timing.streamIdleMs);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FeedFailure('snapshot-too-large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
