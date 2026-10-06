// Translated from codex-nanoleaf tests/test_comets.py: the cases that need only placement, comets and mode commands
// (PORTING.md lists the rest). Tasks come from the shared feed instead of hook events; the shared input only section of
// PORTING.md says what that changes. recorded/edits.json runs the same steps through Python.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {currentComet, pruneComets} from '../src/comets.js';
import {dashboard} from '../src/line-projection.js';
import type {RenderConfig, Flash} from '../src/renderer.js';
import {controlState} from '../src/store.js';
import {Clock, Feed, query, setMode, suite, temporary, test, write} from './support.js';

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
});
