// The cutover's conversion of today's LIFX configuration (Hub #928, for the installer #935 at #840). It turns the old
// local controller host's `lifx` block and its `modes/` folder into this module's section, keeping every bulb's address,
// model evidence, status caps and mode. Reading the mode files is copied from `readPersistedMode` in
// controllers/lifx/src/controller.ts at main 483d3a93, with its fail-closed rules: an unsafe folder or file, a missing
// one or invalid JSON reads as Free, which is what the old controller started that bulb in.
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync} from 'node:fs';
import {join} from 'node:path';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {configureLifx, qualified, routingId, type LifxBulbConfig, type NativeMode} from './configuration.js';

/** A mode as the old controller stored it. */
export type LegacyMode = 'Work' | 'Quiet' | 'Free';
/** The converted section, and each bulb ID the conversion renamed into a routing ID. */
export type Conversion = {section: {bulbs: LifxBulbConfig[]; timeoutMs?: number; retries?: number; maxPending?: number}; renamed: {from: string; to: string}[]};

const LEGACY_MODES: readonly LegacyMode[] = ['Work', 'Quiet', 'Free'];
/** Each old mode as the bulb's native mode, in kebab-case as the device record lists it. */
const NATIVE: Readonly<Record<LegacyMode, NativeMode>> = {Work: 'work', Quiet: 'quiet', Free: 'free'};
const MAX_MODE_FILE_BYTES = 256;
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (uid: number): boolean => uid === process.getuid?.();

/** A bulb's mode file in the old folder: the SHA-256 of its device ID, as the old controller named it. */
const modeFile = (folder: string, deviceId: string): string => join(folder, `${createHash('sha256').update(deviceId).digest('hex')}.json`);

/** One bulb's stored mode, or Free when the folder or file is not private, is missing, or does not hold a mode. */
function readMode(folder: string, deviceId: string): LegacyMode {
  try {
    const directory = lstatSync(folder);
    if (!directory.isDirectory() || !own(directory.uid) || (directory.mode & 0o077) !== 0) return 'Free';
  } catch {
    return 'Free';
  }
  let fd: number | undefined;
  try {
    fd = openSync(modeFile(folder, deviceId), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = fstatSync(fd);
    if (!file.isFile() || !own(file.uid) || (file.mode & 0o077) !== 0 || file.size > MAX_MODE_FILE_BYTES) return 'Free';
    const buffer = Buffer.alloc(MAX_MODE_FILE_BYTES + 1);
    let count = 0;
    for (;;) {
      const size = readSync(fd, buffer, count, buffer.length - count, null);
      if (size === 0) break;
      count += size;
      if (count > MAX_MODE_FILE_BYTES) return 'Free';
    }
    const value: unknown = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    const mode = isObject(value) ? value.mode : undefined;
    return LEGACY_MODES.find(known => known === mode) ?? 'Free';
  } catch {
    return 'Free';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Reads each device's mode from the old host's `modes/` folder, under its lease root. */
export function readLegacyModes(folder: string, deviceIds: readonly string[]): Map<string, LegacyMode> {
  return new Map(deviceIds.map(id => [id, readMode(folder, id)]));
}

/** A legacy device ID as a routing ID: lowercase, with each run of other characters as one hyphen. */
export function routingIdOf(deviceId: string): string {
  return deviceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128).replace(/-+$/, '');
}

const KEEP = ['vendor', 'product', 'firmwareMajor', 'firmwareMinor'] as const;

/**
 * Converts the old host's `lifx` block, with each bulb's mode from `modes`, into this module's section. A bulb keeps its
 * address and model evidence; a qualified bulb keeps its mode as `initialMode` (Free when `modes` has none); a bulb
 * keeps its status caps only when both it and the block configured status, as the old host painted only then; and the
 * queue bounds carry over. The controller and source IDs and the status feed are not needed: the module publishes as
 * itself and follows the core's sessions. A device ID that is not a routing ID is renamed, and the rename is reported.
 * The result is checked with the module's own `configure`, so a section the runtime would refuse is refused here.
 */
export function convertLegacyConfiguration(block: unknown, modes: ReadonlyMap<string, LegacyMode>): Conversion | ErrorBody {
  if (!isObject(block) || !Array.isArray(block.bulbs)) return errorBody('invalid-request', {detail: 'the lifx block must list its bulbs'});
  const feed = block.status !== undefined;
  const renamed: Conversion['renamed'] = [];
  const bulbs: LifxBulbConfig[] = [];
  for (const legacy of block.bulbs as unknown[]) {
    if (!isObject(legacy) || typeof legacy.deviceId !== 'string' || typeof legacy.address !== 'string') {
      return errorBody('invalid-request', {detail: 'each bulb needs a deviceId and an address'});
    }
    const id = routingId(legacy.deviceId) ? legacy.deviceId : routingIdOf(legacy.deviceId);
    if (id !== legacy.deviceId) renamed.push({from: legacy.deviceId, to: id});
    const bulb: LifxBulbConfig = {id, address: legacy.address};
    for (const key of KEEP) {
      const value = legacy[key];
      if (typeof value === 'number') bulb[key] = value;
    }
    if (feed && isObject(legacy.status)) {
      const {brightnessCapPercent = 50, quietCapPercent = 20} = legacy.status;
      if (typeof brightnessCapPercent === 'number' && typeof quietCapPercent === 'number') bulb.status = {brightnessCapPercent, quietCapPercent};
    }
    if (qualified(bulb)) bulb.initialMode = NATIVE[modes.get(legacy.deviceId) ?? 'Free'];
    bulbs.push(bulb);
  }
  const section: Conversion['section'] = {bulbs};
  for (const key of ['timeoutMs', 'retries', 'maxPending'] as const) {
    const value = block[key];
    if (typeof value === 'number') section[key] = value;
  }
  const checked = configureLifx(section);
  return 'error' in checked ? checked : {section, renamed};
}
