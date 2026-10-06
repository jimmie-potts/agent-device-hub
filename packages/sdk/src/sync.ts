// Sync (ADR 0012, "Consumers and recovery"): a consumer's copy of one owner's families. The copy takes the owner's
// current state at a revision, then follows live messages. This file is transport-neutral; a transport supplies the
// live subscriptions and the sync request through `SyncTransport`.
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type EntityRef, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {DeliveryQueue} from './queue.js';
import {SdkError, type Draft, type Handler, type SubscribeOptions, type Subscription, type TraceContext} from './sdk.js';

export type SyncRequest = {requestId: string; families: string[]};
export type SyncCompleted = {requestId: string; revision: number; members: EntityRef[]};
export type Removal = {entity: EntityRef; revision: number; reason: 'expired' | 'retired' | 'deleted'};

/** What every synced state record carries: its entity `id` and the owner's `revision` when it last changed. */
export type Keyed = {id: string; revision: number};
/** One entity's current record in a snapshot: a state message's draft, without `kind`. */
export type StateDraft<T extends Keyed = Keyed> = Omit<Draft<T>, 'kind'>;
/** The owner's current state at `revision`: one state per entity it holds in the requested families. */
export type Snapshot = {revision: number; states: readonly StateDraft[]};
/** Serves one sync request from the owner's current state, or refuses it with an error body from `errorBody`. */
export type SyncProvider = (request: Message<SyncRequest>) => Snapshot | ErrorBody | Promise<Snapshot | ErrorBody>;

export type SyncOptions = {
  /** Each sync request's deadline, in milliseconds from when it is sent. Its `expiresat` is set from it. */
  timeoutMs: number;
  /** How many live messages may wait while a sync is on its way or the handler catches up. Defaults to 1024. */
  maxBuffered?: number;
  /** The trace the first sync request joins. */
  parent?: TraceContext;
};

/**
 * One change to the copy, in order. `updated` carries an entity's new current record. `removed` carries the removal
 * message, or none when a sync dropped an entity the owner no longer has. `synced` carries `sync.completed`: the copy
 * now matches the owner at its revision. `failed` means a later sync could not be served, so the copy stopped.
 */
export type SyncChange<T> =
  | {type: 'updated'; entity: EntityRef; message: Message<T>}
  | {type: 'removed'; entity: EntityRef; message?: Message<Removal>}
  | {type: 'synced'; message: Message<SyncCompleted>}
  | {type: 'failed'; error: ErrorBody};
export type SyncHandler<T> = (change: SyncChange<T>) => void | Promise<void>;

/** A consumer's copy of one owner's families. `close()` stops following the owner. */
export interface SyncedCopy<T> extends Subscription {
  /** The entity's current state message, or undefined when the copy does not hold it. */
  get(entity: EntityRef): Message<T> | undefined;
  /** Every held entity's current state message. */
  states(): Message<T>[];
}

export type SyncResult<T> =
  | {status: 'synced'; copy: SyncedCopy<T>; message: Message<SyncCompleted>}
  | {status: 'rejected'; requestId: string; error: ErrorBody};

/** A transport's answer to one sync request: the owner's states and `sync.completed`, or a refusal. */
export type SyncAnswer =
  | {status: 'served'; requestId: string; states: Message[]; completed: Message<SyncCompleted>}
  | {status: 'rejected'; requestId: string; error: ErrorBody};

/** What sync needs from a transport. */
export type SyncTransport = {
  subscribe: (pattern: string, handler: Handler<Record<string, unknown>>, options: SubscribeOptions) => Promise<Subscription>;
  /** Sends one sync request with this deadline and resolves with its answer. It never rejects. */
  request: (families: readonly string[], timeoutMs: number, parent: TraceContext | undefined) => Promise<SyncAnswer>;
  /** Reports an error that no caller hears about, such as a handler that threw. */
  report: (error: unknown) => void;
};

const FAMILY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// The profile's limits: 32 families of at most 64 characters, and a subject, which names them, of at most 256.
const MAX_FAMILIES = 32;
const MAX_FAMILY = 64;
const MAX_SUBJECT = 256;
// setTimeout's longest delay; a longer one would fire at once.
const MAX_TIMEOUT_MS = 2_147_483_647;
const invalid = (detail: string): SdkError => new SdkError(errorBody('invalid-request', {detail: detail.slice(0, MAX_DETAIL)}));

/** The families of one sync request, checked: 1 to 32 distinct family names, named together by the request's subject. */
export function checkFamilies(families: readonly string[]): string[] {
  // A caller outside TypeScript may pass anything; checking a copy keeps `families` typed.
  const given: unknown = families;
  if (!Array.isArray(given) || families.length === 0 || families.length > MAX_FAMILIES) throw invalid(`a sync names 1 to ${MAX_FAMILIES} families`);
  for (const family of families) {
    if (typeof family !== 'string' || !FAMILY.test(family) || family.length > MAX_FAMILY) throw invalid(`family ${String(family)}`);
  }
  if (new Set(families).size !== families.length) throw invalid('a family is named twice');
  if (families.join(',').length > MAX_SUBJECT) throw invalid(`the families take more than ${MAX_SUBJECT} characters`);
  return [...families];
}

/** The family of a `https://bunny.invalid/events/<family>/<major>.<minor>` schema identifier. */
export function schemaFamily(dataschema: string): string | undefined {
  if (!dataschema.startsWith(SCHEMA_BASE)) return undefined;
  const path = dataschema.slice(SCHEMA_BASE.length);
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : undefined;
}

type Entry = {kind: 'state' | 'removal'; entity: EntityRef; revision: number};
const fields = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

/**
 * The entity and revision a state or removal message carries, as Hub #842's reference consumer reads them: a state
 * names its schema family and `data.id`, a removal its `data.entity`, and both carry `data.revision`.
 */
export function entryOf(message: Message<unknown>): Entry | undefined {
  const data = fields(message.data);
  const revision = data?.revision;
  if (data === undefined || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return undefined;
  switch (message.kind) {
    case 'state': {
      const family = schemaFamily(message.dataschema);
      return family !== undefined && typeof data.id === 'string' ? {kind: 'state', entity: {family, id: data.id}, revision} : undefined;
    }
    case 'removal': {
      const entity = fields(data.entity);
      if (typeof entity?.family !== 'string' || typeof entity.id !== 'string') return undefined;
      return {kind: 'removal', entity: {family: entity.family, id: entity.id}, revision};
    }
    case 'occurrence':
    case 'command':
    case 'reply':
    case 'outcome':
    case 'sync-request':
    case 'sync-completed':
      return undefined;
  }
}

const keyOf = (entity: EntityRef): string => `${entity.family}/${entity.id}`;

/** Starts a copy of one owner's families. Resolves once its first sync has completed, or with that sync's refusal. */
export async function startSync<T extends object>(
  transport: SyncTransport, families: readonly string[], handler: SyncHandler<T>, options: SyncOptions,
): Promise<SyncResult<T>> {
  const requested = checkFamilies(families);
  const {timeoutMs, maxBuffered = 1024, parent} = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw invalid(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  if (!Number.isSafeInteger(maxBuffered) || maxBuffered < 1) throw invalid('maxBuffered must be a positive integer');
  return new Copy(transport, requested, handler, timeoutMs, maxBuffered).start(parent);
}

type Held<T> = {entity: EntityRef; revision: number; message: Message<T>};

class Copy<T extends object> implements SyncedCopy<T> {
  readonly #transport: SyncTransport;
  readonly #families: ReadonlySet<string>;
  readonly #handler: SyncHandler<T>;
  readonly #timeoutMs: number;
  readonly #maxBuffered: number;
  readonly #held = new Map<string, Held<T>>();
  /** The revision of each entity removed since the last sync, so a late state cannot bring it back. */
  readonly #removed = new Map<string, number>();
  /** Live messages at or below the last sync's revision are already part of the copy. */
  #floor = -1;
  /** Live messages waiting: during a sync for its answer, afterwards for the handler. At most `maxBuffered`. */
  #pending: Message[] = [];
  #answer: SyncAnswer | undefined;
  /** Counts sync requests, so the answer to one that a restart replaced is ignored. */
  #attempt = 0;
  #phase: 'syncing' | 'live' | 'closed' = 'syncing';
  #subscriptions: Subscription[] = [];
  /** Settles the `sync` call when the first sync completes or is refused. */
  #settle: ((result: SyncResult<T>) => void) | undefined;
  // One worker applies answers and live messages and calls the handler, one change at a time. A queued item only
  // wakes it, so one waiting item is enough.
  readonly #worker = new DeliveryQueue<object>(1, () => this.#work());

  constructor(transport: SyncTransport, families: readonly string[], handler: SyncHandler<T>, timeoutMs: number, maxBuffered: number) {
    this.#transport = transport;
    this.#families = new Set(families);
    this.#handler = handler;
    this.#timeoutMs = timeoutMs;
    this.#maxBuffered = maxBuffered;
  }

  async start(parent: TraceContext | undefined): Promise<SyncResult<T>> {
    const result = new Promise<SyncResult<T>>(resolve => { this.#settle = resolve; });
    // Subscribe before asking, so that nothing published after the snapshot is missed.
    try {
      for (const family of this.#families) {
        this.#subscriptions.push(await this.#transport.subscribe(`bunny.state.${family}.*`, message => { this.#arrive(message); }, {
          onOverflow: () => { this.#restart(undefined); },
        }));
      }
    } catch (error) {
      await this.#stop();
      throw error;
    }
    this.#restart(parent);
    return result;
  }

  get(entity: EntityRef): Message<T> | undefined {
    return this.#held.get(keyOf(entity))?.message;
  }

  states(): Message<T>[] {
    return [...this.#held.values()].map(entry => entry.message);
  }

  close(): Promise<void> {
    return this.#stop();
  }

  #arrive(message: Message): void {
    if (this.#phase === 'closed') return;
    // Overflow: the buffer would lose a message, so sync again rather than combine partial state.
    if (this.#pending.length >= this.#maxBuffered) {
      this.#restart(undefined);
      return;
    }
    this.#pending.push(message);
    if (this.#phase === 'live') this.#wake();
  }

  /** Sends a new sync request. What was buffered is dropped: the new answer's state includes it. */
  #restart(parent: TraceContext | undefined): void {
    if (this.#phase === 'closed') return;
    const attempt = ++this.#attempt;
    this.#phase = 'syncing';
    this.#pending = [];
    this.#answer = undefined;
    void this.#transport.request([...this.#families], this.#timeoutMs, parent).then(answer => {
      if (attempt !== this.#attempt || this.#phase === 'closed') return;
      this.#answer = answer;
      this.#wake();
    });
  }

  #wake(): void {
    this.#worker.push(this);
  }

  async #work(): Promise<void> {
    for (;;) {
      const answer = this.#answer;
      if (answer !== undefined) {
        this.#answer = undefined;
        await this.#complete(answer);
        continue;
      }
      const message = this.#phase === 'live' ? this.#pending.shift() : undefined;
      if (message === undefined) return;
      const change = this.#apply(message, false);
      if (change !== undefined) await this.#notify(change);
    }
  }

  async #complete(answer: SyncAnswer): Promise<void> {
    const settle = this.#settle;
    if (answer.status === 'rejected') {
      // No sync.completed follows a refusal. A first sync returns it to the caller; a later one ends the copy.
      this.#settle = undefined;
      await this.#stop();
      if (settle !== undefined) settle({status: 'rejected', requestId: answer.requestId, error: answer.error});
      else await this.#notify({type: 'failed', error: answer.error});
      return;
    }
    // The copy takes the snapshot, its membership and the buffered messages in one step; the handler hears of each
    // change afterwards, in that order.
    const changes: SyncChange<T>[] = [];
    const add = (change: SyncChange<T> | undefined): void => { if (change !== undefined) changes.push(change); };
    for (const state of answer.states) add(this.#apply(state, true));
    const {revision, members} = answer.completed.data;
    const kept = new Set(members.map(keyOf));
    // Membership: an entity the owner no longer has disappears, unless it changed above the revision.
    for (const [key, entry] of this.#held) {
      if (!kept.has(key) && entry.revision <= revision) {
        this.#held.delete(key);
        add({type: 'removed', entity: entry.entity});
      }
    }
    for (const [key, removedAt] of this.#removed) if (removedAt <= revision) this.#removed.delete(key);
    this.#floor = revision;
    add({type: 'synced', message: answer.completed});
    const buffered = this.#pending;
    this.#pending = [];
    this.#phase = 'live';
    for (const message of buffered) add(this.#apply(message, false));
    for (const change of changes) await this.#notify(change);
    this.#settle = undefined;
    settle?.({status: 'synced', copy: this, message: answer.completed});
  }

  /**
   * Applies one state or removal and returns the change, or undefined when it changes nothing: a duplicate, a stale
   * revision or a removal of an entity the copy does not hold. Snapshot states skip the sync floor.
   */
  #apply(message: Message, snapshot: boolean): SyncChange<T> | undefined {
    const entry = entryOf(message);
    if (entry === undefined || !this.#families.has(entry.entity.family)) {
      this.#transport.report(new TypeError(`sync ignored ${message.kind} ${message.id}: it names no entity and revision of ${[...this.#families].join(',')}`));
      return undefined;
    }
    const {entity, revision} = entry;
    if (!snapshot && revision <= this.#floor) return undefined;
    const key = keyOf(entity);
    const held = this.#held.get(key);
    const removedAt = this.#removed.get(key);
    switch (entry.kind) {
      case 'state': {
        if ((held !== undefined && held.revision >= revision) || (removedAt !== undefined && removedAt >= revision)) return undefined;
        const state = message as Message<T>;
        this.#held.set(key, {entity, revision, message: state});
        this.#removed.delete(key);
        return {type: 'updated', entity, message: state};
      }
      case 'removal': {
        if (held !== undefined ? held.revision > revision : removedAt !== undefined && removedAt >= revision) return undefined;
        this.#held.delete(key);
        this.#removed.set(key, revision);
        return held === undefined ? undefined : {type: 'removed', entity, message: message as Message<Removal>};
      }
    }
  }

  async #notify(change: SyncChange<T>): Promise<void> {
    if (this.#phase === 'closed' && change.type !== 'failed') return;
    try {
      await this.#handler(change);
    } catch (error) {
      this.#transport.report(error);
    }
  }

  async #stop(): Promise<void> {
    this.#phase = 'closed';
    this.#pending = [];
    this.#answer = undefined;
    const subscriptions = this.#subscriptions.splice(0);
    await Promise.all([...subscriptions.map(subscription => subscription.close()), this.#worker.close()]);
  }
}
