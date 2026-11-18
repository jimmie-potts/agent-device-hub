// The core store as the core runs it, for the core's tests (Hub #831, #1865): a recording participant in place of the bus,
// and a manual clock. It can refuse or lose every publication, and crash and start again.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type Title} from '@jimmie-potts/event-contracts/v2/families';
import {openModuleDatabaseFile, type Logger, type SdkError} from '@jimmie-potts/sdk';
import type {HistoryRules} from '../../src/core/history.js';
import {CoreStore, type Completion, type CoreChange, type Deriver, type SaveCost, type SessionOutcome, type StoreOptions} from '../../src/core/store.js';
import {flush, manualClock, stateDir} from '../support.js';
import {lifecycleOf, type ObservationOptions} from './agents.js';

export type Published = {key: string; message: Message};

const validator = new MessageValidator();
registerCoreFamilies(validator);
export const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
let next = 0;

/** A hook's lifecycle message, as the bus would deliver it. */
export function lifecycleMessage(data: LifecycleObservation, atMs: number, id = `hook-${++next}`): Message<LifecycleObservation> {
  return {
    specversion: '1.0', bunnyprofile: '2.0', id, source: 'bunny/parts/hook', type: 'org.bunny.lifecycle.observed', subject: sessionEntityId(data.identity),
    time: new Date(atMs).toISOString(), kind: 'occurrence', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/lifecycle/2.0',
    traceparent: TRACE, data,
  };
}

/** An operator's or consumer's command, whose trace a session change joins. Its type and data do not matter to the store. */
export function commandMessage(subject: string, atMs: number, id = `command-${++next}`): Message<{requestId: string}> {
  return {
    specversion: '1.0', bunnyprofile: '2.0', id, source: 'bunny/parts/operator', type: 'org.bunny.session-label.set.requested', subject,
    time: new Date(atMs).toISOString(), kind: 'command', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/session-label-set/2.0',
    traceparent: TRACE, data: {requestId: `req-${id}`},
  };
}

/**
 * What a world's store records with and measures its saves by (Hub #976), and the rules its history keeps by (#1772),
 * when a test sets them.
 */
export type Watch = {log?: Logger; saveCost?: SaveCost; timer?: () => number; history?: HistoryRules; historyDevices?: NonNullable<StoreOptions['historyDevices']>};

/** The core store on a database file, with a recording participant and a manual clock. */
export class World {
  readonly published: Published[] = [];
  readonly refused: unknown[] = [];
  /** Every change the store reported committed, as automations and companions hear of it. */
  readonly changes: CoreChange[] = [];
  readonly clock: ReturnType<typeof manualClock>;
  readonly file: string;
  db: DatabaseSync;
  store: CoreStore;
  /** When set, the participant refuses every publish with this error, as a stopping participant would. */
  refuse: SdkError | undefined;
  /** When set, a publish never finishes, as in a process that died after its commit. */
  dead = false;
  /**
   * When set, the publish that brings `published` to this length goes out and then never finishes, as in a process that
   * died after its sends and before their bookkeeping committed.
   */
  hangAfter: number | undefined;
  /** When set, runs as each message goes out, as a publication that takes time does. */
  publishing: (() => void) | undefined;
  /** Whether current archive evidence covers an identity, as the core's Codex Desktop admission asks. */
  archived: ((identity: Identity, ancestors: readonly Identity[]) => boolean) | undefined;

  readonly #wrap: (db: DatabaseSync) => DatabaseSync;
  readonly #wal: boolean;
  readonly #watch: Watch;
  #derivers: readonly Deriver[];

  private constructor(file: string, clock: ReturnType<typeof manualClock>, derivers: readonly Deriver[], wrap: (db: DatabaseSync) => DatabaseSync = db => db, wal = false, watch: Watch = {}) {
    this.#wrap = wrap;
    this.#wal = wal;
    this.#watch = watch;
    this.#derivers = derivers;
    this.file = file;
    this.clock = clock;
    this.db = this.#connect();
    this.store = this.#store();
  }

  /** A connection to the store's file: as the runtime opens it when asked (Hub #972), otherwise SQLite's defaults. */
  #connect(): DatabaseSync {
    return this.#wal ? openModuleDatabaseFile(this.file) : new DatabaseSync(this.file);
  }

  static async open(context: TestContext, options: {
    file?: string; clock?: ReturnType<typeof manualClock>; derivers?: readonly Deriver[];
    /** Stands in front of the store's connection, as a test that makes one of its calls fail does. */
    wrap?: (db: DatabaseSync) => DatabaseSync;
    /** Opens the store's file as the runtime does: exclusive locking, WAL and `synchronous = FULL`. */
    wal?: boolean;
    /** The store's logger, in place of reporting refused publishes to `refused`, and how it measures its saves. */
    watch?: Watch;
  } = {}): Promise<World> {
    const file = options.file ?? join(await stateDir(context), 'core.sqlite');
    const world = new World(file, options.clock ?? manualClock(), options.derivers ?? [], options.wrap, options.wal, options.watch);
    context.after(() => world.close());
    await world.start();
    return world;
  }

  #store(): CoreStore {
    return new CoreStore({
      database: this.#wrap(this.db), clock: {now: this.clock.now}, derivers: this.#derivers,
      archived: (identity, ancestors) => this.archived?.(identity, ancestors) ?? false,
      sdk: {source: 'bunny/core', publishMessage: <T extends object>(key: string, message: Message<T>): Promise<Message<T>> => {
        if (this.dead) return new Promise(() => {});
        if (this.refuse !== undefined) return Promise.reject(this.refuse);
        this.publishing?.();
        this.published.push({key, message: message as Message});
        if (this.published.length === this.hangAfter) return new Promise(() => {});
        return Promise.resolve(message);
      }},
      committed: change => { this.changes.push(change); },
      onError: error => { this.refused.push(error); },
      ...this.#watch,
    });
  }

  /** Opens the store as the core's start does: the store, then what fell due and fresh records, then what a crash kept back. */
  async start(): Promise<void> {
    await this.store.open(AbortSignal.abort());
    await this.store.refresh();
    await this.store.republish();
    await flush();
  }

  /**
   * Abandons this store as a crash would, and starts again on its file. Nothing the store has not committed is written:
   * a publication under way never finishes, and the old store only lets go of its lock, as a dead process's locks go
   * with it.
   */
  async crashAndRestart(derivers: readonly Deriver[] = this.#derivers): Promise<void> {
    this.store.close();
    if (this.db.isOpen) this.db.close();
    this.dead = false;
    this.hangAfter = undefined;
    this.#derivers = derivers;
    this.db = this.#connect();
    this.store = this.#store();
    await this.start();
  }

  /** Reduces one observation as the core does, by `(source, id)` and through the store's intake. */
  async observe(event: LifecycleEvent, options: ObservationOptions & {atMs?: number} = {}): Promise<SessionOutcome> {
    const data = lifecycleOf(event, options.atMs ?? this.clock.now(), options);
    return this.take(lifecycleMessage(data, this.clock.now()));
  }

  async take(message: Message<LifecycleObservation>): Promise<SessionOutcome> {
    const result = await this.store.observe(message);
    await flush();
    return result;
  }

  /** Records one consumer's acknowledgment of a notice, as the core's `notice-acknowledge` responder does. */
  async acknowledge(identity: Identity, noticeId: string, consumerId: string): Promise<SessionOutcome> {
    const id = sessionEntityId(identity);
    const result = await this.store.acknowledge(commandMessage(id, this.clock.now()), id, noticeId, consumerId);
    await flush();
    return result;
  }

  /** Acknowledges a session's latest notice for every consumer, as the operator's notice override does. */
  async acknowledgeAll(identity: Identity, noticeId: string, completing?: Completion): Promise<SessionOutcome> {
    const id = sessionEntityId(identity);
    const result = await this.store.acknowledgeAll(commandMessage(id, this.clock.now()), id, noticeId, completing);
    await flush();
    return result;
  }

  /** Sets or clears a user label, as the core's label responder does. */
  async setLabel(identity: Identity, label: string | null, completing?: Completion): Promise<SessionOutcome> {
    const id = sessionEntityId(identity);
    const result = await this.store.label(commandMessage(id, this.clock.now()), id, label, completing);
    await flush();
    return result;
  }

  /** An operator's approval recovery. */
  async recoverApproval(identity: Identity, turnId: string): Promise<SessionOutcome> {
    const id = sessionEntityId(identity);
    const result = await this.store.recoverApproval(commandMessage(id, this.clock.now()), id, turnId);
    await flush();
    return result;
  }

  /** The Codex Desktop module's title evidence for a session, observed at `atMs`. */
  async title(identity: Identity, title: Title, atMs: number): Promise<SessionOutcome> {
    const data = lifecycleOf({kind: 'metadata-observed'}, atMs, {identity, turn: null, title});
    const result = await this.store.title({...lifecycleMessage(data, this.clock.now()), source: 'bunny/modules/codex-desktop'}, title);
    await flush();
    return result;
  }

  /** The messages published since `from`, each checked against profile 2.0 at its own time. */
  since(from: number): Message[] {
    const messages = this.published.slice(from).map(({message}) => message);
    for (const message of messages) {
      const checked = validator.validate(message);
      assert.equal(checked.ok, true, `${message.type}: ${JSON.stringify(checked.ok ? undefined : checked.error)}`);
    }
    return messages;
  }

  /** The rows of a query, as plain objects. */
  rows(sql: string): object[] {
    return this.db.prepare(sql).all().map(row => ({...row}));
  }

  /** Every row the core store keeps, to show a refused change left all of them alone. */
  snapshot(): unknown {
    return ['core_revision', 'core_records', 'core_sessions', 'core_session_guards', 'core_history', 'core_taken', 'bunny_outbox'].map(table => this.rows(`SELECT * FROM ${table}`));
  }

  close(): void {
    this.store.close();
    if (this.db.isOpen) this.db.close();
  }
}
