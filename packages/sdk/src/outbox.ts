// The per-module outbox (ADR 0012, "Ownership and publication"). A module's messages commit in its own SQLite
// transaction together with the change they report, and go out only after the commit, unchanged, with the `id` and
// `time` they were stored with. A message that a crash kept from going out goes out at the next start. An outcome is
// kept until the core acknowledges it and goes out again at every start until then; the core drops duplicates by
// `(source, id)`, so a crash or a failed core never loses an outcome. Nothing else is ever sent again, so a restart
// replays no state or occurrence, and a command never goes in.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MAX_DETAIL, errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from './envelope.js';
import {keyClassOf, parseKey} from './routing.js';
import {SdkError, type Clock, type Draft, type Sdk, type SendOptions} from './sdk.js';
import {childOf} from './trace.js';

export type OutboxOptions = {
  /** The module's participant. The outbox sends with `publishMessage`, so a message keeps its stored `id` and `time`. */
  sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  /** The module's own SQLite database. The outbox keeps its messages in the table `bunny_outbox`. */
  database: DatabaseSync;
  /** The clock for each message's `time`: the module's. */
  clock: Clock;
};

/** Stores one message in the current transaction and returns it as it will be published. */
export type AddMessage = <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => Message<T>;
/** A result that is not a promise: the work runs inside a synchronous SQLite transaction. */
export type Synchronous<R> = R extends PromiseLike<unknown> ? never : R;

type Row = {seq: number; routing_key: string; message: string; kind: string};

const refusal = (code: ErrorCode, detail: string): SdkError => new SdkError(errorBody(code, {detail: detail.slice(0, MAX_DETAIL)}));
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'then' in value && typeof value.then === 'function';

export class Outbox {
  readonly #sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  readonly #database: DatabaseSync;
  readonly #clock: Clock;
  readonly #insert: StatementSync;
  readonly #unpublished: StatementSync;
  readonly #stored: StatementSync;
  readonly #published: StatementSync;
  readonly #forget: StatementSync;
  readonly #acknowledge: StatementSync;
  /** Sends run one at a time, so a message never goes out twice in one run or out of order. */
  #sending: Promise<unknown> = Promise.resolve();

  constructor({sdk, database, clock}: OutboxOptions) {
    this.#sdk = sdk;
    this.#database = database;
    this.#clock = clock;
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
    this.#unpublished = database.prepare('SELECT seq, routing_key, message, kind FROM bunny_outbox WHERE published = 0 ORDER BY seq');
    this.#stored = database.prepare('SELECT seq, routing_key, message, kind FROM bunny_outbox ORDER BY seq');
    this.#published = database.prepare('UPDATE bunny_outbox SET published = 1 WHERE seq = ?');
    this.#forget = database.prepare('DELETE FROM bunny_outbox WHERE seq = ?');
    this.#acknowledge = database.prepare('DELETE FROM bunny_outbox WHERE id = ? AND kind = \'outcome\'');
  }

  /**
   * Runs `work` in one transaction on the module's database. Each message it adds is stored in that transaction and,
   * after the commit, published in order. A throw rolls back the work and its messages, so nothing goes out. `work`
   * must be synchronous, and the outbox opens the transaction itself. Resolves with `work`'s result once the messages
   * are published. If publishing is refused, for example because the module is stopping, the promise rejects although
   * the work has committed; the messages stay stored, and the next transaction or start sends them.
   */
  transaction<R>(work: (add: AddMessage) => Synchronous<R>): Promise<R> {
    let result: R;
    try {
      result = this.#commit(work);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#send(this.#unpublished).then(() => result);
  }

  /**
   * Publishes again, in order, everything still stored: messages a crash kept from going out, and every outcome the
   * core has not acknowledged. Call it once in the module's start, after following the core's acknowledgments.
   * Resolves with how many messages went out.
   */
  republish(): Promise<number> {
    return this.#send(this.#stored);
  }

  /**
   * Forgets the outcome with this message `id`, which the core has recorded, so it is never sent again. True when the
   * outbox still held it. Only outcomes wait for an acknowledgment; any other message is gone once published.
   */
  acknowledge(id: string): boolean {
    if (!this.#database.isOpen) return false;
    return Number(this.#acknowledge.run(id).changes) > 0;
  }

  #commit<R>(work: (add: AddMessage) => Synchronous<R>): R {
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
      this.#insert.run(message.id, draft.kind, key, text);
      // What goes out is what was stored, so the first send and every resend are the same message.
      return JSON.parse(text) as Message<T>;
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
   * deleted once it has gone out. A refusal stops the send, and the rest stay stored.
   */
  #send(query: StatementSync): Promise<number> {
    const sending = this.#sending.then(async () => {
      let sent = 0;
      for (const row of query.all() as Row[]) {
        await this.#sdk.publishMessage(row.routing_key, JSON.parse(row.message) as Message);
        if (row.kind === 'outcome') this.#published.run(row.seq);
        else this.#forget.run(row.seq);
        sent += 1;
      }
      return sent;
    });
    this.#sending = sending.catch(() => {});
    return sending;
  }
}
