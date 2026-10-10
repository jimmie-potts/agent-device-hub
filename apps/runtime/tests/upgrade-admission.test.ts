import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {bindUpgradeAdmission} from '../src/upgrade-admission.js';

const owners = ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx', 'sdk-outbox'];
const phases = ['baseline', 'candidate', 'recovery', 'reupgrade'];
const hash = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

void test('binds a complete admitted qualification to private evidence and independently supplied identities', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-admission-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const evidence = 'synthetic reviewed qualification evidence\n';
  const pin = {path: join(directory, 'evidence.json'), sha256: hash(evidence)};
  await writeFile(pin.path, evidence, {mode: 0o600});
  const release = {kind: 'release' as const, sourceRevision: 'a'.repeat(40), version: '0.1.0',
    archiveSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64)};
  const releases = {previous: release, target: release, recovery: release};
  const formats = {scope: 'runtime-durable-formats/1.0' as const, qualificationRevision: release.sourceRevision,
    inventorySha256: 'd'.repeat(64), inventories: {previous: pin, target: pin, recovery: pin, qualification: pin}};
  const value = {schema: 'runtime-proof-admission/1.0', installationId: 'synthetic-runtime',
    coordinator: {name: 'synthetic-coordinator', authority: pin, admittedAt: '2026-10-09T00:00:00.000Z'},
    releases, installedBaselineClosure: pin, procedure: pin, sourceReviews: {standards: pin, specification: pin}, formats,
    coverage: owners.map(owner => ({owner, phases: phases.map(phase => ({phase, receipt: pin}))}))};
  const path = join(directory, 'admission.json');
  const bytes = JSON.stringify(value);
  await writeFile(path, bytes, {mode: 0o600});
  // The production observer will supply expected identities. This fixture does
  // not impersonate installed observation or grant authority to CLI input.
  const expected = {installationId: value.installationId, provenanceDirectory: directory, releases, formats};
  assert.deepEqual(await bindUpgradeAdmission(path, expected), {schema: value.schema, admissionSha256: hash(bytes), installedBaselineClosure: value.installedBaselineClosure});
  assert.deepEqual((await readdir(directory)).sort(), ['admission.json', 'evidence.json']);

  await t.test('changed evidence refuses without publishing an admission result', async () => {
    await writeFile(pin.path, 'changed candidate receipt', {mode: 0o600});
    await assert.rejects(bindUpgradeAdmission(path, expected), /^Error: runtime-proof-admission-refused$/);
    await writeFile(pin.path, evidence, {mode: 0o600});
  });
  await t.test('missing retained-owner coverage refuses', async () => {
    await writeFile(path, JSON.stringify({...value, coverage: value.coverage.filter(row => row.owner !== 'pixoo')}), {mode: 0o600});
    await assert.rejects(bindUpgradeAdmission(path, expected), /^Error: runtime-proof-admission-refused$/);
    await writeFile(path, bytes, {mode: 0o600});
  });
  await t.test('duplicate phases cannot conceal missing recovery evidence', async () => {
    const changed = structuredClone(value);
    const row = changed.coverage[0];
    assert.ok(row);
    row.phases = phases.map(() => ({phase: 'baseline', receipt: pin}));
    await writeFile(path, JSON.stringify(changed), {mode: 0o600});
    await assert.rejects(bindUpgradeAdmission(path, expected), /^Error: runtime-proof-admission-refused$/);
    await writeFile(path, bytes, {mode: 0o600});
  });
  await t.test('a different observed target manifest refuses', async () => {
    const changed = structuredClone(expected);
    changed.releases.target = {...release, manifestSha256: 'f'.repeat(64)};
    await assert.rejects(bindUpgradeAdmission(path, changed), /^Error: runtime-proof-admission-refused$/);
  });
  await t.test('a caller passed flag or nested unknown field refuses', async () => {
    for (const changed of [{...value, passed: true}, {...value, coordinator: {...value.coordinator, passed: true}}]) {
      await writeFile(path, JSON.stringify(changed), {mode: 0o600});
      await assert.rejects(bindUpgradeAdmission(path, expected), /^Error: runtime-proof-admission-refused$/);
    }
    await writeFile(path, bytes, {mode: 0o600});
  });
  await t.test('a linked evidence file refuses without disclosing its path', async () => {
    const retained = join(directory, 'retained.json');
    await writeFile(retained, evidence, {mode: 0o600});
    await rm(pin.path);
    await symlink(retained, pin.path);
    await assert.rejects(bindUpgradeAdmission(path, expected), /^Error: runtime-proof-admission-refused$/);
  });
});
