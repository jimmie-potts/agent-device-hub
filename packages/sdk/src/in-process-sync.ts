// The owner side of sync on the in-process bus: one owner serves each family, and its answer goes straight back to
// the requester, never to subscribers.
import type {Message, MessageKind} from '@jimmie-potts/event-contracts/v2';
import type {ErrorScope} from './in-process.js';
import type {Subscription, TraceContext} from './sdk.js';
import type {SyncAnswer, SyncProvider} from './sync.js';

type Envelope<T> = {type: string; subject: string; dataschema: string; data: T};
/** What the bus lends its sync owners: its clock, queue limit, error report and envelope builder. */
export type SyncDependencies = {
  now: () => number;
  maxQueued: number;
  report: (error: unknown, scope: ErrorScope) => void;
  envelope: <T>(source: string, kind: MessageKind, draft: Envelope<T>, trace: TraceContext, deadline?: {sentAtMs: number; expiresAtMs: number}) => Message<T>;
};

export class SyncOwners {
  constructor(_dependencies: SyncDependencies) {}

  serve(_source: string, _families: readonly string[], _provider: SyncProvider): Subscription {
    return {close: () => Promise.resolve()};
  }

  request(_source: string, _families: readonly string[], _options: {timeoutMs: number; parent?: TraceContext}): Promise<SyncAnswer> {
    return Promise.reject(new Error('sync is not implemented yet'));
  }
}
