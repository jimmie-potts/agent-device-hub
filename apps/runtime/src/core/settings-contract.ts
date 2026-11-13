// Shared by the settings reader and consumers of history/2.0 settings values.
import {Ajv2020} from 'ajv/dist/2020.js';
import {MAX_MESSAGE_BYTES, schemas, type Message} from '@jimmie-potts/event-contracts/v2';
import type {ArtSchedulePolicy} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {
  coreFamilies, coreValidator, type HomeLayoutRecord, type LightingLayoutRecord, type ModeState, type ModeOverride,
  type PlaybackLayoutRecord, type PowerLimitRecord,
} from '@jimmie-potts/event-contracts/v2/families';
import {MAX_MODE_OVERRIDES, normalizeModeState} from '@jimmie-potts/event-contracts/v2/mode';
import {AutomationError, DEFAULT_SETTINGS, parseRuleInput, parseSettings, type AutomationSettings, type Rule} from './automation.js';
import {parseRoutine, type Routine} from './power-schedules.js';

export type SettingsValues = {
  mode: Pick<ModeState, 'mode'> & {overrides: Pick<ModeOverride, 'target' | 'mode'>[]};
  'home-layout': Pick<HomeLayoutRecord, 'version' | 'layouts'>;
  'lighting-layout': Pick<LightingLayoutRecord, 'layout'>;
  'playback-layout': Pick<PlaybackLayoutRecord, 'assignments'>;
  'power-limit': Pick<PowerLimitRecord, 'enabled' | 'durationMs'>;
  'art-schedule': {policy: ArtSchedulePolicy};
  'automation-rule': Pick<Rule, 'name' | 'enabled' | 'trigger' | 'action'>;
  'automation-routine': Pick<Routine, 'name' | 'enabled' | 'days' | 'time' | 'actions'>;
  'automation-settings': AutomationSettings;
  'automation-interrupt-set': {kinds: string[]};
};

export type SettingsFamily = keyof SettingsValues;
export type SettingsRecord = {[F in SettingsFamily]: {family: F; id: string; value: SettingsValues[F]}}[SettingsFamily];
type FactPosition = {seq: number; revision: number; atMs: number};
type RemovableFamily = 'power-limit' | 'automation-rule' | 'automation-routine';
export type SettingsFact = FactPosition & (
  {[F in SettingsFamily]: {family: F; id: string; kind: 'change'; changed: Partial<SettingsValues[F]>; removed: (keyof SettingsValues[F])[]}}[SettingsFamily] |
  {family: RemovableFamily; id: string; kind: 'removal'}
);
export type SettingsSnapshot = {schema: 'history/2.0'; settings: 'snapshot'; origin: string; checkpoint: string; records: SettingsRecord[]};
export type SettingsPage = {schema: 'history/2.0'; settings: 'page'; origin: string;
  after: string; through: string; next: string; applyThrough: string | null; done: boolean; facts: SettingsFact[]};

export const SETTINGS_SCAN_LIMIT = 63;
export const SETTINGS_ANSWER_BYTES = 16 * 1024 * 1024; // The SDK answer budget, also applied to the whole settings HTTP response.
export const SETTINGS_VALUE_BYTES = MAX_MESSAGE_BYTES;
export const SETTINGS_SNAPSHOT_LIMIT = 7 + 64 + 128; // Seven singletons, limits, and legacy split routines/rules.
export const SETTINGS_UNSEALED_FACTS = 2;

const fields = {
  mode: ['mode', 'overrides'],
  'home-layout': ['version', 'layouts'],
  'lighting-layout': ['layout'],
  'playback-layout': ['assignments'],
  'power-limit': ['enabled', 'durationMs'],
  'art-schedule': ['policy'],
  'automation-rule': ['name', 'enabled', 'trigger', 'action'],
  'automation-routine': ['name', 'enabled', 'days', 'time', 'actions'],
  'automation-settings': ['noFlourishes', 'quietHours', 'budgets'],
  'automation-interrupt-set': ['kinds'],
} as const satisfies {[F in SettingsFamily]: readonly (keyof SettingsValues[F])[]};

export const SETTINGS_FAMILIES = Object.keys(fields) as SettingsFamily[];
export const SETTINGS_SINGLETONS = {
  mode: 'hub', 'home-layout': 'home', 'lighting-layout': 'lighting', 'playback-layout': 'playback',
  'art-schedule': 'art', 'automation-settings': 'settings', 'automation-interrupt-set': 'interrupt-set',
} as const;

export const isSettingsFamily = (family: unknown): family is SettingsFamily => typeof family === 'string' && Object.hasOwn(fields, family);
export const removableSettingsFamily = (family: SettingsFamily): family is RemovableFamily =>
  family === 'power-limit' || family === 'automation-rule' || family === 'automation-routine';
export const settingsObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export const settingsInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const routingId = (id: string): boolean => id.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
export function settingsId(family: SettingsFamily, id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (family === 'automation-rule' || family === 'automation-routine') return /^[A-Za-z0-9_.-]{1,128}$/.test(id);
  return family === 'power-limit' ? routingId(id) : id === SETTINGS_SINGLETONS[family];
}
export const settingsFactId = (family: SettingsFamily, id: unknown): id is string => settingsId(family, id) && routingId(id);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CHECKPOINT = new RegExp(`^v1\\.(${UUID})\\.(0|[1-9][0-9]*)\\.(-|${UUID})$`);
export type SettingsCheckpoint = {origin: string; seq: number; anchor: string};
export const checkpointText = ({origin, seq, anchor}: SettingsCheckpoint): string => `v1.${origin}.${seq}.${anchor}`;

export function parseSettingsCheckpoint(text: unknown): SettingsCheckpoint | undefined {
  if (typeof text !== 'string' || text.length > 128) return undefined;
  const parsed = CHECKPOINT.exec(text);
  if (parsed === null) return undefined;
  const [, origin, sequence, anchor] = parsed;
  const seq = Number(sequence);
  if (origin === undefined || anchor === undefined || !settingsInteger(seq) || (seq === 0) !== (anchor === '-')) return undefined;
  const result = {origin, seq, anchor};
  return checkpointText(result) === text ? result : undefined;
}

export type SettingsRead = {mode: 'snapshot'} | {mode: 'page'; after: SettingsCheckpoint; through?: SettingsCheckpoint};

export function settingsRead(params: URLSearchParams): SettingsRead | undefined {
  const mode = params.get('settings');
  if (mode === 'snapshot' && params.size === 1) return {mode};
  if (mode !== 'page' || [...params].some(([key]) => !['settings', 'after', 'through'].includes(key) || params.getAll(key).length !== 1)) return undefined;
  const after = parseSettingsCheckpoint(params.get('after'));
  if (after === undefined) return undefined;
  if (!params.has('through')) return {mode, after};
  const through = parseSettingsCheckpoint(params.get('through'));
  return through === undefined ? undefined : {mode, after, through};
}

/** Project the same top-level fields from owner state and history changes. */
export function projectSettingsMembers(family: SettingsFamily, data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.fromEntries(fields[family].filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  if (family === 'mode' && Array.isArray(result.overrides)) {
    result.overrides = (result.overrides as unknown[]).map(override =>
      settingsObject(override) ? {target: override.target, mode: override.mode} : override);
  }
  return result;
}

function profileMembers(ajv: Ajv2020, family: SettingsFamily) {
  const definitions = coreFamilies.filter(item => item.family === family && item.kind === 'state');
  const current = definitions.at(-1);
  if (current === undefined) throw new Error('settings state schema is missing');
  const properties: Record<string, object> = Object.fromEntries(fields[family].map(key => [key, {$ref: `${current.dataschema}#/properties/${key}`}]));
  if (family === 'mode') {
    // The projection strips only the two timestamps. Reuse the source member schemas for the remaining fields.
    const {dataschema} = current;
    properties.overrides = {type: 'array', maxItems: MAX_MODE_OVERRIDES, items: {type: 'object', additionalProperties: false, required: ['target', 'mode'],
      properties: {
        target: {$ref: `${dataschema}#/properties/overrides/items/properties/target`},
        mode: {$ref: `${dataschema}#/properties/overrides/items/properties/mode`},
      }}};
  }
  return ajv.compile({type: 'object', additionalProperties: false, properties});
}

function settingsValidators() {
  const ajv = new Ajv2020({strict: true, code: {optimize: false}});
  ajv.addSchema(schemas.blocks as object);
  for (const family of coreFamilies) ajv.addSchema(family.schema);
  return new Map(SETTINGS_FAMILIES.map(family => [family, profileMembers(ajv, family)]));
}

let validators: ReturnType<typeof settingsValidators> | undefined;

/** Validate received members immediately and the full value after applying a patch. */
export function validSettingsMembers<F extends SettingsFamily>(family: F, id: unknown, value: unknown, complete: true): value is SettingsValues[F];
export function validSettingsMembers<F extends SettingsFamily>(family: F, id: unknown, value: unknown, complete: false): value is Partial<SettingsValues[F]>;
export function validSettingsMembers(family: SettingsFamily, id: unknown, value: unknown, complete: boolean): boolean {
  if (!settingsId(family, id) || !settingsObject(value) || (complete && fields[family].some(key => !Object.hasOwn(value, key)))) return false;
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > SETTINGS_VALUE_BYTES) return false;
  } catch {
    return false;
  }
  validators ??= settingsValidators();
  if (validators.get(family)?.(value) !== true) return false;
  // Where the profile has an owner check, retain it. Partial values get neutral defaults for the independent members.
  try {
    switch (family) {
      case 'mode': {
        const overrides = (value.overrides as SettingsValues['mode']['overrides'] | undefined) ?? [];
        const mode = value.mode ?? ['free', 'quiet', 'work'].find(mode => overrides.every(choice => choice.mode !== mode));
        return normalizeModeState({id, revision: 0, mode, selectedAtMs: 0,
          overrides: overrides.map(choice => ({...choice, selectedAtMs: 0}))}) !== undefined;
      }
      case 'art-schedule': {
        const policy = value.policy as ArtSchedulePolicy | undefined;
        return policy === undefined || policy.wakingStartMinute !== policy.wakingEndMinute;
      }
      case 'automation-rule':
        parseRuleInput({kind: 'event', name: 'Rule', trigger: {source: 'ci', kind: 'failed'},
          action: {mood: 'default', priorityClass: 'event', durationMs: 1000, targets: ['display']}, ...value}, null, true);
        return true;
      case 'automation-routine':
        parseRoutine({name: 'Routine', days: [1], time: '10:00', actions: [{target: 'lamp', family: 'power-set', data: {on: false}}], ...value}, null, true);
        return true;
      case 'automation-settings':
        parseSettings({...DEFAULT_SETTINGS, ...value});
        return true;
      case 'home-layout':
      case 'lighting-layout':
      case 'playback-layout': {
        if (Object.keys(value).length === 0) return true;
        // Each layout member replaces the whole layout, so its existing semantic check applies to a partial change.
        const schema = coreFamilies.filter(item => item.family === family && item.kind === 'state').at(-1);
        if (schema === undefined) return false;
        const data = {...(family === 'home-layout' ? {version: 1, layouts: null} : {}), ...value, id, revision: 0};
        const draft: Message = {specversion: '1.0', bunnyprofile: '2.0', datacontenttype: 'application/json',
          id: 'settings-validation', kind: 'state', source: 'bunny/core', type: schema.type, subject: id, data,
          dataschema: schema.dataschema, time: '1970-01-01T00:00:00.000Z', traceparent: '00-00000000000000000000000000000001-0000000000000001-00'};
        return coreValidator().validate(draft).ok;
      }
      case 'power-limit':
      case 'automation-interrupt-set':
        return true;
    }
  } catch (error) {
    if (error instanceof AutomationError) return false;
    throw error;
  }
}

/** All current projected top-level fields are required. Legacy removal of mode overrides is normalized to an empty list. */
export const settingsMember = (family: SettingsFamily, key: string): boolean => (fields[family] as readonly string[]).includes(key);

/** Whether a compact state change carries an effective settings member. */
export function isSettingsChange(family: SettingsFamily, change: {
  previous: unknown; changed: Record<string, unknown>; removed: readonly string[];
}): boolean {
  // The first operational art row can carry the default policy even though no policy was saved.
  if (family === 'art-schedule' && change.previous === null && change.changed.settingsRevision === 0) return false;
  return fields[family].some(key => Object.hasOwn(change.changed, key) || change.removed.includes(key));
}
