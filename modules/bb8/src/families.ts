import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {commandType, PUBLIC_FAMILIES, schemaOf, type LinkResult, type LinkState, type RobotState} from './contracts.js';
const block = (name: string): object => ({$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
const object = (properties: Record<string, object>, required = Object.keys(properties)): object => ({type: 'object', additionalProperties: false, required, properties});
const byte = {type: 'integer', minimum: 0, maximum: 255};
const tuple = (length: number): object => ({type: 'array', minItems: length, maxItems: length, items: byte});
const unknown = block('unknown');
const known = (value: object): object => ({oneOf: [unknown, object({status: {const: 'known'}, value})]});
export const ledSchema = {oneOf: [object({target: {const: 'main'}, rgb: tuple(3)}), object({target: {const: 'tail'}, brightness: byte})]};
const operationSchema = {oneOf: [...['connect', 'disconnect', 'wake', 'power-refresh'].map(kind => object({kind: {const: kind}})), object({kind: {const: 'led-set'}, led: ledSchema})]};
const guards = {expectedConfigurationRevision: block('revision'), expectedHelperEpoch: block('routingId'), expectedConnectionGeneration: block('revision')};
const powerSchema = object({recordVersion: {const: 1}, category: {enum: [1, 2, 3, 4]}, voltageHundredths: {type: 'integer', minimum: 0, maximum: 65535}, rechargeCount: {type: 'integer', minimum: 0, maximum: 65535}, secondsAwakeSinceRecharge: {type: 'integer', minimum: 0, maximum: 65535}, observedAtMs: block('instantMs')});
const versionSchema = object({bytes: tuple(8), observedAtMs: block('instantMs')});
const linkProperties = {id: block('routingId'), revision: block('revision'), configurationRevision: block('revision'), helperEpoch: block('routingId'), connectionGeneration: block('revision'), connection: {enum: ['disconnected', 'connected', 'unavailable']}, changedAtMs: block('instantMs')};
const resultProperties = {
  id: block('routingId'), revision: block('revision'), robotId: block('routingId'), parentRequestId: block('requestId'), requestId: block('requestId'), helperEpoch: block('routingId'), connectionGeneration: block('revision'),
  result: {enum: ['succeeded', 'failed', 'uncertain']}, evidence: {enum: ['none', 'transmitted', 'observed']}, completedAtMs: block('instantMs'),
  error: {$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/errorBody/properties/error`}, power: powerSchema, version: versionSchema,
};
const schema = (family: string, body: object): object => ({$schema: 'https://json-schema.org/draft/2020-12/schema', $id: schemaOf(family), ...body});
export const bb8Schemas: Readonly<Record<string, object>> = {
  ...Object.fromEntries(PUBLIC_FAMILIES.map(family => [schemaOf(family), schema(family, object({requestId: block('requestId'), ...guards, ...(family === 'bb8-led-set' ? {led: ledSchema} : {})}))])),
  [schemaOf('bb8-link-execute')]: schema('bb8-link-execute', object({requestId: block('requestId'), operationId: block('routingId'), parentRequestId: block('requestId'), ...guards, operationExpiresAtMs: block('instantMs'), operation: operationSchema})),
  [schemaOf('bb8-link-recorded')]: schema('bb8-link-recorded', object({requestId: block('requestId'), operationId: block('routingId')})),
  [schemaOf('bb8-link')]: schema('bb8-link', object(linkProperties)),
  [schemaOf('bb8-link-result')]: schema('bb8-link-result', object(resultProperties, Object.keys(resultProperties).filter(key => !['error', 'power', 'version'].includes(key)))),
  [schemaOf('bb8-robot')]: schema('bb8-robot', object({id: block('routingId'), revision: block('revision'), configurationRevision: block('revision'), link: known(object(Object.fromEntries(Object.entries(linkProperties).filter(([key]) => !['id', 'revision', 'configurationRevision'].includes(key))))), linkLive: {type: 'boolean'}, desiredLed: known(ledSchema), physicalLed: unknown, power: known(powerSchema), lastResult: known(object({result: resultProperties.result, evidence: resultProperties.evidence, completedAtMs: block('instantMs')})), held: object({requestId: block('requestId'), heldAtMs: block('instantMs')})}, ['id', 'revision', 'configurationRevision', 'link', 'linkLive', 'desiredLed', 'physicalLed', 'power', 'lastResult'])),
};
const commandFamilies: readonly string[] = [...PUBLIC_FAMILIES, 'bb8-link-execute', 'bb8-link-recorded'];
function check(family: string, message: Message): string | undefined {
  const command = commandFamilies.includes(family);
  if (message.kind !== (command ? 'command' : 'state') || message.type !== (command ? commandType(family) : `org.bunny.${family}.updated`)) return 'BB-8 kind/type mismatch';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(message.subject) || message.subject.length > 128) return 'BB-8 subject mismatch';
  if (family === 'bb8-link-execute' && message.data.requestId !== message.data.operationId) return 'BB-8 operation ID mismatch';
  if (command) return undefined;
  const data = message.data as unknown as LinkState | LinkResult | RobotState;
  if (message.subject !== data.id) return 'BB-8 entity mismatch';
  const at = Date.parse(message.time);
  if ('changedAtMs' in data && data.changedAtMs > at) return 'BB-8 link timestamp after envelope';
  if ('completedAtMs' in data) {
    if (data.id !== data.requestId || data.completedAtMs > at) return 'BB-8 result identity/time mismatch';
    if ((data.result === 'succeeded' && (data.evidence === 'none' || data.error !== undefined)) || (data.result !== 'succeeded' && data.error === undefined)) return 'BB-8 result/evidence mismatch';
    if (data.power !== undefined && (data.power.observedAtMs > at || data.result !== 'succeeded' || data.evidence !== 'observed')) return 'BB-8 power evidence mismatch';
    if (data.version !== undefined && (data.version.observedAtMs > at || data.result !== 'succeeded')) return 'BB-8 version evidence mismatch';
  }
  if ('physicalLed' in data) {
    if (data.power.status === 'known' && data.power.value.observedAtMs > at) return 'BB-8 power timestamp after envelope';
    if (data.link.status === 'known' && (data.link.value.changedAtMs > at)) return 'BB-8 link identity/time mismatch';
  }
  return undefined;
}
export function registerBb8Families(validator: MessageValidator): void {
  for (const [id, body] of Object.entries(bb8Schemas)) {
    const family = id.slice(SCHEMA_BASE.length).split('/')[0];
    if (family !== undefined) validator.register(id, body, message => check(family, message));
  }
}
let validator: MessageValidator | undefined;
export function bb8Validator(): MessageValidator {
  if (validator === undefined) {
    validator = new MessageValidator(); registerCoreFamilies(validator); registerDeviceFamilies(validator); registerBb8Families(validator);
  }
  return validator;
}
