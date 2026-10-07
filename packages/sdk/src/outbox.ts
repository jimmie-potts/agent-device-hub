// The per-module outbox (ADR 0012, "Ownership and publication"). A module's messages commit in its own SQLite
// transaction together with the change they report, and go out only after the commit, unchanged, with the `id`,
// `time` and trace context they were stored with. Committed is not published: a publish refused after the commit leaves
// the work standing and its messages stored, the refusal is reported as committed and awaiting publication, and the
// next transaction or start sends them. A message that a crash kept from going out goes out at the next start. An
// outcome is kept until the core acknowledges it and goes out again at every start until then; the core drops
// duplicates by `(source, id)`, so a crash or a failed core never loses an outcome. The outbox follows the core's
// acknowledgments itself (Hub #782): it forgets an outcome only when the core, as the sender, says it recorded it, so a
// lost or forged acknowledgment never discards one. A command never goes in.
//
// What went out is forgotten, or for an outcome marked published, in one commit per publication batch once its sends
// settle (Hub #972), at the connection's own `synchronous` level, so a power loss never undoes it: each commit is a sync
// to disk on the event loop. That commit is the one point at which a state, removal or occurrence that went out can go
// out again: a crash between a batch's sends and its commit sends the batch again at the next start, and a failed commit
// sends it again with the next send, with the same `id`s. In process, the sends and the commit run in one turn of the
// event loop; through a remote edge, the window spans the sends. Otherwise a restart replays no state or occurrence.
// Given the module's log and tracing (Hub #949), the outbox records an outcome's first publication at most once, a
// deferral once per run of refusals, and a publish span for each outcome it sends. One outbox serves one database
// connection.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MAX_DETAIL, errorBody, type ErrorCode, type Message, type MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {acknowledgment, outcomeRecordedKey} from './acknowledgment.js';
import {buildMessage} from './envelope.js';
import type {ErrorScope} from './in-process.js';
import type {LogFields, Logger} from './module.js';
import {keyClassOf, parseKey} from './routing.js';
import {SdkError, type Clock, type Draft, type Sdk, type SendOptions, type TraceContext} from './sdk.js';
import {noSpans, startSpan, type SpanRecorder} from './spans.js';
import {childOf} from './trace.js';

export type OutboxOptions = {
  /**
   * The module's participant. The outbox sends with `publishMessage`, so a message keeps its stored `id` and `time`.
   * With `subscribe`, as a module's own participant has, `republish` first follows the core's acknowledgments of the
   * module's outcomes on `bunny.event.outcome-recorded.<module>` and forgets each outcome the core recorded (Hub #782).
   */
  sdk: Pick<Sdk, 'source' | 'publishMessage'> & Partial<Pick<Sdk, 'subscribe'>>;
  /** The module's own SQLite database. The outbox keeps its messages in the table `bunny_outbox`. */
  database: DatabaseSync;
  /** The clock for each message's `time`: the module's. */
  clock: Clock;
  /**
   * Checks each message as `add` stores it, for example with the validator of the remote edge the participant sends
   * through. A message it refuses throws `SdkError` with the validator's code and rolls the transaction back, so a
   * message the edge would always refuse never waits in the outbox. Without it, `add` checks only the kind and key. A
   * remote part's outbox passes `edgeValidator(schemas)`, the edge's own checks, so a refused message never holds back
   * the outcomes behind it (Hub #782).
   */
  validator?: Pick<MessageValidator, 'validate'>;
  /**
   * Hears that a publish was refused after its transaction committed, when the outbox has no `log`: an `SdkError` with
   * the refusal's registry code (`internal` for an error without one) and the fixed detail
   * `committed, awaiting publication`, with the refusal as its `cause`, and the scope `{source, pattern: 'outbox'}`. It
   * hears once per run of refusals: again only after a send goes through or the code changes. Defaults to a
   * `BunnySdkWarning` process warning with that code and fixed detail, never the refusal's message.
   */
  onError?: (error: unknown, scope: ErrorScope) => void;
  /**
   * The module's logger (Hub #949). With it, the outbox records an outcome's first publication once, as
   * `outcome.published` (INFO, or WARN for a failed or uncertain one), and a refused publish once per run of refusals,
   * as `outbox.deferred` (WARN) with the refusal's code and `bunny.outbox.waiting_count`, in place of `onError`. A replay
   * records nothing. It also records each outcome the core's acknowledgment made it forget, as `outbox.acknowledged`
   * (INFO), and an acknowledgment from any other sender, which it ignores, as `message.received` (WARN, `forbidden`).
   */
  log?: Logger;
  /**
   * The module's tracing. With it, each outcome sent gets a `bunny.outcome.publish` span: the stored context's child when
   * the same transaction stored it, and otherwise, after a restart or a deferred publish, a new root linked to it.
   */
  trace?: SpanRecorder;
};

/** Stores one message in the current transaction and returns it as it will be published. */
export type AddMessage = <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => Message<T>;
/** A result that is not a promise: the work runs inside a synchronous SQLite transaction. */
export type Synchronous<R> = R extends PromiseLike<unknown> ? never : R;

type Row = {seq: number; routing_key: string; message: string; kind: string; published: number};
/** A row that went out in the current publication batch, with its message, stored trace context and whether its first publication is recorded. */
type Sent = {row: Row; message: Message; stored: TraceContext; recorded: boolean};
type Level = 'info' | 'warn';
const OUTCOMES: readonly unknown[] = ['succeeded', 'failed', 'uncertain'];
const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
const AWAITING = 'committed, awaiting publication';

const refusal = (code: ErrorCode, detail: string): SdkError => new SdkError(errorBody(code, {detail: detail.slice(0, MAX_DETAIL)}));
/** The default report of a deferral: its code and the outbox's fixed detail, never the refusal's own message. */
const warn = (error: unknown, scope: ErrorScope): void => {
  const reason = error instanceof SdkError ? `${error.body.error.code}: ${AWAITING}` : AWAITING;
  const warning = new Error(`${scope.source} on ${scope.pattern}: ${reason}`, {cause: error});
  warning.name = 'BunnySdkWarning';
  process.emitWarning(warning);
};
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'then' in value && typeof value.then === 'function';

export class Outbox {
  readonly #sdk: OutboxOptions['sdk'];
  readonly #database: DatabaseSync;
  readonly #clock: Clock;
  readonly #validator: Pick<MessageValidator, 'validate'> | undefined;
  readonly #onError: (error: unknown, scope: ErrorScope) => void;
  readonly #log: Logger | undefined;
  readonly #trace: SpanRecorder;
  /** The code of the refusal last reported, until a send goes through. */
  #refused: ErrorCode | undefined;
  readonly #insert: StatementSync;
  readonly #unpublished: StatementSync;
  readonly #stored: StatementSync;
  readonly #published: StatementSync;
  readonly #forget: StatementSync;
  readonly #acknowledge: StatementSync;
  readonly #waiting: StatementSync;
  /**
   * The rows of the batch under way that went out and are not yet marked or forgotten, by message `id`, so an
   * acknowledgment that lands in between records the outcome's first publication itself.
   */
  readonly #inFlight = new Map<string, Sent>();
  /** Sends run one at a time, so a message never goes out twice in one run or out of order. */
  #sending: Promise<unknown> = Promise.resolve();
  /** The subscription to the core's acknowledgments, once `republish` has asked for it. */
  #following: Promise<unknown> | undefined;

  constructor({sdk, database, clock, validator, onError, log, trace}: OutboxOptions) {
    this.#sdk = sdk;
    this.#database = database;
    this.#clock = clock;
    this.#validator = validator;
    this.#onError = onError ?? warn;
    this.#log = log;
    this.#trace = trace ?? noSpans;
    // `published` is 1 once an outcome has gone out; it stays until acknowledged. Every other message is deleted as
    // soon as it has gone out.
    database.exec(`CREATE TABLE IF NOT EXISTS bunny_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      routing_key TEXT NOT NULL,
      message TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0
    ) STRICT`);
    this.#insert = database.prepare('INSERT INTO bunny_outbox (id, kind, routing_key, message) VALUES (?, ?, ?, ?)');
    this.#unpublished = database.prepare('SELECT seq, routing_key, message, kind, published FROM bunny_outbox WHERE published = 0 ORDER BY seq');
    this.#stored = database.prepare('SELECT seq, routing_key, message, kind, published FROM bunny_outbox ORDER BY seq');
    this.#published = database.prepare('UPDATE bunny_outbox SET published = 1 WHERE seq = ?');
    this.#forget = database.prepare('DELETE FROM bunny_outbox WHERE seq = ?');
    this.#acknowledge = database.prepare('DELETE FROM bunny_outbox WHERE id = ? AND kind = \'outcome\' RETURNING published');
    this.#waiting = database.prepare('SELECT COUNT(*) AS waiting FROM bunny_outbox WHERE published = 0');
  }

  /**
   * Runs `work` in one transaction on the module's database. Each message it adds is stored in that transaction and,
   * after the commit, published in order. A throw rolls back the work and its messages, so nothing goes out, and the
   * promise rejects with it. `work` must be synchronous, and the outbox opens the transaction itself.
   *
   * Once the work commits, the promise resolves with `work`'s result after the publish ends, and never rejects: the
   * work stands, so no caller may take a failed publish for a rollback and do it again (ADR 0012, "Committed is not
   * published"). If publishing is refused, for example because the module is stopping, the refusal is reported as
   * committed and awaiting publication: as `outbox.deferred` through `log`, or to `onError` without one, once per run of
   * refusals. The messages stay stored, unpublished, with their `id`, `time` and trace
   * context, and the next transaction or start sends them, in order. Nothing sends them again on its own. A refusal
   * that lasts, such as a schema the edge does not accept, holds back every later message behind the refused one; the
   * `validator` option keeps such a message out of the outbox.
   */
  transaction<R>(work: (add: AddMessage) => Synchronous<R>): Promise<R> {
    let result: R;
    const own = new Set<string>();
    try {
      result = this.#commit(work, own);
    } catch (error) {
      return Promise.reject(error);
    }
    // A refused publish only delays the messages: they wait, stored, for the next send.
    return this.#send(this.#unpublished, own).then(() => result, (error: unknown) => {
      this.#deferred(error);
      return result;
    });
  }

  /**
   * Publishes again, in order, everything still stored: messages a crash kept from going out, and every outcome the
   * core has not acknowledged. Call it once in the module's start. When the participant can subscribe, it first
   * follows the core's acknowledgments (Hub #782), so that the acknowledgment of an outcome it sends again is heard;
   * each one forgets that outcome, as `acknowledge` does, but only when its sender is the core. Resolves with how many
   * messages went out, or rejects with a refusal, which it passes on to the caller rather than report.
   */
  async republish(): Promise<number> {
    await this.#follow();
    return this.#send(this.#stored);
  }

  /**
   * Forgets the outcome with this message `id`, which the core has recorded, so it is never sent again. True when the
   * outbox still held it. Only outcomes wait for an acknowledgment; any other message is gone once published. An
   * acknowledgment that lands after the outcome went out and before its batch's bookkeeping committed records the
   * outcome's first publication itself, since no later send will.
   */
  acknowledge(id: string): boolean {
    if (!this.#database.isOpen) return false;
    const forgotten = this.#acknowledge.get(id) as {published: number} | undefined;
    if (forgotten === undefined) return false;
    const sent = this.#inFlight.get(id);
    if (forgotten.published === 0 && sent !== undefined && !sent.recorded) {
      sent.recorded = true;
      this.#publication(sent.message, sent.stored);
    }
    return true;
  }

  /** Subscribes once to the core's acknowledgments of this participant's outcomes, when the participant can subscribe. */
  #follow(): Promise<unknown> {
    const sdk = this.#sdk;
    if (sdk.subscribe === undefined) return Promise.resolve();
    const following = this.#following ?? sdk.subscribe(outcomeRecordedKey(sdk.source), message => { this.#heard(message); }).catch((error: unknown) => {
      this.#following = undefined;
      throw error;
    });
    this.#following = following;
    return following;
  }

  /**
   * One message on the acknowledgment key. Only the core's acknowledgment of one of this participant's outcomes forgets
   * it, checked on the sender rather than the payload; any other sender's is ignored and the outcome kept.
   */
  #heard(message: Message): void {
    const heard = acknowledgment(message, this.#sdk.source);
    if (heard === undefined) return;
    if (heard === 'forged') {
      this.#record('warn', 'message.received', {
        ...SOURCE.test(message.source) && message.source.length <= 256 ? {'bunny.participant': message.source} : {}, 'bunny.message.id': message.id,
        'bunny.message.kind': 'occurrence', 'bunny.outcome': 'rejected', 'bunny.code': 'forbidden', 'bunny.reason': 'unauthorized',
      }, message);
      return;
    }
    if (this.acknowledge(heard.id)) this.#record('info', 'outbox.acknowledged', {'bunny.message.id': heard.id}, message);
  }

  /** Commits `work` and its messages; `own` receives the id of each message this transaction stored. */
  #commit<R>(work: (add: AddMessage) => Synchronous<R>, own: Set<string>): R {
    const database = this.#database;
    if (database.isTransaction) throw refusal('invalid-state', 'the outbox opens its own transaction');
    let open = true;
    const add: AddMessage = <T extends object>(key: string, draft: Draft<T>, options: SendOptions = {}): Message<T> => {
      if (!open) throw refusal('invalid-state', 'add a message only inside the outbox\'s transaction');
      // A caller outside TypeScript may pass any kind; the check below refuses all but the published ones.
      const kind: unknown = draft.kind;
      const keyClass = typeof kind === 'string' ? keyClassOf(draft.kind) : undefined;
      if (keyClass === undefined) throw refusal('invalid-request', `a ${String(kind)} message never goes in the outbox`);
      if (parseKey(key)?.category !== keyClass) throw refusal('invalid-request', `a ${draft.kind} message needs a bunny.${keyClass} key, not ${key}`);
      const message = buildMessage(this.#sdk.source, draft.kind, draft, childOf(options.parent), this.#clock.now());
      const text = JSON.stringify(message);
      // What goes out is what was stored, so the first send and every resend are the same message.
      const stored = JSON.parse(text) as Message<T>;
      const checked = this.#validator?.validate(stored);
      if (checked !== undefined && !checked.ok) throw new SdkError({error: checked.error});
      this.#insert.run(message.id, draft.kind, key, text);
      own.add(message.id);
      return stored;
    };
    database.exec('BEGIN IMMEDIATE');
    try {
      const result: unknown = work(add);
      if (isThenable(result)) {
        // Leave the returned promise handled: its outcome no longer matters once the work is refused.
        result.then(undefined, () => {});
        throw new TypeError('the outbox\'s work must be synchronous');
      }
      database.exec('COMMIT');
      return result as R;
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    } finally {
      open = false;
    }
  }

  /**
   * Publishes the rows `query` selects, one after another. An outcome is kept until acknowledged; any other row is
   * deleted once it has gone out. A refusal stops the send, and the rest stay stored. Once the sends settle, what went
   * out is marked or forgotten in one commit, refused or not, and only then is an outcome's first publication recorded.
   * `own` holds the ids the calling transaction stored, whose publish spans continue their stored context; everything
   * else is linked to it.
   */
  #send(query: StatementSync, own: ReadonlySet<string> = new Set()): Promise<number> {
    const sending = this.#sending.then(async () => {
      const sent: Sent[] = [];
      let refusal: {error: unknown} | undefined;
      for (const row of query.all() as Row[]) {
        const message = JSON.parse(row.message) as Message;
        const stored = {traceparent: message.traceparent};
        const span = row.kind === 'outcome' ? startSpan(this.#trace, 'bunny.outcome.publish', {
          kind: 'producer', attributes: {'bunny.message.id': message.id, ...requestOf(message)},
          ...(own.has(message.id) ? {parent: stored} : {links: [stored]}),
        }) : undefined;
        try {
          await this.#sdk.publishMessage(row.routing_key, message);
        } catch (error) {
          span?.end('error');
          refusal = {error};
          break;
        }
        span?.end();
        const entry = {row, message, stored, recorded: false};
        sent.push(entry);
        this.#inFlight.set(message.id, entry);
      }
      try {
        this.#settle(sent);
      } catch (error) {
        // Nothing was marked: what went out goes out again with the next send or start, with the same ids.
        throw refusal === undefined ? error : refusal.error;
      } finally {
        for (const {message} of sent) this.#inFlight.delete(message.id);
      }
      // An outcome's first publication is recorded once its batch committed; a replay of one already published is not.
      for (const entry of sent) {
        if (entry.row.kind !== 'outcome' || entry.row.published !== 0 || entry.recorded) continue;
        entry.recorded = true;
        this.#publication(entry.message, entry.stored);
      }
      if (refusal !== undefined) throw refusal.error;
      this.#refused = undefined;
      return sent.length;
    });
    this.#sending = sending.catch(() => {});
    return sending;
  }

  /**
   * Commits one publication batch's bookkeeping: each state, removal or occurrence that went out is deleted, and each
   * outcome that went out for the first time is marked published. An outcome already marked needs no write, so a
   * republish of outcomes the core has not acknowledged commits nothing. Inside a transaction someone else holds open,
   * the rows join it, as a single statement would.
   */
  #settle(sent: readonly Sent[]): void {
    const changed = sent.filter(({row}) => row.kind !== 'outcome' || row.published === 0);
    if (changed.length === 0) return;
    const database = this.#database;
    const ownTransaction = !database.isTransaction;
    if (ownTransaction) database.exec('BEGIN IMMEDIATE');
    try {
      for (const {row} of changed) (row.kind === 'outcome' ? this.#published : this.#forget).run(row.seq);
      if (ownTransaction) database.exec('COMMIT');
    } catch (error) {
      if (ownTransaction && database.isTransaction) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // The connection's next transaction fails in turn; nothing was marked.
        }
      }
      throw error;
    }
  }

  /**
   * Reports a publish refused after its commit, once per run of refusals with the same code, in one place: as an
   * `outbox.deferred` record through the module's log when there is one, otherwise to `onError`.
   */
  #deferred(error: unknown): void {
    const code = error instanceof SdkError ? error.body.error.code : 'internal';
    if (this.#refused === code) return;
    this.#refused = code;
    if (this.#log !== undefined) {
      this.#record('warn', 'outbox.deferred', {'bunny.code': code, 'bunny.outbox.waiting_count': this.#waitingCount()});
      return;
    }
    try {
      this.#onError(new SdkError(errorBody(code, {detail: AWAITING}), {cause: error}), {source: this.#sdk.source, pattern: 'outbox'});
    } catch {
      // A failing listener must not turn committed work into a failure.
    }
  }

  /** How many stored messages have not gone out yet. */
  #waitingCount(): number {
    if (!this.#database.isOpen) return 0;
    return Number((this.#waiting.get() as {waiting: number}).waiting);
  }

  /** `outcome.published`: INFO for a succeeded outcome, WARN for a failed or uncertain one, in the outcome's own trace. */
  #publication(message: Message, trace: TraceContext): void {
    const data = message.data as {result?: unknown; error?: {code?: unknown}};
    const result = OUTCOMES.includes(data.result) ? {'bunny.outcome': String(data.result)} : {};
    const code = typeof data.error?.code === 'string' ? {'bunny.code': data.error.code} : {};
    const fields = {...requestOf(message), 'bunny.message.id': message.id, ...result, ...code};
    this.#record(data.result === 'succeeded' ? 'info' : 'warn', 'outcome.published', fields, trace);
  }

  /** Writes one record; a logger that throws loses it, and the outbox goes on. */
  #record(level: Level, event: string, fields: LogFields, trace?: TraceContext): void {
    try {
      this.#log?.[level](event, fields, trace);
    } catch {
      // Telemetry is never acknowledged.
    }
  }
}

/** The request ID an outcome names, as a record's field. */
function requestOf(message: Message): LogFields {
  const {requestId} = message.data as {requestId?: unknown};
  return typeof requestId === 'string' ? {'bunny.request.id': requestId} : {};
}
