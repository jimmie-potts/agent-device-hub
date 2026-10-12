import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

void test('four companion processes retain latest private records and outcomes without rebuilding reactions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'companion-recovery-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const snapshots: Array<{pid: number; record: Record<string, unknown>; outcomes: Array<{id: string; message: string}>;
    republished: string[]; boot: Record<string, unknown>}> = [];
  for (const phase of ['baseline', 'candidate', 'recovery', 'reupgrade']) {
    const child = spawnSync(process.execPath,
      [fileURLToPath(new URL('./fixtures/companions-upgrade-phase.js', import.meta.url)), directory, phase],
      {encoding: 'utf8', timeout: 15_000});
    assert.equal(child.status, 0, child.stderr);
    const snapshot = JSON.parse(child.stdout) as typeof snapshots[number];
    const previous = snapshots.at(-1);
    if (previous) {
      for (const field of ['received', 'admissions', 'allowances']) {
        assert.deepEqual(snapshot.boot[field], previous.record[field], field + ' survives reopen');
        assert.deepEqual(snapshot.record[field], previous.record[field], field + ' is not consumed by recovery');
      }
      const state = snapshot.record.state as {settings: object; presentation: {history: boolean} | null};
      const prior = previous.record.state as typeof state;
      assert.deepEqual(state.settings, prior.settings);
      assert.ok(state.presentation && prior.presentation);
      assert.equal(state.presentation.history, true, 'retained presentation is history, not a new reaction');
      assert.deepEqual(state.presentation, {...prior.presentation, history: true});
      assert.deepEqual(snapshot.outcomes, previous.outcomes, 'same stored outcome IDs and messages');
      if (phase === 'candidate') {
        for (const outcome of previous.outcomes) assert.ok(snapshot.republished.includes(outcome.id));
      }
    }
    assert.equal(snapshot.outcomes.length, 1, 'startup creates no replacement outcome or command');
    snapshots.push(snapshot);
  }
  assert.equal(new Set(snapshots.map(value => value.pid)).size, 4);
});
