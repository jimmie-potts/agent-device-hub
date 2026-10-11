import {MessageValidator, SCHEMA_BASE, schemas, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {APPS, KEYS} from './actions.js';
import {FAMILIES, schemaOf, types, type OnnState} from './contracts.js';
const block = (name: string): object => ({$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>, required = Object.keys(properties)): object => ({type: 'object', additionalProperties: false, properties, required});
const guards = {requestId: block('requestId'), expectedConfigurationRevision: block('revision'), expectedGeneration: block('ticket')};
const commandSchema = (extra: Record<string, object>): object => closed({...guards, ...extra}, ['requestId', ...Object.keys(extra)]);
const entries: Record<string, object> = {
  'onn-key-press': commandSchema({key: {enum: KEYS}}),
  'onn-app-open': commandSchema({app: {enum: APPS}}),
  'onn-text': commandSchema({text: {type: 'string', minLength: 1, maxLength: 256}}),
  'onn-state': closed({id: block('routingId'), revision: block('revision'), configurationRevision: block('revision'), generation: block('ticket'), connection: {enum: ['unknown', 'available', 'unavailable']},
    currentApp: {oneOf: [block('unknown'), closed({status: {const: 'known'}, value: {enum: [...APPS, 'other', 'none']}, observedAtMs: block('instantMs')})]},
    controls: closed({keys: {type: 'array', items: {enum: KEYS}, uniqueItems: true, minItems: 8, maxItems: 8}, apps: {type: 'array', items: {enum: APPS}, uniqueItems: true, minItems: 2, maxItems: 2}, text: closed({maximum: {const: 256}, alphabet: {const: 'ascii-letters-digits-space-dot-underscore-hyphen'}})})}),
};
export const onnSchemas: Readonly<Record<string, object>> = Object.fromEntries(Object.entries(entries).map(([family, body]) => [schemaOf(family), {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: schemaOf(family), ...body}]));
/** A standalone read-tool document uses the same state definition and shared blocks. */
export const onnStatusSchema = JSON.parse(JSON.stringify({...entries['onn-state'], $defs: (schemas.blocks as {$defs: object}).$defs})
  .replaceAll(`${SCHEMA_BASE}blocks/2.0#/$defs/`, '#/$defs/')) as {type: 'object'; [key: string]: unknown};
export function registerOnnFamilies(validator: MessageValidator): void {
  for (const [id, body] of Object.entries(onnSchemas)) {
    const family = id.slice(SCHEMA_BASE.length).split('/')[0];
    validator.register(id, body, (message: Message) => {
    const command = FAMILIES.some(value => value === family);
    if (message.kind !== (command ? 'command' : 'state') || message.type !== (command ? types[family as typeof FAMILIES[number]] : 'org.bunny.onn-state.updated')) return 'ONN kind/type mismatch';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(message.subject) || message.subject.length > 128) return 'ONN subject mismatch';
    if (!command) {
      const state = message.data as unknown as OnnState;
      if (state.id !== message.subject || (state.currentApp.status === 'known' && state.currentApp.observedAtMs > Date.parse(message.time))) return 'ONN observation identity/time mismatch';
    }
    return undefined;
    });
  }
}
export function onnValidator(): MessageValidator {
  const validator = new MessageValidator(); registerCoreFamilies(validator); registerDeviceFamilies(validator); registerOnnFamilies(validator); return validator;
}
