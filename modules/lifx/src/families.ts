// The LIFX module's own payload families (Hub #928), beside the shared `device/2.0` record and general commands (#918).
// `lifx-light` is each bulb's color record; `lifx-color-set` and `lifx-temperature-set` are the commands that replace the
// old `lifx-light` 1.0.0 profile's `lifx.color.set` and `lifx.temperature.set`, with the general commands' guards.
import {MessageValidator, SCHEMA_BASE, type Message, type PayloadCheck} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';

export const LIFX_LIGHT_SCHEMA = `${SCHEMA_BASE}lifx-light/2.0`;
export const LIFX_COLOR_SET_SCHEMA = `${SCHEMA_BASE}lifx-color-set/2.0`;
export const LIFX_TEMPERATURE_SET_SCHEMA = `${SCHEMA_BASE}lifx-temperature-set/2.0`;
export const DEVICE_SCHEMA = `${SCHEMA_BASE}device/2.0`;
export const OUTCOME_SCHEMA = `${SCHEMA_BASE}outcome/2.0`;

/** The color temperatures a qualified bulb takes, in kelvin. */
export const KELVIN = {minimum: 1500, maximum: 9000} as const;

/** `org.bunny.lifx-light.updated`: one bulb's color capabilities and its last color reading. */
export type LifxLight = {
  id: string; revision: number;
  capabilities: {color: {supported: boolean}; temperature: {supported: false} | {supported: true; minimum: 1500; maximum: 9000}};
  observed: {status: 'unknown'} | {status: 'known'; observedAtMs: number; hue: number; saturation: number; brightness: number; kelvin: number};
};
export type LifxColorSetRequest = {requestId: string; hue: number; saturation: number; expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};
export type LifxTemperatureSetRequest = {requestId: string; kelvin: number; expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};

const block = (name: string): object => ({$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
const unsupported = {type: 'object', additionalProperties: false, required: ['supported'], properties: {supported: {const: false}}};
const percent = {type: 'integer', minimum: 0, maximum: 100};
const command = (id: string, description: string, required: string[], properties: Record<string, object>): object => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: id, description,
  type: 'object', $ref: `${SCHEMA_BASE}device/2.0#/$defs/command`, unevaluatedProperties: false, required, properties,
});

/** The module's payload schemas by `dataschema`. They reference the shared blocks and the device family's command guards. */
export const lifxSchemas: Readonly<Record<string, object>> = {
  [LIFX_LIGHT_SCHEMA]: {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: LIFX_LIGHT_SCHEMA,
    description: 'State: one LIFX bulb\'s color capabilities and its last color reading (Hub #928), beside its device record. The subject is the bulb\'s routing ID. Only a LightGet answer is a reading: hue in degrees, saturation and brightness in percent and kelvin as the bulb reported them. It carries no address.',
    type: 'object', additionalProperties: false, required: ['id', 'revision', 'capabilities', 'observed'],
    properties: {
      id: block('routingId'), revision: block('revision'),
      capabilities: {
        type: 'object', additionalProperties: false, required: ['color', 'temperature'],
        properties: {
          color: {type: 'object', additionalProperties: false, required: ['supported'], properties: {supported: {type: 'boolean'}}},
          temperature: {oneOf: [unsupported, {
            type: 'object', additionalProperties: false, required: ['supported', 'minimum', 'maximum'],
            properties: {supported: {const: true}, minimum: {const: KELVIN.minimum}, maximum: {const: KELVIN.maximum}},
          }]},
        },
      },
      observed: {oneOf: [block('unknown'), {
        type: 'object', additionalProperties: false, required: ['status', 'observedAtMs', 'hue', 'saturation', 'brightness', 'kelvin'],
        properties: {
          status: {const: 'known'}, observedAtMs: block('instantMs'), hue: {type: 'integer', minimum: 0, maximum: 360},
          saturation: percent, brightness: percent, kelvin: {type: 'integer', minimum: 0, maximum: 65535},
        },
      }]},
    },
  },
  [LIFX_COLOR_SET_SCHEMA]: command(LIFX_COLOR_SET_SCHEMA,
    'Command: set a qualified LIFX bulb\'s hue in degrees and saturation in percent (Hub #928), from the lifx-light 1.0.0 profile\'s lifx.color.set. The module reads the bulb, keeps its brightness and kelvin and writes one absolute color; it never turns the bulb on. The subject names the bulb.',
    ['hue', 'saturation'], {hue: {type: 'integer', minimum: 0, maximum: 360}, saturation: percent}),
  [LIFX_TEMPERATURE_SET_SCHEMA]: command(LIFX_TEMPERATURE_SET_SCHEMA,
    'Command: set a qualified LIFX bulb\'s color temperature in kelvin (Hub #928), from the lifx-light 1.0.0 profile\'s lifx.temperature.set. The module reads the bulb and keeps its hue, saturation and brightness, so the light looks white only at zero saturation. The subject names the bulb.',
    ['kelvin'], {kelvin: {type: 'integer', minimum: KELVIN.minimum, maximum: KELVIN.maximum}}),
};

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Each family's kind and type, which its messages must use. */
const FAMILIES: Readonly<Record<string, {kind: Message['kind']; type: string; check: PayloadCheck}>> = {
  [LIFX_LIGHT_SCHEMA]: {
    kind: 'state', type: 'org.bunny.lifx-light.updated',
    check: message => {
      const light = message.data as LifxLight;
      if (message.subject !== light.id) return 'envelope /subject not the entity';
      // A reading is never newer than the message that reports it.
      return light.observed.status === 'known' && light.observed.observedAtMs > Date.parse(message.time) ? 'payload /observed/observedAtMs after time' : undefined;
    },
  },
  [LIFX_COLOR_SET_SCHEMA]: {kind: 'command', type: 'org.bunny.lifx-color.set.requested', check: message => routed(message)},
  [LIFX_TEMPERATURE_SET_SCHEMA]: {kind: 'command', type: 'org.bunny.lifx-temperature.set.requested', check: message => routed(message)},
};
const routed = (message: Message): string | undefined =>
  message.subject.length <= 128 && ROUTING_ID.test(message.subject) ? undefined : 'envelope /subject not a device id';

/** Registers the module's families with their kinds, types and checks. Call it after the core and device families. */
export function registerLifxFamilies(validator: MessageValidator): void {
  for (const [dataschema, schema] of Object.entries(lifxSchemas)) {
    const family = FAMILIES[dataschema];
    if (family === undefined) continue;
    validator.register(dataschema, schema, message => {
      if (message.kind !== family.kind) return `envelope /kind ${family.type} is a ${family.kind} family`;
      if (message.type !== family.type) return `envelope /type uses ${family.type}`;
      return family.check(message);
    });
  }
}

let shared: MessageValidator | undefined;
/** Profile 2.0 with the core, device and LIFX families, which the module checks each command against. */
export function lifxValidator(): MessageValidator {
  if (shared === undefined) {
    const validator = new MessageValidator();
    registerCoreFamilies(validator);
    registerDeviceFamilies(validator);
    registerLifxFamilies(validator);
    shared = validator;
  }
  return shared;
}
