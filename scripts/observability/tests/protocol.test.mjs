import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeProtocol } from '../protocol.mjs';

const input = () => ({ sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40),
  packageLockSha256: 'c'.repeat(64), harnessSha256: 'd'.repeat(64),
  nodeVersion: '24.21.0', pythonVersion: '3.14.0',
  runId: 'pilot-test-001', createdAt: '2026-10-02T06:00:00.000Z' });
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'bunny-protocol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('frozen protocol records owner limits, order, metric definitions and immutable inputs', async t => {
  const root = await directory(t);
  const receipt = await freezeProtocol(root, input());
  const bytes = await readFile(receipt.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256);
  const data = JSON.parse(bytes);
  assert.equal(data.thresholds.workload.operations_per_second, 20);
  assert.equal(data.thresholds.workload.measurement_seconds, 60);
  assert.equal(data.queryVisibilityDeadlineMs, 30_000);
  assert.deepEqual(data.pairs.map(p => [p.condition, p.number, p.order]), [
    ['healthy', 1, ['disabled', 'enabled']], ['healthy', 2, ['enabled', 'disabled']],
    ['healthy', 3, ['disabled', 'enabled']], ['unavailable', 1, ['disabled', 'enabled']],
    ['unavailable', 2, ['enabled', 'disabled']], ['unavailable', 3, ['disabled', 'enabled']],
  ]);
  assert.equal(data.metricDefinitions.latencyPercentile, 'nearest-rank-unrounded');
  assert.equal(data.inputs.sourceRevision, input().sourceRevision);
  assert.match(data.backend.image, /@sha256:[0-9a-f]{64}$/);
  assert.equal(data.contract.archiveSha256, '7c48025059a92677790182c84c5b5d3b830f69470a9adc791386ad89c2185894');
  assert.equal(await readFile(`${receipt.path}.sha256`, 'utf8'), `${receipt.sha256}  protocol.json\n`);
});

test('an existing protocol is never overwritten, even with changed thresholds or revisions', async t => {
  const root = await directory(t);
  const receipt = await freezeProtocol(root, input());
  const original = await readFile(receipt.path, 'utf8');
  await assert.rejects(freezeProtocol(root, { ...input(), sourceRevision: 'e'.repeat(40) }), /EEXIST/);
  assert.equal(await readFile(receipt.path, 'utf8'), original);
});

test('unknown inputs, secrets, unpinned revisions and unsupported runtimes cannot enter the protocol', async t => {
  const root = await directory(t);
  for (const changes of [
    { token: 'SYNTHETIC_SECRET' }, { sourceRevision: 'main' }, { harnessSha256: '' },
    { nodeVersion: '22.0.0' }, { pythonVersion: '3.11.0' }, { runId: '../escape' },
    { createdAt: 'yesterday' }, { thresholds: {} },
  ]) await assert.rejects(freezeProtocol(root, { ...input(), ...changes }), /protocol input/);
});
