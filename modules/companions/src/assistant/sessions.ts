// Native assistant conversation sessions (Hub #505): what the shared session model hears of each profile's conversation.
// A conversation is one root session of the native source, each task in it (one owner message and everything it
// causes, an answered question and a resumed run included) a turn, and a task's open clarification or approval the
// attention item. The engine adds the observations for a change to the outbox transaction that commits the change, so
// the report commits with it; nothing else sends them, and outbox republication sends the same messages again. The
// projection is a pure function of the saved task, and the store keeps, per conversation, the projection last reported
// (which names its turn) and the conversation's one ordering sequence, so a change that leaves the projection equal reports nothing:
// a read, an enable or disable, a spoken reply and a startup reconciliation that keeps a task's state report nothing.
// Each lifecycle observation names the conversation's companion (Hub #2054), its profile ID and persona name, apart from
// its title; title metadata never carries it, so a generated title or a rename cannot change it.
import {
  sessionEntityId, type Companion, type Identity, type LifecycleEvent, type LifecycleObservation, type NoticeResult, type Title,
} from '@jimmie-potts/event-contracts/v2/families';
import {NATIVE_SOURCE} from '@jimmie-potts/event-contracts/v2/sources';
import type {AssistantProfile, AssistantStatus} from '@jimmie-potts/event-contracts/v2/assistant';
import {PROFILES} from '../knowledge/model.js';

/** The lifecycle version of the module's lifecycle observations, which name the conversation's companion (Hub #2054). */
export const NATIVE_LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.4';
/** The lifecycle version whose `metadata-observed` carries a native conversation's title (Hub #2025). */
export const NATIVE_METADATA_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.3';

/** What the shared session model hears of a task: its turn (the task ID), its work, its open owner question and its result. */
export type Projection = {
  turn: string;
  work: 'active' | 'idle' | 'interrupted' | 'unknown';
  /** The open clarification or approval. A delegation is not owner attention. */
  question: {id: string; kind: 'input' | 'approval'} | null;
  result: NoticeResult | null;
};

/** The parts of a saved task the projection reads. */
export type ProjectedTask = {
  id: string; conversationId: string; profile: AssistantProfile; runId: string | null; status: AssistantStatus;
  question: {id: string; kind: 'clarification' | 'approval' | 'delegation'; answer: string | null} | null;
};

/** What a conversation last reported: its last ordering sequence, and the projection, of its last reported turn, it reported last. */
export type Reported = {sequence: number; projection: Projection | undefined};

const RESULTS: readonly string[] = ['succeeded', 'failed', 'cancelled'];
const WORK: Readonly<Record<AssistantStatus, Projection['work']>> = {
  running: 'active', waiting: 'idle', paused: 'interrupted', uncertain: 'unknown', succeeded: 'idle', failed: 'idle', cancelled: 'idle',
};

/**
 * A task's projection, or undefined before its first run. A running task works; a waiting one is idle, whether it waits
 * for the owner or for delegated work; a paused one was cut off and makes no running-work claim; an uncertain one's work
 * is unknown; an ended one is idle with its result. Only an unanswered clarification (`input`, which blocks the task) or
 * approval of an unfinished task is attention. Runs are not part of it: a resumed run stays in the task's turn.
 */
export function projectionOf(task: ProjectedTask): Projection | undefined {
  if (task.runId === null) return undefined;
  const result = RESULTS.includes(task.status) ? task.status as NoticeResult : null;
  const asked = task.question;
  const question = result === null && asked !== null && asked.answer === null && asked.kind !== 'delegation'
    ? {id: asked.id, kind: asked.kind === 'approval' ? 'approval' as const : 'input' as const} : null;
  return {turn: task.id, work: WORK[task.status], question, result};
}

/** Whether a task waits on its owner: an open clarification or approval. The first start reports such a task at once. */
export const waitsOnOwner = (task: ProjectedTask): boolean => (projectionOf(task)?.question ?? null) !== null;

/** The native identity of a conversation's session. */
export const conversationIdentity = (conversationId: string): Identity =>
  ({provider: NATIVE_SOURCE.provider, client: NATIVE_SOURCE.client, hostId: NATIVE_SOURCE.hostId, sourceId: NATIVE_SOURCE.sourceId, sessionId: conversationId});

const STOPS: Readonly<Record<Projection['work'], LifecycleEvent['kind']>> = {
  active: 'activity-observed', idle: 'turn-waiting', interrupted: 'turn-interrupted', unknown: 'turn-uncertain',
};

/**
 * The events that move one turn from the projection last reported to the next, in order: the resolution of a question
 * the task no longer waits on, the start of a new turn, a newly asked question, then how the work stopped, or that it is
 * active again. A projection of another turn, or none, starts a new turn. An ended task's own turn end clears its
 * question, so it is not resolved first. A resumed run is the same turn: its work becomes active again with no start.
 */
export function eventsOf(before: Projection | undefined, after: Projection): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const started = before === undefined || before.turn !== after.turn;
  const open = started ? null : before.question;
  if (open !== null && after.result === null && after.question?.id !== open.id) events.push({kind: 'attention-resolved', attention: {status: 'known', id: open.id}});
  if (started) events.push({kind: 'turn-started'});
  const asked = after.question;
  if (asked !== null && (started || open?.id !== asked.id)) {
    events.push({kind: asked.kind === 'approval' ? 'attention-approval' : 'attention-input', attention: {status: 'known', id: asked.id}});
  }
  if (after.result !== null) {
    if (started || before.result !== after.result) events.push({kind: 'turn-ended', result: after.result});
  } else if (after.work !== (started ? 'active' : before.work)) {
    events.push({kind: STOPS[after.work]} as LifecycleEvent);
  }
  return events;
}

/** One event to report and the turn it is on. */
export type TurnEvent = {turn: string; event: LifecycleEvent};

/**
 * What a conversation reports at a commit: the events that move its session from what it last reported to its latest
 * task's projection now, and the projection to record; undefined when nothing changed. When the latest task is not the
 * turn last reported, that earlier task's own change comes first, so its turn end precedes the next turn's start even
 * when one commit makes both.
 */
export function changesOf(reported: Reported, earlier: ProjectedTask | undefined, latest: ProjectedTask): {events: TurnEvent[]; projection: Projection} | undefined {
  const after = projectionOf(latest);
  if (after === undefined) return undefined;
  const events: TurnEvent[] = [];
  let before = reported.projection;
  if (before !== undefined && before.turn !== latest.id) {
    const closed = earlier?.id === before.turn ? projectionOf(earlier) : undefined;
    if (closed !== undefined) events.push(...eventsOf(before, closed).map(event => ({turn: closed.turn, event})));
    before = undefined;
  }
  events.push(...eventsOf(before, after).map(event => ({turn: after.turn, event})));
  return events.length === 0 ? undefined : {events, projection: after};
}

/**
 * The observation of one reported event, at its conversation's ordering sequence and the module's instant, titled by the
 * conversation's title (Hub #2025), or by persona without one, and naming the conversation's companion (Hub #2054): its
 * profile by ID and persona name. The title never names the companion unless it is the persona fallback.
 */
export function observationOf(task: Pick<ProjectedTask, 'conversationId' | 'profile'>, reported: TurnEvent, sequence: number, observedAtMs: number, title?: Title): LifecycleObservation {
  const persona = PROFILES.find(profile => profile.id === task.profile);
  const titled = title ?? (persona === undefined ? undefined : {value: persona.name, source: 'provider' as const});
  const companions: Companion[] | undefined = persona === undefined ? undefined : [{id: persona.id, name: persona.name}];
  return {
    identity: conversationIdentity(task.conversationId), turn: {status: 'known', id: reported.turn}, parent: {status: 'top-level'}, nativeEventId: String(sequence),
    event: reported.event, observedAtMs,
    ordering: {status: 'known', authority: NATIVE_SOURCE.sourceId, epoch: task.conversationId, sequence},
    ...(titled === undefined ? {} : {title: {value: titled.value, source: titled.source}}),
    ...(companions === undefined ? {} : {companions}),
  };
}

/**
 * A conversation's title as display metadata (Hub #2025): no turn, ordering or lifecycle evidence, so it changes the
 * session's title alone and neither keeps an expiring session nor consumes an ordering sequence.
 */
export function titleObservationOf(conversationId: string, title: Title, observedAtMs: number): LifecycleObservation {
  return {identity: conversationIdentity(conversationId), turn: {status: 'unknown'}, parent: {status: 'top-level'}, event: {kind: 'metadata-observed'},
    observedAtMs, ordering: {status: 'unknown'}, title: {value: title.value, source: title.source}};
}

/** The message draft of an observation, on its session's lifecycle key: a title in `lifecycle/2.3`, everything else in 2.4. */
export function observationDraft(observation: LifecycleObservation): {key: string; draft: {kind: 'occurrence'; type: string; subject: string; dataschema: string; data: LifecycleObservation}} {
  const subject = sessionEntityId(observation.identity);
  const dataschema = observation.event.kind === 'metadata-observed' ? NATIVE_METADATA_SCHEMA : NATIVE_LIFECYCLE_SCHEMA;
  return {key: `bunny.event.lifecycle.${subject}`, draft: {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema, data: observation}};
}
