// The Nanoleaf migration's verifier for the store and the folder (Hub #933): compares every carried row and file in the
// module's store with the bridge's state, checks that everything else starts fresh, and counts each mismatch by kind. The
// cutover goes ahead only on zero. It opens the module's SQLite file read-only and immutable after the migration has
// closed it, so it changes nothing in the destination either.
import {closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {parseJson, sameValue} from '../compat.js';
import {initialize} from '../database.js';
import {MODULE_TABLES} from '../module/views.js';
import {
  byText, CARRIED, CARRIED_META, CARRIED_TABLES, FRESH_SHARED_INPUT, filesDigest, SCHEMA_META, sha256, storeDigest, type CarriedRows, type CarriedTable,
  type StoreMismatches, type StoreVerification, type TypedRow,
} from './contracts.js';
import {typedColumns, typedRows, type InstalledState} from './installed.js';
import {expectedFiles} from './migrate.js';

/** The module's store as the migration left it: its SQLite file and its private folder. */
export type MigratedStore = {readonly databaseFile: string; readonly folder: string};

/** Each carried table's key columns, by position, so a changed row counts once and a missing or extra one once. */
const KEYS: Readonly<Record<CarriedTable | 'meta', readonly number[]>> = {
  projects: [0], palette: [0], line_prefs: [3, 0], map_settings: [6], map_pending: [2], animation_favorites: [0], meta: [0],
};
/** The tables SQLite keeps for itself, which hold nothing of the migration's. */
const SQLITE_TABLES = new Set(['sqlite_sequence']);
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const uid = (): number | undefined => process.getuid?.();
/** A file or directory that only its owner, the tool's user, may open. */
const owned = (info: {uid: number; mode: number}): boolean => info.uid === uid() && (info.mode & 0o077) === 0;
const errno = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

/** Opens a SQLite file read-only and immutable: SQLite takes no lock and creates no file beside it. */
export function openImmutable(file: string): DatabaseSync {
  const url = pathToFileURL(file);
  url.search = '?mode=ro&immutable=1';
  return new DatabaseSync(url, {readOnly: true, allowExtension: false});
}

/** The `sqlite_master` rows of `db`, without SQLite's own tables. */
function shapeOf(db: DatabaseSync): string {
  return JSON.stringify(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all()
    .filter(row => !SQLITE_TABLES.has(String(row.tbl_name))).map(row => [row.type, row.name, row.tbl_name, row.sql]));
}

let reference: string | undefined;
/** The shape the module's own schema code gives a new store: the port's tables and the module's. */
function referenceShape(): string {
  if (reference !== undefined) return reference;
  const db = new DatabaseSync(':memory:');
  try {
    initialize(db, () => 0);
    db.exec(MODULE_TABLES);
    reference = shapeOf(db);
    return reference;
  } finally {
    db.close();
  }
}

/**
 * Compares the module's store and folder with the bridge's state and reports what differs, counted by kind. It never
 * throws for what it finds: a missing or damaged destination is a mismatch. `source` must have been opened for this check.
 */
export function verifyNanoleafStore(source: InstalledState, store: MigratedStore): StoreVerification {
  const mismatches: StoreMismatches = {
    database: 0, projects: 0, palette: 0, elements: 0, mapSettings: 0, pendingEdits: 0, favorites: 0, deviceState: 0, startFresh: 0, layout: 0, scenes: 0,
    unexpected: 0,
  };
  const rows = readDestination(store.databaseFile, mismatches);
  for (const table of CARRIED_TABLES) mismatches[CARRIED[table].name] += differences(KEYS[table], source.rows[table], rows?.[table]);
  mismatches.deviceState += differences(KEYS.meta, source.rows.meta, rows?.meta);
  const expected = expectedFiles(source);
  const files = compareFiles(expected, store.folder, mismatches);
  mismatches.unexpected += unexpectedEntries(new Set(expected.keys()), store.folder);
  const empty: CarriedRows = {projects: [], palette: [], line_prefs: [], map_settings: [], map_pending: [], animation_favorites: [], meta: []};
  return {counts: source.counts, mismatches, digest: {store: storeDigest(rows ?? empty), files: filesDigest(files)}};
}

/**
 * Reads the carried rows from the module's SQLite file, counting a `database` mismatch for a file that is missing, not a
 * private regular file with one link, has a log or journal with content, is not the module's schema or fails SQLite's
 * check, and a `startFresh` mismatch for each row that should not be there. Returns undefined when the file cannot be
 * read at all.
 */
function readDestination(file: string, mismatches: StoreMismatches): CarriedRows | undefined {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || !owned(info)) mismatches.database += 1;
  } catch {
    mismatches.database += 1;
    return undefined;
  }
  for (const suffix of ['-wal', '-journal']) {
    try {
      if (lstatSync(`${file}${suffix}`).size > 0) mismatches.database += 1;
    } catch (error) {
      if (errno(error) !== 'ENOENT') mismatches.database += 1;
    }
  }
  let db: DatabaseSync;
  try {
    db = openImmutable(file);
  } catch {
    mismatches.database += 1;
    return undefined;
  }
  try {
    try {
      if (shapeOf(db) !== referenceShape() || db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) mismatches.database += 1;
    } catch {
      mismatches.database += 1;
    }
    mismatches.startFresh += startFresh(db);
    const rows = {} as Record<CarriedTable | 'meta', TypedRow[]>;
    for (const table of CARRIED_TABLES) {
      try {
        rows[table] = typedRows(db, `SELECT ${typedColumns(CARRIED[table].columns)} FROM main.${table}`).sort(byText);
      } catch {
        // A table that cannot be read counts every source row as missing.
        rows[table] = [];
      }
    }
    try {
      rows.meta = typedRows(db, `SELECT ${typedColumns(['key', 'value'])} FROM main.meta`).filter(row => deviceState(row)).sort(byText);
    } catch {
      rows.meta = [];
    }
    return rows;
  } finally {
    db.close();
  }
}

/** Whether a destination `meta` row is a device's carried state: a carried name, for any device. */
function deviceState(row: TypedRow): boolean {
  const key = row[0]?.[1];
  if (typeof key !== 'string') return false;
  const at = key.lastIndexOf('@');
  const name = at > 0 ? key.slice(0, at) : key;
  return CARRIED_META.some(carried => carried === name);
}

/**
 * Counts what should not be in the destination: each row of a table that starts fresh, each `meta` value that is neither
 * a device's carried state nor the schema's, and each `shared_input` row other than the fresh one.
 */
function startFresh(db: DatabaseSync): number {
  let count = 0;
  const carried = new Set<string>([...CARRIED_TABLES, 'meta', 'shared_input', ...SQLITE_TABLES]);
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    const table = String(row.name);
    if (carried.has(table)) continue;
    try {
      count += Number(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()?.n);
    } catch {
      count += 1;
    }
  }
  try {
    for (const row of typedRows(db, `SELECT ${typedColumns(['key', 'value'])} FROM main.meta`)) {
      if (deviceState(row)) continue;
      if (row[0]?.[1] === SCHEMA_META.key && sameValue(row[1], ['text', SCHEMA_META.value])) continue;
      count += 1;
    }
  } catch {
    count += 1;
  }
  try {
    const statement = db.prepare('SELECT * FROM main.shared_input');
    statement.setReturnArrays(true);
    const shared = statement.all() as unknown as unknown[][];
    count += shared.length === 0 ? 1 : shared.filter(row => !sameValue(row, [...FRESH_SHARED_INPUT])).length;
  } catch {
    count += 1;
  }
  return count;
}

/** How many rows are missing from, extra in or different in `actual`, matched by their key columns. */
function differences(keys: readonly number[], expected: readonly TypedRow[], actual: readonly TypedRow[] | undefined): number {
  const keyOf = (row: TypedRow): string => JSON.stringify(keys.map(index => row[index]));
  const want = new Map(expected.map(row => [keyOf(row), JSON.stringify(row)]));
  const seen = new Set<string>();
  let count = 0;
  for (const row of actual ?? []) {
    const key = keyOf(row);
    if (seen.has(key) || want.get(key) !== JSON.stringify(row)) count += 1;
    seen.add(key);
  }
  for (const key of want.keys()) if (!seen.has(key)) count += 1;
  return count;
}

/** A copy's bytes, when it is a private regular file with one link of bounded size, read without following a link. */
function readCopy(path: string): Buffer | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || !owned(info) || info.size > MAX_FILE_BYTES) return undefined;
    const buffer = Buffer.alloc(info.size);
    let length = 0;
    while (length < info.size) {
      const count = readSync(descriptor, buffer, length, info.size - length, length);
      if (count === 0) break;
      length += count;
    }
    return buffer.subarray(0, length);
  } catch {
    return undefined;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Compares each expected file with its copy: the copy must be a private regular file with one link whose JSON equals the
 * source's. Returns each readable copy's name and SHA-256.
 */
function compareFiles(expected: ReadonlyMap<string, unknown>, folder: string, mismatches: StoreMismatches): {name: string; sha256: string}[] {
  const found: {name: string; sha256: string}[] = [];
  for (const [name, value] of expected) {
    const bytes = readCopy(join(folder, name));
    let same = false;
    if (bytes !== undefined) {
      found.push({name, sha256: sha256(bytes)});
      try {
        same = sameValue(parseJson(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), value);
      } catch {
        same = false;
      }
    }
    if (!same) {
      if (name === 'layout.json') mismatches.layout += 1;
      else mismatches.scenes += 1;
    }
  }
  return found;
}

/** Counts what the module's folder holds beyond the migrated files, and a folder that is not a private directory. */
function unexpectedEntries(expected: ReadonlySet<string>, folder: string): number {
  try {
    const info = lstatSync(folder);
    if (!info.isDirectory()) return 1;
    return (owned(info) ? 0 : 1) + readdirSync(folder).filter(name => !expected.has(name)).length;
  } catch {
    return 1;
  }
}
