// The core store with an agent-state owner, as the core runs it, for the core's tests (Hub #831): a recording participant
// in place of the bus, and a manual clock. It can refuse or lose every publication, and crash and start again.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {createAgentState, type Storage, type StorageLease} from '@jimmie-potts/agent-state';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type LifecycleEvent, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {openModuleDatabaseFile, type Logger, type SdkError} from '@jimmie-potts/sdk';
import {reducedKind, toEnvelope} from '../../src/core/mapping.js';
import {CoreStore, type Deriver, type SaveCost} from '../../src/core/store.js';
import {DEFAULT_CONSUMERS, OWNER_ID} from '../../src/index.js';
import {flush, manualClock, stateDir} from '../support.js';
import {lifecycleOf, type ObservationOptions} from './agents.js';

export type Owner = Awaited<ReturnType<typeof createAgentState>>;
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

/** What a world's store records with and measures its saves by (Hub #976), when a test sets them. */
export type Watch = {log?: Logger; saveCost?: SaveCost; timer?: () => number};

/** The core store on a database file, with an owner, a recording participant and a manual clock. */
export class World {
  readonly published: Published[] = [];
  readonly refused: unknown[] = [];
  readonly clock: ReturnType<typeof manualClock>;
  readonly file: string;
  db: DatabaseSync;
  store: CoreStore;
  owner: Owner | undefined;
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

  readonly #wrap: (db: DatabaseSync) => DatabaseSync;
  readonly #wal: boolean;
  readonly #watch: Watch;
  /** Stands between agent-state's owner and each lease the store gives it, when a test sets it. */
  #lease: ((lease: StorageLease) => StorageLease) | undefined;

  private constructor(file: string, clock: ReturnType<typeof manualClock>, derivers: readonly Deriver[], wrap: (db: DatabaseSync) => DatabaseSync = db => db, wal = false, watch: Watch = {}) {
    this.#wrap = wrap;
    this.#wal = wal;
    this.#watch = watch;
    this.file = file;
    this.clock = clock;
    this.db = this.#connect();
    this.store = this.#store(derivers);
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
    /** Stands between agent-state's owner and each lease the store gives it, as a test that sees each commit does. */
    lease?: (lease: StorageLease) => StorageLease;
  } = {}): Promise<World> {
    const file = options.file ?? join(await stateDir(context), 'core.sqlite');
    const world = new World(file, options.clock ?? manualClock(), options.derivers ?? [], options.wrap, options.wal, options.watch);
    world.#lease = options.lease;
    context.after(() => world.close());
    await world.start();
    return world;
  }

  #store(derivers: readonly Deriver[]): CoreStore {
    return new CoreStore({
      database: this.#wrap(this.db), clock: {now: this.clock.now}, derivers,
      sdk: {source: 'bunny/core', publishMessage: <T extends object>(key: string, message: Message<T>): Promise<Message<T>> => {
        if (this.dead) return new Promise(() => {});
        if (this.refuse !== undefined) return Promise.reject(this.refuse);
        this.publishing?.();
        this.published.push({key, message: message as Message});
        if (this.published.length === this.hangAfter) return new Promise(() => {});
        return Promise.resolve(message);
      }},
      onError: error => { this.refused.push(error); },
      ...this.#watch,
    });
  }

  /** The storage agent-state's owner runs on: the store, behind the test's lease when it set one. */
  #storage(): Storage {
    const lease = this.#lease, store = this.store;
    if (lease === undefined) return store;
    return {acquire: async (ownerId, signal) => lease(await store.acquire(ownerId, signal))};
  }

  /** Opens the owner as the core's start does: the owner, then fresh records, then what a crash kept back. */
  async start(): Promise<void> {
    this.owner = await createAgentState({storage: this.#storage(), ownerId: OWNER_ID, consumers: [...DEFAULT_CONSUMERS], clock: this.clock.now});
    await this.store.refresh();
    await this.store.republish();
    await flush();
  }

  /**
   * Abandons this store as a crash would, and starts again on its file. Nothing the store has not committed is written:
   * a publication under way never finishes, and the old owner only lets go of its lease, as a dead process's locks go
   * with it.
   */
  async crashAndRestart(derivers: readonly Deriver[] = []): Promise<void> {
    await this.owner?.shutdown().catch(() => {});
    this.store.close();
    this.db.close();
    this.dead = false;
    this.hangAfter = undefined;
    this.db = this.#connect();
    this.store = this.#store(derivers);
    await this.start();
  }

  /** Reduces one observation as the core does, by `(source, id)` and through the store's intake. */
  async observe(event: LifecycleEvent, options: ObservationOptions & {atMs?: number} = {}): Promise<Awaited<ReturnType<Owner['ingest']>>> {
    const data = lifecycleOf(event, options.atMs ?? this.clock.now(), options);
    return this.take(lifecycleMessage(data, this.clock.now()));
  }

  async take(message: Message<LifecycleObservation>): Promise<Awaited<ReturnType<Owner['ingest']>>> {
    const owner = this.owner;
    assert.ok(owner, 'the owner is open');
    const cause = {message, kind: reducedKind(message.data), entity: message.subject, observation: message.data};
    const result = await this.store.during(cause, () => owner.ingest(toEnvelope(message.data)));
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
    return ['state', 'core_revision', 'core_records', 'core_history', 'core_taken', 'bunny_outbox'].map(table => this.rows(`SELECT * FROM ${table}`));
  }

  async close(): Promise<void> {
    await this.owner?.shutdown().catch(() => {});
    this.store.close();
    if (this.db.isOpen) this.db.close();
  }

  /** Opens the owner again on the same store, as the core does after a failed commit; the store keeps its lock. */
  async reopen(pauseMs = 0): Promise<void> {
    await this.owner?.shutdown().catch(() => {});
    this.store.abandonLease();
    // A pause lets another store waiting for the lock try for it, as a busy host would.
    if (pauseMs > 0) await new Promise(resolve => { setTimeout(resolve, pauseMs); });
    this.owner = await createAgentState({storage: this.#storage(), ownerId: OWNER_ID, consumers: [...DEFAULT_CONSUMERS], clock: this.clock.now});
  }
}

