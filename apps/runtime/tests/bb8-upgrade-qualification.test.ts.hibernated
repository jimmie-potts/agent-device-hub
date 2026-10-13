import assert from 'node:assert/strict';
import {chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {inspectUpgradeState} from '../src/upgrade-inputs.js';

void test('configured and retained BB8 enter complete read-only upgrade ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bb8-upgrade-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'state'), modules = join(state, 'modules');
  await mkdir(modules, {recursive: true, mode: 0o700});
  await writeFile(join(modules, 'core.sqlite'), 'synthetic opaque core', {mode: 0o600});
  const robot = join(modules, 'bb8.sqlite');
  await writeFile(robot, 'synthetic opaque BB8; must not be opened', {mode: 0o600});
  await writeFile(join(modules, 'bb8.sqlite-wal'), 'latest synthetic sidecar', {mode: 0o600});
  const config = join(root, 'runtime.json');
  await writeFile(config, JSON.stringify({schema: 'runtime-config/1.0', modules: {bb8: {id: 'bb8', configurationRevision: 0}}}), {mode: 0o600});
  const before = await lstat(robot);
  const selected = await inspectUpgradeState(state, config);
  assert.deepEqual(selected.configured, ['bb8']);
  assert.deepEqual(selected.durableOwners, ['bb8', 'core']);
  const after = await lstat(robot);
  assert.equal(after.atimeMs, before.atimeMs, 'inventory must not read a live database');
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);

  await writeFile(config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}}), {mode: 0o600});
  assert.deepEqual((await inspectUpgradeState(state, config)).durableOwners, ['bb8', 'core'], 'unconfigured retained state still needs compatibility coverage');
  await chmod(robot, 0o644);
  await assert.rejects(inspectUpgradeState(state, config), /^Error: runtime-upgrade-inputs-refused$/);
  await chmod(robot, 0o600);
  await writeFile(join(modules, 'roborock.sqlite'), 'synthetic retained Roborock', {mode: 0o600});
  assert.deepEqual((await inspectUpgradeState(state, config)).durableOwners, ['bb8', 'core', 'roborock']);
  await writeFile(join(modules, 'unknown-owner.sqlite'), 'unqualified retained owner', {mode: 0o600});
  await assert.rejects(inspectUpgradeState(state, config), /^Error: runtime-upgrade-inputs-refused$/);
  assert.equal(await readFile(join(modules, 'bb8.sqlite-wal'), 'utf8'), 'latest synthetic sidecar');
});
