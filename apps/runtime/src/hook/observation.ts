// What a 2.0 agent hook publishes (Hub #926): the lifecycle 1.x envelope that the existing normalizers build, as the 2.0
// `lifecycle` observation that packages/event-contracts/MAPPING.md ("Lifecycle observation") describes, with its routing
// key and draft. It is the inverse of the core's `toEnvelope`, which turns the observation back into the 1.2 envelope its
// reducer admits.
import type {Envelope} from '@jimmie-potts/agent-state';
import {sessionEntityId, type LifecycleEvent, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {Draft} from '@jimmie-potts/sdk';

export const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
export const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';

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

/** The observation's routing key, `bunny.event.lifecycle.<session id>`, and its draft, whose subject is that session. */
export function lifecycleMessage(observation: LifecycleObservation): {key: string; draft: Draft<LifecycleObservation>} {
  const subject = sessionEntityId(observation.identity);
  return {key: `bunny.event.lifecycle.${subject}`, draft: {kind: 'occurrence', type: LIFECYCLE_TYPE, subject, dataschema: LIFECYCLE_SCHEMA, data: observation}};
}
