import {assistantRoutes, catalogFamily, LIFX_COLOR_PARAMETERS, catalogRoute, permitsDevice, type ObservationBasis} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Sdk} from './sdk.js';
import type {SyncOptions} from './sync.js';

export type OwnedDevice = {owner: string; device: DeviceRecord};

type DeviceReadOptions = Pick<SyncOptions, 'parent' | 'timeoutMs'>;
const LIFX = 'bunny/modules/lifx';

async function ownerRecords<T extends {id: string}>(sdk: Pick<Sdk, 'sync'>, family: string, owner: string,
  options: DeviceReadOptions): Promise<readonly T[] | undefined> {
  const result = await sdk.sync<T>([family], () => {}, {...options, owner});
  if (result.status !== 'synced') return undefined;
  try {
    return result.copy.states().filter(message => message.source === owner && message.subject === message.data.id).map(message => message.data);
  } finally {
    await result.copy.close();
  }
}

export async function readDeviceRecords(sdk: Pick<Sdk, 'sync'>, owners: readonly string[],
  options: DeviceReadOptions): Promise<{rows: OwnedDevice[]; unreadable: string[]}> {
  const views = await Promise.all(owners.map(async owner => ({owner, records: await ownerRecords<DeviceRecord>(sdk, 'device', owner, options)})));
  return {rows: views.flatMap(({owner, records}) => records?.map(device => ({owner, device})) ?? []),
    unreadable: views.filter(view => view.records === undefined).map(view => view.owner)};
}

/** LIFX publishes its color capabilities and readings beside the shared device record. */
export type LifxDeviceFacts = {id: string; capabilities: {color: {supported: boolean};
  temperature: {supported: false} | {supported: true; minimum: number; maximum: number}};
  observed: {status: 'unknown'} | {status: 'known'; observedAtMs: number; hue: number; saturation: number; brightness: number; kelvin: number}};

export function readLifxDeviceFacts(sdk: Pick<Sdk, 'sync'>, options: DeviceReadOptions): Promise<readonly LifxDeviceFacts[] | undefined> {
  return ownerRecords<LifxDeviceFacts>(sdk, 'lifx-light', LIFX, options);
}

export const deviceLabel = (device: DeviceRecord): string => device.label?.slice(0, 128) ?? device.id;
const normalizedName = (value: string): string => value.trim().toLocaleLowerCase();

/** The caller supplies only rows the principal may discover. An explicit ID never matches a label. */
export function matchingDevices(rows: readonly OwnedDevice[], target: string, owner: string, literalId?: string): readonly OwnedDevice[] {
  const exact = rows.filter(({device}) => device.id === (literalId ?? target));
  if (literalId !== undefined || owner !== 'auto' && exact.length > 0) return exact;
  return rows.filter(({device}) => device.id === target || normalizedName(deviceLabel(device)) === normalizedName(target));
}

export const MAX_OBSERVATION_AGE_MS = 30_000;
export const WEMO_OBSERVATION_AGE_MS = 15_000;
export function observationStale({observed, lastTransmission}: DeviceRecord, now: number, maxAgeMs: number): boolean {
  return observed.status === 'known' && (observed.observedAtMs > now || now - observed.observedAtMs >= maxAgeMs ||
    (lastTransmission.status === 'known' && observed.observedAtMs < lastTransmission.transmittedAtMs));
}

const generalDeviceActions = {
  'power-set': 'power', 'brightness-set': 'brightness', 'scene-activate': 'scenes', 'zone-power-set': 'zones',
  'media-start': 'media', 'media-control': 'media', 'device-mode-set': 'modes', 'moment-play': 'moments',
} as const satisfies Record<string, keyof DeviceRecord['capabilities']>;

const generalAction = (family: string): family is keyof typeof generalDeviceActions => Object.hasOwn(generalDeviceActions, family);

export function supportsDeviceAction(row: OwnedDevice, family: string): boolean {
  if (generalAction(family)) return row.device.capabilities[generalDeviceActions[family]].supported;
  if (!catalogFamily(family)) return false;
  const route = catalogRoute(family);
  return route.binding === 'device' && route.owners.some(owner => owner === row.owner) && permitsDevice(route, row.device);
}

export function deviceActionFamily(family: string): boolean {
  return generalAction(family) || catalogFamily(family) && catalogRoute(family).binding === 'device';
}

const maxObservationAge = (owner: string): number => owner === 'bunny/modules/wemo' ? WEMO_OBSERVATION_AGE_MS : MAX_OBSERVATION_AGE_MS;

function colorObservationStale(device: DeviceRecord, stamp: number, now: number): boolean {
  return stamp > now || now - stamp >= MAX_OBSERVATION_AGE_MS ||
    (device.lastTransmission.status === 'known' && stamp < device.lastTransmission.transmittedAtMs);
}

export function currentObservationBasis(row: OwnedDevice, kind: ObservationBasis['kind'], now: number,
  lifx?: LifxDeviceFacts): ObservationBasis | undefined {
  const {owner, device} = row;
  if (device.availability !== 'available' || device.held !== undefined) return undefined;
  if (kind === 'temperature') {
    const color = owner === LIFX && lifx?.id === device.id ? lifx.observed : undefined;
    return color?.status === 'known' && !colorObservationStale(device, color.observedAtMs, now)
      ? {kind, observedAtMs: color.observedAtMs, value: color.kelvin} : undefined;
  }
  const {observed} = device;
  return observed.status === 'known' && observed.brightness.status === 'known' && !observationStale(device, now, maxObservationAge(owner))
    ? {kind, observedAtMs: observed.observedAtMs, value: observed.brightness.value} : undefined;
}

export function deviceFacts(row: OwnedDevice, now: number, canControl: (family: string) => boolean,
  options: {maxAgeMs?: number; lifx?: LifxDeviceFacts} = {}) {
  const {device, owner} = row;
  const age = maxObservationAge(owner);
  const {brightness, power, modes, media, scenes, moments, zones} = device.capabilities;
  const observation = device.observed;
  const freshness = observation.status === 'unknown' ? 'unknown' :
    device.availability !== 'available' || observationStale(device, now, Math.min(age, options.maxAgeMs ?? Number.POSITIVE_INFINITY)) ? 'stale' : 'current';
  const light = owner === LIFX && options.lifx?.id === device.id ? options.lifx : undefined;
  const color = light?.observed;
  const colorStale = color?.status === 'known' && colorObservationStale(device, color.observedAtMs, now);
  const actions = [...new Set([...Object.keys(generalDeviceActions), ...Object.keys(assistantRoutes)])].filter(family => canControl(family) && supportsDeviceAction(row, family) &&
    (family === 'lifx-color-set' ? light?.capabilities.color.supported === true
      : family === 'lifx-temperature-set' ? light?.capabilities.temperature.supported === true : true));
  const observationBases = (['brightness', 'temperature'] as const).flatMap(kind => {
    if (!actions.includes(kind === 'brightness' ? 'brightness-set' : 'lifx-temperature-set')) return [];
    const basis = currentObservationBasis(row, kind, now, light);
    return basis === undefined ? [] : [basis];
  });
  return {
    owner, id: device.id, name: deviceLabel(device), configurationRevision: device.configurationRevision, generation: device.generation,
    lastReportedAvailability: device.availability, hold: device.held ?? null,
    choices: {modes, media: media.supported && owner === 'bunny/modules/pixoo'
      ? {...media, playlistIdsComplete: false, renditionIdsComplete: false} : media, scenes, moments, zones, power, brightness: brightness.supported ? {...brightness, unit: 'percent' as const, step: 1} : brightness},
    observation: {freshness, value: observation}, observationBases, actions,
    ...(light === undefined ? {} : {
      lightCapabilities: {
        color: light.capabilities.color.supported ? {supported: true, ...LIFX_COLOR_PARAMETERS} : light.capabilities.color,
        temperature: light.capabilities.temperature.supported ? {...light.capabilities.temperature, unit: 'kelvin', step: 1}
          : light.capabilities.temperature,
      },
    }),
    ...(color === undefined ? {} : {color: {freshness: color.status === 'unknown' ? 'unknown'
      : colorStale || device.availability !== 'available' ? 'stale' : 'current', value: color}}),
    lastTransmissionAtMs: device.lastTransmission.status === 'known' ? device.lastTransmission.transmittedAtMs : null,
  };
}
