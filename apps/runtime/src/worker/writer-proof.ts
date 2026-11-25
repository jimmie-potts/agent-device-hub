import {createHash} from 'node:crypto';
import {lstat, readFile, readlink, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative} from 'node:path';
import type {ChildProcess} from 'node:child_process';

export function signalWriter(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {process.kill(-child.pid, signal); return;} catch { /* The process group may already have exited. */ }
  }
  child.kill(signal);
}

export function writerGone(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {process.kill(-pid, 0); return false;}
  catch (error) {return (error as NodeJS.ErrnoException).code === 'ESRCH';}
}

const MAX_ENTRIES = 20_000;
const MAX_BYTES = 96 * 1024 * 1024;
const escaped = (root: string, file: string) => {
  const path = relative(root, file);
  return path === '..' || path.startsWith('../') || isAbsolute(path);
};

/** Hash the exact file contents and modes without following symlinks, including ignored and untracked files. */
export async function worktreeFingerprint(worktree: string, git: (args: string[]) => Promise<string>): Promise<{head: string; digest: string} | undefined> {
  try {
    const root = await realpath(worktree);
    if (await realpath((await git(['rev-parse', '--show-toplevel'])).trim()) !== root) return;
    const head = (await git(['rev-parse', 'HEAD'])).trim();
    const index = await git(['ls-files', '--stage', '-z']);
    // Submodules may have other writers and repositories. This evidence covers exactly one checkout.
    if (!/^[a-f0-9]{40}$/u.test(head) || /(?:^|\0)160000 /u.test(index)) return;
    const names = [...new Set((await git(['ls-files', '--cached', '--others', '-z'])).split('\0').filter(Boolean))].sort();
    if (names.length > MAX_ENTRIES) return;
    const hash = createHash('sha256').update(JSON.stringify([root, head, index]));
    let bytes = 0;
    for (const name of names) {
      const path = join(root, name);
      if (escaped(root, path) || name.split('/').some(part => part === '.git' || part === '..')) return;
      const parent = await realpath(dirname(path)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (parent !== undefined && parent !== dirname(path)) return;
      const entry = parent === undefined ? undefined : await lstat(path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (entry === undefined) {hash.update(JSON.stringify([name, 'deleted'])); continue;}
      if ((!entry.isFile() && !entry.isSymbolicLink()) || bytes + entry.size > MAX_BYTES) return;
      const content = entry.isSymbolicLink() ? await readlink(path, {encoding: 'buffer'}) : await readFile(path);
      bytes += content.length;
      if (bytes > MAX_BYTES) return;
      hash.update(JSON.stringify([name, entry.mode, content.length])).update(content);
    }
    return {head, digest: hash.digest('hex')};
  } catch {return undefined;}
}
