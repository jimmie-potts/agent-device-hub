// Translated from codex-nanoleaf tests/test_comets.py (PORTING.md lists every case). The worker cases replay cases recorded
// from Python (worker-support.ts); recorded/edits.json runs the other cases' steps through Python. Tasks come from the
// shared feed instead of hook events; the shared input only section of PORTING.md says what that changes.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {currentComet, pruneComets} from '../src/comets.js';
import {dashboard} from '../src/line-projection.js';
import type {RenderConfig, Flash} from '../src/renderer.js';
import {controlState} from '../src/store.js';
import {playPreview} from '../src/worker.js';
import {Clock, Feed, query, setMode, suite, temporary, test, write} from './support.js';
import {effects, keyOf, replay, scheduledOf, type Replay} from './worker-support.js';

/** SceneTest.setUp's configuration. */
const CONFIG: RenderConfig = {ip: '192.168.1.207', token: 'PRIVATE_TEST_TOKEN',
  line_groups: Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]), line_positions: Array.from({length: 15}, (_, i) => [i * 10, 0])};

/** CometTest: shared input selected on a test clock, the Lines registered, and the owner's sessions. */
class Comets {
  readonly directory: string;
  readonly clock = new Clock();
  readonly feed = new Feed();

  constructor(context: TestContext) {
    this.directory = temporary(context);
    writeFileSync(join(this.directory, 'config.json'), JSON.stringify(CONFIG));
    this.feed.select(this.directory, this.clock.now());
  }

  prompt(session: string): void {
    this.feed.publish(this.directory, 'prompt', session, this.clock.now());
  }

  /** CometTest.complete: a turn starts and completes with a fresh notice. */
  complete(session: string): void {
    this.prompt(session);
    this.feed.publish(this.directory, 'stop', session, this.clock.now());
  }

  /** CometTest.prepare: prune the comets, place the tasks and start the next comet. */
  prepare(): Flash | null {
    return write(this.directory, db => {
      pruneComets(db, this.clock.now(), controlState(db).mode);
      dashboard(db, CONFIG, this.clock.now());
      return currentComet(db, this.clock.now());
    });
  }

  mode(mode: string): void {
    setMode(this.directory, mode, this.clock.now());
  }
}

suite('CometTest', () => {
  test('test_completion_without_slot_waits_for_assignment', context => {
    // Partly, shared input only: an interrupted shared task stays on its Line as idle, so the owner removing the task
    // frees the Line where Python's interrupt did.
    const c = new Comets(context);
    for (let i = 0; i < 15; i += 1) c.prompt(String(i));
    c.prepare();
    c.complete('extra');
    assert.equal(c.prepare(), null);
    c.feed.publish(c.directory, 'end', '0', c.clock.now());
    assert.notEqual(c.prepare(), null);
  });

  test('test_free_quiet_clear_queue_and_do_not_accumulate', context => {
    const c = new Comets(context);
    for (const mode of ['free', 'quiet']) {
      c.mode('work');
      c.complete('a');
      c.complete('b');
      c.prepare();
      c.mode(mode);
      assert.deepEqual(query(c.directory, 'SELECT * FROM comets'), [], mode);
      c.complete('c');
      assert.deepEqual(query(c.directory, 'SELECT * FROM comets'), [], mode);
      c.mode('work');
      assert.equal(c.prepare(), null, mode);
    }
  });

  test('test_expired_comet_not_replayed_after_restart', context => {
    // Partly, shared input only: Python's repeated Stop event is the owner publishing the same state again.
    const c = new Comets(context);
    c.complete('a');
    c.prepare();
    c.clock.sleep(3);
    assert.equal(c.prepare(), null);
    c.feed.publish(c.directory, 'touch', '', c.clock.now());
    assert.deepEqual(query(c.directory, 'SELECT * FROM comets'), []);
  });

  test('test_completions_queue_in_order_and_duplicate_stop_is_ignored', async context => {
    // Partly, shared input only: Python's repeated Stop event is the owner publishing the same state again.
    const result = await replay(context, 'completions queue in order');
    const results = queryResults(result);
    assert.deepEqual(results[0], [[keyOf('a')], [keyOf('b')]]);
    const [first, second] = prepared(result);
    assert.deepEqual(results[1], [[keyOf('a')]]);
    assert.deepEqual(results[2], [[keyOf('b')]]);
    assert.ok(first !== null && second !== null && first !== undefined && second !== undefined);
    assert.notEqual(first.source, second.source);
  });

  test('test_read_queued_task_is_skipped', async context => {
    // Partly, shared input only: owner read evidence clears the queued task, where Python read the Codex unread file.
    const result = await replay(context, 'a read queued task is skipped');
    assert.equal(prepared(result).at(-1), null);
    assert.deepEqual(queryResults(result).at(-1), []);
  });

  test('test_new_turn_and_interrupt_cancel_active_comet', async context => {
    // Partly, shared input only: a new turn ends the running comet. An interrupt reported after the completion leaves the
    // task unread, so its comet runs on; Python's interrupt hook event made the task idle.
    const result = await replay(context, 'a new turn or an interrupt ends the comet');
    const [afterTurn, afterInterrupt] = queryResults(result) as unknown[][];
    assert.deepEqual(afterTurn, []);
    assert.equal(afterInterrupt?.length, 1);
  });

  test('test_read_during_comet_finishes_before_scene_returns', async context => {
    // Partly, shared input only: a read task stays on its Line, so the scene returns once the owner removes it; the
    // comet still finishes first.
    const {run} = await replay(context, 'read during a comet');
    const selections = run.device.calls.filter(([, method, endpoint, payload]) => method === 'PUT' && endpoint === '/effects'
      && typeof payload === 'object' && payload !== null && 'select' in payload);
    assert.deepEqual((selections.at(-1)?.[3] as {select: string}).select, 'Beach Waves');
    assert.ok((selections.at(-1)?.[0] ?? 0) >= 1005);
    const [first] = effects(run.device.calls);
    assert.ok(first !== undefined && [...first[1].values()].some(panel => panel.some(frame => frame.slice(0, 3).join() === '255,255,255')));
    assert.deepEqual(query(run.directory, 'SELECT * FROM comets'), []);
  });

  test('test_start_time_survives_failed_send_and_restart', async context => {
    // The comet's start is read from the saved rows during the second run; Python read it from each request's configuration.
    const result = await replay(context, 'comet start survives a failed send');
    assert.deepEqual(queryResults(result)[0], [[1000]]);
    assert.deepEqual(scheduledOf(result, 1)[0], [[1000]]);
  });

  test('test_queued_comets_play_sequentially_in_worker', async context => {
    // The running comet is read from the saved rows during the run; Python read it from each request's configuration.
    const result = await replay(context, 'queued comets play in turn');
    const starts = new Map((scheduledOf(result).slice(0, 4) as [string, number, number][][]).flat().map(([session, , started]) => [session, started]));
    assert.equal(starts.size, 2);
    const [first = 0, second = 0] = [...starts.values()];
    assert.ok(second - first >= 2);
  });

  test('test_switch_to_free_interrupts_active_comet_and_discards_queue', async context => {
    const {run} = await replay(context, 'Free ends the comet and the queue');
    assert.deepEqual(query(run.directory, 'SELECT * FROM comets'), []);
    assert.equal(run.device.selected, 'Beach Waves');
    assert.ok(run.device.calls.filter(([, method]) => method === 'PUT').every(([at]) => at < 1001));
  });

  test('test_preview_uses_no_fake_tasks_and_is_finite', async () => {
    const sent: [RenderConfig, readonly unknown[], boolean][] = [];
    const clock = new Clock();
    await playPreview(CONFIG, 'comet', (config, snapshot, _instant, loop) => { sent.push([config, snapshot, loop]); },
      seconds => { clock.sleep(seconds); return Promise.resolve(); }, clock.now);
    assert.equal(sent.length, 1);
    assert.ok(!(sent[0]?.[1] ?? [1]).some(item => item !== null));
    assert.equal(sent[0]?.[0]._comet?.source, 7);
    assert.equal(sent[0]?.[2], false);
    assert.equal(clock.now(), 1002);
  });
});

/** The results of a replayed case's queries, in order. */
function queryResults(result: Replay): unknown[] {
  return result.recorded.steps.flatMap((step, index) => {
    const outcome = result.outcomes[index];
    return step[0] === 'query' && outcome !== undefined && 'result' in outcome ? [outcome.result] : [];
  });
}

/** The comets a replayed case's prepare steps started. */
function prepared(result: Replay): (Flash | null)[] {
  return result.recorded.steps.flatMap((step, index) => {
    const outcome = result.outcomes[index];
    return step[0] === 'prepare' && outcome !== undefined && 'result' in outcome ? [outcome.result as Flash | null] : [];
  });
}
