// Where a packaging script installs its consumer: `.local/scratch/<name>` beside the repository, so no checkout's
// node_modules is on the consumer's resolution path and a missing bundled dependency cannot hide. A checkout that lives
// in another checkout's scratch or worktree tree (`.local/` or `.claude/worktrees/`), as a reviewer's clone in
// `.local/scratch/` does, resolves to that outer checkout, never to `.local/scratch/.local/scratch/` inside it. The walk
// climbs only through those trees, so a checkout further up, such as a home directory kept in Git, is never reached
// (Hub #954).
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';

/** The trees of a checkout that hold other checkouts: its local scratch and worktrees, and Claude Code's worktrees. */
const NESTED = ['.local', join('.claude', 'worktrees')];

/** The nearest directory above `dir` that holds a `.git` entry, or undefined. */
function enclosingCheckout(dir) {
  for (let parent = dirname(dir); parent !== dir; dir = parent, parent = dirname(parent)) {
    if (existsSync(join(parent, '.git'))) return parent;
  }
  return undefined;
}

/**
 * The checkout `start` belongs to: `start` itself, or, while it lies in an enclosing checkout's `.local/` or
 * `.claude/worktrees/` tree, that enclosing checkout.
 */
export function outermostCheckout(start) {
  let found = resolve(start);
  for (let outer = enclosingCheckout(found); outer !== undefined; outer = enclosingCheckout(found)) {
    const inside = relative(outer, found);
    if (!NESTED.some(tree => inside.startsWith(tree + sep))) break;
    found = outer;
  }
  return found;
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
