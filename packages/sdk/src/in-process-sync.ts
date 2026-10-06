// The owner side of sync on the in-process bus. One owner serves each family. A sync request goes straight to that
// owner, and its answer goes straight back to the requester, never to subscribers.
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type Message, type MessageKind} from '@jimmie-potts/event-contracts/v2';
import type {ErrorScope} from './in-process.js';
import {DeliveryQueue} from './queue.js';
import {SdkError, type Subscription, type TraceContext} from './sdk.js';
import {
  checkFamilies, entryOf, schemaFamily, type OutgoingSync, type Snapshot, type SyncAnswer, type SyncCompleted, type SyncProvider, type SyncRequest,
} from './sync.js';
import {childOf, traceIdOf} from './trace.js';

type Envelope<T> = {type: string; subject: string; dataschema: string; data: T};
/** What the bus lends its sync owners: its clock, queue limit, error report and envelope builder. */
export type SyncDependencies = {
  now: () => number;
  maxQueued: number;
  report: (error: unknown, scope: ErrorScope) => void;
  envelope: <T>(source: string, kind: MessageKind, draft: Envelope<T>, trace: TraceContext, deadline?: {sentAtMs: number; expiresAtMs: number}) => Message<T>;
};

const SYNC_REQUEST = `${SCHEMA_BASE}sync-request/2.0`;
const SYNC_COMPLETED = `${SCHEMA_BASE}sync-completed/2.0`;
// sync.completed lists at most this many members.
const MAX_MEMBERS = 4096;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

type Delivery = {request: Message<SyncRequest>; expiresAtMs: number; settle: (answer: SyncAnswer) => void};
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
      settle(await this.#answer(source, scope, request, provider));
    })};
    this.#owners.add(owner);
    return {close: () => {
      this.#owners.delete(owner);
      // Requests still waiting never reached the owner, so their requesters learn that at once.
      return owner.queue.close(({request, settle}) => { settle(refusal(request, 'unavailable', 'the owner closed')); });
    }};
  }

  /** Sends one sync request to the owner of `families`. Resolves with its answer or a refusal; never rejects. */
  request(source: string, {families, requestId, timeoutMs, trace}: OutgoingSync): Promise<SyncAnswer> {
    const {now, envelope} = this.#dependencies;
    const sentAtMs = now(), expiresAtMs = sentAtMs + timeoutMs;
    const subject = families.join(',');
    const data = {requestId, families: [...families]};
    const request = envelope(source, 'sync-request', {type: 'org.bunny.sync.requested', subject, dataschema: SYNC_REQUEST, data}, trace, {sentAtMs, expiresAtMs});
    const owners = families.map(family => [...this.#owners].find(owner => owner.families.has(family)));
    const missing = families.find((_, index) => owners[index] === undefined);
    if (missing !== undefined) return Promise.resolve(refusal(request, 'unavailable', `no owner serves ${missing}`));
    const [owner] = owners;
    if (owner === undefined || owners.some(other => other !== owner)) {
      return Promise.resolve(refusal(request, 'invalid-request', 'one sync covers one owner\'s families'));
    }
    return new Promise(resolve => {
      let settled = false;
      // At the deadline the requester stops waiting; a sync changes nothing, so asking again is safe.
      const timer = setTimeout(() => { settle(refusal(request, 'unavailable', `no sync answer within ${timeoutMs} ms`)); }, timeoutMs);
      const settle = (answer: SyncAnswer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(answer);
      };
      if (!owner.queue.push({request, expiresAtMs, settle})) settle(refusal(request, 'capacity', 'the owner\'s queue is full'));
    });
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
