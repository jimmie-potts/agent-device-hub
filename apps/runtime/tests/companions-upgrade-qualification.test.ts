import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

type Snapshot = {pid: number; record: Record<string, unknown>; outcomes: Array<{id: string; message: string}>;
  republished: string[]; boot: Record<string, unknown>};
type State = {settings: object; presentation: {history: boolean} | null};

async function qualify(restoreBaseline = false): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'companion-recovery-'));
  const snapshots: Snapshot[] = [];
  try {
    for (const phase of ['baseline', 'candidate', 'recovery', 'reupgrade']) {
      if (phase === 'recovery' && restoreBaseline) {
        await copyFile(join(directory, 'baseline.sqlite'), join(directory, 'companions.sqlite'));
      }
      const child = spawnSync(process.execPath,
        [fileURLToPath(new URL('./fixtures/companions-upgrade-phase.js', import.meta.url)), directory, phase],
        {encoding: 'utf8', timeout: 15_000});
      assert.equal(child.status, 0, child.stderr);
      const snapshot = JSON.parse(child.stdout) as Snapshot;
      const previous = snapshots.at(-1);
      if (previous) {
        for (const field of ['received', 'admissions', 'allowances']) {
          assert.deepEqual(snapshot.boot[field], previous.record[field], field + ' survives reopen');
          if (phase === 'candidate') {
            assert.notDeepEqual(snapshot.record[field], previous.record[field], field + ' has a distinct candidate write');
          } else {
            assert.deepEqual(snapshot.record[field], previous.record[field], field + ' is not consumed by recovery');
          }
        }
        const state = snapshot.record.state as State, prior = previous.record.state as State;
        assert.deepEqual((snapshot.boot.state as State).settings, prior.settings);
        assert.ok(state.presentation && prior.presentation);
        if (phase === 'candidate') {
          assert.notDeepEqual(state.settings, prior.settings, 'candidate settings distinguish the latest database');
          assert.notDeepEqual(state.presentation, {...prior.presentation, history: true});
          for (const outcome of previous.outcomes) {
            assert.ok(snapshot.outcomes.some(value => value.id === outcome.id && value.message === outcome.message));
            assert.ok(snapshot.republished.includes(outcome.id));
          }
        } else {
          assert.deepEqual(state.settings, prior.settings);
          assert.equal(state.presentation.history, true, 'retained presentation is history, not a new reaction');
          assert.deepEqual(state.presentation, {...prior.presentation, history: true});
          assert.deepEqual(snapshot.outcomes, previous.outcomes, 'same stored outcome IDs and messages');
          // The SDK may republish retained outcomes after restart. Identical
          // stored IDs/messages above distinguish that from command replay.
          for (const outcome of previous.outcomes) assert.ok(snapshot.republished.includes(outcome.id));
        }
      }
      assert.equal(snapshot.outcomes.length, phase === 'baseline' ? 1 : 2,
        'only the baseline and candidate commands create outcomes');
      snapshots.push(snapshot);
      if (phase === 'baseline' && restoreBaseline) {
        await copyFile(join(directory, 'companions.sqlite'), join(directory, 'baseline.sqlite'));
      }
    }
    assert.equal(new Set(snapshots.map(value => value.pid)).size, 4);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

void test('four companion processes retain latest candidate records and outcomes without rebuilding reactions', () => qualify());
void test('companion qualification rejects restoration of the older stopped baseline', async () => {
  await assert.rejects(qualify(true), /received survives reopen/);
});
