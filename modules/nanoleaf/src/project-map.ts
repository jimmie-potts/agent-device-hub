// Project metadata, persistent wall preferences, task placement, the palette, the rendering receipt, the pending wall
// edit, Locate and the renderer's map settings (project_map.py). Map geometry is in geometry.ts; the edits that check
// their requests and call these are in edits.ts.
import {statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {compareText, isObject, normpath, own, parseJson, pyJson, pyRound, splitText, titleCase, type Json, type JsonObject} from './compat.js';
import {create, DEFAULT, deviceOf, elementId, elements, metaKey, type DeviceConfig} from './devices.js';
import {ValueError} from './errors.js';
import {readText} from './jsonfile.js';
import type {Rgb} from './effects.js';
import type {Indication} from './line-projection.js';
import type {Flash, RenderConfig} from './renderer.js';
import {execute, first, rows, sameRow, totalChanges, type Db, type Row, type SqlValue} from './sqlite.js';
import {meta} from './store.js';

export const DEFAULT_SETTINGS = ['classic', 'whole', 0, 0, 0] as const;
/** The task statuses a Line indicates, in preview order; each has a palette role. */
export const STATUSES = ['working', 'question', 'blocked', 'unread'] as const;
export type LineStatus = typeof STATUSES[number];
export const isLineStatus = (value: unknown): value is LineStatus => STATUSES.some(status => status === value);
// One task-light palette for every device. Only changed roles are stored.
export const DEFAULT_PALETTE = Object.freeze({base: '#0a1866', working: '#00ff00', question: '#ffff00', blocked: '#ff0000', unread: '#9b30ff'});
export type Role = keyof typeof DEFAULT_PALETTE;
export const ROLES = Object.keys(DEFAULT_PALETTE) as Role[];
export const isRole = (value: unknown): value is Role => ROLES.some(role => role === value);
export const HEX = /^#[0-9a-fA-F]{6}$/;

/** The map settings a device saves, in their column order. */
export const SETTING_NAMES = ['style', 'coverage', 'rotation', 'flip_x', 'flip_y'] as const;
export type SettingName = typeof SETTING_NAMES[number];
export const isSettingName = (value: unknown): value is SettingName => SETTING_NAMES.some(name => name === value);

export interface MapSettings {
  style: SqlValue;
  coverage: SqlValue;
  rotation: SqlValue;
  flip_x: SqlValue;
  flip_y: SqlValue;
}

/** Keep schema creation inside the caller's initialization transaction. */
export function initProjectMap(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT,color TEXT,roots TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS task_info (session TEXT PRIMARY KEY,title TEXT,cwd TEXT,project TEXT,manual_project TEXT,turn TEXT,started REAL)');
  db.exec('CREATE TABLE IF NOT EXISTS palette (role TEXT PRIMARY KEY,color TEXT NOT NULL)');
  for (const table of ['line_prefs', 'map_settings', 'map_pending', 'locate'] as const) create(db, table);
}

/** The original device keeps its row; other devices are seeded on their first setting. */
export function seedProjectMap(db: Db): void {
  execute(db, 'INSERT OR IGNORE INTO map_settings (id,style,coverage,rotation,flip_x,flip_y,device) VALUES (1,?,?,?,?,?,?)',
    ...DEFAULT_SETTINGS, DEFAULT);
}

export function settings(db: Db, device: string = DEFAULT): MapSettings {
  const [style, coverage, rotation, flipX, flipY] = first(db, 'SELECT style,coverage,rotation,flip_x,flip_y FROM map_settings WHERE device=?', device)
    ?? DEFAULT_SETTINGS;
  return {style: style ?? null, coverage: coverage ?? null, rotation: rotation ?? null, flip_x: flipX ?? null, flip_y: flipY ?? null};
}

/** The effective palette; a damaged row falls back to that role's default. */
export function palette(db: Db): Record<Role, string> {
  const result: Record<Role, string> = {...DEFAULT_PALETTE};
  for (const [role = null, color = null] of rows(db, 'SELECT role,color FROM palette')) {
    if (isRole(role) && typeof color === 'string' && HEX.test(color)) result[role] = color.toLowerCase();
  }
  return result;
}

/** #RRGGBB as red, green and blue; anything else is a ValueError, as Python's int(..., 16) raised for most malformed text. */
function hexRgb(color: string): Rgb {
  if (!HEX.test(color)) throw new ValueError(`Invalid color ${JSON.stringify(color)}.`);
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}

export function paletteRgb(value: Readonly<Record<Role, string>>): Record<Role, Rgb> {
  return {base: hexRgb(value.base), working: hexRgb(value.working), question: hexRgb(value.question), blocked: hexRgb(value.blocked),
    unread: hexRgb(value.unread)};
}

export type PaletteWrite = 'default' | Partial<Record<Role, string>>;

/** Check a palette write before anything is saved: 'default' or one to five role colors, returned in lowercase. */
export function validatePalette(value: unknown): PaletteWrite {
  if (value === 'default') return value;
  if (!isObject(value) || Object.keys(value).length === 0) throw new ValueError('Invalid palette.');
  const result: Partial<Record<Role, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (!isRole(role) || typeof color !== 'string' || !HEX.test(color)) throw new ValueError('Invalid palette.');
    result[role] = color.toLowerCase();
  }
  return result;
}

/** Save a checked palette write: 'default' removes every chosen color. */
export function savePalette(db: Db, value: PaletteWrite): void {
  if (value === 'default') {
    execute(db, 'DELETE FROM palette');
    return;
  }
  for (const [role, color] of Object.entries(value)) execute(db, 'INSERT OR REPLACE INTO palette VALUES (?,?)', role, color);
}

export type RenderingOutcome = 'pending' | 'failed' | 'externally-controlled' | 'unknown' | 'last-sent';

export interface Rendering {
  apiVersion: '1.0';
  deviceId: string;
  mode: string;
  outcome: RenderingOutcome;
  pending: boolean;
  failedAttempt: boolean;
  sampledAtMs: number;
  lastSuccessful: JsonObject | null;
}

/** The device's latest rendering receipt and what became of the last attempt, read without changing anything. */
export function renderingSnapshot(db: Db, config: DeviceConfig, mode: string, modePending: boolean, error: string | null,
  instant: number): Rendering {
  const device = deviceOf(config);
  const values = meta(db);
  const saved = values.get(metaKey('rendering_receipt', device));
  let receipt: JsonObject | null = null;
  if (saved !== undefined && saved !== null && saved !== '') {
    try {
      const parsed = parseJson(String(saved));
      if (isObject(parsed)) receipt = parsed;
    } catch (failure) {
      if (!(failure instanceof ValueError)) throw failure;
    }
  }
  const pending = values.get('dirty') === '1' || modePending;
  const failed = error !== null && error !== '';
  let outcome: RenderingOutcome;
  if (pending) outcome = 'pending';
  else if (failed) outcome = 'failed';
  else if (mode === 'free') outcome = 'externally-controlled';
  else if (receipt === null || receipt.outcome === 'unknown') outcome = 'unknown';
  else outcome = 'last-sent';
  return {apiVersion: '1.0', deviceId: device, mode, outcome, pending, failedAttempt: failed, sampledAtMs: pyRound(instant * 1000),
    lastSuccessful: receipt !== null && receipt.outcome !== 'unknown' ? receipt : null};
}

export const lineId = (pair: readonly number[]): string => elementId(pair);

/** Fold Windows, /mnt and WSL UNC spellings of a path into one comparable form. */
export function normalize(path: unknown): string {
  if (typeof path !== 'string') return '';
  let value = path.replaceAll('\\', '/').replace(/\/+$/, '');
  const lower = value.toLowerCase();
  if (lower.startsWith('//wsl$/') || lower.startsWith('//wsl.localhost/')) {
    const pieces = splitText(value, '/', 4);
    const rest = pieces[4];
    if (rest !== undefined) value = '/' + rest;
  }
  value = value === '' ? '' : normpath(value);
  if (/^\/mnt\/[a-zA-Z]\//.test(value)) {
    const points = Array.from(value);
    return (points[5] ?? '').toLowerCase() + ':/' + points.slice(7).join('').toLowerCase();
  }
  if (/^[a-zA-Z]:\//.test(value)) return value.toLowerCase();
  return value;
}

/** colorsys.hsv_to_rgb. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s === 0) return [v, v, v];
  let i = Math.trunc(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  i %= 6;
  if (i === 0) return [v, t, p];
  if (i === 1) return [q, v, p];
  if (i === 2) return [p, v, t];
  if (i === 3) return [p, q, v];
  if (i === 4) return [t, p, v];
  return [v, p, q];
}

/** Stable colors across catalog reorderings; users can replace every suggestion. */
export function defaultColor(projectId: string): string {
  let sum = 0;
  Array.from(projectId).forEach((character, index) => { sum += (index + 1) * (character.codePointAt(0) ?? 0); });
  const hue = sum % 360;
  return '#' + hsvToRgb(hue / 360, 0.62, 0.95).map(c => pyRound(c * 255).toString(16).padStart(2, '0')).join('');
}

/** A title for an untitled task: the provider and the last eight hexadecimal characters of its session ID. */
export function fallbackTitle(provider: string, session: string): string {
  const hex = (session.match(/[0-9a-fA-F]/g) ?? []).join('');
  const suffix = hex !== '' ? hex.slice(-8) : Array.from(session).slice(-8).join('');
  const names: Record<string, string> = {codex: 'Codex', claude: 'Claude'};
  return (names[provider] ?? titleCase(provider)) + ' ' + suffix.toLowerCase();
}

const METADATA_KEYS = ['local-projects', 'thread-project-assignments', 'thread-workspace-root-hints'] as const;
type MetadataKey = typeof METADATA_KEYS[number];

function stampOf(path: string): string {
  const info = statSync(path, {bigint: true});
  return `${info.mtimeNs}:${info.size}`;
}

/** Codex Desktop's local project catalog and thread titles, read only, never written. */
export class Metadata {
  readonly path: string | null;
  readonly index: string | null;
  stamps = new Map<string, string>();
  data: Partial<Record<MetadataKey, JsonObject>> = {};
  titles = new Map<string, string>();
  indexIds = new Set<string>();

  constructor(config: {readonly metadata_path?: Json | undefined; readonly title_index_path?: Json | undefined}) {
    const custom = config.metadata_path;
    this.path = typeof custom === 'string' && custom !== '' ? custom : null;
    const index = config.title_index_path;
    this.index = typeof index === 'string' && index !== '' ? index : this.path === null ? null : join(dirname(this.path), 'session_index.jsonl');
  }

  /** Re-read changed files; a damaged file keeps the last valid values, and an unreadable index forgets its IDs. */
  refresh(): void {
    for (const path of [this.path, this.index]) {
      if (path === null) continue;
      try {
        const stamp = stampOf(path);
        if (this.stamps.get(path) === stamp) continue;
        if (path === this.path) {
          const raw = parseJson(readText(path, true));
          if (!isObject(raw) || METADATA_KEYS.some(key => !isObject(raw[key]))) continue;
          const data: Partial<Record<MetadataKey, JsonObject>> = {};
          for (const key of METADATA_KEYS) {
            const value = raw[key];
            if (isObject(value)) data[key] = value;
          }
          this.data = data;
        } else {
          const titles = new Map<string, string>();
          for (const line of readText(path, true).split(/\r\n|\r|\n/)) {
            let item: unknown;
            try { item = parseJson(line); } catch { continue; }
            if (isObject(item) && typeof item.id === 'string' && typeof item.thread_name === 'string') titles.set(item.id, item.thread_name);
          }
          for (const [id, title] of titles) this.titles.set(id, title);
          this.indexIds = new Set(titles.keys());
        }
        this.stamps.set(path, stamp);
      } catch (error) {
        if (!isReadFailure(error)) throw error;
        if (path === this.index) {
          this.indexIds.clear();
          this.stamps.delete(path);
        }
      }
    }
  }

  /** Save the local project catalog; true when a row changed. */
  syncCatalog(db: Db): boolean {
    const before = totalChanges(db);
    for (const [pid, project] of Object.entries(this.data['local-projects'] ?? {})) {
      if (!isObject(project) || typeof project.name !== 'string') continue;
      const roots = project.rootPaths === undefined ? [] : project.rootPaths;
      if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) continue;
      const encoded = pyJson(roots);
      const old = first(db, 'SELECT name,roots FROM projects WHERE id=?', pid);
      if (!sameRow(old, [project.name, encoded])) {
        execute(db, 'INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,roots=excluded.roots',
          pid, project.name, defaultColor(pid), encoded);
      }
    }
    return totalChanges(db) !== before;
  }

  /** A task's title and project: the explicit assignment, else the longest saved root that holds its workspace. */
  lookup(db: Db, session: string, title: SqlValue = '', cwd: SqlValue = '', project: SqlValue = null): [SqlValue, SqlValue] {
    const projects = new Map(rows(db, 'SELECT id,name,roots FROM projects').map(([id, , roots]) => [id ?? null, rootsOf(roots ?? null)]));
    const foundTitle = this.titles.get(session) ?? title;
    const assignment = own(this.data['thread-project-assignments'], session);
    const explicit = isObject(assignment) ? own(assignment, 'projectId') : undefined;
    if (typeof explicit === 'string' && projects.has(explicit)) return [foundTitle, explicit];
    const hint = own(this.data['thread-workspace-root-hints'], session);
    const candidate = normalize(truthy(hint) ? hint : cwd);
    let best: [number, string] | null = null;
    for (const [pid, roots] of projects) {
      for (const root of roots.map(normalize)) {
        if (root === '' || (candidate !== root && !candidate.startsWith(root + '/'))) continue;
        const match: [number, string] = [Array.from(root).length, String(pid)];
        if (best === null || match[0] > best[0] || (match[0] === best[0] && compareText(match[1], best[1]) > 0)) best = match;
      }
    }
    return [foundTitle, best === null ? project : best[1]];
  }

  /** Enrich every local task's title and project; true when a row changed. */
  sync(db: Db): boolean {
    const before = totalChanges(db);
    this.syncCatalog(db);
    for (const [session = null, turn = null] of rows(db, 'SELECT id,turn FROM sessions')) {
      const previous = first(db, 'SELECT title,cwd,project,manual_project,turn,started FROM task_info WHERE session=?', session);
      const [title = '', cwd = '', project = null, manual = null, oldTurn = turn, started = null] = previous ?? ['', '', null, null, turn, null];
      const [newTitle, newProject] = this.lookup(db, String(session), title, cwd, project);
      const value: Row = [newTitle, cwd, newProject, manual, turn, oldTurn === turn ? started : null];
      if (!sameRow(value, previous)) execute(db, 'INSERT OR REPLACE INTO task_info VALUES (?,?,?,?,?,?,?)', session, ...value);
    }
    return totalChanges(db) !== before;
  }
}

/** Python's truth value of a parsed JSON value. */
function truthy(value: Json | undefined): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function rootsOf(saved: SqlValue): unknown[] {
  const value = parseJson(String(saved));
  if (!Array.isArray(value)) throw new TypeError('Saved project roots must be a list.');
  return value;
}

/** The read failures Python's OSError, ValueError and TypeError cover here. */
function isReadFailure(error: unknown): boolean {
  return error instanceof ValueError || error instanceof TypeError || (error instanceof Error && 'code' in error);
}

/** Each task's project: its manual choice, else its attributed project. */
export function taskProjects(db: Db): Map<SqlValue, SqlValue> {
  return new Map(rows(db, 'SELECT session,project,manual_project FROM task_info')
    .map(([session = null, project = null, manual = null]) => [session, manual === null || manual === '' || manual === 0 ? project : manual]));
}

export type Owner = readonly [SqlValue, SqlValue];

/** Each element's reserved project and project half, in element order. */
export function owners(db: Db, config: DeviceConfig): Owner[] {
  const prefs = new Map(rows(db, 'SELECT line_id,project,signature FROM line_prefs WHERE device=?', deviceOf(config))
    .map(([key = null, project = null, signature = null]) => [key, [project, signature] as const]));
  return elements(config).map(element => prefs.get(element.id) ?? [null, 0]);
}

/** A visible task row: session, turn and status. */
export type TaskRow = readonly [string, SqlValue, SqlValue];

/** Keep valid placements and give each waiting task a free eligible element; reserved comet sources never move. */
export function allocate(db: Db, config: DeviceConfig, tasks: readonly TaskRow[], reserved: ReadonlySet<SqlValue>): Map<string, number> {
  const device = deviceOf(config);
  const assignments = new Map<string, number>();
  for (const [session, slot] of rows(db, 'SELECT session,slot FROM slots WHERE device=?', device)) {
    if (typeof session === 'string' && typeof slot === 'number') assignments.set(session, slot);
  }
  const active = new Set(tasks.map(task => task[0]));
  const projects = taskProjects(db);
  const prefs = owners(db, config);
  const style = settings(db, device).style;
  const valid = (session: string, slot: number): boolean => {
    const owner = prefs[slot]?.[0];
    return slot >= 0 && slot < prefs.length && (style === 'classic' || owner === null || owner === (projects.get(session) ?? null));
  };
  for (const [session, slot] of [...assignments]) {
    if (!valid(session, slot) && !reserved.has(slot)) {
      execute(db, 'DELETE FROM slots WHERE session=? AND device=?', session, device);
      assignments.delete(session);
    }
  }
  for (const [session] of tasks) {
    if (assignments.has(session)) continue;
    const candidates = prefs.map((_, slot) => slot).filter(slot => !reserved.has(slot) && valid(session, slot));
    if (style === 'project') candidates.sort((a, b) => Number(prefs[a]?.[0] === null) - Number(prefs[b]?.[0] === null));
    let chosen: number | null = null;
    for (const slot of candidates) {
      const occupant = [...assignments].find(([, held]) => held === slot)?.[0];
      if (occupant === undefined || !active.has(occupant)) {
        chosen = slot;
        if (occupant !== undefined) {
          execute(db, 'DELETE FROM slots WHERE session=? AND device=?', occupant, device);
          assignments.delete(occupant);
        }
        break;
      }
    }
    if (chosen !== null) {
      execute(db, 'INSERT INTO slots (session,slot,device) VALUES (?,?,?)', session, chosen, device);
      assignments.set(session, chosen);
    }
  }
  return assignments;
}

/**
 * A map edit: settings, per-element project and half choices, and per-task manual projects. Values are saved as the
 * request gave them, after the edit checked them.
 */
export interface Patch {
  settings?: JsonObject;
  lines?: Record<string, JsonObject>;
  tasks?: JsonObject;
}

/** The device's pending wall edit, waiting for its comet to end. */
export function pending(db: Db, device: string = DEFAULT): Patch | null {
  const row = first(db, 'SELECT payload FROM map_pending WHERE device=?', device);
  if (row === undefined) return null;
  const value = parseJson(String(row[0]));
  if (!isObject(value)) throw new TypeError('A pending wall edit must be an object.');
  return value;
}

/** SQLite's binding of a checked edit value; Python bound true and false as 1 and 0. */
function bound(value: Json | undefined): SqlValue {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number') return value ?? null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new TypeError('Error binding parameter: type is not supported.');
}

/** Save an edit's rows; an element keeps the field the edit leaves out. */
export function applyPatch(db: Db, patch: Patch, device: string = DEFAULT): void {
  const changes = patch.settings ?? {};
  if (Object.keys(changes).length > 0) {
    execute(db, 'INSERT OR IGNORE INTO map_settings (style,coverage,rotation,flip_x,flip_y,device) VALUES (?,?,?,?,?,?)', ...DEFAULT_SETTINGS, device);
    for (const [name, value] of Object.entries(changes)) {
      // Only a known column name reaches the statement.
      if (!isSettingName(name)) throw new ValueError('Invalid setting.');
      execute(db, `UPDATE map_settings SET ${name}=? WHERE device=?`, bound(value), device);
    }
  }
  for (const [line, value] of Object.entries(patch.lines ?? {})) {
    const [project = null, signature = 0] = first(db, 'SELECT project,signature FROM line_prefs WHERE line_id=? AND device=?', line, device) ?? [];
    execute(db, 'INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) VALUES (?,?,?,?)', line,
      Object.hasOwn(value, 'project') ? bound(value.project) : project, Object.hasOwn(value, 'signature') ? bound(value.signature) : signature, device);
  }
  for (const [session, project] of Object.entries(patch.tasks ?? {})) {
    execute(db, 'UPDATE task_info SET manual_project=? WHERE session=?', bound(project), session);
  }
}

const startedComet = (db: Db, device: string): Row | undefined =>
  first(db, 'SELECT session,source FROM comets WHERE started IS NOT NULL AND device=?', device);

/**
 * Merge an edit into the device's pending wall edit, then apply the result, or keep it pending while a running comet
 * would move: when it changes the style, the comet's source element or the comet's task. True when it is deferred.
 */
export function requestPatch(db: Db, patch: Patch, config: DeviceConfig): boolean {
  const device = deviceOf(config);
  const previous = pending(db, device) ?? {};
  const previousLines = previous.lines ?? {};
  const patchLines = patch.lines ?? {};
  const lines: Record<string, JsonObject> = {};
  for (const key of Object.keys({...previousLines, ...patchLines})) lines[key] = {...previousLines[key], ...patchLines[key]};
  const merged: Required<Patch> = {settings: {...previous.settings, ...patch.settings}, lines, tasks: {...previous.tasks, ...patch.tasks}};
  let defer = false;
  const comet = startedComet(db, device);
  if (comet !== undefined) {
    const [session = null, source = null] = comet;
    const items = elements(config);
    if (typeof source !== 'number') throw new TypeError('A started comet needs a source element.');
    // Python's list index: a negative source counts from the end.
    const element = items[source < 0 ? items.length + source : source];
    if (element === undefined) throw new RangeError('The comet source is not an element of this device.');
    defer = Object.hasOwn(merged.settings, 'style') || Object.hasOwn(merged.lines, element.id)
      || (typeof session === 'string' && Object.hasOwn(merged.tasks, session));
  }
  if (defer) {
    execute(db, 'INSERT OR REPLACE INTO map_pending (payload,device) VALUES (?,?)', pyJson(merged), device);
  } else {
    applyPatch(db, merged, device);
    execute(db, 'DELETE FROM map_pending WHERE device=?', device);
  }
  return defer;
}

/** Apply the device's pending wall edit once no comet runs on it; true when it was applied. */
export function applyPending(db: Db, device: string = DEFAULT): boolean {
  const change = pending(db, device);
  if (change !== null && Object.keys(change).length > 0 && startedComet(db, device) === undefined) {
    applyPatch(db, change, device);
    execute(db, 'DELETE FROM map_pending WHERE device=?', device);
    return true;
  }
  return false;
}

/**
 * The device's Locate flash: it starts when no comet runs and lasts one second. Free mode, an element no longer on the
 * device and the end of the flash each remove the request.
 */
export function locateState(db: Db, config: DeviceConfig, instant: number, mode: string): Flash | null {
  const device = deviceOf(config);
  if (mode === 'free') {
    execute(db, 'DELETE FROM locate WHERE device=?', device);
    return null;
  }
  const row = first(db, 'SELECT line_id,started FROM locate WHERE device=?', device);
  if (row === undefined) return null;
  const [key = null, saved = null] = row;
  if (saved !== null && instant >= Number(saved) + 1) {
    execute(db, 'DELETE FROM locate WHERE device=?', device);
    return null;
  }
  if (first(db, 'SELECT 1 FROM comets WHERE started IS NOT NULL AND device=?', device) !== undefined) return null;
  const source = elements(config).findIndex(element => element.id === key);
  if (source < 0) {
    execute(db, 'DELETE FROM locate WHERE device=?', device);
    return null;
  }
  let started = saved === null ? null : Number(saved);
  if (started === null) {
    started = instant;
    execute(db, 'UPDATE locate SET started=? WHERE device=?', started, device);
  }
  return {source, started};
}

/** Add the device's map style, coverage, palette and per-element project halves to a worker pass's configuration. */
export function renderConfig(db: Db, config: RenderConfig, snapshot: readonly Indication[]): void {
  const device = deviceOf(config);
  const prefs = owners(db, config);
  const projects = taskProjects(db);
  const colors = new Map(rows(db, 'SELECT id,color FROM projects').map(([id = null, color = null]) => {
    if (typeof color !== 'string') throw new TypeError('A saved project color must be text.');
    return [id, hexRgb(color)] as const;
  }));
  const active = new Map<number, SqlValue>();
  for (const [session = null, slot = null] of rows(db, 'SELECT session,slot FROM slots WHERE device=?', device)) {
    if (typeof slot === 'number' && slot >= 0 && slot < snapshot.length && snapshot[slot] !== null) active.set(slot, projects.get(session) ?? null);
  }
  const {style, coverage} = settings(db, device);
  config._style = style;
  config._coverage = coverage;
  config._palette = paletteRgb(palette(db));
  // Project/status halves are a Lines feature; a triangle always shows its status.
  config._signatures = (config.kind ?? 'lines') === 'lines'
    ? prefs.map(([owner, signature], i) => {
      const project = active.get(i) ?? null;
      return [colors.get(project !== null && project !== '' && project !== 0 ? project : owner) ?? null, signature] as const;
    })
    : [];
}
