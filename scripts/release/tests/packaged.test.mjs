import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {packagedTests} from '../packaged.mjs';

test('sealed-image inventory keeps every verification file except the exact checkout-only build file', async context => {
  const root = await mkdtemp(join(tmpdir(), 'packaged-inventory-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const scenarios = join(root, 'apps/runtime/dist/tests/scenarios'), verify = join(root, 'apps/runtime/dist/verify/tests');
  await mkdir(scenarios, {recursive: true}); await mkdir(verify, {recursive: true});
  await writeFile(join(scenarios, 'catalog.test.js'), '');
  const included = ['adapter.test.js', 'boundaries.test.js', 'drain.test.js', 'follow.test.js', 'guard.test.js',
    'health.test.js', 'home.test.js', 'journal.test.js', 'migrated.test.js', 'nanoleaf-migrated.test.js',
    'roborock.test.js', 'runs.test.js', 'steps.test.js', 'supervisor.test.js', 'future.test.js'];
  for (const name of ['build.test.js', 'support.js', ...included]) await writeFile(join(verify, name), '');
  const tests = await packagedTests(root);
  assert.deepEqual(tests.verification, included.sort().map(name => `apps/runtime/dist/verify/tests/${name}`));
  assert.deepEqual(tests.excluded, ['apps/runtime/dist/verify/tests/build.test.js']);
  assert.deepEqual(tests.scenarios, ['apps/runtime/dist/tests/scenarios/catalog.test.js']);
  await rm(join(verify, 'build.test.js'));
  await assert.rejects(packagedTests(root), /packaged-test-inventory-refused/);
});
