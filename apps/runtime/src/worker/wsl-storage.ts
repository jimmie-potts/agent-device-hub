import {execFile} from 'node:child_process';
import {lstat, realpath, statfs} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {promisify} from 'node:util';
import {checkoutIdentity, within, type CheckoutIdentity} from './writer-proof.js';

type Git = (cwd: string, args: string[]) => Promise<string>;
type DistroPath = (path: string) => Promise<boolean>;
const EXT_FILESYSTEM = 0xef53;
const execute = promisify(execFile);

export async function wslGit(cwd: string, args: string[], {timeoutMs = 10_000, trim = true}: {timeoutMs?: number; trim?: boolean} = {}): Promise<string> {
  const {stdout} = await execute('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    {cwd, env: {PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'},
      timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024});
  return trim ? stdout.trim() : stdout;
}

export const WSL_LOCATION_REFUSAL = 'WSL Codex needs its checkout, Git metadata, worktree parent, private profile and executable on the distro filesystem.';
export class WslStorageError extends Error {
  constructor(options?: ErrorOptions) {super(WSL_LOCATION_REFUSAL, options);}
}

const wslPath = (path: string): boolean => isAbsolute(path) && !within('/mnt', path) &&
  !within('/run/WSL', path) && path !== '/init';

/** Resolve aliases and distinguish the distro filesystem from Windows and separately mounted volumes. */
export async function wslCheckoutPath(path: string): Promise<boolean> {
  try {
    const canonical = await realpath(path);
    if (!wslPath(canonical)) return false;
    const [info, root, filesystem] = await Promise.all([lstat(canonical), lstat('/'), statfs(canonical)]);
    return info.dev === root.dev && filesystem.type === EXT_FILESYSTEM;
  } catch {return false;}
}

export async function wslCheckoutIdentity(path: string, git: Git = wslGit, onDistro: DistroPath = wslCheckoutPath): Promise<CheckoutIdentity> {
  if (!await onDistro(path)) throw new WslStorageError();
  const identity = await checkoutIdentity(path, git).catch((cause: unknown) => {throw new WslStorageError({cause});});
  if (!(await Promise.all([identity.root, identity.gitDir, identity.common].map(onDistro))).every(Boolean)) {
    throw new WslStorageError();
  }
  return identity;
}

async function existingEntry(path: string) {
  return await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new WslStorageError({cause: error});
  });
}

/** Check all existing startup storage before initializing any of it. */
export async function wslProfileStorage(home: string, directories: readonly string[], onDistro: DistroPath = wslCheckoutPath): Promise<void> {
  if (!await onDistro(home)) throw new WslStorageError();
  for (const path of directories) {
    const info = await existingEntry(path);
    if (info !== undefined && (!info.isDirectory() || await realpath(path).catch(() => undefined) !== path || !await onDistro(path))) {
      throw new WslStorageError();
    }
  }
}

/** Check both existing checkout-parent components before Git or mkdir can change either filesystem. */
export async function wslWorktreeParent(root: string, onDistro: DistroPath = wslCheckoutPath): Promise<string> {
  const local = join(root, '.local'), parent = join(local, 'worktrees');
  for (const path of [local, parent]) {
    const info = await existingEntry(path);
    if (info === undefined) break;
    if (!info.isDirectory() || await realpath(path).catch(() => undefined) !== path || !await onDistro(path)) throw new WslStorageError();
  }
  return parent;
}
