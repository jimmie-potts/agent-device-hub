// The Nanoleaf migration's command-line tool (Hub #933). The installer (#935) runs it offline at the cutover (#840),
// outside the runtime's event loop, before the runtime's first start:
//
//   node apps/runtime/dist/src/migrate-nanoleaf.js migrate --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>
//   node apps/runtime/dist/src/migrate-nanoleaf.js verify --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>
//
// `--source` is the Nanoleaf bridge's private state directory, which it only reads. `--state-dir` is the runtime's state
// directory: `migrate` writes the Nanoleaf module's SQLite file and private folder there, as the runtime creates them
// (#919). `--secrets-dir` is where it writes each device's token as a private secret file, and `--section` the private
// file where it writes the module's section of the runtime's configuration, naming those files, for the installer to put
// under `modules.nanoleaf`. `verify` compares all of it with the source; its `--section` may also name the runtime's
// configuration file that holds the section. Each prints one JSON line (`nanoleaf-migration/1.0`) with counts, codes and
// SHA-256 digests only, never a token, an address, a path or a name, and exits with one of `EXIT`.
import {timingSafeEqual} from 'node:crypto';
import {lstat, readdir, rm} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {
  convertNanoleafState, dumps, InstalledState, MIGRATION_SCHEMA, MigrationError, migrateNanoleaf, sameValue, sha256, syncDirectory, verifyNanoleafStore,
  writePrivate, type ConvertedNanoleaf, type NanoleafSection,
} from '@jimmie-potts/nanoleaf';
import {loadSecret} from './host.js';
import {holdRuntimeLease, type RuntimeLease} from './lease.js';
import {CONFIG_SCHEMA, MAX_CONFIG_BYTES, RuntimeError, openModuleDatabase, openModuleFolder, prepareStateDirectory, readPrivateFile} from './state.js';

export const NANOLEAF_MIGRATION_USAGE = 'usage: migrate-nanoleaf.js migrate|verify --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>; '
  + 'every path absolute';

/**
 * Exit codes: `ok` migrated, or verified with zero mismatches; `mismatch` the verifier found one or more; `usage` the
 * arguments are malformed; `refused` the tool refused before writing anything; `failed` it stopped after it began to
 * write, and removed what it wrote unless the line says `"destination": "left"`.
 */
export const EXIT = {ok: 0, mismatch: 1, usage: 2, refused: 3, failed: 4} as const;

const MODULE = 'nanoleaf';

/** The stages of `migrate`'s write after the module's store is filled, in order. */
export type Stage = 'checkpoint' | 'closed' | 'secrets' | 'section';

export type NanoleafMigrationOptions = {
  /** Writes one line of output, with its newline. */
  write: (line: string) => void;
  /** Runs at each stage of `migrate`'s write, before the stage; only tests pass it. */
  stage?: (name: Stage) => Promise<void>;
  /**
   * Stops the tool. Before `migrate` writes, it refuses with `interrupted`; once it has written, it stops at the next
   * stage and removes what it wrote. `verify` refuses with `interrupted` instead of reporting.
   */
  signal?: AbortSignal;
};

/**
 * A signal that aborts on the process's first SIGINT or SIGTERM, which the entry point passes, so a stopped migration
 * removes what it wrote. Both listeners go with the first signal, so a second one stops the process at once.
 */
export function abortOnSignals(target: Pick<NodeJS.EventEmitter, 'once' | 'removeListener'> = process): AbortSignal {
  const controller = new AbortController();
  const names = ['SIGINT', 'SIGTERM'] as const;
  const stop = (): void => {
    for (const name of names) target.removeListener(name, stop);
    controller.abort();
  };
  for (const name of names) target.once(name, stop);
  return controller.signal;
}

type Operation = 'migrate' | 'verify';
type Input = {operation: Operation; source: string; stateDir: string; secretsDir: string; section: string};

/** The tool's own refusals, with fixed text. A `MigrationError` carries its own fixed text. */
const TEXT: Readonly<Record<string, string>> = {
  usage: NANOLEAF_MIGRATION_USAGE,
  'runtime-running': 'A runtime holds the state directory: stop it first.',
  'lease-unavailable': 'The runtime\'s lease file in the state directory is not a regular file private to this user.',
  'secrets-dir-refused': 'The secrets directory is refused: it must be private (mode 700), outside every Git checkout and off /mnt, with no link along it.',
  'section-dir-refused': 'The section file\'s directory is refused: it must be private (mode 700), outside every Git checkout and off /mnt, with no link along it.',
  'destination-not-empty': 'The Nanoleaf module already has a database or files in the state directory, or a secret file or the section already exists: '
    + 'migrate into fresh ones.',
  'destination-missing': 'The state directory holds no Nanoleaf module database to verify.',
  'module-db-not-private': 'The Nanoleaf module\'s database file is not a private regular file with one link.',
  'module-folder-not-private': 'The Nanoleaf module\'s folder, or the modules folder, is not a private directory.',
  'disk-short': 'The file system ran out of space while the tool wrote.',
  'destination-not-clean': 'The module\'s database kept a log after the tool closed it, so its file lacks commits: nothing was migrated.',
  interrupted: 'A signal stopped the tool before it finished.',
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
  let values: {source?: string; 'state-dir'?: string; 'secrets-dir'?: string; section?: string};
  try {
    ({values} = parseArgs({args: rest, strict: true, allowPositionals: false, options: {
      source: {type: 'string'}, 'state-dir': {type: 'string'}, 'secrets-dir': {type: 'string'}, section: {type: 'string'},
    }}));
  } catch {
    return undefined;
  }
  const {source, 'state-dir': stateDir, 'secrets-dir': secretsDir, section} = values;
  const given = [source, stateDir, secretsDir, section];
  if (!given.every((path): path is string => path !== undefined && isAbsolute(path))) return undefined;
  const [sourcePath = '', statePath = '', secretsPath = '', sectionPath = ''] = given.map(path => resolve(path));
  return {operation, source: sourcePath, stateDir: statePath, secretsDir: secretsPath, section: sectionPath};
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

/** The private directory `path` as the runtime's state rules accept it, created when missing, or the refusal `code`. */
async function privateDirectory(path: string, code: string): Promise<string> {
  try {
    return await prepareStateDirectory(path);
  } catch (error) {
    if (error instanceof RuntimeError) throw new Refusal(code);
    throw error;
  }
}

/** The section's text: the conversion's section as JSON, which the installer puts under `modules.nanoleaf`. */
const sectionText = (section: NanoleafSection): string => `${JSON.stringify(section, null, 2)}\n`;
/** The configuration digest: the section's canonical JSON, which holds the secrets' paths and never a token. */
const configurationDigest = (section: unknown): string => sha256(dumps(section));

/**
 * Runs `migrate` or `verify` as `argv` says, writing one JSON line through `options.write`, and returns the exit code.
 * Both hold the runtime's lease and the bridge's locks for as long as they run. `migrate` refuses, before it writes
 * anything, a running runtime, a destination that already has a module database or files, a secret file or the section,
 * a secrets directory or section folder that is not private, and a source `InstalledState` or the conversion refuses. If
 * it fails once it has begun to write, it removes the module's database and folder and the files it wrote.
 */
export async function runNanoleafMigration(argv: readonly string[], options: NanoleafMigrationOptions): Promise<number> {
  const emit = (record: object): void => { options.write(`${JSON.stringify({schema: MIGRATION_SCHEMA, ...record})}\n`); };
  const input = parse(argv);
  if (input === undefined) {
    emit({operation: argv[0] === 'migrate' || argv[0] === 'verify' ? argv[0] : 'none', result: 'refused', code: 'usage', message: NANOLEAF_MIGRATION_USAGE});
    return EXIT.usage;
  }
  const {operation} = input;
  let lease: RuntimeLease | undefined;
  let source: InstalledState | undefined;
  try {
    if (operation === 'verify' && !await exists(input.stateDir)) throw new Refusal('destination-missing');
    const stateDir = await prepareStateDirectory(input.stateDir);
    lease = await holdRuntimeLease(stateDir);
    const database = join(stateDir, 'modules', `${MODULE}.sqlite`);
    const folder = join(stateDir, 'modules', MODULE);
    if (operation === 'verify') {
      if (!await exists(database)) throw new Refusal('destination-missing');
      source = InstalledState.open(input.source);
      return await verify(source, input, database, folder, emit, options.signal);
    }
    const secretsDir = await privateDirectory(input.secretsDir, 'secrets-dir-refused');
    await privateDirectory(dirname(input.section), 'section-dir-refused');
    if (!await fresh(database, folder) || await exists(input.section)) throw new Refusal('destination-not-empty');
    source = InstalledState.open(input.source);
    const converted = convertNanoleafState(source, secretsDir);
    for (const path of Object.values(converted.section.secrets)) if (await exists(path)) throw new Refusal('destination-not-empty');
    if (options.signal?.aborted === true) throw new Refusal('interrupted');
    return await migrateInto(source, converted, {stateDir, database, folder, secretsDir, section: input.section}, options, emit);
  } catch (error) {
    emit({operation, result: 'refused', ...refusalOf(error)});
    return EXIT.refused;
  } finally {
    source?.close();
    lease?.release();
  }
}

type Targets = {stateDir: string; database: string; folder: string; secretsDir: string; section: string};

/** Writes the module's store and folder, the secret files and the section, or removes what it wrote if that fails. */
async function migrateInto(source: InstalledState, converted: ConvertedNanoleaf, targets: Targets, options: NanoleafMigrationOptions,
  emit: (record: object) => void): Promise<number> {
  let db: DatabaseSync | undefined;
  const written: string[] = [];
  // Every write is synchronous and they run one after another, so none is still running when a failure removes what
  // was written. A signal is handled between stages.
  const stage = async (name: Stage): Promise<void> => {
    await options.stage?.(name);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    if (options.signal?.aborted === true) throw new Refusal('interrupted');
  };
  try {
    db = openModuleDatabase(targets.stateDir, MODULE);
    const report = migrateNanoleaf(source, {database: db, folder: openModuleFolder(targets.stateDir, MODULE)});
    await stage('checkpoint');
    // The log goes into the file before the close, whose own checkpoint would keep the log on a full disk without an
    // error: so a full disk is `disk-short` here, and the verifier and the runtime find the file whole.
    foldLog(db);
    db.close();
    db = undefined;
    await stage('closed');
    if (await logLeft(targets.database)) throw new Refusal('destination-not-clean');
    await stage('secrets');
    for (const [name, token] of converted.tokens) {
      const path = converted.section.secrets[name];
      if (path === undefined) throw new TypeError('the section names no file for a secret');
      // The token alone, with no line break, as the runtime reads it back. A file that is already there is refused, and
      // is not the tool's to remove.
      writePrivate(path, token);
      written.push(path);
    }
    syncDirectory(targets.secretsDir);
    await stage('section');
    writePrivate(targets.section, sectionText(converted.section));
    written.push(targets.section);
    syncDirectory(dirname(targets.section));
    emit({
      ...report,
      counts: {...report.counts, ...converted.counts, secrets: converted.tokens.size},
      digest: {...report.digest, configuration: configurationDigest(converted.section)},
    });
    return EXIT.ok;
  } catch (error) {
    try {
      db?.close();
    } catch {
      // The file is removed next either way.
    }
    const removed = await discard(targets, written);
    const {code, message} = refusalOf(error);
    emit({operation: 'migrate', result: 'failed', code, message, destination: removed ? 'removed' : 'left'});
    return EXIT.failed;
  }
}

/**
 * Checkpoints the module's log into its file and truncates it. SQLite refuses on a full disk with `SQLITE_FULL`; a
 * checkpoint that leaves frames behind is refused too. A file that kept its rollback journal, as a new file on a full
 * disk does, reports -1 for both counts.
 */
function foldLog(db: DatabaseSync): void {
  const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  if (result?.busy !== 0 || result.log !== result.checkpointed) throw new Refusal('destination-not-clean');
}

/** Whether a log or journal with content is left beside the module's database after its close. */
async function logLeft(database: string): Promise<boolean> {
  for (const suffix of ['-wal', '-journal']) {
    try {
      if ((await lstat(`${database}${suffix}`)).size > 0) return true;
    } catch (error) {
      if (errno(error) !== 'ENOENT') throw error;
    }
  }
  return false;
}

/** Removes what `migrate` wrote: the module's database with its log and journal, its folder, and each file it created. */
async function discard(targets: Targets, written: readonly string[]): Promise<boolean> {
  const removals = [...['', '-wal', '-shm', '-journal'].map(suffix => rm(`${targets.database}${suffix}`, {force: true})),
    rm(targets.folder, {recursive: true, force: true}), ...written.map(path => rm(path, {force: true}))];
  return (await Promise.allSettled(removals)).every(result => result.status === 'fulfilled');
}

/** Whether a secret file holds the token, compared by digest in constant time. */
const sameSecret = (text: string, token: string): boolean => timingSafeEqual(Buffer.from(sha256(text), 'hex'), Buffer.from(sha256(token), 'hex'));

/**
 * The section in `path`, a private file by the runtime's rules: the section `migrate` wrote, or the runtime's
 * configuration file holding it under `modules.nanoleaf`. Undefined when it cannot be read.
 */
async function readSection(path: string): Promise<unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readPrivateFile(path, MAX_CONFIG_BYTES)));
    if (isRecord(value) && value.schema === CONFIG_SCHEMA) return isRecord(value.modules) ? value.modules[MODULE] : undefined;
    return value;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** How many of the section's members differ from the conversion's, each device counted on its own by ID. */
function sectionDifferences(expected: NanoleafSection, actual: unknown): number {
  if (!isRecord(actual)) return 1;
  const want: Record<string, unknown> = expected;
  let count = 0;
  for (const key of new Set([...Object.keys(want), ...Object.keys(actual)])) {
    if (key !== 'devices') {
      if (!sameValue(want[key], actual[key])) count += 1;
      continue;
    }
    if (!Array.isArray(actual.devices)) {
      count += 1;
      continue;
    }
    const listed = actual.devices as unknown[];
    const byId = new Map(listed.map(device => [isRecord(device) ? device.id : undefined, device]));
    for (const device of expected.devices) if (!sameValue(byId.get(device.id), device)) count += 1;
    count += listed.filter(device => !expected.devices.some(known => isRecord(device) && known.id === device.id)).length;
  }
  return count;
}

/**
 * Compares the module's store and folder, the section and each secret file with the source, and reports each kind of
 * mismatch. A secret is read through the runtime's own reader, as the module will read it, and compared by digest.
 */
async function verify(source: InstalledState, input: Input, database: string, folder: string, emit: (record: object) => void,
  signal: AbortSignal | undefined): Promise<number> {
  const store = verifyNanoleafStore(source, {databaseFile: database, folder});
  const expected = convertNanoleafState(source, input.secretsDir);
  const actual = await readSection(input.section);
  const configuration = actual === undefined ? 1 : sectionDifferences(expected.section, actual);
  let secrets = 0;
  for (const [name, token] of expected.tokens) {
    const path = expected.section.secrets[name];
    let text: string | undefined;
    try {
      text = path === undefined ? undefined : await loadSecret(name, path);
    } catch {
      text = undefined;
    }
    if (text === undefined || !sameSecret(text, token)) secrets += 1;
  }
  if (signal?.aborted === true) throw new Refusal('interrupted');
  const mismatches = {...store.mismatches, configuration, secrets};
  const total = Object.values(mismatches).reduce((sum, count) => sum + count, 0);
  emit({
    operation: 'verify', result: total === 0 ? 'verified' : 'mismatch',
    counts: {...store.counts, ...expected.counts, secrets: expected.tokens.size}, mismatches: {total, ...mismatches},
    digest: {...store.digest, configuration: configurationDigest(actual ?? null)},
  });
  return total === 0 ? EXIT.ok : EXIT.mismatch;
}
