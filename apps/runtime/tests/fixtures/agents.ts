// A synthetic agent session for the scenario catalog (Hub #846): the hook observations a remote hook would send the
// core, in the 2.0 `lifecycle` family. Every identity and ID here is synthetic.
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {Draft} from '@jimmie-potts/sdk';

export const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
export const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';
/** The synthetic Claude Code session every scenario observes. */
export const IDENTITY: Identity = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'};
/** Its session entity ID, as the core keys it. */
export const SESSION_ID = sessionEntityId(IDENTITY);

export const sessionStarted: LifecycleEvent = {kind: 'session-started'};
export const approvalPrompt = (id: string): LifecycleEvent => ({kind: 'attention-approval', attention: {status: 'known', id}});
export const approvalResolved = (id: string): LifecycleEvent => ({kind: 'attention-resolved', attention: {status: 'known', id}});

/** A hook's observation of one event on the synthetic session, at `observedAtMs`, for the core. */
export function observation(event: LifecycleEvent, observedAtMs: number): {key: string; draft: Draft<LifecycleObservation>} {
  return {
    key: `bunny.event.lifecycle.${SESSION_ID}`,
    draft: {
      kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject: SESSION_ID, dataschema: LIFECYCLE_SCHEMA,
      data: {identity: IDENTITY, turn: {status: 'known', id: 'turn-1'}, parent: {status: 'top-level'}, event, observedAtMs, ordering: {status: 'unknown'}},
    },
  };
}
