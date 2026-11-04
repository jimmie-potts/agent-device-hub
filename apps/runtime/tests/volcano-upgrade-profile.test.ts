import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {inspectUpgradeState} from '../src/upgrade-inputs.js';

void test('the upgrade inventory knows a configured or retained Volcano, and refuses a configured one that lost its store', async t => {
  const root = await mkdtemp(join(tmpdir(), 'volcano-upgrade-profile-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'state'), modules = join(state, 'modules');
  await mkdir(modules, {recursive: true, mode: 0o700});
  await writeFile(join(modules, 'core.sqlite'), 'opaque synthetic database', {mode: 0o600});
  const configFile = join(root, 'runtime.json');
  const configure = (section: object): Promise<void> => writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: section}), {mode: 0o600});
  await configure({volcano: {id: 'volcano', hostId: 'synthetic-host', sourceId: 'synthetic-source'}});
  await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
  await writeFile(join(modules, 'volcano.sqlite'), 'opaque synthetic database', {mode: 0o600});
  assert.deepEqual((await inspectUpgradeState(state, configFile)).durableOwners, ['core', 'volcano']);
  await configure({});
  assert.deepEqual((await inspectUpgradeState(state, configFile)).durableOwners, ['core', 'volcano'], 'retained history stays owned when the section goes');
});
