// The packaging scripts' scratch root (Hub #954): beside the outermost checkout around the repository, so a reviewer's
// clone under another checkout's `.local/scratch/` neither nests `.local/scratch/.local/scratch/` nor puts the installed
// consumer where a checkout's node_modules could resolve a dependency the package forgot to bundle.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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
  const outside = join(base, 'loose');
  mkdirSync(outside);
  assert.equal(scratchRootFor(outside, 'package-observability'), join(base, '.local/scratch/package-observability'), 'a directory in no checkout');
});

test('both packaging scripts take their scratch root from the helper', () => {
  for (const script of ['scripts/package-hub.mjs', 'scripts/package-observability.mjs']) {
    const text = readFileSync(join(root, script), 'utf8');
    assert.match(text, /import \{scratchRoot\} from '\.\/scratch-root\.mjs';/, script);
    assert.match(text, /scratchRoot\(root,'package-(hub|observability)'\)/, script);
    assert.doesNotMatch(text, /--git-common-dir/, `${script} no longer finds its scratch root on its own`);
  }
});
