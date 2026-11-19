import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {namedDevices} from './device-names.ts';
import {brandName, isLighting} from './lighting.ts';
import {moduleOwner, type ModuleEntry} from './modules.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import type {Route} from './routes.ts';

/**
 * The hardware inventory (Hub #1950): the configured hardware, grouped as the Devices menu and the directory show it,
 * as the owner's selected device-only prototype does: Displays, Lighting and Appliances. Companion features and other
 * pages that are not hardware are reached from Companions, the jump palette and pins.
 */
export const DEVICE_CATEGORIES = ['Displays', 'Lighting', 'Appliances'] as const;
export type DeviceCategory = typeof DEVICE_CATEGORIES[number];
export type DirectoryLink = {label: string; route: Route};
/**
 * One hardware module. A lighting brand has its `overview` page and lists each light. Any other module lists each of
 * its devices, or its first declared page while it holds no device records. Task pages, such as a display's media or
 * a wall's saved shows, are reached inside the device pages and are not listed here.
 */
export type DirectoryEntry = {id: string; label: string; category: DeviceCategory; state: string; stale: boolean; overview?: DirectoryLink; links: DirectoryLink[];
  /** One line about the module as its records stand: its state, stale observations, its lights' count or its one device's availability. */
  status: string;
  /** Whether `status` reports a running module whose observations are current and whose one device, if any, is available. */
  available: boolean};

const AVAILABILITY: Readonly<Record<DeviceRecord['availability'], string>> = {available: 'Available', degraded: 'Degraded', unavailable: 'Unavailable', unknown: 'Status unknown'};

const LABELS: Readonly<Record<string, string>> = {pixoo: 'Pixoo', tidbyt: 'Tidbyt', wemo: 'Wemo', roborock: 'Roborock', volcano: 'Volcano', wispr: 'Wispr', companions: 'Companions',
  microduck: 'MicroDuck', 'reachy-mini': 'Reachy Mini', bb8: 'BB-8', onn: 'ONN', art: 'Art', playback: 'Music'};
/** The name a module is shown under. */
export const moduleLabel = (name: string): string => LABELS[name] ?? brandName(name);

const LIGHTING = new Set(['lifx', 'nanoleaf']);
const DISPLAYS = new Set(['pixoo', 'tidbyt']);
/** Hardware modules by name, so one that is down, and serves nothing while it is, keeps its place and its state. */
const HARDWARE = new Set([...LIGHTING, ...DISPLAYS, 'wemo', 'roborock', 'volcano', 'microduck', 'reachy-mini', 'bb8', 'onn']);

const deviceRecords = (runtime: Pick<RuntimeData, 'copies'>, name: string): DeviceRecord[] =>
  runtime.copies.filter(copy => copy.owner === moduleOwner(name) && copy.family === 'device').flatMap(copy => copy.records as readonly DeviceRecord[]);

/** Whether a module is hardware: it serves device records, holds some here, or is a known hardware module. */
export function isHardware(module: ModuleEntry, runtime: Pick<RuntimeData, 'copies'>): boolean {
  return module.name !== 'core' && (module.serves.includes('device') || HARDWARE.has(module.name) || deviceRecords(runtime, module.name).length > 0);
}

/** A hardware module's category: its lights, its displays, or Appliances for any other hardware. */
export function categoryOf(module: ModuleEntry, runtime: Pick<RuntimeData, 'copies'>): DeviceCategory {
  const devices = deviceRecords(runtime, module.name);
  if (LIGHTING.has(module.name) || devices.some(isLighting)) return 'Lighting';
  if (DISPLAYS.has(module.name) || devices.some(device => device.kind === 'pixoo' || device.kind === 'tidbyt')) return 'Displays';
  return 'Appliances';
}

/** Projects existing declarations and observations; no discovery, reads or device actions live here. */
export function directoryEntries(runtime: RuntimeData): DirectoryEntry[] {
  return (runtime.modules ?? []).filter(module => isHardware(module, runtime)).map(module => {
    const owner = moduleOwner(module.name), category = categoryOf(module, runtime);
    const devices = namedDevices(runtime, owner).map(({record, name}): DirectoryLink => ({label: name, route: {kind: 'component', id: record.id}}));
    const overview = category === 'Lighting' && module.serves.includes('device')
      ? {label: `${moduleLabel(module.name)} overview`, route: {kind: 'lighting-brand', brand: module.name}} satisfies DirectoryLink : undefined;
    const first = module.pages[0];
    const links = devices.length > 0 || first === undefined || overview !== undefined ? devices
      : [{label: first.title, route: {kind: 'module', module: module.name, page: first.id}} satisfies DirectoryLink];
    const stale = runtime.copies.some(copy => copy.owner === owner && copy.family === 'device' && !copy.synced);
    const records = deviceRecords(runtime, module.name), one = records.length === 1 ? records[0] : undefined;
    const status = module.state !== 'running' ? `${module.state.charAt(0).toUpperCase()}${module.state.slice(1)}` : stale ? 'Stale'
      : overview !== undefined ? `${String(devices.length)} ${devices.length === 1 ? 'light' : 'lights'}` : one !== undefined ? AVAILABILITY[one.availability] ?? 'Status unknown'
        : records.length > 1 ? `${String(records.length)} devices` : '';
    const available = module.state === 'running' && !stale && (one === undefined || one.availability === 'available');
    return {id: module.name, label: moduleLabel(module.name), category, state: module.state, stale, ...(overview === undefined ? {} : {overview}), links, status, available};
  }).filter(entry => entry.overview !== undefined || entry.links.length > 0 || entry.state !== 'running' || entry.stale);
}
