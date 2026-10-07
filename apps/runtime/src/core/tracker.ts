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
// - Deadlines: one timer for the earliest pending action. A restart loads every pending action and lets its deadline
//   pass: it ends uncertain, and a late outcome still completes it.
// - Every step is logged once, in the action's trace, and `message.received` carries the incoming message's trace.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {errorBody, type ErrorBody, type ErrorCode, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  acknowledgmentOf, levelOf, startSpan, type Cancel, type Clock, type CommandDraft, type LogFields, type Logger, type ModuleScheduler, type RequestResult,
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
export const DIRECT_COMMANDS: readonly string[] = Object.freeze(['approval-recover', 'notice-acknowledge']);

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

export class Tracker {
  readonly #options: TrackerOptions;
  #statements: Statements | undefined;
  #timer: Cancel | undefined;
  #stopped = false;
  #retry = SWEEP_RETRY_MS;
  /** The dispatches and intakes under way, which a stop lets finish. */
  readonly #working = new Set<Promise<unknown>>();

  constructor(options: TrackerOptions) {
    this.#options = options;
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
   * a module that starts after it and republishes finds it listening.
   */
  start(): Promise<unknown>[] {
    return [this.#options.sdk.subscribe('bunny.*.*.*', message => this.#work(this.#take(message)))];
  }

  /**
   * Picks up where a restart left off, once the store is open: every action still pending waits for its deadline, and
   * one already past it ends uncertain now. Nothing is sent again.
   */
  resume(): void {
    this.#schedule();
  }

  /** Stops the deadline timer and lets the dispatches and intakes under way finish. */
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

  #work<T>(work: Promise<T>): Promise<T> {
    this.#working.add(work);
    void work.finally(() => { this.#working.delete(work); }).catch(() => {});
    return work;
  }

  async #dispatch(action: Action): Promise<ActionAnswer> {
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
    this.#schedule();
    this.#record('info', 'command.queued', {...fields, 'bunny.outcome': 'queued'}, span);
    const result = await sdk.request(action.key, {...draft, data}, {timeoutMs: DEADLINES[kind].replyMs, requestId, parent: span});
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

  /** Takes one message into history. The intake never fails the core: what it cannot take is recorded and dropped. */
  async #take(message: Message<unknown>): Promise<void> {
    try {
      await this.#intake(message);
    } catch {
      this.#record('error', 'message.received', {...messageFields(message), 'bunny.outcome': 'rejected', 'bunny.code': 'internal'}, message);
    }
  }

  /**
   * One message another participant published, into history: an outcome, occurrence or removal once by `(source, id)`,
   * and a state as what changed.
   */
  async #intake(message: Message<unknown>): Promise<void> {
    const {sdk, store, ready, log} = this.#options;
    if (message.source === sdk.source || !wellFormed(message) || !kept(message)) return;
    await ready;
    if (this.#stopped || this.#statements === undefined || !store.open) return;
    if (message.kind === 'state') {
      // A state needs no duplicate check: history keeps only what changed, so a copy adds nothing.
      await this.#transaction(tx => { tx.record(message); }).catch(() => {});
      return;
    }
    const verdict = store.history.received(message);
    const fields: LogFields = {...messageFields(message), ...message.kind === 'outcome' && isOutcome(message.data) ? requestField(message.data.requestId) : {}};
    if (verdict === 'duplicate') {
      // A duplicate outcome is acknowledged again, so a lost acknowledgment recovers: a recovery, at INFO. Any other
      // duplicate, as a crash's resend, is a duplicate observation, at DEBUG. Neither needs durable work.
      if (message.kind !== 'outcome') {
        log.debug('message.received', {...fields, 'bunny.outcome': 'duplicate'}, message);
        return;
      }
      log.info('message.received', {...fields, 'bunny.outcome': 'duplicate'}, message);
      const {key, draft} = acknowledgmentOf(message);
      await sdk.publish(key, draft, {parent: message}).catch(() => {});
      return;
    }
    if (verdict === 'conflict') {
      // A faulty message, never a conflicting outcome: refused, kept for diagnosis, with no acknowledgment and no change.
      log.warn('message.received', {...fields, 'bunny.outcome': 'rejected', ...refusedFields('duplicate-conflict')}, message);
      await this.#transaction(tx => { store.history.refuse(message, tx.atMs); }).catch(() => {});
      return;
    }
    if (message.kind !== 'outcome') {
      // An occurrence or removal taken once is accepted work, at INFO; a state's change is recorded without a record.
      await this.#transaction(tx => { tx.record(message); }).then(() => {
        log.info('message.received', {...fields, 'bunny.outcome': 'accepted'}, message);
      }, (error: unknown) => {
        log.info('message.received', {...fields, 'bunny.outcome': 'rejected', ...refusedFields(error instanceof Refused ? error.code : 'internal')}, message);
      });
      return;
    }
    await this.#outcome(message, fields);
  }

  /**
   * A new outcome: history keeps it, the action it completes advances, and the core acknowledges it, all in one
   * transaction. A refused commit sends no acknowledgment, so the module keeps the outcome and sends it again.
   */
  async #outcome(message: Message<unknown>, fields: LogFields): Promise<void> {
    const {log} = this.#options;
    if (!isOutcome(message.data)) {
      log.info('message.received', {...fields, 'bunny.outcome': 'rejected', ...refusedFields('invalid-message')}, message);
      return;
    }
    const data = message.data;
    const outcome = message as Message<CompletedOutcome>;
    let change: {previous: Operation; next: Operation} | undefined;
    try {
      change = await this.#transaction(tx => {
        tx.record(outcome);
        const operation = this.#read(data.requestId);
        let advanced: {previous: Operation; next: Operation} | undefined;
        if (operation !== undefined && completes(operation, outcome)) {
          const taken: TakenOutcome = {
            source: outcome.source, id: outcome.id, result: data.result, evidence: data.evidence, atMs: tx.atMs, ...(data.error === undefined ? {} : {error: data.error}),
          };
          const next = advance(operation, {type: 'outcome', outcome: taken});
          if (next !== undefined) {
            this.#write(next);
            this.#changed(tx, 'outcome', {operation: next, previous: operation, outcome}, {source: outcome.source, id: outcome.id});
            advanced = {previous: operation, next};
          }
        }
        // Acknowledged once the outcome commits: the acknowledgment goes out after the commit, from the core.
        const {key, draft} = acknowledgmentOf(outcome);
        tx.add(key, draft, {parent: outcome});
        return advanced;
      });
    } catch (error) {
      log.info('message.received', {...fields, 'bunny.outcome': 'rejected', ...refusedFields(error instanceof Refused ? error.code : 'internal')}, message);
      return;
    }
    log.info('message.received', {...fields, 'bunny.outcome': 'accepted'}, message);
    if (change !== undefined) this.#completed(change.next, data);
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
    try {
      const result = await store.transaction(work);
      storage?.recovered();
      return result;
    } catch {
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

