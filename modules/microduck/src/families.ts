import {Ajv2020} from 'ajv/dist/2020.js';
import {MessageValidator, RETRYABLE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {controls, families, gestures, schemaOf, typeOf, type MicroDuckState} from './contracts.js';
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
  required: ['id', 'revision', 'configurationRevision', 'generation', 'simulated', 'connection', 'enabled', 'takeover', 'observation', 'active', 'pending', 'held', 'lastOutcome', 'lastTransmission', 'lastRecovery', 'fixtureSession', 'ownership', 'latched'],
  properties: {
    id, revision: integer, configurationRevision: integer, generation: ticket, simulated: {const: true},
    connection: {enum: ['unknown', 'available', 'unavailable', 'stale', 'mismatch']}, enabled: {type: 'boolean'}, takeover: {type: 'boolean'}, latched: {type: 'boolean'}, fixtureSession: nullable(id), ownership: {enum: ['unknown', 'fixture-exclusive']},
    observation: nullable(closed({backend:{anyOf:[closed({kind:{const:'fake-io'}}),closed({kind:{const:'vendor-mujoco'},apiVersion:{const:47},daemonVersion:{const:'0.18.3'},revision:{const:'b2b0d213a402caeac492dd662ea891faa17f67c0'}})]}, syntheticJointIndices:{type:'array',minItems:1,maxItems:1,items:{const:9}}, session:id, sensorNs:{type:'string',pattern:'^[1-9][0-9]{0,19}$'}, head:{type:'array',minItems:4,maxItems:4,items:{type:'number'}}, targets:{type:'array',minItems:15,maxItems:15,items:{type:'number'}}, joints:{type:'array',minItems:15,maxItems:15,items:{type:'number'}}, daemonUptimeSeconds:{type:'number',minimum:0},loopHz:{type:'number',minimum:0},policy:{type:'string',maxLength:64},healthy:{type:'boolean'},zeroVelocity:{type:'boolean'},observedAtMs:integer})),
    lastRecovery: nullable(closed({requestId:id,heldRequestId:id})),
    active: nullable(closed({requestId: id, gesture: {enum: gestures}, phase:{enum:['outbound','return','neutral']}, automatic: {type: 'boolean'}})),
    pending: {...integer, maximum: 128},
    held: nullable(closed({requestId: id, heldAtMs: integer})),
    lastTransmission: {anyOf: [closed({status: {const: 'unknown'}}), closed({status: {const: 'known'}, requestId: id, transmittedAtMs: integer, operationIds: {type:'array', items:id}}, ['status','transmittedAtMs','operationIds'])]},
    lastOutcome: nullable(outcomeSchema),
  },
} as const;
const entries: Record<string, object> = {
  'microduck-gesture': command({gesture: {enum: gestures}},true),
  'microduck-stop': closed({requestId:id}),
  'microduck-control': command({action: {enum: controls}},true),
  'microduck-auto': command({gesture: {enum: ['notice','attention']}, opportunityId: {type:'string',pattern:'^[0-9a-f]{64}$'}, validUntilMs:integer},true),
  'microduck-state': stateSchema,
};
export const microduckSchemas = Object.fromEntries(Object.entries(entries).map(([family, body]) =>
  [schemaOf(family), {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: schemaOf(family), ...body}]));
export function registerMicroDuckFamilies(validator: MessageValidator): void {
  for (const [family, body] of Object.entries(microduckSchemas)) {
    const name = family.slice('https://bunny.invalid/events/'.length).split('/')[0];
    if (name === undefined) throw new Error('missing MicroDuck family');
    const isCommand = families.some(value => value === name);
    validator.register(family, body, (message: Message) =>
      message.kind !== (isCommand ? 'command' : 'state') || message.type !== (isCommand ? typeOf(name) : 'org.bunny.microduck-state.updated')
        ? 'MicroDuck family kind/type mismatch' : !isCommand && (typeof message.data !== 'object' || message.data === null || !('id' in message.data) || message.data.id !== message.subject) ? 'MicroDuck state subject mismatch' : undefined);
  }
}
export function microduckValidator(): MessageValidator {
  const validator = new MessageValidator(); registerCoreFamilies(validator); registerDeviceFamilies(validator); registerMicroDuckFamilies(validator); return validator;
}
export const validState = new Ajv2020({strict: false}).compile<MicroDuckState>(stateSchema);
