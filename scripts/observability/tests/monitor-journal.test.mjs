import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareBackendDirectory } from '../backend-files.mjs';
import { createMonitorJournal, readMonitorJournal } from '../monitor-journal.mjs';
import { startResourceWatchdog, assessResources } from '../resource-watchdog.mjs';
const good = () => ({ runDataBytes: 1000, cgroupMemoryBytes: 1024 ** 3, hostAvailableMemoryBytes: 9 * 1024 ** 3,
  minimumAvailableBytes: 3 * 1024 ** 3, oomKilled: false });
async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'mj-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, '.local');
  const { plan } = await prepareBackendDirectory(directory, { runId: 'monitor',
    ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  const receipt = { containerId: 'a'.repeat(64), imageId: 'sha256:' + 'b'.repeat(64) };
  const journal = await createMonitorJournal(directory, receipt, 'attempt-001');
  t.after(() => journal.close());
  return { directory, plan, receipt, journal };
}

test('watchdog readiness follows a durable sample and final outcome survives readback', async t => {
  const f = await fixture(t);
  const watchdog = startResourceWatchdog({ sample: async () => good(), record: f.journal.record,
    stopOwned: async () => assert.fail('normal finish must not stop'), intervalMs: 1000 });
  assert.equal(await watchdog.ready, true);
  assert.equal((await readMonitorJournal(f.journal.path, f.plan, f.receipt)).sampleCount, 1);
  const result = await watchdog.finish(); await f.journal.finish(result);
  assert.deepEqual((await readMonitorJournal(f.journal.path, f.plan, f.receipt)).result, result);
  await assert.rejects(createMonitorJournal(f.directory, f.receipt, 'attempt-001'));
});

test('cap failure preserves its sample, stop intent and confirmed stop result', async t => {
  const f = await fixture(t);
  const watchdog = startResourceWatchdog({ sample: async () => ({ ...good(), runDataBytes: 3 * 1024 ** 3 }),
    record: f.journal.record, stopOwned: async () => ({ confirmed: true }) });
  assert.equal(await watchdog.ready, false);
  const result = await watchdog.done; await f.journal.finish(result);
  const saved = await readMonitorJournal(f.journal.path, f.plan, f.receipt);
  assert.equal(saved.stopReason, 'run-data-cap'); assert.equal(saved.result.stopConfirmed, true);
});

test('invalid fields, false assessments and out-of-order samples are refused without private output', async t => {
  const f = await fixture(t), event = { phase: 'sample', sequence: 1, startedNs: '10', finishedNs: '20', ...assessResources(good()) };
  for (const invalid of [{ ...event, secret: 'SYNTHETIC_SECRET' }, { ...event, sequence: 2 }, { ...event, ok: false }]) {
    await assert.rejects(f.journal.record(invalid));
  }
  await f.journal.record(event);
  await assert.rejects(f.journal.record({ ...event, sequence: 2, startedNs: '15', finishedNs: '30' }));
  assert.equal((await readFile(f.journal.path, 'utf8')).includes('SYNTHETIC_SECRET'), false);
  assert.equal((await readMonitorJournal(f.journal.path, f.plan, f.receipt)).result, null);
});

test('truncated monitor evidence is retained and never promoted to a finished run', async t => {
  const f = await fixture(t); await f.journal.close();
  const original = await readFile(f.journal.path, 'utf8');
  await writeFile(f.journal.path, original + '{"phase":');
  await assert.rejects(readMonitorJournal(f.journal.path, f.plan, f.receipt));
  assert.equal(await readFile(f.journal.path, 'utf8'), original + '{"phase":');
});

test('a saved cap failure cannot be relabeled as normal completion or a different failure', async t => {
  const f = await fixture(t);
  await f.journal.record({ phase: 'sample', sequence: 1, startedNs: '10', finishedNs: '20',
    ...assessResources({ ...good(), runDataBytes: 3 * 1024 ** 3 }) });
  await assert.rejects(f.journal.finish({ status: 'finished', reason: null, sampleCount: 1, evidenceSaved: true, stopConfirmed: false }));
  await f.journal.record({ phase: 'stop-intent', reason: 'run-data-cap', sampleCount: 1 });
  await assert.rejects(f.journal.finish({ status: 'failed', reason: 'sample-failed', sampleCount: 1, evidenceSaved: true, stopConfirmed: true }));
  await f.journal.finish({ status: 'failed', reason: 'run-data-cap', sampleCount: 1, evidenceSaved: true, stopConfirmed: false });
  assert.equal((await readMonitorJournal(f.journal.path, f.plan, f.receipt)).result.stopConfirmed, false);
});
