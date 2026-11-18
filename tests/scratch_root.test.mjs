// The packaging scripts' scratch root (Hub #954): beside the outermost checkout around the repository, so a reviewer's
// clone under another checkout's `.local/scratch/` neither nests `.local/scratch/.local/scratch/` nor puts the installed
// consumer where a checkout's node_modules could resolve a dependency the package forgot to bundle.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {outermostCheckout, scratchRootFor} from '../scripts/scratch-root.mjs';

const root = join(import.meta.dirname, '..');

test('the scratch root is beside the outermost checkout, never inside a checkout that holds this one', t => {
  const base = mkdtempSync(join(tmpdir(), 'scratch-root-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const checkout = dir => { mkdirSync(join(base, dir, '.git'), {recursive: true}); return join(base, dir); };
  const main = checkout('main');
  // A worktree marks itself with a `.git` file.
  const worktree = join(main, '.claude/worktrees/w1');
  mkdirSync(worktree, {recursive: true});
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git/worktrees/w1')}\n`);
  const clone = checkout('main/.local/scratch/r968/clone');
  assert.equal(outermostCheckout(main), main);
  assert.equal(outermostCheckout(worktree), main);
  assert.equal(outermostCheckout(clone), main, 'a clone in another checkout\'s scratch belongs to it');
  for (const at of [main, worktree, clone]) assert.equal(scratchRootFor(at, 'package-hub'), join(base, '.local/scratch/package-hub'));
  // A checkout around the repository that is not one of its scratch or worktree trees, such as a home directory kept
  // in Git, is not climbed past.
  const home = checkout('home');
  const repo = checkout('home/projects/repo');
  const reviewer = checkout('home/projects/repo/.local/scratch/r997/clone');
  const claude = join(repo, '.claude/worktrees/w2');
  mkdirSync(claude, {recursive: true});
  writeFileSync(join(claude, '.git'), `gitdir: ${join(repo, '.git/worktrees/w2')}\n`);
  const nested = checkout('home/projects/repo/.claude/worktrees/w2/.local/scratch/r/clone');
  for (const at of [repo, reviewer, claude, nested]) assert.equal(outermostCheckout(at), repo, at);
  assert.equal(scratchRootFor(reviewer, 'package-hub'), join(home, 'projects/.local/scratch/package-hub'), 'beside the repository, not beside the home checkout');
  const outside = join(base, 'loose');
  mkdirSync(outside);
  assert.equal(scratchRootFor(outside, 'package-observability'), join(base, '.local/scratch/package-observability'), 'a directory in no checkout');
});

test('both packagers allocate their scratch directory outside a nested review checkout', t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'package-scratch-')));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const outer = join(base, 'main');
  const review = join(outer, '.local', 'scratch', 'review');
  mkdirSync(review, {recursive: true});
  for (const cwd of [outer, review]) execFileSync('git', ['init', '--quiet'], {cwd});
  cpSync(join(root, 'scripts'), join(review, 'scripts'), {recursive: true});
  symlinkSync(join(root, 'node_modules'), join(review, 'node_modules'), 'dir');

  // A file at the expected directory stops each real entry point before it can package anything.
  const scratch = join(base, '.local', 'scratch');
  mkdirSync(scratch, {recursive: true});
  for (const name of ['package-hub', 'package-observability']) {
    const blocked = join(scratch, name);
    writeFileSync(blocked, '');
    const run = spawnSync(process.execPath, [join('scripts', name + '.mjs')], {cwd: review, encoding: 'utf8'});
    assert.ifError(run.error);
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes(blocked), run.stderr);
  }
});
