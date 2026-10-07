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
import {isAbsolute, join, resolve} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {InstalledLibrary, MIGRATION_SCHEMA, MigrationError, migrateLibrary, verifyMigration} from '@jimmie-potts/pixoo';
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
  /** The bytes an unprivileged user may still write on the file system that holds `dir`. Tests replace it. */
  freeBytes?: (dir: string) => Promise<number>;
};

type Operation = 'migrate' | 'verify';
type Input = {operation: Operation; library: string; stateDir: string; minFreeBytes: number};

/** The tool's own refusals, with fixed text. A `MigrationError` carries its own fixed text. */
const TEXT: Readonly<Record<string, string>> = {
  usage: PIXOO_MIGRATION_USAGE,
  'runtime-running': 'A runtime holds the state directory: stop it first.',
  'lease-unavailable': 'The runtime\'s lease file in the state directory is not a regular file private to this user.',
  'disk-short': 'The state directory\'s file system has too little free space for the library and the space to keep free.',
  'destination-not-empty': 'The Pixoo module already has a database or files in the state directory: migrate into a fresh one.',
  'destination-missing': 'The state directory holds no Pixoo module database to verify.',
  'module-db-not-private': 'The Pixoo module\'s database file is not a private regular file with one link.',
  'module-folder-not-private': 'The Pixoo module\'s folder, or the modules folder, is not a private directory.',
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
const sqliteCode = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;
const SQLITE_FULL = 13;

/** A refusal's code and fixed text: never an exception's own text, which may hold a path. */
function refusalOf(error: unknown): {code: string; message: string} {
  if (error instanceof MigrationError) return {code: error.code, message: error.message};
  if (error instanceof Refusal) return {code: error.code, message: error.message};
  if (error instanceof RuntimeError) return {code: error.code, message: TEXT[error.code] ?? STATE_DIR};
  if (errno(error) === 'ENOSPC' || sqliteCode(error) === SQLITE_FULL) return {code: 'disk-short', message: TEXT['disk-short'] ?? ''};
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

/** Whether the module has no database, log or journal yet, and no folder or an empty one that is not a link. */
async function fresh(database: string, folder: string): Promise<boolean> {
  for (const suffix of ['', '-wal', '-shm', '-journal']) if (await exists(`${database}${suffix}`)) return false;
  if (!await exists(folder)) return true;
  return (await lstat(folder)).isDirectory() && (await readdir(folder)).length === 0;
}

async function freeBytesOf(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

/** Removes what `migrate` wrote: the module's database with its log and journal, and its folder. */
async function discard(database: string, folder: string): Promise<boolean> {
  const removals = [...['', '-wal', '-shm', '-journal'].map(suffix => rm(`${database}${suffix}`, {force: true})), rm(folder, {recursive: true, force: true})];
  return (await Promise.allSettled(removals)).every(result => result.status === 'fulfilled');
}

/**
 * Runs `migrate` or `verify` as `argv` says, writing one JSON line through `options.write`, and returns the exit code.
 * Both hold the runtime's lease and the Pixoo service's owner lock for as long as they run. `migrate` refuses, before it
 * writes anything to the module's files, a running runtime, a module that already has a database or files, a source
 * library `InstalledLibrary` refuses, and too little free space for the library's files and catalog plus
 * `--min-free-bytes`. If it fails once it has begun to write, it removes the module's database and folder.
 */
export async function runPixooMigration(argv: readonly string[], options: PixooMigrationOptions): Promise<number> {
  const emit = (record: object): void => { options.write(`${JSON.stringify({schema: MIGRATION_SCHEMA, ...record})}\n`); };
  const input = parse(argv);
  if (input === undefined) {
    emit({operation: argv[0] === 'migrate' || argv[0] === 'verify' ? argv[0] : 'none', result: 'refused', code: 'usage', message: PIXOO_MIGRATION_USAGE});
    return EXIT.usage;
  }
  const {operation} = input;
  let lease: RuntimeLease | undefined;
  let source: InstalledLibrary | undefined;
  try {
    if (operation === 'verify' && !await exists(input.stateDir)) throw new Refusal('destination-missing');
    const stateDir = await prepareStateDirectory(input.stateDir);
    lease = await holdRuntimeLease(stateDir);
    const database = join(stateDir, 'modules', `${MODULE}.sqlite`);
    const folder = join(stateDir, 'modules', MODULE);
    if (operation === 'verify') {
      if (!await exists(database)) throw new Refusal('destination-missing');
      source = await InstalledLibrary.open(input.library);
      const report = await verifyMigration(source, {databaseFile: database, folder});
      emit(report);
      return report.result === 'verified' ? EXIT.ok : EXIT.mismatch;
    }
    if (!await fresh(database, folder)) throw new Refusal('destination-not-empty');
    source = await InstalledLibrary.open(input.library);
    const free = await (options.freeBytes ?? freeBytesOf)(stateDir);
    if (free < source.counts.bytes + source.catalogBytes + input.minFreeBytes) throw new Refusal('disk-short');
    return await migrateInto(source, stateDir, database, folder, emit);
  } catch (error) {
    emit({operation, result: 'refused', ...refusalOf(error)});
    return EXIT.refused;
  } finally {
    source?.close();
    lease?.release();
  }
}

/** Writes the module's database and folder from `source`, or removes them again if that fails. */
async function migrateInto(source: InstalledLibrary, stateDir: string, database: string, folder: string, emit: (record: object) => void): Promise<number> {
  let db: DatabaseSync | undefined;
  try {
    db = openModuleDatabase(stateDir, MODULE);
    const report = await migrateLibrary(source, {database: db, folder: openModuleFolder(stateDir, MODULE)});
    // A clean close folds any log into the file, so the verifier and the runtime find the file whole.
    db.close();
    db = undefined;
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
