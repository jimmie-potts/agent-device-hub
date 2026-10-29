// The Codex Desktop runtime module (Hub #926): Codex Desktop's read marker as read evidence in the runtime, as the old
// Hub's reader made it (`startDesktopRead` in apps/hub/src/codex-desktop.ts at main 8590332f). It follows the core's
// sessions, reads each configured source's marker every 2 s through its transport, read-only, and publishes a
// `read-observed` lifecycle observation to the core for each configured top-level Desktop session whose read state the
// marker changes. A source is read locally from its Codex home, or, without one, from a host-local collector's
// `desktop-metadata` snapshots over the bus (Hub #567, remote.ts); the rules are the same either way.
//
// Under policy A (ADR 0012) the marker's folder is the module's device. Start never waits on it. Evidence comes only
// from a read that answered. A read that does not answer within 5 s makes the marker unavailable, logged once with a
// summary while it lasts, and the next read waits for that one, so a stalled mount holds one reader, never more. A
// reader that fails is tried again with capped backoff. The module never fails for the folder, and its stop never waits
// on a read.
import {createHash} from 'node:crypto';
import {setImmediate as yieldToBus} from 'node:timers/promises';
import type {ErrorCode, Message} from '@jimmie-potts/event-contracts/v2';
import {sessionEntityId, type Identity, type Title, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {recordLog, DeviceAvailability, Outcome, errorType, type BunnyModule, type Cancel, type ModuleContext, type SyncedCopy} from '@jimmie-potts/sdk';
import {configureCodexDesktop, type CodexDesktopConfig, type DesktopSourceConfig} from './configuration.js';
import {readEvidence, readObservation, type Evidence} from './evidence.js';
import {DESKTOP_METADATA_KEYS, RemoteFeeds} from './remote.js';
import type {MarkerRead, MarkerTransport} from './transport.js';

export const MODULE_NAME = 'codex-desktop';
/** How often the marker is read, as the old Hub polled it. */
export const POLL_MS = 2000;
/** How long one read may take before the marker counts as unavailable. */
export const READ_TIMEOUT_MS = 5000;
/** The longest wait between reads after the reader failed. */
export const READ_BACKOFF_MAX_MS = 60_000;
/** How long evidence waits for its session's record to change before a later poll sends it again: the core may have refused it. */
export const RESEND_FIRST_MS = 4000;
/** The longest wait between two sends of the same evidence: the wait doubles each time the record stays the same. */
export const RESEND_MAX_MS = 60_000;
/** The marker's name in the module's records when one source is configured: the one thing the module reaches. */
export const MARKER_DEVICE = 'marker';
export const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
const SYNC_TIMEOUT_MS = 5000;
const RESYNC_FIRST_MS = 1000;
const RESYNC_MAX_MS = 60_000;
/** How many refused feed messages are logged, one per sender and feed, before the rest are counted silently. */
const MAX_REFUSALS_LOGGED = 64;

/** What the gateway shows of the module's settings: the producers it speaks for and how each is read, never a Codex home. */
const SETTINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    hostId: {type: 'string'}, sourceId: {type: 'string'},
    sources: {type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['hostId', 'sourceId', 'remote'],
      properties: {hostId: {type: 'string'}, sourceId: {type: 'string'}, remote: {type: 'boolean'}},
    }},
  },
} as const;

/** The settings shown: the released form as it was, and the `sources` form with each source's kind. */
const showSettings = (config: CodexDesktopConfig): Record<string, unknown> => {
  const [first] = config.sources;
  return config.legacy && first !== undefined ? {hostId: first.hostId, sourceId: first.sourceId}
    : {sources: config.sources.map(source => ({hostId: source.hostId, sourceId: source.sourceId, remote: source.home === undefined}))};
};

/** The longest device name the record contract carries (`bunny.device.id`). */
const MAX_DEVICE_NAME = 128;
/**
 * The device name of one source's marker in the module's records: `marker` alone when one source is configured,
 * `marker:<hostId>:<sourceId>` otherwise, or, when that would pass the contract's bound, `marker:` and 32 hex digits of
 * the pair's SHA-256, so two sources' outages never share a nameless record.
 */
export const markerDeviceOf = (source: DesktopSourceConfig, alone: boolean): string => {
  if (alone) return MARKER_DEVICE;
  const named = `${MARKER_DEVICE}:${source.hostId}:${source.sourceId}`;
  return named.length <= MAX_DEVICE_NAME ? named : `${MARKER_DEVICE}:${createHash('sha256').update(`${source.hostId}\0${source.sourceId}`, 'utf8').digest('hex').slice(0, 32)}`;
};

export type CodexDesktopModuleOptions = {
  /** How the module reads a local source's marker: `folderReader()` for the real Codex home, or a `SimulatedMarker`. */
  transport: MarkerTransport;
};

export function createCodexDesktopModule({transport}: CodexDesktopModuleOptions): BunnyModule<CodexDesktopConfig> {
  let started: ModuleStart | undefined;
  return {
    manifest: {
      name: MODULE_NAME, apiVersion: '1.2', configure: configureCodexDesktop,
      settings: {schema: SETTINGS_SCHEMA, show: showSettings},
    },
    async start(context) {
      // The runtime starts a module with `configure` only with what `configure` accepted.
      if (context.config === undefined) throw new Error('the Codex Desktop module started without its configuration');
      started = new ModuleStart(context, context.config, transport);
      await started.open();
    },
    async stop() {
      await started?.stop();
    },
  };
}

/** One start of the module, from `start` to `stop`: the shared copy of the core's sessions, and one run per source. */
class ModuleStart {
  readonly #context: ModuleContext<CodexDesktopConfig>;
  readonly #config: CodexDesktopConfig;
  readonly #transport: MarkerTransport;
  readonly #sessions: SessionFeed;
  readonly #feeds = new RemoteFeeds();
  readonly #runs: DesktopRun[] = [];
  /** The senders and feeds whose refusal was logged, bounded: the rest are refused silently. */
  readonly #refused = new Set<string>();

  constructor(context: ModuleContext<CodexDesktopConfig>, config: CodexDesktopConfig, transport: MarkerTransport) {
    this.#context = context;
    this.#config = config;
    this.#transport = transport;
    this.#sessions = new SessionFeed(context);
  }

  async open(): Promise<void> {
    const {clock} = this.#context;
    const alone = this.#config.sources.length === 1;
    this.#context.signal.addEventListener('abort', () => { this.#feeds.close(); }, {once: true});
    await this.#sessions.open();
    for (const source of this.#config.sources) {
      const transport = source.home === undefined ? this.#feeds.open(source, () => clock.now()) : this.#transport;
      const run = new DesktopRun(this.#context, source, transport, this.#sessions, markerDeviceOf(source, alone));
      this.#runs.push(run);
      run.open();
    }
    if (this.#feeds.size === 0) return;
    try {
      await this.#context.sdk.subscribe<Record<string, unknown>>(DESKTOP_METADATA_KEYS, message => { this.#deliver(message); });
    } catch {
      // The module is stopping, and its participant refuses use.
    }
  }

  async stop(): Promise<void> {
    this.#feeds.close();
    this.#sessions.close();
    await Promise.all(this.#runs.map(run => run.stop()));
    this.#transport.close();
  }

  /** A message on the feed keys: a configured source's snapshot, or a refusal logged once per sender and feed. */
  #deliver(message: Message): void {
    const refusal = this.#feeds.deliver(message);
    if (refusal === undefined) {
      this.#context.log.debug('message.received', {'bunny.operation': 'feed', 'bunny.outcome': Outcome.observed, 'bunny.message.id': message.id, 'bunny.message.kind': message.kind}, message);
      return;
    }
    if (refusal === 'stale') {
      // A late or repeated snapshot of a configured feed: a bounded polling condition, not a refusal to warn about.
      this.#context.log.debug('message.received', {'bunny.operation': 'feed', 'bunny.outcome': 'stale', 'bunny.message.id': message.id, 'bunny.message.kind': message.kind}, message);
      return;
    }
    const key = `${message.source} ${message.subject}`;
    if (this.#refused.has(key) || this.#refused.size >= MAX_REFUSALS_LOGGED) return;
    this.#refused.add(key);
    recordLog(this.#context.log, 'message.received', {'bunny.operation': 'feed', 'bunny.outcome': Outcome.rejected, 'bunny.code': refusal === 'unknown' ? 'not-found' : 'forbidden'}, message);
  }
}

/** The module's copy of the core's sessions, synced again with capped backoff when it is lost. */
class SessionFeed {
  readonly #context: ModuleContext<CodexDesktopConfig>;
  #copy: SyncedCopy<SessionRecord> | undefined;
  #resync: Cancel | undefined;
  #resyncDelayMs = RESYNC_FIRST_MS;
  #feedDown = false;
  #closing = false;

  constructor(context: ModuleContext<CodexDesktopConfig>) {
    this.#context = context;
  }

  /** The core's session records now, or none while the copy is lost. */
  states(): SessionRecord[] {
    return this.#copy?.states().map(message => message.data) ?? [];
  }

  /** The entity IDs of the sessions the copy holds now. */
  ids(): Set<string> {
    return new Set(this.#copy?.states().map(message => message.subject) ?? []);
  }

  get following(): boolean {
    return this.#copy !== undefined;
  }

  async open(): Promise<void> {
    this.#context.signal.addEventListener('abort', () => { this.close(); }, {once: true});
    await this.#follow();
  }

  close(): void {
    if (this.#closing) return;
    this.#closing = true;
    cancelQuietly(this.#resync);
  }

  /** Syncs the core's sessions. A sync the core refuses leaves no evidence, and the module syncs again later. */
  async #follow(): Promise<void> {
    if (this.#closing) return;
    this.#resync = undefined;
    let result;
    try {
      result = await this.#context.sdk.sync<SessionRecord>(['session'], change => {
        if (change.type !== 'failed') return;
        // The copy stopped following the core: no evidence until a new sync.
        this.#copy = undefined;
        this.#feedLost(change.error.error.code);
      }, {timeoutMs: SYNC_TIMEOUT_MS});
    } catch {
      // The module is stopping, and its participant refuses use.
      return;
    }
    if (result.status === 'rejected') {
      this.#feedLost(result.error.error.code);
      return;
    }
    this.#copy = result.copy;
    this.#resyncDelayMs = RESYNC_FIRST_MS;
    if (this.#feedDown) {
      this.#feedDown = false;
      recordLog(this.#context.log, 'operation.completed', {'bunny.operation': 'feed', 'bunny.outcome': Outcome.succeeded});
    }
  }

  #feedLost(code: ErrorCode): void {
    if (!this.#feedDown) {
      this.#feedDown = true;
      recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'feed', 'bunny.code': code});
    }
    if (this.#closing || this.#resync !== undefined) return;
    const delayMs = this.#resyncDelayMs;
    this.#resyncDelayMs = Math.min(RESYNC_MAX_MS, delayMs * 2);
    try {
      this.#resync = this.#context.scheduler.after(delayMs, () => {
        this.#follow().catch((error: unknown) => {
          recordLog(this.#context.log, 'operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
        });
      });
    } catch {
      // The module is stopping.
    }
  }
}

const cancelQuietly = (cancel: Cancel | undefined): void => {
  try {
    cancel?.();
  } catch {
    // A timer the runtime already cancelled.
  }
};

/** One source's run, from the module's start to its stop: its reads, its archive and title metadata and its read evidence. */
class DesktopRun {
  readonly #context: ModuleContext<CodexDesktopConfig>;
  readonly #source: DesktopSourceConfig;
  readonly #transport: MarkerTransport;
  readonly #sessions: SessionFeed;
  readonly #device: string;
  readonly #availability: DeviceAvailability;
  /** Publications under way, which the stop waits for. */
  readonly #work = new Set<Promise<void>>();
  #closing = false;
  // The marker.
  #poll: Cancel | undefined;
  /** Whether a read or its publications are under way: the next waits, keeping scans and evidence in order. */
  #reading = false;
  /** Whether the read under way has outlasted its deadline, so the marker is unavailable. */
  #overdue = false;
  /** Consecutive reads that failed, for the backoff. */
  #failures = 0;
  #stamp = '';
  /** The trace of the remote snapshot the last read came from, which the evidence it gives continues; none for a local read. */
  #parent: {traceparent: string} | undefined;
  /** When the last read's facts were current: a remote snapshot's receipt, or undefined for a local read, which is current now. */
  #readAtMs: number | undefined;
  readonly #archived = new Set<string>();
  /** Serialize paced batches, including deadline clears followed by a late reader answer. */
  #metadataWork: Promise<void> = Promise.resolve();
  readonly #metadataSent = new Map<string, {mark: string; atMs: number; waitMs: number}>();
  /** The unread threads of the last good read, or null when the marker gives no evidence now. */
  #unread: ReadonlySet<string> | null = null;
  /** Whether the last read found a usable marker, for logging each change once. */
  #usable: boolean | undefined;
  /**
   * The evidence last sent for each session, by its record's revision, when and how long it waits for the record to
   * change before it goes out again: the core may have refused it, and only the record says whether it took it.
   */
  readonly #sent = new Map<string, {mark: string; atMs: number; waitMs: number}>();

  constructor(context: ModuleContext<CodexDesktopConfig>, source: DesktopSourceConfig, transport: MarkerTransport, sessions: SessionFeed, device: string) {
    this.#context = context;
    this.#source = source;
    this.#transport = transport;
    this.#sessions = sessions;
    this.#device = device;
    this.#availability = new DeviceAvailability({log: context.log, clock: context.clock});
  }

  open(): void {
    this.#context.signal.addEventListener('abort', () => { this.#close(); }, {once: true});
    // The first read comes at once; start never waits for it.
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#close();
    while (this.#work.size > 0) await Promise.allSettled([...this.#work]);
  }

  #close(): void {
    if (this.#closing) return;
    this.#closing = true;
    cancelQuietly(this.#poll);
  }

  // The marker

  /** Sets the next poll, replacing any already set: one poll is ever pending. */
  #schedule(delayMs: number): void {
    cancelQuietly(this.#poll);
    this.#poll = undefined;
    if (this.#closing) return;
    try {
      this.#poll = this.#context.scheduler.after(delayMs, () => {
        this.#poll = undefined;
        this.#tick();
      });
    } catch {
      // The module is stopping, and its timers refuse use.
    }
  }

  /**
   * One poll: a read, unless one is under way. The next poll is set when the read ends, 2 s later, or later after
   * failures; a read past its deadline keeps the polls going, each one counted toward the outage's summary.
   */
  #tick(): void {
    if (this.#closing) return;
    if (!this.#reading) {
      this.#read();
      return;
    }
    if (this.#overdue) this.#availability.unreachable(this.#device, 'unavailable');
    this.#schedule(POLL_MS);
  }

  #read(): void {
    const {scheduler} = this.#context;
    this.#reading = true;
    let deadline: Cancel | undefined;
    try {
      deadline = scheduler.after(READ_TIMEOUT_MS, () => { this.#overdueRead(); });
    } catch {
      // The module is stopping.
    }
    let reading: Promise<MarkerRead>;
    try {
      reading = this.#transport.read(this.#source.home ?? '', this.#stamp);
    } catch (error) {
      reading = Promise.reject(error instanceof Error ? error : new Error('the marker could not be read'));
    }
    // Not tracked: a read on a stalled folder may never settle, and the stop never waits for one.
    const settled = (read: MarkerRead | undefined): void => {
      this.#track(this.#settled(deadline, read).finally(() => { this.#reading = false; }));
    };
    void reading.then(settled, () => { settled(undefined); }).catch((error: unknown) => {
      recordLog(this.#context.log, 'operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
    });
  }

  /**
   * The read under way outlasted its deadline: the marker is unavailable. Clear archive admission evidence;
   * read evidence still waits for a reader answer.
   */
  #overdueRead(): void {
    if (this.#closing || !this.#reading) return;
    this.#overdue = true;
    this.#track(this.#metadata(null, []));
    this.#availability.unreachable(this.#device, 'unavailable');
    this.#schedule(POLL_MS);
  }

  /** A read ended, with the marker's answer, or undefined when the reader failed. */
  async #settled(deadline: Cancel | undefined, read: MarkerRead | undefined): Promise<void> {
    cancelQuietly(deadline);
    this.#overdue = false;
    if (this.#closing) return;
    if (read === undefined) {
      this.#failures += 1;
      this.#stamp = '';
      this.#unread = null;
      await this.#metadata(null, []);
      this.#availability.unreachable(this.#device, 'unavailable');
      // After the nth failure in a row, the next read waits 2 s times 2 to the n, at most a minute.
      this.#schedule(Math.min(READ_BACKOFF_MAX_MS, POLL_MS * 2 ** this.#failures));
      return;
    }
    this.#failures = 0;
    this.#schedule(POLL_MS);
    this.#availability.reached(this.#device);
    this.#parent = read.parent;
    this.#readAtMs = read.readAtMs;
    switch (read.status) {
      case 'unchanged':
        break;
      case 'retry':
        // It changed while it was read: nothing now, and a new read next time.
        this.#stamp = '';
        this.#unread = null;
        break;
      case 'read':
        this.#stamp = read.stamp;
        this.#unread = read.unread === null ? null : new Set(read.unread);
        this.#usability(read.unread !== null);
        break;
    }
    await this.#metadata(read.archived ?? null, read.titles ?? []);
    if (!this.#closing) this.#evaluate();
  }

  /** Logs a change of the marker's usability once: unusable, it gives no evidence until it is usable again. */
  #usability(usable: boolean): void {
    if (this.#usable === usable) return;
    const before = this.#usable;
    this.#usable = usable;
    if (!usable) recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'lifecycle', 'bunny.outcome': 'unavailable', 'bunny.reason': 'invalid-input', 'bunny.device.id': this.#device});
    else if (before === false) recordLog(this.#context.log, 'operation.completed', {'bunny.operation': 'lifecycle', 'bunny.outcome': 'current', 'bunny.device.id': this.#device});
  }

  /** Metadata is independent of marker usability. Archive absence/unavailability clears earlier positives. */
  #metadata(archived: readonly string[] | null, titles: readonly {id: string; title: Title}[]): Promise<void> {
    const nowMs = this.#context.clock.now();
    const work = this.#metadataWork.then(() => this.#publishMetadataBatch(archived, titles, nowMs));
    this.#metadataWork = work.catch(() => {});
    return work;
  }

  async #publishMetadataBatch(archived: readonly string[] | null, titles: readonly {id: string; title: Title}[], nowMs: number): Promise<void> {
    if (this.#closing) return;
    const confirmed = new Set(archived ?? []);
    const identity = (sessionId: string): Identity => ({provider: 'codex', client: 'desktop', hostId: this.#source.hostId, sourceId: this.#source.sourceId, sessionId});
    for (const id of this.#archived) {
      if (this.#closing) return;
      if (!confirmed.has(id)) await this.#publishMetadata(identity(id), nowMs, undefined, false);
    }
    this.#archived.clear();
    for (const id of confirmed) {
      if (this.#closing) return;
      this.#archived.add(id);
      // Admission evidence has no session revision to acknowledge it: refresh on every successful poll.
      await this.#publishMetadata(identity(id), nowMs, undefined, true);
    }
    const indexed = new Map(titles.map(entry => [entry.id, entry.title]));
    for (const session of this.#sessions.states()) {
      if (this.#closing) return;
      if (!this.#owns(session)) continue;
      const title = indexed.get(session.identity.sessionId);
      if (title === undefined || title.value === session.title?.value && title.source === session.title.source) continue;
      const mark = JSON.stringify([session.revision, title]);
      const sent = this.#metadataSent.get(session.id);
      if (sent?.mark === mark && nowMs - sent.atMs < sent.waitMs) continue;
      this.#metadataSent.set(session.id, {mark, atMs: nowMs, waitMs: sent?.mark === mark ? Math.min(RESEND_MAX_MS, sent.waitMs * 2) : RESEND_FIRST_MS});
      await this.#publishMetadata(session.identity, nowMs, title);
    }
    const current = this.#sessions.ids();
    for (const id of this.#metadataSent.keys()) if (!current.has(id)) this.#metadataSent.delete(id);
  }

  /** Whether a session is one of this source's top-level Codex Desktop sessions. */
  #owns(session: SessionRecord): boolean {
    const {identity} = session;
    return identity.provider === 'codex' && identity.client === 'desktop' && identity.hostId === this.#source.hostId &&
      identity.sourceId === this.#source.sourceId && session.parent.status !== 'known';
  }

  /** A title/archive observation is no activity, read, end or notice evidence. */
  async #publishMetadata(identity: Identity, observedAtMs: number, title?: Title, archived?: boolean): Promise<void> {
    const id = sessionEntityId(identity);
    try {
      const message = await this.#context.sdk.publish(`bunny.event.lifecycle.${id}`, {
        kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject: id, dataschema: LIFECYCLE_SCHEMA,
        data: {identity, turn: {status: 'unknown'}, parent: {status: 'unknown'}, ordering: {status: 'unknown'}, observedAtMs,
          event: {kind: 'metadata-observed', ...(archived === undefined ? {} : {archived})}, ...(title === undefined ? {} : {title})},
      }, this.#parent === undefined ? undefined : {parent: this.#parent});
      this.#context.log.debug('lifecycle.observed', {'bunny.operation': 'lifecycle', 'bunny.message.id': message.id, 'bunny.message.kind': message.kind}, message);
    } catch { this.#metadataSent.delete(id); }
    // Publish acceptance is not delivery. Let the SDK's bounded subscriber queues drain before the next input.
    await yieldToBus();
  }

  // Evidence

  /**
   * Publishes the evidence the last read gives: at once for a new revision of a session's record, and again while that
   * revision stays the same, as after a core that refused it, 4 s later, then after a wait that doubles to a minute.
   */
  #evaluate(): void {
    const unread = this.#unread;
    if (unread === null || !this.#sessions.following) return;
    const sessions = this.#sessions.states();
    const current = new Set(sessions.map(session => session.id));
    for (const id of [...this.#sent.keys()]) if (!current.has(id)) this.#sent.delete(id);
    const nowMs = this.#context.clock.now();
    for (const evidence of readEvidence(sessions, unread, this.#source, nowMs, this.#readAtMs ?? nowMs)) {
      const mark = `${evidence.session.revision} ${evidence.state}`;
      const sent = this.#sent.get(evidence.session.id);
      if (sent?.mark === mark && nowMs - sent.atMs < sent.waitMs) continue;
      this.#sent.set(evidence.session.id, {mark, atMs: nowMs, waitMs: sent?.mark === mark ? Math.min(RESEND_MAX_MS, sent.waitMs * 2) : RESEND_FIRST_MS});
      this.#track(this.#publish(evidence, nowMs));
    }
  }

  /** One observation to the core, which starts its own trace. */
  async #publish(evidence: Evidence, nowMs: number): Promise<void> {
    const {id} = evidence.session;
    let message: Message;
    try {
      message = await this.#context.sdk.publish(`bunny.event.lifecycle.${id}`, {
        kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject: id, dataschema: LIFECYCLE_SCHEMA, data: readObservation(evidence, nowMs),
      }, this.#parent === undefined ? undefined : {parent: this.#parent});
    } catch {
      // The module is stopping, and its participant refuses use; the next start reads again.
      this.#sent.delete(id);
      return;
    }
    this.#context.log.debug('lifecycle.observed', {'bunny.operation': 'lifecycle', 'bunny.message.id': message.id, 'bunny.message.kind': message.kind}, message);
  }

  /** Work the module runs on its own. An error that escapes it is the module's fault: it is logged once, by type. */
  #track(work: Promise<void>): void {
    const tracked = work.catch((error: unknown) => {
      recordLog(this.#context.log, 'operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
    });
    this.#work.add(tracked);
    void tracked.finally(() => { this.#work.delete(tracked); });
  }
}
