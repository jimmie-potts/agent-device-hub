// The runtime's private state directory and each module's own SQLite file in it. Runtime state stays outside every Git
// checkout and off Windows mounts, private to its owner, as the Hub's stores are (AGENTS.md, ADR 0011).
import {closeSync, constants, fstatSync, mkdirSync, openSync, type Stats} from 'node:fs';
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

/** Refuses a path with a `.git` directory or worktree file in it or in any directory above it. */
async function outsideCheckouts(path: string): Promise<void> {
  for (let parent = path; ; parent = dirname(parent)) {
    try {
      await lstat(join(parent, '.git'));
      throw new RuntimeError('state-dir-checkout', `the state directory is inside a Git checkout: ${parent}`);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (parent === dirname(parent)) return;
  }
}

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
  if (path === '/mnt' || path.startsWith('/mnt/')) throw new RuntimeError('state-dir-mount', 'the state directory must not be on a Windows mount');
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
