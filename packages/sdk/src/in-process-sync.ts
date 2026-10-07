// The owner side of sync on the in-process bus. Ownership is keyed by source and family: several owners may serve one
// family, such as `device`, each for its own entities, and no source serves a family twice. A sync request goes straight
// to the owner it names, or to its families' only owner, and its answer goes straight back to the requester, never to
// subscribers. Nothing merges owners' records or spreads one request across owners.
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type Message, type MessageKind} from '@jimmie-potts/event-contracts/v2';
import {levelOf, type Diagnostic, type OnDiagnostic} from './diagnostics.js';
import type {ErrorScope} from './in-process.js';
import {DeliveryQueue} from './queue.js';
import {SdkError, type Cancel, type Scheduler, type Subscription, type TraceContext} from './sdk.js';
import {
  checkFamilies, entryOf, schemaFamily, type OutgoingSync, type Snapshot, type SyncAnswer, type SyncCompleted, type SyncProvider, type SyncRequest,
} from './sync.js';
import {childOf, traceIdOf} from './trace.js';

type Envelope<T> = {type: string; subject: string; dataschema: string; data: T};
/** What the bus lends its sync owners: its clock and scheduler, queue limit, error report, diagnostics and envelope builder. */
export type SyncDependencies = {
  now: () => number;
  scheduler: Scheduler;
  maxQueued: number;
  report: (error: unknown, scope: ErrorScope) => void;
  /** Hears each sync request's one answer, as the bus decided it. */
  diagnose: OnDiagnostic;
  envelope: <T>(source: string, kind: MessageKind, draft: Envelope<T>, trace: TraceContext, deadline?: {sentAtMs: number; expiresAtMs: number}) => Message<T>;
};

const SYNC_REQUEST = `${SCHEMA_BASE}sync-request/2.0`;
const SYNC_COMPLETED = `${SCHEMA_BASE}sync-completed/2.0`;
// sync.completed lists at most this many members.
const MAX_MEMBERS = 4096;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

type Delivery = {request: Message<SyncRequest>; expiresAtMs: number; settle: (answer: SyncAnswer) => void};
type Owner = {families: ReadonlySet<string>; scope: ErrorScope; queue: DeliveryQueue<Delivery>};
/** Where a sync request goes: the one owner that serves all its families, or why it is refused. */
type Route = {owner: Owner} | {code: ErrorCode; detail: string};

/** A refusal of `request` in the shared error body, naming the request and its trace. */
function refusal(request: Message<SyncRequest>, code: ErrorCode, detail: string): SyncAnswer {
  const {requestId} = request.data;
  return {status: 'rejected', requestId, error: errorBody(code, {requestId, traceId: traceIdOf(request.traceparent), detail: detail.slice(0, MAX_DETAIL)})};
}

const isErrorBody = (value: unknown): value is ErrorBody =>
  typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null;

/** Why a snapshot cannot answer a request for `families`, or undefined when it can. */
function misfit(snapshot: Snapshot, families: readonly string[]): string | undefined {
  if (typeof snapshot !== 'object' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return 'has no whole revision from 0';
  const states: unknown = snapshot.states;
  if (!Array.isArray(states) || snapshot.states.length > MAX_MEMBERS) return `does not list at most ${MAX_MEMBERS} states`;
  for (const draft of snapshot.states) {
    const family = schemaFamily(draft.dataschema);
    const {id, revision} = draft.data;
    if (family === undefined || !families.includes(family)) return `holds ${draft.dataschema}, outside ${families.join(',')}`;
    if (typeof id !== 'string' || !ID.test(id)) return `holds a ${family} state without an entity id`;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > snapshot.revision) return `holds ${family} ${id} at a revision outside 0 to ${snapshot.revision}`;
  }
  return undefined;
}

export class SyncOwners {
  readonly #owners = new Set<Owner>();
  readonly #dependencies: SyncDependencies;

  constructor(dependencies: SyncDependencies) {
    this.#dependencies = dependencies;
  }

  serve(source: string, families: readonly string[], provider: SyncProvider): Subscription {
    const served = checkFamilies(families);
    // Another source may serve the same family for its own entities; one source serves each family once.
    for (const other of this.#owners) {
      const taken = other.scope.source === source ? served.find(family => other.families.has(family)) : undefined;
      if (taken !== undefined) throw new SdkError(errorBody('invalid-state', {detail: `${source} already serves ${taken}`}));
    }
    const scope = {source, pattern: `sync ${served.join(',')}`};
    const owner: Owner = {families: new Set(served), scope, queue: new DeliveryQueue(this.#dependencies.maxQueued, async ({request, expiresAtMs, settle}) => {
      // A request past its expiry is ignored: its requester already has an answer, so nothing serves it.
      if (expiresAtMs <= this.#dependencies.now()) return;
      settle(await this.#answer(source, scope, request, provider));
    })};
    this.#owners.add(owner);
    return {close: () => {
      this.#owners.delete(owner);
      // Requests still waiting never reached the owner, so their requesters learn that at once.
      return owner.queue.close(({request, settle}) => { settle(refusal(request, 'unavailable', 'the owner closed')); });
    }};
  }

  /**
   * Sends one sync request to `owner`, or to the only owner of `families`. Resolves with its answer or a refusal; never
   * rejects. When `signal` aborts, the request is withdrawn: taken out of the owner's queue if it still waits there, and
   * refused as `cancelled`.
   */
  request(source: string, {families, requestId, timeoutMs, trace, signal, owner}: OutgoingSync): Promise<SyncAnswer> {
    const {now, envelope} = this.#dependencies;
    const sentAtMs = now(), expiresAtMs = sentAtMs + timeoutMs;
    const subject = families.join(',');
    const data = {requestId, families: [...families]};
    const request = envelope(source, 'sync-request', {type: 'org.bunny.sync.requested', subject, dataschema: SYNC_REQUEST, data}, trace, {sentAtMs, expiresAtMs});
    return this.dispatch(request, expiresAtMs, timeoutMs, signal, owner);
  }

  /**
   * Hands a sync request to the owner it names, or to the one owner of its families, and settles at its answer or after
   * `waitMs`. When `signal` aborts, the request is withdrawn as `request` describes.
   */
  dispatch(request: Message<SyncRequest>, expiresAtMs: number, waitMs: number, signal: AbortSignal, named?: string): Promise<SyncAnswer> {
    const decided = (answer: SyncAnswer): SyncAnswer => {
      this.#dependencies.diagnose(decisionOf(request, answer));
      return answer;
    };
    const route = this.#route(request.data.families, named);
    if (!('owner' in route)) return Promise.resolve(decided(refusal(request, route.code, route.detail)));
    const {owner} = route;
    if (signal.aborted) return Promise.resolve(decided(refusal(request, 'cancelled', 'the requester closed')));
    return new Promise(resolve => {
      let settled = false;
      let cancel: Cancel = () => {};
      const settle = (answer: SyncAnswer): void => {
        if (settled) return;
        settled = true;
        cancel();
        signal.removeEventListener('abort', withdraw);
        resolve(decided(answer));
      };
      const delivery: Delivery = {request, expiresAtMs, settle};
      // A request still waiting leaves the owner's queue, so the owner never serves it and its room is free again.
      const withdraw = (): void => {
        owner.queue.remove(delivery);
        settle(refusal(request, 'cancelled', 'the requester closed'));
      };
      signal.addEventListener('abort', withdraw);
      // At the deadline the requester stops waiting. A sync changes nothing, so it is unavailable, never expired, and
      // asking again is safe.
      // The refusal names the request's own deadline, which a remote requester chose, not what was left of it here.
      const timeoutMs = Math.round(expiresAtMs - Date.parse(request.time));
      cancel = this.#dependencies.scheduler.after(waitMs, () => {
        owner.queue.remove(delivery);
        settle(refusal(request, 'unavailable', `no sync answer within ${timeoutMs} ms`));
      });
      if (!owner.queue.push(delivery)) settle(refusal(request, 'capacity', 'the owner\'s queue is full'));
    });
  }

  /**
   * The one owner a request for `families` goes to: the owner it names, or else each family's only owner. A family that
   * no such owner serves is `unavailable`. With no owner named, a family that several owners serve is `invalid-request`,
   * so the requester names one; the request is never spread across owners. Families that one owner serves through
   * different `serveSync` calls are `invalid-request` too, since one answer has one revision.
   */
  #route(families: readonly string[], named: string | undefined): Route {
    const candidates = [...this.#owners].filter(owner => named === undefined || owner.scope.source === named);
    const serving = families.map(family => candidates.filter(owner => owner.families.has(family)));
    const missing = families.find((_, index) => serving[index]?.length === 0);
    if (missing !== undefined) return {code: 'unavailable', detail: named === undefined ? `no owner serves ${missing}` : `no owner serves ${missing} as ${named}`};
    const shared = families.find((_, index) => (serving[index]?.length ?? 0) > 1);
    if (shared !== undefined) return {code: 'invalid-request', detail: `several owners serve ${shared}; name the owner to sync from`};
    const owners = serving.map(([owner]) => owner);
    const [owner] = owners;
    if (owner === undefined || owners.some(other => other !== owner)) return {code: 'invalid-request', detail: 'one sync covers one owner\'s families'};
    return {owner};
  }

  /** The owner's states and `sync.completed`, or its refusal. A provider that throws or misfits is refused as internal. */
  async #answer(source: string, scope: ErrorScope, request: Message<SyncRequest>, provider: SyncProvider): Promise<SyncAnswer> {
    const {envelope, report} = this.#dependencies;
    let snapshot: Snapshot;
    try {
      const answer = await provider(request);
      if (isErrorBody(answer)) {
        const {requestId} = request.data;
        return {status: 'rejected', requestId, error: {error: {...answer.error, requestId, traceId: traceIdOf(request.traceparent)}}};
      }
      const problem = misfit(answer, request.data.families);
      if (problem !== undefined) throw new TypeError(`a sync snapshot ${problem}`);
      snapshot = answer;
    } catch (error) {
      report(error, scope);
      return refusal(request, 'internal', 'the owner could not serve the sync');
    }
    // Current state only: each entity's state message, never a past occurrence or removal.
    const states = snapshot.states.map(({type, subject, dataschema, data}) => envelope(source, 'state', {type, subject, dataschema, data}, childOf(request)));
    const members = states.flatMap(state => entryOf(state)?.entity ?? []);
    const completed: Message<SyncCompleted> = envelope(source, 'sync-completed', {
      type: 'org.bunny.sync.completed', subject: request.subject, dataschema: SYNC_COMPLETED,
      data: {requestId: request.data.requestId, revision: snapshot.revision, members},
    }, childOf(request));
    return {status: 'served', requestId: request.data.requestId, states, completed};
  }
}

/** The record of a sync request's one answer: served at INFO, a refusal or cancellation at its code's level. */
function decisionOf(request: Message<SyncRequest>, answer: SyncAnswer): Diagnostic {
  const facts = {
    source: request.source, pattern: `sync ${request.data.families.join(',')}`, requestId: request.data.requestId, messageId: request.id,
    trace: {traceparent: request.traceparent},
  };
  if (answer.status === 'served') return {event: 'sync.served', level: 'info', outcome: 'succeeded', ...facts};
  const {code} = answer.error.error;
  return {event: 'sync.refused', level: levelOf(code), outcome: code === 'cancelled' ? 'cancelled' : 'rejected', code, ...facts};
}
