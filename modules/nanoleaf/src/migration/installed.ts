// The Nanoleaf bridge's state as its installed release keeps it (Hub #933): `status.sqlite`, `config.json` (the device
// registry with each device's token), `layout.json` and a scene file per device, in the bridge's private state directory.
// The migration reads it and never changes it:
// - `status.sqlite` opens read-only. The bridge never used WAL, so its rollback journal makes a read-only connection
//   write nothing; a journal left by a crash, which only a writer could roll back, is refused instead. The migration
//   holds a read transaction on it from the start, so no bridge process can commit while it reads, and every read sees
//   one state. The copy attaches the file immutable to the destination's connection, which that lock keeps stable.
// - The bridge's lock files open read-only in a read transaction, kept until `close`: each device's worker holds its
//   lock file exclusively while it runs, and enrollment its registry lock, so a running worker or enrollment is
//   refused, and a worker that a hook launches meanwhile fails to take its lock instead of changing the state.
// - Every JSON file opens read-only without following a link, as a regular file of bounded size.
// - A lock is a POSIX lock, which closing any descriptor of its file that this process opened drops. So the lock files
//   and `status.sqlite` open only through SQLite, which keeps its own descriptors open while a lock is held, except for
//   one plain read of `status.sqlite`'s header before any lock on it is taken; and one process opens a source once at a
//   time, so that read never closes a descriptor of a file whose lock another reader in the process holds.
import {closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {isObject, parseJson, withoutBom, type Json, type JsonObject} from '../compat.js';
import {DEFAULT, layoutDevices, lockFile, metaKey, registry, sceneFile, type Kind, type LayoutEntry} from '../devices.js';
import {ValueError} from '../errors.js';
import {validSceneState} from '../scenes.js';
import {
  byText, CARRIED, CARRIED_META, CARRIED_TABLES, INSTALLED_STATE, MigrationError, type CarriedRows, type CarriedTable, type LeftInBackup,
  type MigrationCounts, type TypedRow, type TypedValue,
} from './contracts.js';

const STATUS = 'status.sqlite';
const CONFIG = 'config.json';
const LAYOUT = 'layout.json';
/** The bridge's registry and layout locks, which enrollment and layout discovery hold while they write. */
const SHARED_LOCKS = ['registry-lock.sqlite', 'layout-lock.sqlite'];
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_LAYOUT_BYTES = 4 * 1024 * 1024;
const MAX_SCENE_BYTES = 64 * 1024;
/** A routing ID (ADR 0012), which the runtime's configuration requires of every device. */
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SQLITE_BUSY = 5;
const SQLITE_READONLY = 8;
const SQLITE_HEADER = 'SQLite format 3\0';

/** The tables whose rows follow live sessions, which start fresh (owner decision 10). */
const TASK_TABLES = ['task_info', 'activity', 'waits', 'receipts', 'shared_stale', 'shared_suppressed_waves', 'shared_evictions', 'shared_ack'] as const;
const LEDGER_TABLES = ['controller_meta', 'controller_requests', 'controller_events', 'controller_credentials'] as const;
const INTEGRATION_TABLES = ['integration_meta', 'integration_requests'] as const;

/** The source directories this process has open, by real path: a second opener of one is refused while it is. */
const opened = new Set<string>();

/** One registered device as the bridge's registry names it. Its token stays in the source's memory. */
export type SourceDevice = {readonly id: string; readonly kind: Kind; readonly address: string | null; readonly tokenRef: string};

const sqliteCode = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;
const errno = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
const refuse = (code: ConstructorParameters<typeof MigrationError>[0], cause?: unknown): MigrationError =>
  new MigrationError(code, cause === undefined ? undefined : {cause});

/** A file's bytes, read once without following a link, or undefined when there is none; anything but a regular file of at most `limit` bytes is refused. */
function readBounded(path: string, limit: number): Buffer | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw refuse('source-corrupt', error);
  }
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > limit) throw refuse('source-corrupt');
    // One byte more than the limit shows a file that grew after the check.
    const buffer = Buffer.alloc(Math.min(limit, info.size) + 1);
    let length = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
      if (length > info.size) throw refuse('source-corrupt');
    }
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

/** A JSON file the bridge wrote, decoded as Python's utf-8-sig reads it, or undefined when there is none. */
function readJsonFile(path: string, limit: number): unknown {
  const bytes = readBounded(path, limit);
  if (bytes === undefined) return undefined;
  try {
    return parseJson(withoutBom(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));
  } catch (error) {
    throw refuse('source-corrupt', error);
  }
}

/** Opens a SQLite file read-only, through a URI so that SQLite's own read-only mode applies, and takes a shared lock on it. */
function readLocked(path: string): DatabaseSync {
  const url = pathToFileURL(path);
  url.search = '?mode=ro';
  const db = new DatabaseSync(url, {readOnly: true, allowExtension: false});
  try {
    db.exec('BEGIN');
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** A lock file's shared lock, or undefined when the bridge never made the file. */
function lockShared(path: string): DatabaseSync | undefined {
  try {
    lstatSync(path);
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw refuse('source-corrupt', error);
  }
  try {
    return readLocked(path);
  } catch (error) {
    throw refuse(sqliteCode(error) === SQLITE_BUSY ? 'source-in-use' : 'source-corrupt', error);
  }
}

/** The status database's first 100 bytes: SQLite's own header, in rollback journal mode. */
function checkHeader(path: string): void {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (errno(error) === 'ENOENT') throw refuse('source-missing', error);
    throw refuse('source-corrupt', error);
  }
  try {
    if (!fstatSync(descriptor).isFile()) throw refuse('source-corrupt');
    const header = Buffer.alloc(100);
    const count = readSync(descriptor, header, 0, 100, 0);
    if (count < 100 || header.toString('latin1', 0, 16) !== SQLITE_HEADER) throw refuse('source-schema');
    // Bytes 18 and 19 are 1 in rollback journal mode and 2 in WAL mode, which the bridge never used.
    if (header[18] !== 1 || header[19] !== 1) throw refuse('source-schema');
  } finally {
    closeSync(descriptor);
  }
}

type Shape = {columns: string[]} | undefined;

function shapeOf(db: DatabaseSync, table: string): Shape {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) === undefined) return undefined;
  return {columns: db.prepare(`PRAGMA table_info("${table}")`).all().map(row => String(row.name))};
}

function countOf(db: DatabaseSync, table: string): number {
  if (shapeOf(db, table) === undefined) return 0;
  return Number(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()?.n);
}

/** One value read as `typeof(column), column`, with its storage class. */
function typed(type: unknown, value: unknown): TypedValue {
  switch (type) {
    case 'null': return ['null', null];
    case 'integer':
      if (typeof value === 'number' && Number.isSafeInteger(value)) return ['integer', value];
      break;
    case 'real':
      if (typeof value === 'number') return ['real', value];
      break;
    case 'text':
      if (typeof value === 'string') return ['text', value];
      break;
    case 'blob':
      if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('hex')];
      break;
    default:
      break;
  }
  throw refuse('source-corrupt');
}

/** Reads `SELECT typeof(a), a, typeof(b), b ...` rows as typed rows. */
export function typedRows(db: DatabaseSync, sql: string, ...params: string[]): TypedRow[] {
  const statement = db.prepare(sql);
  statement.setReturnArrays(true);
  return (statement.all(...params) as unknown as unknown[][]).map(row => {
    const values: TypedValue[] = [];
    for (let index = 0; index < row.length; index += 2) values.push(typed(row[index], row[index + 1]));
    return values;
  });
}

/** `typeof(a), a, ...` for the given column expressions. */
export const typedColumns = (expressions: readonly string[]): string => expressions.map(expression => `typeof(${expression}), ${expression}`).join(', ');

/**
 * The bridge's state directory, open for reading until `close`: its registered devices, the carried rows, layout entries
 * and scene files of those devices, the shared-input configuration, and what stays in the backup. `open` refuses, with a
 * `MigrationError`, a directory without `status.sqlite` or `config.json` (`source-missing`), a bridge process that holds
 * the state (`source-in-use`), a journal to roll back (`source-not-clean`), a database that is not model version 4 in
 * rollback journal mode or whose carried tables differ from the installed release's (`source-schema`), damaged files
 * (`source-corrupt`), a malformed registry (`source-config`) and a registered device ID that is not a routing ID
 * (`source-device-id`).
 */
export class InstalledState {
  readonly directory: string;
  readonly devices: readonly SourceDevice[];
  readonly rows: CarriedRows;
  /** Each registered device's layout entry, in the registry's order, when the bridge saved one. */
  readonly layouts: ReadonlyMap<string, LayoutEntry>;
  /** Each registered device's parsed scene file, when it has one. */
  readonly scenes: ReadonlyMap<string, Json>;
  /** The shared-input configuration as `status.sqlite` holds it, parsed, or null when shared input was never configured. */
  readonly sharedConfig: unknown;
  /** `config.json`, parsed, with every device's token. It never leaves the migration. */
  readonly #config: JsonObject;
  readonly leftInBackup: LeftInBackup;
  readonly counts: MigrationCounts;
  /** Whether `line_prefs`, `map_settings` and `map_pending` carry each row's device, as the installed release's do. */
  readonly #deviceKeyed: boolean;
  readonly #shapes: ReadonlyMap<string, Shape>;
  #guards: DatabaseSync[];
  /** This source's entry in `opened`, removed at `close`. */
  #key = '';

  private constructor(fields: {
    directory: string; devices: SourceDevice[]; rows: CarriedRows; layouts: Map<string, LayoutEntry>; scenes: Map<string, Json>; sharedConfig: unknown;
    config: JsonObject; leftInBackup: LeftInBackup; deviceKeyed: boolean; shapes: Map<string, Shape>; guards: DatabaseSync[];
  }) {
    this.directory = fields.directory;
    this.devices = fields.devices;
    this.rows = fields.rows;
    this.layouts = fields.layouts;
    this.scenes = fields.scenes;
    this.sharedConfig = fields.sharedConfig;
    this.#config = fields.config;
    this.leftInBackup = fields.leftInBackup;
    this.#deviceKeyed = fields.deviceKeyed;
    this.#shapes = fields.shapes;
    this.#guards = fields.guards;
    this.counts = {
      devices: fields.devices.length, projects: fields.rows.projects.length, palette: fields.rows.palette.length, elements: fields.rows.line_prefs.length,
      mapSettings: fields.rows.map_settings.length, pendingEdits: fields.rows.map_pending.length, favorites: fields.rows.animation_favorites.length,
      deviceState: fields.rows.meta.length, layouts: fields.layouts.size, scenes: fields.scenes.size,
    };
  }

  /**
   * Opens the bridge's state directory `directory`, an absolute path, and holds its locks until `close`. A second open
   * of the same directory in this process is refused with `source-in-use` while this one is open.
   */
  static open(directory: string): InstalledState {
    let key: string;
    try {
      key = realpathSync(directory);
    } catch {
      key = resolve(directory);
    }
    // A second reader in this process would read the header of a file whose locks the first one holds.
    if (opened.has(key)) throw refuse('source-in-use');
    opened.add(key);
    const guards: DatabaseSync[] = [];
    try {
      const state = InstalledState.#read(directory, guards);
      state.#key = key;
      return state;
    } catch (error) {
      for (const guard of guards) guard.close();
      opened.delete(key);
      throw error;
    }
  }

  static #read(directory: string, guards: DatabaseSync[]): InstalledState {
    try {
      // The directory may be reached through a link, as the bridge's own resolution allowed; its files may not.
      if (!statSync(directory).isDirectory()) throw refuse('source-missing');
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      throw refuse('source-missing', error);
    }
    const status = join(directory, STATUS);
    checkHeader(status);
    // The registry lock first, so enrollment cannot change config.json while it is read.
    for (const name of SHARED_LOCKS) {
      const guard = lockShared(join(directory, name));
      if (guard !== undefined) guards.push(guard);
    }
    const config = readJsonFile(join(directory, CONFIG), MAX_CONFIG_BYTES);
    if (config === undefined) throw refuse('source-missing');
    if (!isObject(config)) throw refuse('source-config');
    let entries;
    try {
      entries = registry(config);
    } catch (error) {
      if (error instanceof ValueError) throw refuse('source-config', error);
      throw error;
    }
    const devices: SourceDevice[] = [...entries].map(([id, entry]) => ({id, kind: entry.kind, address: entry.ip, tokenRef: entry.token_ref}));
    if (devices.some(device => device.id.length > 128 || !ROUTING_ID.test(device.id))) throw refuse('source-device-id');
    for (const device of devices) {
      const guard = lockShared(join(directory, lockFile(device.id)));
      if (guard !== undefined) guards.push(guard);
    }

    let db: DatabaseSync;
    try {
      db = readLocked(status);
    } catch (error) {
      const code = sqliteCode(error);
      throw refuse(code === SQLITE_BUSY ? 'source-in-use' : code === SQLITE_READONLY ? 'source-not-clean' : 'source-corrupt', error);
    }
    guards.push(db);
    try {
      if (db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw refuse('source-corrupt');
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      throw refuse('source-corrupt', error);
    }
    const ids = devices.map(device => device.id);
    const shapes = InstalledState.#checkShapes(db);
    const deviceKeyed = shapes.get('line_prefs')?.columns.includes('device') === true;
    const rows = InstalledState.#carriedRows(db, shapes, deviceKeyed, ids);
    const shared = db.prepare('SELECT config, backup FROM shared_input WHERE id=1').get();
    let sharedConfig: unknown = null;
    if (shared !== undefined && shared.config !== null) {
      if (typeof shared.config !== 'string') throw refuse('source-corrupt');
      try {
        sharedConfig = parseJson(shared.config);
      } catch (error) {
        throw refuse('source-corrupt', error);
      }
    }
    const legacyBackup = shared !== undefined && shared.backup !== null && shared.backup !== '' ? 1 : 0;
    const bindings = isObject(sharedConfig) ? bindingCount(sharedConfig.bindings) : 0;

    const layouts = new Map<string, LayoutEntry>();
    let unregisteredLayouts = 0;
    const saved = readJsonFile(join(directory, LAYOUT), MAX_LAYOUT_BYTES);
    if (saved !== undefined) {
      let known: Map<string, LayoutEntry>;
      try {
        known = layoutDevices(saved);
      } catch (error) {
        if (error instanceof ValueError) throw refuse('source-corrupt', error);
        throw error;
      }
      for (const id of ids) {
        const entry = known.get(id);
        if (entry !== undefined) layouts.set(id, entry);
      }
      unregisteredLayouts = [...known.keys()].filter(id => !ids.includes(id)).length;
    }
    const scenes = new Map<string, Json>();
    for (const id of ids) {
      const scene = readJsonFile(join(directory, sceneFile(id)), MAX_SCENE_BYTES);
      if (scene === undefined) continue;
      if (!validSceneState(scene)) throw refuse('source-corrupt');
      scenes.set(id, scene as Json);
    }
    const sceneNames = new Set(ids.map(id => sceneFile(id)));
    const unregisteredScenes = readdirSync(directory).filter(name => /^scene-state\..+\.json$/.test(name) && !sceneNames.has(name)).length;

    const leftInBackup: LeftInBackup = {
      sessions: countOf(db, 'sessions'),
      taskRows: TASK_TABLES.reduce((sum, table) => sum + countOf(db, table), 0),
      reservations: countOf(db, 'slots'), comets: countOf(db, 'comets'), locates: countOf(db, 'locate'), displayCaches: countOf(db, 'display_v3'),
      controllerLedger: LEDGER_TABLES.reduce((sum, table) => sum + countOf(db, table), 0),
      integrationRequests: INTEGRATION_TABLES.reduce((sum, table) => sum + countOf(db, table), 0),
      legacyBackup, bindings,
      otherMeta: 0,
      unregistered: unregisteredLayouts + unregisteredScenes,
    };
    InstalledState.#countLeftOver(db, shapes, deviceKeyed, ids, leftInBackup);
    return new InstalledState({directory, devices, rows, layouts, scenes, sharedConfig, config, leftInBackup, deviceKeyed, shapes, guards});
  }

  /**
   * The shapes of the tables the migration reads: model version 4, the carried tables with exactly their columns (a
   * pre-change table without `device`), `device` on all of them or none, and `shared_input`.
   */
  static #checkShapes(db: DatabaseSync): Map<string, Shape> {
    const shapes = new Map<string, Shape>();
    const meta = shapeOf(db, 'meta');
    if (meta === undefined || !['key', 'value'].every(column => meta.columns.includes(column)) || meta.columns.length !== 2) throw refuse('source-schema');
    if (db.prepare("SELECT value FROM meta WHERE key='model_version'").get()?.value !== INSTALLED_STATE.modelVersion) throw refuse('source-schema');
    for (const table of CARRIED_TABLES) {
      const {columns, device, optional} = CARRIED[table];
      const shape = shapeOf(db, table);
      shapes.set(table, shape);
      if (shape === undefined) {
        if (!optional) throw refuse('source-schema');
        continue;
      }
      const expected: readonly string[] = columns;
      const same = (want: readonly string[]): boolean => want.length === shape.columns.length && want.every((column, index) => shape.columns[index] === column);
      // A carried table with another column would lose it, so it is refused; a pre-change table lacks only `device`.
      if (!same(expected) && !(device && same(expected.filter(column => column !== 'device')))) throw refuse('source-schema');
    }
    // Every device-scoped table carries the device, or none does: the bridge's migration adds it to all in one transaction.
    const deviceTables = CARRIED_TABLES.filter(table => CARRIED[table].device && shapes.get(table) !== undefined);
    const withDevice = deviceTables.filter(table => shapes.get(table)?.columns.includes('device') === true).length;
    if (withDevice !== 0 && withDevice !== deviceTables.length) throw refuse('source-schema');
    const shared = shapeOf(db, 'shared_input');
    if (shared === undefined || !['id', 'config', 'backup'].every(column => shared.columns.includes(column))) throw refuse('source-schema');
    return shapes;
  }

  /** The carried rows of the registered devices, typed, in text order. */
  static #carriedRows(db: DatabaseSync, shapes: Map<string, Shape>, deviceKeyed: boolean, ids: readonly string[]): CarriedRows {
    const rows = {} as Record<CarriedTable | 'meta', TypedRow[]>;
    const list = JSON.stringify(ids);
    for (const table of CARRIED_TABLES) {
      if (shapes.get(table) === undefined) {
        rows[table] = [];
        continue;
      }
      const select = carriedSelect('main', table, deviceKeyed, true);
      rows[table] = CARRIED[table].device && deviceKeyed ? typedRows(db, select, list) : typedRows(db, select);
    }
    rows.meta = typedRows(db, `SELECT ${typedColumns(['key', 'value'])} FROM main.meta WHERE key IN (SELECT value FROM json_each(?))`,
      JSON.stringify(carriedMetaKeys(ids)));
    for (const table of [...CARRIED_TABLES, 'meta' as const]) rows[table].sort(byText);
    return rows;
  }

  /** Counts the `meta` values that start fresh, and the rows and `meta` values of devices the registry no longer names. */
  static #countLeftOver(db: DatabaseSync, shapes: Map<string, Shape>, deviceKeyed: boolean, ids: readonly string[], left: LeftInBackup): void {
    const list = JSON.stringify(ids);
    if (deviceKeyed) {
      for (const table of CARRIED_TABLES) {
        if (!CARRIED[table].device || shapes.get(table) === undefined) continue;
        left.unregistered += Number(db.prepare(`SELECT count(*) AS n FROM main.${table} WHERE device NOT IN (SELECT value FROM json_each(?))`).get(list)?.n);
      }
    }
    const carried = new Set(carriedMetaKeys(ids));
    for (const row of db.prepare('SELECT key FROM main.meta').all()) {
      const key = String(row.key);
      if (carried.has(key) || key === 'model_version') continue;
      const at = key.lastIndexOf('@');
      if (at > 0 && !ids.includes(key.slice(at + 1))) left.unregistered += 1;
      else left.otherMeta += 1;
    }
  }

  /** The device's token from `config.json`, or null when the registry's reference names none. Never report it. */
  token(device: SourceDevice): string | null {
    const value = this.#config[device.tokenRef];
    return typeof value === 'string' ? value : null;
  }

  /** A string setting of `config.json`, such as `metadata_path`, or undefined when it is absent or empty. */
  setting(name: string): Json | undefined {
    const value = this.#config[name];
    return value === null || value === '' ? undefined : value;
  }

  /**
   * Attaches `status.sqlite` to `db`, the destination's connection, as `old`, read-only and immutable: the read
   * transaction this source holds keeps the file from changing, so SQLite needs no lock of its own on it. Returns the
   * detach.
   */
  attach(db: DatabaseSync): () => void {
    if (this.#guards.length === 0) throw new TypeError('the source is closed');
    const url = pathToFileURL(join(this.directory, STATUS));
    url.search = '?mode=ro&immutable=1';
    db.prepare('ATTACH DATABASE ? AS old').run(url.href);
    return () => { db.exec('DETACH DATABASE old'); };
  }

  /** The `INSERT ... SELECT` that copies one carried table from the attached source into `main`, with its parameters. */
  copyStatement(table: CarriedTable, ids: readonly string[]): {sql: string; params: string[]} | undefined {
    if (this.#shapes.get(table) === undefined) return undefined;
    const {columns, device} = CARRIED[table];
    const sql = `INSERT INTO main.${table} (${columns.join(', ')}) ${carriedSelect('old', table, this.#deviceKeyed, false)}`;
    return {sql, params: device && this.#deviceKeyed ? [JSON.stringify(ids)] : []};
  }

  /** Releases every lock this source holds and closes its connections. */
  close(): void {
    const guards = this.#guards;
    this.#guards = [];
    for (const guard of guards) guard.close();
    if (guards.length > 0) opened.delete(this.#key);
  }
}

/** Every carried `meta` key of the registered devices. */
export function carriedMetaKeys(ids: readonly string[]): string[] {
  return ids.flatMap(id => CARRIED_META.map(name => metaKey(name, id)));
}

/**
 * The SELECT of one carried table's rows of the registered devices from `schema`: typed (`typeof(a), a, ...`) for a
 * comparison, or plain for the copy. A pre-change table without `device` gives every row to the Lines.
 */
function carriedSelect(schema: string, table: CarriedTable, deviceKeyed: boolean, typedOutput: boolean): string {
  const {columns, device} = CARRIED[table];
  const expressions = columns.map(column => column === 'device' && !deviceKeyed ? `'${DEFAULT}'` : column);
  const list = typedOutput ? typedColumns(expressions) : expressions.join(', ');
  const filter = device && deviceKeyed ? ' WHERE device IN (SELECT value FROM json_each(?))' : '';
  return `SELECT ${list} FROM ${schema}.${table}${filter}`;
}

/** How many entries a shared-input configuration's `bindings` held: an array's items or an object's keys. */
function bindingCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isObject(value)) return Object.keys(value).length;
  return value === undefined || value === null ? 0 : 1;
}
