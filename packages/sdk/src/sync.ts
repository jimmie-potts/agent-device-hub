// Sync (ADR 0012, "Consumers and recovery"): a consumer's copy of one owner's families. The copy takes the owner's
// current state at a revision, then follows live messages. This file is transport-neutral; a transport supplies the
// live subscriptions and the sync request through `SyncTransport`.
import type {EntityRef, ErrorBody, Message} from '@jimmie-potts/event-contracts/v2';
import type {Draft, Handler, SubscribeOptions, Subscription, TraceContext} from './sdk.js';

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
  /** Sends one sync request and resolves with its answer; never rejects. */
  request: (families: readonly string[], options: {timeoutMs: number; parent?: TraceContext}) => Promise<SyncAnswer>;
  /** Reports an error that no caller hears about, such as a handler that threw. */
  report: (error: unknown) => void;
};

export function startSync<T extends object>(
  _transport: SyncTransport, _families: readonly string[], _handler: SyncHandler<T>, _options: SyncOptions,
): Promise<SyncResult<T>> {
  return Promise.reject(new Error('sync is not implemented yet'));
}
