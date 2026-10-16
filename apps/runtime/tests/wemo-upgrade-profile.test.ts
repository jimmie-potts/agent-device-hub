import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {inspectUpgradeState} from '../src/upgrade-inputs.js';
import {bindUpgradeAdmission} from '../src/upgrade-admission.js';

void test('inventories configured and retained Wemo without reading or modifying its databases', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wemo-upgrade-profile-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'state'), modules = join(state, 'modules');
  await mkdir(modules, {recursive: true, mode: 0o700});
  await mkdir(join(modules, 'wemo'), {mode: 0o700});
  for (const name of ['core.sqlite', 'wemo.sqlite', 'wemo.sqlite-wal', 'wemo.sqlite-shm', 'wemo.sqlite-journal']) {
    await writeFile(join(modules, name), 'opaque synthetic database', {mode: 0o600});
  }
  const path = join(modules, 'wemo.sqlite');
  const before = await lstat(path);
  const configFile = join(root, 'runtime.json');
  for (const configured of [true, false]) {
    const bytes = JSON.stringify({schema: 'runtime-config/1.0', modules: configured ? {wemo: {plugs:[]}} : {}});
    await writeFile(configFile, bytes, {mode: 0o600});
    assert.deepEqual(await inspectUpgradeState(state, configFile), {
      configSha256: createHash('sha256').update(bytes).digest('hex'),
      configured: configured ? ['wemo'] : [], durableOwners: ['core', 'wemo'],
    });
  }
  const after = await lstat(path);
  assert.equal(after.atimeMs, before.atimeMs);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
  assert.equal(after.mode, before.mode);
  await writeFile(join(modules, 'wemo.sqlite-owner'), 'unsupported owner lease', {mode: 0o600});
  await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
});

void test('binds the fixed Wemo coverage set and rejects incomplete or unknown owner coverage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wemo-upgrade-admission-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const evidence = 'synthetic four-phase qualification';
  const pin = {path: join(root, 'evidence.json'), sha256: createHash('sha256').update(evidence).digest('hex')};
  await writeFile(pin.path, evidence, {mode: 0o600});
  const release = {kind: 'release' as const, sourceRevision: 'a'.repeat(40), version: '0.1.0',
    archiveSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64)};
  const releases = {previous: release, target: release, recovery: release};
  const formats = {scope: 'runtime-durable-formats/1.0' as const, qualificationRevision: release.sourceRevision,
    inventorySha256: 'd'.repeat(64), inventories: {previous: pin, target: pin, recovery: pin, qualification: pin}};
  const owners = ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx', 'sdk-outbox', 'wemo'];
  const phases = ['baseline', 'candidate', 'recovery', 'reupgrade'];
  const value = {schema: 'runtime-proof-admission/1.0', installationId: 'synthetic-runtime',
    coordinator: {name: 'synthetic-coordinator', authority: pin, admittedAt: '2026-10-09T00:00:00.000Z'},
    releases, installedBaselineClosure: pin, procedure: pin, sourceReviews: {standards: pin, specification: pin}, formats,
    coverage: owners.map(owner => ({owner, phases: phases.map(phase => ({phase, receipt: pin}))}))};
  const file = join(root, 'admission.json');
  const expected = {installationId: value.installationId, provenanceDirectory: root, releases, formats};
  await writeFile(file, JSON.stringify(value), {mode: 0o600});
  const bound = await bindUpgradeAdmission(file, expected);
  assert.ok('coveredOwners' in bound);
  assert.deepEqual(bound.coveredOwners, [...owners].sort());
  for (const row of [
    {...value, coverage: value.coverage.filter(owner => owner.owner !== 'core')},
    {...value, coverage: [...value.coverage, {owner: 'unknown', phases: value.coverage[0]?.phases}]},
    {...value, coverage: value.coverage.map(owner => owner.owner === 'wemo'
      ? {...owner, phases: phases.map(() => ({phase: 'baseline', receipt: pin}))} : owner)},
  ]) {
    await writeFile(file, JSON.stringify(row), {mode: 0o600});
    await assert.rejects(bindUpgradeAdmission(file, expected), /^Error: runtime-proof-admission-refused$/);
  }
});
