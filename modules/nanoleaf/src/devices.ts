// Device registry, per-device layout shape and device-scoped state migration (devices.py).
import {existsSync, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isObject, own, type Json, type JsonObject} from './compat.js';
import {ValueError} from './errors.js';
import {readJson, writeJson, type WriteJson} from './jsonfile.js';
import {execute, rows, type Db} from './sqlite.js';

/** The original Lines device. */
export const DEFAULT = 'wall';
export type Kind = 'lines' | 'panels';
/** Zones per element: a Line has two lighting zones, an NL22 triangle one. */
export const KINDS: Readonly<Record<Kind, number>> = {lines: 2, panels: 1};
export const ID = /^[A-Za-z0-9_.-]{1,128}$/;
export const LAYOUT_VERSION = 2;
export const GEOMETRY_KEYS = ['zone_geometry', 'connector_geometry', 'panel_geometry'] as const;
const QUOTED = `'${DEFAULT}'`;

export const isKind = (value: unknown): value is Kind => value === 'lines' || value === 'panels';

export interface Element {
  id: string;
  number: number;
  zones: number[];
  position: number[] | null;
}

export interface LayoutEntry {
  kind: Kind;
  elements: Element[];
  zone_geometry?: Json;
  connector_geometry?: Json;
  panel_geometry?: Json;
}

export interface RegistryEntry {
  kind: Kind;
  ip: string | null;
  token_ref: string;
}

/** The keys of a loaded device configuration that placement reads. */
export interface DeviceConfig {
  device?: string;
  kind?: string;
  elements?: Element[];
  line_groups?: number[][];
  line_positions?: number[][];
}

// Column order keeps the legacy columns first and the device key last: older sources
// restore the shared-input backup positionally.
export const SCHEMAS = {
  slots: `(session TEXT NOT NULL, slot INTEGER NOT NULL, device TEXT NOT NULL DEFAULT ${QUOTED}, `
    + 'PRIMARY KEY (device, session), UNIQUE (device, slot))',
  comets: `(session TEXT NOT NULL, turn TEXT, queued REAL, source INTEGER, started REAL, `
    + `device TEXT NOT NULL DEFAULT ${QUOTED}, PRIMARY KEY (device, session))`,
  line_prefs: `(line_id TEXT NOT NULL, project TEXT, signature INTEGER DEFAULT 0, `
    + `device TEXT NOT NULL DEFAULT ${QUOTED}, PRIMARY KEY (device, line_id))`,
  map_settings: '(id INTEGER PRIMARY KEY, style TEXT, coverage TEXT, rotation INTEGER, flip_x INTEGER, '
    + `flip_y INTEGER, device TEXT NOT NULL DEFAULT ${QUOTED})`,
  map_pending: `(id INTEGER PRIMARY KEY, payload TEXT, device TEXT NOT NULL DEFAULT ${QUOTED})`,
  locate: `(id INTEGER PRIMARY KEY, line_id TEXT, started REAL, device TEXT NOT NULL DEFAULT ${QUOTED})`,
  display_v3: '(id INTEGER PRIMARY KEY, snapshot TEXT, looping INTEGER, rendered REAL, '
    + `device TEXT NOT NULL DEFAULT ${QUOTED})`,
} as const;
export type DeviceTable = keyof typeof SCHEMAS;
export const DEVICE_TABLES = Object.keys(SCHEMAS) as DeviceTable[];
// Tables whose key must include the device are rebuilt; singleton tables gain a column.
export const REBUILT = {
  slots: ['session', 'slot'],
  comets: ['session', 'turn', 'queued', 'source', 'started'],
  line_prefs: ['line_id', 'project', 'signature'],
} as const;
const EXTENDED = ['map_settings', 'map_pending', 'locate', 'display_v3'] as const;

export const elementId = (zones: readonly number[]): string => [...zones].sort((a, b) => a - b).map(String).join(':');

export const deviceOf = (config: DeviceConfig): string => config.device ?? DEFAULT;

export const metaKey = (name: string, device: string = DEFAULT): string => (device === DEFAULT ? name : name + '@' + device);

export function sceneFile(device: string = DEFAULT): string {
  if (device !== DEFAULT && !ID.test(device)) throw new ValueError('Invalid device identity.');
  return device === DEFAULT ? 'scene-state.json' : 'scene-state.' + device + '.json';
}

/** The worker's exclusive lock; the original device keeps the existing file name. */
export function lockFile(device: string = DEFAULT): string {
  if (device !== DEFAULT && !ID.test(device)) throw new ValueError('Invalid device identity.');
  return device === DEFAULT ? 'notification-lock.sqlite' : 'notification-lock.' + device + '.sqlite';
}

/** Registered devices from the private configuration, in configuration order; the original Lines device is implied. */
export function registry(config: unknown): Map<string, RegistryEntry> {
  if (!isObject(config)) throw new ValueError('Invalid configuration.');
  const raw = config.devices ?? {};
  // Python treats every falsy registry value as no registry.
  const value = raw === false || raw === 0 || raw === '' || (Array.isArray(raw) && raw.length === 0) ? {} : raw;
  if (!isObject(value)) throw new ValueError('Invalid device registry.');
  const found = new Map<string, RegistryEntry>();
  for (const [device, entry] of Object.entries(value)) {
    if (!ID.test(device) || !isObject(entry) || !isKind(entry.kind) || typeof entry.ip !== 'string'
        || typeof entry.token_ref !== 'string' || entry.token_ref === '') {
      throw new ValueError('Invalid device registry entry.');
    }
    found.set(device, {kind: entry.kind, ip: entry.ip, token_ref: entry.token_ref});
  }
  if (found.has(DEFAULT)) return found;
  // A configuration that predates the registry describes the original Lines device.
  const ip = config.ip;
  return new Map([[DEFAULT, {kind: 'lines', ip: typeof ip === 'string' ? ip : null, token_ref: 'token'}], ...found]);
}

/** The referenced credential, or null when the configuration holds none. */
export function credential(config: JsonObject, entry: RegistryEntry): string | null {
  const value = own(config, entry.token_ref);
  return typeof value === 'string' ? value : null;
}

const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

export function validateElements(kind: unknown, elements: unknown): Element[] {
  if (!isKind(kind)) throw new ValueError('Unsupported device kind.');
  const perElement = KINDS[kind];
  if (!Array.isArray(elements) || elements.length < 1 || elements.length > 300) throw new ValueError('Invalid element list.');
  const seen = new Set<number>();
  const clean: Element[] = [];
  elements.forEach((element: unknown, index) => {
    if (!isObject(element)) throw new ValueError('Invalid element.');
    const zones = element.zones;
    if (!Array.isArray(zones) || zones.length !== perElement
        || zones.some(zone => !isInt(zone) || zone < 0 || zone > 65535)
        || new Set(zones).size !== zones.length || zones.some(zone => seen.has(zone as number))) {
      throw new ValueError('Invalid element zones.');
    }
    const ints = zones as number[];
    if (element.id !== elementId(ints)) throw new ValueError('Element identity must follow its zones.');
    if (element.number !== index + 1) throw new ValueError('Element numbering must follow the saved order.');
    const position = element.position ?? null;
    if (position !== null && (!Array.isArray(position) || position.length !== 2 || !position.every(numeric))) {
      throw new ValueError('Invalid element position.');
    }
    for (const zone of ints) seen.add(zone);
    clean.push({id: elementId(ints), number: index + 1, zones: [...ints],
      position: position === null ? null : [position[0] as number, position[1] as number]});
  });
  return clean;
}

function entry(kind: Kind, elements: Element[], source: unknown): LayoutEntry {
  const result: LayoutEntry = {kind, elements};
  if (isObject(source)) {
    for (const key of GEOMETRY_KEYS) {
      const value = source[key];
      if (value !== undefined && value !== null) result[key] = value;
    }
  }
  return result;
}

/** A Lines device entry from the legacy zone pairing and optional pulse positions. */
export function linesEntry(groups: unknown, positions: unknown = null, source: unknown = null): LayoutEntry {
  if (!Array.isArray(groups) || groups.some(pair => !Array.isArray(pair))) throw new ValueError('Invalid physical Line mapping.');
  if (positions !== null && (!Array.isArray(positions) || positions.length !== groups.length)) {
    throw new ValueError('Each Line needs a position for outward pulses.');
  }
  const pulse = Array.isArray(positions) && positions.length > 0 ? positions as unknown[] : null;
  const elements = (groups as unknown[][]).map((pair, index) => {
    if (pair.some(zone => !isInt(zone))) throw new ValueError('Invalid physical Line mapping.');
    const zones = pair as number[];
    return {id: elementId(zones), number: index + 1, zones: [...zones], position: pulse === null ? null : pulse[index] ?? null};
  });
  return entry('lines', validateElements('lines', elements), source);
}

/** Normalize a saved layout, Lines-only or per-device, into device: entry in file order. */
export function layoutDevices(saved: unknown): Map<string, LayoutEntry> {
  if (!isObject(saved)) throw new ValueError('Invalid layout file.');
  if ('devices' in saved) {
    const devices = saved.devices;
    if (saved.version !== LAYOUT_VERSION || !isObject(devices)) throw new ValueError('Unsupported layout version.');
    const result = new Map<string, LayoutEntry>();
    for (const [device, value] of Object.entries(devices)) {
      if (!ID.test(device) || !isObject(value)) throw new ValueError('Invalid layout device.');
      const kind = value.kind;
      const elements = validateElements(kind, value.elements);
      result.set(device, entry(kind as Kind, elements, value));
    }
    return result;
  }
  const groups = saved.line_groups;
  if (groups === undefined || groups === null || groups === false || groups === 0 || groups === ''
      || (Array.isArray(groups) && groups.length === 0) || (isObject(groups) && Object.keys(groups).length === 0)) {
    return new Map();
  }
  return new Map([[DEFAULT, linesEntry(groups, saved.line_positions ?? null, saved)]]);
}

/** A loaded device's configuration keys from its layout entry. */
export interface DeviceProjection extends DeviceConfig {
  kind: Kind;
  elements: Element[];
  line_groups: number[][];
  zone_geometry?: Json;
  connector_geometry?: Json;
  panel_geometry?: Json;
}

/** The configuration keys placement and the renderer read for one loaded device. */
export function projection(value: LayoutEntry): DeviceProjection {
  const items = value.elements;
  const result: DeviceProjection = {kind: value.kind,
    elements: items.map(e => ({...e, zones: [...e.zones], position: e.position === null ? null : [...e.position]})),
    line_groups: items.map(e => [...e.zones])};
  if (items.every(e => e.position !== null)) result.line_positions = items.map(e => [...(e.position ?? [])]);
  for (const key of GEOMETRY_KEYS) {
    const geometry = value[key];
    if (geometry !== undefined) result[key] = geometry;
  }
  return result;
}

/** Elements of the loaded device, derived from the Lines pairing when only that is supplied. */
export function elements(config: DeviceConfig): Element[] {
  if (config.elements !== undefined && config.elements.length > 0) return config.elements;
  const positions = config.line_positions ?? [];
  return (config.line_groups ?? []).map((pair, index) => {
    const position = positions[index];
    return {id: elementId(pair), number: index + 1, zones: [...pair], position: position === undefined ? null : [...position]};
  });
}

/** Validate a per-device layout and return the version-2 file content. */
export function serialized(devices: ReadonlyMap<string, unknown> | JsonObject): JsonObject {
  const pairs: [string, unknown][] = devices instanceof Map ? [...(devices as ReadonlyMap<string, unknown>).entries()] : Object.entries(devices);
  if (pairs.length === 0) throw new ValueError('Invalid layout devices.');
  const output: JsonObject = {};
  for (const [device, value] of pairs) {
    if (!ID.test(device) || !isObject(value)) throw new ValueError('Invalid layout device.');
    const kind = value.kind;
    const validated = entry(kind as Kind, validateElements(kind, value.elements), value);
    output[device] = validated as unknown as Json;
  }
  return {version: LAYOUT_VERSION, devices: output};
}

/** Write the per-device layout atomically; an invalid layout leaves the last valid file. */
export function saveLayout(path: string, devices: ReadonlyMap<string, unknown> | JsonObject, write: WriteJson = writeJson): void {
  write(path, serialized(devices));
}

/**
 * Merge one device's discovered entry into the current file under an exclusive lock.
 *
 * Each device's worker may discover its layout at the same time; re-reading under the
 * lock keeps the other device's entry instead of overwriting it with a stale copy.
 * An entry of null removes that device's entry.
 */
export function saveDeviceLayout(path: string, device: string, value: LayoutEntry | null, write: WriteJson = writeJson): void {
  const lock = new DatabaseSync(join(dirname(path), 'layout-lock.sqlite'), {timeout: 5000});
  try {
    lock.exec('BEGIN EXCLUSIVE');
    const current = existsSync(path) ? layoutDevices(readJson(path)) : new Map<string, LayoutEntry>();
    if (value !== null) {
      current.set(device, value);
      saveLayout(path, current, write);
    } else if (current.delete(device)) {
      if (current.size > 0) saveLayout(path, current, write);
      else unlinkSync(path);
    }
  } finally {
    if (lock.isTransaction) lock.exec('ROLLBACK');
    lock.close();
  }
}

export function create(db: Db, table: DeviceTable): void {
  db.exec('CREATE TABLE IF NOT EXISTS ' + table + ' ' + SCHEMAS[table]);
}

export function columns(db: Db, table: string): string[] {
  return rows(db, 'PRAGMA table_info("' + table + '")').map(row => String(row[1]));
}

/**
 * Named values of a row saved before its table had the device key, or null for any other shape.
 *
 * Such a row belongs to the original device, as the migration below decides for stored rows.
 */
export function legacyRow(table: string, row: readonly unknown[]): Record<string, unknown> | null {
  const names: readonly string[] | undefined = Object.hasOwn(REBUILT, table) ? REBUILT[table as keyof typeof REBUILT] : undefined;
  if (names === undefined || row.length !== names.length) return null;
  const values: Record<string, unknown> = {};
  names.forEach((name, index) => { values[name] = row[index]; });
  values.device = DEFAULT;
  return values;
}

/** Guarded, idempotent device-scoped upgrade inside the caller's initialization transaction. */
export function migrate(db: Db): void {
  for (const [table, names] of Object.entries(REBUILT) as [keyof typeof REBUILT, readonly string[]][]) {
    if (columns(db, table).includes('device')) continue;
    const legacy = names.join(', ');
    db.exec('ALTER TABLE ' + table + ' RENAME TO ' + table + '_legacy');
    create(db, table);
    execute(db, 'INSERT INTO ' + table + ' (' + legacy + ') SELECT ' + legacy + ' FROM ' + table + '_legacy');
    db.exec('DROP TABLE ' + table + '_legacy');
  }
  for (const table of EXTENDED) {
    if (!columns(db, table).includes('device')) db.exec('ALTER TABLE ' + table + ' ADD COLUMN device TEXT NOT NULL DEFAULT ' + QUOTED);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ' + table + '_device ON ' + table + ' (device)');
  }
}
