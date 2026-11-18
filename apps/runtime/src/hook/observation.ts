// What a 2.0 agent hook publishes (Hub #926): the 2.0 `lifecycle` observation that the adapter builds (`adapter.ts`), with
// its routing key and draft.
import {sessionEntityId, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {Draft} from '@jimmie-potts/sdk';

export const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
export const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';

/** The observation's routing key, `bunny.event.lifecycle.<session id>`, and its draft, whose subject is that session. */
export function lifecycleMessage(observation: LifecycleObservation): {key: string; draft: Draft<LifecycleObservation>} {
  const subject = sessionEntityId(observation.identity);
  return {key: `bunny.event.lifecycle.${subject}`, draft: {kind: 'occurrence', type: LIFECYCLE_TYPE, subject, dataschema: LIFECYCLE_SCHEMA, data: observation}};
}
