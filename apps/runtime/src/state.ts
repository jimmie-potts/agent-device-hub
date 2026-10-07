// The runtime's private state directory, each module's own SQLite file and private folder in it, and the private files
// it reads: its configuration file and the modules' secret files (Hub #919). Runtime state stays outside every Git
// checkout and off Windows mounts, private to its owner, as the Hub's stores are (AGENTS.md, ADR 0011).
import {closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, type Stats} from 'node:fs';
import {lstat, mkdir, open, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/** A refusal the runtime makes itself. Its `code` names the reason in log records, which hold no messages. */
export class RuntimeError extends Error {
  override readonly name = 'RuntimeError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const missing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** The Git checkout `path` lies in, the nearest directory at or above it with a `.git` directory or worktree file, if any. */
async function checkoutOf(path: string): Promise<string | undefined> {
  for (let parent = path; ; parent = dirname(parent)) {
    try {
      await lstat(join(parent, '.git'));
      return parent;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (parent === dirname(parent)) return undefined;
  }
}

/** Refuses a path with a `.git` directory or worktree file in it or in any directory above it. */
async function outsideCheckouts(path: string): Promise<void> {
  const checkout = await checkoutOf(path);
  if (checkout !== undefined) throw new RuntimeError('state-dir-checkout', `the state directory is inside a Git checkout: ${checkout}`);
}

const onWindowsMount = (path: string): boolean => path === '/mnt' || path.startsWith('/mnt/');

/** The nearest part of `path` that exists, with its `lstat`, which does not follow a link at its end. */
async function nearestExisting(path: string): Promise<{path: string; info: Stats}> {
  for (let current = path; ; current = dirname(current)) {
    try {
      return {path: current, info: await lstat(current)};
    } catch (error) {
      if (!missing(error) || current === dirname(current)) throw error;
    }
  }
}

const linked = (): RuntimeError => new RuntimeError('state-dir-link', 'the state directory must not be reached through a link');

/**
 * Creates the state directory, owner-only, when it is missing, and returns its absolute path. Refuses a relative path, a
 * path under /mnt, inside a Git checkout or reached through a link anywhere along it, a file, and a directory that
 * others can open. Every check on the path runs before anything is created, so a refused path creates nothing.
 */
export async function prepareStateDirectory(dir: string): Promise<string> {
  if (!isAbsolute(dir)) throw new RuntimeError('state-dir-relative', 'the state directory must be an absolute path');
  const path = resolve(dir);
  if (onWindowsMount(path)) throw new RuntimeError('state-dir-mount', 'the state directory must not be on a Windows mount');
  const uid = process.getuid?.();
  if (uid === undefined) throw new RuntimeError('posix-host-required', 'the runtime needs a POSIX host');
  const existing = await nearestExisting(path);
  if (existing.info.isSymbolicLink()) throw linked();
  if (!existing.info.isDirectory()) {
    throw new RuntimeError('state-dir-not-directory', `the state directory path is not a directory at ${existing.path}`);
  }
  // The part that exists must be its own real path: a link anywhere above it would put what is created elsewhere.
  if (await realpath(existing.path) !== existing.path) throw linked();
  await outsideCheckouts(path);
  await mkdir(path, {recursive: true, mode: 0o700});
  if (await realpath(path) !== path) throw linked();
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new RuntimeError('state-dir-not-private', 'the state directory must be a directory private to its owner (mode 700)');
  }
  return path;
}

/**
 * Opens a module's own database, `modules/<name>.sqlite` in the state directory, creating it owner-only. Writes are
 * durable when their transaction commits.
 */
export function openModuleDatabase(stateDir: string, name: string): DatabaseSync {
  const dir = join(stateDir, 'modules');
  mkdirSync(dir, {recursive: true, mode: 0o700});
  const file = join(dir, `${name}.sqlite`);
  const descriptor = openSync(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0) throw new RuntimeError('module-db-not-private', `${file} must be a private file with one link`);
  } finally {
    closeSync(descriptor);
  }
  const database = new DatabaseSync(file);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
  return database;
}

/**
 * Creates a module's private folder, `modules/<name>/` in the state directory beside its SQLite file, owner-only, and
 * returns its absolute path. Refuses, with `module-folder-not-private`, a `modules` directory or a folder that is a link,
 * is not a directory, belongs to another user or that others can open.
 */
export function openModuleFolder(stateDir: string, name: string): string {
  const parent = join(stateDir, 'modules');
  const folder = join(parent, name);
  mkdirSync(folder, {recursive: true, mode: 0o700});
  for (const dir of [parent, folder]) {
    const info = lstatSync(dir);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
      throw new RuntimeError('module-folder-not-private', `${dir} must be a directory private to its owner (mode 700), not a link`);
    }
  }
  return folder;
}

/** Why the runtime refuses a private file: the configuration file or a module's secret file. */
export type FileProblem = 'relative' | 'mount' | 'missing' | 'link' | 'checkout' | 'not-file' | 'not-private' | 'too-large';

/** A private file the runtime refuses to read. It carries no path or contents of the file beyond its message. */
export class PrivateFileError extends Error {
  override readonly name = 'PrivateFileError';
  readonly problem: FileProblem;

  constructor(problem: FileProblem, path: string) {
    super(`${path}: ${problem}`);
    this.problem = problem;
  }
}

/**
 * Reads a private file whole, as #880's state rules require: an absolute path, off Windows mounts, with no link anywhere
 * along it, outside every Git checkout, and a regular file with one link and no permission for group or others, owned
 * by the runtime's user, of at most `maxBytes`. It never follows a link, and it checks the file it opened, so a file
 * swapped in between is checked too. Throws `PrivateFileError` naming the problem.
 */
export async function readPrivateFile(file: string, maxBytes: number): Promise<Buffer> {
  if (!isAbsolute(file)) throw new PrivateFileError('relative', file);
  const path = resolve(file);
  if (onWindowsMount(path)) throw new PrivateFileError('mount', path);
  let parent: string;
  try {
    parent = await realpath(dirname(path));
  } catch (error) {
    if (missing(error)) throw new PrivateFileError('missing', path);
    throw error;
  }
  if (parent !== dirname(path)) throw new PrivateFileError('link', path);
  if (await checkoutOf(dirname(path)) !== undefined) throw new PrivateFileError('checkout', path);
  let handle;
  try {
    // Nonblocking, so that a FIFO in its place cannot hold the open; the check below refuses it.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (missing(error)) throw new PrivateFileError('missing', path);
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') throw new PrivateFileError('link', path);
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new PrivateFileError('not-file', path);
    if (info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new PrivateFileError('not-private', path);
    if (info.size > maxBytes) throw new PrivateFileError('too-large', path);
    // One byte more than allowed shows a file that grew after the check.
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > maxBytes) throw new PrivateFileError('too-large', path);
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}
/** The configuration file's schema. */
export const CONFIG_SCHEMA = 'runtime-config/1.0';
/** The largest configuration file the runtime reads, 1 MiB. */
export const MAX_CONFIG_BYTES = 1_048_576;
/** The largest secret file a module may read, 64 KiB. */
export const MAX_SECRET_BYTES = 65_536;

/** The runtime's configuration file (`--config`): each module's own section, by module name. */
export type RuntimeConfig = {readonly modules: Readonly<Record<string, unknown>>};

/** A module's own section of the configuration, or undefined when the file has none for it. */
export function sectionOf(config: RuntimeConfig | undefined, name: string): unknown {
  return config !== undefined && Object.hasOwn(config.modules, name) ? config.modules[name] : undefined;
}

const CONFIG_CODES: Readonly<Record<FileProblem, string>> = {
  relative: 'config-relative', mount: 'config-mount', missing: 'config-missing', link: 'config-link', checkout: 'config-checkout',
  'not-file': 'config-not-file', 'not-private': 'config-not-private', 'too-large': 'config-too-large',
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads the runtime's configuration file, `{"schema": "runtime-config/1.0", "modules": {<name>: <section>}}`: a private
 * file, as `readPrivateFile` requires, of at most 1 MiB. A section is the module's own; the runtime checks each one only
 * when it admits that module, so a bad section refuses only its module. Refuses the whole file with a `RuntimeError`
 * whose code names why: `config-relative`, `config-mount`, `config-missing`, `config-link`, `config-checkout`,
 * `config-not-file`, `config-not-private`, `config-too-large`, or `config-invalid` for a file that is not JSON, names
 * another schema, lacks `modules`, has a `modules` that is not an object or has any other member. No refusal quotes
 * what the file holds.
 */
export async function readRuntimeConfig(file: string): Promise<RuntimeConfig> {
  let bytes: Buffer;
  try {
    bytes = await readPrivateFile(file, MAX_CONFIG_BYTES);
  } catch (error) {
    if (error instanceof PrivateFileError) throw new RuntimeError(CONFIG_CODES[error.problem], `the configuration file ${error.message}`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    throw new RuntimeError('config-invalid', 'the configuration file is not JSON');
  }
  if (!isRecord(parsed) || parsed.schema !== CONFIG_SCHEMA) throw new RuntimeError('config-invalid', `the configuration file is not ${CONFIG_SCHEMA}`);
  const {modules} = parsed;
  if (!isRecord(modules)) throw new RuntimeError('config-invalid', 'the configuration file\'s modules must be an object of sections by module name');
  if (Object.keys(parsed).some(key => key !== 'schema' && key !== 'modules')) {
    throw new RuntimeError('config-invalid', 'the configuration file has a member other than schema and modules');
  }
  return {modules};
}

/** The file in the state directory that holds the SDK edge's grants (Hub #920). */
export const EDGE_GRANTS_FILE = 'edge-grants.json';
const GRANTS_SCHEMA = 'edge-grants/1.0';
const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
// A run-generated token: at least 32 characters, so 24 random bytes in base64url.
const MIN_TOKEN = 32;

/** One remote source and the bearer token that lets a remote part act as it. */
export type EdgeGrant = {source: string; token: string};

const invalidGrants = (detail: string): RuntimeError => new RuntimeError('edge-grants-invalid', `${EDGE_GRANTS_FILE} ${detail}`);

/**
 * Reads the SDK edge's grants from `<stateDir>/edge-grants.json`: `{"schema": "edge-grants/1.0", "grants": [{source,
 * token}]}`, a private file with one link (mode 600), never reached through a link. Refuses a grant whose source is the
 * core's or a module's, so a remote part can never publish as either. No refusal quotes a token.
 */
export async function readEdgeGrants(stateDir: string): Promise<EdgeGrant[]> {
  const file = join(stateDir, EDGE_GRANTS_FILE);
  let text: string;
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
        throw new RuntimeError('edge-grants-not-private', `${file} must be a private file with one link (mode 600)`);
      }
      text = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    if (missing(error)) throw new RuntimeError('edge-grants-missing', `the edge needs its grants in ${file}`);
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
      throw new RuntimeError('edge-grants-not-private', `${file} must not be a link`);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidGrants('is not JSON');
  }
  const document = typeof parsed === 'object' && parsed !== null ? parsed as {schema?: unknown; grants?: unknown} : {};
  if (document.schema !== GRANTS_SCHEMA) throw invalidGrants(`is not ${GRANTS_SCHEMA}`);
  const listed: unknown = document.grants;
  if (!Array.isArray(listed) || listed.length === 0) throw invalidGrants('lists no grants');
  const grants = listed.map((entry: unknown): EdgeGrant => {
    const {source, token} = typeof entry === 'object' && entry !== null ? entry as {source?: unknown; token?: unknown} : {};
    if (typeof source !== 'string' || !SOURCE.test(source) || source.length > 256) throw invalidGrants('names a malformed source');
    if (typeof token !== 'string' || token.length < MIN_TOKEN || token.length > 512 || /\s/.test(token)) {
      throw invalidGrants(`has a token for ${source} that is not ${MIN_TOKEN} to 512 characters without spaces`);
    }
    if (source === 'bunny/core' || source.startsWith('bunny/modules/')) {
      throw new RuntimeError('edge-grant-source', `a grant may not act as ${source}: the core's and the modules' sources belong to the runtime`);
    }
    return {source, token};
  });
  if (new Set(grants.map(grant => grant.token)).size !== grants.length) throw invalidGrants('gives two grants one token');
  return grants;
}
