// Translated from codex-nanoleaf tests/test_project_map.py: the placement, metadata, edit and rendering receipt cases
// (PORTING.md lists the rest). Each wall action runs as edits did in the wall's update; the wall view is read through
// the test's wall view.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {currentComet, pruneComets} from '../src/comets.js';
import {withState} from '../src/database.js';
import * as edits from '../src/edits.js';
import {dashboard, type Indication} from '../src/line-projection.js';
import {applyPending, lineId, locateState, Metadata, normalize, owners, renderConfig, renderingSnapshot, type Rendering} from '../src/project-map.js';
import type {RenderConfig} from '../src/renderer.js';
import {execute} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import {Clock, completion, query, setMode, suite, taskRow, temporary, test, wallView, write, type WallView} from './support.js';

/** SceneTest.setUp's configuration. */
const CONFIG: RenderConfig = {ip: '192.168.1.207', token: 'PRIVATE_TEST_TOKEN',
  line_groups: Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]), line_positions: Array.from({length: 15}, (_, i) => [i * 10, 0])};

/** ProjectTest: two saved projects, tasks prompted on a test clock, and the wall's actions and view. */
class Projects {
  readonly directory: string;
  readonly clock = new Clock();

  constructor(context: TestContext) {
    this.directory = temporary(context);
    write(this.directory, db => {
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', 'a', 'Project A', '#aa55ff', '["/home/tester/projects/a"]');
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', 'b', 'Project B', '#33ccee', '["C:/repo/b"]');
    });
  }

  task(session: string, project: string | null): void {
    write(this.directory, db => {
      taskRow(db, session, '1', this.clock.now());
      execute(db, 'UPDATE task_info SET project=? WHERE session=?', project, session);
    });
  }

  /** The task's completion, which queues a comet on the Lines in Work. */
  stop(session: string): void {
    write(this.directory, db => completion(db, session, '1', this.clock.now()));
  }

  /** ProjectTest.assign: the wall's assign action for these Lines. */
  assign(slots: Iterable<number>, project: string): void {
    const lines = Object.fromEntries([...slots].map(slot => [lineId(CONFIG.line_groups[slot] ?? []), {project}]));
    write(this.directory, db => edits.assign(db, CONFIG, lines));
  }

  settings(changes: unknown): void {
    write(this.directory, db => edits.settings(db, CONFIG, changes));
  }

  /** ProjectTest.prepare: prune comets, apply a pending edit, place the tasks and add the map's render settings. */
  prepare(): [RenderConfig, Indication[]] {
    return write(this.directory, db => {
      pruneComets(db, this.clock.now(), controlState(db).mode);
      applyPending(db);
      const snapshot = dashboard(db, CONFIG, this.clock.now());
      const config = structuredClone(CONFIG);
      renderConfig(db, config, snapshot);
      return [config, snapshot];
    });
  }

  /** The worker starting the first queued comet. */
  startComet(instant = this.clock.now()): void {
    write(this.directory, db => currentComet(db, instant));
  }

  view(): WallView {
    return wallView(this.directory, CONFIG, this.clock.now());
  }

  /** wall_server.App.rendering: the Lines' rendering receipt as the worker last saved it. */
  rendering(): Rendering {
    return withState(this.directory, db => {
      const control = controlState(db);
      return renderingSnapshot(db, CONFIG, control.mode, control.revision !== control.applied, control.error, this.clock.now());
    });
  }

  slots(): unknown[] {
    return query(this.directory, 'SELECT slot FROM slots').map(row => row[0]);
  }
}

suite('ProjectTest', () => {
  test('test_project_capacity_three_reserved_two_shared', context => {
    const p = new Projects(context);
    p.assign([0, 1, 2], 'a');
    p.assign(Array.from({length: 10}, (_, i) => i + 5), 'b');
    p.settings({style: 'project'});
    for (let i = 0; i < 5; i += 1) p.task(String(i), 'a');
    p.prepare();
    assert.deepEqual(new Set(p.slots()), new Set([0, 1, 2, 3, 4]));
    p.task('overflow', 'a');
    p.prepare();
    assert.deepEqual(query(p.directory, "SELECT slot FROM slots WHERE session='overflow'"), []);
    assert.equal(wallView(p.directory, CONFIG, 1000).projects.find(project => project.id === 'a')?.waiting, 1);
  });

  test('test_classic_ignores_reservations_and_keeps_saved_settings', context => {
    const p = new Projects(context);
    p.assign(Array.from({length: 15}, (_, i) => i), 'b');
    p.task('a', 'a');
    p.prepare();
    assert.deepEqual(p.slots(), [0]);
    p.settings({style: 'project'});
    p.prepare();
    assert.deepEqual(p.slots(), []);
    p.settings({style: 'classic'});
    p.prepare();
    assert.deepEqual(p.slots(), [0]);
    assert.equal(query(p.directory, "SELECT * FROM line_prefs WHERE project='b'").length, 15);
  });

  test('test_reassignment_moves_task_without_resetting_epoch', context => {
    const p = new Projects(context);
    p.task('a', 'a');
    p.prepare();
    const old = query(p.directory, 'SELECT started FROM activity');
    p.settings({style: 'project'});
    p.assign([0], 'b');
    p.prepare();
    assert.deepEqual(p.slots(), [1]);
    assert.deepEqual(query(p.directory, 'SELECT started FROM activity'), old);
  });

  test('test_legacy_untitled_tasks_use_distinct_session_suffixes', context => {
    const p = new Projects(context);
    for (const suffix of ['5b1e07c2', '4227761b']) p.task('019a1234-0000-7000-8000-0000' + suffix, null);
    assert.deepEqual(wallView(p.directory, CONFIG, 1000).tasks.map(task => task.title).sort(), ['Codex 4227761b', 'Codex 5b1e07c2']);
  });

  test('test_metadata_paths_titles_and_manual_override', context => {
    // The prompt's working directory is saved as Python's event recorder saved it.
    const p = new Projects(context);
    p.task('a', null);
    write(p.directory, db => execute(db, "UPDATE task_info SET cwd='/mnt/c/repo/b/subdir' WHERE session='a'"));
    const metadata = new Metadata({});
    metadata.titles = new Map([['a', 'Actual task title']]);
    write(p.directory, db => metadata.sync(db));
    const task = (): {project: unknown; title: unknown} => {
      const first = wallView(p.directory, CONFIG, 1000).tasks[0];
      return {project: first?.project, title: first?.title};
    };
    assert.deepEqual(task(), {project: 'b', title: 'Actual task title'});
    write(p.directory, db => edits.taskProject(db, CONFIG, 'a', 'a'));
    assert.equal(task().project, 'a');
    write(p.directory, db => edits.taskProject(db, CONFIG, 'a', null));
    assert.equal(task().project, 'b');
    assert.equal(normalize('\\\\wsl.localhost\\Ubuntu\\home\\tester\\projects\\a'), '/home/tester/projects/a');
  });

  test('test_metadata_explicit_worktree_and_partial_state_retained', context => {
    const p = new Projects(context);
    p.task('s', null);
    const path = join(p.directory, 'desktop.json');
    const index = join(p.directory, 'index.jsonl');
    writeFileSync(path, JSON.stringify({'local-projects': {a: {name: 'A', rootPaths: ['/repo']}},
      'thread-project-assignments': {s: {projectId: 'a'}}, 'thread-workspace-root-hints': {s: '/tmp/worktree'}}));
    writeFileSync(index, JSON.stringify({id: 's', thread_name: 'Task <name>'}) + '\n');
    const metadata = new Metadata({metadata_path: path, title_index_path: index});
    metadata.refresh();
    write(p.directory, db => metadata.sync(db));
    writeFileSync(path, '{');
    writeFileSync(index, '{');
    metadata.refresh();
    write(p.directory, db => metadata.sync(db));
    assert.deepEqual(query(p.directory, 'SELECT title,project FROM task_info'), [['Task <name>', 'a']]);
  });

  test('test_stable_ids_across_layout_reorder', context => {
    const p = new Projects(context);
    p.assign([0], 'a');
    const reversed = {...CONFIG, line_groups: [...CONFIG.line_groups].reverse()};
    assert.equal(withState(p.directory, db => owners(db, reversed).at(-1)?.[0]), 'a');
  });

  test('test_metadata_valid_json_wrong_shape_is_ignored', context => {
    const p = new Projects(context);
    p.task('s', null);
    const path = join(p.directory, 'desktop.json');
    const index = join(p.directory, 'index.jsonl');
    writeFileSync(path, '[]');
    writeFileSync(index, '[]\nnull\n{"id":"s","thread_name":"Valid"}\n');
    const metadata = new Metadata({metadata_path: path, title_index_path: index});
    metadata.refresh();
    write(p.directory, db => metadata.sync(db));
    assert.deepEqual(query(p.directory, 'SELECT title FROM task_info'), [['Valid']]);
    assert.equal(normalize('\\\\wsl$\\Ubuntu\\mnt\\c\\REPO\\b\\..\\b'), 'c:/repo/b');
  });

  test('test_active_comet_defers_mapping_and_style', context => {
    const p = new Projects(context);
    p.task('a', 'a');
    p.stop('a');
    p.prepare();
    p.startComet();
    p.assign([0], 'b');
    p.settings({style: 'project'});
    assert.notEqual(p.view().pending, null);
    assert.equal(p.view().settings.style, 'classic');
    p.clock.sleep(2);
    p.prepare();
    assert.equal(p.view().pending, null);
    assert.equal(p.view().settings.style, 'project');
    assert.deepEqual(p.slots(), [1]);
  });

  test('test_color_changes_do_not_restart_task', context => {
    const p = new Projects(context);
    p.task('a', 'a');
    p.settings({style: 'project'});
    const [cfg, snap] = p.prepare();
    const before = query(p.directory, 'SELECT * FROM activity');
    write(p.directory, db => edits.projectColor(db, 'a', '#123456'));
    const [cfg2, snap2] = p.prepare();
    assert.deepEqual(query(p.directory, 'SELECT * FROM activity'), before);
    assert.deepEqual(snap2, snap);
    assert.notDeepEqual(cfg2._signatures, cfg._signatures);
  });

  test('test_locate_waits_for_comet_and_free_rejects', context => {
    const p = new Projects(context);
    p.task('a', 'a');
    p.stop('a');
    p.prepare();
    p.startComet(1000);
    const line = lineId(CONFIG.line_groups[3] ?? []);
    write(p.directory, db => edits.locate(db, CONFIG, line));
    write(p.directory, db => {
      assert.equal(locateState(db, CONFIG, 1001, 'work'), null);
      pruneComets(db, 1002, 'work');
      assert.equal(locateState(db, CONFIG, 1002, 'work')?.source, 3);
      assert.equal(locateState(db, CONFIG, 1003, 'work'), null);
    });
    setMode(p.directory, 'free');
    assert.throws(() => write(p.directory, db => edits.locate(db, CONFIG, line)), {name: 'ValueError'});
  });

  test('test_api_validation_and_no_credentials', context => {
    // Partly: the wall view, which moves with #844, keeps its own check that it shows no credential or private content.
    const p = new Projects(context);
    p.task('a', 'a');
    assert.throws(() => p.settings({style: 'bad'}), {name: 'ValueError'});
    assert.throws(() => write(p.directory, db => edits.projectColor(db, 'a', 'red; script')), {name: 'ValueError'});
    assert.throws(() => write(p.directory, db => edits.assign(db, CONFIG, {unknown: {project: 'a'}})), {name: 'ValueError'});
  });

  test('test_pending_half_edit_preserves_pending_owner', context => {
    const p = new Projects(context);
    p.task('a', 'a');
    p.stop('a');
    p.prepare();
    p.startComet(1000);
    const key = lineId(CONFIG.line_groups[0] ?? []);
    p.assign([0], 'b');
    write(p.directory, db => edits.assign(db, CONFIG, {[key]: {signature: 1}}));
    assert.deepEqual(p.view().pending?.lines?.[key], {project: 'b', signature: 1});
    p.clock.sleep(2);
    p.prepare();
    assert.deepEqual(query(p.directory, 'SELECT project,signature FROM line_prefs'), [['b', 1]]);
  });

  test('test_preferences_persist_after_reopen', context => {
    const p = new Projects(context);
    p.assign([4], 'a');
    write(p.directory, db => edits.projectColor(db, 'a', '#113355'));
    p.settings({style: 'project', coverage: 'status', rotation: 270, flip_y: 1});
    const reopened = p.view();
    assert.deepEqual(reopened.settings, {style: 'project', coverage: 'status', rotation: 270, flip_x: 0, flip_y: 1});
    assert.equal(reopened.projects.find(project => project.id === 'a')?.color, '#113355');
    assert.deepEqual(query(p.directory, 'SELECT project FROM line_prefs'), [['a']]);
  });

  test('test_rendering_endpoint_reports_pending_failed_free_and_unknown', context => {
    const p = new Projects(context);
    const receipt = {apiVersion: '1.0', deviceId: 'wall', effect: {write: {animData: 'frames'}}};
    const meta = (sql: string, ...params: string[]): void => write(p.directory, db => execute(db, sql, ...params));
    meta('INSERT OR REPLACE INTO meta VALUES (?,?)', 'rendering_receipt', JSON.stringify(receipt));
    assert.equal(p.rendering().outcome, 'last-sent');
    meta("INSERT OR REPLACE INTO meta VALUES ('dirty','1')");
    assert.equal(p.rendering().outcome, 'pending');
    meta("DELETE FROM meta WHERE key='dirty'");
    meta("INSERT OR REPLACE INTO meta VALUES ('control_error','Light update failed; retrying.')");
    assert.equal(p.rendering().outcome, 'failed');
    meta("DELETE FROM meta WHERE key='control_error'");
    meta("INSERT OR REPLACE INTO meta VALUES ('mode','free')");
    assert.equal(p.rendering().outcome, 'externally-controlled');
    meta("DELETE FROM meta WHERE key='rendering_receipt'");
    assert.equal(p.rendering().outcome, 'externally-controlled');
    meta("DELETE FROM meta WHERE key='mode'");
    assert.equal(p.rendering().outcome, 'unknown');
  });
});
