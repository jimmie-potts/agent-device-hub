import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {FAMILY, SCHEMA, SOURCE, TYPE, type PresenceObservation} from './contracts.js';

const block = (name: string): object => ({$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>): object => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const tagged = (value: object): object => ({oneOf: [closed({status: {const: 'unknown'}}), closed({status: {const: 'known'}, value})]});
const number = {type: 'number', minimum: -1e9, maximum: 1e9};
const instant = tagged(block('instantMs'));
const occupancy = {enum: ['occupied', 'vacant', 'unknown']};
const report = (value: object): object => closed({value, receivedAtMs: instant});
const target = closed({slot: {type: 'integer', minimum: 1, maximum: 3}, active: report(tagged({type: 'boolean'})),
  rawMm: closed({x: tagged(number), y: tagged(number), xReceivedAtMs: instant, yReceivedAtMs: instant}),
  apartmentMeters: tagged(closed({x: number, z: number})), calibrationRevision: tagged(block('revision'))});
const body = closed({id: block('id'), sensorId: block('id'), revision: block('revision'), roomId: block('id'), mappingRevision: block('revision'),
  connection: {enum: ['starting', 'connected', 'disconnected']}, reason: {enum: ['starting', 'none', 'unavailable', 'unsupported-capability', 'forbidden', 'invalid-message']},
  occupancy: report(occupancy), held: report(tagged({type: 'boolean'})),
  zones: {type: 'array', maxItems: 4, items: closed({id: block('id'), roomId: block('id'), value: occupancy, receivedAtMs: instant})},
  targets: {type: 'array', maxItems: 3, items: target}});
export const presenceSchemas: Readonly<Record<string, object>> = {[SCHEMA]: {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: SCHEMA, ...body}};
export function registerPresenceFamilies(validator: MessageValidator): void {
  validator.register(SCHEMA, presenceSchemas[SCHEMA] as object, (message: Message) => {
    const state = message.data as unknown as PresenceObservation;
    if (message.kind !== 'state' || message.type !== TYPE || message.source !== SOURCE || message.subject !== state.id || state.id !== state.sensorId) return 'presence owner/kind/type/identity mismatch';
    if (new Set(state.targets.map(target => target.slot)).size !== state.targets.length || new Set(state.zones.map(zone => zone.id)).size !== state.zones.length) return 'presence duplicate slot or zone';
    if (state.connection !== 'connected' && (state.occupancy.value !== 'unknown' || state.held.value.status !== 'unknown'
      || state.zones.some(zone => zone.value !== 'unknown') || state.targets.some(target => target.active.value.status !== 'unknown' || target.rawMm.x.status !== 'unknown' || target.rawMm.y.status !== 'unknown' || target.apartmentMeters.status !== 'unknown'))) return 'disconnected presence contains live values';
    for (const target of state.targets) if (target.apartmentMeters.status === 'known' && (target.active.value.status !== 'known' || !target.active.value.value
      || target.rawMm.x.status !== 'known' || target.rawMm.y.status !== 'known' || target.rawMm.x.value === 0 && target.rawMm.y.value === 0 || target.calibrationRevision.status !== 'known')) return 'presence point lacks reported evidence';
    return undefined;
  });
}
export function presenceValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerPresenceFamilies(validator);
  return validator;
}
/** Existing history supports numeric object leaves; array and hold receipts remain ordinary history changes. */
export const bookkeeping = {[FAMILY]: ['/occupancy/receivedAtMs/value']};
