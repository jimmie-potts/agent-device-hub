import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {
  ALERT_EVENTS, CHANGED_SCHEMA, CHANGED_TYPE, CHANGES, CONDITIONS, DAY_PARTS, FORECAST_HOURS, GENERIC_ALERT, MAX_ALERTS, REASONS, SEVERITIES, STATE_SCHEMA, STATE_TYPE, WEATHER_ID,
  type WeatherChanged, type WeatherState,
} from './contracts.js';

const block = (name: string): object => ({$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>, required = Object.keys(properties)): object => ({type: 'object', additionalProperties: false, properties, required});
const nullable = (schema: object): object => ({anyOf: [{type: 'null'}, schema]});
const age = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const words = {type: 'array', maxItems: 3, items: {type: 'string', pattern: '^[A-Za-z0-9° -]{1,32}$'}};
const hour = closed({
  startAtMs: block('instantMs'), endAtMs: block('instantMs'), condition: {enum: CONDITIONS}, likely: {type: 'boolean'},
  temperatureF: {type: 'integer', minimum: -130, maximum: 150}, precipitationPercent: nullable({type: 'integer', minimum: 0, maximum: 100}),
  windMph: nullable({type: 'integer', minimum: 0, maximum: 300}), isDaytime: {type: 'boolean'}, dayPart: {enum: DAY_PARTS},
});
const alert = closed({event: {enum: [...ALERT_EVENTS, GENERIC_ALERT]}, severity: {enum: SEVERITIES}, endsAtMs: nullable(block('instantMs'))});
const identity = {id: {const: WEATHER_ID}, revision: block('revision')};
const body = {
  [STATE_SCHEMA]: {oneOf: [
    closed({...identity, status: {const: 'available'}, observedAtMs: block('instantMs'), staleAtMs: block('instantMs'), ageMs: age, forecastUpdatedAtMs: block('instantMs'),
      current: hour, forecast: {type: 'array', maxItems: FORECAST_HOURS, items: hour}, alerts: {type: 'array', maxItems: MAX_ALERTS, items: alert}, words}),
    closed({...identity, status: {const: 'unavailable'}, reason: {enum: REASONS}, observedAtMs: nullable(block('instantMs')), ageMs: nullable(age)}),
  ]},
  [CHANGED_SCHEMA]: closed({revision: block('revision'), observedAtMs: block('instantMs'), changes: {type: 'array', minItems: 1, maxItems: CHANGES.length, uniqueItems: true, items: {enum: CHANGES}}, words}),
};
export const weatherSchemas: Readonly<Record<string, object>> = Object.fromEntries(Object.entries(body).map(([id, schema]) => [id, {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: id, ...schema}]));

export function registerWeatherFamilies(validator: MessageValidator): void {
  validator.register(STATE_SCHEMA, weatherSchemas[STATE_SCHEMA] as object, (message: Message) => {
    if (message.kind !== 'state' || message.type !== STATE_TYPE) return 'weather state kind/type mismatch';
    const state = message.data as unknown as WeatherState;
    if (message.subject !== state.id) return 'weather state subject mismatch';
    return state.observedAtMs !== null && state.observedAtMs > Date.parse(message.time) ? 'weather observation is later than its message' : undefined;
  });
  validator.register(CHANGED_SCHEMA, weatherSchemas[CHANGED_SCHEMA] as object, (message: Message) => {
    if (message.kind !== 'occurrence' || message.type !== CHANGED_TYPE || message.subject !== WEATHER_ID) return 'weather change kind/type/subject mismatch';
    return (message.data as unknown as WeatherChanged).observedAtMs > Date.parse(message.time) ? 'weather observation is later than its message' : undefined;
  });
}
export function weatherValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerWeatherFamilies(validator);
  return validator;
}
