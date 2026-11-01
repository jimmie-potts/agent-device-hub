import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parse, snapshot, runSuites} from '../runtime-container.mjs';

test('the runner accepts only fixed suites', () => {
  assert.equal(parse([]), 'all');
  assert.equal(parse(['--suite', 'browser']), 'browser');
  for (const args of [['--suite','arbitrary'], ['--image','installed'], ['--suite','verify','extra']]) assert.throws(() => parse(args));
});

test('the source snapshot takes changed and new source without ignored data or Git metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-container-test-'));
  try {
    const repo = join(root, 'source'); await mkdir(repo);
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(join(repo,'.gitignore'), '.local/\n*.log\n');
    await writeFile(join(repo,'tracked.txt'), 'before');
    execFileSync('git', ['-C', repo, 'add', '.']);
    await writeFile(join(repo,'tracked.txt'), 'after');
    await writeFile(join(repo,'new.txt'), 'new');
    await mkdir(join(repo,'.local')); await writeFile(join(repo,'.local','private'), 'excluded');
    await writeFile(join(repo,'runtime.log'), 'excluded');
    const files = await snapshot(repo, join(root,'snapshot'));
    assert.deepEqual(files.sort(), ['.gitignore','new.txt','tracked.txt']);
    assert.equal(await readFile(join(root,'snapshot','tracked.txt'),'utf8'), 'after');
    await symlink('/etc/passwd', join(repo,'link'));
    await assert.rejects(snapshot(repo, join(root,'unsafe')), /source-entry-refused/);
  } finally {await rm(root, {recursive:true, force:true});}
});

test('suite failure is returned and stops subsequent suites', async () => {
  const calls = [];
  assert.equal(await runSuites('all', async args => {calls.push(args);return 17;}), 17);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['run','test:runtime:scenarios:built']);
  assert.equal(await runSuites('all', async args => {calls.push(args);return 0;}), 0);
  assert.deepEqual(calls.at(-1), ['run','test:runtime:verify:built']);
});
