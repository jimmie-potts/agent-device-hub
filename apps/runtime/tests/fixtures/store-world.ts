// The core store with an agent-state owner, as the core runs it, for the core's tests (Hub #831): a recording participant
// in place of the bus, and a manual clock. It can refuse or lose every publication, and crash and start again.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {createAgentState} from '@jimmie-potts/agent-state';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type LifecycleEvent, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {SdkError} from '@jimmie-potts/sdk';
import {reducedKind, toEnvelope} from '../../src/core/mapping.js';
import {CoreStore, type Deriver} from '../../src/core/store.js';
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

  private constructor(file: string, clock: ReturnType<typeof manualClock>, derivers: readonly Deriver[]) {
    this.file = file;
    this.clock = clock;
    this.db = new DatabaseSync(file);
    this.store = this.#store(derivers);
  }

  static async open(context: TestContext, options: {file?: string; clock?: ReturnType<typeof manualClock>; derivers?: readonly Deriver[]} = {}): Promise<World> {
    const file = options.file ?? join(await stateDir(context), 'core.sqlite');
    const world = new World(file, options.clock ?? manualClock(), options.derivers ?? []);
    context.after(() => world.close());
    await world.start();
    return world;
  }

  #store(derivers: readonly Deriver[]): CoreStore {
    return new CoreStore({
      database: this.db, clock: {now: this.clock.now}, derivers,
      sdk: {source: 'bunny/core', publishMessage: <T extends object>(key: string, message: Message<T>): Promise<Message<T>> => {
        if (this.dead) return new Promise(() => {});
        if (this.refuse !== undefined) return Promise.reject(this.refuse);
        this.published.push({key, message: message as Message});
        return Promise.resolve(message);
      }},
      onError: error => { this.refused.push(error); },
    });
  }

  /** Opens the owner as the core's start does: the owner, then fresh records, then what a crash kept back. */
  async start(): Promise<void> {
    this.owner = await createAgentState({storage: this.store, ownerId: OWNER_ID, consumers: [...DEFAULT_CONSUMERS], clock: this.clock.now});
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
    this.db.close();
    this.dead = false;
    this.db = new DatabaseSync(this.file);
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
    const result = await this.store.intake({message, kind: reducedKind(message.data), entity: message.subject}, () => owner.ingest(toEnvelope(message.data)));
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
    if (this.db.isOpen) this.db.close();
  }
}

