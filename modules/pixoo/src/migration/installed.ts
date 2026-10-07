// The Pixoo service's library as its installed release keeps it (Hub #931): `catalog.sqlite`, `owner.sqlite` and `media/`
// in the directory the service names `<PIXOO_DATA_DIR>/library`, at schema version 3. The migration reads it and never
// changes it:
// - The catalog opens read-only and immutable, so SQLite creates no log or index file beside it. A plain read-only open
//   of a WAL catalog would leave `-wal` and `-shm` files behind.
// - The owner lock opens read-only in its rollback journal mode, which writes nothing, and keeps a shared lock until
//   `close`. The Pixoo service holds that file's exclusive lock while it runs, so a running service is refused, and a
//   service started meanwhile fails to open the library instead of changing it.
// - Every media file opens read-only without following a link, and every directory on its way is checked to be a real
//   directory.
import {constants} from 'node:fs';
import {lstat, open} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {DatabaseSync, type SQLOutputValue} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {APPLICATION_ID, MIGRATIONS, migrate, one} from '../library/migrations.js';
import {DEFAULT_LIMITS} from '../media/contracts.js';
import {
  CARRIED, INSTALLED_LIBRARY, INTEGER_COLUMNS, MigrationError, type CarriedTable, type CatalogRows, type LeftInBackup,
  type MigrationCounts, type Row,
} from './contracts.js';

const HASH = /^[a-f0-9]{64}$/;
/** The largest manifest the media store reads, as `MediaStore` bounds it. */
const MANIFEST_BYTES = 1024 * 1024;
/** A frame's raw RGB, 64 x 64 x 3 bytes, and the largest preview PNG the media store reads. */
const RGB_BYTES = 12_288;
const PREVIEW_BYTES = 65_536;
/** The most frames a rendition may have: every profile's `maxFrames` is at most this. */
const MAX_FRAMES = 1000;

/** One file the catalog names, relative to `media/`, with the SHA-256 the catalog expects when it names one. */
export type MediaFile = {readonly path: string; readonly size: number; readonly limit: number; readonly sha256?: string};

const errno = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
const sqliteCode = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const corrupt = (cause?: unknown): MigrationError => new MigrationError('source-corrupt', {cause});

/** The `sqlite_master` rows of `db`, without the tables (and their indexes and triggers) that `ignore` matches. */
export function shapeOf(db: DatabaseSync, ignore?: RegExp): string {
  return JSON.stringify(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all()
    .filter(row => ignore === undefined || !ignore.test(String(row.tbl_name)))
    .map(row => [row.type, row.name, row.tbl_name, row.sql]));
}

/** The shape the library's own migrations up to `version` give a new database. */
export function referenceShape(version: number): string {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, MIGRATIONS.slice(0, version));
    return shapeOf(db);
  } finally {
    db.close();
  }
}

/** Opens a SQLite file read-only and immutable: SQLite takes no lock and creates no file beside it. */
export function openImmutable(file: string): DatabaseSync {
  const url = pathToFileURL(file);
  url.search = '?mode=ro&immutable=1';
  return new DatabaseSync(url, {readOnly: true, allowExtension: false});
}

/** Whether `db` passes SQLite's integrity and foreign key checks. */
export function sound(db: DatabaseSync): boolean {
  return db.prepare('PRAGMA integrity_check').all().every(row => row.integrity_check === 'ok') && db.prepare('PRAGMA foreign_key_check').all().length === 0;
}

/** Reads a carried table's rows in ID order, or throws when a value is not its column's type. */
export function readRows(db: DatabaseSync, table: CarriedTable): Row[] {
  const columns = CARRIED[table];
  return db.prepare(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY id`).all().map(record => columns.map(column => {
    const value: SQLOutputValue | undefined = record[column];
    if (INTEGER_COLUMNS.has(column) ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === 'string') return value as string | number;
    throw new TypeError('column type');
  }));
}

/** A file's size when it is a regular file of at most `limit` bytes, never followed through a link. */
async function regular(path: string, limit: number): Promise<number> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    throw corrupt(error);
  }
  if (!info.isFile() || info.size > limit) throw corrupt();
  return info.size;
}

async function directory(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    throw corrupt(error);
  }
  if (!info.isDirectory()) throw corrupt();
}

/** Whether a file exists, never followed through a link. Throws for anything but a missing file. */
async function present(path: string): Promise<{size: number; file: boolean} | undefined> {
  try {
    const info = await lstat(path);
    return {size: info.size, file: info.isFile()};
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/** Reads a file the catalog names, whole, without following a link: a regular file of at most its limit. */
export async function readFileOnce(path: string, limit: number): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw corrupt(error);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw corrupt();
    // One byte more than the limit shows a file that grew after the check.
    const buffer = Buffer.alloc(Math.min(limit, info.size) + 1);
    let length = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > info.size) throw corrupt();
    }
    return buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw corrupt(error);
  } finally {
    await handle.close();
  }
}

type Manifest = {id: string; sourceHash: string; frames: {rgbHash: string; previewHash: string}[]};

/** The parts of a stored manifest that name files, or throws when it cannot name them safely. */
function manifestOf(text: string, id: string, sourceHash: string): Manifest {
  const value = JSON.parse(text) as unknown;
  if (typeof value !== 'object' || value === null || !('id' in value) || !('sourceHash' in value) || !('frames' in value)) throw corrupt();
  const {frames} = value;
  if (value.id !== id || value.sourceHash !== sourceHash || !Array.isArray(frames) || frames.length === 0 || frames.length > MAX_FRAMES) throw corrupt();
  return {id, sourceHash, frames: frames.map((frame: unknown, index) => {
    if (typeof frame !== 'object' || frame === null || !('index' in frame) || !('rgbHash' in frame) || !('previewHash' in frame) || frame.index !== index ||
      typeof frame.rgbHash !== 'string' || !HASH.test(frame.rgbHash) || typeof frame.previewHash !== 'string' || !HASH.test(frame.previewHash)) throw corrupt();
    return {rgbHash: frame.rgbHash, previewHash: frame.previewHash};
  })};
}

/** Whether an asset's stored source is a GIF whose logical screen the module no longer renders (Hub #843). */
function largeGif(text: string): boolean {
  const value = JSON.parse(text) as unknown;
  if (typeof value !== 'object' || value === null || !('format' in value) || !('width' in value) || !('height' in value)) throw corrupt();
  const {format, width, height} = value;
  if (typeof width !== 'number' || typeof height !== 'number') throw corrupt();
  return format === 'gif' && width * height > DEFAULT_LIMITS.maxGifCanvasPixels;
}

/**
 * The installed library, open for reading until `close`: its carried rows, the files they name with their sizes and
 * expected hashes, and what stays in the backup. `open` refuses, with a `MigrationError`, a directory without a catalog
 * (`source-missing`), a library the Pixoo service holds (`source-in-use`), a catalog with a log or journal that holds
 * commits (`source-not-clean`), another schema than the installed release's version 3 or tables that differ from it
 * (`source-schema`), and a catalog that fails SQLite's checks or names a file that is missing, too large or not a
 * regular file (`source-corrupt`).
 */
export class InstalledLibrary {
  readonly rows: CatalogRows;
  readonly files: readonly MediaFile[];
  readonly counts: MigrationCounts;
  readonly leftInBackup: LeftInBackup;
  readonly largeGifOriginals: number;
  /** The catalog file's size: an upper bound on what the carried rows take. */
  readonly catalogBytes: number;
  readonly #media: string;
  #owner: DatabaseSync | undefined;

  private constructor(fields: {
    rows: CatalogRows; files: MediaFile[]; leftInBackup: LeftInBackup; largeGifOriginals: number; catalogBytes: number; media: string; owner: DatabaseSync | undefined;
  }) {
    this.rows = fields.rows;
    this.files = fields.files;
    this.leftInBackup = fields.leftInBackup;
    this.largeGifOriginals = fields.largeGifOriginals;
    this.catalogBytes = fields.catalogBytes;
    this.#media = fields.media;
    this.#owner = fields.owner;
    this.counts = {
      assets: fields.rows.assets.length, renditions: fields.rows.renditions.length, playlists: fields.rows.playlists.length, items: fields.rows.items.length,
      originals: fields.files.filter(file => file.path.startsWith('originals/')).length, renditionFiles: fields.files.filter(file => file.path.startsWith('renditions/')).length,
      bytes: fields.files.reduce((total, file) => total + file.size, 0),
    };
  }

  static async open(directoryPath: string): Promise<InstalledLibrary> {
    if (!isAbsolute(directoryPath)) throw new MigrationError('source-missing');
    const catalogFile = join(directoryPath, 'catalog.sqlite');
    const catalog = await present(catalogFile).catch((error: unknown) => { throw corrupt(error); });
    if (catalog === undefined) throw new MigrationError('source-missing');
    if (!catalog.file) throw corrupt();
    const owner = await holdOwner(join(directoryPath, 'owner.sqlite'));
    try {
      for (const suffix of ['-wal', '-journal']) {
        const log = await present(`${catalogFile}${suffix}`).catch((error: unknown) => { throw corrupt(error); });
        if (log !== undefined && (!log.file || log.size > 0)) throw new MigrationError('source-not-clean');
      }
      let db: DatabaseSync;
      try {
        db = openImmutable(catalogFile);
      } catch (error) {
        throw corrupt(error);
      }
      try {
        checkSchema(db);
        const read = readCatalog(db);
        const media = join(directoryPath, 'media');
        const files = await listFiles(media, read.rows);
        return new InstalledLibrary({...read, files, catalogBytes: catalog.size, media, owner});
      } finally {
        db.close();
      }
    } catch (error) {
      release(owner);
      throw error;
    }
  }

  /** Reads one file the catalog names, whole, as `MediaFile` describes it. */
  read(file: MediaFile): Promise<Buffer> {
    return readFileOnce(join(this.#media, file.path), file.limit);
  }

  /** Lets go of the Pixoo service's owner lock. */
  close(): void {
    release(this.#owner);
    this.#owner = undefined;
  }
}

/**
 * Takes a shared lock on the library's owner file, which the Pixoo service holds exclusively while it runs. The file
 * keeps a rollback journal, so a read-only connection writes nothing beside it; a file in any other mode is not opened.
 * A missing owner file has no holder.
 */
async function holdOwner(file: string): Promise<DatabaseSync | undefined> {
  const info = await present(file).catch((error: unknown) => { throw corrupt(error); });
  if (info === undefined) return undefined;
  if (!info.file) throw corrupt();
  if (info.size > 0) {
    // Bytes 18 and 19 of a SQLite file are its write and read versions: 1 for a rollback journal, 2 for WAL.
    const header = await headerOf(file);
    if (header.length < 100 || header[18] !== 1 || header[19] !== 1) throw corrupt();
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, {readOnly: true, timeout: 0, allowExtension: false});
    db.exec('BEGIN');
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    return db;
  } catch (error) {
    db?.close();
    const code = sqliteCode(error);
    if (code === SQLITE_BUSY || code === SQLITE_LOCKED) throw new MigrationError('source-in-use', {cause: error});
    throw corrupt(error);
  }
}

/** The first 100 bytes of a file, read without following a link. */
async function headerOf(file: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw corrupt(error);
  }
  try {
    const buffer = Buffer.alloc(100);
    const {bytesRead} = await handle.read(buffer, 0, 100, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function release(owner: DatabaseSync | undefined): void {
  if (owner === undefined) return;
  try {
    if (owner.isTransaction) owner.exec('ROLLBACK');
  } finally {
    owner.close();
  }
}

/** Refuses any schema but the installed release's version 3 with exactly its tables. */
function checkSchema(db: DatabaseSync): void {
  let migrations: Record<string, SQLOutputValue>[];
  try {
    if (one(db, 'PRAGMA application_id').application_id !== APPLICATION_ID || one(db, 'PRAGMA user_version').user_version !== INSTALLED_LIBRARY.version) {
      throw new MigrationError('source-schema');
    }
    migrations = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('source-schema', {cause: error});
  }
  const expected = INSTALLED_LIBRARY.checksums.map((checksum, index) => ({version: index + 1, checksum}));
  if (JSON.stringify(migrations.map(row => ({version: row.version, checksum: row.checksum}))) !== JSON.stringify(expected)) throw new MigrationError('source-schema');
  if (shapeOf(db) !== referenceShape(INSTALLED_LIBRARY.version)) throw new MigrationError('source-schema');
  if (!sound(db)) throw corrupt();
}

function readCatalog(db: DatabaseSync): {rows: CatalogRows; leftInBackup: LeftInBackup; largeGifOriginals: number} {
  try {
    const rows: CatalogRows = {assets: readRows(db, 'assets'), renditions: readRows(db, 'renditions'), playlists: readRows(db, 'playlists'), items: readRows(db, 'items')};
    const count = (table: string): number => Number(one(db, `SELECT count(*) AS n FROM ${table}`).n);
    return {
      rows, leftInBackup: {sessions: count('sessions'), checkpoints: count('playback_checkpoint'), cleanupJobs: count('cleanup_jobs')},
      largeGifOriginals: rows.assets.filter(asset => largeGif(String(asset[3]))).length,
    };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw corrupt(error);
  }
}

/**
 * Every file the catalog names, with its size: each asset's original under its content hash, and each rendition's
 * manifest and frames. A name is used as a path only once it is a SHA-256 hex digest or a frame index, so no row can
 * name a file outside `media/`.
 */
async function listFiles(media: string, rows: CatalogRows): Promise<MediaFile[]> {
  const hashes = new Map<string, string>();
  for (const [id, contentHash] of rows.assets) {
    if (typeof contentHash !== 'string' || !HASH.test(contentHash)) throw corrupt();
    hashes.set(String(id), contentHash);
  }
  for (const path of ['', 'originals', 'renditions']) await directory(join(media, path));
  const files: MediaFile[] = [];
  for (const contentHash of hashes.values()) {
    const path = `originals/${contentHash}`;
    files.push({path, size: await regular(join(media, path), DEFAULT_LIMITS.maxUploadBytes), limit: DEFAULT_LIMITS.maxUploadBytes, sha256: contentHash});
  }
  for (const [id, assetId, manifestJson] of rows.renditions) {
    const sourceHash = hashes.get(String(assetId));
    if (typeof id !== 'string' || !HASH.test(id) || sourceHash === undefined) throw corrupt();
    let manifest: Manifest;
    try {
      manifest = manifestOf(String(manifestJson), id, sourceHash);
    } catch (error) {
      throw corrupt(error);
    }
    await directory(join(media, 'renditions', id));
    const add = async (name: string, limit: number, expected?: string): Promise<void> => {
      const path = `renditions/${id}/${name}`;
      files.push({path, size: await regular(join(media, path), limit), limit, ...(expected === undefined ? {} : {sha256: expected})});
    };
    await add('manifest.json', MANIFEST_BYTES);
    for (const [index, frame] of manifest.frames.entries()) {
      await add(`${index}.rgb`, RGB_BYTES, frame.rgbHash);
      await add(`${index}.png`, PREVIEW_BYTES, frame.previewHash);
    }
  }
  return files;
}

