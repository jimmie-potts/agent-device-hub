import assert from 'node:assert/strict';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
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

void test('explicit inspected resolution settles an interrupted receipt while retaining its exact original bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-1037-resolution-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const receipts = join(root, 'receipts'), provenance = join(root, 'provenance');
  await mkdir(receipts, {mode: 0o700}); await mkdir(provenance, {mode: 0o700});
  const lock = join(root, 'install.lock'); await writeFile(lock, '', {mode: 0o600});
  const planBody = {schema: 'runtime-upgrade-plan/1.0', installationId: intent().installationId,
    eligibility: 'eligible-under-coordinator-admission', execution: {operationId: intent().operationId}};
  // Canonical hashing sorts keys; use the production pure helper to seal this
  // synthetic plan. This fixture claims no installed observation or acceptance.
  const seal = await run(process.execPath, ['--input-type=module', '-e',
    'import {canonical,sha256} from "./apps/hub/dist/install/files.js";const body=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify({...body,planSha256:sha256(canonical(body))}));', JSON.stringify(planBody)]);
  const sealed = JSON.parse(seal.stdout) as {planSha256: string};
  const input = join(provenance, 'final-input.json');
  const original: Record<string, unknown> = {...intent(), outcome: 'interrupted', failure: {phase: 'recovery', code: 'inspection-required', evidence: 'synthetic-interruption'},
    health: {status: 'unknown', evidence: null}, approval: {...intent().approval as object, planSha256: sealed.planSha256}};
  assert.equal(validateInstallReceipt(original), true);
  await writeFile(input, JSON.stringify(original), {mode: 0o600});
  await run(process.execPath, [helper, 'receipt', input, receipts]);
  const destination = join(receipts, 'fixture-upgrade.json');
  const priorBytes = await readFile(destination);
  const final: Record<string, unknown> = {...success(), approval: {...success().approval as object, planSha256: sealed.planSha256}};
  await writeFile(input, JSON.stringify(final), {mode: 0o600});
  await assert.rejects(run(process.execPath, [helper, 'receipt', input, receipts]));
  const pin = async (name: string, bytes: string) => {
    const path = join(provenance, name); await writeFile(path, bytes, {mode: 0o600});
    return {path, sha256: digest(bytes)};
  };
  const evidence = {
    plan: await pin('plan.json', seal.stdout),
    running: await pin('running.json', JSON.stringify({running: final.running, health: final.health, owner: 'synthetic process observation'})),
    latestState: await pin('latest-state.json', JSON.stringify(final.statePreservation)),
  };
  const resolution = {schema: 'runtime-receipt-resolution/1.0', installationId: original.installationId,
    operationId: original.operationId, receiptSha256: digest(priorBytes.toString('utf8')),
    finalReceiptSha256: digest(await readFile(input, 'utf8')), ...evidence,
    coordinator: {name: 'synthetic-coordinator', authority: await pin('authority.json', 'synthetic inspected resolution decision\n')}};
  const resolutionFile = join(provenance, 'resolution.json');
  await writeFile(resolutionFile, JSON.stringify(resolution), {mode: 0o600});
  const resolve = () => run('bash', ['--noprofile', '--norc', '-c',
    'exec 9<>"$1"; /usr/bin/flock --exclusive --nonblock 9 || exit 1; exec "$2" "$3" resolve-receipt "$4" "$5" "$6"',
    'synthetic-resolution', lock, process.execPath, helper, input, root, resolutionFile]);
  await t.test('missing lock and changed pinned evidence refuse without altering the interruption', async () => {
    await assert.rejects(run(process.execPath, [helper, 'resolve-receipt', input, root, resolutionFile]));
    await writeFile(evidence.running.path, 'changed observation', {mode: 0o600});
    await assert.rejects(resolve());
    assert.deepEqual(await readFile(destination), priorBytes);
    await writeFile(evidence.running.path, JSON.stringify({running: final.running, health: final.health, owner: 'synthetic process observation'}), {mode: 0o600});
  });
  await t.test('resolution cannot repoint approval or replace retained original bytes', async () => {
    const changed = {...final, approval: {...final.approval as object, planSha256: 'f'.repeat(64)}};
    const changedBytes = JSON.stringify(changed);
    await writeFile(input, changedBytes, {mode: 0o600});
    await writeFile(resolutionFile, JSON.stringify({...resolution, finalReceiptSha256: digest(changedBytes)}), {mode: 0o600});
    await assert.rejects(resolve());
    await writeFile(input, JSON.stringify(final), {mode: 0o600});
    await writeFile(resolutionFile, JSON.stringify(resolution), {mode: 0o600});
    const retained = join(provenance, 'unresolved-' + String(original.operationId) + '-' + resolution.receiptSha256 + '.json');
    await writeFile(retained, 'unrelated retained bytes', {mode: 0o600});
    await assert.rejects(resolve());
    assert.equal(await readFile(retained, 'utf8'), 'unrelated retained bytes');
    assert.deepEqual(await readFile(destination), priorBytes);
    await rm(retained);
  });
  const result = await resolve();
  const response: unknown = JSON.parse(result.stdout);
  assert.deepEqual(response, {schemaVersion: 'install-receipt/1.0', operationId: final.operationId, outcome: 'succeeded', persisted: true});
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), final);
  const retained = join(provenance, 'unresolved-' + String(original.operationId) + '-' + resolution.receiptSha256 + '.json');
  assert.deepEqual(await readFile(retained), priorBytes);
  assert.equal((await lstat(retained)).mode & 0o777, 0o600);
  await assert.rejects(resolve(), 'a resolution cannot be replayed against a settled receipt');
  assert.deepEqual(await readFile(retained), priorBytes);
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


void test('failed final directory synchronization cannot become durable success on an identical retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-1037-sync-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = join(directory, 'input.json');
  const preload = join(directory, 'private-fault.mjs');
  await writeFile(input, JSON.stringify(intent()), {mode: 0o600});
  await run(process.execPath, [helper, 'receipt', input, directory]);
  await writeFile(input, JSON.stringify(success()), {mode: 0o600});
  // Fault only the receipt directory's sync in this disposable child. All other
  // production reads, writes, validation and atomic publication remain real.
  await writeFile(preload, `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original = fs.promises.open;
fs.promises.open = async (...args) => {
  const handle = await original(...args);
  if (args[0] === process.env.FIXTURE_RECEIPT_DIRECTORY && args[1] === 'r') {
    handle.sync = async () => { throw new Error('synthetic directory sync refusal'); };
  }
  return handle;
};
syncBuiltinESMExports();
`, {mode: 0o600});
  const invoke = () => run(process.execPath, ['--import', preload, helper, 'receipt', input, directory], {
    env: {...process.env, FIXTURE_RECEIPT_DIRECTORY: directory}, timeout: 5000,
  });
  const refused = (error: unknown): boolean => {
    assert.ok(error instanceof Error && 'stderr' in error && 'stdout' in error);
    assert.equal(String(error.stdout), '', 'failed persistence must not print success');
    const diagnostic: unknown = JSON.parse(String(error.stderr));
    assert.equal(validateInstallReceipt(diagnostic), true, 'private stderr carries the schema-valid failed-finalization receipt');
    assert.deepEqual(diagnostic, {...success(), completedAt: null, outcome: 'receipt-finalization-failed',
      failure: {phase: 'receipt-finalization', code: 'write-failed', evidence: 'stderr-receipt'}});
    return true;
  };
  await assert.rejects(invoke(), refused);
  // Rename may already be visible. Visibility alone is not a durability proof.
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'fixture-upgrade.json'), 'utf8')), success());
  await assert.rejects(invoke(), refused);
  const recovered = await run(process.execPath, [helper, 'receipt', input, directory]);
  const response: unknown = JSON.parse(recovered.stdout);
  assert.deepEqual(response, {schemaVersion: 'install-receipt/1.0', operationId: 'fixture-upgrade', outcome: 'succeeded', persisted: true});
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'fixture-upgrade.json'), 'utf8')), success());
});
