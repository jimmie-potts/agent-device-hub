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
/** The shortest wait before the core tries again to publish freshness that a failed commit left behind. */
const REFRESH_RETRY_MS = 1000;
const MAX_DELAY_MS = 2_147_483_647;
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
        await this.#open();
        // A stop that came meanwhile shuts the owner down; whatever waits on `ready` finds the core stopped.
        if (this.#stopped) {
          this.#opened();
          return;
        }
        // A restart leaves every stored session uncertain until fresh evidence, and the records say so at once.
        await this.#store.refresh();
        // What a crash kept from going out goes out now, with its stored `id` and `time`.
        await this.#store.republish();
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
    await owner?.shutdown();
    await this.#store.drain();
  }

  /** Runs one of the core's operations after those before it. */
  #run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #open(): Promise<void> {
    this.#owner = await createAgentState({storage: this.#store, ownerId: OWNER_ID, consumers: this.#consumers.map(consumer => ({...consumer})), clock: () => this.#clock.now()});
  }

  /**
   * Calls the owner. After a commit that failed, as on a full disk, agent-state's owner is faulted; the core opens it
   * again on its store, which holds exactly what committed, so later work is taken once the disk has room. An owner
   * that cannot be opened again fails the core, and the runtime with it.
   */
  async #call(work: (owner: AgentState) => Promise<Outcome>): Promise<Outcome> {
    if (this.#stopped) return {ok: false, code: 'unavailable'};
    if (this.#owner === undefined) await this.#open();
    const owner = this.#owner;
    if (owner === undefined) return {ok: false, code: 'unavailable'};
    const result = await work(owner);
    if (!result.ok && (result.code === 'storage-failed' || result.code === 'unavailable') && !this.#stopped) {
      this.#owner = undefined;
      await owner.shutdown().catch(() => {});
      await this.#open();
    }
    return result;
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
        return {code: 'unavailable', detail: 'the core is not taking changes now'};
      case 'invalid-event':
        return {code: 'invalid-request', detail: 'the observation is not one the core admits'};
      case 'invalid-operation':
        return {code: 'not-found', detail: 'no such session or notice'};
      case 'revision-conflict':
        return {code: 'revision-conflict', detail: 'the core changed meanwhile'};
    }
  }

  /** Takes one hook observation into the reducer, once by `(source, id)`. */
  async #observe(message: Message<LifecycleObservation>): Promise<void> {
    await this.#ready;
    if (this.#stopped) return;
    await this.#run(async () => {
      const fields: LogFields = {
        'bunny.participant': message.source, 'bunny.message.id': message.id, 'bunny.message.kind': message.kind, 'bunny.operation': 'lifecycle',
      };
      // The bus does not check messages; a remote edge has, but an in-process sender may not have.
      const checked = this.#validator.validate(message);
      if (!checked.ok || message.type !== LIFECYCLE_TYPE) {
        this.#log.info('message.received', {...fields, ...refused(checked.ok ? 'invalid-message' : checked.error.code)}, message);
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
      const intake = {message, kind: reducedKind(observation), entity: sessionEntityId(observation.identity)};
      const result = await this.#store.intake(intake, () => this.#call(owner => owner.ingest(toEnvelope(observation))));
      if (result.ok) {
        const outcome = result.outcome === 'duplicate' ? 'duplicate' : result.outcome === 'stale' ? 'stale' : 'accepted';
        const record = {...fields, 'bunny.outcome': outcome, 'bunny.state.revision': this.#store.revision, ...(outcome === 'stale' ? {'bunny.reason': 'stale'} : {})};
        if (outcome === 'duplicate') this.#log.debug('message.received', record, message);
        else this.#log.info('message.received', record, message);
      } else {
        const {code} = this.#refusal(result);
        const record = {...fields, ...refused(code)};
        if (code === 'internal') this.#log.error('message.received', record, message);
        else if (code === 'capacity' || code === 'unavailable') this.#log.warn('message.received', record, message);
        else this.#log.info('message.received', record, message);
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
        const record = {...fields, ...refused(code)};
        if (code === 'forbidden' || code === 'capacity' || code === 'unavailable') this.#log.warn('command.rejected', record, command);
        else if (code === 'internal') this.#log.error('command.rejected', record, command);
        else this.#log.info('command.rejected', record, command);
        return errorBody(code, {detail});
      };
      const checked = this.#validator.validate(command);
      if (!checked.ok) return refuse(checked.error.code, 'the acknowledgment is not a valid notice-acknowledge command');
      if (!this.#consumers.some(consumer => consumer.id === consumerId)) return refuse('invalid-request', 'no such consumer');
      if (consumerOf(command.source) !== consumerId) return refuse('forbidden', 'a consumer acknowledges notices for itself only');
      const record: SessionRecord | undefined = this.#store.records().find(item => item.id === command.subject);
      if (record === undefined) return refuse('not-found', 'no such session');
      if (!record.notices.some(notice => notice.id === noticeId)) return refuse('not-found', 'no such notice');
      const result = await this.#call(owner => owner.acknowledge(record.identity, noticeId, consumerId));
      if (!result.ok) {
        const {code, detail} = this.#refusal(result);
        return refuse(code, detail);
      }
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
      try {
        await this.#store.refresh();
      } catch {
        this.#log.warn('operation.failed', {'bunny.operation': 'snapshot', ...refused('unavailable')}, request);
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

  /** Publishes freshness when the next current record turns uncertain, at a new revision (MAPPING.md, `freshness`). */
  #schedule(retry = false): void {
    this.#timer?.();
    this.#timer = undefined;
    if (this.#stopped) return;
    const at = this.#store.nextTurn();
    if (at === undefined) return;
    const delay = Math.min(MAX_DELAY_MS, Math.max(retry ? REFRESH_RETRY_MS : 0, at - this.#clock.now()));
    this.#timer = this.#scheduler.after(delay, () => this.#run(async () => {
      try {
        await this.#store.refresh();
        this.#schedule();
      } catch {
        // The disk may be full: what committed stands, and the core tries again shortly instead of failing.
        this.#log.warn('operation.failed', {'bunny.operation': 'status', ...refused('unavailable')});
        this.#schedule(true);
      }
    }));
  }
}
