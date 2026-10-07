// The agent-session core (Hub #831, ADR 0012): the one owner of agent sessions in the runtime, as the source `bunny/core`.
// It runs agent-state's owner on the core store, takes hooks' 2.0 `lifecycle` observations into the reducer, publishes
// each committed change as `session` state, removal and occurrence messages, serves `session` through sync and answers
// `notice-acknowledge`. It is first in the runtime's module list and registers everything on the bus before its first
// await, so a module that starts after it syncs from it, or republishes to it, finds it listening (#882). Parts of the
// core that later stories add (#782's tracker and history, #923's inbox) join through `CorePart`.
import type {DatabaseSync} from 'node:sqlite';
import {createAgentState, type Consumer, type Outcome} from '@jimmie-potts/agent-state';
import {MessageValidator, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  registerCoreFamilies, sessionEntityId, type LifecycleObservation, type NoticeAcknowledgeRequest, type SessionRecord,
} from '@jimmie-potts/event-contracts/v2/families';
import {
  SdkError, type BunnyModule, type Cancel, type Clock, type Command, type LogFields, type Logger, type ModuleContext, type ModuleScheduler, type Reply,
  type Sdk, type Snapshot, type StateDraft, type SyncRequest,
} from '@jimmie-potts/sdk';
import {CORE_MODULE} from '../host.js';
import {LIFECYCLE_TYPE, SESSION_SCHEMA, reducedKind, toEnvelope} from './mapping.js';
import {CoreStore, type CoreTransaction, type Deriver} from './store.js';

export {CORE_MODULE};
/** The agent-state owner ID the core persists with its store. */
export const OWNER_ID = 'bunny-core';
/**
 * The consumers whose notice acknowledgments the core records, and whether a new turn clears a consumer's earlier
 * notices: the old Hub's integrated verification set. agent-state persists the list with the store and refuses a store
 * whose list differs, so it changes only with an explicit migration.
 */
export const DEFAULT_CONSUMERS: readonly Consumer[] = Object.freeze([
  {id: 'dashboard', clearOnNewTurn: false}, {id: 'nanoleaf', clearOnNewTurn: true}, {id: 'pixoo', clearOnNewTurn: true},
]);
/**
 * The first wait before the core tries again after a failed commit, to publish freshness or to open its owner; each
 * further failure doubles it, up to `RETRY_MAX_MS`.
 */
export const REFRESH_RETRY_MS = 1000;
export const RETRY_MAX_MS = 60_000;
/** While the store keeps failing, the core summarizes the condition at most this often (ADR 0012, "Repetition"). */
export const SUMMARY_MS = 60_000;
const MAX_DELAY_MS = 2_147_483_647;
const MAX_DURATION_MS = 86_400_000;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** What the core gives one of its parts. */
export interface CoreHandle {
  /** The core's participant, `bunny/core`. */
  readonly sdk: Sdk;
  readonly log: Logger;
  readonly clock: Clock;
  /** Resolves once the core's store and owner are open. */
  readonly ready: Promise<void>;
  /** How the core took a message with this `(source, id)` before: `new`, an exact `duplicate`, or a `conflict`. */
  received(message: Message<unknown>): 'new' | 'duplicate' | 'conflict';
  /** Runs `work` in one transaction of the core store, once it is open; its messages go out after the commit. */
  transaction<R>(work: (tx: CoreTransaction) => R): Promise<R>;
}

/**
 * A part of the core with rows of its own in the core store: the extension point for Hub #782's tracker and history and
 * #923's inbox. Its changes commit in the core store's transactions and go out through the core's outbox.
 */
export interface CorePart {
  /** The families it serves through the core's sync. Their records use the core's revision. */
  readonly families?: readonly string[];
  /** Creates its tables, once the core holds its store. */
  open?(database: DatabaseSync): void;
  /** Its current states of the requested families, for a sync. */
  states?(families: readonly string[]): StateDraft[];
  /** Rows it derives from each committed core change, in that change's transaction. */
  readonly derive?: Deriver;
  /** Starts its own intake on the core's participant. The core calls it before its first await. */
  start?(core: CoreHandle): Promise<unknown>;
}

export type CoreOptions = {
  /** The parts that later stories add, and test stand-ins for them. */
  parts?: readonly CorePart[];
  /** The consumers acknowledgments are recorded for. Defaults to `DEFAULT_CONSUMERS`. */
  consumers?: readonly Consumer[];
  /** Runs right after each commit, before anything is published. Crash tests kill the process here. */
  beforePublish?: () => void;
};

/** The consumer a source may acknowledge for: the last segment of its source, such as `pixoo` for `bunny/modules/pixoo`. */
export const consumerOf = (source: string): string => source.slice(source.lastIndexOf('/') + 1);

type AgentState = Awaited<ReturnType<typeof createAgentState>>;
type Refusal = {code: ErrorCode; detail: string};

/** Each registry code's registered reason, as the runtime's records name it (src/runtime.ts `REGISTRY_REASONS`). */
const REASONS: Partial<Record<ErrorCode, string>> = {
  'invalid-request': 'invalid-input', 'invalid-message': 'invalid-input', 'too-large': 'oversize', 'unsupported-version': 'unsupported-version',
  'unknown-schema': 'invalid-input', 'not-found': 'invalid-input', 'forbidden': 'unauthorized', 'duplicate-conflict': 'duplicate',
  'capacity': 'busy', 'unavailable': 'unavailable',
};
const refused = (code: ErrorCode): LogFields => ({'bunny.outcome': 'rejected', 'bunny.code': code, ...(REASONS[code] === undefined ? {} : {'bunny.reason': REASONS[code]})});
const requestField = (requestId: unknown): LogFields => typeof requestId === 'string' && REQUEST_ID.test(requestId) ? {'bunny.request.id': requestId} : {};
const MESSAGE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SOURCE = /^bunny(?:\/[a-z0-9][a-z0-9-]*)+$/;
const KINDS: readonly string[] = ['state', 'removal', 'occurrence', 'command', 'reply', 'outcome', 'sync-request', 'sync-completed'];
/** A received message's identifying fields, each only when it is well formed, so a refused message's record is still written. */
const messageFields = (message: Message<unknown>): LogFields => ({
  ...(typeof message.source === 'string' && SOURCE.test(message.source) && message.source.length <= 256 ? {'bunny.participant': message.source} : {}),
  ...(typeof message.id === 'string' && MESSAGE_ID.test(message.id) ? {'bunny.message.id': message.id} : {}),
  ...(typeof message.kind === 'string' && KINDS.includes(message.kind) ? {'bunny.message.kind': message.kind} : {}),
});

/** A capped, doubling wait between attempts. A first wait of 0 would retry at once, every time. */
class Backoff {
  readonly #first: number;
  readonly #max: number;
  #delay = 0;
  #next = 0;
  #pending = false;

  constructor(first: number, max: number) {
    this.#first = first;
    this.#max = max;
  }

  /** Whether an attempt failed and the next one waits. */
  get pending(): boolean {
    return this.#pending;
  }

  /** When the next attempt is due. */
  get next(): number {
    return this.#next;
  }

  failed(now: number): void {
    this.#delay = this.#pending ? Math.min(this.#max, this.#delay * 2) : this.#first;
    this.#next = now + this.#delay;
    this.#pending = true;
  }

  ready(now: number): boolean {
    return !this.#pending || now >= this.#next;
  }

  reset(): void {
    this.#pending = false;
    this.#delay = 0;
  }
}

/** The core as a module of the runtime's fixed list. Its `create` and `simulate` are the same: it reaches no device. */
export function createCoreModule(options: CoreOptions = {}): BunnyModule {
  let core: Core | undefined;
  return {
    manifest: {name: CORE_MODULE, apiVersion: '1.0'},
    start: context => {
      core = new Core(context, options);
      return core.start();
    },
    stop: () => core?.stop(),
  };
}

class Core {
  readonly #sdk: Sdk;
  readonly #log: Logger;
  readonly #clock: Clock;
  readonly #scheduler: ModuleScheduler;
  readonly #store: CoreStore;
  readonly #parts: readonly CorePart[];
  readonly #consumers: readonly Consumer[];
  readonly #validator = new MessageValidator();
  readonly #ready: Promise<void>;
  #opened: () => void = () => {};
  #failed: (error: unknown) => void = () => {};
  #owner: AgentState | undefined;
  /** Why the owner is not open, while it is not, and when to try again. */
  #ownerDown: ErrorCode = 'unavailable';
  readonly #reopen = new Backoff(REFRESH_RETRY_MS, RETRY_MAX_MS);
  readonly #freshness = new Backoff(REFRESH_RETRY_MS, RETRY_MAX_MS);
  /** Since when the store has refused durable work, and when that was last summarized. */
  #degradedSince: number | undefined;
  #summarizedAt = 0;
  /** The core's own operations run one at a time, so each commit is the reduction of the one observation under way. */
  #queue: Promise<unknown> = Promise.resolve();
  #timer: Cancel | undefined;
  #stopped = false;
  /** The start under way, which a stop waits for so that an owner it opens late is shut down too. */
  #starting: Promise<void> | undefined;

  constructor(context: ModuleContext, {parts = [], consumers = DEFAULT_CONSUMERS, beforePublish}: CoreOptions) {
    this.#sdk = context.sdk;
    this.#log = context.log;
    this.#clock = context.clock;
    this.#scheduler = context.scheduler;
    this.#parts = parts;
    this.#consumers = consumers;
    registerCoreFamilies(this.#validator);
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#opened = resolve;
      this.#failed = reject;
    });
    // A start that fails leaves the handlers waiting on `ready` to fail with it, not an unhandled rejection.
    this.#ready.catch(() => {});
    this.#store = new CoreStore({
      database: context.database(), sdk: context.sdk, clock: context.clock,
      derivers: parts.flatMap(part => part.derive ?? []),
      open: parts.flatMap(part => part.open === undefined ? [] : [(database: DatabaseSync) => { part.open?.(database); }]),
      ...(beforePublish === undefined ? {} : {beforePublish}),
      // Committed is not published (ADR 0012): the change stands, and its messages go out at the next commit or start.
      onError: error => {
        const code = error instanceof SdkError ? error.body.error.code : 'internal';
        this.#log.warn('operation.failed', {'bunny.operation': 'feed', 'bunny.outcome': 'queued', 'bunny.code': code});
      },
    });
  }

  start(): Promise<void> {
    // Everything registers before the first await: the runtime runs the next module's start once this one awaits.
    const handle: CoreHandle = {
      sdk: this.#sdk, log: this.#log, clock: this.#clock, ready: this.#ready,
      received: message => this.#store.received(message),
      transaction: async work => {
        await this.#ready;
        return this.#store.transaction(work);
      },
    };
    const families = ['session', ...this.#parts.flatMap(part => part.families ?? [])];
    const registered: Promise<unknown>[] = [
      this.#sdk.serveSync(families, request => this.#serve(request)),
      this.#sdk.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => this.#observe(message)),
      this.#sdk.respond<NoticeAcknowledgeRequest>('bunny.cmd.notice-acknowledge.*', command => this.#acknowledge(command)),
      ...this.#parts.flatMap(part => part.start?.(handle) ?? []),
    ];
    this.#starting = (async () => {
      try {
        await Promise.all(registered);
        try {
          await this.#open();
        } catch (error) {
          // A full disk at the start, as when maintenance fell due, leaves the core up, refusing durable work until it
          // has room. Anything else, such as a store it cannot read or a lease another runtime holds, fails it.
          if (this.#store.takeFailure() !== 'full') throw error;
          this.#ownerFailed('capacity');
        }
        // A stop that came meanwhile shuts the owner down; whatever waits on `ready` finds the core stopped.
        if (this.#stopped) {
          this.#opened();
          return;
        }
        // A restart leaves every stored session uncertain until fresh evidence, and the records say so at once. If the
        // store refuses, syncs answer `unavailable` until a later refresh succeeds.
        await this.#refresh();
        // What a crash kept from going out goes out now, with its stored `id` and `time`.
        await this.#store.republish().catch(() => {
          // Whatever was not sent stays stored, and goes out with the next commit.
        });
        this.#opened();
        this.#schedule();
      } catch (error) {
        this.#failed(error);
        throw error;
      }
    })();
    return this.#starting;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#timer?.();
    await this.#starting?.catch(() => {});
    this.#timer?.();
    await this.#queue;
    const owner = this.#owner;
    this.#owner = undefined;
    await owner?.shutdown().catch(() => {});
    await this.#store.drain();
    this.#store.close();
  }

  /** Runs one of the core's operations after those before it. */
  #run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #open(): Promise<void> {
    this.#owner = await createAgentState({storage: this.#store, ownerId: OWNER_ID, consumers: this.#consumers.map(consumer => ({...consumer})), clock: () => this.#clock.now()});
    this.#reopen.reset();
  }

  /** The owner could not be opened: refuse with `code` meanwhile, and try again after a capped backoff. */
  #ownerFailed(code: ErrorCode): void {
    this.#ownerDown = code;
    this.#reopen.failed(this.#clock.now());
    this.#degraded(code);
  }

  /**
   * The open owner, or why there is none. After a commit that failed, as on a full disk, agent-state's owner is faulted;
   * the core opens it again on the store, which keeps its lock throughout and holds exactly what committed. Opening
   * writes nothing unless maintenance fell due; if it fails, the core stays up and tries again after a capped backoff.
   */
  async #ensureOwner(): Promise<AgentState | Refusal> {
    if (this.#owner !== undefined) return this.#owner;
    const refusal = (): Refusal => ({code: this.#ownerDown, detail: this.#ownerDown === 'capacity' ? 'the core store is full' : 'the core is not taking changes now'});
    if (!this.#reopen.ready(this.#clock.now())) return refusal();
    try {
      await this.#open();
    } catch {
      this.#ownerFailed(this.#store.takeFailure() === 'full' ? 'capacity' : 'unavailable');
      this.#log.debug('operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': 'unavailable', 'bunny.code': this.#ownerDown});
      return refusal();
    }
    return this.#owner ?? refusal();
  }

  /** Calls the owner, mapping a refusal to the registry's terms, and opens a faulted owner again. */
  async #call(work: (owner: AgentState) => Promise<Outcome>): Promise<Extract<Outcome, {ok: true}> | {ok: false; refusal: Refusal}> {
    if (this.#stopped) return {ok: false, refusal: {code: 'unavailable', detail: 'the core is stopping'}};
    const owner = await this.#ensureOwner();
    if (!('ingest' in owner)) return {ok: false, refusal: owner};
    const result = await work(owner);
    if (result.ok) {
      if (result.outcome === 'applied' || result.outcome === 'ambiguous') this.#recovered();
      return result;
    }
    const refusal = this.#refusal(result);
    if ((result.code === 'storage-failed' || result.code === 'unavailable') && !this.#stopped) {
      if (result.code === 'storage-failed') this.#degraded(refusal.code);
      // The faulted owner lets go of its lease only: the store keeps its lock, so no other runtime can take it.
      this.#owner = undefined;
      await owner.shutdown().catch(() => {});
      this.#store.abandonLease();
      await this.#ensureOwner();
    }
    return {ok: false, refusal};
  }

  /** Why a refused owner call was refused, in the registry's terms. */
  #refusal(result: Extract<Outcome, {ok: false}>): Refusal {
    switch (result.code) {
      case 'capacity':
        return {code: 'capacity', detail: 'the core holds as many sessions as it can'};
      case 'storage-failed':
        // Nothing committed: the store refused the change before anything reported it accepted.
        return this.#store.takeFailure() === 'full' ? {code: 'capacity', detail: 'the core store is full'} : {code: 'internal', detail: 'the core store failed'};
      case 'unavailable':
        // A faulted owner: its own maintenance may have failed on a full disk.
        return this.#store.takeFailure() === 'full' ? {code: 'capacity', detail: 'the core store is full'} : {code: 'unavailable', detail: 'the core is not taking changes now'};
      case 'invalid-event':
        return {code: 'invalid-request', detail: 'the observation is not one the core admits'};
      case 'invalid-operation':
        return {code: 'not-found', detail: 'no such session or notice'};
      case 'revision-conflict':
        return {code: 'revision-conflict', detail: 'the core changed meanwhile'};
    }
  }

  /**
   * The store refused durable work. Repeated failures log their transition, then a summary at most once a minute
   * (ADR 0012, "Repetition"), never a record per attempt above DEBUG.
   */
  #degraded(code: ErrorCode): void {
    const now = this.#clock.now();
    const fields = {'bunny.operation': 'storage', 'bunny.outcome': 'unavailable', 'bunny.code': code};
    const record = (extra: LogFields = {}): void => {
      if (code === 'internal') this.#log.error('operation.failed', {...fields, ...extra});
      else this.#log.warn('operation.failed', {...fields, ...extra});
    };
    if (this.#degradedSince === undefined) {
      this.#degradedSince = now;
      this.#summarizedAt = now;
      record();
      return;
    }
    if (now - this.#summarizedAt < SUMMARY_MS) return;
    this.#summarizedAt = now;
    record({'bunny.duration_ms': Math.min(MAX_DURATION_MS, Math.max(0, now - this.#degradedSince))});
  }

  /** A durable change committed again: the condition ends, with one record. */
  #recovered(): void {
    if (this.#degradedSince === undefined) return;
    const duration = Math.min(MAX_DURATION_MS, Math.max(0, this.#clock.now() - this.#degradedSince));
    this.#degradedSince = undefined;
    this.#log.info('operation.completed', {'bunny.operation': 'storage', 'bunny.outcome': 'current', 'bunny.duration_ms': duration});
  }

  /**
   * Brings freshness up to date. A refusal is not fatal: the next attempt waits a capped, doubling backoff, and each one
   * is logged at DEBUG only. True when the records are up to date.
   */
  async #refresh(): Promise<boolean> {
    try {
      if (await this.#store.refresh()) this.#recovered();
      this.#freshness.reset();
      return true;
    } catch {
      this.#freshness.failed(this.#clock.now());
      this.#degraded(this.#store.takeFailure() === 'full' ? 'capacity' : 'unavailable');
      this.#log.debug('operation.failed', {'bunny.operation': 'status', 'bunny.outcome': 'unavailable'});
      return false;
    }
  }

  /** Takes one hook observation into the reducer, once by `(source, id)`. */
  async #observe(message: Message<LifecycleObservation>): Promise<void> {
    await this.#ready;
    if (this.#stopped) return;
    await this.#run(async () => {
      const fields: LogFields = {...messageFields(message), 'bunny.operation': 'lifecycle'};
      // The bus does not check messages; a remote edge has, but an in-process sender may not have. A refused message's
      // record carries only its well-formed fields and no trace, so the record is still written.
      const checked = this.#validator.validate(message);
      if (!checked.ok || message.type !== LIFECYCLE_TYPE) {
        this.#log.info('message.received', {...fields, ...refused(checked.ok ? 'invalid-message' : checked.error.code)});
        return;
      }
      const verdict = this.#store.received(message);
      if (verdict === 'duplicate') {
        this.#log.debug('message.received', {...fields, 'bunny.outcome': 'duplicate'}, message);
        return;
      }
      if (verdict === 'conflict') {
        this.#log.warn('message.received', {...fields, ...refused('duplicate-conflict')}, message);
        return;
      }
      const observation = message.data;
      const cause = {message, kind: reducedKind(observation), entity: sessionEntityId(observation.identity), observation};
      const result = await this.#store.during(cause, () => this.#call(owner => owner.ingest(toEnvelope(observation))));
      if (result.ok) {
        const outcome = result.outcome === 'duplicate' ? 'duplicate' : result.outcome === 'stale' ? 'stale' : 'accepted';
        const record = {...fields, 'bunny.outcome': outcome, 'bunny.state.revision': this.#store.revision, ...(outcome === 'stale' ? {'bunny.reason': 'stale'} : {})};
        if (outcome === 'duplicate') this.#log.debug('message.received', record, message);
        else this.#log.info('message.received', record, message);
      } else {
        // A refusal is a domain outcome; a store that keeps refusing is the condition `#degraded` records.
        this.#log.info('message.received', {...fields, ...refused(result.refusal.code)}, message);
      }
      this.#schedule();
    });
  }

  /**
   * Answers `notice-acknowledge` (#918) through agent-state's `acknowledge`. A consumer acknowledges for itself only: its
   * source's last segment must be the consumer ID. The acknowledgment commits before the reply, so `accepted` reports a
   * committed change; the session's state at its new revision is its evidence, and no outcome follows.
   */
  async #acknowledge(command: Command<NoticeAcknowledgeRequest>): Promise<Reply> {
    await this.#ready;
    if (this.#stopped) return errorBody('unavailable', {detail: 'the core is stopping'});
    return this.#run(async () => {
      const {requestId, consumerId, noticeId} = command.data;
      const fields: LogFields = {'bunny.participant': command.source, 'bunny.operation': 'status', ...requestField(requestId)};
      const refuse = (code: ErrorCode, detail: string): ErrorBody => {
        // A correct consumer never sends one for another; the store's own condition is recorded by `#degraded`.
        if (code === 'forbidden') this.#log.warn('command.rejected', {...fields, ...refused(code)}, command);
        else this.#log.info('command.rejected', {...fields, ...refused(code)}, command);
        return errorBody(code, {detail});
      };
      const checked = this.#validator.validate(command);
      if (!checked.ok) return refuse(checked.error.code, 'the acknowledgment is not a valid notice-acknowledge command');
      if (!this.#consumers.some(consumer => consumer.id === consumerId)) return refuse('invalid-request', 'no such consumer');
      if (consumerOf(command.source) !== consumerId) return refuse('forbidden', 'a consumer acknowledges notices for itself only');
      const record: SessionRecord | undefined = this.#store.records().find(item => item.id === command.subject);
      if (record === undefined) return refuse('not-found', 'no such session');
      if (!record.notices.some(notice => notice.id === noticeId)) return refuse('not-found', 'no such notice');
      // The session's new revision joins the command's trace.
      const cause = {message: command, kind: 'notice.acknowledged', entity: record.id};
      const result = await this.#store.during(cause, () => this.#call(owner => owner.acknowledge(record.identity, noticeId, consumerId)));
      if (!result.ok) return refuse(result.refusal.code, result.refusal.detail);
      this.#log.info('command.completed', {...fields, 'bunny.outcome': result.outcome === 'duplicate' ? 'duplicate' : 'accepted', 'bunny.state.revision': this.#store.revision}, command);
      return {status: 'accepted'};
    });
  }

  /**
   * Serves a sync: the core's records at its revision. Freshness is brought up to date first, at a new revision when it
   * changed, so each record's freshness holds at the sync's time.
   */
  async #serve(request: Message<SyncRequest>): Promise<Snapshot | ErrorBody> {
    await this.#ready;
    if (this.#stopped) return errorBody('unavailable', {detail: 'the core is stopping'});
    return this.#run(async () => {
      if (!await this.#refresh()) {
        this.#schedule();
        return errorBody('unavailable', {detail: 'the core cannot bring its sessions up to date now'});
      }
      this.#schedule();
      const {families} = request.data;
      const states: StateDraft[] = families.includes('session') ? this.#store.records().map(record => ({
        type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record,
      })) : [];
      for (const part of this.#parts) {
        if ((part.families ?? []).some(family => families.includes(family))) states.push(...part.states?.(families) ?? []);
      }
      return {revision: this.#store.revision, states};
    });
  }

  /**
   * Publishes freshness when the next current record turns uncertain, at a new revision (MAPPING.md, `freshness`). After
   * a refresh the store refused, the next attempt waits its backoff instead.
   */
  #schedule(): void {
    this.#timer?.();
    this.#timer = undefined;
    if (this.#stopped) return;
    const at = this.#freshness.pending ? this.#freshness.next : this.#store.nextTurn();
    if (at === undefined) return;
    const delay = Math.min(MAX_DELAY_MS, Math.max(0, at - this.#clock.now()));
    this.#timer = this.#scheduler.after(delay, () => this.#run(async () => {
      await this.#refresh();
      this.#schedule();
    }));
  }
}
