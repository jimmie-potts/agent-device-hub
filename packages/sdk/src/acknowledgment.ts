// The outcome acknowledgment (ADR 0012, "Acknowledging outcomes", Hub #782): the core's `outcome-recorded` occurrence,
// which tells a module that the core recorded one of its outcomes. The core publishes it once the outcome and its
// `(source, id)` have committed, and again for each exact duplicate; a module's outbox forgets the outcome only when the
// sender is the core. A lost or forged acknowledgment therefore never discards a stored outcome: the module sends the
// outcome again at its next start, and the core acknowledges it again.
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {CORE_SOURCE, outcomeRecordedKey, registerCoreFamilies, type OutcomeRecorded} from '@jimmie-potts/event-contracts/v2/families';
import type {Draft} from './sdk.js';

export {CORE_SOURCE, outcomeRecordedKey, type OutcomeRecorded};
export const OUTCOME_RECORDED_SCHEMA = 'https://bunny.invalid/events/outcome-recorded/2.0';
export const OUTCOME_RECORDED_TYPE = 'org.bunny.outcome.recorded';

/** The core's acknowledgment of `outcome`, as its key and draft: an occurrence whose subject is the outcome's `id`. */
export function acknowledgmentOf(outcome: Pick<Message<unknown>, 'source' | 'id'>): {key: string; draft: Draft<OutcomeRecorded>} {
  return {
    key: outcomeRecordedKey(outcome.source),
    draft: {kind: 'occurrence', type: OUTCOME_RECORDED_TYPE, subject: outcome.id, dataschema: OUTCOME_RECORDED_SCHEMA, data: {source: outcome.source, id: outcome.id}},
  };
}

/**
 * What `message` says to the participant `source`: `{id}` when it is the core's acknowledgment of `source`'s outcome
 * `id`; `forged` when it looks like one but another participant sent it, which a correct participant never does; and
 * undefined for any other message, such as an acknowledgment of another participant's outcome. The sender is the
 * envelope's `source`, which the bus and every remote edge set from the authenticated participant, never the payload.
 */
export function acknowledgment(message: Message<unknown>, source: string): {id: string} | 'forged' | undefined {
  const data = message.data as Partial<OutcomeRecorded> | null;
  if (message.type !== OUTCOME_RECORDED_TYPE || typeof data !== 'object' || data === null || data.source !== source || typeof data.id !== 'string') return undefined;
  return message.source === CORE_SOURCE ? {id: data.id} : 'forged';
}

/**
 * The validator a remote edge checks messages with: profile 2.0, the core families, the device families every device
 * module answers, and `schemas`, the modules' own payload schemas by `dataschema`. A remote part gives it to its
 * outbox as `validator`, so a message the edge would refuse is refused when it is stored, and never holds back the
 * outcomes behind it (Hub #948, #782).
 */
export function edgeValidator(schemas: Readonly<Record<string, object>> = {}): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  for (const [dataschema, schema] of Object.entries(schemas)) validator.register(dataschema, schema);
  return validator;
}
