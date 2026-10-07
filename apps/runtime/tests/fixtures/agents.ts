// Synthetic agent sessions for the runtime's tests and scenario catalog (Hub #846, #831): the hook observations a remote
// hook would send the core, in the 2.0 `lifecycle` family. Every identity and ID here is synthetic.
import {
  sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type Parent, type Title,
} from '@jimmie-potts/event-contracts/v2/families';
import type {Draft} from '@jimmie-potts/sdk';

export const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
export const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';
/** The synthetic Claude Code session every scenario observes. */
export const IDENTITY: Identity = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'};
/** Its session entity ID, as the core keys it. */
export const SESSION_ID = sessionEntityId(IDENTITY);
/** A second synthetic session on the same host and source. */
export const OTHER: Identity = {...IDENTITY, sessionId: 'session-sim-2'};
export const OTHER_ID = sessionEntityId(OTHER);
/** A subagent of the first session. */
export const CHILD: Identity = {...IDENTITY, sessionId: 'session-sim-1-agent'};
export const CHILD_ID = sessionEntityId(CHILD);

export const sessionStarted: LifecycleEvent = {kind: 'session-started'};
export const turnStarted: LifecycleEvent = {kind: 'turn-started'};
export const turnEnded: LifecycleEvent = {kind: 'turn-ended'};
export const runtimeEnded: LifecycleEvent = {kind: 'runtime-ended'};
export const approvalPrompt = (id: string): LifecycleEvent => ({kind: 'attention-approval', attention: {status: 'known', id}});
/** An approval without a request ID, as a Claude Code permission dialog reports it. */
export const unknownApproval: LifecycleEvent = {kind: 'attention-approval', attention: {status: 'unknown'}};
export const approvalResolved = (id: string): LifecycleEvent => ({kind: 'attention-resolved', attention: {status: 'known', id}});

export type ObservationOptions = {
  identity?: Identity;
  /** The observation's known turn, or null for an unknown one. Defaults to `turn-1`. */
  turn?: string | null;
  parent?: Parent;
  /** Known ordering under the identity's source, epoch `epoch-1`, at this sequence. */
  sequence?: number;
  nativeEventId?: string;
  hostSessionId?: string;
  title?: Title;
};

/** A hook's observation of `event` at `observedAtMs`, as the 2.0 `lifecycle` payload. */
export function lifecycleOf(event: LifecycleEvent, observedAtMs: number, options: ObservationOptions = {}): LifecycleObservation {
  const identity = options.identity ?? IDENTITY;
  const turn = options.turn === undefined ? 'turn-1' : options.turn;
  return {
    identity, turn: turn === null ? {status: 'unknown'} : {status: 'known', id: turn}, parent: options.parent ?? {status: 'top-level'}, event, observedAtMs,
    ordering: options.sequence === undefined ? {status: 'unknown'} : {status: 'known', authority: identity.sourceId, epoch: 'epoch-1', sequence: options.sequence},
    ...(options.nativeEventId === undefined ? {} : {nativeEventId: options.nativeEventId}),
    ...(options.hostSessionId === undefined ? {} : {hostSessionId: options.hostSessionId}),
    ...(options.title === undefined ? {} : {title: options.title}),
  };
}

/** A hook's observation of one event, at `observedAtMs`, for the core: its routing key and draft. */
export function observation(event: LifecycleEvent, observedAtMs: number, options: ObservationOptions = {}): {key: string; draft: Draft<LifecycleObservation>} {
  const data = lifecycleOf(event, observedAtMs, options);
  const subject = sessionEntityId(data.identity);
  return {key: `bunny.event.lifecycle.${subject}`, draft: {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: LIFECYCLE_SCHEMA, data}};
}
