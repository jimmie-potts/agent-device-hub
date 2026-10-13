import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {inspectUpgradeState} from '../src/upgrade-inputs.js';
import {bindUpgradeAdmission} from '../src/upgrade-admission.js';

void test('inventories configured and retained Roborock through metadata and requires its primary private archive', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roborock-upgrade-profile-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'state'), modules = join(state, 'modules');
  await mkdir(modules, {recursive: true, mode: 0o700});
  await writeFile(join(modules, 'core.sqlite'), 'opaque synthetic core', {mode: 0o600});
  await mkdir(join(modules, 'roborock'), {mode: 0o700});
  const archive = join(modules, 'roborock.sqlite');
  await writeFile(archive, 'opaque synthetic archive', {mode: 0o600});
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await writeFile(archive + suffix, 'opaque synthetic sidecar', {mode: 0o600});
  }
  const before = await lstat(archive), config = join(root, 'config.json');
  for (const selected of [true, false]) {
    const bytes = JSON.stringify({schema: 'runtime-config/1.0', modules: selected ? {roborock: {id: 'vacuum'}} : {}});
    await writeFile(config, bytes, {mode: 0o600});
    assert.deepEqual(await inspectUpgradeState(state, config), {
      configSha256: createHash('sha256').update(bytes).digest('hex'),
      configured: selected ? ['roborock'] : [], durableOwners: ['core', 'roborock'],
    });
  }
  const after = await lstat(archive);
  assert.equal(after.atimeMs, before.atimeMs); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.mode, before.mode); assert.equal(after.size, before.size);
  await rm(archive);
  await assert.rejects(inspectUpgradeState(state, config), /^Error: runtime-upgrade-inputs-refused$/);
  await rm(join(modules, 'roborock'), {recursive: true});
  for (const suffix of ['-wal', '-shm', '-journal']) await rm(archive + suffix);
  await writeFile(config, JSON.stringify({schema: 'runtime-config/1.0', modules: {roborock: {id: 'vacuum'}}}), {mode: 0o600});
  await assert.rejects(inspectUpgradeState(state, config), /^Error: runtime-upgrade-inputs-refused$/);
});

void test('binds complete Roborock coverage for every active optional-owner combination and refuses incomplete phases', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roborock-upgrade-admission-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const evidence = 'synthetic qualification';
  const pin = {path: join(root, 'evidence.json'), sha256: createHash('sha256').update(evidence).digest('hex')};
  await writeFile(pin.path, evidence, {mode: 0o600});
  const release = {kind: 'release' as const, sourceRevision: 'a'.repeat(40), version: '0.1.0', archiveSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64)};
  const releases = {previous: release, target: release, recovery: release};
  const formats = {scope: 'runtime-durable-formats/1.0' as const, qualificationRevision: release.sourceRevision,
    inventorySha256: 'd'.repeat(64), inventories: {previous: pin, target: pin, recovery: pin, qualification: pin}};
  const required = ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx', 'sdk-outbox'];
  const phases = ['baseline', 'candidate', 'recovery', 'reupgrade'];
  const value = {schema: 'runtime-proof-admission/1.0', installationId: 'synthetic-runtime',
    coordinator: {name: 'synthetic-coordinator', authority: pin, admittedAt: '2026-10-12T00:00:00.000Z'}, releases,
    installedBaselineClosure: pin, procedure: pin, sourceReviews: {standards: pin, specification: pin}, formats,
    coverage: [...required, 'roborock'].map(owner => ({owner, phases: phases.map(phase => ({phase, receipt: pin}))}))};
  const expected = {installationId: value.installationId, provenanceDirectory: root, releases, formats};
  const file = join(root, 'admission.json');
  for (const optional of [[], ['onn']]) {
    for (const companions of [[], ['companions']]) {
      const coverage = [...value.coverage, ...[...optional, ...companions].map(owner => ({owner, phases: phases.map(phase => ({phase, receipt: pin}))}))];
      await writeFile(file, JSON.stringify({...value, coverage}), {mode: 0o600});
      assert.deepEqual((await bindUpgradeAdmission(file, expected)).coveredOwners, coverage.map(row => row.owner).sort());
    }
  }
  for (const coverage of [
    [...value.coverage, value.coverage[0]],
    [...value.coverage, {owner: 'unknown', phases: value.coverage[0]?.phases}],
    value.coverage.map(row => row.owner === 'roborock' ? {...row, phases: row.phases.slice(1)} : row),
    value.coverage.map(row => row.owner === 'roborock' ? {...row, phases: phases.map(() => ({phase: 'baseline', receipt: pin}))} : row),
  ]) {
    await writeFile(file, JSON.stringify({...value, coverage}), {mode: 0o600});
    await assert.rejects(bindUpgradeAdmission(file, expected), /^Error: runtime-proof-admission-refused$/);
  }
});
