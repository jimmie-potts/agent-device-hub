// The runtime's private state directory and each module's own SQLite file in it. Runtime state stays outside every Git
// checkout and off Windows mounts, private to its owner, as the Hub's stores are (AGENTS.md, ADR 0011).
import {closeSync, constants, fstatSync, mkdirSync, openSync} from 'node:fs';
import {lstat, mkdir, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const missing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** Refuses a path with a `.git` directory or worktree file in it or in any directory above it. */
async function outsideCheckouts(path: string): Promise<void> {
  for (let parent = path; ; parent = dirname(parent)) {
    try {
      await lstat(join(parent, '.git'));
      throw new Error(`the state directory is inside a Git checkout: ${parent}`);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (parent === dirname(parent)) return;
  }
}

/**
 * Creates the state directory, owner-only, when it is missing, and returns its absolute path. Refuses a relative path, a
 * path under /mnt, inside a Git checkout or reached through a link, and a directory that others can open.
 */
export async function prepareStateDirectory(dir: string): Promise<string> {
  if (!isAbsolute(dir)) throw new Error('the state directory must be an absolute path');
  const path = resolve(dir);
  if (path === '/mnt' || path.startsWith('/mnt/')) throw new Error('the state directory must not be on a Windows mount');
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('the runtime needs a POSIX host');
  await outsideCheckouts(path);
  await mkdir(path, {recursive: true, mode: 0o700});
  if (await realpath(path) !== path) throw new Error('the state directory must not be reached through a link');
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error('the state directory must be a directory private to its owner (mode 700)');
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
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0) throw new Error(`${file} must be a private file with one link`);
  } finally {
    closeSync(descriptor);
  }
  const database = new DatabaseSync(file);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
  return database;
}
