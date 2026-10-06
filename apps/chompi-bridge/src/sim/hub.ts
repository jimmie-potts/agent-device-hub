import { timingSafeEqual } from 'node:crypto';
import { systemClock, type Clock } from '../clock.js';
import type { Activity, AttentionKind, Provider } from '../routing/feed.js';

/**
 * A synthetic Hub session feed for disposable verification runs and the scenario catalog (#853). It serves exactly the
 * two read routes the bridge's feed client uses, in the Hub's released format (no new message format):
 * `GET /api/monitor/v1/sessions?snapshotVersion=1.3|1.2` and the `GET /api/monitor/v1/changes` event stream with a
 * heartbeat every second and a `state` notification per revision. It accepts only its own run-generated bearer token,
 * answers every other method or path with an error, and records each request's method, path and whether it was
 * authorized, never the token. Sessions, titles and IDs are synthetic.
 *
 * `handle` takes a fetch `Request`, so the same feed serves an in-memory run (its `fetch`) and a loopback HTTP server.
 */

export interface SessionRecordOptions {
  provider?: Provider;
  client?: 'cli' | 'desktop' | 'code';
  hostId?: string;
  sourceId?: string;
  sessionId: string;
  parent?: { status: 'top-level' | 'unknown' | 'known' };
  activity?: Activity;
  attention?: readonly AttentionKind[];
  /** One entry per completion notice: the consumers that acknowledged it (empty means unacknowledged). */
  notices?: readonly (readonly string[])[];
  read?: 'unknown' | 'read' | 'unread';
  freshness?: 'current' | 'uncertain';
  restartUncertain?: boolean;
  title?: string;
  hostSessionId?: string;
  lastEvidenceAtMs?: number;
}

/** One snapshot 1.3 session record as the Hub serves it. */
export function hubSession({
  provider = 'codex', client = provider === 'codex' ? 'desktop' : 'code', hostId = 'pc', sourceId = provider === 'codex' ? 'codex-desktop' : 'claude-code',
  sessionId, parent = { status: 'top-level' }, activity = 'idle', attention = [], notices = [], read = 'unknown', freshness = 'current',
  restartUncertain = false, title, hostSessionId, lastEvidenceAtMs = 1_000,
}: SessionRecordOptions): Record<string, unknown> {
  return {
    generation: 1,
    identity: { provider, client, hostId, sourceId, sessionId },
    turn: { status: 'unknown' }, parent, activity,
    attention: attention.map((kind, i) => ({ id: { status: 'known', id: `a${i}` }, kind, turn: { status: 'unknown' } })),
    notices: notices.map((acknowledgedBy, i) => ({ id: String(i).padStart(64, 'a'), kind: 'turn-ended', turn: { status: 'unknown' }, acknowledgedBy: [...acknowledgedBy] })),
    read, unavailable: [], ordering: { status: 'unknown' }, lastEvidenceAtMs, observedAtMs: lastEvidenceAtMs,
    observationAgeMs: 0, freshness, restartUncertain, children: { active: 0, uncertain: 0 },
    ...(title === undefined ? {} : { title: { value: title, source: 'native' } }),
    ...(hostSessionId === undefined ? {} : { hostSessionId }),
  };
}

/** The sessions envelope the Hub answers. */
export function hubEnvelope(
  sessions: readonly Record<string, unknown>[],
  { version = '1.3', revision = 1, collector = 'running', asOfMs = 5_000 }: { version?: string; revision?: number; collector?: string; asOfMs?: number } = {},
): Record<string, unknown> {
  return {
    apiVersion: '1.0', ownerId: 'owner-1', connection: 'current', admissionRejected: 0, nextRequestId: 'r1',
    snapshot: { apiVersion: version, revision, asOfMs, collector, lossCount: 0, sessions },
  };
}

export const SESSIONS_PATH = '/api/monitor/v1/sessions';
export const CHANGES_PATH = '/api/monitor/v1/changes';

/** A scriptable session. `sessionId` is its key. */
export interface SyntheticSession extends Required<Pick<SessionRecordOptions, 'provider' | 'sessionId' | 'activity' | 'read'>> {
  title: string;
  hostSessionId?: string;
  attention: AttentionKind[];
  /** Completion notices, each acknowledged or not. */
  notices: boolean[];
  lastEvidenceAtMs: number;
}

export interface FeedRequestRecord { at: number; method: string; path: string; authorized: boolean; status: number }

export interface SyntheticHubOptions {
  /** The run-generated bearer token; the only credential the feed accepts. */
  token: string;
  clock?: Clock;
  heartbeatMs?: number;
}

interface Stream { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean }

const encoder = new TextEncoder();
const MAX_REQUESTS = 500;

export class SyntheticHub {
  readonly requests: FeedRequestRecord[] = [];
  /** Answers snapshot 1.2 only, like a Hub without 1.3 (Claude routing then stays off). */
  only12 = false;
  collector: 'running' | 'quiesced' | 'faulted' | 'closed' = 'running';
  readonly #token: Buffer;
  readonly #clock: Clock;
  readonly #sessions = new Map<string, SyntheticSession>();
  readonly #streams = new Set<Stream>();
  readonly #listeners = new Set<() => void>();
  #revision = 1;
  #heartbeat: unknown;
  #closed = false;
  #authorizedRequests = 0;

  constructor(options: SyntheticHubOptions) {
    if (!/^[\x21-\x7e]{16,1024}$/.test(options.token)) throw new Error('synthetic-hub-token-invalid');
    this.#token = Buffer.from(options.token);
    this.#clock = options.clock ?? systemClock;
    this.#heartbeat = this.#clock.setInterval(() => this.#send(': heartbeat\n\n'), options.heartbeatMs ?? 1000);
  }

  get revision(): number { return this.#revision; }
  get openStreams(): number { return this.#streams.size; }
  get authorizedRequests(): number { return this.#authorizedRequests; }
  sessions(): SyntheticSession[] { return [...this.#sessions.values()].map(s => ({ ...s, attention: [...s.attention], notices: [...s.notices] })); }
  session(sessionId: string): SyntheticSession | undefined { return this.#sessions.get(sessionId); }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Scripting: each change is a new revision and one `state` notification, as the Hub sends.

  addSession(session: Omit<SyntheticSession, 'lastEvidenceAtMs' | 'attention' | 'notices' | 'activity' | 'read'> & Partial<SyntheticSession>): void {
    this.#sessions.set(session.sessionId, {
      activity: 'idle', read: 'unknown', attention: [], notices: [], ...session, lastEvidenceAtMs: session.lastEvidenceAtMs ?? this.#clock.now(),
    });
    this.#changed();
  }

  removeSession(sessionId: string): void {
    if (this.#sessions.delete(sessionId)) this.#changed();
  }

  update(sessionId: string, patch: Partial<Pick<SyntheticSession, 'activity' | 'attention' | 'notices' | 'read' | 'title'>>): void {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error('synthetic-session-unknown');
    Object.assign(session, patch, { lastEvidenceAtMs: Math.max(session.lastEvidenceAtMs + 1, this.#clock.now()) });
    this.#changed();
  }

  /** A turn ends: the session is idle with one unacknowledged completion notice and no attention. */
  endTurn(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error('synthetic-session-unknown');
    this.update(sessionId, { activity: 'idle', attention: [], notices: [...session.notices, false], read: 'unknown' });
  }

  /** Ends every open event stream, as a Hub restart would; the bridge must reconnect and replay nothing. */
  dropStreams(): void {
    for (const stream of [...this.#streams]) this.#end(stream);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clock.clearInterval(this.#heartbeat);
    this.dropStreams();
    this.#listeners.clear();
  }

  /** The snapshot this feed serves at `version`. 1.2 has no Claude Desktop IDs. */
  envelope(version: '1.2' | '1.3' = '1.3'): Record<string, unknown> {
    const records = [...this.#sessions.values()].map(s => hubSession({
      provider: s.provider, sessionId: s.sessionId, activity: s.activity, attention: s.attention, read: s.read, title: s.title,
      notices: s.notices.map(acknowledged => acknowledged ? ['dashboard'] : []), lastEvidenceAtMs: s.lastEvidenceAtMs,
      ...(version === '1.3' && s.hostSessionId ? { hostSessionId: s.hostSessionId } : {}),
    }));
    return hubEnvelope(records, { version, revision: this.#revision, collector: this.collector, asOfMs: this.#clock.now() });
  }

  /** The in-memory transport: the bridge's feed client calls it instead of the network. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => this.handle(new Request(input, init))) as typeof fetch;

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const authorized = this.#authorized(request.headers.get('authorization'));
    const answer = (status: number, body: BodyInit | null, type = 'application/json') => {
      this.#log(request.method, url.pathname, authorized, status);
      return new Response(body, { status, headers: { 'content-type': type, 'cache-control': 'no-store' } });
    };
    if (this.#closed) return answer(503, JSON.stringify({ error: { code: 'unavailable' } }));
    if (url.pathname !== SESSIONS_PATH && url.pathname !== CHANGES_PATH) return answer(404, JSON.stringify({ error: { code: 'not-found' } }));
    if (request.method !== 'GET') return answer(405, JSON.stringify({ error: { code: 'method-not-allowed' } }));
    if (!authorized) return answer(401, JSON.stringify({ error: { code: 'unauthenticated' } }));
    this.#authorizedRequests++;
    if (url.pathname === SESSIONS_PATH) {
      const version = url.searchParams.get('snapshotVersion') ?? '1.2';
      if (version !== '1.2' && version !== '1.3') return answer(400, JSON.stringify({ error: { code: 'invalid-input' } }));
      if (version === '1.3' && this.only12) return answer(400, JSON.stringify({ error: { code: 'invalid-input' } }));
      return answer(200, JSON.stringify(this.envelope(version)));
    }
    const stream: Stream = { controller: undefined as unknown as ReadableStreamDefaultController<Uint8Array>, closed: false };
    const body = new ReadableStream<Uint8Array>({
      start: controller => { stream.controller = controller; },
      cancel: () => { stream.closed = true; this.#streams.delete(stream); },
    });
    this.#streams.add(stream);
    const abort = () => this.#end(stream, request.signal.reason ?? new Error('aborted'));
    if (request.signal.aborted) abort();
    else request.signal.addEventListener('abort', abort, { once: true });
    return answer(200, body, 'text/event-stream');
  }

  #authorized(header: string | null): boolean {
    const match = /^Bearer ([\x21-\x7e]{1,1024})$/.exec(header ?? '');
    if (!match) return false;
    const given = Buffer.from(match[1]!);
    return given.length === this.#token.length && timingSafeEqual(given, this.#token);
  }

  #log(method: string, path: string, authorized: boolean, status: number): void {
    this.requests.push({ at: this.#clock.now(), method, path, authorized, status });
    if (this.requests.length > MAX_REQUESTS) this.requests.splice(0, this.requests.length - MAX_REQUESTS);
  }

  #changed(): void {
    this.#revision++;
    this.#send(`id: e:${this.#revision}\nevent: state\ndata: {"revision":${this.#revision}}\n\n`);
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* a page listener never breaks the feed */ }
    }
  }

  #send(text: string): void {
    for (const stream of this.#streams) {
      if (stream.closed) continue;
      try { stream.controller.enqueue(encoder.encode(text)); } catch { this.#end(stream); }
    }
  }

  #end(stream: Stream, error?: unknown): void {
    if (stream.closed) return;
    stream.closed = true;
    this.#streams.delete(stream);
    try {
      if (error) stream.controller.error(error);
      else stream.controller.close();
    } catch { /* already closed */ }
  }
}
