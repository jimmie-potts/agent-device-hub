import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';

const run = promisify(execFile);
const helper = join(process.cwd(), 'apps/runtime/bin/runtime-upgrade-check.mjs');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const fixtures = JSON.parse(await readFile(join(process.cwd(), 'packages/contracts/fixtures/install-receipt-v1.json'), 'utf8')) as {
  cases: {id: string; value: Record<string, unknown>; valid: boolean}[];
};
function success(): Record<string, unknown> {
  const fixture = fixtures.cases.find(c => c.id === 'upgrade-success');
  assert.ok(fixture);
  return structuredClone(fixture.value);
}

function intent(): Record<string, unknown> {
  const fixture = fixtures.cases.find(c => c.id === 'durable-intent');
  assert.ok(fixture);
  return structuredClone(fixture.value);
}

void test('verifies supplied current-runtime release inventory and archive without changing files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-release-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const release = join(directory, 'release');
  await mkdir(release, {mode: 0o700});
  const payload = 'export const syntheticRelease = true;\n';
  await writeFile(join(release, 'payload.js'), payload, {mode: 0o600});
  const manifest = JSON.stringify({artifact: '@jimmie-potts/runtime', sourceRevision: 'a'.repeat(40), version: '0.1.0',
    inventory: [{path: 'payload.js', kind: 'file', mode: 0o600, sha256: digest(payload)}]});
  await writeFile(join(release, 'manifest.json'), manifest, {mode: 0o600});
  const archive = join(directory, 'release.tar.gz');
  await writeFile(archive, 'synthetic archive bytes', {mode: 0o600});
  const input = join(directory, 'identity.json');
  await writeFile(input, JSON.stringify({kind: 'release', sourceRevision: 'a'.repeat(40), version: '0.1.0',
    archiveSha256: digest('synthetic archive bytes'), manifestSha256: digest(manifest)}), {mode: 0o600});
  const result = await run(process.execPath, [helper, 'verify-release', input, release, archive]);
  assert.deepEqual(JSON.parse(result.stdout), {sourceRevision: 'a'.repeat(40), verified: true, entries: 1});
  assert.equal(await readFile(join(release, 'payload.js'), 'utf8'), payload);
  assert.deepEqual((await readdir(release)).sort(), ['manifest.json', 'payload.js']);
  await writeFile(join(release, 'payload.js'), 'changed payload', {mode: 0o600});
  await assert.rejects(run(process.execPath, [helper, 'verify-release', input, release, archive]), error => {
    assert.ok(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /install-file-inventory/);
    return true;
  });
  assert.equal(await readFile(join(release, 'payload.js'), 'utf8'), 'changed payload');
  await writeFile(join(release, 'payload.js'), payload, {mode: 0o600});
  await writeFile(archive, 'changed archive bytes', {mode: 0o600});
  await assert.rejects(run(process.execPath, [helper, 'verify-release', input, release, archive]), error => {
    assert.ok(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /install-archive-hash/);
    return true;
  });
  assert.equal(await readFile(archive, 'utf8'), 'changed archive bytes');
});

void test('finalization preserves the approved intent frame and publishes the final receipt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-intent-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  await writeFile(input, JSON.stringify(intent()), {mode: 0o600});
  await run(process.execPath, [helper, 'receipt', input, directory]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'fixture-upgrade.json'), 'utf8')), intent());
  await writeFile(input, JSON.stringify(success()), {mode: 0o600});
  await run(process.execPath, [helper, 'receipt', input, directory]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'fixture-upgrade.json'), 'utf8')), success());
});

void test('changed approval refuses finalization and retains the original intent bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-drift-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  await writeFile(input, JSON.stringify(intent()), {mode: 0o600});
  await run(process.execPath, [helper, 'receipt', input, directory]);
  const destination = join(directory, 'fixture-upgrade.json');
  const before = await readFile(destination);
  const changed = success();
  changed.approval = {...changed.approval as Record<string, unknown>, planSha256: 'f'.repeat(64)};
  await writeFile(input, JSON.stringify(changed), {mode: 0o600});
  await assert.rejects(run(process.execPath, [helper, 'receipt', input, directory]), error => {
    assert.ok(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /install-receipt-conflict/);
    return true;
  });
  assert.deepEqual(await readFile(destination), before);
  assert.deepEqual((await readdir(directory)).sort(), ['fixture-upgrade.json', 'input.json']);
});

void test('writes a valid private receipt and verifies its exact durable readback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-receipt-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  const value = success();
  await writeFile(input, JSON.stringify(value), {mode: 0o600});
  const result = await run(process.execPath, [helper, 'receipt', input, directory]);
  assert.deepEqual(JSON.parse(result.stdout), {schemaVersion: 'install-receipt/1.0', operationId: value.operationId, outcome: 'succeeded', persisted: true});
  const file = join(directory, 'fixture-upgrade.json');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), value);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(directory)).sort(), ['fixture-upgrade.json', 'input.json']);
});

void test('invalid receipt refuses before creating any operation file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-invalid-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  await writeFile(input, JSON.stringify({...success(), outcome: 'invented-success'}), {mode: 0o600});
  await assert.rejects(run(process.execPath, [helper, 'receipt', input, directory]), error => {
    assert.ok(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /invalid-install-receipt/);
    return true;
  });
  assert.deepEqual(await readdir(directory), ['input.json']);
});

void test('receipt target symlink refuses and preserves its unrelated destination', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-linked-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  const unrelated = join(directory, 'unrelated.json');
  await writeFile(input, JSON.stringify(success()), {mode: 0o600});
  await writeFile(unrelated, 'synthetic preserved marker', {mode: 0o600});
  await symlink(unrelated, join(directory, 'fixture-upgrade.json'));
  await assert.rejects(run(process.execPath, [helper, 'receipt', input, directory]), error => {
    assert.ok(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /unsafe-install-file/);
    return true;
  });
  assert.equal(await readFile(unrelated, 'utf8'), 'synthetic preserved marker');
  assert.equal((await lstat(join(directory, 'fixture-upgrade.json'))).isSymbolicLink(), true);
});

void test('a finalized receipt cannot be changed or repointed by another call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-final-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  const value = success();
  await writeFile(input, JSON.stringify(value), {mode: 0o600});
  await run(process.execPath, [helper, 'receipt', input, directory]);
  const file = join(directory, 'fixture-upgrade.json');
  const before = await readFile(file, 'utf8');
  await writeFile(input, JSON.stringify({...value, installationId: 'different-installation'}), {mode: 0o600});
  await assert.rejects(run(process.execPath, [helper, 'receipt', input, directory]), error => {
    assert.ok(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /install-receipt-conflict/);
    return true;
  });
  assert.equal(await readFile(file, 'utf8'), before);
});
