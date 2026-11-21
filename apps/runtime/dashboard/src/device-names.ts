import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {WallRecord} from '@jimmie-potts/nanoleaf/frontend';
import type {RuntimeData} from './runtime-feeds.ts';

/**
 * The names the navigation shows for devices (Hub #1950). A device's published name comes first: the `label` its
 * module puts in its device record. Without one, a Nanoleaf controller is named for the kind its module observes in
 * its `nanoleaf-wall` record, Lines or Panels. Otherwise the name is read from the device's stable ID. Names are
 * presentation only; routes, pins and commands keep the ID.
 */
export type NamedDevice = {record: DeviceRecord; name: string};

const KINDS: Readonly<Record<string, string>> = {lines: 'Lines', panels: 'Panels'};

/**
 * A stable ID as words: separators become spaces, and each word starts with a capital. A short run of letters with
 * digits after it, such as `nl22` or `a19`, is a model name and is written in capitals.
 */
export function readableId(id: string): string {
  const words = id.split(/[-_.\s]+/).filter(word => word !== '');
  if (words.length === 0) return id;
  return words.map(word => /^[a-z]{1,3}\d+$/i.test(word) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

/** One device's name before names are told apart: its published name, then its observed Nanoleaf kind, then its ID read as words. */
export function deviceName(record: Pick<DeviceRecord, 'id' | 'label'>, wall?: Pick<WallRecord, 'kind'>): string {
  const published = record.label?.trim();
  if (published !== undefined && published !== '') return published;
  const kind = wall === undefined ? undefined : KINDS[wall.kind];
  return kind ?? readableId(record.id);
}

/**
 * The devices one module's records hold, in their order, each once by ID and each with a name. Two devices that would
 * share a name are told apart by their IDs read as words, so two Lines controllers are never both just "Lines".
 */
export function namedDevices(runtime: Pick<RuntimeData, 'copies'>, owner: string): NamedDevice[] {
  const walls = runtime.copies.find(copy => copy.owner === owner && copy.family === 'nanoleaf-wall')?.records as readonly WallRecord[] | undefined;
  const seen = new Set<string>(), devices: NamedDevice[] = [];
  for (const copy of runtime.copies) {
    if (copy.owner !== owner || copy.family !== 'device') continue;
    for (const record of copy.records as readonly DeviceRecord[]) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      devices.push({record, name: deviceName(record, walls?.find(wall => wall.id === record.id))});
    }
  }
  const counts = new Map<string, number>();
  for (const {name} of devices) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  return devices.map(device => {
    const id = readableId(device.record.id);
    return (counts.get(device.name.toLowerCase()) ?? 0) > 1 && device.name !== id ? {...device, name: `${device.name} (${id})`} : device;
  });
}

/** The name of the device with this ID among the records the page holds, or its ID read as words when none holds it. */
export function nameOf(runtime: Pick<RuntimeData, 'copies'>, id: string): string {
  for (const owner of new Set(runtime.copies.filter(copy => copy.family === 'device').map(copy => copy.owner))) {
    const found = namedDevices(runtime, owner).find(device => device.record.id === id);
    if (found !== undefined) return found.name;
  }
  return readableId(id);
}
