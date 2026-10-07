// Sync (ADR 0012, "Consumers and recovery"): a consumer's copy of one owner's families. The copy takes the owner's
// current state at a revision, then follows live messages from that owner alone. Several owners may serve a shared
// family, such as `device`, each for its own entities; a copy names its owner, or follows the owner that first served it.
// This file is transport-neutral; a transport supplies the live subscriptions and the sync request through
// `SyncTransport`.
import {randomUUID} from 'node:crypto';
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type EntityRef, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {DeliveryQueue} from './queue.js';
import {MAX_TIMEOUT_MS, SdkError, type Draft, type Handler, type SubscribeOptions, type Subscription, type TraceContext} from './sdk.js';
import {childOf, traceIdOf} from './trace.js';

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
  /**
   * The owner to sync from: its participant source, such as `bunny/modules/lifx`. Each request goes to that owner, and
   * the copy follows only the live messages that owner publishes. Without one, the request goes to the families' only
   * owner, and is refused with `invalid-request` when several owners serve one of them.
   */
  owner?: string;
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

/**
 * One sync request as the copy sends it. The request message carries `trace` as its own trace context. `signal` aborts
 * when the copy closes, and the transport then withdraws the request. `owner`, when the copy names one, addresses the
 * request, as a routing key addresses a command; the message itself does not carry it.
 */
export type OutgoingSync = {families: readonly string[]; requestId: string; timeoutMs: number; trace: TraceContext; signal: AbortSignal; owner?: string};

/** What sync needs from a transport. */
export type SyncTransport = {
  /** The clock, in epoch milliseconds. */
  now: () => number;
  subscribe: (pattern: string, handler: Handler<Record<string, unknown>>, options: SubscribeOptions) => Promise<Subscription>;
  /** Sends one sync request and resolves with its answer, or a refusal at its deadline. */
  request: (request: OutgoingSync) => Promise<SyncAnswer>;
  /** Reports an error that no caller hears about, such as a handler that threw. */
  report: (error: unknown) => void;
  /** Hears of each overflow that restarts the copy's sync. */
  restarted?: () => void;
  /** Hears of the copy as soon as it exists, so its participant can close it; returns what forgets it again. */
  track?: (copy: Subscription) => () => void;
};

const FAMILY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/**
 * The families that several owners may serve, each for its own entities (Hub #967): `device/2.0`, the one record each
 * device module publishes for each of its devices (Hub #918). Every other family keeps one owner, so a participant that
 * serves one beside its owner is refused, and every consumer that syncs it without naming an owner still reaches it.
 */
export const SHARED_FAMILIES: ReadonlySet<string> = new Set(['device']);
/** A participant's CloudEvents source, such as `bunny/core` or `bunny/modules/lifx`, of at most 256 characters. */
const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
const MAX_SOURCE = 256;
// The profile's limits: 32 families of at most 64 characters, and a subject, which names them, of at most 256.
const MAX_FAMILIES = 32;
const MAX_FAMILY = 64;
const MAX_SUBJECT = 256;
const invalid = (detail: string): SdkError => new SdkError(errorBody('invalid-request', {detail: detail.slice(0, MAX_DETAIL)}));

/** A non-empty list of distinct family names, as an owner serves them. */
export function checkFamilies(families: readonly string[]): string[] {
  // A caller outside TypeScript may pass anything; checking a copy keeps `families` typed.
  const given: unknown = families;
  if (!Array.isArray(given) || families.length === 0) throw invalid('name at least one family');
  for (const family of families) {
    if (typeof family !== 'string' || !FAMILY.test(family) || family.length > MAX_FAMILY) throw invalid(`family ${String(family)}`);
  }
  if (new Set(families).size !== families.length) throw invalid('a family is named twice');
  return [...families];
}

/** Whether `value` is a participant source, as an owner a sync names must be. */
export const isSource = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_SOURCE && SOURCE.test(value);

/** The families of one sync request: also at most 32, which its subject names in at most 256 characters. */
function checkRequested(families: readonly string[]): string[] {
  const requested = checkFamilies(families);
  if (requested.length > MAX_FAMILIES) throw invalid(`a sync names at most ${MAX_FAMILIES} families`);
  if (requested.join(',').length > MAX_SUBJECT) throw invalid(`the families take more than ${MAX_SUBJECT} characters`);
  return requested;
}

/** The family of a `https://bunny.invalid/events/<family>/<major>.<minor>` schema identifier. */
export function schemaFamily(dataschema: unknown): string | undefined {
  if (typeof dataschema !== 'string' || !dataschema.startsWith(SCHEMA_BASE)) return undefined;
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
  const requested = checkRequested(families);
  const {timeoutMs, maxBuffered = 1024, parent, owner} = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw invalid(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  if (!Number.isSafeInteger(maxBuffered) || maxBuffered < 1) throw invalid('maxBuffered must be a positive integer');
  if (owner !== undefined && !isSource(owner)) throw invalid('owner must be a participant source, such as bunny/modules/lifx');
  return new Copy(transport, requested, handler, timeoutMs, maxBuffered, owner).start(parent);
}

type Held<T> = {entity: EntityRef; revision: number; message: Message<T>};
/** An answer and the copy's generation when its request was sent. */
type Answered = {answer: SyncAnswer; generation: number};

class Copy<T extends object> implements SyncedCopy<T> {
  readonly #transport: SyncTransport;
  readonly #families: ReadonlySet<string>;
  readonly #handler: SyncHandler<T>;
  readonly #timeoutMs: number;
  readonly #maxBuffered: number;
  /** The owner the copy names; undefined for the families' only owner. */
  readonly #owner: string | undefined;
  /**
   * The owner whose live messages alone the copy follows: the one it names or, without one, the source of the
   * `sync.completed` that first served it. Until a copy without an owner first syncs, it holds every message it buffers
   * and applies only its owner's once it knows that owner. It never follows another owner after that.
   */
  #following: string | undefined;
  readonly #held = new Map<string, Held<T>>();
  /** The revision of each entity removed since the last sync, so a late state cannot bring it back. */
  readonly #removed = new Map<string, number>();
  /** Live messages at or below the last sync's revision are already part of the copy. */
  #floor = -1;
  /** Live messages waiting: during a sync for its answer, afterwards for the handler. At most `maxBuffered`. */
  #pending: Message[] = [];
  #answered: Answered | undefined;
  /** Counts overflows. An answer to a request sent before the latest overflow has a gap, so it is not applied. */
  #generation = 0;
  /** A sync is needed: the worker sends its request once no other is outstanding. */
  #wanted = false;
  /** A request is outstanding. A copy never has two, so a busy copy cannot crowd the owner's shared queue. */
  #outstanding = false;
  /** Every family is subscribed. No request goes out before, or a message published meanwhile could be missed. */
  #subscribed = false;
  /** The last request sent, which a first sync that runs out of time names. */
  #lastSent: {requestId: string; traceId: string} | undefined;
  #phase: 'syncing' | 'live' | 'closed' = 'syncing';
  #subscriptions: Subscription[] = [];
  /** The trace the first request joins; later requests start their own. */
  #parent: TraceContext | undefined;
  /** When the first sync must have completed: `timeoutMs` after its first request, which gets all of it. */
  #firstDeadlineMs: number | undefined;
  /** Settles the `sync` call when the first sync completes or is refused. */
  #settle: ((result: SyncResult<T>) => void) | undefined;
  /** Withdraws the outstanding request when the copy closes. */
  #inflight: AbortController | undefined;
  /** Forgets the copy at its participant. */
  #untrack: () => void = () => {};
  // One worker sends requests, applies answers and live messages and calls the handler, one change at a time. A
  // queued item only wakes it, so one waiting item is enough.
  readonly #worker = new DeliveryQueue<object>(1, () => this.#work());

  constructor(
    transport: SyncTransport, families: readonly string[], handler: SyncHandler<T>, timeoutMs: number, maxBuffered: number, owner: string | undefined,
  ) {
    this.#transport = transport;
    this.#families = new Set(families);
    this.#handler = handler;
    this.#timeoutMs = timeoutMs;
    this.#maxBuffered = maxBuffered;
    this.#owner = owner;
    this.#following = owner;
  }

  async start(parent: TraceContext | undefined): Promise<SyncResult<T>> {
    const result = new Promise<SyncResult<T>>(resolve => { this.#settle = resolve; });
    this.#parent = parent;
    this.#untrack = this.#transport.track?.(this) ?? this.#untrack;
    // Subscribe before asking, so that nothing published after the snapshot is missed.
    try {
      for (const family of this.#families) {
        const subscription = await this.#transport.subscribe(`bunny.state.${family}.*`, message => { this.#arrive(message); }, {
          onOverflow: () => { this.#overflow(); },
        });
        // A close while this subscription was being made has settled the sync and closed the ones before it.
        if (this.#closed()) {
          await subscription.close();
          return result;
        }
        this.#subscriptions.push(subscription);
      }
    } catch (error) {
      // A closed copy's transport may refuse; the close has already settled the sync.
      if (this.#closed()) return result;
      await this.#stop();
      throw error;
    }
    this.#subscribed = true;
    this.#wanted = true;
    this.#wake();
    return result;
  }

  /** Whether the copy has closed; a method, so that a check after an `await` is not narrowed away. */
  #closed(): boolean {
    return this.#phase === 'closed';
  }

  get(entity: EntityRef): Message<T> | undefined {
    return this.#held.get(keyOf(entity))?.message;
  }

  states(): Message<T>[] {
    return [...this.#held.values()].map(entry => entry.message);
  }

  /** Stops following the owner and withdraws an outstanding request. A first sync still under way is `cancelled`. */
  close(): Promise<void> {
    const settle = this.#settle;
    this.#settle = undefined;
    const stopped = this.#stop();
    if (settle !== undefined) {
      const {requestId, traceId} = this.#lastSent ?? {requestId: randomUUID(), traceId: undefined};
      const ids = traceId === undefined ? {requestId} : {requestId, traceId};
      settle({status: 'rejected', requestId, error: errorBody('cancelled', {...ids, detail: 'the requester closed'})});
    }
    return stopped;
  }

  #arrive(message: Message): void {
    if (this.#phase === 'closed') return;
    // Another owner's message on a shared family describes that owner's entities, never this copy's: it is not this
    // copy's to apply, buffer or report.
    if (this.#foreign(message)) return;
    // The buffer would lose a message, so sync again rather than combine partial state.
    if (this.#pending.length >= this.#maxBuffered) {
      this.#overflow();
      return;
    }
    this.#pending.push(message);
    if (this.#phase === 'live') this.#wake();
  }

  /**
   * The copy missed a message: it stops applying live messages and wants a new sync. What was buffered is dropped,
   * because the next answer's state includes it, and an answer to a request already sent is not applied.
   */
  #overflow(): void {
    if (this.#phase === 'closed') return;
    this.#transport.restarted?.();
    this.#phase = 'syncing';
    this.#pending = [];
    this.#generation += 1;
    this.#wanted = true;
    this.#wake();
  }

  /** Sends the wanted request. A first sync gets only the time left before its deadline, and none past it. */
  #send(): void {
    this.#wanted = false;
    this.#pending = [];
    const generation = this.#generation;
    const requestId = randomUUID();
    const trace = childOf(this.#parent);
    this.#parent = undefined;
    const ids = {requestId, traceId: traceIdOf(trace.traceparent)};
    let timeoutMs = this.#timeoutMs;
    if (this.#settle !== undefined) {
      const now = this.#transport.now();
      this.#firstDeadlineMs ??= now + this.#timeoutMs;
      const left = this.#firstDeadlineMs - now;
      if (left <= 0) {
        const last = this.#lastSent ?? ids;
        const detail = `the first sync did not complete within ${this.#timeoutMs} ms`;
        this.#answered = {generation, answer: {status: 'rejected', requestId: last.requestId, error: errorBody('unavailable', {...last, detail})}};
        return;
      }
      timeoutMs = Math.min(timeoutMs, left);
    }
    this.#outstanding = true;
    this.#lastSent = ids;
    const inflight = new AbortController();
    this.#inflight = inflight;
    let sent: Promise<SyncAnswer>;
    try {
      const owner = this.#owner === undefined ? {} : {owner: this.#owner};
      sent = this.#transport.request({families: [...this.#families], requestId, timeoutMs, trace, signal: inflight.signal, ...owner});
    } catch (error) {
      // A transport that throws instead of rejecting takes the same path.
      sent = Promise.reject(error);
    }
    void sent.then(answer => {
      this.#arrived({generation, answer});
    }, (error: unknown) => {
      this.#transport.report(error);
      this.#arrived({generation, answer: {status: 'rejected', requestId, error: errorBody('unavailable', {...ids, detail: 'the sync request failed'})}});
    });
  }

  #arrived(answered: Answered): void {
    this.#outstanding = false;
    this.#inflight = undefined;
    if (this.#phase === 'closed') return;
    this.#answered = answered;
    this.#wake();
  }

  #wake(): void {
    this.#worker.push(this);
  }

  async #work(): Promise<void> {
    for (;;) {
      if (this.#phase === 'closed') return;
      const answered = this.#answered;
      if (answered !== undefined) {
        this.#answered = undefined;
        await this.#complete(answered);
        continue;
      }
      if (this.#wanted && !this.#outstanding && this.#subscribed) {
        this.#send();
        continue;
      }
      const message = this.#phase === 'live' ? this.#pending.shift() : undefined;
      if (message === undefined) return;
      const change = this.#apply(message, false);
      if (change !== undefined) await this.#notify(change);
    }
  }

  /** Whether a live message comes from another owner than the one the copy follows. */
  #foreign(message: Message): boolean {
    return this.#following !== undefined && message.source !== this.#following;
  }

  /**
   * A served answer from another owner than the copy's, as a transport that ignored a named owner could give, or a
   * resync that another owner answered after the copy's owner stopped serving, is no answer from that owner: refused as
   * `unavailable`, which ends a first sync or the copy. One copy never holds two owners' records, whose revisions do not
   * compare (ADR 0012, "Ownership and publication").
   */
  #fromOwner(answer: SyncAnswer): SyncAnswer {
    const owner = this.#owner ?? this.#following;
    if (answer.status !== 'served' || owner === undefined || answer.completed.source === owner) return answer;
    const {requestId} = answer;
    const which = this.#owner === undefined ? `the owner ${owner} the copy follows` : `the named owner ${owner}`;
    const detail = `the answer came from ${answer.completed.source}, not ${which}`.slice(0, MAX_DETAIL);
    return {status: 'rejected', requestId, error: errorBody('unavailable', {requestId, traceId: traceIdOf(answer.completed.traceparent), detail})};
  }

  async #complete({answer: given, generation}: Answered): Promise<void> {
    // An overflow since this request was sent left a gap that its state may not cover; the next request replaces it.
    if (given.status === 'served' && generation !== this.#generation) return;
    const answer = this.#fromOwner(given);
    const settle = this.#settle;
    if (answer.status === 'rejected') {
      // No sync.completed follows a refusal. A first sync returns it to the caller; a later one ends the copy.
      this.#settle = undefined;
      await this.#stop();
      if (settle !== undefined) settle({status: 'rejected', requestId: answer.requestId, error: answer.error});
      else await this.#notify({type: 'failed', error: answer.error});
      return;
    }
    // The copy follows the owner that first served it from now on, so buffered and live messages from another owner of
    // a shared family never mix into it. A later answer comes from the same owner, or was refused above.
    this.#following = answer.completed.source;
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
    // A buffered message from another owner than the one that served the copy is not the copy's.
    if (!snapshot && this.#foreign(message)) return undefined;
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
    this.#answered = undefined;
    this.#inflight?.abort();
    this.#untrack();
    const subscriptions = this.#subscriptions.splice(0);
    await Promise.all([...subscriptions.map(subscription => subscription.close()), this.#worker.close()]);
  }
}
