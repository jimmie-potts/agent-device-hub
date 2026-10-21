import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {brandName, isLighting} from './lighting.ts';
import {moduleOwner} from './modules.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import type {Route} from './routes.ts';

export const DEVICE_CATEGORIES = ['Lighting', 'Displays', 'Audio', 'Other'] as const;
export type DeviceCategory = typeof DEVICE_CATEGORIES[number];
export type DirectoryEntry = {id: string; label: string; category: DeviceCategory; state: string; stale: boolean; links: {label: string; route: Route}[]};
const LABELS: Readonly<Record<string, string>> = {pixoo: 'Pixoo', tidbyt: 'Tidbyt', wemo: 'Wemo', onn: 'ONN', roborock: 'Roborock', wispr: 'Wispr', companions: 'Companions'};

/** Projects existing declarations and observations; no discovery, reads or device actions live here. */
export function directoryEntries(runtime: RuntimeData): DirectoryEntry[] {
  return (runtime.modules ?? []).filter(module => module.name !== 'core' || module.pages.length > 0).map(module => {
    const copies = runtime.copies.filter(copy => copy.owner === moduleOwner(module.name) && copy.family === 'device');
    const devices = copies.flatMap(copy => copy.records as readonly DeviceRecord[]);
    const lighting = ['lifx', 'nanoleaf'].includes(module.name) || devices.some(isLighting);
    const display = ['pixoo', 'tidbyt'].includes(module.name) || devices.some(device => device.kind === 'pixoo' || device.kind === 'tidbyt');
    const category: DeviceCategory = lighting ? 'Lighting' : display ? 'Displays' : module.serves.includes('playback') ? 'Audio' : 'Other';
    const links: DirectoryEntry['links'] = [];
    if (lighting && module.serves.includes('device')) links.push({label: brandName(module.name), route: {kind: 'lighting-brand', brand: module.name}});
    if (category === 'Audio') links.push({label: 'Audio', route: {kind: 'audio'}});
    if (!lighting) for (const device of devices) links.push({label: device.label ?? device.id, route: {kind: 'component', id: device.id}});
    for (const page of module.pages) links.push({label: page.title, route: {kind: 'module', module: module.name, page: page.id}});
    return {id: module.name, label: category === 'Audio' ? 'Music' : LABELS[module.name] ?? brandName(module.name), category, state: module.state,
      stale: copies.some(copy => !copy.synced), links};
  }).filter(entry => entry.links.length > 0 || entry.state !== 'running' || entry.stale);
}
