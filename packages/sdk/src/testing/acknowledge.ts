// A stand-in acknowledgment (Hub #882). ADR 0012 has a module report each outcome again after a restart until the core
// has it. The core's real acknowledgment belongs to Hub #782; until then, the kit's stand-in cores send this one, so
// that tests exercise an outbox forgetting what was acknowledged. Modules use it only in tests.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Outbox} from '../outbox.js';
import type {Draft, Sdk, Subscription} from '../sdk.js';

export const STAND_IN_ACK_SCHEMA = 'https://bunny.invalid/events/stand-in-ack/2.0';
/** The stand-in acknowledgment's payload schema, by `dataschema`, for validators. */
export const standInAckSchemas: Readonly<Record<string, object>> = {
  [STAND_IN_ACK_SCHEMA]: {
    type: 'object', additionalProperties: false, required: ['source', 'id'],
    properties: {
      source: {type: 'string', pattern: '^bunny(/[a-z0-9][a-z0-9-]*)+$', maxLength: 256},
      id: {$ref: 'https://bunny.invalid/events/blocks/2.0#/$defs/id'},
    },
  },
};

export type StandInAck = {source: string; id: string};

/** The key a module hears its acknowledgments on: `bunny.event.stand-in-ack.<module name>`. */
export const standInAckKey = (source: string): string => `bunny.event.stand-in-ack.${source.slice(source.lastIndexOf('/') + 1)}`;

/** The stand-in core's acknowledgment that it has recorded `outcome`. */
export const standInAck = (outcome: Message<unknown>): {key: string; draft: Draft<StandInAck>} => ({
  key: standInAckKey(outcome.source),
  draft: {
    kind: 'occurrence', type: 'org.bunny.stand-in-ack.recorded', subject: outcome.id, dataschema: STAND_IN_ACK_SCHEMA,
    data: {source: outcome.source, id: outcome.id},
  },
});

/**
 * Forgets each of the module's outcomes that the stand-in core acknowledges. Call it before `outbox.republish()`, so
 * that an acknowledgment of a resent outcome is not missed. `heard` is told of each acknowledged outcome's id.
 */
export function followStandInAcks(sdk: Sdk, outbox: Pick<Outbox, 'acknowledge'>, heard: (id: string) => void = () => {}): Promise<Subscription> {
  return sdk.subscribe<StandInAck>(standInAckKey(sdk.source), message => {
    if (message.data.source === sdk.source && outbox.acknowledge(message.data.id)) heard(message.data.id);
  });
}
