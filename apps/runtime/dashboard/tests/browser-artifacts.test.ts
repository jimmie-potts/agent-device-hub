import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {browserArtifactDirectory} from './browser-artifacts.ts';

async function ownedParent(context: TestContext): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'bunny-browser-artifacts-test-'));
  context.after(() => rm(parent, {recursive: true, force: true}));
  return parent;
}

void test('concurrent browser outputs under one parent retain their own proof bytes', async context => {
  const parent = await ownedParent(context);
  const [first, second] = await Promise.all([browserArtifactDirectory(parent), browserArtifactDirectory(parent)]);
  const firstFile = join(first, 'browser.png');
  const secondFile = join(second, 'browser.png');
  await writeFile(firstFile, 'first proof');
  await writeFile(secondFile, 'second proof');
  assert.equal(await readFile(firstFile, 'utf8'), 'first proof', 'a later run must not replace the first run evidence');
  assert.equal(await readFile(secondFile, 'utf8'), 'second proof');
  await rm(first, {recursive: true});
  assert.equal(await readFile(secondFile, 'utf8'), 'second proof', 'removing one owned output must leave another intact');
});

void test('a browser output directory is private', async context => {
  const directory = await browserArtifactDirectory(await ownedParent(context));
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

void test('an unusable selected output parent refuses instead of writing elsewhere', async context => {
  const parent = await ownedParent(context);
  const file = join(parent, 'file');
  await writeFile(file, 'retained');
  await assert.rejects(browserArtifactDirectory(file));
  assert.equal(await readFile(file, 'utf8'), 'retained');
});
