// The earlier hook mapping, kept for tests as the retained path's reference (Hub #1865, design decision 14): a copy of
// `observationOf` from apps/runtime/src/hook/observation.ts at main 6adad7e7, which turned the lifecycle 1.x envelope
// that agent-state's normalizers build into the 2.0 `lifecycle` observation. The golden test runs the retained
// normalizers through this copy beside the hook, and the core's `toEnvelope` is checked as its inverse until the core
// takes observations directly. Do not change it.
import type {Envelope} from '@jimmie-potts/agent-state';
import type {LifecycleEvent, LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';

/** The 2.0 event for a 1.x event, kebab-cased; a consumer's acknowledgment is a command in 2.0, never an observation. */
function eventOf(event: Envelope['event']): LifecycleEvent | undefined {
  switch (event.kind) {
    case 'session.started':
      return {kind: 'session-started'};
    case 'turn.started':
      return {kind: 'turn-started'};
    case 'activity.observed':
      return {kind: 'activity-observed'};
    case 'turn.ended':
      return {kind: 'turn-ended'};
    case 'turn.interrupted':
      return {kind: 'turn-interrupted'};
    case 'runtime.ended':
      return {kind: 'runtime-ended'};
    case 'question.continuing':
      return {kind: 'question-continuing', attention: event.attention};
    case 'attention.input':
      return {kind: 'attention-input', attention: event.attention};
    case 'attention.approval':
      return {kind: 'attention-approval', attention: event.attention};
    case 'attention.resolved':
      return {kind: 'attention-resolved', attention: event.attention};
    case 'read.observed':
      return {kind: 'read-observed', state: event.state};
    case 'evidence.unavailable':
      return {kind: 'evidence-unavailable', dimension: event.dimension, reason: event.reason};
    case 'notice.acknowledged':
      return undefined;
  }
}

/**
 * The 2.0 observation for a lifecycle 1.0 to 1.2 envelope, or undefined for an acknowledgment. `eventId` becomes
 * `nativeEventId`, known ordering names its source as its authority, and every other field keeps its value.
 */
export function observationOf(envelope: Envelope): LifecycleObservation | undefined {
  const event = eventOf(envelope.event);
  if (event === undefined) return undefined;
  const {identity, turn, parent, eventId, observedAtMs, occurredAtMs, ordering, projectId, label, title, project, hostSessionId} = envelope;
  return {
    identity, turn, parent,
    ...(eventId === undefined ? {} : {nativeEventId: eventId}),
    event, observedAtMs,
    ...(occurredAtMs === undefined ? {} : {occurredAtMs}),
    ordering: ordering.status === 'known' ? {status: 'known', authority: identity.sourceId, epoch: ordering.epoch, sequence: ordering.sequence} : {status: 'unknown'},
    ...(projectId === undefined ? {} : {projectId}),
    ...(label === undefined ? {} : {label}),
    ...(title === undefined ? {} : {title}),
    ...(project === undefined ? {} : {project}),
    ...(hostSessionId === undefined ? {} : {hostSessionId}),
  };
}
