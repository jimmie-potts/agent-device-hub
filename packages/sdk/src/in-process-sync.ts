// The owner side of sync on the in-process bus. One owner serves each family. A sync request goes straight to that
// owner, and its answer goes straight back to the requester, never to subscribers.
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type Message, type MessageKind} from '@jimmie-potts/event-contracts/v2';
import type {Diagnostic, OnDiagnostic} from './diagnostics.js';
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

/** `owned` marks the owner's own answer, served or refused, apart from the bus's refusals. */
type Delivery = {request: Message<SyncRequest>; expiresAtMs: number; settle: (answer: SyncAnswer, owned?: boolean) => void};
type Owner = {families: ReadonlySet<string>; scope: ErrorScope; queue: DeliveryQueue<Delivery>};

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
    for (const other of this.#owners) {
      const taken = served.find(family => other.families.has(family));
      if (taken !== undefined) throw new SdkError(errorBody('invalid-state', {detail: `${other.scope.source} already serves ${taken}`}));
    }
    const scope = {source, pattern: `sync ${served.join(',')}`};
    const owner: Owner = {families: new Set(served), scope, queue: new DeliveryQueue(this.#dependencies.maxQueued, async ({request, expiresAtMs, settle}) => {
      // A request past its expiry is ignored: its requester already has an answer, so nothing serves it.
      if (expiresAtMs <= this.#dependencies.now()) return;
      const {answer, owned} = await this.#answer(source, scope, request, provider);
      settle(answer, owned);
    })};
    this.#owners.add(owner);
    return {close: () => {
      this.#owners.delete(owner);
      // Requests still waiting never reached the owner, so their requesters learn that at once.
      return owner.queue.close(({request, settle}) => { settle(refusal(request, 'unavailable', 'the owner closed')); });
    }};
  }

  /**
   * Sends one sync request to the owner of `families`. Resolves with its answer or a refusal; never rejects. When
   * `signal` aborts, the request is withdrawn: taken out of the owner's queue if it still waits there, and refused as
   * `cancelled`.
   */
  request(source: string, {families, requestId, timeoutMs, trace, signal}: OutgoingSync): Promise<SyncAnswer> {
    const {now, envelope} = this.#dependencies;
    const sentAtMs = now(), expiresAtMs = sentAtMs + timeoutMs;
    const subject = families.join(',');
    const data = {requestId, families: [...families]};
    const request = envelope(source, 'sync-request', {type: 'org.bunny.sync.requested', subject, dataschema: SYNC_REQUEST, data}, trace, {sentAtMs, expiresAtMs});
    return this.dispatch(request, expiresAtMs, timeoutMs, signal);
  }

  /**
   * Hands a sync request to the one owner of its families, and settles at its answer or after `waitMs`. When `signal`
   * aborts, the request is withdrawn as `request` describes.
   */
  dispatch(request: Message<SyncRequest>, expiresAtMs: number, waitMs: number, signal: AbortSignal): Promise<SyncAnswer> {
    const {families} = request.data;
    const decided = (answer: SyncAnswer, owned = false): SyncAnswer => {
      this.#dependencies.diagnose(decisionOf(request, answer, owned));
      return answer;
    };
    const owners = families.map(family => [...this.#owners].find(owner => owner.families.has(family)));
    const missing = families.find((_, index) => owners[index] === undefined);
    if (missing !== undefined) return Promise.resolve(decided(refusal(request, 'unavailable', `no owner serves ${missing}`)));
    const [owner] = owners;
    if (owner === undefined || owners.some(other => other !== owner)) {
      return Promise.resolve(decided(refusal(request, 'invalid-request', 'one sync covers one owner\'s families')));
    }
    if (signal.aborted) return Promise.resolve(decided(refusal(request, 'cancelled', 'the requester closed')));
    return new Promise(resolve => {
      let settled = false;
      let cancel: Cancel = () => {};
      const settle = (answer: SyncAnswer, owned?: boolean): void => {
        if (settled) return;
        settled = true;
        cancel();
        signal.removeEventListener('abort', withdraw);
        resolve(decided(answer, owned));
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
   * The owner's states and `sync.completed`, or its refusal, `owned` when the owner answered. A provider that throws or
   * misfits is refused as internal.
   */
  async #answer(source: string, scope: ErrorScope, request: Message<SyncRequest>, provider: SyncProvider): Promise<{answer: SyncAnswer; owned: boolean}> {
    const {envelope, report} = this.#dependencies;
    let snapshot: Snapshot;
    try {
      const answer = await provider(request);
      if (isErrorBody(answer)) {
        const {requestId} = request.data;
        return {owned: true, answer: {status: 'rejected', requestId, error: {error: {...answer.error, requestId, traceId: traceIdOf(request.traceparent)}}}};
      }
      const problem = misfit(answer, request.data.families);
      if (problem !== undefined) throw new TypeError(`a sync snapshot ${problem}`);
      snapshot = answer;
    } catch (error) {
      report(error, scope);
      return {owned: false, answer: refusal(request, 'internal', 'the owner could not serve the sync')};
    }
    // Current state only: each entity's state message, never a past occurrence or removal.
    const states = snapshot.states.map(({type, subject, dataschema, data}) => envelope(source, 'state', {type, subject, dataschema, data}, childOf(request)));
    const members = states.flatMap(state => entryOf(state)?.entity ?? []);
    const completed: Message<SyncCompleted> = envelope(source, 'sync-completed', {
      type: 'org.bunny.sync.completed', subject: request.subject, dataschema: SYNC_COMPLETED,
      data: {requestId: request.data.requestId, revision: snapshot.revision, members},
    }, childOf(request));
    return {owned: true, answer: {status: 'served', requestId: request.data.requestId, states, completed}};
  }
}

/**
 * The record of a sync request's one answer: served at INFO; the owner's typed refusal or a cancellation at INFO; any
 * other refusal at WARN.
 */
function decisionOf(request: Message<SyncRequest>, answer: SyncAnswer, owned: boolean): Diagnostic {
  const facts = {
    source: request.source, pattern: `sync ${request.data.families.join(',')}`, requestId: request.data.requestId, messageId: request.id,
    trace: {traceparent: request.traceparent},
  };
  if (answer.status === 'served') return {event: 'sync.served', level: 'info', outcome: 'succeeded', ...facts};
  const {code} = answer.error.error;
  const expected = owned || code === 'cancelled';
  return {event: 'sync.refused', level: expected ? 'info' : 'warn', outcome: code === 'cancelled' ? 'cancelled' : 'rejected', code, ...facts};
}
