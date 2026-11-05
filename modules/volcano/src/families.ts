// The module's own families and read documents. `volcano-status/2.0` is its observed state beside the shared device
// record, `volcano-session-gap/2.0` the one command it takes, which never reaches a device. Every read document is closed
// and checked before it leaves, and none of them has a field for consumption, dose or inhalation, or for any identifier
// of the device.
import {Ajv2020} from 'ajv/dist/2020.js';
import {MessageValidator, SCHEMA_BASE, schemas} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';

export const STATUS_FAMILY = 'volcano-status';
export const STATUS_SCHEMA = `${SCHEMA_BASE}${STATUS_FAMILY}/2.0`;
export const STATUS_TYPE = 'org.bunny.volcano-status.updated';
export const GAP_FAMILY = 'volcano-session-gap';
export const GAP_SCHEMA = `${SCHEMA_BASE}${GAP_FAMILY}/2.0`;
export const GAP_TYPE = 'org.bunny.volcano-session.gap.requested';
export const GAP_COMPLETED_TYPE = 'org.bunny.volcano-session.gap.completed';

const block = (name: string): object => ({$ref: `#/$defs/${name}`});
const definitions = (schemas.blocks as {$defs: Record<string, object>}).$defs;
const closed = (properties: Record<string, object>): {type: 'object'; additionalProperties: false; required: string[]; properties: Record<string, object>} =>
  ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const document = (properties: Record<string, object>) => ({...closed(properties), $defs: definitions});
const nullable = (value: object): object => ({oneOf: [{type: 'null'}, value]});
const count = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const register = {type: 'integer', minimum: 0, maximum: 65535};
const deciC = {type: 'integer', minimum: -32768, maximum: 65535};
const instant = block('instantMs');
const cursor = nullable({type: 'string', minLength: 1, maxLength: 64});
const known = {enum: ['on', 'off', 'unknown']};

export const statusSchema = document({
  schema: {const: 'volcano-status/2.0'}, id: block('routingId'), revision: block('revision'), configurationRevision: block('revision'),
  availability: {enum: ['available', 'unavailable']}, link: {enum: ['connected', 'disconnected', 'unavailable', 'identity-mismatch', 'stale', 'unknown']},
  observedAtMs: nullable(instant), receivedAtMs: nullable(instant), heater: known, pump: known, status1: nullable(register),
  currentDeciC: nullable(deciC), targetDeciC: nullable(deciC), heatingCounterMinutes: nullable(count), displayFahrenheit: nullable({type: 'boolean'}),
  gapMinutes: {type: 'integer', minimum: 1, maximum: 240}, recording: {enum: ['ok', 'refused']},
});

const edge = {enum: ['observed', 'first-observation', 'after-gap']};
const fact = (kind: string, properties: Record<string, object>): object =>
  closed({seq: count, kind: {const: kind}, observedAtMs: instant, receivedAtMs: instant, ...properties});
const factSchema = {oneOf: [
  fact('heater', {on: {type: 'boolean'}, status1: register, edge}),
  fact('pump', {on: {type: 'boolean'}, status1: register, edge}),
  fact('setpoint', {targetDeciC: deciC}),
  fact('temperature', {currentDeciC: deciC}),
  fact('counter', {hours: register, minutes: register, totalMinutes: count}),
  fact('link', {state: {enum: ['connected', 'disconnected', 'unavailable', 'identity-mismatch', 'stale']}}),
  fact('collector-restart', {}),
  fact('gap', {fromMs: instant, toMs: instant, heaterBefore: known, heaterAfter: known, creditedMinutes: nullable(count)}),
  fact('discontinuity', {reason: {enum: ['counter-decrease', 'counter-jump', 'identity-mismatch', 'clock-step']}, lastReadingAtMs: nullable(instant)}),
]};
export const MAX_TIMELINE = 200;
export const timelineSchema = document({schema: {const: 'volcano-timeline/2.0'}, id: block('routingId'), revision: block('revision'), facts: {type: 'array', maxItems: MAX_TIMELINE, items: factSchema}, next: cursor});

const stretch = closed({
  startAtMs: instant, startedBeforeObservation: {type: 'boolean'}, endAtMs: nullable(instant), endedUnobservedBy: nullable(instant), lastObservedOnAtMs: instant, open: {type: 'boolean'},
  observedHeatingMs: count, creditedMinutes: count, pumpRuns: count, unobserved: {type: 'array', maxItems: 8, items: closed({fromMs: instant, toMs: instant, creditedMinutes: nullable(count)})}, omittedUnobserved: count,
});
const session = closed({
  startAtMs: instant, startedBeforeObservation: {type: 'boolean'}, endAtMs: nullable(instant), endedUnobservedBy: nullable(instant), lastObservedOnAtMs: instant, open: {type: 'boolean'},
  observedHeatingMs: count, creditedMinutes: count, pumpRuns: count, discontinuities: count, stretches: {type: 'array', maxItems: 32, items: stretch}, omittedStretches: count,
});
export const MAX_SESSIONS = 25;
export const sessionsSchema = document({
  schema: {const: 'volcano-sessions/2.0'}, id: block('routingId'), revision: block('revision'), gapMinutes: {type: 'integer', minimum: 1, maximum: 240}, preview: {type: 'boolean'},
  sessions: {type: 'array', maxItems: MAX_SESSIONS, items: session}, next: cursor,
});
export const MAX_DAYS = 366;
export const totalsSchema = document({
  schema: {const: 'volcano-totals/2.0'}, id: block('routingId'), revision: block('revision'), zone: {type: 'string', minLength: 1, maxLength: 64}, gapMinutes: {type: 'integer', minimum: 1, maximum: 240},
  days: {type: 'array', maxItems: MAX_DAYS, items: closed({date: {type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'}, observedHeatingMs: count, creditedMinutes: count, stretches: count, sessions: count, pumpRuns: count})},
  next: cursor,
});
export const gapsSchema = document({
  schema: {const: 'volcano-gaps/2.0'}, id: block('routingId'), revision: block('revision'), gapMinutes: {type: 'integer', minimum: 1, maximum: 240},
  buckets: {type: 'array', maxItems: 32, items: closed({fromMinutes: count, toMinutes: nullable(count), count, uncertain: count})},
});

// The range is the module's own rule, so an out-of-range value is an accepted command whose outcome says `failed`.
const gapSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: GAP_SCHEMA, type: 'object', additionalProperties: false, required: ['requestId', 'gapMinutes'],
  properties: {requestId: {$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/requestId`}, gapMinutes: {type: 'integer'}, expectedConfigurationRevision: {$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/revision`}},
};
const statusFamily = {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: STATUS_SCHEMA, ...statusSchema};
export const volcanoSchemas: Readonly<Record<string, object>> = {[STATUS_SCHEMA]: statusFamily, [GAP_SCHEMA]: gapSchema};

export function registerVolcanoFamilies(validator: MessageValidator): void {
  validator.register(STATUS_SCHEMA, statusFamily, message =>
    (message.kind !== 'state' || message.type !== STATUS_TYPE || message.subject !== message.data.id ? 'Volcano status identity/kind mismatch' : undefined));
  validator.register(GAP_SCHEMA, gapSchema, message => (message.kind !== 'command' || message.type !== GAP_TYPE ? 'Volcano session gap kind/type mismatch' : undefined));
}

let validator: MessageValidator | undefined;
export function volcanoValidator(): MessageValidator {
  if (validator === undefined) {
    validator = new MessageValidator();
    registerCoreFamilies(validator);
    registerDeviceFamilies(validator);
    registerVolcanoFamilies(validator);
  }
  return validator;
}

const ajv = new Ajv2020({strict: true});
export const validateStatus = ajv.compile(statusSchema), validateTimeline = ajv.compile(timelineSchema), validateSessions = ajv.compile(sessionsSchema),
  validateTotals = ajv.compile(totalsSchema), validateGaps = ajv.compile(gapsSchema);
