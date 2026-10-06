// Translated from codex-nanoleaf tests/test_shared_metadata.py (PORTING.md lists every case).
import assert from 'node:assert/strict';
import {unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {JsonObject} from '../src/compat.js';
import {withState} from '../src/database.js';
import {allocate, fallbackTitle, lineId, taskProjects} from '../src/project-map.js';
import {identityKey, SOURCE, type Envelope, type SharedSession} from '../src/shared-input.js';
import {execute, type Row} from '../src/sqlite.js';
import {accept, clone, configure, envelope, firstSession, query, selectionSetup, selectLegacy, selectShared, suite, test, wallView,
  write} from './support.js';

/** SharedMetadataTest.setUp: the selection fixture, Codex metadata files and their paths in the configuration. */
class Metadata {
  readonly path: string;
  readonly config: JsonObject;
  value: Envelope = envelope();
  session: SharedSession;
  readonly sid: string;
  key: string;
  readonly metadataPath: string;
  readonly index: string;

  constructor(context: TestContext) {
    ({path: this.path, config: this.config} = selectionSetup(context));
    this.session = firstSession(this.value);
    this.sid = this.session.identity.sessionId;
    this.key = identityKey(this.session.identity);
    delete this.session.label;
    delete this.session.projectId;
    this.metadataPath = join(this.path, 'metadata.json');
    this.index = join(this.path, 'session_index.jsonl');
    writeFileSync(join(this.path, 'config.json'), JSON.stringify({metadata_path: this.metadataPath, title_index_path: this.index}));
    this.writeMetadata();
  }

  writeMetadata(title = 'Real task title', assignment = true): void {
    writeFileSync(this.index, JSON.stringify({id: this.sid, thread_name: title}) + '\n');
    writeFileSync(this.metadataPath, JSON.stringify({
      'local-projects': {local: {name: 'Local project', rootPaths: ['/repo']}, nested: {name: 'Nested project', rootPaths: ['/repo/nested']}},
      'thread-project-assignments': assignment ? {[this.sid]: {projectId: 'local'}} : {},
      'thread-workspace-root-hints': {[this.sid]: '/repo/nested/src'}}));
  }

  detail(): Row {
    const row = query(this.path, 'SELECT title,project,manual_project FROM task_info WHERE session=?', this.key)[0];
    assert.ok(row !== undefined);
    return row;
  }

  select(): void {
    selectShared(this.path, this.value);
  }
}

suite('SharedMetadataTest', () => {
  test('test_local_title_and_project_enrich_shared_task', context => {
    const m = new Metadata(context);
    m.select();
    assert.deepEqual(m.detail(), ['Real task title', 'local', 'project']);
    assert.deepEqual(query(m.path, "SELECT name FROM projects WHERE id='local'"), [['Local project']]);
    // Manual preference wins in the allocation layer.
    assert.equal(withState(m.path, db => taskProjects(db).get(m.key)), 'project');
  });

  test('test_shared_title_and_project_precede_local_metadata', context => {
    // The shared-status inspection view is not ported; the wall view row is read through the test's wall view.
    const m = new Metadata(context);
    m.value.snapshot.apiVersion = '1.2';
    Object.assign(m.session, {title: {value: 'Shared task title', source: 'provider'}, project: 'Shared project', projectId: 'hub'});
    m.select();
    assert.deepEqual(m.detail(), ['Shared task title', 'shared-project-hub', 'project']);
    assert.deepEqual(query(m.path, "SELECT name FROM projects WHERE id='shared-project-hub'"), [['Shared project']]);
    assert.equal(wallView(m.path, {line_groups: [[100, 101]], line_positions: [[0, 0]]}, 1000).tasks[0]?.title, 'Shared task title');
    m.session.label = 'User label';
    accept(m.path, m.value, 1000);
    assert.equal(m.detail()[0], 'User label');
  });

  test('test_shared_claude_metadata_needs_no_local_reader', context => {
    const m = new Metadata(context);
    m.value.snapshot.apiVersion = '1.2';
    Object.assign(m.session.identity, {provider: 'claude', client: 'code'});
    Object.assign(m.session, {read: 'unknown', title: {value: 'Claude shared title', source: 'user'}, project: 'Shared workspace'});
    m.key = identityKey(m.session.identity);
    const source = Object.fromEntries(SOURCE.map(key => [key, m.session.identity[key]]));
    configure(m.path, {...m.config, qualifiedSources: [source], bindings: []});
    m.select();
    const [title, project, manual] = m.detail();
    assert.equal(title, 'Claude shared title');
    assert.ok(typeof project === 'string' && project.startsWith('shared-project-name:'));
    assert.deepEqual(query(m.path, 'SELECT name FROM projects WHERE id=?', project), [['Shared workspace']]);
    assert.equal(manual, null);
    delete m.session.title;
    delete m.session.project;
    accept(m.path, m.value, 1000);
    assert.ok(String(m.detail()[0]).startsWith('Claude '));
    assert.equal(m.detail()[1], null);
  });

  test('test_shared_metadata_updates_preserve_effects_and_project_preferences', context => {
    const m = new Metadata(context);
    m.value.snapshot.apiVersion = '1.2';
    Object.assign(m.session, {title: {value: 'Initial title', source: 'provider'}, projectId: 'hub', project: 'Initial project'});
    m.select();
    const before = [query(m.path, 'SELECT * FROM sessions'), query(m.path, 'SELECT * FROM activity')];
    write(m.path, db => execute(db, `UPDATE projects SET color='#abcdef',roots='["/local"]' WHERE id='shared-project-hub'`));
    if (m.session.title !== undefined) m.session.title.value = 'Updated title';
    m.session.project = 'Renamed project';
    accept(m.path, m.value, 1000);
    assert.deepEqual(m.detail(), ['Updated title', 'shared-project-hub', 'project']);
    assert.deepEqual(query(m.path, "SELECT name,color,roots FROM projects WHERE id='shared-project-hub'"), [['Renamed project', '#abcdef', '["/local"]']]);
    assert.deepEqual([query(m.path, 'SELECT * FROM sessions'), query(m.path, 'SELECT * FROM activity')], before);
  });

  test('test_enriched_project_controls_line_allocation', context => {
    const m = new Metadata(context);
    m.session.activity = 'active';
    write(m.path, db => execute(db, "UPDATE task_info SET manual_project=NULL WHERE session='legacy'"));
    m.select();
    const config = {line_groups: [[100, 101], [102, 103]]};
    const assigned = write(m.path, db => {
      execute(db, 'DELETE FROM slots');
      execute(db, "UPDATE map_settings SET style='project'");
      execute(db, 'INSERT INTO line_prefs (line_id,project,signature) VALUES (?,?,0)', lineId([100, 101]), 'nested');
      execute(db, 'INSERT INTO line_prefs (line_id,project,signature) VALUES (?,?,0)', lineId([102, 103]), 'local');
      return allocate(db, config, [[m.key, 'working', 1000]], new Set());
    });
    assert.deepEqual(assigned, new Map([[m.key, 1]]));
  });

  test('test_hub_precedence_and_other_provider_isolation', context => {
    const m = new Metadata(context);
    const other = clone(m.session);
    Object.assign(other.identity, {provider: 'claude', client: 'code'});
    other.read = 'unknown';
    const sources = m.config.qualifiedSources as JsonObject[];
    configure(m.path, {...m.config, qualifiedSources: [...sources, Object.fromEntries(SOURCE.map(key => [key, other.identity[key]]))]});
    m.value.snapshot.sessions.push(other);
    Object.assign(m.session, {label: 'Hub label', projectId: 'hub'});
    m.select();
    assert.deepEqual(m.detail(), ['Hub label', 'shared-project-hub', 'project']);
    const [title, project] = query(m.path, 'SELECT title,project FROM task_info WHERE session=?', identityKey(other.identity))[0] ?? [];
    assert.ok(String(title).startsWith('Claude '));
    assert.equal(project, null);
  });

  test('test_poll_refreshes_same_revision_without_lifecycle_or_effect_changes', context => {
    // The poller is not ported; its two ticks are the same-revision acceptances it made, each with a fresh metadata read.
    const m = new Metadata(context);
    m.select();
    const before = [query(m.path, 'SELECT * FROM sessions'), query(m.path, 'SELECT * FROM activity')];
    accept(m.path, m.value, 1001, {resync: true});
    write(m.path, db => execute(db, "UPDATE meta SET value='0' WHERE key='dirty'"));
    m.writeMetadata('Updated title', false);
    accept(m.path, m.value, 1002);
    assert.deepEqual(m.detail(), ['Updated title', 'nested', 'project']);
    assert.deepEqual([query(m.path, 'SELECT * FROM sessions'), query(m.path, 'SELECT * FROM activity')], before);
    assert.deepEqual(query(m.path, "SELECT value FROM meta WHERE key='dirty'"), [['1']]);
    // A fresh reader after restart preserves the same projection.
    accept(m.path, m.value, 1003);
    assert.equal(m.detail()[0], 'Updated title');
  });

  test('test_retired_session_is_not_recreated_by_metadata', context => {
    const m = new Metadata(context);
    m.select();
    m.value.snapshot.sessions = [];
    m.value.snapshot.revision += 1;
    accept(m.path, m.value, 1000);
    accept(m.path, m.value, 1000);
    for (const table of ['sessions', 'task_info', 'slots']) assert.deepEqual(query(m.path, 'SELECT * FROM ' + table), [], table);
  });

  test('test_missing_metadata_fallback_and_legacy_parity', context => {
    const m = new Metadata(context);
    unlinkSync(m.index);
    unlinkSync(m.metadataPath);
    const ids = ['019a1234-0000-7000-8000-00005b1e07c2', '019a1234-0000-7000-8000-00004227761b'];
    configure(m.path, {...m.config, bindings: []});
    m.session.identity.sessionId = ids[0] ?? '';
    const other = clone(m.session);
    other.identity.sessionId = ids[1] ?? '';
    m.value.snapshot.sessions.push(other);
    m.select();
    assert.deepEqual(query(m.path, 'SELECT title FROM task_info').map(row => row[0]).sort(), ['Codex 4227761b', 'Codex 5b1e07c2']);
    assert.equal(fallbackTitle('codex', ids[0] ?? ''), 'Codex 5b1e07c2');
  });

  test('test_source_switch_preserves_manual_preference', context => {
    const m = new Metadata(context);
    m.select();
    selectLegacy(m.path);
    assert.deepEqual(query(m.path, "SELECT manual_project FROM task_info WHERE session='legacy'"), [['project']]);
    m.select();
    assert.deepEqual(m.detail(), ['Real task title', 'local', 'project']);
  });
});
