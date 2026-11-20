import {isIP} from 'node:net';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configure} from '@jimmie-potts/sdk';

export type Binding = {key: number; objectId?: string};
export type RectangleBinding = {xStart: Binding; xEnd: Binding; yStart: Binding; yEnd: Binding};
export type ExclusionBinding = Binding | RectangleBinding;
export type Calibration = {revision: number; tx: number; tz: number; yaw: number; angle: number; upsideDown: boolean; rangeCm: number};
export type SensorConfig = {
  id: string; address: string; port: number; mac: string; roomId: string; mappingRevision: number;
  security: {mode: 'plaintext' | 'noise'; keySecret?: string; passwordSecret?: string};
  occupancy: Binding; held?: Binding;
  zones: {id: string; roomId: string; binding: Binding}[];
  targets: {slot: number; x: Binding; y: Binding; active: Binding}[];
  settings?: {detail: Binding; angle: Binding; upsideDown: Binding; range: Binding; exclusions: [Binding, Binding] | [RectangleBinding, RectangleBinding]};
  calibration?: Calibration;
};
export type PresenceConfig = {sensors: SensorConfig[]};
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const integer = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const binding = (value: unknown): value is Binding => object(value) && only(value, ['key', 'objectId']) && integer(value.key, 1, 0xffffffff)
  && (value.objectId === undefined || typeof value.objectId === 'string' && /^[a-z0-9_]{1,128}$/.test(value.objectId));
const rectangleFields = ['xStart', 'xEnd', 'yStart', 'yEnd'] as const;
const rectangle = (value: unknown): value is RectangleBinding => object(value) && only(value, rectangleFields)
  && rectangleFields.every(field => binding(value[field]));
const invalid = () => errorBody('invalid-request', {detail: 'Presence Pro needs one or two distinct explicit sensors with typed keys, room mappings and private security references'});
export const configurePresence: Configure<PresenceConfig> = section => {
  if (!object(section) || !only(section, ['sensors', 'secrets']) || !Array.isArray(section.sensors) || section.sensors.length < 1 || section.sensors.length > 2) return invalid();
  const sensors: SensorConfig[] = [];
  for (const value of section.sensors) {
    if (!object(value) || !only(value, ['id', 'address', 'port', 'mac', 'roomId', 'mappingRevision', 'security', 'occupancy', 'held', 'zones', 'targets', 'settings', 'calibration'])
      || !id(value.id) || !id(value.roomId) || !integer(value.mappingRevision) || typeof value.address !== 'string' || isIP(value.address) === 0
      || !integer(value.port, 1, 65535) || typeof value.mac !== 'string' || !/^[0-9a-f]{12}$/.test(value.mac)
      || !binding(value.occupancy) || value.held !== undefined && !binding(value.held)
      || !Array.isArray(value.zones) || value.zones.length > 4 || !Array.isArray(value.targets) || value.targets.length > 3) return invalid();
    const security = value.security;
    if (!object(security) || !only(security, ['mode', 'keySecret', 'passwordSecret']) || !['plaintext', 'noise'].includes(String(security.mode))
      || security.mode === 'noise' && !id(security.keySecret) || security.mode === 'plaintext' && security.keySecret !== undefined
      || security.passwordSecret !== undefined && !id(security.passwordSecret)) return invalid();
    if (value.zones.some(zone => !object(zone) || !only(zone, ['id', 'roomId', 'binding']) || !id(zone.id) || !id(zone.roomId) || !binding(zone.binding))
      || value.targets.some(target => !object(target) || !only(target, ['slot', 'x', 'y', 'active']) || !integer(target.slot, 1, 3) || !binding(target.x) || !binding(target.y) || !binding(target.active))) return invalid();
    if (value.settings !== undefined) {
      const settings = value.settings;
      if (!object(settings) || !only(settings, ['detail', 'angle', 'upsideDown', 'range', 'exclusions'])
        || !['detail', 'angle', 'upsideDown', 'range'].every(name => binding(settings[name]))
        || !Array.isArray(settings.exclusions) || settings.exclusions.length !== 2
        || !(settings.exclusions.every(binding) || settings.exclusions.every(rectangle))) return invalid();
    }
    if (value.calibration !== undefined) {
      const calibration = value.calibration;
      if (!object(calibration) || !only(calibration, ['revision', 'tx', 'tz', 'yaw', 'angle', 'upsideDown', 'rangeCm'])
        || !integer(calibration.revision) || !['tx', 'tz', 'yaw', 'angle', 'rangeCm'].every(name => finite(calibration[name])) || typeof calibration.upsideDown !== 'boolean' || Number(calibration.rangeCm) <= 0) return invalid();
    }
    const sensor = structuredClone(value) as SensorConfig;
    const keys = channels(sensor).map(channel => channel.binding.key);
    if (new Set(keys).size !== keys.length || new Set(sensor.targets.map(target => target.slot)).size !== sensor.targets.length
      || new Set(sensor.zones.map(zone => zone.id)).size !== sensor.zones.length
      || sensors.some(previous => previous.id === sensor.id || previous.mac === sensor.mac || previous.address === sensor.address && previous.port === sensor.port)) return invalid();
    sensors.push(sensor);
  }
  return {config: {sensors}, devices: sensors.map(sensor => sensor.id)};
};

export type Channel = {binding: Binding; type: 'BinarySensor' | 'Sensor' | 'Select' | 'Number' | 'Switch' | 'Text'};
const exclusionChannels = (exclusion: ExclusionBinding): Channel[] => 'key' in exclusion
  ? [{binding: exclusion, type: 'Text'}]
  : rectangleFields.map(field => ({binding: exclusion[field], type: 'Number'}));
export function settingChannels(settings: SensorConfig['settings']): Channel[] {
  if (settings === undefined) return [];
  return [
    {binding: settings.detail, type: 'Select'}, {binding: settings.angle, type: 'Number'},
    {binding: settings.upsideDown, type: 'Switch'}, {binding: settings.range, type: 'Number'},
    ...settings.exclusions.flatMap(exclusionChannels),
  ];
}
/** Numeric keys are checked against discovered type every connection; YAML source IDs are never guessed. */
export function channels(sensor: SensorConfig): Channel[] {
  return [
    {binding: sensor.occupancy, type: 'BinarySensor'}, ...(sensor.held === undefined ? [] : [{binding: sensor.held, type: 'BinarySensor'} as const]),
    ...sensor.zones.map(zone => ({binding: zone.binding, type: 'BinarySensor'} as const)),
    ...sensor.targets.flatMap(target => [{binding: target.x, type: 'Sensor'} as const, {binding: target.y, type: 'Sensor'} as const, {binding: target.active, type: 'BinarySensor'} as const]),
    ...settingChannels(sensor.settings),
  ];
}
