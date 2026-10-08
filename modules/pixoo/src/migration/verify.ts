// The Pixoo library migration's verifier (Hub #931): compares every carried row and every original's and rendition's
// SHA-256 in the module's store with the installed library, and counts each mismatch by kind. The cutover goes ahead only
// on zero. It opens the module's SQLite file read-only and immutable after the migration has closed it, so it changes
// nothing in the destination either.
import {constants} from 'node:fs';
import {lstat, open, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {CALLER_TABLES} from '../library/library.js';
import {APPLICATION_ID, MIGRATIONS, one} from '../library/migrations.js';
import {
  CARRIED_TABLES, LEFT_IN_BACKUP, MIGRATION_SCHEMA, MigrationError, catalogDigest, filesDigest, sha256, type CatalogRows, type Mismatches, type Row,
  type VerificationReport,
} from './contracts.js';
import {openImmutable, readRows, referenceShape, shapeOf, sound, type InstalledLibrary, type MediaFile} from './installed.js';

/** The module's library as the migration left it: its SQLite file and its private folder. */
export type MigratedStore = {readonly databaseFile: string; readonly folder: string};

const errno = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
const uid = (): number | undefined => process.getuid?.();
/** A file or directory that only its owner, the tool's user, may open. */
const owned = (info: {uid: number; mode: number}): boolean => info.uid === uid() && (info.mode & 0o077) === 0;

/**
 * Compares the module's store with the installed library and reports what differs, counted by kind. It checks the store
 * as the migration left it, before the runtime's first start: the start writes the module's own tables. It never throws
 * for what it finds: a missing or damaged destination is a mismatch. It throws `MigrationError` `interrupted` once
 * `signal` aborts, between files. `source` must have been opened for this check.
 */
export async function verifyMigration(source: InstalledLibrary, store: MigratedStore, {signal}: {signal?: AbortSignal} = {}): Promise<VerificationReport> {
  const mismatches: Omit<Mismatches, 'total'> = {database: 0, assets: 0, renditions: 0, playlists: 0, items: 0, leftInBackup: 0, files: 0, unexpected: 0};
  const rows = await readDestination(store.databaseFile, mismatches);
  for (const table of CARRIED_TABLES) mismatches[table] += differences(source.rows[table], rows?.[table]);
  const files = await compareFiles(source, store.folder, mismatches, signal);
  mismatches.unexpected += await unexpectedEntries(source.files, store.folder);
  const total = Object.values(mismatches).reduce((sum, count) => sum + count, 0);
  return {
    schema: MIGRATION_SCHEMA, operation: 'verify', result: total === 0 ? 'verified' : 'mismatch', counts: source.counts,
    mismatches: {total, ...mismatches}, largeGifOriginals: source.largeGifOriginals,
    digest: {catalog: catalogDigest({assets: rows?.assets ?? [], renditions: rows?.renditions ?? [], playlists: rows?.playlists ?? [], items: rows?.items ?? []}), files: filesDigest(files)},
  };
}

/**
 * Reads the carried rows from the module's SQLite file, counting a `database` mismatch for a file that is missing, not
 * private, unclean, not at the library's current schema with exactly its tables beside the module's own, at a catalog
 * revision other than the migration's 0, or failing SQLite's checks, and a `leftInBackup` mismatch for each row in a
 * table that starts fresh: the library's sessions, checkpoint and cleanups, and the module's and the SDK's own tables.
 * Returns undefined when the file cannot be read at all.
 */
async function readDestination(file: string, mismatches: Omit<Mismatches, 'total'>): Promise<Partial<CatalogRows> | undefined> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1 || !owned(info)) mismatches.database += 1;
  } catch {
    mismatches.database += 1;
    return undefined;
  }
  for (const suffix of ['-wal', '-journal']) {
    try {
      if ((await lstat(`${file}${suffix}`)).size > 0) mismatches.database += 1;
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
    if (!current(db)) mismatches.database += 1;
    try {
      if (one(db, 'SELECT revision FROM catalog_revision WHERE slot = 1').revision !== 0) mismatches.database += 1;
    } catch {
      mismatches.database += 1;
    }
    const own = db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name').all().map(row => String(row.name)).filter(name => CALLER_TABLES.test(name));
    for (const table of [...LEFT_IN_BACKUP, ...own]) {
      try {
        mismatches.leftInBackup += Number(one(db, `SELECT count(*) AS n FROM "${table}"`).n);
      } catch {
        mismatches.leftInBackup += 1;
      }
    }
    const rows: Partial<CatalogRows> = {};
    for (const table of CARRIED_TABLES) {
      try {
        rows[table] = readRows(db, table);
      } catch {
        // A table that cannot be read counts every source row as missing.
      }
    }
    return rows;
  } finally {
    db.close();
  }
}

/** Whether the database is the library's current schema, with exactly its tables beside the module's, and sound. */
function current(db: DatabaseSync): boolean {
  try {
    const checksums = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all().map(row => [row.version, row.checksum]);
    return one(db, 'PRAGMA application_id').application_id === APPLICATION_ID && one(db, 'PRAGMA user_version').user_version === MIGRATIONS.length &&
      JSON.stringify(checksums) === JSON.stringify(MIGRATIONS.map(migration => [migration.version, sha256(migration.sql)])) &&
      shapeOf(db, CALLER_TABLES) === referenceShape(MIGRATIONS.length) && sound(db);
  } catch {
    return false;
  }
}

/** How many rows are missing from, extra in or different in `actual`, matched by ID. */
function differences(expected: readonly Row[], actual: readonly Row[] | undefined): number {
  if (actual === undefined) return expected.length;
  const want = new Map(expected.map(row => [String(row[0]), JSON.stringify(row)]));
  const have = new Map(actual.map(row => [String(row[0]), JSON.stringify(row)]));
  let count = 0;
  for (const [id, row] of want) if (have.get(id) !== row) count += 1;
  for (const id of have.keys()) if (!want.has(id)) count += 1;
  return count;
}

/**
 * Compares each file the source catalog names with its copy: the copy must be a private regular file with one link and
 * the same SHA-256 as the source file, which must still match its catalog. Returns each copy's path and SHA-256.
 */
async function compareFiles(source: InstalledLibrary, folder: string, mismatches: Omit<Mismatches, 'total'>, signal: AbortSignal | undefined): Promise<{path: string; sha256: string}[]> {
  const found: {path: string; sha256: string}[] = [];
  for (const file of source.files) {
    if (signal?.aborted === true) throw new MigrationError('interrupted');
    const copy = await readCopy(join(folder, 'media', file.path), file.limit);
    if (copy !== undefined) found.push({path: `media/${file.path}`, sha256: copy});
    let original: string | undefined;
    try {
      original = sha256(await source.read(file));
    } catch {
      original = undefined;
    }
    if (copy === undefined || original === undefined || copy !== original || (file.sha256 !== undefined && original !== file.sha256)) mismatches.files += 1;
  }
  return found;
}

/** The SHA-256 of a copy that is a private regular file with one link, read without following a link, or undefined. */
async function readCopy(path: string, limit: number): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || !owned(info) || info.size > limit) return undefined;
    return sha256(await handle.readFile());
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * Counts what the module's folder holds beyond the migrated files: any other file, link or directory, a file in
 * `media/staging/`, and a directory that is not private to its owner.
 */
async function unexpectedEntries(files: readonly MediaFile[], folder: string): Promise<number> {
  const expected = new Set(files.map(file => `media/${file.path}`));
  const directories = new Set(['', 'media', 'media/originals', 'media/renditions', 'media/staging']);
  for (const file of expected) directories.add(file.slice(0, file.lastIndexOf('/')));
  let count = 0;
  const walk = async (relative: string): Promise<void> => {
    const info = await lstat(join(folder, relative));
    if (!info.isDirectory() || !owned(info)) count += 1;
    if (!info.isDirectory()) return;
    for (const entry of await readdir(join(folder, relative), {withFileTypes: true})) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory() && directories.has(path)) await walk(path);
      else if (!(entry.isFile() && expected.has(path))) count += 1;
    }
  };
  try {
    await walk('');
  } catch {
    count += 1;
  }
  return count;
}


