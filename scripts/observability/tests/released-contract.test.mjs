import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { makePythonFixture } from '../python-fixture.mjs';
import { expectedLog } from '../query-records.mjs';
import { verifyReleaseInputs, prepareReleasedContract, verifyInstalledContract } from '../released-contract.mjs';

const root = new URL('../../../', import.meta.url);
const archive = new URL('vendor/jimmie-potts-bunny-observability-1.0.0.tgz', root);
const receipt = new URL('vendor/bunny-observability-1.0.0-source-receipt.json', root);

test('release archive and receipt are pinned before extraction', async () => {
  const bytes = await readFile(archive), proof = await readFile(receipt);
  assert.equal(verifyReleaseInputs(bytes, proof).version, '1.0.0');
  const corrupt = Buffer.from(bytes); corrupt[0] ^= 1;
  assert.throws(() => verifyReleaseInputs(corrupt, proof), /archive checksum/);
  assert.throws(() => verifyReleaseInputs(bytes, Buffer.from('{}')), /receipt checksum/);
});

test('pilot consumes the released artifact outside workspace resolution', async t => {
  const git = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const common = resolve(root.pathname, git.stdout.trim());
  const scratchRoot = resolve(common, '../../.local/scratch/704-released-consumer');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'consumer-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const installed = await prepareReleasedContract(join(scratch, 'isolated'));
  const contract = await import(pathToFileURL(join(installed, 'dist/index.js')));
  assert.equal(contract.ARTIFACT_VERSION, '1.0.0');
  assert.equal(contract.validateRecord({}).ok, false);
  const fixture = JSON.parse(await readFile(join(installed, 'fixtures/records.json'), 'utf8'));
  assert.ok(fixture);
  const childEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  delete childEnv.NODE_TEST_CONTEXT; // The external consumer owns its own test reporter.
  const tests = spawnSync(process.execPath, ['--test', join(installed, 'tests/conformance.test.mjs'), join(installed, 'tests/context-sink.test.mjs')],
    { cwd: scratch, env: childEnv, encoding: 'utf8', timeout: 30_000 });
  assert.equal(tests.status, 0, tests.stderr + tests.stdout);
  assert.match(tests.stdout, /fail 0/);
  const pythonFixture = await makePythonFixture(installed, { instanceId: '00000000-0000-4000-8000-000000000001',
    traceId: '1'.repeat(32), spanId: '2'.repeat(16), timestamp: '2026-10-02T00:00:00.000Z' });
  assert.equal(pythonFixture.record.resource['service.name'], 'nanoleaf-worker');
  assert.equal(pythonFixture.log.resourceLogs[0].scopeLogs[0].logRecords[0].traceId, '1'.repeat(32));
  assert.equal(expectedLog(pythonFixture.record).fields.bunny_ticket_sequence, '7');
  assert.equal(pythonFixture.span.resourceSpans[0].scopeSpans[0].spans[0].spanId, '2'.repeat(16));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(installed, 'fixtures/records.json'), '{}\n');
  await assert.rejects(verifyInstalledContract(installed), /integrity:fixtures\/records.json/);
});
