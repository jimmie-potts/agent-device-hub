// The Pixoo library migration's command-line tool (Hub #931). The installer (#935) runs it offline at the cutover (#840),
// outside the runtime, because a long copy inside a module's start would trip the runtime's lag limit (#880):
//
//   node apps/runtime/dist/src/migrate-pixoo.js migrate --library <dir> --state-dir <dir> [--min-free-bytes <bytes>]
//   node apps/runtime/dist/src/migrate-pixoo.js verify --library <dir> --state-dir <dir>
//
// `--library` is the Pixoo service's library directory, `<PIXOO_DATA_DIR>/library`, which it only reads. `--state-dir` is
// the runtime's state directory: `migrate` writes the Pixoo module's SQLite file and private folder there, as the runtime
// creates them (#919), and `verify` compares them with the library. Each prints one JSON line (`pixoo-migration/1.0`)
// with counts, codes and SHA-256 digests only, never a path, name or file content, and exits with one of `EXIT`.
import {lstat, readdir, rm, statfs} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {InstalledLibrary, MIGRATION_SCHEMA, MigrationError, migrateLibrary, verifyMigration} from '@jimmie-potts/pixoo';
import {fullDisk} from '@jimmie-potts/sdk';
import {holdRuntimeLease, type RuntimeLease} from './lease.js';
import {RuntimeError, openModuleDatabase, openModuleFolder, prepareStateDirectory} from './state.js';

export const PIXOO_MIGRATION_USAGE = 'usage: migrate-pixoo.js migrate --library <dir> --state-dir <dir> [--min-free-bytes <bytes>] | ' +
  'migrate-pixoo.js verify --library <dir> --state-dir <dir>; both directories absolute';

/**
 * Exit codes: `ok` migrated, or verified with zero mismatches; `mismatch` the verifier found one or more; `usage` the
 * arguments are malformed; `refused` the tool refused before writing anything to the module's files; `failed` it stopped
 * after it began to write, and removed what it wrote unless the line says `"destination": "left"`.
 */
export const EXIT = {ok: 0, mismatch: 1, usage: 2, refused: 3, failed: 4} as const;

/** The space `migrate` leaves free beyond what it writes, unless `--min-free-bytes` says otherwise: 256 MiB. */
export const DEFAULT_MIN_FREE_BYTES = 256 * 1024 * 1024;

const MODULE = 'pixoo';

export type PixooMigrationOptions = {
  /** Writes one line of output, with its newline. */
  write: (line: string) => void;
  /** The bytes an unprivileged user may still write on the file system that holds `dir`, and its block size. Tests replace it. */
  freeSpace?: (dir: string) => Promise<{freeBytes: number; blockSize: number}>;
  /**
   * Stops the tool, as the entry point's SIGINT or SIGTERM does: before it writes, it refuses `interrupted`; while it
   * writes, it stops every copy, removes what it wrote and fails `interrupted`; while it verifies, it refuses.
   */
  signal?: AbortSignal;
  /**
   * Closes the module's database once the migration is written. Tests replace it to leave a log behind, as a close does
   * when its checkpoint cannot finish.
   */
  close?: (database: DatabaseSync) => void;
};

/**
 * The space `migrate` needs on a file system with `blockSize`-byte blocks: each file it copies and each folder it makes
 * in whole blocks, and the source catalog's size twice, an upper bound on the carried rows in the database and in its
 * log at the last checkpoint, plus the space to keep free.
 */
export function spaceNeeded(source: InstalledLibrary, blockSize: number, minFreeBytes: number): number {
  const blocks = (bytes: number): number => Math.ceil(bytes / blockSize) * blockSize;
  // The module's folder, `media/`, `originals/`, `renditions/` and one folder per rendition.
  const folders = 4 + source.counts.renditions;
  return source.files.reduce((total, file) => total + blocks(file.size), 0) + folders * blockSize + 2 * blocks(source.catalogBytes) + minFreeBytes;
}

type Operation = 'migrate' | 'verify';
type Input = {operation: Operation; library: string; stateDir: string; minFreeBytes: number};

/** The tool's own refusals, with fixed text. A `MigrationError` carries its own fixed text. */
const TEXT: Readonly<Record<string, string>> = {
  usage: PIXOO_MIGRATION_USAGE,
  'runtime-running': 'A runtime holds the state directory: stop it first.',
  'lease-unavailable': 'The runtime\'s lease file in the state directory is not a regular file private to this user.',
  'disk-short': 'The state directory\'s file system has too little free space for the library and the space to keep free.',
  'destination-not-empty': 'The Pixoo module already has files in the state directory: migrate into a fresh one, or remove modules/pixoo.sqlite, modules/pixoo.sqlite-wal, modules/pixoo.sqlite-shm, modules/pixoo.sqlite-journal and modules/pixoo/.',
  'destination-missing': 'The state directory holds no Pixoo module database to verify.',
  'module-db-not-private': 'The Pixoo module\'s database file is not a private regular file with one link.',
  'module-folder-not-private': 'The Pixoo module\'s folder, or the modules folder, is not a private directory.',
  'destination-not-clean': 'The Pixoo module\'s database kept a log after the tool closed it, so the migration is discarded.',
  interrupted: 'The migration was interrupted.',
  internal: 'The tool failed unexpectedly.',
};
const STATE_DIR = 'The state directory is refused: it must be absolute, private, outside every Git checkout and off /mnt, with no link along it.';

class Refusal extends Error {
  override readonly name = 'Refusal';
  constructor(readonly code: string) {
    super(TEXT[code] ?? STATE_DIR);
  }
}

const errno = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
const FILLED = new MigrationError('disk-short').message;

/**
 * A refusal's code and fixed text: never an exception's own text, which may hold a path. A full disk, from SQLite or the
 * file system, is `disk-short` wherever it was wrapped.
 */
function refusalOf(error: unknown): {code: string; message: string} {
  if (error instanceof MigrationError) return {code: error.code, message: error.message};
  if (error instanceof Refusal) return {code: error.code, message: error.message};
  if (fullDisk(error)) return {code: 'disk-short', message: FILLED};
  if (error instanceof RuntimeError) return {code: error.code, message: TEXT[error.code] ?? STATE_DIR};
  return {code: 'internal', message: TEXT.internal ?? ''};
}

function parse(argv: readonly string[]): Input | undefined {
  const [operation, ...rest] = argv;
  if (operation !== 'migrate' && operation !== 'verify') return undefined;
  let values: {library?: string; 'state-dir'?: string; 'min-free-bytes'?: string};
  try {
    ({values} = parseArgs({args: rest, strict: true, allowPositionals: false, options: {
      library: {type: 'string'}, 'state-dir': {type: 'string'}, 'min-free-bytes': {type: 'string'},
    }}));
  } catch {
    return undefined;
  }
  const {library, 'state-dir': stateDir, 'min-free-bytes': minFree} = values;
  if (library === undefined || stateDir === undefined || !isAbsolute(library) || !isAbsolute(stateDir)) return undefined;
  if (minFree !== undefined && (operation === 'verify' || !/^\d{1,16}$/.test(minFree) || !Number.isSafeInteger(Number(minFree)))) return undefined;
  return {operation, library: resolve(library), stateDir: resolve(stateDir), minFreeBytes: minFree === undefined ? DEFAULT_MIN_FREE_BYTES : Number(minFree)};
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errno(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Whether a directory is a real one, owned by the tool's user, that no one else may open. */
const privateDirectory = (info: {uid: number; mode: number; isDirectory: () => boolean}): boolean =>
  info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0;

/**
 * Refuses, before anything is written, a module that already has a database, log or journal, or a folder that holds
 * anything (`destination-not-empty`), and a `modules` folder or module folder that is a link or that others may open
 * (`module-folder-not-private`), as the runtime's `openModuleFolder` would once the database exists.
 */
async function checkFresh(stateDir: string, database: string, folder: string): Promise<void> {
  const modules = join(stateDir, 'modules');
  if (!await exists(modules)) return;
  if (!privateDirectory(await lstat(modules))) throw new Refusal('module-folder-not-private');
  for (const suffix of ['', '-wal', '-shm', '-journal']) if (await exists(`${database}${suffix}`)) throw new Refusal('destination-not-empty');
  if (!await exists(folder)) return;
  if (!privateDirectory(await lstat(folder))) throw new Refusal('module-folder-not-private');
  if ((await readdir(folder)).length > 0) throw new Refusal('destination-not-empty');
}

/** The nearest part of `path` that exists: the directory a new state directory would be made in. */
async function nearestExisting(path: string): Promise<string> {
  for (let current = path; ; current = dirname(current)) {
    if (await exists(current) || current === dirname(current)) return current;
  }
}

/**
 * Takes the runtime's lease when its lock file is there. A runtime creates the file at its first start and never removes
 * it, so without one no runtime has run on the directory, and nothing is created to find that out.
 */
async function leaseIfPresent(stateDir: string): Promise<RuntimeLease | undefined> {
  return await exists(join(stateDir, 'modules', 'core.sqlite-owner')) ? holdRuntimeLease(stateDir) : undefined;
}

async function freeSpaceOf(dir: string): Promise<{freeBytes: number; blockSize: number}> {
  const stats = await statfs(dir);
  return {freeBytes: stats.bavail * stats.bsize, blockSize: stats.bsize};
}

/** Removes what `migrate` wrote: the module's database with its log and journal, and its folder. */
async function discard(database: string, folder: string): Promise<boolean> {
  const removals = [...['', '-wal', '-shm', '-journal'].map(suffix => rm(`${database}${suffix}`, {force: true})), rm(folder, {recursive: true, force: true})];
  return (await Promise.allSettled(removals)).every(result => result.status === 'fulfilled');
}

/**
 * Runs `migrate` or `verify` as `argv` says, writing one JSON line through `options.write`, and returns the exit code.
 * Both hold the Pixoo service's owner lock and the runtime's lease for as long as they run. A refusal creates nothing:
 * the source library and the state directory are checked before anything is made. `migrate` refuses a source library
 * `InstalledLibrary` refuses, a running runtime, a module that already has files or whose folders others may open, and
 * less free space than `spaceNeeded`; then it creates the state directory and the lease file when they are missing, as
 * the runtime would, and writes. If it fails, or `options.signal` aborts, once it has begun to write, it removes the
 * module's database, log, journal and folder, once nothing is still writing them. `verify` never creates anything.
 */
export async function runPixooMigration(argv: readonly string[], options: PixooMigrationOptions): Promise<number> {
  const emit = (record: object): void => { options.write(`${JSON.stringify({schema: MIGRATION_SCHEMA, ...record})}\n`); };
  const input = parse(argv);
  if (input === undefined) {
    emit({operation: argv[0] === 'migrate' || argv[0] === 'verify' ? argv[0] : 'none', result: 'refused', code: 'usage', message: PIXOO_MIGRATION_USAGE});
    return EXIT.usage;
  }
  const {operation} = input;
  const {signal} = options;
  const stop = (): void => { if (signal?.aborted === true) throw new Refusal('interrupted'); };
  let lease: RuntimeLease | undefined;
  let source: InstalledLibrary | undefined;
  try {
    stop();
    source = await InstalledLibrary.open(input.library);
    stop();
    const existing = await exists(input.stateDir);
    if (operation === 'verify' && !existing) throw new Refusal('destination-missing');
    let stateDir = existing ? await prepareStateDirectory(input.stateDir) : input.stateDir;
    const database = join(stateDir, 'modules', `${MODULE}.sqlite`);
    const folder = join(stateDir, 'modules', MODULE);
    if (existing) lease = await leaseIfPresent(stateDir);
    if (operation === 'verify') {
      if (!await exists(database)) throw new Refusal('destination-missing');
      const report = await verifyMigration(source, {databaseFile: database, folder}, signal === undefined ? {} : {signal});
      emit(report);
      return report.result === 'verified' ? EXIT.ok : EXIT.mismatch;
    }
    if (existing) await checkFresh(stateDir, database, folder);
    const {freeBytes, blockSize} = await (options.freeSpace ?? freeSpaceOf)(await nearestExisting(stateDir));
    if (freeBytes < spaceNeeded(source, blockSize, input.minFreeBytes)) throw new Refusal('disk-short');
    stop();
    // Every check has passed: create what the runtime would, take the lease, and check the module's files again under it.
    stateDir = await prepareStateDirectory(stateDir);
    lease ??= await holdRuntimeLease(stateDir);
    await checkFresh(stateDir, database, folder);
    return await migrateInto(source, stateDir, database, folder, emit, options);
  } catch (error) {
    emit({operation, result: 'refused', ...refusalOf(error)});
    return EXIT.refused;
  } finally {
    source?.close();
    lease?.release();
  }
}

const closeDatabase = (database: DatabaseSync): void => { database.close(); };

/** Bytes in a file, or 0 when there is none. */
async function sizeOf(path: string): Promise<number> {
  try {
    return (await lstat(path)).size;
  } catch (error) {
    if (errno(error) === 'ENOENT') return 0;
    throw error;
  }
}

/**
 * Writes the module's database and folder from `source`, or removes them again if that fails. The migration returns or
 * throws only once every copy has finished, so nothing writes them after the removal.
 */
async function migrateInto(
  source: InstalledLibrary, stateDir: string, database: string, folder: string, emit: (record: object) => void, options: PixooMigrationOptions,
): Promise<number> {
  let db: DatabaseSync | undefined;
  try {
    db = openModuleDatabase(stateDir, MODULE);
    const report = await migrateLibrary(source, {database: db, folder: openModuleFolder(stateDir, MODULE)}, options.signal === undefined ? {} : {signal: options.signal});
    // Fold the log into the file before closing: a checkpoint that cannot finish, as on a full disk, throws here, where
    // a close would keep the log and report nothing. A file that never took WAL mode answers with no log at all.
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint !== undefined && checkpoint.busy !== 0) throw new Refusal('destination-not-clean');
    (options.close ?? closeDatabase)(db);
    db = undefined;
    // Whatever the close did, the file must stand alone: a log or journal left with content holds commits it lacks.
    for (const suffix of ['-wal', '-journal']) if (await sizeOf(`${database}${suffix}`) > 0) throw new Refusal('destination-not-clean');
    emit(report);
    return EXIT.ok;
  } catch (error) {
    try {
      db?.close();
    } catch {
      // The file is removed next either way.
    }
    const removed = await discard(database, folder);
    const {code, message} = refusalOf(error);
    emit({operation: 'migrate', result: 'failed', code, message, destination: removed ? 'removed' : 'left'});
    return EXIT.failed;
  }
}
