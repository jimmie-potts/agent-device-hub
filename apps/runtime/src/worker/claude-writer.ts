import {execFile} from 'node:child_process';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import {within} from './writer-proof.js';

const execute = promisify(execFile);
export const MAC_WRITER_SANDBOX = '/usr/bin/sandbox-exec';

/** Apply the fence to the CLI and its descendants, including commands that leave its process group. */
export function claudeWriterArguments(protectedRoot: string, executable: string, args: string[], additionalRoots: readonly string[] = []): string[] {
  const roots = [protectedRoot, ...additionalRoots], parameters = roots.map((root, index) => [index === 0 ? 'successor' : `protected${index}`, root] as const);
  const ancestors = new Set<string>();
  for (const root of roots) for (let parent = dirname(root); dirname(parent) !== parent; parent = dirname(parent)) ancestors.add(parent);
  const filters = [...ancestors].map((_, index) => `(literal (param "ancestor${index}"))`).join(' ');
  const exclusions = parameters.map(([key]) => `(subpath (param "${key}"))`).join(' ');
  const policy = `(version 1) (allow default) (deny file-write* ${exclusions}) (deny file-write-unlink ${filters})`;
  return [...parameters.flatMap(([key, path]) => ['-D', `${key}=${path}`]),
    ...[...ancestors].flatMap((path, index) => ['-D', `ancestor${index}=${path}`]), '-p', policy, executable, ...args];
}

/** Prove local writes still work and the kernel excludes writes through the target path and aliases. */
export async function verifyClaudeWriterBoundary(worktree: string, protectedRoot: string): Promise<boolean> {
  if (process.platform !== 'darwin' || within(worktree, protectedRoot) || within(protectedRoot, worktree)) return false;
  let source: string | undefined, target: string | undefined;
  try {
    source = await mkdtemp(join(worktree, '.bunny-boundary-'));
    target = await mkdtemp(join(protectedRoot, 'boundary-'));
    const file = join(target, 'file'), alias = join(source, 'alias');
    await writeFile(file, 'protected', {mode: 0o600});
    await symlink(file, alias);
    const script = 'umask 077; /usr/bin/touch "$1/ok" || exit 1; if /usr/bin/touch "$2/out" || /usr/bin/touch "$3" || /bin/ln "$4" "$1/hardlink" || /bin/mv "$2" "$1/moved"; then exit 1; fi';
    await execute(MAC_WRITER_SANDBOX, claudeWriterArguments(protectedRoot, '/bin/sh', ['-c', script, 'bunny-boundary', source, target, alias, file]),
      {cwd: worktree, env: {PATH: '/usr/bin:/bin'}, timeout: 5000, maxBuffer: 4096});
    return true;
  } catch {return false;}
  finally {
    await Promise.all([source, target].flatMap(path => path === undefined ? [] : [rm(path, {recursive: true, force: true}).catch(() => {})]));
  }
}
