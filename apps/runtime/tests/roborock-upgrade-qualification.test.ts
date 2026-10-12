import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {access, copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import type {RunRecord, VacuumStatus} from '@jimmie-potts/roborock';
type Durable = {archive: Record<string, unknown[]>; identity: string; projection: VacuumStatus;
  checkpoint: {generation: number}; counts: {runs: number; samples: number; mapBlobs: number; mapCaptures: number; queuedRecords: number};
  runs: RunRecord[]; samples: Array<{recordId: number; samples: Array<{observationId: string}>}>;
  captures: Array<{capture: {association: string; reasons: string[]; blobHash: string | null}}>;
  outbox: Array<{id: string; kind: string; message: string; published: number}>};
type Snapshot = {phase: string; pid: number; boot: Durable | null; current: Durable; received: string[]};
const ID = 1_700_000_000, AT = ID * 1000;
const known = (value: number) => ({status: 'known', value}) as const;
const immutable = ['rr_observations', 'rr_run_versions', 'rr_episode_versions', 'rr_gap_versions',
  'rr_sample_links', 'rr_map_blobs', 'rr_map_captures', 'rr_map_checks'];
async function qualify(restoreBaseline = false): Promise<void> {
  // Small synthetic temporary files only, never installed state.
  const directory = await mkdtemp(join(tmpdir(), 'roborock-upgrade-')), snapshots: Snapshot[] = [];
  try {
    for (const phase of ['baseline', 'candidate', 'recovery', 'reupgrade']) {
      if (phase === 'recovery' && restoreBaseline) await copyFile(join(directory, 'baseline.sqlite'), join(directory, 'roborock.sqlite'));
      const child = spawnSync(process.execPath, [fileURLToPath(new URL(
        '../../../../modules/roborock/dist/tests/fixtures/upgrade-phase.js', import.meta.url)), directory, phase],
      {encoding: 'utf8', timeout: 15_000});
      assert.equal(child.status, 0, child.stderr);
      const current = JSON.parse(child.stdout) as Snapshot; assert.equal(current.phase, phase);
      const previous = snapshots.at(-1);
      if (previous !== undefined) assert.deepEqual(current.boot, previous.current, 'latest candidate durable snapshot survives reopen');
      else assert.equal(current.boot, null);
      const data = current.current;
      assert.equal(data.identity, 'synthetic-private-robot');
      assert.ok(data.captures.every(row => row.capture.association === 'unverified' && row.capture.blobHash !== null && row.capture.reasons.includes('gap')));
      assert.ok(data.runs.every(run => run.battery.clock === 'unqualified'));
      assert.ok(data.outbox.every(row => row.kind === 'state' && row.published === 0));
      if (phase === 'baseline' || phase === 'candidate') {
        const candidate = phase === 'candidate';
        assert.equal(data.projection.revision, candidate ? 2 : 1);
        assert.deepEqual(data.projection.status.batteryPercent, known(candidate ? 66 : 76));
        assert.equal(data.checkpoint.generation, candidate ? 2 : 1);
        assert.equal(data.counts.runs, candidate ? 2 : 1); assert.equal(data.counts.samples, candidate ? 6 : 3);
        assert.equal(data.counts.mapBlobs, candidate ? 2 : 1); assert.equal(data.counts.mapCaptures, candidate ? 2 : 1);
        assert.equal(data.counts.queuedRecords, candidate ? 2 : 1); assert.equal(data.outbox.length, candidate ? 4 : 2);
        assert.deepEqual(current.received, []);
        for (const page of data.samples) {
          const name = page.recordId === ID ? 'baseline' : 'candidate';
          assert.deepEqual(page.samples.map(row => row.observationId), [`sample-${name}-1`, `sample-${name}-3`], 'only observed samples outside gaps are eligible');
        }
        const baseline = data.runs.find(run => run.recordId === ID); assert.ok(baseline);
        assert.deepEqual(baseline.durationSeconds, known(candidate ? 45 : 40));
        assert.deepEqual(baseline.areaMm2, known(12_000_000)); assert.deepEqual(baseline.endAtMs, known(AT + 60_000));
        assert.equal(baseline.map.availability, 'unverified');
        if (candidate) {
          assert.ok(previous); assert.notDeepEqual(data.archive, previous.current.archive, 'candidate commits distinct durable data');
          for (const table of immutable) for (const row of previous.current.archive[table] ?? []) {
            assert.ok((data.archive[table] ?? []).some(retained => JSON.stringify(retained) === JSON.stringify(row)), `${table} retains prior originals and versions`);
          }
          for (const row of previous.current.outbox) assert.ok(data.outbox.some(retained => retained.id === row.id && retained.message === row.message));
          assert.ok(data.captures.some(row => row.capture.reasons.includes('restart')));
        }
      } else {
        assert.ok(current.boot); assert.deepEqual(data.archive, current.boot.archive, 'compatible recovery preserves latest candidate private data');
        assert.deepEqual(data.runs, current.boot.runs); assert.deepEqual(data.samples, current.boot.samples); assert.deepEqual(data.captures, current.boot.captures);
        assert.deepEqual(current.received, current.boot.outbox.map(row => row.message), 'SDK republishes exact stored IDs times traces and payloads');
        assert.deepEqual(data.outbox, [], 'published states retire through normal SDK bookkeeping');
        assert.equal(current.received.length, phase === 'recovery' ? 4 : 0); assert.equal(data.projection.revision, 2); assert.equal(data.checkpoint.generation, 2);
      }
      snapshots.push(current);
      if (phase === 'baseline' && restoreBaseline) {
        await assert.rejects(access(join(directory, 'roborock.sqlite-wal')));
        await copyFile(join(directory, 'roborock.sqlite'), join(directory, 'baseline.sqlite'));
      }
    }
    assert.equal(new Set(snapshots.map(row => row.pid)).size, 4);
  } finally {await rm(directory, {recursive: true, force: true});}
}
void test('four Roborock processes retain candidate originals reconciliation samples maps and SDK state without controls', () => qualify());
void test('Roborock qualification rejects recovery that restores the stopped baseline', async () => {
  await assert.rejects(qualify(true), /latest candidate durable snapshot survives reopen/);
});
