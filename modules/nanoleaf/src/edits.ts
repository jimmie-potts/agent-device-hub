// Configuration edits from the wall map and, through the runtime's commands, other callers (edits.py). Each runs inside
// the caller's write transaction: it checks its input against current state, applies it (a map edit that would move a
// running comet waits as the device's pending wall edit) and wakes the display once. Python also advanced the
// controller ledgers each edit touched; the ledgers are not ported (PORTING.md). Callers decode their own payloads, so
// nothing here sees routes, opaque IDs or requests.
import {isObject, type JsonObject} from './compat.js';
import {deviceOf, elements, type DeviceConfig} from './devices.js';
import {ValueError} from './errors.js';
import {HEX, requestPatch, savePalette, validatePalette, type SettingName} from './project-map.js';
import {evict as evictShared} from './shared-input.js';
import {execute, first, rows, type Db} from './sqlite.js';
import {controlState, markDirty} from './store.js';

/** Each map setting and the values it takes. */
export const SETTINGS: Readonly<Record<SettingName, readonly (string | number)[]>> = {
  style: ['classic', 'project'], coverage: ['whole', 'status'], rotation: [0, 90, 180, 270], flip_x: [0, 1], flip_y: [0, 1]};

const isSetting = (key: string): key is SettingName => Object.hasOwn(SETTINGS, key);

/** Python's `value in options`, under which true and false equal 1 and 0. */
const among = (value: unknown, options: readonly (string | number)[]): boolean =>
  options.some(option => option === value || (typeof value === 'boolean' && option === Number(value)));

const isLines = (config: DeviceConfig): boolean => (config.kind ?? 'lines') === 'lines';

const projectIds = (db: Db): Set<unknown> => new Set(rows(db, 'SELECT id FROM projects').map(row => row[0]));

/** Change the named device's map settings and, with a palette entry, the palette every device shares. */
export function settings(db: Db, config: DeviceConfig, changes: unknown): void {
  if (!isObject(changes) || Object.keys(changes).length === 0) throw new ValueError('Invalid setting.');
  const values = Object.entries(changes).filter(([key]) => key !== 'palette');
  if (values.some(([key, value]) => !isSetting(key) || !among(value, SETTINGS[key]))) throw new ValueError('Invalid setting.');
  // Animation coverage chooses between a Line's two halves; a one-zone triangle has none.
  if (values.some(([key]) => key === 'coverage') && !isLines(config)) throw new ValueError('Animation coverage applies to Lines only.');
  // The palette covers every device and moves no comet source, so it applies at once.
  if (Object.hasOwn(changes, 'palette')) savePalette(db, validatePalette(changes.palette));
  if (values.length > 0) requestPatch(db, {settings: Object.fromEntries(values)}, config);
  markDirty(db);
}

/** Assign projects or swap halves on the named device's elements. */
export function assign(db: Db, config: DeviceConfig, lines: unknown): void {
  const known = projectIds(db);
  const ids = new Set(elements(config).map(element => element.id));
  if (!isObject(lines) || Object.keys(lines).length === 0) throw new ValueError('Select at least one Line.');
  for (const [key, value] of Object.entries(lines)) {
    if (!ids.has(key) || !isObject(value) || Object.keys(value).length === 0
        || Object.keys(value).some(field => field !== 'project' && field !== 'signature')) {
      throw new ValueError('Invalid Line assignment.');
    }
    if (Object.hasOwn(value, 'project') && value.project !== null && !known.has(value.project)) throw new ValueError('Unknown project.');
    if (Object.hasOwn(value, 'signature') && value.signature !== 0 && value.signature !== 1) throw new ValueError('Invalid half.');
    if (Object.hasOwn(value, 'signature') && !isLines(config)) throw new ValueError('Half swaps apply to Lines only.');
  }
  requestPatch(db, {lines: lines as Record<string, JsonObject>}, config);
  markDirty(db);
}

/** Recolor a project on every device. */
export function projectColor(db: Db, project: unknown, color: unknown): void {
  if (!projectIds(db).has(project) || typeof color !== 'string' || !HEX.test(color)) throw new ValueError('Invalid project color.');
  execute(db, 'UPDATE projects SET color=? WHERE id=?', color.toLowerCase(), String(project));
  markDirty(db);
}

/** Override a task's project, or clear the override with null. */
export function taskProject(db: Db, config: DeviceConfig, session: unknown, project: unknown): void {
  const known = projectIds(db);
  if (typeof session !== 'string' || first(db, 'SELECT 1 FROM task_info WHERE session=?', session) === undefined) {
    throw new ValueError('Unknown task.');
  }
  if (project !== null && !known.has(project)) throw new ValueError('Unknown project.');
  requestPatch(db, {tasks: {[session]: project as string | null}}, config);
  markDirty(db);
}

/** Flash one element of the named device white. */
export function locate(db: Db, config: DeviceConfig, line: unknown): void {
  const device = deviceOf(config);
  if (!elements(config).some(element => element.id === line)) throw new ValueError('Unknown Line.');
  if (controlState(db, device).mode === 'free') throw new ValueError('Choose Work or Quiet to locate a Line.');
  execute(db, 'INSERT OR REPLACE INTO locate (line_id,started,device) VALUES (?,NULL,?)', String(line), device);
  markDirty(db);
}

/** Remove a shared task from the named device, as its eviction token permits. */
export function evict(db: Db, config: DeviceConfig, request: unknown): void {
  evictShared(db, deviceOf(config), request);
  markDirty(db);
}
