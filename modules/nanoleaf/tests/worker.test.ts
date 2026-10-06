// Translated from codex-nanoleaf tests/test_bridge.py: the worker and display receipt cases (PORTING.md lists every case).
// The worker runs on shared input, so it keeps running until its stop signal: each case runs it to a set time on a
// manual clock, with tasks from the shared feed, and replays a case recorded from Python (record.WorkerCase).
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {BASELINE, COLORS, effectPayload, render, type RenderConfig, type RenderingReceipt} from '../src/renderer.js';
import type {Indication} from '../src/line-projection.js';
import {updateDisplay} from '../src/worker.js';
import {decode, framesOf, query, suite, temporary, test, writeAsync} from './support.js';
import {keyOf, NamedError, replay, scheduledOf, SCENE} from './worker-support.js';

/** BridgeTest.setUp's configuration. */
const BRIDGE: RenderConfig = {ip: '192.168.1.207', token: 'test', line_groups: SCENE.line_groups, line_positions: SCENE.line_positions};

function bridge(context: TestContext): string {
  const directory = temporary(context);
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ip: BRIDGE.ip, token: 'test'}));
  return directory;
}

const statusesOf = (sends: readonly [unknown, number, boolean][]): unknown[] =>
  sends.map(([snapshot]) => (snapshot as ([string, number] | null)[]).find(item => item !== null)?.[0] ?? null);
const loops = (sends: readonly [unknown, number, boolean][]): boolean[] => sends.map(([, , loop]) => loop);

suite('BridgeTest', () => {
  test('test_update_display_keeps_only_the_last_fully_successful_receipt', async context => {
    const directory = bridge(context);
    const receipt = {apiVersion: '1.0', deviceId: 'wall', effect: {write: {animData: '1 100 1 0'}}, lineGroups: [[100, 101]], mode: 'work',
      brightness: 30, loop: true, animationEpochMs: 1_000_000, acceptedAtMs: 1_000_650};
    const snapshot = (status: string, epoch: number): Indication[] => [[status, epoch], ...Array.from({length: 14}, () => null)];
    await writeAsync(directory, async db => updateDisplay(db, BRIDGE, snapshot('working', 1000), 1000, true, () => receipt));
    const saved = (): unknown => JSON.parse(String(query(directory, "SELECT value FROM meta WHERE key='rendering_receipt'")[0]?.[0]));
    assert.deepEqual(saved(), receipt);
    await assert.rejects(writeAsync(directory, async db => updateDisplay(db, BRIDGE, snapshot('blocked', 1001), 1001, false, () => {
      throw new NamedError('OSError', 'Device unavailable');
    })), {name: 'OSError'});
    assert.deepEqual(saved(), receipt);
  });

  test('test_update_display_persists_the_accepted_completion_comet', async context => {
    const directory = bridge(context);
    const calls: [string | undefined, unknown][] = [];
    const config: RenderConfig = {...BRIDGE, _mode: 'work', _comet: {source: 7, started: 1998}, _now: () => 2000.5,
      _controller_request: (_address, _method, endpoint, payload) => {
        calls.push([endpoint, payload]);
        return Promise.resolve(null);
      }};
    await writeAsync(directory, async db => updateDisplay(db, config, Array.from({length: 15}, () => null), 2000, false));
    const receipt = JSON.parse(String(query(directory, "SELECT value FROM meta WHERE key='rendering_receipt'")[0]?.[0])) as RenderingReceipt;
    assert.deepEqual(receipt.effect, calls[0]?.[1]);
    assert.deepEqual(receipt.lineGroups, BRIDGE.line_groups);
    assert.equal(receipt.mode, 'work');
    assert.equal(receipt.loop, false);
    assert.equal(receipt.animationEpochMs, 2_000_000);
    assert.equal(receipt.acceptedAtMs, 2_000_500);
  });

  test('test_first_working_pulse_radiates_then_only_local_loop', async context => {
    // Partly, shared input only: the worker passes at least once a second, so the radiating pulse is sent once a second
    // until it ends, where Python's legacy pass waited for the whole pulse.
    const {run} = await replay(context, 'first working pulse');
    assert.deepEqual(loops(run.sends), [false, false, true]);
    assert.deepEqual(run.sends.map(([, at]) => at), [1000, 1001, 1002]);
    const [snapshot, at, loop] = run.sends.at(-1) ?? [[], 0, false];
    const panels = decode(effectPayload(SCENE, snapshot, at, loop));
    const source = snapshot.findIndex(item => item !== null);
    SCENE.line_groups.forEach(([zone], index) => {
      const colors = new Set(framesOf(panels, zone).map(frame => JSON.stringify(frame.slice(0, 3))));
      if (index === source) {
        assert.ok(colors.has(JSON.stringify(COLORS.working)));
        assert.ok(colors.has(JSON.stringify([0, 51, 0])));
        assert.ok(!colors.has(JSON.stringify(BASELINE)));
      } else {
        assert.deepEqual([...colors], [JSON.stringify(BASELINE)]);
      }
    });
  });

  test('test_each_color_gets_one_radiating_pulse', async context => {
    // Partly, shared input only: as above, each status's radiating pulse is sent once a second until it ends.
    const {run} = await replay(context, 'each color');
    assert.deepEqual(statusesOf(run.sends), ['working', 'working', 'working', 'question', 'question', 'question', 'blocked', 'blocked', 'blocked']);
    for (const start of [0, 3, 6]) assert.deepEqual(loops(run.sends.slice(start, start + 3)), [false, false, true]);
    assert.deepEqual(query(run.directory, 'SELECT status FROM sessions'), [['blocked']]);
  });

  test('test_finished_and_interrupted_tasks_return_to_blue_not_off', async context => {
    // Partly, shared input only: a read or interrupted shared task stays on its Line as idle, shown in the base blue.
    const {run} = await replay(context, 'finished and interrupted');
    for (const index of [3, 7]) {
      const [snapshot, at, loop] = run.sends[index] ?? [[], 0, false];
      assert.equal(statusesOf([[snapshot, at, loop]])[0], 'idle');
      for (const frames of decode(effectPayload(SCENE, snapshot, at, loop)).values()) {
        assert.ok(frames.every(frame => JSON.stringify(frame.slice(0, 3)) === JSON.stringify(BASELINE)));
      }
    }
    const calls: unknown[][] = [];
    const config: RenderConfig = {...BRIDGE, _controller_request: (...args) => {
      calls.push(args);
      return Promise.resolve(null);
    }};
    await render(config, Array.from({length: 15}, () => null), 0, true);
    assert.deepEqual((calls.at(-1)?.[3] as {on: unknown}).on, {value: true});
    for (const frames of decode(calls[0]?.[3] as {write: {animData: string}}).values()) {
      assert.deepEqual(frames[0]?.slice(0, 3), [...BASELINE]);
    }
  });

  test('test_state_change_interrupts_animation_without_resetting_other_task_epoch', async context => {
    const {run} = await replay(context, 'state change interrupts');
    const [first, second] = run.sends;
    assert.ok(first !== undefined && second !== undefined);
    assert.ok(second[1] - first[1] <= 0.25);
    assert.deepEqual(query(run.directory, 'SELECT started FROM activity WHERE session=?', keyOf('a')), [[1000]]);
    assert.deepEqual(Object.fromEntries(query(run.directory, 'SELECT id,status FROM sessions')),
      {[keyOf('a')]: 'working', [keyOf('b')]: 'blocked'});
  });

  test('test_other_task_start_does_not_restore_old_radiation', async context => {
    const {run} = await replay(context, 'other task start');
    const epoch = Number(query(run.directory, 'SELECT started FROM activity WHERE session=?', keyOf('a'))[0]?.[0]);
    assert.equal(epoch, 1000);
    assert.ok((run.sends.at(-1)?.[1] ?? 0) - epoch >= 4);
  });

  test('test_task_slots_are_stable_and_completed_slots_can_be_reused', async context => {
    // Partly, shared input only: a completed shared task stays on its Line until the owner removes it, so the removal
    // frees the Line.
    const result = await replay(context, 'stable slots');
    const before = new Map((result.outcomes.find((_, index) => result.recorded.steps[index]?.[0] === 'query') as {result: [string, number][]})
      .result);
    const after = new Map(query(result.run.directory, 'SELECT session,slot FROM slots').map(([session, slot]) => [session, slot]));
    assert.equal(after.get(keyOf('new')), before.get(keyOf('3')));
    for (const [session, slot] of before) if (session !== keyOf('3')) assert.equal(after.get(session), slot);
  });

  test('test_concurrent_tasks_never_share_a_slot', async context => {
    // Partly: the tasks arrive in one owner revision each instead of from concurrent hook processes.
    const {run} = await replay(context, 'concurrent tasks');
    const slots = query(run.directory, 'SELECT slot FROM slots');
    assert.equal(slots.length, 15);
    assert.equal(new Set(slots.map(row => row[0])).size, 15);
    assert.equal(query(run.directory, 'SELECT * FROM sessions').length, 17);
  });

  test('test_failed_send_keeps_status_for_retry_on_next_event', async context => {
    const result = await replay(context, 'failed send');
    assert.deepEqual(result.outcomes[1], {result: {outcome: {error: 'RuntimeError', message: 'offline'}, scheduled: []}});
    assert.deepEqual(result.outcomes[2], {result: [['working']]});
    assert.equal(result.run.sends.at(-1)?.[2], true);
  });

  test('test_worker_recovers_if_finite_animation_was_interrupted_by_failure', async context => {
    // Partly, shared input only: the worker keeps watching the shared state, so it keeps its rendering mark.
    const result = await replay(context, 'recovery after a failed send');
    assert.deepEqual(result.outcomes[2], {result: [['1']]});
    assert.equal(result.run.sends.at(-1)?.[2], true);
    assert.deepEqual(result.outcomes[4], {result: [['1']]});
  });

  test('test_only_one_worker_and_state_updates_remain_available', async context => {
    // Partly: the second worker starts during the first one's wait, in one process, instead of from another thread.
    const result = await replay(context, 'one worker per device');
    assert.deepEqual(scheduledOf(result), [false, true, true]);
    assert.deepEqual(statusesOf(result.run.sends.slice(-1)), ['idle']);
  });
});

suite('RecoveryTest', () => {
  test('test_worker_polls_and_refreshes_metadata_in_free_without_legacy_unread_reads', async context => {
    // Partly, shared input only: the worker reads no feed and no unread file. In Free it sends nothing; refreshing Codex
    // metadata belongs to the acceptance of each envelope.
    const result = await replay(context, 'Free sends nothing');
    assert.deepEqual(result.run.sends, []);
    assert.deepEqual(query(result.run.directory, "SELECT value FROM meta WHERE key='mode'"), [['free']]);
  });
});

suite('worker checks the port adds', () => {
  test('a preview ends with the tasks shown again', async context => {
    // After a preview the worker forgets the display it last sent, so the next pass shows the task again.
    const {run} = await replay(context, 'a preview ends with the tasks shown again');
    const writes = run.device.calls.filter(([, method, endpoint]) => method === 'PUT' && endpoint === '/effects').map(([at]) => at);
    assert.ok(writes.includes(1003));
    assert.ok(writes.some(at => at > 1003 && at <= 1005.5));
  });

  test('the worker applies a wall edit the comet deferred, once the comet ends', async context => {
    const result = await replay(context, 'the worker applies a wall edit the comet deferred');
    const [, pendingDuring, styleDuring, pendingAfter, styleAfter] = scheduledOf(result);
    assert.equal((pendingDuring as unknown[]).length, 1);
    assert.deepEqual(styleDuring, [['classic']]);
    assert.deepEqual(pendingAfter, []);
    assert.deepEqual(styleAfter, [['project']]);
  });
});
