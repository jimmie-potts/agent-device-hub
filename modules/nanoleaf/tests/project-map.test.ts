// Translated from codex-nanoleaf tests/test_project_map.py: the placement and metadata cases (PORTING.md lists the rest).
// Map edits are ported with the edits slice, so a reservation or layout choice is saved here as the edit would save it
// when no comet defers it: one line_prefs row per element and the device's map_settings row.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {withState} from '../src/database.js';
import {dashboard} from '../src/line-projection.js';
import {lineId, Metadata, normalize, owners} from '../src/project-map.js';
import {execute, type Db} from '../src/sqlite.js';
import {legacyPrompt, query, suite, temporary, test, wallView, write} from './support.js';

const CONFIG = {line_groups: Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]),
  line_positions: Array.from({length: 15}, (_, i) => [i * 10, 0])};

/** ProjectTest: two saved projects, legacy tasks prompted at 1000 and the wall's map preferences. */
class Projects {
  readonly directory: string;

  constructor(context: TestContext) {
    this.directory = temporary(context);
    write(this.directory, db => {
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', 'a', 'Project A', '#aa55ff', '["/home/tester/projects/a"]');
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', 'b', 'Project B', '#33ccee', '["C:/repo/b"]');
    });
  }

  task(session: string, project: string | null): void {
    write(this.directory, db => {
      legacyPrompt(db, session, '1', 1000);
      execute(db, 'UPDATE task_info SET project=? WHERE session=?', project, session);
    });
  }

  /** The saved result of the wall's assign edit for these Lines. */
  assign(slots: Iterable<number>, project: string): void {
    write(this.directory, db => {
      for (const slot of slots) {
        const id = lineId(CONFIG.line_groups[slot] ?? []);
        execute(db, 'INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) VALUES (?,?,COALESCE((SELECT signature FROM line_prefs WHERE line_id=? AND device=?),0),?)',
          id, project, id, 'wall', 'wall');
      }
    });
  }

  style(style: string): void {
    write(this.directory, db => execute(db, "UPDATE map_settings SET style=? WHERE device='wall'", style));
  }

  /** The worker's placement pass, which here prunes no comet and applies no pending edit. */
  prepare(): void {
    write(this.directory, (db: Db) => dashboard(db, CONFIG, 1000));
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
    p.style('project');
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
    p.style('project');
    p.prepare();
    assert.deepEqual(p.slots(), []);
    p.style('classic');
    p.prepare();
    assert.deepEqual(p.slots(), [0]);
    assert.equal(query(p.directory, "SELECT * FROM line_prefs WHERE project='b'").length, 15);
  });

  test('test_reassignment_moves_task_without_resetting_epoch', context => {
    const p = new Projects(context);
    p.task('a', 'a');
    p.prepare();
    const old = query(p.directory, 'SELECT started FROM activity');
    p.style('project');
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
    // The hook event's working directory is saved as the legacy event recorder saves it.
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
    write(p.directory, db => execute(db, "UPDATE task_info SET manual_project='a' WHERE session='a'"));
    assert.equal(task().project, 'a');
    write(p.directory, db => execute(db, "UPDATE task_info SET manual_project=NULL WHERE session='a'"));
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
});
