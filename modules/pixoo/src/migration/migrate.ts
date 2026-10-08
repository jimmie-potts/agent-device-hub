// Copies the installed library into the Pixoo module's own store (Hub #931): its catalog and playlists into the module's
// SQLite file, and every original and rendition file into its private folder. The rows go in through SQLite at the
// installed schema, which the library's own migrations create; then the library's own forward migration takes the
// destination to its current schema, and its own check reads every copy back against the SHA-256 its catalog gives:
// each original against its content hash, each frame against its manifest, and each manifest against its row.
import {constants} from 'node:fs';
import {mkdir, open} from 'node:fs/promises';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {Library, LibraryError} from '../library/index.js';
import {MIGRATIONS, migrate, transaction} from '../library/migrations.js';
import {MediaError} from '../media/contracts.js';
import {
  CARRIED, CARRIED_TABLES, INSTALLED_LIBRARY, MIGRATION_SCHEMA, MigrationError, catalogDigest, filesDigest, fullDisk, sha256, type MigrationReport,
} from './contracts.js';
import type {InstalledLibrary, MediaFile} from './installed.js';

/** Where the module keeps its library: its own SQLite database, open, and its private folder (Hub #919). */
export type Destination = {readonly database: DatabaseSync; readonly folder: string};

/** How many files are copied at once, so the file system can group their syncs. */
const COPIES = 8;

/**
 * Migrates `source` into `destination`, which must be the module's fresh database and an empty private folder: the
 * caller checks both and holds the runtime's lease. Throws a `MigrationError`: `source-corrupt` when the library's own
 * check refuses the migrated catalog, as when a file's bytes do not match the hash the catalog gives it; `disk-short`
 * when the file system or the database fills up at any step; `interrupted` once `signal` aborts. When it throws, no copy
 * is still under way, so the caller can discard the destination. `signal` stops the copy between files; a step already
 * under way, such as the library's own check, finishes first.
 */
export async function migrateLibrary(source: InstalledLibrary, destination: Destination, {signal}: {signal?: AbortSignal} = {}): Promise<MigrationReport> {
  try {
    return await write(source, destination, signal);
  } catch (error) {
    if (error instanceof MigrationError && error.code === 'interrupted') throw error;
    // A full disk fails whichever step meets it: the installed schema, the rows, a copy or the forward migration. The
    // library's migrations and checks keep the error they wrap as its cause.
    if (fullDisk(error)) throw new MigrationError('disk-short', {cause: error});
    throw error;
  }
}

async function write(source: InstalledLibrary, {database, folder}: Destination, signal: AbortSignal | undefined): Promise<MigrationReport> {
  const stop = (): void => { if (signal?.aborted === true) throw new MigrationError('interrupted'); };
  stop();
  // The installed schema, created by the library's own migrations, so its forward migration below accepts it.
  migrate(database, MIGRATIONS.slice(0, INSTALLED_LIBRARY.version));
  transaction(database, () => {
    for (const table of CARRIED_TABLES) {
      const columns = CARRIED[table];
      const insert = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of source.rows[table]) insert.run(...row);
    }
  });
  stop();

  const media = join(folder, 'media');
  const directories = [media, join(media, 'originals'), join(media, 'renditions'),
    ...new Set(source.files.filter(file => file.path.startsWith('renditions/')).map(file => join(media, file.path, '..')))];
  for (const directory of directories) await mkdir(directory, {mode: 0o700});
  const copied = await copyAll(source, media, signal);
  for (const directory of [folder, ...directories]) await syncDirectory(directory);
  stop();

  // The library's own forward migration, from the installed version 3 to the module's current schema, and its own check
  // of every catalog entry against its manifest, frames and original.
  let listed: string[];
  try {
    const library = await Library.attach({database, directory: folder});
    try {
      listed = await library.verifyStorage();
    } finally {
      await library.close();
    }
  } catch (error) {
    if (error instanceof LibraryError || error instanceof MediaError) throw new MigrationError('source-corrupt', {cause: error});
    throw error;
  }
  stop();
  const expected = source.files.map(file => `media/${file.path}`).sort();
  if (JSON.stringify(listed) !== JSON.stringify(expected)) throw new MigrationError('source-corrupt');

  return {
    schema: MIGRATION_SCHEMA, operation: 'migrate', result: 'migrated', counts: source.counts, leftInBackup: source.leftInBackup,
    largeGifOriginals: source.largeGifOriginals, digest: {catalog: catalogDigest(source.rows), files: filesDigest(copied)},
  };
}

/**
 * Copies every file, a few at a time, and returns each one's path in the folder and SHA-256. The first failure, or an
 * abort of `signal`, stops every copy from taking another file, and this returns or throws only once every copy under
 * way has finished, so nothing is written after it.
 */
async function copyAll(source: InstalledLibrary, media: string, signal: AbortSignal | undefined): Promise<{path: string; sha256: string}[]> {
  let next = 0;
  let failure: {error: unknown} | undefined;
  const copied: {path: string; sha256: string}[] = [];
  const worker = async (): Promise<void> => {
    while (failure === undefined && signal?.aborted !== true) {
      const file = source.files[next++];
      if (file === undefined) return;
      try {
        copied.push(await copyOne(source, media, file));
      } catch (error) {
        failure ??= {error};
      }
    }
  };
  await Promise.allSettled(Array.from({length: COPIES}, worker));
  if (failure !== undefined) throw failure.error;
  if (signal?.aborted === true) throw new MigrationError('interrupted');
  return copied;
}

/**
 * Copies one file: reads it whole from the source, writes it to a new file private to its owner, which must not exist
 * and is never reached through a link, and syncs it. The library's own check then reads every copy back against the
 * hashes its catalog gives.
 */
async function copyOne(source: InstalledLibrary, media: string, file: MediaFile): Promise<{path: string; sha256: string}> {
  const bytes = await source.read(file);
  const handle = await open(join(media, file.path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {path: `media/${file.path}`, sha256: sha256(bytes)};
}

/** Syncs a directory, so the names of the files created in it survive a crash. */
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
