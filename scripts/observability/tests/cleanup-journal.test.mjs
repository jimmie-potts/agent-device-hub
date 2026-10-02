import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCleanupJournal, readCleanupJournal } from '../cleanup-journal.mjs';
import { prepareBackendDirectory } from '../backend-files.mjs';
import { cleanupBackend } from '../backend-cleanup.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'jr-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  // backend plans require the task storage boundary even in disposable fixtures.
  const directory = join(parent, '.local');
  const { plan } = await prepareBackendDirectory(directory, { runId: 'journal-001',
    ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  const receipt = { containerId: 'a'.repeat(64), network: { networkId: 'b'.repeat(64) } };
  return { directory, plan, receipt };
}

test('durable cleanup intents survive close and a new attempt cannot overwrite evidence', async t => {
  const f = await fixture(t), journal = await createCleanupJournal(f.directory, f.receipt, 'attempt-001');
  const intent = { phase: 'intent', action: 'stop', kind: 'container', id: f.receipt.containerId };
  await journal.record(intent);
  const saved = await readCleanupJournal(journal.path, f.plan, f.receipt);
  assert.deepEqual(saved.pending, intent);
  assert.equal(saved.complete, false);
  await journal.close();
  const before = await readFile(journal.path, 'utf8');
  await assert.rejects(createCleanupJournal(f.directory, f.receipt, 'attempt-001'));
  assert.equal(await readFile(journal.path, 'utf8'), before);
  await assert.rejects(journal.record(intent), /closed/);
});

test('journal rejects private fields, foreign IDs and invalid event ordering without writing them', async t => {
  const f = await fixture(t), journal = await createCleanupJournal(f.directory, f.receipt, 'attempt-002');
  t.after(() => journal.close());
  const intent = { phase: 'intent', action: 'remove', kind: 'network', id: f.receipt.network.networkId };
  for (const value of [{ ...intent, message: 'SYNTHETIC_SECRET' }, { ...intent, id: 'c'.repeat(64) },
    { ...intent, phase: 'returned' }, { phase: 'complete', complete: true, elapsedMs: -1 }]) {
    await assert.rejects(journal.record(value));
  }
  await journal.record(intent);
  await assert.rejects(journal.record({ phase: 'complete', complete: true, elapsedMs: 1 }));
  await journal.record({ ...intent, phase: 'returned' });
  await journal.record({ phase: 'complete', complete: true, elapsedMs: 2 });
  const result = await readCleanupJournal(journal.path, f.plan, f.receipt);
  assert.equal(result.complete, true); assert.equal(result.pending, null);
  assert.equal(result.events.length, 3);
  assert.equal((await readFile(journal.path, 'utf8')).includes('SYNTHETIC_SECRET'), false);
  await assert.rejects(journal.record(intent));
});

test('truncated records, symlinks and sequence corruption are retained and refused', async t => {
  const f = await fixture(t), journal = await createCleanupJournal(f.directory, f.receipt, 'attempt-003');
  await journal.record({ phase: 'complete', complete: true, elapsedMs: 2 });
  await journal.close();
  const original = await readFile(journal.path, 'utf8');
  for (const corrupted of [original.slice(0, -1), original.replace('"sequence":1', '"sequence":7')]) {
    await writeFile(journal.path, corrupted);
    await assert.rejects(readCleanupJournal(journal.path, f.plan, f.receipt));
    assert.equal(await readFile(journal.path, 'utf8'), corrupted);
  }
  const link = join(f.directory, 'cleanup-link.jsonl');
  await symlink(journal.path, link);
  await assert.rejects(readCleanupJournal(link, f.plan, f.receipt));
});

test('cleanup records authoritative absence without repeating an interrupted mutation', async t => {
  const f = await fixture(t), journal = await createCleanupJournal(f.directory, f.receipt, 'resume-001');
  t.after(() => journal.close());
  let inspections = 0;
  const result = await cleanupBackend({ plan: f.plan, receipt: { ...f.receipt, volume: {} },
    evidenceSaved: true, record: journal.record, backend: {
      async inspect() { inspections++; return null; },
      async stop() { assert.fail('absent container must not be stopped'); },
      async remove() { assert.fail('absent resource must not be removed'); },
    } });
  assert.equal(result.complete, true);
  assert.ok(inspections >= 3);
  const saved = await readCleanupJournal(journal.path, f.plan, f.receipt);
  assert.deepEqual(saved.events, [result]);
});
