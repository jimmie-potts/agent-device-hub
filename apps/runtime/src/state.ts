// The runtime's private state directory, each module's own SQLite file and private folder in it, and the private files
// it reads: its configuration file and the modules' secret files (Hub #919). Runtime state stays outside every Git
// checkout and off Windows mounts, private to its owner, as the Hub's stores are (AGENTS.md, ADR 0011).
import {closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, type Stats} from 'node:fs';
import {lstat, mkdir, open, readlink, realpath} from 'node:fs/promises';
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
 * durable when their transaction commits: the database is in WAL mode at `synchronous = FULL`, so each commit syncs its
 * log once before it returns (Hub #972). `NORMAL` would skip that sync and let a power loss or a stopped WSL VM undo a
 * committed outcome or an accepted command's record, which ADR 0012 rules out. SQLite creates the log and its index,
 * `<name>.sqlite-wal` and `<name>.sqlite-shm`, with the file's own permissions. A copy of the file alone, while the
 * module runs or after a crash, may miss commits still in the log; a clean stop checkpoints them into the file.
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
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
  return database;
}

/**
 * Creates a module's private folder, `modules/<name>/` in the state directory beside its SQLite file, with mode 700, and
 * returns its absolute path. Refuses, with `module-folder-not-private`, a `modules` directory or a folder that is a link,
 * is not a directory, belongs to another user or has any permission for group or others.
 */
export function openModuleFolder(stateDir: string, name: string): string {
  const parent = join(stateDir, 'modules');
  const folder = join(parent, name);
  const check = (dir: string): void => {
    const info = lstatSync(dir);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
      throw new RuntimeError('module-folder-not-private', `${dir} must be a directory private to its owner, with no permissions for group or others, not a link`);
    }
  };
  // Each level is checked before anything is created inside it, so nothing is ever created through a link.
  mkdirSync(parent, {recursive: true, mode: 0o700});
  check(parent);
  try {
    mkdirSync(folder, {mode: 0o700});
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  check(folder);
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

const denied = (error: unknown): boolean => error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM');

/**
 * Reads a private file whole, as #880's state rules require: an absolute path, off Windows mounts, with no link anywhere
 * along it, outside every Git checkout, and a regular file with one link and no permissions for group or others, owned
 * by the runtime's user, of at most `maxBytes`. It opens the last part without following a link, and then checks that
 * the file it opened is the one at `file`, through `/proc/self/fd`, so a directory along the path swapped for a link
 * after the checks is refused too. It checks the opened file's type, owner, permissions, links and size, so a file
 * swapped in after the checks is checked as well. A file the runtime's user may not read is not private. Throws
 * `PrivateFileError` naming the problem. `beforeOpen` runs between the path's checks and the open, where such a swap
 * would happen; only tests pass it.
 */
export async function readPrivateFile(file: string, maxBytes: number, {beforeOpen}: {beforeOpen?: () => Promise<void>} = {}): Promise<Buffer> {
  if (!isAbsolute(file)) throw new PrivateFileError('relative', file);
  const path = resolve(file);
  if (onWindowsMount(path)) throw new PrivateFileError('mount', path);
  let parent: string;
  try {
    parent = await realpath(dirname(path));
  } catch (error) {
    if (missing(error)) throw new PrivateFileError('missing', path);
    if (denied(error)) throw new PrivateFileError('not-private', path);
    throw error;
  }
  if (parent !== dirname(path)) throw new PrivateFileError('link', path);
  // A directory along the path the runtime's user may not search hides whether a `.git` is there, and the file too.
  const checkout = await checkoutOf(dirname(path)).catch((error: unknown) => {
    if (denied(error)) throw new PrivateFileError('not-private', path);
    throw error;
  });
  if (checkout !== undefined) throw new PrivateFileError('checkout', path);
  await beforeOpen?.();
  let handle;
  try {
    // Nonblocking, so that a FIFO in its place cannot hold the open; the check below refuses it.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (missing(error)) throw new PrivateFileError('missing', path);
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') throw new PrivateFileError('link', path);
    if (denied(error)) throw new PrivateFileError('not-private', path);
    throw error;
  }
  try {
    // O_NOFOLLOW guards only the last part. A directory along the path swapped for a link after the checks above would
    // lead the open elsewhere, so the file opened must still be the one at `path`. Without procfs it cannot be shown.
    const opened = await readlink(`/proc/self/fd/${handle.fd}`).catch(() => undefined);
    if (opened !== path) throw new PrivateFileError('link', path);
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

/**
 * The configuration file's `edge` section (Hub #835): where the edge's client credentials are, whether a loopback page
 * may sign a browser in without a launch code, and the links the dashboard shows, as the old Hub's `browserAccess`,
 * `editorLinks` and `placeLinks`.
 */
export type EdgeConfig = {
  /** The absolute path of the private credentials file (`edge-credentials/1.0`). */
  readonly credentials: string;
  /** `trusted-loopback` lets a same-origin loopback page open a browser session without a launch code (Hub #276). */
  readonly browserAccess?: 'trusted-loopback';
  /**
   * Whether the launcher's socket, `bunny-launch.sock` in the state directory, hands out launch codes, as the old Hub's
   * did. On unless `false`; a disposable run, whose state directory's path is too long for a socket, turns it off.
   */
  readonly launcher: boolean;
  /** Whether `/mcp` serves MCP, as the old Hub's `mcp`: off unless `true`. Off, it answers `not-found`. */
  readonly mcp: boolean;
  /** An editor link per device, by routing ID: a loopback `http` URL without credentials, query or fragment. */
  readonly editorLinks: Readonly<Record<string, string>>;
  /** A link per local place, by ID: a loopback `http` URL with a port and without credentials, query or fragment. */
  readonly placeLinks: Readonly<Record<string, string>>;
};

/** The runtime's configuration file (`--config`): each module's own section, by module name, and the edge's section. */
export type RuntimeConfig = {readonly modules: Readonly<Record<string, unknown>>; readonly edge?: EdgeConfig};

/** A module's own section of the configuration, or undefined when the file has none for it. */
export function sectionOf(config: RuntimeConfig | undefined, name: string): unknown {
  return config !== undefined && Object.hasOwn(config.modules, name) ? config.modules[name] : undefined;
}

/** The configuration file's refusal codes. One the runtime's user may not read is `config-not-private`. */
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
  if (Object.keys(parsed).some(key => key !== 'schema' && key !== 'modules' && key !== 'edge')) {
    throw new RuntimeError('config-invalid', 'the configuration file has a member other than schema, modules and edge');
  }
  return {modules, ...(Object.hasOwn(parsed, 'edge') ? {edge: checkEdgeSection(parsed.edge)} : {})};
}

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACE = /^[A-Za-z0-9_.-]{1,128}$/;
const invalidEdge = (detail: string): RuntimeError => new RuntimeError('config-invalid', `the configuration file's edge section ${detail}`);

/** A loopback `http` link without credentials, query or fragment, with a port when `port` is set; undefined otherwise. */
function loopbackLink(value: unknown, port: boolean): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let link: URL;
  try {
    link = new URL(value);
  } catch {
    return undefined;
  }
  if (link.protocol !== 'http:' || link.hostname !== '127.0.0.1' || (port && link.port === '') || link.username !== '' || link.password !== '' ||
    link.search !== '' || link.hash !== '') return undefined;
  return link.href;
}

/** The links of one kind, at most `max`, keyed as `key` allows; refuses the whole section otherwise. */
function links(value: unknown, max: number, key: (name: string) => boolean, port: boolean, what: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > max) throw invalidEdge(`'s ${what} must be an object of at most ${max} links`);
  const checked: Record<string, string> = {};
  for (const [name, href] of Object.entries(value)) {
    const link = loopbackLink(href, port);
    if (!key(name) || link === undefined) throw invalidEdge(`has ${what} that are not loopback http links without credentials, query or fragment`);
    checked[name] = link;
  }
  return checked;
}

/**
 * The edge's section: `{"credentials": <absolute path>, "browserAccess"?: "trusted-loopback", "launcher"?: false,
 * "mcp"?: true, "editorLinks"?: {...}, "placeLinks"?: {...}}`, the old Hub's settings of the same names and the
 * launcher's switch (Hub #835). Refuses, with `config-invalid`, anything else; no refusal quotes a value. The cutover's
 * conversion checks what it writes with this too.
 */
export function checkEdgeSection(value: unknown): EdgeConfig {
  if (!isRecord(value)) throw invalidEdge('must be an object');
  if (Object.keys(value).some(key => !['credentials', 'browserAccess', 'launcher', 'mcp', 'editorLinks', 'placeLinks'].includes(key))) {
    throw invalidEdge('has a member other than credentials, browserAccess, launcher, mcp, editorLinks and placeLinks');
  }
  const {credentials, browserAccess, launcher = true, mcp = false} = value;
  if (typeof launcher !== 'boolean') throw invalidEdge('\'s launcher must be true or false');
  if (typeof mcp !== 'boolean') throw invalidEdge('\'s mcp must be true or false');
  if (typeof credentials !== 'string' || !isAbsolute(credentials) || credentials.length > 4096 || credentials.includes('\0')) {
    throw invalidEdge('must name its credentials file by an absolute path');
  }
  if (browserAccess !== undefined && browserAccess !== 'trusted-loopback') throw invalidEdge('\'s browserAccess may only be trusted-loopback');
  return {
    credentials, ...(browserAccess === undefined ? {} : {browserAccess}), launcher, mcp,
    editorLinks: links(value.editorLinks, 16, name => ROUTING_ID.test(name) && name.length <= 128, false, 'editorLinks'),
    placeLinks: links(value.placeLinks, 8, name => PLACE.test(name) && name !== 'bunny', true, 'placeLinks'),
  };
}
