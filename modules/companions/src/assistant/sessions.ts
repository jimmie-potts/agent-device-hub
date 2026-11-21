// Native assistant task sessions (Hub #505): what the shared session model hears of each task. A task is one root session
// of the native source, its run ID the turn and its open clarification or approval the attention item. The engine adds
// the observations for a task's change to the outbox transaction that commits the change, so the report commits with it;
// nothing else sends them, and outbox republication sends the same messages again. The projection is a pure function of
// the saved task, and the store keeps the last one reported, so a change that leaves it equal reports nothing: a read,
// an enable or disable, a spoken reply and a startup reconciliation that keeps a task's state all report nothing.
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type NoticeResult} from '@jimmie-potts/event-contracts/v2/families';
import {NATIVE_SOURCE} from '@jimmie-potts/event-contracts/v2/sources';
import type {AssistantProfile, AssistantStatus} from '@jimmie-potts/event-contracts/v2/assistant';
import {PROFILES} from '../knowledge/model.js';

/** The lifecycle version that names the native source. */
export const NATIVE_LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.2';

/** What the shared session model hears of a task. */
export type Projection = {
  run: string;
  work: 'active' | 'idle' | 'interrupted' | 'unknown';
  /** The open clarification or approval, and the run it was asked in. A delegation is not owner attention. */
  question: {id: string; kind: 'input' | 'approval'; run: string} | null;
  result: NoticeResult | null;
};

/** The parts of a saved task the projection reads. */
export type ProjectedTask = {
  id: string; profile: AssistantProfile; runId: string | null; status: AssistantStatus;
  question: {id: string; kind: 'clarification' | 'approval' | 'delegation'; answer: string | null} | null;
};

const RESULTS: readonly string[] = ['succeeded', 'failed', 'cancelled'];
const WORK: Readonly<Record<AssistantStatus, Projection['work']>> = {
  running: 'active', waiting: 'idle', paused: 'interrupted', uncertain: 'unknown', succeeded: 'idle', failed: 'idle', cancelled: 'idle',
};

/**
 * A task's projection, or undefined before its first run. A running task works; a waiting one is idle, whether it waits
 * for the owner or for delegated work; a paused one was cut off and makes no running-work claim; an uncertain one's work
 * is unknown; an ended one is idle with its result. Only an unanswered clarification (`input`, which blocks the task) or
 * approval of an unfinished task is attention.
 */
export function projectionOf(task: ProjectedTask): Projection | undefined {
  if (task.runId === null) return undefined;
  const result = RESULTS.includes(task.status) ? task.status as NoticeResult : null;
  const asked = task.question;
  const question = result === null && asked !== null && asked.answer === null && asked.kind !== 'delegation'
    ? {id: asked.id, kind: asked.kind === 'approval' ? 'approval' as const : 'input' as const, run: task.runId} : null;
  return {run: task.runId, work: WORK[task.status], question, result};
}

/** The native identity of a task's session. */
export const taskIdentity = (taskId: string): Identity =>
  ({provider: NATIVE_SOURCE.provider, client: NATIVE_SOURCE.client, hostId: NATIVE_SOURCE.hostId, sourceId: NATIVE_SOURCE.sourceId, sessionId: taskId});

/** One event to report and the turn it is on. */
export type Reported = {event: LifecycleEvent; turn: string};

const STOPS: Readonly<Record<Projection['work'], LifecycleEvent['kind']>> = {
  active: 'turn-started', idle: 'turn-waiting', interrupted: 'turn-interrupted', unknown: 'turn-uncertain',
};

/**
 * The events that move the task's session from the last reported projection to the next, in order: the resolution of a
 * question the task no longer waits on, a new run's start, a newly asked question, then how the work stopped. An ended
 * task's own turn end clears its question, so it is not resolved first.
 */
export function eventsOf(before: Projection | undefined, after: Projection): Reported[] {
  const events: Reported[] = [];
  const open = before?.question ?? null;
  if (open !== null && after.result === null && after.question?.id !== open.id) {
    events.push({event: {kind: 'attention-resolved', attention: {status: 'known', id: open.id}}, turn: open.run});
  }
  const started = before === undefined || before.run !== after.run;
  if (started) events.push({event: {kind: 'turn-started'}, turn: after.run});
  const asked = after.question;
  if (asked !== null && (started || open?.id !== asked.id)) {
    events.push({event: {kind: asked.kind === 'approval' ? 'attention-approval' : 'attention-input', attention: {status: 'known', id: asked.id}}, turn: asked.run});
  }
  if (after.result !== null) {
    if (started || before?.result !== after.result) events.push({event: {kind: 'turn-ended', result: after.result}, turn: after.run});
  } else if (after.work !== (started ? 'active' : before?.work)) {
    events.push({event: {kind: STOPS[after.work]} as LifecycleEvent, turn: after.run});
  }
  return events;
}

/** The observation of one reported event, at its task's ordering sequence and the module's instant, titled by persona. */
export function observationOf(task: Pick<ProjectedTask, 'id' | 'profile'>, reported: Reported, sequence: number, observedAtMs: number): LifecycleObservation {
  const persona = PROFILES.find(profile => profile.id === task.profile);
  return {
    identity: taskIdentity(task.id), turn: {status: 'known', id: reported.turn}, parent: {status: 'top-level'}, nativeEventId: String(sequence),
    event: reported.event, observedAtMs,
    ordering: {status: 'known', authority: NATIVE_SOURCE.sourceId, epoch: task.id, sequence},
    ...(persona === undefined ? {} : {title: {value: persona.name, source: 'provider' as const}}),
  };
}

/** The message draft of an observation, on its session's lifecycle key. */
export function observationDraft(observation: LifecycleObservation): {key: string; draft: {kind: 'occurrence'; type: string; subject: string; dataschema: string; data: LifecycleObservation}} {
  const subject = sessionEntityId(observation.identity);
  return {key: `bunny.event.lifecycle.${subject}`, draft: {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: NATIVE_LIFECYCLE_SCHEMA, data: observation}};
}
