import {Ajv2020} from 'ajv/dist/2020.js';
import {MessageValidator, RETRYABLE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {controls, families, gestures, schemaOf, typeOf, type ReachyState} from './contracts.js';
const integer = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const id = {type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.-]+$'};
const ticket = {type: 'object', additionalProperties: false, required: ['epoch', 'sequence'], properties: {epoch: id, sequence: integer}};
const closed = (properties: Record<string, object>, required = Object.keys(properties)): object => ({type: 'object', additionalProperties: false, properties, required});
const nullable = (schema: object): object => ({anyOf: [{type: 'null'}, schema]});
const guards = {requestId: id, expectedConfigurationRevision: integer, expectedGeneration: ticket, heldRequestId: id, recovered: {const: true}};
const command = (extra: Record<string, object>, guarded=false): object => closed({...guards, ...extra}, ['requestId', ...(guarded?['expectedConfigurationRevision','expectedGeneration']:[]), ...Object.keys(extra)]);
export const outcomeSchema = closed({requestId:id,result:{enum:['succeeded','failed','uncertain']},evidence:{enum:['none','transmitted','observed']},error:closed({code:{enum:Object.keys(RETRYABLE)},retryable:{type:'boolean'},requestId:id,traceId:{type:'string',pattern:'^[0-9a-f]{32}$'},detail:{type:'string',minLength:1,maxLength:1024}},['code','retryable'])},['requestId','result','evidence']);
export const stateSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'revision', 'configurationRevision', 'generation', 'simulated', 'connection', 'enabled', 'takeover', 'observation', 'active', 'pending', 'held', 'lastOutcome', 'lastTransmission'],
  properties: {
    id, revision: integer, configurationRevision: integer, generation: ticket, simulated: {const: true},
    connection: {enum: ['unknown', 'available', 'unavailable', 'stale', 'mismatch']}, enabled: {type: 'boolean'}, takeover: {type: 'boolean'},
    observation: nullable(closed({antennas: {type: 'array', minItems: 2, maxItems: 2, items: {type: 'number'}}, observedAtMs: integer})),
    active: nullable(closed({requestId: id, gesture: {enum: gestures}, moveId: nullable(id), automatic: {type: 'boolean'}})),
    pending: {...integer, maximum: 128},
    held: nullable(closed({requestId: id, heldAtMs: integer, moveId: nullable(id)})),
    lastTransmission: {anyOf: [closed({status: {const: 'unknown'}}), closed({status: {const: 'known'}, requestId: id, transmittedAtMs: integer, operationIds: {type:'array', items:id}}, ['status','transmittedAtMs','operationIds'])]},
    lastOutcome: nullable(outcomeSchema),
  },
} as const;
const entries: Record<string, object> = {
  'reachy-gesture': command({gesture: {enum: gestures}},true),
  'reachy-stop': command({},true),
  'reachy-control': command({action: {enum: controls}}),
  'reachy-auto': command({gesture: {enum: ['notice','attention']}, opportunityId: {type:'string',pattern:'^[0-9a-f]{64}$'}, validUntilMs:integer},true),
  'reachy-state': stateSchema,
};
export const reachySchemas = Object.fromEntries(Object.entries(entries).map(([family, body]) =>
  [schemaOf(family), {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: schemaOf(family), ...body}]));
export function registerReachyFamilies(validator: MessageValidator): void {
  for (const [family, body] of Object.entries(reachySchemas)) {
    const name = family.slice('https://bunny.invalid/events/'.length).split('/')[0];
    if (name === undefined) throw new Error('missing Reachy family');
    const isCommand = families.some(value => value === name);
    validator.register(family, body, (message: Message) =>
      message.kind !== (isCommand ? 'command' : 'state') || message.type !== (isCommand ? typeOf(name) : 'org.bunny.reachy-state.updated')
        ? 'Reachy family kind/type mismatch' : !isCommand && (typeof message.data !== 'object' || message.data === null || !('id' in message.data) || message.data.id !== message.subject) ? 'Reachy state subject mismatch' : undefined);
  }
}
export function reachyValidator(): MessageValidator {
  const validator = new MessageValidator(); registerCoreFamilies(validator); registerDeviceFamilies(validator); registerReachyFamilies(validator); return validator;
}
export const validState = new Ajv2020({strict: false}).compile<ReachyState>(stateSchema);
