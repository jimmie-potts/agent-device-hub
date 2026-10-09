// The agent-session core (Hub #831, ADR 0012): the one owner of agent sessions in the runtime, as the source `bunny/core`.
// It runs agent-state's owner on the core store, takes hooks' 2.0 `lifecycle` observations into the reducer, publishes
// each committed change as `session` state, removal and occurrence messages, serves `session` through sync and answers
// `notice-acknowledge` and tracked operator labels. It is first in the runtime's module list and registers everything
// on the bus before its first
// await, so a module that starts after it syncs from it, or republishes to it, finds it listening (#882). Its action
// dispatcher, tracker and outcome intake (#782, tracker.ts) and its history (history.ts) are its own; parts that later
// stories add, such as #923's inbox, join through `CorePart` and derive their rows from each tracked action's change.
// Its own `operation` family (Hub #922, operation-records.ts) is the first such part: each tracked action's latest state.
import type {DatabaseSync} from 'node:sqlite';
import {createAgentState, type Consumer, type Outcome} from '@jimmie-potts/agent-state';
import {MessageValidator, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  registerCoreFamilies, sessionEntityId, type ApprovalRecoverRequest, type LifecycleObservation, type NoticeAcknowledgeRequest, type NoticeClearRequest, type SessionLabelSetRequest, type SessionRecord,
} from '@jimmie-potts/event-contracts/v2/families';
import {
  type BunnyModule, type Cancel, type Clock, type Command, type LogFields, type Logger, type ModuleContext, type ModuleScheduler, type ModuleTool,
  type Reply, type Sdk, type Snapshot, type StateDraft, type SyncRequest,
} from '@jimmie-potts/sdk';
import type {HistoryFilter, HistoryRow} from './history.js';
import {inboxTool, historyTool} from './read-tools.js';
import {InboxRecords} from './inbox.js';
import {OperationRecords} from './operation-records.js';
import {ModePart} from './mode.js';
import {AutomationError} from './automation.js';
import {AutomationPart, type AutomationControls} from './automation-part.js';
import type {ModeParticipant} from './mode-participants.js';
import type {Operation} from './operations.js';
import {Tracker, type Action, type ActionAnswer, type CoreActions, type CoreOperatorActions, type Tracked} from './tracker.js';
import {CORE_MODULE} from '../host.js';
import {Backoff} from './backoff.js';
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
  /** Sends one tracked action through the core's dispatcher (#782), as automation, moments and the Hub mode do. */
  dispatch(action: Action): Promise<ActionAnswer>;
  /** The tracked action with this request ID, if any. */
  operation(requestId: string): Operation | undefined;
}

/**
 * A part of the core with rows of its own in the core store: the extension point for #923's inbox and later core
 * stories. Its changes commit in the core store's transactions and go out through the core's outbox, and history keeps
 * what it publishes.
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
  /**
   * Rows it derives from each change of a tracked action (#782), in that change's transaction: #923 turns failed,
   * expired, uncertain and conflicting results into inbox items.
   */
  readonly tracked?: Tracked;
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
  /** How many `operation` records the core keeps (Hub #922). Defaults to `MAX_OPERATION_RECORDS`; tests lower it. */
  operationLimit?: number;
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

/** The longest text a `sessions` call may search for. */
const MAX_QUERY = 120;

/**
 * The core's MCP read tool (module API 1.2, Hub #835), `core_sessions`: the sessions it holds, as the old Hub's
 * `hub_sessions` read them, optionally only one provider's and those whose label, title, project or session ID holds
 * `q`, ignoring case. Reading changes nothing, acknowledges nothing and proves no readership.
 */
function sessionsTool(records: () => {revision: number; sessions: readonly SessionRecord[]} | undefined): ModuleTool {
  return {
    name: 'sessions',
    description: 'Read the agent sessions the core holds, optionally only one provider\'s and those whose label, title, project or session ID contains q, ignoring case. '
      + 'Each record carries its revision, which approval recovery takes as expectedRevision. Reading changes nothing, and freshness, attention and unread state stay as observed.',
    input: {type: 'object', additionalProperties: false, properties: {q: {type: 'string', maxLength: MAX_QUERY}, provider: {enum: ['codex', 'claude']}}},
    output: {type: 'object', additionalProperties: false, required: ['revision', 'sessions'], properties: {revision: {type: 'integer', minimum: 0}, sessions: {type: 'array'}}},
    read: ({q, provider}) => {
      const held = records();
      if (held === undefined) return errorBody('unavailable', {detail: 'the core is not serving its sessions now'});
      const query = typeof q === 'string' ? q.toLowerCase() : '';
      const sessions = held.sessions.filter(record => (provider === undefined || record.identity.provider === provider) &&
        [record.label?.value, record.title?.value, record.project, record.identity.sessionId].some(text => text?.toLowerCase().includes(query) === true));
      return {revision: held.revision, sessions};
    },
  };
}

/** The core as the runtime hosts it: a module, with its dispatcher for the gateway's action routes (#782). */
export interface CoreModule extends BunnyModule {
  readonly actions: CoreActions;
  readonly automation: AutomationControls;
  readonly operatorActions: CoreOperatorActions;
  /** Internal qualified host admission bridge; assignment sends nothing. */
  setModeParticipants(participants: readonly ModeParticipant[]): void;
  readonly history: {read: (filter: HistoryFilter) => HistoryRow[] | ErrorBody};
}

/** Whether a hosted module is the core, whose dispatcher the gateway's action routes call. */
export const isCoreModule = (module: BunnyModule): module is CoreModule => module.manifest.name === CORE_MODULE && 'actions' in module;

/** The core as a module of the runtime's fixed list. Its `create` and `simulate` are the same: it reaches no device. */
export function createCoreModule(options: CoreOptions = {}): CoreModule {
  let core: Core | undefined;
  return {
    manifest: {name: CORE_MODULE, apiVersion: '1.2', tools: [sessionsTool(() => core?.sessions()),
      inboxTool(() => core?.inbox()), historyTool(filter => core?.history(filter))]},
    start: context => {
      core = new Core(context, options);
      return core.start();
    },
    stop: () => core?.stop(),
    history: {read: filter => core?.history(filter) ?? errorBody('unavailable', {detail: 'the core has not started'})},
    get automation() { if(core===undefined) throw new AutomationError('unavailable',503); return core.automation; },
    actions: {dispatch: action => core?.dispatch(action) ?? Promise.resolve(errorBody('unavailable', {detail: 'the core has not started'}))},
    operatorActions: {dispatch: action => core?.dispatchOperator(action) ?? Promise.resolve(errorBody('unavailable', {detail: 'the core has not started'}))},
    setModeParticipants: participants => {
      if (core === undefined) throw new Error('core-not-started');
      core.setModeParticipants(participants);
    },
  };
}

class Core {
  readonly #automation = new AutomationPart();
  get automation(): AutomationControls {return this.#automation.controls;}
  readonly #mode: ModePart;
  readonly #sdk: Sdk;
  readonly #log: Logger;
  readonly #clock: Clock;
  readonly #scheduler: ModuleScheduler;
  readonly #store: CoreStore;
  readonly #tracker: Tracker;
  readonly #parts: readonly CorePart[];
  readonly #inbox: InboxRecords;
  readonly #consumers: readonly Consumer[];
  readonly #validator = new MessageValidator();
  readonly #ready: Promise<void>;
  #opened: () => void = () => {};
  #failed: (error: unknown) => void = () => {};
  #owner: AgentState | undefined;
  /** Current positive Desktop archive evidence only; it expires when its module stops confirming it. */
  readonly #archived = new Map<string, {observedAtMs: number; untilMs: number}>();
  /** Why the owner is not open, while it is not, and when to try again. */
  #ownerDown: ErrorCode = 'unavailable';
  readonly #reopen = new Backoff(REFRESH_RETRY_MS, RETRY_MAX_MS);
  readonly #freshness = new Backoff(REFRESH_RETRY_MS, RETRY_MAX_MS);
  /** Since when the store has refused durable work, and when that was last summarized. */
  #degradedSince: number | undefined;
  #summarizedAt = 0;
  /** The refusals since the condition was last recorded. */
  #unrecorded = 0;
  /** The core's own operations run one at a time, so each commit is the reduction of the one observation under way. */
  #queue: Promise<unknown> = Promise.resolve();
  #timer: Cancel | undefined;
  #stopped = false;
  /** The start under way, which a stop waits for so that an owner it opens late is shut down too. */
  #starting: Promise<void> | undefined;

  constructor(context: ModuleContext, {parts: added = [], consumers = DEFAULT_CONSUMERS, beforePublish, operationLimit}: CoreOptions) {
    this.#sdk = context.sdk;
    this.#log = context.log;
    this.#clock = context.clock;
    this.#scheduler = context.scheduler;
    // The core's own `operation` family (Hub #922) comes first, then the parts later stories add.
    this.#inbox = new InboxRecords((action, handle) => this.#tracker.dispatchFromInbox(action, handle));
    this.#mode = new ModePart({
      admit: command => this.#tracker.admitOperator(command),
      complete: (tx, command, result) => this.#tracker.completeCore(tx, command, result),
      end: command => this.#tracker.endOperator(command),
    });
    const parts: readonly CorePart[] = [new OperationRecords(operationLimit), this.#inbox, this.#mode, this.#automation, ...added];
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
      database: context.database(), clock: context.clock,
      sdk: {source:context.sdk.source,publishMessage:async(key,message)=>{
        const failed=this.#automation.publishing(message);
        try {return await context.sdk.publishMessage(key,message);} catch(error) {failed();throw error;}
      }},
      committed: change => {
        this.#automation.committed(change);
        return ()=>this.#automation.publicationEnded(change);
      },
      derivers: parts.flatMap(part => part.derive ?? []),
      open: [
        (database: DatabaseSync) => { this.#tracker.open(database); },
        ...parts.flatMap(part => part.open === undefined ? [] : [(database: DatabaseSync) => { part.open?.(database); }]),
      ],
      ...(beforePublish === undefined ? {} : {beforePublish}),
      // Committed is not published (ADR 0012): the change stands, its messages go out at the next commit or start, and
      // the outbox records the refusal as `outbox.deferred`, once per run of refusals.
      log: context.log, trace: context.trace,
    });
    this.#tracker = new Tracker({
      store: this.#store, sdk: context.sdk, log: context.log, trace: context.trace, clock: context.clock, scheduler: context.scheduler,
      tracked: parts.flatMap(part => part.tracked ?? []), ready: this.#ready,
      storage: {failed: code => { this.#degraded(code); }, recovered: () => { this.#recovered(); }},
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
      dispatch: action => this.dispatch(action),
      operation: requestId => this.#tracker.operation(requestId),
    };
    const families = ['session', ...this.#parts.flatMap(part => part.families ?? [])];
    const registered: Promise<unknown>[] = [
      this.#sdk.serveSync(families, request => this.#serve(request)),
      this.#sdk.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => this.#observe(message)),
      this.#sdk.respond<NoticeAcknowledgeRequest>('bunny.cmd.notice-acknowledge.*', command => this.#acknowledge(command)),
      this.#sdk.respond<ApprovalRecoverRequest>('bunny.cmd.approval-recover.*', command => this.#recover(command)),
      this.#sdk.respond<NoticeClearRequest>('bunny.cmd.notice-clear.*', command => this.#clearNotice(command)),
      this.#sdk.respond<SessionLabelSetRequest>('bunny.cmd.session-label-set.*', command => this.#label(command)),
      ...this.#tracker.start(),
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
        // Every action still pending after a restart waits for its deadline, never to be sent again.
        this.#tracker.resume();
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
    await this.#automation.close();
    await this.#tracker.stop();
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
    this.#owner = await createAgentState({storage: this.#store, ownerId: OWNER_ID, consumers: this.#consumers.map(consumer => ({...consumer})), clock: () => this.#clock.now(),
      isArchived: (identity, _signal, ancestors) => Promise.resolve([identity, ...ancestors].some(item => {
        const key = sessionEntityId(item), evidence = this.#archived.get(key);
        if (evidence === undefined) return false;
        if (this.#clock.now() >= evidence.untilMs) { this.#archived.delete(key); return false; }
        return true;
      })),
    });
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
  async #call(work: (owner: AgentState) => Promise<Outcome>, saveRefusal?: () => Refusal | undefined): Promise<Extract<Outcome, {ok: true}> | {ok: false; refusal: Refusal}> {
    if (this.#stopped) return {ok: false, refusal: {code: 'unavailable', detail: 'the core is stopping'}};
    const owner = await this.#ensureOwner();
    if (!('ingest' in owner)) return {ok: false, refusal: owner};
    const result = await work(owner);
    if (result.ok) {
      if (result.outcome === 'applied' || result.outcome === 'ambiguous') this.#recovered();
      return result;
    }
    const guarded = saveRefusal?.();
    const refusal = guarded ?? this.#refusal(result);
    if (guarded !== undefined) this.#store.takeFailure();
    if ((result.code === 'storage-failed' || result.code === 'unavailable') && !this.#stopped) {
      if (result.code === 'storage-failed' && guarded === undefined) this.#degraded(refusal.code);
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
      this.#unrecorded = 0;
      record();
      return;
    }
    this.#unrecorded += 1;
    if (now - this.#summarizedAt < SUMMARY_MS) return;
    this.#summarizedAt = now;
    record({'bunny.duration_ms': Math.min(MAX_DURATION_MS, Math.max(0, now - this.#degradedSince)), 'bunny.attempt_count': this.#unrecorded});
    this.#unrecorded = 0;
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
      // A store that could not open, as on a first start on a full disk, holds nothing to check against: the owner
      // opens it, or the observation is refused with the owner's code.
      if (!this.#store.open) {
        const owner = await this.#ensureOwner();
        if (!('ingest' in owner)) {
          this.#log.info('message.received', {...fields, ...refused(owner.code)}, message);
          return;
        }
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
      if (observation.event.kind === 'metadata-observed') {
        if (message.source !== 'bunny/modules/codex-desktop') {
          this.#log.warn('message.received', {...fields, ...refused('forbidden')}, message);
          return;
        }
        const key = sessionEntityId(observation.identity), nowMs = this.#clock.now();
        const before = this.#archived.get(key);
        if (observation.event.archived !== undefined && observation.observedAtMs >= (before?.observedAtMs ?? 0)) {
          if (observation.event.archived && observation.observedAtMs + 7000 > nowMs) {
            this.#archived.set(key, {observedAtMs: observation.observedAtMs, untilMs: Math.min(nowMs, observation.observedAtMs) + 7000});
          } else this.#archived.delete(key);
        }
        const title = observation.title;
        if (title === undefined) {
          this.#log.debug('message.received', {...fields, 'bunny.outcome': 'accepted'}, message);
          return;
        }
        const cause = {message, kind: 'metadata.observed', entity: key, observation};
        const result = await this.#store.during(cause, () => this.#call(owner => owner.setTitle(observation.identity, title, observation.observedAtMs)));
        this.#log.info('message.received', {...fields, ...(result.ok ? {'bunny.outcome': result.outcome === 'applied' ? 'accepted' : result.outcome} : refused(result.refusal.code))}, message);
        return;
      }
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

  /** Assigns qualified mode participants once, without sending a command. */
  setModeParticipants(participants: readonly ModeParticipant[]): void {
    this.#mode.setParticipants(participants);
    this.#automation.setParticipants(participants);
  }

  inbox(): ReturnType<InboxRecords['records']> { return this.#inbox.records(); }
  history(filter: HistoryFilter): HistoryRow[] | ErrorBody {
    return this.#store.open ? this.#store.history.read(filter) : errorBody('unavailable', {detail: 'the core history is unavailable'});
  }

  /** Sends one tracked action through the dispatcher (#782); see `CoreActions.dispatch`. */
  dispatch(action: Action): Promise<ActionAnswer> {
    if (this.#stopped) return Promise.resolve(errorBody('unavailable', {detail: 'the core is stopping'}));
    return this.#tracker.dispatch(action);
  }

  /** The gateway's dedicated entry point; dispatch never holds the queue its responder must enter. */
  dispatchOperator(action: Action): Promise<ActionAnswer> {
    if (this.#stopped) return Promise.resolve(errorBody('unavailable', {detail: 'the core is stopping'}));
    return this.#tracker.dispatchOperator(action);
  }

  /** Sets or clears one user label and completes the tracked action in that same owner transaction. */
  async #label(command: Command<SessionLabelSetRequest>): Promise<Reply> {
    if (!this.#tracker.admitOperator(command)) return errorBody('forbidden', {detail: 'this command has no operator admission'});
    // Keep the admitted command facts stable while its queued owner work waits.
    command = {...command, data: structuredClone(command.data)};
    try {
      await this.#ready;
      if (this.#stopped) return errorBody('unavailable', {detail: 'the core is stopping'});
      return await this.#run(async () => {
        const owner = await this.#ensureOwner();
        if (!('ingest' in owner)) return errorBody(owner.code, {detail: owner.detail});
        const {label, expectedRevision} = command.data;
        const current = (): SessionRecord | undefined => this.#store.records().find(record => record.id === command.subject);
        const guard = (): Refusal | undefined => current() === undefined ? {code: 'not-found', detail: 'no such session'} :
          current()?.revision !== expectedRevision ? {code: 'revision-conflict', detail: 'the session changed since it was read; read it again'} : undefined;
        const refusal = guard();
        if (refusal !== undefined) return errorBody(refusal.code, {detail: refusal.detail});
        const record = current();
        if (record === undefined) return errorBody('not-found', {detail: 'no such session'});
        let committed: (() => void) | undefined;
        const complete = (tx: CoreTransaction): void => { committed = this.#tracker.completeCore(tx, command, {result: 'succeeded', evidence: 'observed'}); };
        if ((label === null && record.label === undefined) || (record.label?.origin === 'user' && record.label.value === label)) {
          try {
            await this.#store.transaction(complete);
          } catch {
            return errorBody(this.#store.takeFailure() === 'full' ? 'capacity' : 'internal', {detail: 'the core could not complete the label action'});
          }
        } else {
          let intervened: Refusal | undefined;
          const result = await this.#store.during({message: command, kind: 'label', entity: record.id},
            () => this.#call(selected => selected.setLabel(record.identity, label, 'user'), () => intervened),
            (_change, tx) => {
              // Owner maintenance has its own queue. Compare the prior committed record inside this save's transaction.
              intervened = guard();
              if (intervened !== undefined) throw new Error('label-revision-conflict');
              complete(tx);
            });
          if (!result.ok) {
            const failed = intervened ?? result.refusal;
            return errorBody(failed.code, {detail: failed.detail});
          }
          if (committed === undefined) return errorBody('internal', {detail: 'the label save did not complete its action'});
        }
        committed?.();
        this.#schedule();
        return {status: 'accepted'};
      });
    } finally {
      this.#tracker.endOperator(command);
    }
  }

  /** One operator override: all configured acknowledgments and completion share the owner's save. */
  async #clearNotice(command: Command<NoticeClearRequest>): Promise<Reply> {
    if (!this.#tracker.admitOperator(command)) return errorBody('forbidden', {detail: 'this command has no operator admission'});
    command = {...command, data: structuredClone(command.data)};
    try {
      await this.#ready;
      if (this.#stopped) return errorBody('unavailable', {detail: 'the core is stopping'});
      return await this.#run(async () => {
        const owner = await this.#ensureOwner();
        if (!('ingest' in owner)) return errorBody(owner.code, {detail: owner.detail});
        const {noticeId, expectedRevision} = command.data;
        const current = (): SessionRecord | undefined => this.#store.records().find(record => record.id === command.subject);
        const guard = (): Refusal | undefined => {
          const record = current();
          return record === undefined ? {code: 'not-found', detail: 'no such session'} :
            record.revision !== expectedRevision || (record.notices.at(-1)?.id ?? null) !== noticeId
              ? {code: 'revision-conflict', detail: 'the session or current notice changed since it was read; read it again'} : undefined;
        };
        const refusal = guard();
        if (refusal !== undefined) return errorBody(refusal.code, {detail: refusal.detail});
        const record = current();
        if (record === undefined) return errorBody('not-found', {detail: 'no such session'});
        const notice = record.notices.at(-1);
        let committed: (() => void) | undefined;
        const complete = (tx: CoreTransaction): void => { committed = this.#tracker.completeCore(tx, command, {result: 'succeeded', evidence: 'observed'}); };
        if (noticeId === null || this.#consumers.every(consumer => notice?.acknowledgedBy.includes(consumer.id) === true)) {
          try { await this.#store.transaction(complete); }
          catch { return errorBody(this.#store.takeFailure() === 'full' ? 'capacity' : 'internal', {detail: 'the core could not complete the notice action'}); }
        } else {
          let intervened: Refusal | undefined;
          const result = await this.#store.during({message: command, kind: 'notice.acknowledged', entity: record.id},
            () => this.#call(selected => selected.acknowledgeAll(record.identity, noticeId), () => intervened),
            (_change, tx) => {
              intervened = guard();
              if (intervened !== undefined) throw new Error('notice-revision-conflict');
              complete(tx);
            });
          if (!result.ok) {
            const failed = intervened ?? result.refusal;
            return errorBody(failed.code, {detail: failed.detail});
          }
          if (committed === undefined) return errorBody('internal', {detail: 'the notice save did not complete its action'});
        }
        committed?.();
        this.#schedule();
        return {status: 'accepted'};
      });
    } finally { this.#tracker.endOperator(command); }
  }

  /** The sessions the core holds at its revision, once its store is open and while it runs; undefined otherwise. */
  sessions(): {revision: number; sessions: readonly SessionRecord[]} | undefined {
    if (this.#owner === undefined || this.#stopped) return undefined;
    return {revision: this.#store.revision, sessions: this.#store.records()};
  }

  /**
   * Answers `approval-recover` (Hub #835), the old Hub's operator recovery, through agent-state's `recoverApproval`: it
   * retires the one approval marker without an attention ID that the session holds on `turnId`, only while the
   * session's evidence is uncertain. `expectedRevision` must be the session record's revision, so an operator who read a
   * record that has changed since is refused with `revision-conflict` and reads again. The change commits before the
   * reply, in the command's trace, with `attention-cleared` (cause `recovered`) and the session's new state as its
   * evidence; no outcome follows. A session with no such marker, or whose evidence is current, is `invalid-state`.
   */
  async #recover(command: Command<ApprovalRecoverRequest>): Promise<Reply> {
    await this.#ready;
    if (this.#stopped) return errorBody('unavailable', {detail: 'the core is stopping'});
    return this.#run(async () => {
      const {requestId, turnId, expectedRevision} = command.data;
      const fields: LogFields = {'bunny.participant': command.source, 'bunny.operation': 'status', ...requestField(requestId)};
      const refuse = (code: ErrorCode, detail: string): ErrorBody => {
        this.#log.info('command.rejected', {...fields, ...refused(code)}, command);
        return errorBody(code, {detail});
      };
      const checked = this.#validator.validate(command);
      if (!checked.ok) return refuse(checked.error.code, 'the recovery is not a valid approval-recover command');
      const record: SessionRecord | undefined = this.#store.records().find(item => item.id === command.subject);
      if (record === undefined) return refuse('not-found', 'no such session');
      if (record.revision !== expectedRevision) return refuse('revision-conflict', 'the session changed since it was read; read it again');
      const cause = {message: command, kind: 'attention.resolved', entity: record.id};
      // The operator's guard is the record's revision; agent-state's own is taken as the core runs this change alone.
      const result = await this.#store.during(cause, () => this.#call(owner => owner.recoverApproval(record.identity, turnId, owner.snapshot().revision)));
      if (!result.ok) {
        const {code, detail} = result.refusal;
        // agent-state refuses a recovery whose preconditions do not hold as an invalid operation, which the core maps to
        // `not-found`; the session exists, so it is the session's state that does not allow it.
        return code === 'not-found' ? refuse('invalid-state', 'the session holds no uncertain approval without an ID on that turn') : refuse(code, detail);
      }
      this.#log.info('command.completed', {...fields, 'bunny.outcome': 'accepted', 'bunny.state.revision': this.#store.revision}, command);
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
      // A store that could not open, as at a first start on a full disk, has nothing to serve until the owner opens it.
      if ((!this.#store.open && !('ingest' in await this.#ensureOwner())) || !await this.#refresh()) {
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
