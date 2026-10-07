// The Codex Desktop runtime module (Hub #926): Codex Desktop's read marker as read evidence in the runtime, as the old
// Hub's reader made it (`startDesktopRead` in apps/hub/src/codex-desktop.ts at main 8590332f). It follows the core's
// sessions, reads the marker every 2 s through its transport, read-only, and publishes a `read-observed` lifecycle
// observation to the core for each configured top-level Desktop session whose read state the marker changes.
//
// Under policy A (ADR 0012) the marker's folder is the module's device. Start never waits on it. Evidence comes only
// from a read that answered. A read that does not answer within 5 s makes the marker unavailable, logged once with a
// summary while it lasts, and the next read waits for that one, so a stalled mount holds one reader, never more. A
// reader that fails is tried again with capped backoff. The module never fails for the folder, and its stop never waits
// on a read.
import type {ErrorCode, Message} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {DeviceAvailability, errorType, type BunnyModule, type Cancel, type ModuleContext, type SyncedCopy} from '@jimmie-potts/sdk';
import {configureCodexDesktop, type CodexDesktopConfig} from './configuration.js';
import {readEvidence, readObservation, type Evidence} from './evidence.js';
import type {MarkerRead, MarkerTransport} from './transport.js';

export const MODULE_NAME = 'codex-desktop';
/** How often the marker is read, as the old Hub polled it. */
export const POLL_MS = 2000;
/** How long one read may take before the marker counts as unavailable. */
export const READ_TIMEOUT_MS = 5000;
/** The longest wait between reads after the reader failed. */
export const READ_BACKOFF_MAX_MS = 60_000;
/** The marker's name in the module's records: the one thing the module reaches. */
export const MARKER_DEVICE = 'marker';
export const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
const SYNC_TIMEOUT_MS = 5000;
const RESYNC_FIRST_MS = 1000;
const RESYNC_MAX_MS = 60_000;

/** What the gateway shows of the module's settings: the producer it speaks for, never the Codex home's path. */
const SETTINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['hostId', 'sourceId'],
  properties: {hostId: {type: 'string'}, sourceId: {type: 'string'}},
} as const;

export type CodexDesktopModuleOptions = {
  /** How the module reads the marker: `folderReader()` for the real Codex home, or a `SimulatedMarker`. */
  transport: MarkerTransport;
};

export function createCodexDesktopModule({transport}: CodexDesktopModuleOptions): BunnyModule<CodexDesktopConfig> {
  let run: DesktopRun | undefined;
  return {
    manifest: {
      name: MODULE_NAME, apiVersion: '1.2', configure: configureCodexDesktop,
      settings: {schema: SETTINGS_SCHEMA, show: config => ({hostId: config.hostId, sourceId: config.sourceId})},
    },
    async start(context) {
      // The runtime starts a module with `configure` only with what `configure` accepted.
      if (context.config === undefined) throw new Error('the Codex Desktop module started without its configuration');
      run = new DesktopRun(context, context.config, transport);
      await run.open();
    },
    async stop() {
      await run?.stop();
    },
  };
}

/** One start of the module, from `start` to `stop`. */
class DesktopRun {
  readonly #context: ModuleContext<CodexDesktopConfig>;
  readonly #config: CodexDesktopConfig;
  readonly #transport: MarkerTransport;
  readonly #availability: DeviceAvailability;
  /** Publications under way, which the stop waits for. */
  readonly #work = new Set<Promise<void>>();
  #closing = false;
  // The core's sessions.
  #copy: SyncedCopy<SessionRecord> | undefined;
  #resync: Cancel | undefined;
  #resyncDelayMs = RESYNC_FIRST_MS;
  #feedDown = false;
  // The marker.
  #poll: Cancel | undefined;
  /** Whether a read is under way: the next waits for it, so a stalled folder holds one read at most. */
  #reading = false;
  /** Whether the read under way has outlasted its deadline, so the marker is unavailable. */
  #overdue = false;
  /** Consecutive reads that failed, for the backoff. */
  #failures = 0;
  #stamp = '';
  /** The unread threads of the last good read, or null when the marker gives no evidence now. */
  #unread: ReadonlySet<string> | null = null;
  /** Whether the last read found a usable marker, for logging each change once. */
  #usable: boolean | undefined;
  /** The evidence published for each session, by its record's revision, so a record that does not change gets it once. */
  readonly #published = new Map<string, string>();

  constructor(context: ModuleContext<CodexDesktopConfig>, config: CodexDesktopConfig, transport: MarkerTransport) {
    this.#context = context;
    this.#config = config;
    this.#transport = transport;
    this.#availability = new DeviceAvailability({log: context.log, clock: context.clock});
  }

  async open(): Promise<void> {
    this.#context.signal.addEventListener('abort', () => { this.#close(); }, {once: true});
    await this.#follow();
    // The first read comes at once; start never waits for it.
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#close();
    while (this.#work.size > 0) await Promise.allSettled([...this.#work]);
    this.#transport.close();
  }

  #close(): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#cancel(this.#poll);
    this.#cancel(this.#resync);
  }

  #cancel(cancel: Cancel | undefined): void {
    try {
      cancel?.();
    } catch {
      // A timer the runtime already cancelled.
    }
  }

  // The core's sessions

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
      this.#context.log.info('operation.completed', {'bunny.operation': 'feed', 'bunny.outcome': 'succeeded'});
    }
  }

  #feedLost(code: ErrorCode): void {
    if (!this.#feedDown) {
      this.#feedDown = true;
      this.#context.log.warn('operation.failed', {'bunny.operation': 'feed', 'bunny.code': code});
    }
    if (this.#closing || this.#resync !== undefined) return;
    const delayMs = this.#resyncDelayMs;
    this.#resyncDelayMs = Math.min(RESYNC_MAX_MS, delayMs * 2);
    try {
      this.#resync = this.#context.scheduler.after(delayMs, () => { this.#track(this.#follow()); });
    } catch {
      // The module is stopping.
    }
  }

  // The marker

  /** Sets the next poll, replacing any already set: one poll is ever pending. */
  #schedule(delayMs: number): void {
    this.#cancel(this.#poll);
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
    if (this.#overdue) this.#availability.unreachable(MARKER_DEVICE, 'unavailable');
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
      reading = this.#transport.read(this.#config.home, this.#stamp);
    } catch (error) {
      reading = Promise.reject(error instanceof Error ? error : new Error('the marker could not be read'));
    }
    // Not tracked: a read on a stalled folder may never settle, and the stop never waits for one.
    void reading.then(read => { this.#settled(deadline, read); }, () => { this.#settled(deadline, undefined); }).catch((error: unknown) => {
      this.#context.log.error('operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
    });
  }

  /**
   * The read under way outlasted its deadline: the marker is unavailable. Evidence comes only from a read that answered,
   * so nothing is published until this one does.
   */
  #overdueRead(): void {
    if (this.#closing || !this.#reading) return;
    this.#overdue = true;
    this.#availability.unreachable(MARKER_DEVICE, 'unavailable');
    this.#schedule(POLL_MS);
  }

  /** A read ended, with the marker's answer, or undefined when the reader failed. */
  #settled(deadline: Cancel | undefined, read: MarkerRead | undefined): void {
    this.#cancel(deadline);
    this.#reading = false;
    this.#overdue = false;
    if (this.#closing) return;
    if (read === undefined) {
      this.#failures += 1;
      this.#stamp = '';
      this.#unread = null;
      this.#availability.unreachable(MARKER_DEVICE, 'unavailable');
      // After the nth failure in a row, the next read waits 2 s times 2 to the n, at most a minute.
      this.#schedule(Math.min(READ_BACKOFF_MAX_MS, POLL_MS * 2 ** this.#failures));
      return;
    }
    this.#failures = 0;
    this.#schedule(POLL_MS);
    this.#availability.reached(MARKER_DEVICE);
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
    this.#evaluate();
  }

  /** Logs a change of the marker's usability once: unusable, it gives no evidence until it is usable again. */
  #usability(usable: boolean): void {
    if (this.#usable === usable) return;
    const before = this.#usable;
    this.#usable = usable;
    if (!usable) this.#context.log.warn('operation.failed', {'bunny.operation': 'lifecycle', 'bunny.outcome': 'unavailable', 'bunny.reason': 'invalid-input'});
    else if (before === false) this.#context.log.info('operation.completed', {'bunny.operation': 'lifecycle', 'bunny.outcome': 'current'});
  }

  // Evidence

  /** Publishes the evidence the last read gives, once for each session record's revision. */
  #evaluate(): void {
    const unread = this.#unread;
    const copy = this.#copy;
    if (unread === null || copy === undefined) return;
    const sessions = copy.states().map(message => message.data);
    const current = new Set(sessions.map(session => session.id));
    for (const id of [...this.#published.keys()]) if (!current.has(id)) this.#published.delete(id);
    const nowMs = this.#context.clock.now();
    for (const evidence of readEvidence(sessions, unread, this.#config, nowMs)) {
      const mark = `${evidence.session.revision} ${evidence.state}`;
      if (this.#published.get(evidence.session.id) === mark) continue;
      this.#published.set(evidence.session.id, mark);
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
      });
    } catch {
      // The module is stopping, and its participant refuses use; the next start reads again.
      this.#published.delete(id);
      return;
    }
    this.#context.log.debug('lifecycle.observed', {'bunny.operation': 'lifecycle', 'bunny.message.id': message.id, 'bunny.message.kind': message.kind}, message);
  }

  /** Work the module runs on its own. An error that escapes it is the module's fault: it is logged once, by type. */
  #track(work: Promise<void>): void {
    const tracked = work.catch((error: unknown) => {
      this.#context.log.error('operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
    });
    this.#work.add(tracked);
    void tracked.finally(() => { this.#work.delete(tracked); });
  }
}
