import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

type Snapshot = {
  phase: string; pid: number; effects: number; received: Array<{id: string}>;
  originals: object[]; observations: object[]; gaps: object[];
  requests: Array<{record: string}>; outcomes: Array<{id: string; message: string}>;
  privateKeySha256: string; cursorKey: object;
  state: {current: Array<{playback: {positionMs: number}}>};
};

void test('four separate ONN processes retain latest originals, progress, identities, gaps and outcomes without replay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'onn-upgrade-process-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const snapshots: Snapshot[] = [];
  for (const phase of ['baseline', 'candidate', 'recovery', 'reupgrade']) {
    const child = spawnSync(process.execPath,
      [fileURLToPath(new URL('./fixtures/onn-upgrade-phase.js', import.meta.url)), directory, phase],
      {encoding: 'utf8', timeout: 15_000});
    assert.equal(child.status, 0, child.stderr);
    const current = JSON.parse(child.stdout) as Snapshot;
    assert.equal(current.phase, phase);
    assert.equal(current.effects, phase === 'baseline' ? 3 : 0, 'restart and matching retries never transmit commands');
    const previous = snapshots.at(-1);
    if (previous !== undefined) {
      assert.deepEqual(current.originals.slice(0, previous.originals.length), previous.originals, 'private originals remain byte-for-byte');
      assert.deepEqual(current.observations.slice(0, previous.observations.length), previous.observations);
      assert.deepEqual(current.gaps.slice(0, previous.gaps.length), previous.gaps);
      assert.equal(current.privateKeySha256, previous.privateKeySha256);
      assert.deepEqual(current.cursorKey, previous.cursorKey);
      for (const outcome of previous.outcomes) {
        assert.ok(current.outcomes.some(row => row.id === outcome.id && row.message === outcome.message));
        assert.ok(current.received.some(row => row.id === outcome.id), 'unacknowledged SDK outcome is republished unchanged');
      }
      const rows = current.requests.map(row => JSON.parse(row.record) as {requestId: string; state: string; outcome: {result: string; evidence: string}});
      for (const [id, result] of [['interrupted-accepted', 'failed'], ['interrupted-started', 'uncertain']]) {
        const row = rows.find(value => value.requestId === id); assert.ok(row);
        assert.equal(row.state, 'done'); assert.equal(row.outcome.result, result); assert.equal(row.outcome.evidence, 'none');
      }
      assert.equal(current.originals.length, previous.originals.length + 2, 'one startup gap and one new sample');
      assert.equal(current.gaps.length, previous.gaps.length + 1);
    }
    assert.equal(current.state.current[0]?.playback.positionMs, 10_000 + snapshots.length * 20_000,
      'latest reported progress is retained source evidence, without invented watched totals');
    assert.ok(!JSON.stringify(current.requests).includes('SYNTHETIC_MEMORY_ONLY_INPUT'));
    snapshots.push(current);
  }
  assert.equal(new Set(snapshots.map(row => row.pid)).size, 4);
});
