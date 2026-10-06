// The per-module outbox (ADR 0012, "Ownership and publication"). A module's messages commit in its own SQLite
// transaction together with the change they report, and go out only after the commit, unchanged, with the `id` and
// `time` they were stored with. A restart sends again whatever the module may not have finished reporting, and the
// consumer drops duplicates by `(source, id)`, so a crash never loses an outcome. Commands never go in.
import {randomInt} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MAX_DETAIL, errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from './envelope.js';
import {parseKey, type Category} from './routing.js';
import {SdkError, type Clock, type Draft, type Scheduler, type Sdk, type SendOptions} from './sdk.js';
import {childOf} from './trace.js';

export type OutboxOptions = {
  /** The module's participant. The outbox sends with `publishMessage`, so a message keeps its stored `id` and `time`. */
  sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  /** The module's own SQLite database. The outbox keeps its messages in the table `bunny_outbox`. */
  database: DatabaseSync;
  /** The clock for each message's `time`: the module's. */
  clock: Clock;
  /** Runs the outbox's forgetting: the module's scheduler, which the runtime cancels when the module stops. */
  scheduler: Scheduler;
  /**
   * How long the module must keep running after it publishes a message before the outbox forgets it. A restart before
   * then publishes it again. Defaults to 60000.
   */
  retainMs?: number;
};

/** Stores one message in the current transaction and returns it as it will be published. */
export type AddMessage = <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => Message<T>;

type Row = {seq: number; routing_key: string; message: string};

export const DEFAULT_RETAIN_MS = 60_000;
// setTimeout's longest delay; a longer one would fire at once.
const MAX_DELAY_MS = 2_147_483_647;
const refusal = (code: ErrorCode, detail: string): SdkError => new SdkError(errorBody(code, {detail: detail.slice(0, MAX_DETAIL)}));

/** The key class a published kind travels on, or undefined for a kind the outbox never stores, such as a command. */
function keyClassOf(kind: string): Category | undefined {
  switch (kind) {
    case 'state':
    case 'removal':
      return 'state';
    case 'occurrence':
    case 'outcome':
      return 'event';
    default:
      return undefined;
  }
}

const isThenable = (value: unknown): boolean =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'then' in value && typeof value.then === 'function';

export class Outbox {
  readonly #sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  readonly #database: DatabaseSync;
  readonly #clock: Clock;
  readonly #scheduler: Scheduler;
  readonly #retainMs: number;
  readonly #insert: StatementSync;
  readonly #unpublished: StatementSync;
  readonly #stored: StatementSync;
  readonly #published: StatementSync;
  readonly #forget: StatementSync;
  /** Sends run one at a time, so a message never goes out twice in one run or out of order. */
  #sending: Promise<void> = Promise.resolve();
  /**
   * Marks the rows this outbox published, so that it forgets only what it saw out itself. A row a previous run
   * published keeps that run's mark until `republish` sends it again.
   */
  readonly #run = randomInt(1, 2 ** 47);

  constructor({sdk, database, clock, scheduler, retainMs = DEFAULT_RETAIN_MS}: OutboxOptions) {
    if (!Number.isSafeInteger(retainMs) || retainMs < 0 || retainMs > MAX_DELAY_MS) {
      throw new RangeError(`retainMs must be an integer from 0 to ${MAX_DELAY_MS}`);
    }
    this.#sdk = sdk;
    this.#database = database;
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#retainMs = retainMs;
    database.exec(`CREATE TABLE IF NOT EXISTS bunny_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      routing_key TEXT NOT NULL,
      message TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0
    ) STRICT`);
    // `published` is 0 until a run publishes the row, then that run's mark.
    this.#insert = database.prepare('INSERT INTO bunny_outbox (routing_key, message) VALUES (?, ?)');
    this.#unpublished = database.prepare('SELECT seq, routing_key, message FROM bunny_outbox WHERE published = 0 ORDER BY seq');
    this.#stored = database.prepare('SELECT seq, routing_key, message FROM bunny_outbox ORDER BY seq');
    this.#published = database.prepare('UPDATE bunny_outbox SET published = ? WHERE seq = ?');
    this.#forget = database.prepare('DELETE FROM bunny_outbox WHERE published = ? AND seq <= ?');
  }

  /**
   * Runs `work` in one transaction on the module's database. Each message it adds is stored in that transaction and,
   * after the commit, published in order. A throw rolls back the work and its messages, so nothing goes out. `work`
   * must be synchronous, and the outbox opens the transaction itself. Resolves with `work`'s result once the messages
   * are published. If publishing is refused, for example because the module is stopping, the promise rejects although
   * the work has committed; the messages stay stored, and the next transaction or restart sends them.
   */
  transaction<R>(work: (add: AddMessage) => R): Promise<R> {
    let result: R;
    try {
      result = this.#commit(work);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#send(this.#unpublished).then(() => result);
  }

  /**
   * Publishes again, in order, every message still stored: those never published, and those published less than
   * `retainMs` before the module last stopped, which the consumer may not have taken. Call it once in the module's
   * start, after the consumer it reports to is listening. The consumer drops the duplicates by `(source, id)`.
   */
  republish(): Promise<void> {
    return this.#send(this.#stored);
  }

  #commit<R>(work: (add: AddMessage) => R): R {
    const database = this.#database;
    if (database.isTransaction) throw refusal('invalid-state', 'the outbox opens its own transaction');
    let open = true;
    const add: AddMessage = <T extends object>(key: string, draft: Draft<T>, options: SendOptions = {}): Message<T> => {
      if (!open) throw refusal('invalid-state', 'add a message only inside the outbox\'s transaction');
      const route = parseKey(key);
      const keyClass = keyClassOf(draft.kind);
      if (keyClass === undefined) throw refusal('invalid-request', `a ${String(draft.kind)} message never goes in the outbox`);
      if (route === undefined || route.category !== keyClass) throw refusal('invalid-request', `a ${draft.kind} message needs a bunny.${keyClass} key, not ${key}`);
      const text = JSON.stringify(buildMessage(this.#sdk.source, draft.kind, draft, childOf(options.parent), this.#clock.now()));
      this.#insert.run(key, text);
      // What goes out is what was stored, so the first send and every resend are the same message.
      return JSON.parse(text) as Message<T>;
    };
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = work(add);
      if (isThenable(result)) throw new TypeError('the outbox\'s work must be synchronous');
      database.exec('COMMIT');
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    } finally {
      open = false;
    }
  }

  /** Publishes the rows `query` selects, one after another. A refusal stops the send; the rest stay stored. */
  #send(query: StatementSync): Promise<void> {
    const sending = this.#sending.then(async () => {
      let last: number | undefined;
      try {
        for (const row of query.all() as Row[]) {
          await this.#sdk.publishMessage(row.routing_key, JSON.parse(row.message) as Message);
          this.#published.run(this.#run, row.seq);
          last = row.seq;
        }
      } finally {
        if (last !== undefined) this.#forgetLater(last);
      }
    });
    this.#sending = sending.catch(() => {});
    return sending;
  }

  /** Once the module has kept running for `retainMs` after a send, the consumer has had it, so it is forgotten. */
  #forgetLater(last: number): void {
    this.#scheduler.after(this.#retainMs, () => {
      if (this.#database.isOpen) this.#forget.run(this.#run, last);
    });
  }
}
