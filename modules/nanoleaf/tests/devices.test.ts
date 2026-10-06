// Translated from codex-nanoleaf tests/test_devices.py, the schema cases of tests/test_bridge.py and the geometry and
// reservation cases of tests/test_panels.py (PORTING.md lists every case and where the rest went). Device configuration
// loading is translated here and in configuration.test.ts.
import assert from 'node:assert/strict';
import {copyFileSync, existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {currentComet} from '../src/comets.js';
import type {JsonObject} from '../src/compat.js';
import {withState} from '../src/database.js';
import {loadConfig} from '../src/configuration.js';
import {columns, DEFAULT, layoutDevices, projection, registry, saveLayout, validateElements} from '../src/devices.js';
import {writeJson} from '../src/jsonfile.js';
import {dashboard} from '../src/line-projection.js';
import {modeStatus} from '../src/modes.js';
import {readLayout} from '../src/panels.js';
import {SceneRestorer} from '../src/scenes.js';
import {allocate, applyPatch, locateState, owners, pending, requestPatch, settings, type TaskRow} from '../src/project-map.js';
import {execute, rows, type Row} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import {FIXTURES, fixtureJson, query, refuse, setMode, suite, taskRow, temporary, test, write} from './support.js';

const LINUX_STATE = join(FIXTURES, 'linux-state-v4');

function writeTwoDevices(directory: string): void {
  writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fakeLines', panelsToken: 'fakePanels',
    devices: {wall: {kind: 'lines', ip: '192.0.2.1', token_ref: 'token'}, panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
  writeJson(join(directory, 'layout.json'), {version: 2, devices: {
    wall: {kind: 'lines', elements: [{id: '5:6', number: 1, zones: [5, 6], position: [0, 0]}, {id: '7:8', number: 2, zones: [7, 8], position: [10, 0]}]},
    panels: {kind: 'panels', elements: [{id: '5', number: 1, zones: [5], position: [0, 0]}, {id: '6', number: 2, zones: [6], position: [10, 0]},
      {id: '7', number: 3, zones: [7], position: [20, 0]}]}}});
}

const MIGRATED_COLUMNS: Record<string, string> = {
  sessions: 'id, turn, status, updated', activity: 'session, turn, status, started', receipts: 'session, turn, completed, observed',
  waits: 'session, turn, key, kind, tool', task_info: 'session, title, cwd, project, manual_project, turn, started', projects: 'id, name, color, roots',
  slots: 'session, slot', comets: 'session, turn, queued, source, started', line_prefs: 'line_id, project, signature',
  map_settings: 'style, coverage, rotation, flip_x, flip_y', map_pending: 'payload', locate: 'line_id, started', display_v3: 'snapshot, looping, rendered',
  meta: 'key, value', controller_meta: 'id, payload', controller_credentials: 'principal, digest, scopes, active',
  controller_requests: 'sequence, request, receipt, principal, phase, created, mode_revision', controller_events: 'sequence, payload',
  integration_meta: 'id, sequence', integration_requests: 'sequence, principal, request, receipt, phase, created, revision',
  shared_input: 'id, source, generation, config, envelope, received, connection, error, backup'};

const byText = (values: readonly Row[]): Row[] => [...values].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

function migratedRows(db: DatabaseSync): Record<string, Row[]> {
  return Object.fromEntries(Object.entries(MIGRATED_COLUMNS).map(([table, names]) => [table, byText(rows(db, `SELECT ${names} FROM ${table}`))]));
}

/** sqlite3's iterdump: the schema and every row, in a stable order. */
function dumpAll(db: DatabaseSync): unknown[] {
  const schema = rows(db, "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name");
  const tables = rows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(row => String(row[0]));
  return [schema, ...tables.map(table => rows(db, `SELECT * FROM "${table}" ORDER BY rowid`))];
}

function loadLinuxState(directory: string): void {
  // The fixture copies carry a suffix so the private-state ignore rules do not hide them.
  copyFileSync(join(LINUX_STATE, 'config-fixture.json'), join(directory, 'config.json'));
  copyFileSync(join(LINUX_STATE, 'layout-fixture.json'), join(directory, 'layout.json'));
  copyFileSync(join(LINUX_STATE, 'scene-state-fixture.json'), join(directory, 'scene-state.json'));
  const db = new DatabaseSync(join(directory, 'status.sqlite'));
  db.exec(readFileSync(join(LINUX_STATE, 'status.sql'), 'utf8'));
  db.close();
}

suite('DeviceTest', () => {
  // AC4 and AC6: layout shapes. Nothing here may reach a device: every load refuses at the request.
  test('test_legacy_layout_loads_as_default_device_without_request', async context => {
    const directory = temporary(context);
    writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fake'});
    const groups = Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]);
    const positions = Array.from({length: 15}, (_, i) => [i * 10, 0]);
    writeJson(join(directory, 'layout.json'), {line_groups: groups, line_positions: positions});
    const disk = readFileSync(join(directory, 'layout.json'));
    const config = await loadConfig(directory, DEFAULT, refuse);
    assert.deepEqual([config.device, config.kind], ['wall', 'lines']);
    assert.deepEqual(config.line_groups, groups);
    assert.deepEqual(config.line_positions, positions);
    assert.deepEqual(config.elements.map(e => e.number), Array.from({length: 15}, (_, i) => i + 1));
    assert.deepEqual(config.elements[0], {id: '100:101', number: 1, zones: [100, 101], position: [0, 0]});
    assert.deepEqual(readFileSync(join(directory, 'layout.json')), disk);
    assert.deepEqual((await loadConfig(directory, 'wall', refuse)).elements, config.elements);
    assert.ok(!JSON.stringify(config.elements).includes('devices'));
  });

  test('test_version_two_layout_with_lines_and_triangles', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    const lines = await loadConfig(directory, DEFAULT, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    assert.deepEqual([lines.device, lines.ip, lines.token], ['wall', '192.0.2.1', 'fakeLines']);
    assert.deepEqual([panels.device, panels.kind, panels.ip, panels.token], ['panels', 'panels', '192.0.2.2', 'fakePanels']);
    assert.deepEqual(lines.line_groups, [[5, 6], [7, 8]]);
    assert.deepEqual(panels.line_groups, [[5], [6], [7]]);
    assert.deepEqual(panels.elements.map(e => e.id), ['5', '6', '7']);
    assert.deepEqual([...registry(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))).keys()].sort(), ['panels', 'wall']);
    await assert.rejects(loadConfig(directory, 'unknown', refuse), {name: 'ValueError'});
  });

  test('test_registry_address_change_keeps_identity_and_preferences', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    write(directory, db => applyPatch(db, {lines: {'5:6': {project: 'kept'}}}));
    const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')) as {ip: string; devices: {wall: {ip: string}}};
    config.ip = '192.0.2.99';
    config.devices.wall.ip = '192.0.2.99';
    writeJson(join(directory, 'config.json'), config);
    const moved = await loadConfig(directory, DEFAULT, refuse);
    assert.deepEqual([moved.device, moved.ip], ['wall', '192.0.2.99']);
    assert.deepEqual(withState(directory, db => owners(db, moved)[0]), ['kept', 0]);
  });

  test('test_malformed_layout_is_rejected_and_last_valid_file_kept', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    const path = join(directory, 'layout.json');
    const valid = JSON.parse(readFileSync(path, 'utf8')) as {devices: Record<string, {kind: string; elements: Record<string, unknown>[]}>};
    const mutations: ((d: typeof valid.devices) => void)[] = [
      d => Object.assign(d.wall?.elements[0] ?? {}, {zones: [5]}),
      d => Object.assign(d.panels?.elements[0] ?? {}, {zones: [5, 6]}),
      d => Object.assign(d.wall?.elements[1] ?? {}, {zones: [5, 6]}),
      d => Object.assign(d.wall?.elements[0] ?? {}, {zones: ['5', 6]}),
      d => Object.assign(d.wall?.elements[0] ?? {}, {number: 2}),
      d => Object.assign(d.wall ?? {}, {kind: 'unknown'}),
      d => Object.assign(d.wall ?? {}, {elements: []}),
    ];
    for (const mutate of mutations) {
      const broken = structuredClone(valid);
      mutate(broken.devices);
      assert.throws(() => layoutDevices(broken), {name: 'ValueError'});
      assert.throws(() => saveLayout(path, broken.devices as unknown as JsonObject), {name: 'ValueError'});
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), valid);
    }
    writeFileSync(path, JSON.stringify({version: 2, devices: {wall: {kind: 'lines', elements: [{id: '5:6', number: 1, zones: [5, 5], position: [0, 0]}]}}}));
    await assert.rejects(loadConfig(directory, DEFAULT, refuse), {name: 'ValueError'});
  });

  test('test_one_task_one_placement_per_device_and_unique_slot_per_device', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    const lines = await loadConfig(directory, DEFAULT, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    // Two prompted tasks, saved as their rows.
    write(directory, db => taskRow(db, 'a', '1', 1000));
    write(directory, db => taskRow(db, 'b', '1', 1001));
    write(directory, db => {
      const first = dashboard(db, lines, 1002);
      const second = dashboard(db, panels, 1002);
      assert.deepEqual(first.map(item => item?.[0] ?? null), ['working', 'working']);
      assert.deepEqual(second.map(item => item?.[0] ?? null), ['working', 'working', null]);
      assert.deepEqual(rows(db, "SELECT device, slot FROM slots WHERE session='a' ORDER BY device"), [['panels', 0], ['wall', 0]]);
      assert.deepEqual(rows(db, 'SELECT COUNT(*) FROM activity'), [[2]]);
      assert.throws(() => execute(db, "INSERT INTO slots (session, slot, device) VALUES ('c', 0, 'wall')"), /UNIQUE constraint failed/);
      assert.throws(() => execute(db, "INSERT INTO slots (session, slot, device) VALUES ('a', 1, 'wall')"), /UNIQUE constraint failed/);
      execute(db, "INSERT INTO slots (session, slot, device) VALUES ('c', 2, 'panels')");
    });
    assert.deepEqual(query(directory, "SELECT slot FROM slots WHERE session='c'"), [[2]]);
  });

  test('test_pre_change_linux_database_migrates_and_repeats_without_change', async context => {
    // Partly: the controller credential table is not ported.
    const directory = temporary(context);
    loadLinuxState(directory);
    const raw = new DatabaseSync(join(directory, 'status.sqlite'));
    const before = migratedRows(raw);
    assert.ok(!columns(raw, 'slots').includes('device'));
    raw.close();
    const first = withState(directory, db => {
      for (const table of ['slots', 'comets', 'line_prefs', 'map_settings', 'map_pending', 'locate', 'display_v3']) {
        assert.deepEqual(rows(db, `SELECT DISTINCT device FROM ${table}`), [['wall']], table);
      }
      return {rows: migratedRows(db), dump: dumpAll(db)};
    });
    const second = withState(directory, db => ({rows: migratedRows(db), dump: dumpAll(db)}));
    assert.deepEqual(first.rows, before);
    assert.deepEqual(second.rows, before);
    assert.deepEqual(first.dump, second.dump);
    assert.deepEqual(before.activity, [['task-blocked', 't1', 'blocked', 1002], ['task-question', 't1', 'question', 1002.7],
      ['task-unread', 't1', 'unread', 1004], ['task-unread-2', 't1', 'unread', 1006], ['task-working', 't1', 'working', 1000]]);
    assert.deepEqual(before.line_prefs, [['100:101', 'project-a', 1], ['102:103', 'project-a', 0], ['104:105', 'project-b', 1]]);
    assert.deepEqual(before.map_settings, [['project', 'status', 90, 1, 0]]);
    assert.deepEqual(before.task_info?.[4]?.slice(3, 5), ['project-a', 'project-a']);
    const sceneBefore = readFileSync(join(directory, 'scene-state.json'));
    const config = await loadConfig(directory, DEFAULT, refuse);
    assert.deepEqual([config.device, config.line_groups.length], ['wall', 15]);
    assert.deepEqual(new SceneRestorer(directory, config).state.scene, {name: 'Fixture Scene', brightness: 43});
    assert.deepEqual(readFileSync(join(directory, 'scene-state.json')), sceneBefore);
    withState(directory, db => {
      assert.deepEqual(controlState(db), {mode: 'work', revision: 2, applied: 2, wave_cutoff: 995, error: null});
      // linux-state-v4/fixture.json: the migrated comet and its source Line.
      assert.deepEqual(currentComet(db, 1011), {source: 4, started: 1010});
      assert.deepEqual(pending(db)?.lines, {'108:109': {project: 'project-b'}});
      assert.deepEqual(owners(db, config).slice(0, 3), [['project-a', 1], ['project-a', 0], ['project-b', 1]]);
      // An active comet defers Locate.
      assert.equal(locateState(db, config, 1011, 'work'), null);
      assert.deepEqual(rows(db, 'SELECT session, slot FROM slots ORDER BY slot'),
        [['task-working', 0], ['task-blocked', 2], ['task-question', 3], ['task-unread', 4], ['task-unread-2', 5]]);
      assert.deepEqual(rows(db, "SELECT COUNT(*) FROM controller_requests WHERE phase='done'"), [[1]]);
      assert.deepEqual(rows(db, "SELECT COUNT(*) FROM integration_requests WHERE phase='done'"), [[1]]);
    });
  });

  test('test_equal_element_ids_on_two_devices_do_not_collide', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    const lines = await loadConfig(directory, DEFAULT, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    write(directory, db => {
      execute(db, "INSERT INTO projects VALUES ('a', 'A', '#111111', '[]'), ('b', 'B', '#222222', '[]')");
      requestPatch(db, {lines: {'5:6': {project: 'a', signature: 1}}}, lines);
      requestPatch(db, {lines: {5: {project: 'b'}}, settings: {style: 'project'}}, panels);
      assert.deepEqual(owners(db, lines)[0], ['a', 1]);
      assert.deepEqual(owners(db, panels)[0], ['b', 0]);
      assert.equal(settings(db).style, 'classic');
      assert.equal(settings(db, 'panels').style, 'project');
      execute(db, "INSERT INTO comets (session, turn, queued, source, started, device) VALUES ('t','1',1,0,1,'panels')");
      assert.equal(requestPatch(db, {lines: {5: {project: null}}}, panels), true);
      assert.equal(requestPatch(db, {lines: {'5:6': {project: null}}}, lines), false);
      assert.equal(pending(db), null);
      assert.deepEqual(pending(db, 'panels')?.lines, {5: {project: null}});
      assert.deepEqual(owners(db, lines)[0], [null, 1]);
      assert.deepEqual(owners(db, panels)[0], ['b', 0]);
    });
  });

  test('test_literally_equal_element_ids_on_two_devices_keep_separate_state', async context => {
    const directory = temporary(context);
    writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fakeLines', secondToken: 'fakeSecond',
      devices: {wall: {kind: 'lines', ip: '192.0.2.1', token_ref: 'token'}, second: {kind: 'lines', ip: '192.0.2.3', token_ref: 'secondToken'}}});
    const element = {id: '5:6', number: 1, zones: [5, 6], position: [0, 0]};
    writeJson(join(directory, 'layout.json'), {version: 2, devices: {wall: {kind: 'lines', elements: [element]}, second: {kind: 'lines', elements: [element]}}});
    const first = await loadConfig(directory, DEFAULT, refuse);
    const second = await loadConfig(directory, 'second', refuse);
    assert.deepEqual(first.elements.map(e => e.id), second.elements.map(e => e.id));
    write(directory, db => {
      execute(db, "INSERT INTO projects VALUES ('a', 'A', '#111111', '[]'), ('b', 'B', '#222222', '[]')");
      applyPatch(db, {lines: {'5:6': {project: 'a', signature: 1}}}, 'wall');
      applyPatch(db, {lines: {'5:6': {project: 'b'}}}, 'second');
      assert.deepEqual(owners(db, first), [['a', 1]]);
      assert.deepEqual(owners(db, second), [['b', 0]]);
      assert.deepEqual(rows(db, "SELECT device, project FROM line_prefs WHERE line_id='5:6' ORDER BY device"), [['second', 'b'], ['wall', 'a']]);
      assert.throws(() => execute(db, "INSERT INTO line_prefs (line_id, project, signature, device) VALUES ('5:6', 'c', 0, 'wall')"),
        /UNIQUE constraint failed/);
      execute(db, "INSERT OR REPLACE INTO locate (line_id, started, device) VALUES ('5:6', NULL, 'second')");
      assert.equal(locateState(db, first, 1000, 'work'), null);
      assert.deepEqual(locateState(db, second, 1000, 'work'), {source: 0, started: 1000});
    });
  });

  // AC3: device-scoped placements, modes and scenes.
  test('test_modes_and_scene_files_are_independent_per_device', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    const lines = await loadConfig(directory, DEFAULT, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    setMode(directory, 'quiet', 1000, 'panels');
    withState(directory, db => {
      assert.equal(modeStatus(db).mode, 'work');
      assert.equal(modeStatus(db, 'panels').mode, 'quiet');
      assert.deepEqual(controlState(db), controlState(db, 'wall'));
      assert.equal(controlState(db, 'panels').mode, 'quiet');
      assert.equal(controlState(db).revision, 0);
    });
    writeJson(join(directory, 'scene-state.json'), {version: 1, scene: {name: 'Lines Scene', brightness: 40}, owned: false, quiet_scene: null});
    assert.equal(new SceneRestorer(directory, lines).state.scene?.name, 'Lines Scene');
    const other = new SceneRestorer(directory, panels);
    assert.equal(basename(other.path), 'scene-state.panels.json');
    assert.equal(other.state.scene, null);
    other.save({scene: {name: 'Panels Scene', brightness: 20}});
    const sceneOf = (name: string): unknown => (JSON.parse(readFileSync(join(directory, name), 'utf8')) as {scene: {name: string}}).scene.name;
    assert.equal(sceneOf('scene-state.json'), 'Lines Scene');
    assert.equal(sceneOf('scene-state.panels.json'), 'Panels Scene');
  });

  test('test_untargeted_callers_address_default_device', async context => {
    const directory = temporary(context);
    writeTwoDevices(directory);
    const lines = await loadConfig(directory, DEFAULT, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    write(directory, db => {
      assert.deepEqual(settings(db), settings(db, DEFAULT));
      assert.equal(DEFAULT, 'wall');
      applyPatch(db, {settings: {style: 'project'}});
      assert.equal(settings(db, 'wall').style, 'project');
      assert.equal(settings(db, 'panels').style, 'classic');
      execute(db, "INSERT OR REPLACE INTO locate (line_id, started, device) VALUES ('5:6', NULL, 'wall')");
      assert.deepEqual(locateState(db, lines, 1000, 'work'), {source: 0, started: 1000});
      assert.equal(locateState(db, panels, 1000, 'work'), null);
      assert.deepEqual(modeStatus(db), modeStatus(db, 'wall'));
    });
  });
});

/** Open handles to a file in this process (Linux /proc), or null where /proc is unavailable. */
function openHandles(path: string): number | null {
  if (!existsSync('/proc/self/fd')) return null;
  // /proc names each open file by its resolved path.
  const target = realpathSync(path);
  return readdirSync('/proc/self/fd').filter(fd => {
    try {
      return readlinkSync(join('/proc/self/fd', fd)) === target;
    } catch {
      return false;
    }
  }).length;
}

suite('BridgeTest', () => {
  test('test_failed_initialization_closes_connection', context => {
    // Python counted the connections it opened; here the process's open handles to the database file are counted.
    const directory = temporary(context);
    const path = join(directory, 'status.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('CREATE TABLE map_settings (id INTEGER PRIMARY KEY)');
    raw.close();
    if (openHandles(path) === null) {
      context.skip('No /proc on this platform.');
      return;
    }
    assert.equal(openHandles(path), 0);
    // Positive control: an open connection is counted.
    const open = new DatabaseSync(path);
    assert.ok((openHandles(path) ?? 0) >= 1);
    open.close();
    assert.equal(openHandles(path), 0);
    assert.throws(() => withState(directory, () => undefined), /map_settings/);
    assert.equal(openHandles(path), 0);
  });

  test('test_failed_initialization_rolls_back_partial_schema', context => {
    const directory = temporary(context);
    const raw = new DatabaseSync(join(directory, 'status.sqlite'));
    raw.exec('CREATE TABLE map_settings (id INTEGER PRIMARY KEY)');
    raw.close();
    assert.throws(() => withState(directory, () => undefined), /map_settings/);
    const check = new DatabaseSync(join(directory, 'status.sqlite'));
    assert.deepEqual(rows(check, "SELECT name FROM sqlite_master WHERE type='table'"), [['map_settings']]);
    check.close();
  });

  test('test_migration_keeps_task_assignments_and_removes_old_notifications', context => {
    const directory = temporary(context);
    const raw = new DatabaseSync(join(directory, 'status.sqlite'));
    raw.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY, turn TEXT, status TEXT, updated REAL)');
    raw.exec("INSERT INTO sessions VALUES ('existing','t','approval',1)");
    raw.exec('CREATE TABLE slots(session TEXT PRIMARY KEY, slot INTEGER UNIQUE)');
    raw.exec("INSERT INTO slots VALUES ('existing',4)");
    raw.exec('CREATE TABLE signals(id INTEGER PRIMARY KEY, session TEXT,turn TEXT,kind TEXT)');
    raw.exec("INSERT INTO signals VALUES (1,'old','turn','ended')");
    raw.close();
    assert.deepEqual(query(directory, 'SELECT id,status FROM sessions'), [['existing', 'blocked']]);
    assert.deepEqual(query(directory, 'SELECT session,slot FROM slots'), [['existing', 4]]);
    assert.deepEqual(query(directory, 'SELECT * FROM signals'), []);
    assert.equal(query(directory, 'SELECT * FROM activity').length, 1);
  });
});

const PANELS = fixtureJson('nl22-panels-fixture.json') as {panelLayout: {layout: {positionData: Record<string, unknown>[]}}};
type Points = Record<string, unknown>[];
function panelLayout(mutate?: (points: Points) => void): typeof PANELS.panelLayout {
  const value = structuredClone(PANELS.panelLayout);
  mutate?.(value.layout.positionData);
  return value;
}

suite('GeometryTest', () => {
  // AC8 and AC13: stable one-zone triangles from reported geometry.
  test('test_fixture_reads_eighteen_connected_triangles', () => {
    const entry = readLayout(panelLayout());
    const items = entry.elements;
    assert.equal(entry.kind, 'panels');
    assert.equal(items.length, 18);
    assert.deepEqual(items.map(e => e.number), Array.from({length: 18}, (_, i) => i + 1));
    const reported = new Map(PANELS.panelLayout.layout.positionData.map(point => [point.panelId, point]));
    for (const element of items) {
      const [zone] = element.zones;
      assert.equal(element.id, String(zone));
      const point = reported.get(zone);
      assert.deepEqual(element.position, [point?.x, point?.y]);
    }
    const geometry = entry.panel_geometry as {triangles: {id: string; o: number}[]; neighbors: [string, string][]};
    assert.deepEqual(geometry.triangles.map(t => t.id), items.map(e => e.id));
    assert.deepEqual(new Set(geometry.triangles.map(t => t.o)), new Set([0, 60]));
    const degree = new Map(items.map(e => [e.id, 0]));
    for (const [first, second] of geometry.neighbors) {
      degree.set(first, (degree.get(first) ?? 0) + 1);
      degree.set(second, (degree.get(second) ?? 0) + 1);
    }
    // Three hexagons of six triangles; two shared edges join them.
    assert.equal(geometry.neighbors.length, 3 * 6 + 2);
    assert.ok(Math.max(...degree.values()) <= 3);
    assert.deepEqual(validateElements('panels', items), items);
  });

  test('test_order_is_stable_and_independent_of_report_order', () => {
    assert.deepEqual(readLayout(panelLayout()), readLayout(panelLayout(points => points.reverse())));
  });

  test('test_other_valid_counts_are_supported', () => {
    const oneHexagon = (points: Points): void => {
      const keep = [...points].sort((a, b) => Number(a.x) - Number(b.x)).slice(0, 6);
      points.splice(0, points.length, ...keep);
    };
    assert.equal(readLayout(panelLayout(oneHexagon)).elements.length, 6);
    assert.equal(readLayout(panelLayout(points => points.splice(1))).elements.length, 1);
  });

  test('test_non_light_modules_are_excluded', () => {
    const entry = readLayout(panelLayout(points => {
      points.push({panelId: 999, x: 0, y: 0, o: 0, shapeType: 1});
      points.push({panelId: 998, x: 5, y: 400, o: 0, shapeType: 12});
    }));
    assert.equal(entry.elements.length, 18);
    assert.ok(!entry.elements.map(e => e.id).includes('999'));
  });

  test('test_malformed_or_unsupported_geometry_is_rejected', () => {
    const first = (points: Points): Record<string, unknown> => points[0] ?? {};
    const cases: Record<string, (points: Points) => void> = {
      'lines zone': p => { first(p).shapeType = 18; },
      'shapes triangle': p => { first(p).shapeType = 8; },
      'canvas control square': p => { first(p).shapeType = 3; },
      'duplicate id': p => { first(p).panelId = p[1]?.panelId; },
      'text id': p => { first(p).panelId = '55'; },
      'boolean id': p => { first(p).panelId = true; },
      'out of range id': p => { first(p).panelId = 70000; },
      'missing x': p => { delete first(p).x; },
      'infinite y': p => { first(p).y = Infinity; },
      'text orientation': p => { first(p).o = '0'; },
      overlap: p => { p.push({...first(p), panelId: 500, x: Number(first(p).x) + 10}); },
      disconnected: p => { p.push({panelId: 501, x: 5000, y: 5000, o: 0, shapeType: 0}); },
      'no triangles': p => { p.splice(0, p.length, {panelId: 1, x: 0, y: 0, o: 0, shapeType: 1}); },
      'entry type': p => { p.push('panel' as unknown as Record<string, unknown>); },
    };
    for (const [name, mutate] of Object.entries(cases)) assert.throws(() => readLayout(panelLayout(mutate)), {name: 'ValueError'}, name);
    for (const broken of [null, [], {layout: {}}, {layout: {positionData: {}}}, {...panelLayout(), globalOrientation: {value: 'north'}}]) {
      assert.throws(() => readLayout(broken), {name: 'ValueError'}, JSON.stringify(broken));
    }
  });
});

suite('ReservationTest', () => {
  test('test_six_triangle_reservation_and_shared_overflow', context => {
    const directory = temporary(context);
    const config = {...projection(readLayout(panelLayout())), device: 'panels'};
    const ids = config.elements.map(e => e.id);
    const assigned = write(directory, db => {
      execute(db, "INSERT INTO projects VALUES ('p','P','#00ff00','[]'), ('q','Q','#ff00ff','[]')");
      const deferred = requestPatch(db, {settings: {style: 'project'}, lines: Object.fromEntries(ids.slice(0, 6).map(id => [id, {project: 'p'}]))}, config);
      assert.equal(deferred, false);
      const tasks: TaskRow[] = [];
      for (let n = 0; n < 20; n += 1) {
        const session = `s${String(n).padStart(2, '0')}`;
        execute(db, 'INSERT INTO sessions VALUES (?,?,?,?)', session, '1', 'working', n);
        execute(db, 'INSERT INTO task_info VALUES (?,?,?,?,?,?,?)', session, '', '', n < 8 ? 'p' : 'q', null, '1', null);
        tasks.push([session, '1', 'working']);
      }
      return allocate(db, config, tasks, new Set());
    });
    const region = new Set([0, 1, 2, 3, 4, 5]);
    for (const [session, slot] of assigned) if (session >= 's08') assert.ok(!region.has(slot), session);
    assert.equal(assigned.size, 18);
    // Shared triangles hold the overflow of p; q never borrows p's region.
    assert.deepEqual(new Set(Array.from({length: 6}, (_, n) => assigned.get(`s0${n}`))), region);
    withState(directory, db => {
      assert.equal(settings(db).style, 'classic');
      assert.equal(settings(db, 'panels').style, 'project');
    });
  });
});
