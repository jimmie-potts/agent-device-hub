// Where a packaging script installs its consumer: `.local/scratch/<name>` beside the outermost checkout around this
// repository, so no checkout's node_modules is on the consumer's resolution path and a missing bundled dependency cannot
// hide. A checkout that itself lives under another checkout, as a reviewer's clone in `.local/scratch/` does, resolves to
// the outer one, never to `.local/scratch/.local/scratch/` inside it (Hub #954).
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

/** The outermost directory at or above `start` that holds a `.git` entry, or `start` itself when none does. */
export function outermostCheckout(start) {
  let found = resolve(start);
  for (let dir = found; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) found = dir;
    if (dirname(dir) === dir) return found;
  }
}

/** The scratch root for `name`, beside the outermost checkout around `checkout`, the repository's main checkout. */
export function scratchRootFor(checkout, name) {
  return join(dirname(outermostCheckout(checkout)), '.local/scratch', name);
}

/**
 * The scratch root for `name` from the checkout at `root`: its main checkout is the directory of Git's common directory,
 * so a worktree outside the main checkout resolves as the main checkout does.
 */
export function scratchRoot(root, name) {
  const common = spawnSync('git', ['rev-parse', '--git-common-dir'], {cwd: root, encoding: 'utf8'});
  if (common.error || common.status !== 0) throw new Error('git-common-directory-unavailable');
  return scratchRootFor(dirname(resolve(root, common.stdout.trim())), name);
}
