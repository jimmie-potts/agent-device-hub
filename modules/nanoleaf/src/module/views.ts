// What the Nanoleaf module publishes, built from saved state and what its links observed, never from a device read
// (Hub #844): each controller's `device/2.1` record (Hub #975), its wall map view and the Lines' animation options. Building them
// only reads: no row is written, so serving a sync never changes the store. No view holds an address or a credential;
// the device record and the wall view hold no favorite or preset name, which only the animation options list. The saved
// layout, its geometry and the remembered scene are read again only when their file changed, since the views are built
// on the event loop whenever a device request settles.
import {MOMENT_MOODS, MOMENT_DURATION_MS} from '../moments.js';
import {readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import type {Capabilities, CompletedOutcome, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {isObject, parseJson} from '../compat.js';
import {MAX_LAYOUT_BYTES, sceneList} from '../controls.js';
import {DEFAULT, elements, layoutDevices, projection, sceneFile, type DeviceProjection, type Kind} from '../devices.js';
import {DEFAULTS, DIRECTIONS, MAX_BYTES, MAX_COLORS, MAX_FAVORITES, MAX_FRAMES, MAX_NAME, MIN_COLORS, PATTERNS, PRESETS, SPEEDS} from '../effects.js';
import {ValueError} from '../errors.js';
import {favorites} from '../favorites.js';
import {geometry, triangleGeometry, type Point} from '../geometry.js';
import {ANIMATION, journal, type HeldOperation} from '../journal.js';
import {fallbackTitle, owners, palette, pending, settings, taskProjects} from '../project-map.js';
import {evictionToken, presented, selected, state as sharedState, visibleTasks, type SharedCopy} from '../shared-input.js';
import {first, rows, type Db, type SqlValue} from '../sqlite.js';
import {controlState, overrides} from '../store.js';
import {MODES} from '../modes.js';
import type {DeviceLink, Transmission} from './link.js';
import {NANOLEAF_FAMILIES} from './schemas.js';

/**
 * The module's own bookkeeping per device: the configuration revision machine edits guard on, the last outcome, and the
 * last write that reached the device, kept apart from the outcome, since most outcomes send nothing.
 */
export const MODULE_TABLES = `CREATE TABLE IF NOT EXISTS nanoleaf_devices (
    device TEXT PRIMARY KEY, configuration_revision INTEGER NOT NULL DEFAULT 0, last_outcome TEXT) STRICT;
  CREATE TABLE IF NOT EXISTS nanoleaf_transmissions (device TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, request_id TEXT) STRICT;
  CREATE TABLE IF NOT EXISTS nanoleaf_commands (
    id TEXT PRIMARY KEY, device TEXT NOT NULL, family TEXT NOT NULL, traceparent TEXT NOT NULL, expires_ms INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS nanoleaf_machine_edits (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, device TEXT NOT NULL, edit TEXT NOT NULL, revision INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS nanoleaf_module (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`;

/** The device's configuration revision: what a machine edit's `expectedConfigurationRevision` must match. */
export function configurationRevision(db: Db, device: string): number {
  const row = first(db, 'SELECT configuration_revision FROM nanoleaf_devices WHERE device=?', device);
  return typeof row?.[0] === 'number' ? row[0] : 0;
}

/** The store's epoch for the devices' generation tickets, made once and kept. */
export function storeEpoch(db: Db): string {
  const row = first(db, "SELECT value FROM nanoleaf_module WHERE key='epoch'");
  if (typeof row?.[0] !== 'string') throw new TypeError('The module store has no epoch.');
  return row[0];
}

/** One file's parsed contents, kept while the file's identity, size and modification time stay the same. */
const files = new Map<string, {stamp: string; value: unknown}>();

/**
 * `parse` applied to the file's bytes, or `missing` when there is no file. The result is kept until the file changes:
 * the port replaces each file with a rename, which gives it a new inode, and any write moves its nanosecond time.
 */
function cachedFile<T>(path: string, missing: T, parse: (raw: Buffer) => T): T {
  const info = statSync(path, {bigint: true, throwIfNoEntry: false});
  if (info === undefined) {
    files.delete(path);
    return missing;
  }
  const stamp = `${String(info.ino)}:${String(info.size)}:${String(info.mtimeNs)}:${String(info.ctimeNs)}`;
  const kept = files.get(path);
  if (kept?.stamp === stamp) return kept.value as T;
  const value = parse(readFileSync(path));
  files.set(path, {stamp, value});
  return value;
}

/** Every device's saved layout entry, read from `layout.json` once per change of the file; an unreadable file has none. */
function savedLayouts(directory: string): ReadonlyMap<string, DeviceProjection> {
  return cachedFile(join(directory, 'layout.json'), new Map<string, DeviceProjection>(), raw => {
    if (raw.length > MAX_LAYOUT_BYTES) return new Map<string, DeviceProjection>();
    try {
      return new Map([...layoutDevices(parseJson(raw.toString('utf8')))].map(([device, entry]) => [device, {...projection(entry), device}]));
    } catch (error) {
      if (error instanceof ValueError || error instanceof TypeError) return new Map<string, DeviceProjection>();
      throw error;
    }
  });
}

/** The device's saved layout entry, or undefined while none is saved; never a device read. */
export function savedLayout(directory: string, device: string): DeviceProjection | undefined {
  return savedLayouts(directory).get(device);
}

const tagged = <T>(value: T | null | undefined): {status: 'unknown'} | {status: 'known'; value: T} =>
  value === null || value === undefined ? {status: 'unknown'} : {status: 'known', value};

/** What a Nanoleaf controller offers. Bounded moments play on Lines; each device lists its own scenes. */
export function capabilities(db: Db, device: string): Capabilities {
  return {
    power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: [...MODES]},
    moments: device===DEFAULT?{supported:true,moods:[...MOMENT_MOODS],maxDurationMs:MOMENT_DURATION_MS,coversStatus:true}:{supported:false}, media: {supported: false}, scenes: {supported: true, sceneIds: sceneList(db, device).map(scene => scene.id)},
    zones: {supported: false}, preview: {supported: false},
  };
}

/** The accepted commands of the device that have no outcome yet, and their families. */
function pendingCommands(db: Db, device: string): {count: number; kinds: string[]} {
  const families = rows(db, 'SELECT family FROM nanoleaf_commands WHERE device=? ORDER BY rowid', device).map(row => String(row[0]));
  return {count: families.length, kinds: [...new Set(families)]};
}

/**
 * Whether the module presents the device now: its worker runs, and no hold stops its writes. `hold` is the operation a
 * hold after an uncertain write waits on, while one stops them.
 */
export type Presence = {hold: HeldOperation | undefined; workerDown: boolean};

/**
 * The device's availability: `unavailable` while it does not answer; `degraded` while it answers and the module does
 * not present it, because it refuses the module's token, its last pass failed, a hold after an uncertain write stops its
 * writes, which the record's `held` also names, or no worker runs for it; `available` otherwise once it answered; and
 * `unknown` before it has. A held device is never `available`.
 */
export function availabilityOf(db: Db, link: DeviceLink, presence: Presence): DeviceRecord['availability'] {
  if (link.status === 'failing') return 'unavailable';
  if (link.status === 'unknown') return 'unknown';
  const error = controlState(db, link.device).error;
  const passFailed = error !== null && error !== '';
  return link.status === 'refusing' || passFailed || presence.hold !== undefined || presence.workerDown ? 'degraded' : 'available';
}

/** The device's last outcome as saved. */
export function lastOutcome(db: Db, device: string): CompletedOutcome | undefined {
  const saved = first(db, 'SELECT last_outcome FROM nanoleaf_devices WHERE device=?', device)?.[0];
  return typeof saved === 'string' ? (parseJson(saved) as {outcome: CompletedOutcome}).outcome : undefined;
}

export type {Transmission};
/** The last write that reached the device as saved, so a restart keeps it. */
export function savedTransmission(db: Db, device: string): Transmission | undefined {
  const row = first(db, 'SELECT at_ms,request_id FROM nanoleaf_transmissions WHERE device=?', device);
  if (row === undefined) return undefined;
  const requestId = row[1];
  return {atMs: Number(row[0]), ...(typeof requestId === 'string' ? {requestId} : {})};
}

/** The transmission a device record shows, and when the module chose to show it. */
export type ShownTransmission = {transmission: Transmission; chosenAtMs: number};

/**
 * The last transmission a device record shows next. `latest` is the last write that reached the device, the module's
 * own paints included, with the request ID when it served a command, as written or as saved before a restart; nothing
 * else changes it, so an outcome that sent nothing and a poll change nothing. A change that includes a command's write
 * (`commandWritten`: one reached the device since the module last chose) is shown at once; a change from paints alone
 * once `intervalMs` has passed since the module chose what the record shows. `chosen` says whether it chose now.
 */
export function nextTransmission(shown: ShownTransmission | undefined, latest: Transmission | undefined, commandWritten: boolean, nowMs: number,
  intervalMs: number): {transmission: Transmission | undefined; chosen: boolean} {
  if (latest === undefined) return {transmission: undefined, chosen: false};
  const current = shown?.transmission;
  if (current !== undefined && current.atMs === latest.atMs && current.requestId === latest.requestId) return {transmission: current, chosen: false};
  if (!commandWritten && shown !== undefined && nowMs - shown.chosenAtMs < intervalMs) return {transmission: shown.transmission, chosen: false};
  return {transmission: latest, chosen: true};
}

/**
 * The device's `device/2.1` record without its revision, from saved state, what its link observed and the last
 * transmission the module chose to show (the module coalesces its own paints). While a hold after an uncertain write
 * stops the device's writes, `held` names the write's request and when the hold began (Hub #975); the record after
 * the hold's release has none.
 */
export function deviceRecord(db: Db, link: DeviceLink, epoch: string, presence: Presence, transmission: Transmission | undefined): Omit<DeviceRecord, 'revision'> {
  const device = link.device;
  const control = controlState(db, device);
  const desired = overrides(db, device);
  const availability = availabilityOf(db, link, presence);
  const {count, kinds} = pendingCommands(db, device);
  const outcome = lastOutcome(db, device);
  const observation = link.observation;
  return {
    id: device, kind: 'nanoleaf', availability,
    ...(presence.hold === undefined ? {} : {held: {requestId: presence.hold.requestId, heldAtMs: presence.hold.heldAtMs}}),
    configurationRevision: configurationRevision(db, device),
    generation: {epoch, sequence: control.revision}, capabilities: capabilities(db, device),
    desired: {power: tagged(desired.power), brightness: tagged(desired.brightness), mode: {status: 'known', value: control.mode}},
    observed: observation === undefined ? {status: 'unknown'}
      : {status: 'known', observedAtMs: observation.observedAtMs, power: tagged(observation.power), brightness: tagged(observation.brightness)},
    pending: count, pendingKinds: kinds,
    lastOutcome: outcome === undefined ? {status: 'unknown'} : {status: 'known', outcome},
    // The last write that reached the device, the module's own paints included, with the command it served if any.
    lastTransmission: transmission === undefined ? {status: 'unknown'}
      : {status: 'known', transmittedAtMs: transmission.atMs, operationIds: [], ...(transmission.requestId === undefined ? {} : {requestId: transmission.requestId})},
    externalControl: {status: 'unknown'},
  };
}

export type WallTask = {
  id: string; title: string; project: SqlValue; status: string; startedAtMs?: number; element: string | null; manualProject: SqlValue;
  evictionToken?: string; codexUrl?: string; statusEvidence: 'current' | 'uncertain';
};

const text = (value: SqlValue | undefined): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * One device's wall map, as the wall editor shows it (wall_server.App.state, Hub #844): its settings, the shared palette,
 * its mode, its projects, its elements with their reserved projects and the tasks on them, and its visible tasks with
 * their eviction tokens. A task's status evidence is uncertain while the session sync is not current or the core's
 * evidence for it is stale. Only saved geometry is drawn; nothing here reaches the device.
 */
export function wallView(db: Db, copy: SharedCopy, directory: string, device: string, kind: Kind, presence: Presence): Record<string, unknown> {
  const layout = savedLayout(directory, device);
  const config = layout ?? {device, kind, elements: [], line_groups: []};
  const items = elements(config);
  const prefs = owners(db, config);
  const control = controlState(db, device);
  const shared = selected(db);
  const memberships = taskProjects(db);
  const slots = new Map(rows(db, 'SELECT session,slot FROM slots WHERE device=?', device).map(([session = null, slot = null]) => [session, slot]));
  const details = new Map(rows(db, 'SELECT session,title,manual_project,started FROM task_info').map(row => [row[0] ?? null, row]));
  const current = sharedState(db);
  const tokens = new Map<string, string>();
  const codexLinks = new Map<string, string>();
  if (shared && copy.envelope !== null) {
    for (const [key, [root]] of presented(copy.envelope.snapshot)) {
      tokens.set(key, evictionToken(current, root));
      const {provider, client, sessionId} = root.identity;
      // Preserve wall_server.codex_thread_url: only qualified Desktop UUID identity, never a title or arbitrary URL.
      if (provider === 'codex' && client === 'desktop' && /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(sessionId)) {
        codexLinks.set(key, `codex://threads/${sessionId}`);
      }
    }
  }
  const stale = new Set(rows(db, current.connection !== 'current' ? 'SELECT id FROM sessions' : 'SELECT session FROM shared_stale').map(row => row[0] ?? null));
  const tasks = visibleTasks(db, device).map(([id, , status]): WallTask => {
    const [, title = null, manual = null, started = null] = details.get(id) ?? [];
    const slot = slots.get(id);
    const element = typeof slot === 'number' && slot < items.length ? items[slot]?.id ?? null : null;
    const task: WallTask = {id, title: text(title) ?? fallbackTitle('codex', id), project: memberships.get(id) ?? null, status: String(status),
      element, manualProject: text(manual), statusEvidence: !shared || stale.has(id) ? 'uncertain' : 'current'};
    if (typeof started === 'number' && Number.isFinite(started) && started >= 0) task.startedAtMs = Math.round(started * 1000);
    const token = tokens.get(id);
    if (token !== undefined) task.evictionToken = token;
    const codexUrl = codexLinks.get(id);
    if (codexUrl !== undefined) task.codexUrl = codexUrl;
    return task;
  });
  const shapes = layout === undefined ? [] : drawnOnce(layout);
  const map = settings(db, device);
  return {
    id: device, configurationRevision: configurationRevision(db, device), kind, mode: control.mode, modePending: control.revision !== control.applied,
    // Failing while the last pass failed or no worker runs; held while a hold after an uncertain write stops its writes.
    failing: (control.error !== null && control.error !== '') || presence.workerDown, held: presence.hold !== undefined,
    source: shared ? 'shared' : 'paused', layout: layout === undefined ? 'missing' : 'saved',
    settings: {style: map.style, coverage: map.coverage, rotation: map.rotation, flipX: map.flip_x, flipY: map.flip_y}, palette: palette(db),
    pendingEdit: pending(db, device) !== null,
    projects: rows(db, 'SELECT id,name,color FROM projects ORDER BY name COLLATE NOCASE').map(([id = null, name = null, color = null]) => {
      const members = tasks.filter(task => task.project === id);
      return {id, name, color, assigned: prefs.filter(owner => owner[0] === id).length, active: members.length,
        waiting: members.filter(task => task.element === null).length};
    }),
    elements: items.map((element, index) => ({id: element.id, number: element.number, project: prefs[index]?.[0] ?? null,
      signature: prefs[index]?.[1] === 1 ? 1 : 0, task: tasks.find(task => task.element === element.id)?.id ?? null, points: shapes[index] ?? null})),
    tasks,
  };
}

/** Each saved layout's outlines, computed once per parsed layout, which the file cache keeps while the file is unchanged. */
const outlines = new WeakMap<DeviceProjection, (Point[] | null)[]>();
const drawnOnce = (layout: DeviceProjection): (Point[] | null)[] => {
  let shapes = outlines.get(layout);
  if (shapes === undefined) {
    shapes = drawn(layout);
    outlines.set(layout, shapes);
  }
  return shapes;
};

/** Each element's outline from the saved geometry, or none where the saved layout cannot draw every element. */
function drawn(layout: DeviceProjection): (Point[] | null)[] {
  try {
    const shapes = layout.kind === 'lines' ? geometry(layout) : triangleGeometry(layout);
    return shapes.length === layout.elements.length ? shapes.map(shape => shape.points) : [];
  } catch (error) {
    if (error instanceof ValueError || error instanceof TypeError || error instanceof RangeError) return [];
    throw error;
  }
}

/** The remembered scene's opaque ID, or null when the scene file is missing or invalid, or names no listed scene. */
function rememberedSceneId(db: Db, directory: string): string | null {
  let saved: unknown;
  try {
    saved = cachedFile<unknown>(join(directory, sceneFile(DEFAULT)), null, raw => parseJson(raw.toString('utf8').replace(/^\uFEFF/u, '')));
  } catch {
    return null;
  }
  const scene = isObject(saved) ? saved.scene : undefined;
  if (!isObject(scene) || typeof scene.name !== 'string') return null;
  const names = first(db, 'SELECT names FROM control_scenes WHERE device=?', DEFAULT)?.[0];
  if (typeof names !== 'string' || !(parseJson(names) as unknown[]).includes(scene.name)) return null;
  return sceneList(db, DEFAULT).find(entry => entry.name === scene.name)?.id ?? null;
}

/**
 * The Lines' animation options (integration_api.animations): the presets the module advertises, the saved favorites, the
 * patterns, speeds, directions, defaults and bounds, the queued animation, whether the saved layout places spatial
 * patterns, and the remembered scene's ID, read-only and null when unavailable.
 */
export function animationsView(db: Db, directory: string): Record<string, unknown> {
  const layout = savedLayout(directory, DEFAULT);
  const queued = journal(db, DEFAULT, 'AND kind=?', ANIMATION).at(0);
  let saved: {name: string; animation: object}[];
  try {
    saved = favorites(db);
  } catch {
    // More favorites than the bound: none is offered until the owner forgets some.
    saved = [];
  }
  return {
    id: DEFAULT, mode: controlState(db, DEFAULT).mode,
    presets: Object.entries(PRESETS).map(([id, recipe]) => ({id, ...recipe, colors: [...recipe.colors]})),
    favorites: saved, patterns: Object.entries(PATTERNS).map(([id, spatial]) => ({id, spatial})), speeds: Object.keys(SPEEDS),
    directions: [...DIRECTIONS], defaults: {...DEFAULTS},
    limits: {minColors: MIN_COLORS, maxColors: MAX_COLORS, maxFramesPerZone: MAX_FRAMES, maxEffectBytes: MAX_BYTES, maxFavorites: MAX_FAVORITES,
      maxFavoriteName: MAX_NAME},
    queuedAnimation: queued === undefined ? null : {requestId: queued.id},
    positionsSaved: layout !== undefined && layout.kind === 'lines' && layout.elements.every(element => element.position !== null),
    rememberedSceneId: rememberedSceneId(db, directory),
  };
}

/** The state messages' types and schemas, by family. */
export const STATE_TYPES = {
  device: {type: 'org.bunny.device.updated', dataschema: 'https://bunny.invalid/events/device/2.1'},
  [NANOLEAF_FAMILIES.wall.family]: {type: NANOLEAF_FAMILIES.wall.type, dataschema: 'https://bunny.invalid/events/nanoleaf-wall/2.0'},
  [NANOLEAF_FAMILIES.animations.family]: {type: NANOLEAF_FAMILIES.animations.type, dataschema: 'https://bunny.invalid/events/nanoleaf-animations/2.0'},
} as const;
