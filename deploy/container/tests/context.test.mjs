import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {createContext} from '../context.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bunny-clean-context-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const repository = join(root, 'source');
  await mkdir(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=' + join(root, 'empty-hooks'), '-c', 'user.name=Synthetic',
    '-c', 'user.email=synthetic@example.invalid', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init');
  async function put(path, content) {
    await mkdir(dirname(join(repository, path)), {recursive: true});
    await writeFile(join(repository, path), content);
  }
  for (const path of ['.dockerignore', 'package.json', 'package-lock.json', 'deploy/container/Dockerfile', 'apps/runtime/source.mjs']) {
    await put(path, path.endsWith('.json') ? '{}' : 'synthetic-source');
  }
  git('add', '.'); git('commit', '-m', 'synthetic source');
  return {root, repository, git, put, revision: git('rev-parse', 'HEAD')};
}

test('clean context contains selected committed source, never private or unrelated working files', async t => {
  const f = await fixture(t);
  for (const path of ['apps/runtime/.env', 'apps/runtime/operator.local.json', 'modules/pixoo/config.local.json',
    'apps/runtime/runtime.log', 'apps/runtime/state.sqlite3', 'apps/runtime/state.db-wal',
    'apps/runtime/credential.key', 'apps/runtime/private/arbitrary.json', 'unrelated.txt']) {
    await f.put(path, 'SYNTHETIC-PRIVATE-MUST-NOT-ENTER');
  }
  await f.put('notes/unrelated-tracked.txt', 'SYNTHETIC-UNRELATED-MUST-NOT-ENTER');
  // A directory's name alone is not private data: this owning source fixture is needed by the existing build.
  await f.put('packages/sdk/tests/fixtures/evidence/source.ts', 'SYNTHETIC-REQUIRED-SOURCE');
  await f.put('docs/skins/places.json', 'SYNTHETIC-REQUIRED-DASHBOARD-INPUT');
  await f.put('docs/unrelated.json', 'SYNTHETIC-UNRELATED-MUST-NOT-ENTER');
  f.git('add', 'notes/unrelated-tracked.txt', 'packages/sdk/tests/fixtures/evidence/source.ts', 'docs'); f.git('commit', '-m', 'unrelated and required source');
  await f.put('apps/runtime/source.mjs', 'SYNTHETIC-DIRTY-MUST-NOT-ENTER');
  const result = await createContext({repository: f.repository, revision: f.git('rev-parse', 'HEAD'), destination: join(f.root, 'context')});
  const archive = await readFile(result.archive);
  assert.equal(archive.includes(Buffer.from('synthetic-source')), true);
  assert.equal(archive.includes(Buffer.from('SYNTHETIC-REQUIRED-SOURCE')), true);
  assert.equal(archive.includes(Buffer.from('SYNTHETIC-REQUIRED-DASHBOARD-INPUT')), true);
  for (const value of ['SYNTHETIC-PRIVATE-MUST-NOT-ENTER', 'SYNTHETIC-UNRELATED-MUST-NOT-ENTER', 'SYNTHETIC-DIRTY-MUST-NOT-ENTER']) {
    assert.equal(archive.includes(Buffer.from(value)), false);
  }
  await assert.rejects(createContext({repository: f.repository, revision: f.revision, destination: join(f.root, 'context')}), {code: 'EEXIST'});
});

test('tracked private paths refuse before a context destination is created', async t => {
  for (const path of ['apps/runtime/operator.local.json', 'apps/runtime/.env', 'apps/runtime/credential.key',
    'apps/runtime/state.sqlite3-wal', 'apps/runtime/state.db-wal', 'apps/runtime/runtime.log',
    'apps/runtime/private/selected.json', 'apps/runtime/API.KEY']) {
    await t.test(path, async tt => {
      const f = await fixture(tt);
      await f.put(path, 'SYNTHETIC-PRIVATE');
      f.git('add', path); f.git('commit', '-m', 'synthetic invalid source');
      const destination = join(f.root, 'refused');
      await assert.rejects(createContext({repository: f.repository, revision: f.git('rev-parse', 'HEAD'), destination}), /private-path/);
      await assert.rejects(readFile(join(destination, 'context.tar')), {code: 'ENOENT'});
    });
  }
});
