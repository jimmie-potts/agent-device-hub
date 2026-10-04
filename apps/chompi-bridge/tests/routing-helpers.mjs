import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSnapshot } from '../dist/routing/feed.js';

export const CODEX_PACKAGE = 'OpenAI.Codex_2p2nqsd0c76g0';
export const CLAUDE_PACKAGE = 'Claude_pzs8sxrjxfjjc';
export const known = value => ({ status: 'known', value });
export const unknown = (reason = 'scripted') => ({ status: 'unknown', reason });

/** Lets pending promise chains run. */
export async function settle(rounds = 12) { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); }

/** Advances a ManualClock in small steps, letting async work run between them. */
export async function advance(clock, ms, step = 25) {
  await settle();
  for (let elapsed = 0; elapsed < ms; elapsed += step) { clock.advance(Math.min(step, ms - elapsed)); await settle(); }
}

export function tempDir(t, prefix = 'chompi-routing-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Thread and Desktop IDs follow the real shapes: a UUID for Codex, `local_<uuid>` for Claude.
export const tid = n => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const lid = n => `local_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** One snapshot 1.3 session record as the Hub serves it. */
export function hubSession({
  provider = 'codex', client = provider === 'codex' ? 'desktop' : 'code', hostId = 'pc', sourceId = provider === 'codex' ? 'codex-desktop' : 'claude-code',
  sessionId, parent = { status: 'top-level' }, activity = 'idle', attention = [], notices = [], read = 'unknown', freshness = 'current',
  restartUncertain = false, title, hostSessionId, lastEvidenceAtMs = 1_000,
} = {}) {
  return {
    generation: 1,
    identity: { provider, client, hostId, sourceId, sessionId },
    turn: { status: 'unknown' }, parent, activity,
    attention: attention.map((kind, i) => ({ id: { status: 'known', id: `a${i}` }, kind, turn: { status: 'unknown' } })),
    notices: notices.map((acknowledgedBy, i) => ({ id: String(i).padStart(64, 'a'), kind: 'turn-ended', turn: { status: 'unknown' }, acknowledgedBy })),
    read, unavailable: [], ordering: { status: 'unknown' }, lastEvidenceAtMs, observedAtMs: lastEvidenceAtMs,
    observationAgeMs: 0, freshness, restartUncertain, children: { active: 0, uncertain: 0 },
    ...(title === undefined ? {} : { title: { value: title, source: 'native' } }),
    ...(hostSessionId === undefined ? {} : { hostSessionId }),
  };
}

export const codexTask = (n, options = {}) => hubSession({ sessionId: tid(n), title: `Task ${n}`, ...options });
export const claudeTask = (n, options = {}) => hubSession({ provider: 'claude', sessionId: `claude-session-${n}`, hostSessionId: lid(n), title: `Claude ${n}`, ...options });

export function envelope(sessions, { version = '1.3', revision = 1, collector = 'running' } = {}) {
  return {
    apiVersion: '1.0', ownerId: 'owner-1', connection: 'current', admissionRejected: 0, nextRequestId: 'r1',
    snapshot: { apiVersion: version, revision, asOfMs: 5_000, collector, lossCount: 0, sessions },
  };
}

/** A feed view as the feed client produces it, through the real normalizer. */
export function view(sessions, { status = 'current', revision = 1 } = {}) {
  const normalized = normalizeSnapshot(envelope(sessions, { revision }));
  if (!normalized.ok) throw new Error(`fixture rejected: ${normalized.reason}`);
  return { status, revision, snapshotVersion: '1.3', sessions: normalized.sessions, reason: status === 'current' ? null : 'scripted' };
}

/**
 * A scripted desktop behind OS adapter interface version 2. By default the apps behave as qualified:
 * a Codex link selects an existing thread and raises Codex, `LeftAlt+L` focuses its composer, and a Claude link
 * stamps the target's `lastFocusedAt` and raises Claude with its composer focused. Tests then break one step.
 */
export class FakeAdapter {
  version = 2;
  platform = 'win32';
  calls = [];
  keys = [];
  opened = [];
  held = new Set();
  versions = { codex: known('26.930.3930.0'), claude: known('2.19675.0.0') };
  foreground = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };
  foregroundUnknown = false;
  /** Codex sidebar rows: thread ID → title. */
  codexThreads = new Map();
  /** Codex's own thread names (its session index); the sidebar shows `codexThreads`. */
  codexNames = new Map();
  codexSelected = null;
  /** Archived Codex threads; `unknownArchive` makes every answer unknown. */
  codexArchivedIds = new Set();
  unknownArchive = false;
  /** Claude Desktop records: local ID → { localId, isArchived, lastFocusedAt }. */
  claudeRecords = new Map();
  claudeUnknown = false;
  composer = { codex: false, claude: false };
  composerUnknown = false;
  approval = { codex: known(false), claude: known(false) };
  /** Overrides: when set, the named call rejects with this error. */
  reject = {};
  /** When false, links are handed off but the app does nothing (focus rules, unknown ID). */
  appsFollowLinks = true;
  /** Makes the named call never settle. */
  hang = {};

  constructor(clock) { this.clock = clock; }

  #enter(name, args) {
    this.calls.push([name, ...args]);
    if (this.hang[name]) return new Promise(() => {});
    if (this.reject[name]) return Promise.reject(this.reject[name]);
    return undefined;
  }

  async clientVersions() { return this.#enter('clientVersions', []) ?? this.versions; }

  async foregroundWindow() {
    const pending = this.#enter('foregroundWindow', []);
    if (pending) return pending;
    return this.foregroundUnknown ? unknown('no foreground') : known({ ...this.foreground });
  }

  async openUri(uri) {
    const pending = this.#enter('openUri', [uri]);
    if (pending) return pending;
    this.opened.push(uri);
    if (!this.appsFollowLinks) return;
    const codex = /^codex:\/\/threads\/(.+)$/.exec(uri);
    if (codex) {
      this.foreground = { packageIdentity: CODEX_PACKAGE, processName: 'ChatGPT.exe' };
      const id = decodeURIComponent(codex[1]);
      if (this.codexThreads.has(id)) this.codexSelected = id;
      this.composer.codex = false;
      return;
    }
    const claude = /^claude:\/\/code\/continue\?session=(.+)$/.exec(uri);
    if (claude) {
      this.foreground = { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
      const record = this.claudeRecords.get(decodeURIComponent(claude[1]));
      if (record && !record.isArchived) {
        record.lastFocusedAt = this.clock.now() + 1;
        this.composer.claude = true;
      }
    }
  }

  async sendKeys(request) {
    const pending = this.#enter('sendKeys', [request]);
    if (pending) return pending;
    this.keys.push({ action: request.action, keys: [...request.keys] });
    if (request.action === 'down') for (const key of request.keys) this.held.add(key);
    if (request.action === 'up') for (const key of request.keys) this.held.delete(key);
    if (request.action === 'tap' && request.keys.join('+') === 'LeftAlt+L' && this.foreground.packageIdentity === CODEX_PACKAGE) this.composer.codex = true;
  }

  async releaseAll() { this.calls.push(['releaseAll']); this.held.clear(); }

  async codexSelectedThread(threadId, fallbackTitle) {
    const pending = this.#enter('codexSelectedThread', [threadId, fallbackTitle]);
    if (pending) return pending;
    const title = this.codexNames.get(threadId) ?? fallbackTitle;
    if (!title) return unknown('codex-title-missing');
    if ([...this.codexNames].some(([id, name]) => id !== threadId && name === title)) return unknown('codex-name-not-unique');
    if (this.foreground.packageIdentity !== CODEX_PACKAGE) return unknown('codex not foreground');
    const rows = [...this.codexThreads.values()].filter(value => value === title).length;
    return known({ matches: this.codexSelected !== null && this.codexThreads.get(this.codexSelected) === title, sameTitleRows: rows });
  }

  async composerFocused(client) {
    const pending = this.#enter('composerFocused', [client]);
    if (pending) return pending;
    if (this.composerUnknown) return unknown('no focus element');
    // Like the Windows adapter: a client that is not in front has no focused composer.
    const front = this.foreground.packageIdentity === (client === 'codex' ? CODEX_PACKAGE : CLAUDE_PACKAGE);
    return known(front && this.composer[client]);
  }

  async approvalVisible(client) { return this.#enter('approvalVisible', [client]) ?? this.approval[client]; }

  async codexArchived(threadId) {
    const pending = this.#enter('codexArchived', [threadId]);
    if (pending) return pending;
    return this.unknownArchive ? unknown('codex home unreadable') : known(this.codexArchivedIds.has(threadId));
  }

  async claudeSessions(localIds) {
    const pending = this.#enter('claudeSessions', [[...localIds]]);
    if (pending) return pending;
    if (this.claudeUnknown) return unknown('store unreadable');
    return known(localIds.filter(id => this.claudeRecords.has(id)).map(id => ({ ...this.claudeRecords.get(id) })));
  }

  /** Wheel notches the adapter applied, per call: [client, notches]. */
  scrolled = [];
  scrollUnknown = false;

  async scrollClient(client, notches) {
    const pending = this.#enter('scrollClient', [client, notches]);
    if (pending) return pending;
    if (this.scrollUnknown) return unknown('pointer position unknown');
    // Like the Windows adapter: wheel input only reaches a client that is in front.
    if (this.foreground.packageIdentity !== (client === 'codex' ? CODEX_PACKAGE : CLAUDE_PACKAGE)) return known(false);
    this.scrolled.push([client, notches]);
    return known(true);
  }

  /** Optional adapter extras the CLI uses when present. */
  warmUp = async () => { this.calls.push(['warmUp']); return { codex: '26.930.3930.0', claude: '2.19675.0.0' }; };
  releaseAllSync = () => { this.calls.push(['releaseAllSync']); this.held.clear(); };

  async close() { this.calls.push(['close']); this.held.clear(); }

  /** Keystrokes that would type Enter. */
  get enters() { return this.keys.filter(k => k.keys.includes('Enter')).length; }
  count(name) { return this.calls.filter(call => call[0] === name).length; }
}

/** Records LED frames and brightness sent to the bridge. */
export class FakeLights {
  frames = [];
  brightness = [];
  setLeds(colors) { this.frames.push(colors.map(c => [...c])); }
  setBrightness(percent) { this.brightness.push(percent); }
  get last() { return this.frames.at(-1); }
}

/**
 * A fake Hub for the feed client: serves snapshots and an SSE stream the test controls. Every request is recorded
 * with its method, path, query and headers.
 */
export class FakeHub {
  requests = [];
  sessions = [];
  revision = 1;
  version13 = true;
  snapshotStatus = 200;
  collector = 'running';
  /** When true, snapshot requests never answer. */
  hangSnapshots = false;
  streams = [];
  streamStatus = 200;

  fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.requests.push({ method: init.method ?? 'GET', path: url.pathname, search: url.search, headers, host: url.host });
    if (url.pathname === '/api/monitor/v1/sessions') {
      if (this.hangSnapshots) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted'))));
      const version = url.searchParams.get('snapshotVersion');
      if (version === '1.3' && !this.version13) return new Response(JSON.stringify({ error: { code: 'invalid-input' } }), { status: 400 });
      if (this.snapshotStatus !== 200) return new Response('{}', { status: this.snapshotStatus });
      const sessions = version === '1.3' ? this.sessions : this.sessions.map(({ hostSessionId: _, ...s }) => s);
      return new Response(JSON.stringify(envelope(sessions, { version, revision: this.revision, collector: this.collector })), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/monitor/v1/changes') {
      if (this.streamStatus !== 200) return new Response('', { status: this.streamStatus });
      let controller;
      const body = new ReadableStream({ start(c) { controller = c; } });
      const stream = {
        closed: false,
        send: text => { if (!stream.closed) controller.enqueue(new TextEncoder().encode(text)); },
        end: () => { if (!stream.closed) { stream.closed = true; controller.close(); } },
        error: error => { if (!stream.closed) { stream.closed = true; controller.error(error); } },
      };
      init.signal?.addEventListener('abort', () => stream.error(init.signal.reason ?? new Error('aborted')));
      this.streams.push(stream);
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('{}', { status: 404 });
  };

  get stream() { return this.streams.at(-1); }
  snapshotsRead() { return this.requests.filter(r => r.path === '/api/monitor/v1/sessions').length; }
  /** Sends one SSE notification as the Hub formats it. */
  notify(kind = 'state') { this.stream.send(`id: e:${this.revision}\nevent: ${kind}\ndata: {"revision":${this.revision}}\n\n`); }
  heartbeat() { this.stream.send(': heartbeat\n\n'); }
}
