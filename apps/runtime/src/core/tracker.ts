// The core's action dispatcher, tracker and outcome intake (Hub #782, ADR 0012 "High-impact messages", "Errors,
// effects and outcomes" and "Inbox and history"). It is part of the core, `bunny/core`, and keeps its rows in the core
// store, so each step commits with its history rows in one transaction.
//
// - The dispatcher sends every device command, moment and mode change: the gateway's HTTP and MCP action routes, and
//   later automation, moments and the Hub mode, call it. It records the action as sent before it sends anything, so a
//   full disk refuses the action (`unavailable`, `storage-full`) before any reply could say accepted. It sends the command
//   once, with the kind's reply deadline as its expiry, records the reply, and waits for the outcome until the kind's
//   outcome deadline. Nothing is ever sent again: not a timed-out command, not after a restart, not a reused request ID.
// - The intake takes every outcome, occurrence, removal and state another participant publishes into history, drops a
//   duplicate by `(source, id)` durably (history holds each whole message once), and refuses the same `(source, id)` with
//   other content as `duplicate-conflict`, kept for diagnosis. An outcome that matches a tracked action by its request ID
//   advances that action (operations.ts). Once the outcome commits, the core acknowledges it to its module, and it
//   acknowledges an exact duplicate again, so a lost acknowledgment recovers at the module's next start.
// - The intake commits in groups: what the bus delivered by the next turn of the event loop, up to 100 messages or about
//   50 ms of work, in one transaction, with a turn between groups, so a burst neither holds the event loop for one
//   commit per message nor delays other work for long ("a slow consumer lags only itself"). Each message keeps its own
//   verdict within its group.
// - Deadlines: one timer for the earliest pending action. A restart loads every pending action and lets its deadline
//   pass: it ends uncertain, and a late outcome still completes it. A clean stop closes the core's participant first,
//   which settles the dispatcher's own requests: one the owner's handler has with no reply ends uncertain at once
//   ("the requester closed before the reply"), and one still queued is cancelled, failed.
// - Every step is logged once, in the action's trace, and `message.received` carries the incoming message's trace.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, compareDelivery, errorBody, type ErrorBody, type ErrorCode, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {
  acknowledgmentOf, levelOf, startSpan, type Cancel, type Clock, type Command, type CommandDraft, type LogFields, type Logger, type ModuleScheduler, type RequestResult,
  type Sdk, type TraceContext, type Tracing,
} from '@jimmie-potts/sdk';
import {REGISTRY_REASONS} from '../diagnostics.js';
import {kept, type OperationStep} from './history.js';
import {DEADLINES, advance, kindOf, type Operation, type OperationEvent, type TakenOutcome} from './operations.js';
import type {CoreStore, CoreTransaction} from './store.js';

/**
 * The core's own operator commands, which a remote grant may request directly (Hub #835's `control` scope): an approval
 * recovery and a consumer's notice acknowledgment. They change the core's own records and are not tracked actions.
 * Every other command, a device's, a moment, a mode change or a module's own family, goes through the dispatcher, so
 * nothing bypasses tracking.
 */
export const DIRECT_COMMANDS: readonly string[] = Object.freeze(['approval-recover', 'notice-acknowledge', 'inbox-handle']);
/** Tracked actions admitted only by the authenticated gateway's dedicated capability. */
export const OPERATOR_ACTIONS: readonly string[] = Object.freeze(['session-label-set', 'notice-clear']);

/** One action for the dispatcher: a command, as `request` takes it, and who asks for it. */
export type Action = {
  /** The command's routing key, `bunny.cmd.<family>.<target>`. */
  readonly key: string;
  /** The command. Its subject is the key's target; its payload's `requestId`, if any, is set from the action's. */
  readonly draft: CommandDraft<object>;
  /** Who asks: an authenticated caller's source, or the core part that dispatches it. */
  readonly requestedBy: string;
  /** The request ID to send. One is generated otherwise. A request ID names one action, ever. */
  readonly requestId?: string;
  /** The context being handled, which the action joins; a new trace otherwise. */
  readonly parent?: TraceContext;
};
/** The dispatcher's answer: the owner's `accepted`, or a refusal or uncertain result in the shared error body. */
export type ActionAnswer = {status: 'accepted'; requestId: string} | ErrorBody;

/** The dispatcher, as the runtime gives it to the gateway's action routes (Hub #782). */
export interface CoreActions {
  /**
   * Sends one tracked action and answers once its owner replied: `accepted`, the owner's or the bus's refusal, or
   * `uncertain-result` when its fate is unknown. It never rejects. Nothing is ever sent again: a request ID already
   * used for the same action answers what that action got, and one used for another action is `duplicate-conflict`.
   */
  dispatch(action: Action): Promise<ActionAnswer>;
}
/** A capability kept by runtime composition and the gateway, absent from ordinary module/core handles. */
export interface CoreOperatorActions {
  dispatch(action: Action): Promise<ActionAnswer>;
}

/** One change of a tracked action, which the core's parts derive their rows from, such as #923's inbox items. */
export type OperationChange = {
  readonly operation: Operation;
  /** The action before this change; undefined when it was just sent. */
  readonly previous: Operation | undefined;
  /** The outcome that caused the change, when one did. */
  readonly outcome?: Message<CompletedOutcome>;
};
/** A part's rows for one tracked action's change, written in the change's own transaction. */
export type Tracked = (change: OperationChange, tx: CoreTransaction) => void;

/** The profile's completed outcome payload. */
export type CompletedOutcome = {requestId: string; result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'transmitted' | 'observed' | 'none'; error?: ErrorDetail};

export type TrackerOptions = {
  store: CoreStore;
  /** The core's participant, `bunny/core`. */
  sdk: Sdk;
  log: Logger;
  trace: Tracing;
  clock: Clock;
  scheduler: ModuleScheduler;
  /** The parts' derivers of tracked actions' changes. */
  tracked?: readonly Tracked[];
  /** Resolves once the core's store is open. */
  ready: Promise<void>;
  /** Hears that the store refused durable work, and that a change committed again, as the core summarizes both. */
  storage?: {failed: (code: ErrorCode) => void; recovered: () => void};
};

const KEY = /^bunny\.cmd\.([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const COMMAND_TYPE = /^org\.bunny(\.[a-z][a-z0-9-]*){2,3}\.requested$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SOURCE = /^bunny(?:\/[a-z0-9][a-z0-9-]*)+$/;
/** The `bunny.request.id` attribute's pattern (diagnostic contract): a request ID it refuses is left out of a record. */
const REQUEST_FIELD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RESULTS: readonly unknown[] = ['succeeded', 'failed', 'uncertain'];
const EVIDENCE: readonly unknown[] = ['transmitted', 'observed', 'none'];
const MAX_DELAY_MS = 2_147_483_647;
/** The intake's one subscription: every published key. */
const INTAKE = 'bunny.*.*.*';
/** An intake group takes at most this many messages into one transaction, */
const GROUP_MESSAGES = 100;
/** and no more once its own work has taken this long, so one group holds the event loop only briefly. */
const GROUP_BUDGET_MS = 50;
/** One turn of the event loop: timers, I/O and the rest of the runtime's work run before the intake goes on. */
const nextTurn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
/** After a failed sweep, the first wait before the next; each further failure doubles it, up to a minute. */
const SWEEP_RETRY_MS = 1000;
const SWEEP_RETRY_MAX_MS = 60_000;

const requestField = (requestId: string): LogFields => REQUEST_FIELD.test(requestId) ? {'bunny.request.id': requestId} : {};
const refusedFields = (code: ErrorCode): LogFields => ({'bunny.code': code, ...(REGISTRY_REASONS[code] === undefined ? {} : {'bunny.reason': REGISTRY_REASONS[code]})});
/** A JSON value with its object members in a fixed order, so two equal payloads compare equal however they were written. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(name => `${JSON.stringify(name)}:${canonical((value as Record<string, unknown>)[name])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const withoutRequestId = (data: object): Record<string, unknown> => Object.fromEntries(Object.entries(data).filter(([name]) => name !== 'requestId'));
/** A received message's identifying fields, each only when it is well formed. */
const messageFields = (message: Message<unknown>): LogFields => ({
  ...(SOURCE.test(message.source) && message.source.length <= 256 ? {'bunny.participant': message.source} : {}),
  ...(ID.test(message.id) ? {'bunny.message.id': message.id} : {}),
  'bunny.message.kind': message.kind,
});
/** An intake record's fields for a received message: its own, and an outcome's request ID. */
const intakeFields = (message: Message<unknown>): LogFields => ({
  ...messageFields(message), ...message.kind === 'outcome' && isOutcome(message.data) ? requestField(message.data.requestId) : {},
});
/** Whether a message's envelope has what history keys it by. The bus checks no payload; a remote edge has checked everything. */
const wellFormed = (message: Message<unknown>): boolean =>
  typeof message.source === 'string' && SOURCE.test(message.source) && typeof message.id === 'string' && ID.test(message.id) &&
  typeof message.type === 'string' && typeof message.subject === 'string' && typeof message.dataschema === 'string' &&
  typeof message.data === 'object' && message.data !== null;
/** An outcome's payload as the profile defines it. */
const isOutcome = (data: unknown): data is CompletedOutcome => {
  const outcome = data as Partial<CompletedOutcome>;
  return typeof outcome.requestId === 'string' && ID.test(outcome.requestId) && RESULTS.includes(outcome.result) && EVIDENCE.includes(outcome.evidence);
};

/** Why the store refused a transaction: a full disk, or anything else. */
class Refused extends Error {
  readonly code: ErrorCode;
  readonly detail: string;

  constructor(code: ErrorCode, detail: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

type Statements = {read: StatementSync; insert: StatementSync; update: StatementSync; due: StatementSync; next: StatementSync};
/** What one message of an intake group records once its group's transaction commits, or is refused with `refusal`. */
type Settle = (refusal: Refused | undefined) => void | Promise<void>;
type Admission = {readonly facts: string; readonly data: string; commandId?: string};
const factsOf = ({requestId, kind, key, family, command, dataschema, target, data, requestedBy, sentAtMs, deadlineAtMs, traceparent}: Operation): string =>
  canonical({requestId, kind, key, family, command, dataschema, target, data, requestedBy, sentAtMs, deadlineAtMs, traceparent});

export class Tracker {
  readonly #options: TrackerOptions;
  #statements: Statements | undefined;
  #timer: Cancel | undefined;
  #stopped = false;
  #retry = SWEEP_RETRY_MS;
  /** The dispatches and the intake's drain under way, which a stop lets finish. */
  readonly #working = new Set<Promise<unknown>>();
  readonly #admitted = new Map<string, Admission>();
  readonly #validator = new MessageValidator();
  /** Messages the bus delivered that wait for the intake's next group, in delivery order. */
  #waiting: Message<unknown>[] = [];
  /** The intake's drain, while it runs. */
  #draining: Promise<void> | undefined;
  /** Lets the bus deliver again: set while a full group waits, so the bus's own bounded queue holds the rest. */
  #room: (() => void) | undefined;

  constructor(options: TrackerOptions) {
    this.#options = options;
    registerCoreFamilies(this.#validator);
  }

  /** Creates the tracker's table in the core store, once the core holds it. */
  open(database: DatabaseSync): void {
    database.exec(`CREATE TABLE IF NOT EXISTS core_operations (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, deadline_at_ms INTEGER NOT NULL,
        record TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS core_operations_pending ON core_operations (deadline_at_ms) WHERE status IN ('sent', 'accepted')`);
    this.#statements = {
      read: database.prepare('SELECT record FROM core_operations WHERE request_id = ?'),
      insert: database.prepare('INSERT INTO core_operations VALUES (?, ?, ?, ?)'),
      update: database.prepare('UPDATE core_operations SET status = ?, record = ? WHERE request_id = ?'),
      due: database.prepare('SELECT record FROM core_operations WHERE status IN (\'sent\', \'accepted\') AND deadline_at_ms <= ? ORDER BY deadline_at_ms'),
      next: database.prepare('SELECT MIN(deadline_at_ms) AS next FROM core_operations WHERE status IN (\'sent\', \'accepted\')'),
    };
  }

  /**
   * Starts the intake on the core's participant: every published key, states and events in one subscription, so history
   * keeps each participant's messages in the order they were published. The core takes it before its first await, so
   * a module that starts after it and republishes finds it listening. A queue that overflows is recorded.
   */
  start(): Promise<unknown>[] {
    return [this.#options.sdk.subscribe(INTAKE, message => this.#enqueue(message), {onOverflow: ({dropped}) => { this.#overflowed(dropped); }})];
  }

  /**
   * Picks up where a restart left off, once the store is open: every action still pending waits for its deadline, and
   * one already past it ends uncertain now. Nothing is sent again.
   */
  resume(): void {
    this.#schedule();
  }

  /** Stops the deadline timer and lets the dispatches and the intake's group under way finish; messages still waiting are dropped. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#timer?.();
    this.#timer = undefined;
    while (this.#working.size > 0) await Promise.allSettled([...this.#working]);
  }

  /** The tracked action with this request ID, if any. */
  operation(requestId: string): Operation | undefined {
    if (this.#statements === undefined || !this.#options.store.open) return undefined;
    return this.#read(requestId);
  }

  /** See `CoreActions.dispatch`. */
  dispatch(action: Action): Promise<ActionAnswer> {
    return this.#work(this.#dispatch(action).catch((): ActionAnswer => errorBody('internal', {detail: 'the core could not dispatch the action'})));
  }

  /** #923 only: handles the original inbox item atomically with this new sent operation. */
  dispatchFromInbox(action: Action, handle: (tx: CoreTransaction) => ErrorBody | undefined): Promise<ActionAnswer> {
    return this.#work(this.#dispatch(action, false, handle).catch(() => errorBody('internal', {detail: 'the core could not send the inbox command'})));
  }

  /** Admits a tracked operator action; only the gateway holds this entry point. */
  dispatchOperator(action: Action): Promise<ActionAnswer> {
    return this.#work(this.#dispatch(action, true).catch((): ActionAnswer => errorBody('internal', {detail: 'the core could not dispatch the action'})));
  }

  /** Consumes one admission before the responder waits on the core queue, binding its actual command ID. */
  admitOperator(command: Command<object>): boolean {
    const requestId = (command.data as {requestId?: unknown}).requestId;
    if (typeof requestId !== 'string' || command.source !== this.#options.sdk.source || !this.#validator.validate(command).ok) return false;
    const admission = this.#admitted.get(requestId), operation = this.operation(requestId);
    if (admission === undefined || admission.commandId !== undefined || operation === undefined || factsOf(operation) !== admission.facts ||
      command.type !== operation.command || command.subject !== operation.target || command.dataschema !== operation.dataschema ||
      canonical(command.data) !== admission.data) return false;
    admission.commandId = command.id;
    return true;
  }

  /** Ends only the admission bound to this responder; a duplicate cannot retire another command's context. */
  endOperator(command: Command<{requestId: string}>): void {
    if (this.#admitted.get(command.data.requestId)?.commandId === command.id) this.#admitted.delete(command.data.requestId);
  }

  /** Adds the core's validated outcome, operation and tracked hooks inside the owner save transaction. */
  completeCore(tx: CoreTransaction, command: Command<{requestId: string}>, result: Omit<CompletedOutcome, 'requestId'>): () => void {
    const {requestId} = command.data;
    const admission = this.#admitted.get(requestId), operation = this.#read(requestId);
    if (admission?.commandId !== command.id || operation === undefined || factsOf(operation) !== admission.facts) throw new Error('operator-admission');
    const outcome = tx.add(`bunny.event.${operation.family}.${operation.target}`, {
      kind: 'outcome', type: operation.command.replace(/\.requested$/, '.completed'), subject: operation.target,
      dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {...result, requestId},
    }, {parent: command}) as Message<CompletedOutcome>;
    const checked = this.#validator.validate(outcome);
    if (!checked.ok) throw new Error('invalid-core-outcome');
    const next = advance({...operation, responder: this.#options.sdk.source}, {type: 'outcome', outcome: {
      source: outcome.source, id: outcome.id, result: outcome.data.result, evidence: outcome.data.evidence, atMs: tx.atMs,
      ...(outcome.data.error === undefined ? {} : {error: outcome.data.error}),
    }});
    if (next === undefined) throw new Error('operator-completion');
    this.#write(next);
    this.#changed(tx, 'outcome', {operation: next, previous: operation, outcome}, {source: outcome.source, id: outcome.id});
    return () => { this.#completed(next, outcome.data); this.#schedule(); };
  }

  #work<T>(work: Promise<T>): Promise<T> {
    this.#working.add(work);
    void work.finally(() => { this.#working.delete(work); }).catch(() => {});
    return work;
  }

  async #dispatch(input: Action, operator = false, handleInbox?: (tx: CoreTransaction) => ErrorBody | undefined): Promise<ActionAnswer> {
    // Capture before the first await: a caller retains its original objects while admission waits.
    const action: Action = {...input, draft: {...input.draft, data: structuredClone(input.draft.data)},
      ...(input.parent === undefined ? {} : {parent: {...input.parent}})};
    const {sdk, clock, store, ready} = this.#options;
    const requestId = action.requestId ?? randomUUID();
    const refuse = (code: ErrorCode, detail: string): ErrorBody => {
      const body = errorBody(code, {...ID.test(requestId) ? {requestId} : {}, detail});
      this.#record(levelOf(code), 'command.rejected', {'bunny.participant': action.requestedBy, ...requestField(requestId), 'bunny.outcome': 'rejected', ...refusedFields(code)});
      return body;
    };
    const parsed = KEY.exec(action.key);
    const family = parsed?.[1], target = parsed?.[2];
    const {draft} = action;
    if (family === undefined || target === undefined) return refuse('invalid-request', 'an action is a command on a key bunny.cmd.<family>.<target>');
    if (DIRECT_COMMANDS.includes(family)) return refuse('invalid-request', 'the core\'s operator commands are not tracked actions; send them as they are');
    if (OPERATOR_ACTIONS.includes(family) !== operator) return refuse('forbidden', 'this action requires its dedicated operator admission');
    if (!ID.test(requestId)) return refuse('invalid-request', 'a request ID is 1 to 128 letters, digits, underscores, dots or hyphens');
    if (draft.subject !== target) return refuse('invalid-message', 'a command\'s subject is its key\'s last token');
    if (!COMMAND_TYPE.test(draft.type) || typeof draft.dataschema !== 'string' || typeof draft.data !== 'object' || draft.data === null || Array.isArray(draft.data)) {
      return refuse('invalid-request', 'an action is a command: a type org.bunny.<entity>.<verb>.requested, a dataschema and an object payload');
    }
    await ready;
    if (this.#stopped || this.#statements === undefined || !store.open) return refuse('unavailable', 'the core is not taking actions now');
    const kind = kindOf(family);
    const data = withoutRequestId(draft.data);
    // The dispatcher serves the action as a request of its own: a server span, which the command's request continues.
    const fields = {'bunny.participant': action.requestedBy, 'bunny.routing.key': action.key, ...requestField(requestId)};
    const served = startSpan(this.#options.trace, 'bunny.command.request', {kind: 'server', parent: action.parent, attributes: fields});
    const span = served.context;
    const now = clock.now();
    const sent: Operation = {
      requestId, kind, key: action.key, family, command: draft.type, dataschema: draft.dataschema, target, data, requestedBy: action.requestedBy,
      status: 'sent', outcomes: [], sentAtMs: now, deadlineAtMs: now + DEADLINES[kind].outcomeMs, updatedAtMs: now, traceparent: span.traceparent,
    };
    // Recorded as sent before anything is sent: a refused commit sends nothing, and a crash after it leaves the action
    // pending, so it ends uncertain at its deadline and is never sent again.
    let earlier: Operation | undefined;
    try {
      earlier = await this.#transaction(tx => {
        const known = this.#read(requestId);
        if (known !== undefined) return known;
        const handled = handleInbox?.(tx);
        if (handled !== undefined) throw new Refused(handled.error.code, handled.error.detail ?? 'inbox handling refused');
        this.#required().insert.run(requestId, sent.status, sent.deadlineAtMs, JSON.stringify(sent));
        this.#changed(tx, 'sent', {operation: sent, previous: undefined});
        return undefined;
      });
    } catch (error) {
      served.end();
      const refusal = error instanceof Refused ? error : new Refused('internal', 'the core store failed');
      return refuse(refusal.code, refusal.detail);
    }
    if (earlier !== undefined) {
      served.end();
      return this.#again(earlier, action, data);
    }
    const admission: Admission | undefined = operator ? {facts: factsOf(sent), data: canonical({...data, requestId})} : undefined;
    if (admission !== undefined) this.#admitted.set(requestId, admission);
    this.#schedule();
    this.#record('info', 'command.queued', {...fields, 'bunny.outcome': 'queued'}, span);
    let result: RequestResult;
    try {
      result = await sdk.request(action.key, {...draft, data}, {timeoutMs: DEADLINES[kind].replyMs, requestId, parent: span});
    } finally {
      // A running responder owns cleanup even after the SDK deadline; a waiting command can no longer be admitted.
      if (admission !== undefined && admission.commandId === undefined && this.#admitted.get(requestId) === admission) this.#admitted.delete(requestId);
    }
    served.end(result.status === 'uncertain' ? 'error' : 'unset');
    const replied = await this.#apply(requestId, replyEvent(result, clock.now()));
    const answer: ActionAnswer = result.status === 'accepted' ? {status: 'accepted', requestId} : result.error;
    if (replied === undefined) return answer;
    if (result.status === 'accepted') this.#record('info', 'command.admitted', {...fields, 'bunny.outcome': 'accepted'}, span);
    else if (result.status === 'rejected') this.#record(levelOf(result.error.error.code), 'command.rejected', {...fields, 'bunny.outcome': 'rejected', ...refusedFields(result.error.error.code)}, span);
    else this.#record('warn', 'command.completed', {...fields, 'bunny.outcome': 'uncertain', 'bunny.code': 'uncertain-result'}, span);
    return answer;
  }

  /**
   * A request ID already in use. The same caller asking for the same action again gets what that action got, and
   * nothing is sent again; anyone or anything else is `duplicate-conflict`.
   */
  #again(earlier: Operation, action: Action, data: Record<string, unknown>): ActionAnswer {
    const {requestId} = earlier;
    const same = earlier.requestedBy === action.requestedBy && earlier.key === action.key && earlier.command === action.draft.type &&
      earlier.dataschema === action.draft.dataschema && canonical(earlier.data) === canonical(data);
    const fields = {'bunny.participant': action.requestedBy, ...requestField(requestId)};
    if (!same) {
      this.#record('warn', 'command.rejected', {...fields, 'bunny.outcome': 'rejected', ...refusedFields('duplicate-conflict')}, earlier);
      return errorBody('duplicate-conflict', {requestId, detail: 'another action already used this request ID'});
    }
    this.#record('info', 'command.completed', {...fields, 'bunny.outcome': 'duplicate'}, earlier);
    if (earlier.reply === 'accepted') return {status: 'accepted', requestId};
    if (earlier.reply !== undefined && earlier.error !== undefined && (earlier.status === 'rejected' || earlier.status === 'expired')) return {error: earlier.error};
    return errorBody('uncertain-result', {requestId, detail: 'the action with this request ID has no known reply; it is never sent again'});
  }

  /**
   * Hands one delivered message to the intake, which takes it in its next group. While a full group waits, the bus
   * waits too, so its own bounded queue holds the rest and reports an overflow.
   */
  #enqueue(message: Message<unknown>): Promise<void> | undefined {
    if (this.#stopped || message.source === this.#options.sdk.source || !wellFormed(message) || !kept(message)) return undefined;
    this.#waiting.push(message);
    if (this.#draining === undefined) this.#draining = this.#work(this.#drain());
    if (this.#waiting.length < GROUP_MESSAGES) return undefined;
    return new Promise(resolve => { this.#room = resolve; });
  }

  /** Takes the waiting messages into history, a group at a time with a turn of the event loop before each, until none wait. */
  async #drain(): Promise<void> {
    const {ready, store} = this.#options;
    try {
      await ready;
      while (this.#waiting.length > 0) {
        // What the bus delivers until the next turn joins this group, and between groups the event loop runs.
        await nextTurn();
        if (this.#stopped || this.#statements === undefined || !store.open) break;
        await this.#group();
        this.#makeRoom();
      }
    } catch {
      // A core that failed to start takes nothing; its failure is recorded where it happened.
    } finally {
      // Empty unless the intake stopped, the store is not open or the core failed: what still waits is dropped.
      this.#waiting = [];
      this.#makeRoom();
      this.#draining = undefined;
    }
  }

  /** Lets the bus deliver to the intake again, if it waits. */
  #makeRoom(): void {
    const room = this.#room;
    this.#room = undefined;
    room?.();
  }

  /**
   * Takes one group into history in one transaction: the waiting messages, up to `GROUP_MESSAGES` or `GROUP_BUDGET_MS`
   * of work, or `only` alone. Each message keeps its own verdict and records it once the transaction ends. A full disk
   * refuses the whole group, as it would each message; any other failure takes the group's messages again one at a
   * time, so a faulty one is refused alone.
   */
  async #group(only?: Message<unknown>): Promise<void> {
    const taken: Message<unknown>[] = [];
    const settles: Settle[] = [];
    let refusal: Refused | undefined;
    try {
      await this.#transaction(tx => {
        const began = performance.now();
        const next = (): Message<unknown> | undefined => {
          if (only !== undefined) return taken.length === 0 ? only : undefined;
          if (taken.length >= GROUP_MESSAGES || (taken.length > 0 && performance.now() - began >= GROUP_BUDGET_MS)) return undefined;
          return this.#waiting.shift();
        };
        // The group's own new messages, by (source, id): history holds them only once the group commits.
        const group = new Map<string, Message<unknown>>();
        for (let message = next(); message !== undefined; message = next()) {
          taken.push(message);
          settles.push(this.#verdict(tx, message, group));
        }
      });
    } catch (error) {
      refusal = error instanceof Refused ? error : new Refused('internal', 'the core store failed');
    }
    if (refusal !== undefined && refusal.code === 'internal' && taken.length > 1) {
      for (const message of taken) {
        if (this.#stopped) return;
        await nextTurn();
        await this.#group(message);
      }
      return;
    }
    for (const [index, message] of taken.entries()) {
      const settle = settles[index];
      // A message whose own work failed has no verdict: it is refused with its group.
      if (settle === undefined) this.#refused(message, intakeFields(message), refusal?.code ?? 'internal');
      else await settle(refusal);
    }
  }

  /**
   * One message's verdict, in its group's transaction: what it writes there, and what it records once the transaction
   * commits or is refused. An outcome, occurrence or removal is taken once by `(source, id)`; a state is recorded as what
   * changed.
   */
  #verdict(tx: CoreTransaction, message: Message<unknown>, group: Map<string, Message<unknown>>): Settle {
    const {store} = this.#options;
    if (message.kind === 'state') {
      // A state needs no duplicate check: history keeps only what changed, so a copy adds nothing. It has no record.
      tx.record(message);
      return () => {};
    }
    const fields = intakeFields(message);
    const key = `${message.source} ${message.id}`;
    const earlier = group.get(key);
    const verdict = earlier === undefined ? store.history.received(message) : compareDelivery(earlier, message);
    if (verdict === 'duplicate') {
      // A copy of a message this group takes stands or falls with it, and the first one's acknowledgment covers both.
      if (earlier !== undefined) return refusal => { if (refusal === undefined) this.#duplicate(message, fields); else this.#refused(message, fields, refusal.code); };
      // One that history holds needs no durable work, and an outcome is acknowledged again, so a lost acknowledgment recovers.
      return async () => {
        this.#duplicate(message, fields);
        if (message.kind === 'outcome') await this.#acknowledge(message);
      };
    }
    if (verdict === 'conflict') {
      // A faulty message, never a conflicting outcome: refused, kept for diagnosis, with no acknowledgment and no change.
      store.history.refuse(message, tx.atMs);
      return () => { this.#refused(message, fields, 'duplicate-conflict'); };
    }
    if (message.kind === 'outcome' && !isOutcome(message.data)) return () => { this.#refused(message, fields, 'invalid-message'); };
    group.set(key, message);
    if (message.kind !== 'outcome') {
      tx.record(message);
      return refusal => { this.#settled(message, fields, refusal); };
    }
    const outcome = message as Message<CompletedOutcome>;
    const advanced = this.#outcome(tx, outcome);
    return refusal => {
      this.#settled(message, fields, refusal);
      if (refusal === undefined && advanced !== undefined) this.#completed(advanced, outcome.data);
    };
  }

  /**
   * A new outcome, in its group's transaction: history keeps it, the action it completes advances, and the core's
   * acknowledgment is added, to go out once the transaction commits. A refused commit sends none, so the module keeps
   * the outcome and sends it again. Returns the action it advanced, if any.
   */
  #outcome(tx: CoreTransaction, outcome: Message<CompletedOutcome>): Operation | undefined {
    const {data} = outcome;
    tx.record(outcome);
    const operation = this.#read(data.requestId);
    let advanced: Operation | undefined;
    if (operation !== undefined && completes(operation, outcome)) {
      const taken: TakenOutcome = {
        source: outcome.source, id: outcome.id, result: data.result, evidence: data.evidence, atMs: tx.atMs, ...(data.error === undefined ? {} : {error: data.error}),
      };
      advanced = advance(operation, {type: 'outcome', outcome: taken});
      if (advanced !== undefined) {
        this.#write(advanced);
        this.#changed(tx, 'outcome', {operation: advanced, previous: operation, outcome}, {source: outcome.source, id: outcome.id});
      }
    }
    const {key, draft} = acknowledgmentOf(outcome);
    tx.add(key, draft, {parent: outcome});
    return advanced;
  }

  /** An outcome, occurrence or removal the group took: accepted work at INFO once it commits, or refused with the commit. */
  #settled(message: Message<unknown>, fields: LogFields, refusal: Refused | undefined): void {
    if (refusal === undefined) this.#record('info', 'message.received', {...fields, 'bunny.outcome': 'accepted'}, message);
    else this.#refused(message, fields, refusal.code);
  }

  /**
   * A duplicate's intake record: a duplicate outcome is a recovery of its acknowledgment, at INFO; any other duplicate,
   * as a crash's resend, is a duplicate observation, at DEBUG.
   */
  #duplicate(message: Message<unknown>, fields: LogFields): void {
    this.#record(message.kind === 'outcome' ? 'info' : 'debug', 'message.received', {...fields, 'bunny.outcome': 'duplicate'}, message);
  }

  /** Acknowledges an outcome history already holds again, directly, with no durable work. */
  async #acknowledge(outcome: Message<unknown>): Promise<void> {
    const {key, draft} = acknowledgmentOf(outcome);
    await this.#options.sdk.publish(key, draft, {parent: outcome}).catch(() => {});
  }

  /** A refused message's intake record, at its code's level. */
  #refused(message: Message<unknown>, fields: LogFields, code: ErrorCode): void {
    this.#record(levelOf(code), 'message.received', {...fields, 'bunny.outcome': 'rejected', ...refusedFields(code)}, message);
  }

  /**
   * The bus dropped messages for the intake, whose queue was full, so history misses them. An outcome is not lost: its
   * module's outbox keeps it until acknowledged and sends it again at its next start. An occurrence or a removal is, and
   * a state's change shows in its entity's next one.
   */
  #overflowed(dropped: number | undefined): void {
    this.#record(levelOf('capacity'), 'operation.failed', {
      'bunny.operation': 'storage', 'bunny.outcome': 'failed', 'bunny.pattern': INTAKE, ...refusedFields('capacity'),
      ...(dropped === undefined ? {} : {'bunny.delivery.dropped_count': dropped}),
    });
  }

  /** The record of an outcome that advanced an action: INFO for success, WARN for a failed, uncertain or conflicting result. */
  #completed(operation: Operation, data: CompletedOutcome): void {
    const level = operation.result === 'succeeded' ? 'info' : 'warn';
    this.#record(level, 'command.completed', {
      'bunny.participant': operation.requestedBy, ...requestField(operation.requestId), 'bunny.outcome': data.result,
      ...(data.error === undefined ? {} : {'bunny.code': data.error.code}),
    }, operation);
  }

  /** Applies one event to the action in its own transaction; resolves with the change, or undefined when none. */
  async #apply(requestId: string, event: OperationEvent): Promise<{previous: Operation; next: Operation} | undefined> {
    try {
      return await this.#transaction(tx => {
        const operation = this.#read(requestId);
        const next = operation === undefined ? undefined : advance(operation, event);
        if (operation === undefined || next === undefined) return undefined;
        this.#write(next);
        this.#changed(tx, event.type, {operation: next, previous: operation});
        return {previous: operation, next};
      });
    } catch {
      // The action stays as it was stored: still pending, it ends uncertain at its deadline.
      return undefined;
    }
  }

  /** History's step for a change, and each part's rows for it, in the change's transaction. */
  #changed(tx: CoreTransaction, event: OperationStep['event'], change: OperationChange, outcome?: {source: string; id: string}): void {
    const {operation} = change;
    const step: OperationStep = {
      event, requestId: operation.requestId, kind: operation.kind, command: operation.command, target: operation.target, requestedBy: operation.requestedBy,
      status: operation.status, ...(operation.reply === undefined ? {} : {reply: operation.reply}), ...(operation.result === undefined ? {} : {result: operation.result}),
      ...(operation.evidence === undefined ? {} : {evidence: operation.evidence}), ...(operation.error === undefined ? {} : {error: operation.error}),
      ...(outcome === undefined ? {} : {outcome}),
    };
    tx.step(step);
    for (const tracked of this.#options.tracked ?? []) tracked(change, tx);
  }

  /** Runs `work` in one core transaction; a refusal says why: a full disk is `unavailable` with `storage-full`. */
  async #transaction<R>(work: (tx: CoreTransaction) => R): Promise<R> {
    const {store, storage} = this.#options;
    // A store that is not open, or whose database a crash closed, takes nothing; it is not a store failure.
    if (!store.open) throw new Refused('unavailable', 'the core store is not open');
    try {
      const result = await store.transaction(work);
      storage?.recovered();
      return result;
    } catch (error) {
      if (error instanceof Refused) throw error;
      const full = store.takeFailure() === 'full';
      storage?.failed(full ? 'unavailable' : 'internal');
      throw full ? new Refused('unavailable', 'storage-full') : new Refused('internal', 'the core store failed');
    }
  }

  #required(): Statements {
    if (this.#statements === undefined) throw new Refused('unavailable', 'the core store is not open');
    return this.#statements;
  }

  #read(requestId: string): Operation | undefined {
    const row = this.#required().read.get(requestId) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as Operation;
  }

  #write(operation: Operation): void {
    this.#required().update.run(operation.status, JSON.stringify(operation), operation.requestId);
  }

  /** Arms one timer for the earliest pending deadline. */
  #schedule(): void {
    this.#timer?.();
    this.#timer = undefined;
    if (this.#stopped || this.#statements === undefined || !this.#options.store.open) return;
    const {next} = this.#statements.next.get() as {next: number | null};
    if (next === null) return;
    const delay = Math.min(MAX_DELAY_MS, Math.max(0, next - this.#options.clock.now()));
    this.#timer = this.#options.scheduler.after(delay, () => this.#work(this.#sweep()));
  }

  /** Every pending action past its deadline ends uncertain, in one transaction; a refused commit tries again later. */
  async #sweep(): Promise<void> {
    if (this.#stopped || this.#statements === undefined || !this.#options.store.open) return;
    const atMs = this.#options.clock.now();
    let ended: Operation[];
    try {
      ended = await this.#transaction(tx => {
        const due = (this.#required().due.all(atMs) as {record: string}[]).map(row => JSON.parse(row.record) as Operation);
        const changed: Operation[] = [];
        for (const operation of due) {
          const next = advance(operation, {type: 'deadline', atMs});
          if (next === undefined) continue;
          this.#write(next);
          this.#changed(tx, 'deadline', {operation: next, previous: operation});
          changed.push(next);
        }
        return changed;
      });
    } catch {
      if (this.#stopped) return;
      const delay = this.#retry;
      this.#retry = Math.min(SWEEP_RETRY_MAX_MS, this.#retry * 2);
      this.#timer = this.#options.scheduler.after(delay, () => this.#work(this.#sweep()));
      return;
    }
    this.#retry = SWEEP_RETRY_MS;
    for (const operation of ended) {
      this.#record('warn', 'command.completed', {
        'bunny.participant': operation.requestedBy, ...requestField(operation.requestId), 'bunny.outcome': 'uncertain', 'bunny.code': 'uncertain-result',
        'bunny.reason': 'timeout',
      }, operation);
    }
    this.#schedule();
  }

  /** Writes one record in the action's trace; a logger that throws loses it. */
  #record(level: 'debug' | 'info' | 'warn' | 'error', event: string, fields: LogFields, trace?: TraceContext): void {
    try {
      this.#options.log[level](event, fields, trace === undefined ? undefined : {traceparent: trace.traceparent});
    } catch {
      // Telemetry is never acknowledged.
    }
  }
}

/**
 * Whether `outcome` completes `operation`: the same target, the command's own outcome type, and, once the owner
 * replied, from that owner. An outcome that does not is kept in history and acknowledged, and changes no action.
 */
function completes(operation: Operation, outcome: Message<CompletedOutcome>): boolean {
  return outcome.subject === operation.target && outcome.type === operation.command.replace(/\.requested$/, '.completed') &&
    (operation.responder === undefined || operation.responder === outcome.source);
}

/** The tracker's event for how a request ended. */
function replyEvent(result: RequestResult, atMs: number): OperationEvent {
  switch (result.status) {
    case 'accepted':
      return {type: 'reply', status: 'accepted', responder: result.reply.source, atMs};
    case 'rejected':
      return {type: 'reply', status: 'rejected', error: result.error.error, ...(result.reply === undefined ? {} : {responder: result.reply.source}), atMs};
    case 'uncertain':
      return {type: 'reply', status: 'uncertain', error: result.error.error, atMs};
  }
}
