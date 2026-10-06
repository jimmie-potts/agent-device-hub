// Map edits: the edit cases recorded from Python, then the targeted actions of tests/test_wall_devices.py, the edit cases of
// tests/test_edit_parity.py and tests/test_integration_api.py (PORTING.md lists every case). The wall server, its device
// resolution and the integration API's admission are not ported; each action runs as the wall's update did, in its own
// transaction on a device's loaded configuration.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {isObject, type Json, type JsonObject} from '../src/compat.js';
import {currentComet, pruneComets} from '../src/comets.js';
import {loadConfig, registeredDevices} from '../src/configuration.js';
import {withState} from '../src/database.js';
import {deviceOf, linesEntry, saveLayout, type DeviceConfig} from '../src/devices.js';
import * as edits from '../src/edits.js';
import {writeJson} from '../src/jsonfile.js';
import {dashboard} from '../src/line-projection.js';
import {changeMode, modeStatus} from '../src/modes.js';
import {readLayout} from '../src/panels.js';
import {applyPending, locateState, owners, pending, renderingSnapshot, requestPatch, settings, type Patch} from '../src/project-map.js';
import {identityKey, NOT_SELECTED, state} from '../src/shared-input.js';
import {execute, rows, type Db, type SqlValue} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import {completion, envelope, evictTask, Feed, firstSession, fixtureJson, query, refuse, selectionSetup, selectShared, setMode, suite,
  taskRow, temporary, test, wallView, write, type FeedChange} from './support.js';

interface Outcome {
  result?: Json;
  error?: string;
  message?: string;
}
interface Step {
  op: string;
  args: Json[];
  outcome: Outcome;
}
interface Case {
  name: string;
  layout: string;
  setup: {comet?: boolean; mode?: string; shared?: boolean};
  steps: Step[];
  rows: Record<string, Json[][]>;
}

const RECORDED = fixtureJson('recorded/edits.json') as {layouts: Record<string, DeviceConfig & {line_groups: number[][]}>; cases: Case[]};

const EDIT_ROWS: Record<string, string> = {
  map_settings: 'style,coverage,rotation,flip_x,flip_y,device', line_prefs: 'line_id,project,signature,device', palette: 'role,color',
  projects: 'id,color', task_info: 'session,manual_project', map_pending: 'payload,device', locate: 'line_id,started,device',
  comets: 'session,turn,queued,source,started,device', slots: 'session,slot,device', meta: 'key,value'};

/** record.edit_rows: the rows an edit can change, in rowid order, with the pending payload parsed. */
function editRows(directory: string): Record<string, unknown[][]> {
  const result: Record<string, unknown[][]> = {};
  for (const [table, columns] of Object.entries(EDIT_ROWS)) {
    result[table] = query(directory, `SELECT ${columns} FROM ${table} ORDER BY rowid`).map(row => [...row]);
  }
  result.map_pending = (result.map_pending ?? []).map(([payload, device]) => [JSON.parse(String(payload)) as unknown, device]);
  return result;
}

/**
 * record.edit_setup: shared input selected with no session; or projects a and b and task a in project a, with a started
 * comet on its Line or a commanded mode.
 */
function editSetup(directory: string, setup: Case['setup'], feed: Feed): void {
  if (setup.shared === true) {
    feed.select(directory, 1000);
    return;
  }
  write(directory, db => execute(db, "INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]'),('b','Project B','#33ccee','[]')"));
  write(directory, db => taskRow(db, 'a', '1', 1000));
  write(directory, db => execute(db, "UPDATE task_info SET project='a' WHERE session='a'"));
  if (setup.comet === true) {
    write(directory, db => completion(db, 'a', '1', 1000, registeredDevices(directory)));
    write(directory, db => {
      pruneComets(db, 1000, 'work');
      dashboard(db, RECORDED.layouts.lines ?? {line_groups: []}, 1000);
      currentComet(db, 1000);
    });
  }
  if (setup.mode !== undefined) setMode(directory, setup.mode, 1000);
}

const num = (value: Json | undefined): number => {
  if (typeof value !== 'number') throw new TypeError('A recorded step argument is not a number.');
  return value;
};
const str = (value: Json | undefined): string => {
  if (typeof value !== 'string') throw new TypeError('A recorded step argument is not text.');
  return value;
};

/** record.edit_step: one recorded operation in its own transaction. */
function editStep(db: Db, config: DeviceConfig & {line_groups: number[][]}, step: Step): unknown {
  const [first, second] = step.args;
  const device = deviceOf(config);
  switch (step.op) {
    case 'settings': return edits.settings(db, config, first);
    case 'assign': return edits.assign(db, config, first);
    case 'projectColor': return edits.projectColor(db, first, second);
    case 'taskProject': return edits.taskProject(db, config, first, second);
    case 'locate': return edits.locate(db, config, first);
    case 'requestPatch': return requestPatch(db, first as Patch, config);
    case 'applyPending': return applyPending(db, device);
    case 'pending': return pending(db, device);
    case 'locateState': return locateState(db, config, num(first), str(second));
    case 'pruneComets': return pruneComets(db, num(first), str(second), device);
    case 'currentComet': return currentComet(db, num(first), device);
    case 'dashboard': return dashboard(db, config, num(first));
    case 'query': return rows(db, str(first)).map(row => [...row]);
    case 'changeMode': return changeMode(db, str(first), num(second), device);
    case 'rendering': {
      const control = controlState(db, device);
      return renderingSnapshot(db, config, control.mode, control.revision !== control.applied, control.error, num(first));
    }
    case 'sql': {
      const params = Array.isArray(second) ? second : [];
      execute(db, str(first), ...params.map(value => value as SqlValue));
      return null;
    }
    default: throw new Error(`Unknown recorded step ${step.op}.`);
  }
}

function outcomeOf(call: () => unknown): Outcome {
  try {
    return {result: (call() ?? null) as Json};
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {error: error.name, message: error.message};
  }
}

suite('edits recorded from Python', () => {
  test('every edit case gives the same outcomes and leaves the same rows', context => {
    assert.ok(RECORDED.cases.length >= 80);
    for (const record of RECORDED.cases) {
      const directory = temporary(context);
      writeFileSync(join(directory, 'config.json'), JSON.stringify({ip: '192.0.2.1', token: 'fake'}));
      const feed = new Feed();
      editSetup(directory, record.setup, feed);
      const config = structuredClone(RECORDED.layouts[record.layout]);
      assert.ok(config !== undefined, record.name);
      record.steps.forEach((step, index) => {
        const [op, name, instant] = step.args;
        const outcome = step.op === 'feed'
          ? outcomeOf(() => feed.publish(directory, str(op) as FeedChange, typeof name === 'string' ? name : '', num(instant)))
          : outcomeOf(() => write(directory, db => editStep(db, config, step)));
        assert.deepEqual(outcome, step.outcome, `${record.name}: step ${String(index)} (${step.op})`);
      });
      assert.deepEqual(editRows(directory), record.rows, record.name);
    }
  });

  test('the recorded triangle layout is the NL22 fixture read by the port', () => {
    const nl22 = (fixtureJson('nl22-panels-fixture.json') as {panelLayout: unknown}).panelLayout;
    const recorded = RECORDED.layouts.triangles;
    assert.deepEqual(recorded?.elements, readLayout(nl22).elements);
  });
});

// test_wall_devices.py: the Lines and the NL22 Panels, registered with their saved layouts.
const GROUPS = Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]);
const POSITIONS = Array.from({length: 15}, (_, i) => [i * 10, 0]);
const NL22 = (fixtureJson('nl22-panels-fixture.json') as {panelLayout: unknown}).panelLayout;

/** WallDeviceTest.setUp and write_registry: registered Lines, and with `panels` the Panels, with saved layouts. */
function wallDevices(context: TestContext, panels = true): string {
  const directory = temporary(context);
  const config: JsonObject = {ip: '192.0.2.1', token: 'PRIVATE_LINES_TOKEN', devices: {wall: {kind: 'lines', ip: '192.0.2.1', token_ref: 'token'}}};
  const zones = GROUPS.flatMap((pair, i) => pair.map(zone => ({panelId: zone, x: i * 10 + (zone % 2 === 1 ? 5 : -5), y: 0, o: 0, shapeType: 18})));
  const saved = new Map<string, unknown>([['wall', linesEntry(GROUPS, POSITIONS, {zone_geometry: {positionData: zones, orientation: 0}})]]);
  if (panels) {
    config.panelsToken = 'PRIVATE_PANELS_TOKEN';
    if (isObject(config.devices)) config.devices.panels = {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'};
    saved.set('panels', readLayout(NL22));
  }
  writeJson(join(directory, 'config.json'), config);
  saveLayout(join(directory, 'layout.json'), saved);
  return directory;
}

suite('WallDeviceTest', () => {
  test('test_actions_address_the_named_device', async context => {
    // Partly: the wall view's element list is read as owners() of each device; the wall server resolves the device.
    const directory = wallDevices(context);
    const lines = await loadConfig(directory, undefined, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    const triangle = panels.elements[3]?.id ?? '';
    write(directory, db => execute(db, "INSERT INTO projects VALUES ('p','P','#00ff00','[]')"));
    write(directory, db => edits.settings(db, panels, {rotation: 90, flip_x: 1}));
    write(directory, db => edits.settings(db, panels, {style: 'project'}));
    write(directory, db => edits.assign(db, panels, {[triangle]: {project: 'p'}}));
    write(directory, db => edits.locate(db, panels, triangle));
    write(directory, db => edits.projectColor(db, 'p', '#123456'));
    assert.throws(() => write(directory, db => edits.assign(db, panels, {'100:101': {project: 'p'}})), {name: 'ValueError'});
    assert.throws(() => write(directory, db => edits.locate(db, panels, '100:101')), {name: 'ValueError'});
    assert.throws(() => write(directory, db => edits.locate(db, lines, triangle)), {name: 'ValueError'});
    withState(directory, db => {
      assert.deepEqual(settings(db, 'panels'), {style: 'project', coverage: 'whole', rotation: 90, flip_x: 1, flip_y: 0});
      assert.deepEqual(settings(db), {style: 'classic', coverage: 'whole', rotation: 0, flip_x: 0, flip_y: 0});
      assert.deepEqual(rows(db, 'SELECT line_id,project,device FROM line_prefs'), [[triangle, 'p', 'panels']]);
      assert.deepEqual(rows(db, 'SELECT line_id,device FROM locate'), [[triangle, 'panels']]);
      assert.equal(owners(db, panels)[3]?.[0], 'p');
      assert.ok(owners(db, lines).every(([project]) => project === null));
    });
    const [linesView, panelView] = [wallView(directory, lines, 1000), wallView(directory, panels, 1000)];
    assert.equal(linesView.settings.rotation, 0);
    assert.equal(panelView.settings.rotation, 90);
    for (const view of [linesView, panelView]) assert.equal(view.projects[0]?.color, '#123456');
  });

  test('test_mode_changes_address_the_named_device_and_leave_the_other_scene_alone', context => {
    // Partly: the mode route and its unknown-device refusal belong to the wall server, which is not ported. No mode command
    // reads or writes a scene file.
    const directory = wallDevices(context);
    const scene = join(directory, 'scene-state.json');
    writeFileSync(scene, JSON.stringify({version: 1, scene: {name: 'Beach', brightness: 40}, owned: false}));
    setMode(directory, 'quiet', 1000, 'panels');
    const status = (device?: string): unknown => withState(directory, db => modeStatus(db, device).mode);
    assert.equal(status('panels'), 'quiet');
    assert.equal(status(), 'work');
    assert.equal(wallView(directory, {device: 'panels'}, 1000).mode, 'quiet');
    assert.equal(wallView(directory, {}, 1000).mode, 'work');
    assert.equal((JSON.parse(readFileSync(scene, 'utf8')) as {scene: {name: string}}).scene.name, 'Beach');
    setMode(directory, 'free');
    assert.equal(status(), 'free');
    assert.equal(status('panels'), 'quiet');
  });

  // AC4: split-half settings are Lines-only.
  test('test_one_zone_elements_reject_coverage_and_half_swaps', async context => {
    const directory = wallDevices(context);
    const lines = await loadConfig(directory, undefined, refuse);
    const panels = await loadConfig(directory, 'panels', refuse);
    const triangle = panels.elements[0]?.id ?? '';
    write(directory, db => execute(db, "INSERT INTO projects VALUES ('p','P','#00ff00','[]')"));
    write(directory, db => edits.settings(db, panels, {style: 'project'}));
    for (const change of [
      (db: Db): void => edits.settings(db, panels, {coverage: 'status'}),
      (db: Db): void => edits.assign(db, panels, {[triangle]: {signature: 1}}),
      (db: Db): void => edits.assign(db, panels, {[triangle]: {project: 'p', signature: 1}}),
    ]) {
      assert.throws(() => write(directory, change), {name: 'ValueError'});
    }
    withState(directory, db => {
      assert.equal(settings(db, 'panels').coverage, 'whole');
      assert.deepEqual(rows(db, 'SELECT COUNT(*) FROM line_prefs'), [[0]]);
    });
    write(directory, db => edits.settings(db, lines, {coverage: 'status'}));
    write(directory, db => edits.assign(db, lines, {'100:101': {signature: 1}}));
    withState(directory, db => {
      assert.equal(settings(db).coverage, 'status');
      assert.deepEqual(rows(db, 'SELECT line_id,signature,device FROM line_prefs'), [['100:101', 1, 'wall']]);
    });
  });

  // AC2: eviction addresses the named device.
  test('test_eviction_is_routed_to_the_named_device', context => {
    // Partly: Python replaced the eviction to record its device; here a shared task held on both devices is evicted from
    // each in turn. The unknown-device refusal belongs to the wall server.
    const {path} = selectionSetup(context);
    writeJson(join(path, 'config.json'), {ip: '192.0.2.1', token: 'fake', panelsToken: 'other', devices: {
      wall: {kind: 'lines', ip: '192.0.2.1', token_ref: 'token'}, panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
    selectShared(path);
    const key = identityKey(firstSession(envelope()).identity);
    const task = wallView(path, {device: 'panels', line_groups: [[1]]}, 1000).tasks.find(item => item.id === key);
    assert.ok(task?.evictionToken !== undefined);
    const payload = {id: task.id, evictionToken: task.evictionToken};
    evictTask(path, 'panels', payload);
    assert.deepEqual(query(path, 'SELECT session,device FROM shared_evictions'), [[key, 'panels']]);
    write(path, db => edits.evict(db, {}, payload));
    assert.deepEqual(query(path, 'SELECT session,device FROM shared_evictions ORDER BY device'), [[key, 'panels'], [key, 'wall']]);
  });
});

// test_edit_parity.py: the browser edits each wake the display once and change nothing they do not name.
/** EditParityTest.setUp without the controller ledger: two projects, a task, a Lines preference and the Panels' own state. */
function parity(context: TestContext): {directory: string; config: DeviceConfig & {line_groups: number[][]}} {
  const directory = temporary(context);
  const config = {line_groups: [[101, 102], [103, 104]]};
  writeJson(join(directory, 'config.json'), config);
  writeJson(join(directory, 'layout.json'), {line_groups: config.line_groups});
  write(directory, db => {
    execute(db, "INSERT INTO activity VALUES ('task','turn','working',42)");
    execute(db, "INSERT INTO projects VALUES ('/work/alpha', 'Alpha', '#112233', '[]')");
    execute(db, "INSERT INTO projects VALUES ('/work/beta', 'Beta', '#445566', '[]')");
    execute(db, "INSERT INTO task_info VALUES ('task-a','Task A','/work/alpha','/work/alpha',NULL,'turn',42)");
    execute(db, "INSERT INTO sessions VALUES ('task-a','turn','working',42)");
    execute(db, "INSERT INTO line_prefs (line_id, project, signature, device) VALUES ('103:104', '/work/beta', 1, 'wall')");
    // Another device's reservation and preference, which no Lines edit may touch.
    execute(db, "INSERT INTO comets (session, turn, queued, source, started, device) VALUES ('task-a','turn',1,0,2,'panels')");
    execute(db, "INSERT INTO line_prefs (line_id, project, signature, device) VALUES ('7', '/work/alpha', 0, 'panels')");
  });
  return {directory, config};
}

interface Saved {
  epochs: unknown;
  comets: unknown;
  source: unknown;
  mode: unknown;
  prefs: unknown[][];
  pending: unknown;
  settings: unknown;
}

function saved(directory: string): Saved {
  return withState(directory, db => ({
    epochs: rows(db, 'SELECT session,turn,status,started FROM activity ORDER BY session'),
    comets: rows(db, 'SELECT session,turn,queued,source,started,device FROM comets ORDER BY device'),
    source: rows(db, 'SELECT source FROM shared_input'),
    mode: rows(db, "SELECT value FROM meta WHERE key='mode'"),
    prefs: rows(db, 'SELECT line_id,project,signature,device FROM line_prefs ORDER BY device,line_id').map(row => [...row]),
    pending: rows(db, 'SELECT payload,device FROM map_pending ORDER BY device'),
    settings: settings(db),
  }));
}

const wakeups = (directory: string): number => Number(query(directory, "SELECT value FROM meta WHERE key='event_revision'")[0]?.[0] ?? 0);

suite('EditParityTest', () => {
  test('test_equivalent_edits_save_equivalent_state', context => {
    // Partly: the integration extension's equivalent edit and the Lines ledger revision are not ported. Each wall edit
    // wakes the display once and resets no epoch, reservation, source or mode.
    const {directory, config} = parity(context);
    const initial = saved(directory);
    const changes: [string, (db: Db) => void][] = [
      ['settings.set', db => edits.settings(db, config, {style: 'project', coverage: 'status'})],
      ['elements.assign', db => edits.assign(db, config, {'101:102': {project: '/work/beta', signature: 1}})],
      ['elements.assign', db => edits.assign(db, config, {'103:104': {project: null}})],
      ['task.assign', db => edits.taskProject(db, config, 'task-a', '/work/beta')],
      ['project.color', db => edits.projectColor(db, '/work/alpha', '#AABBCC')],
    ];
    const database = join(directory, 'status.sqlite');
    for (const [kind, change] of changes) {
      const snapshot = readFileSync(database);
      const before = wakeups(directory);
      write(directory, change);
      assert.equal(wakeups(directory) - before, 1, `${kind}: one display wake-up per edit`);
      const after = saved(directory);
      for (const key of ['epochs', 'comets', 'source', 'mode'] as const) assert.deepEqual(after[key], initial[key], `${kind}: ${key}`);
      assert.ok(after.prefs.some(row => JSON.stringify(row) === JSON.stringify(['7', '/work/alpha', 0, 'panels'])), kind);
      writeFileSync(database, snapshot);
    }
  });

  test('test_active_comet_defers_browser_edit_and_holds_machine_edit', context => {
    // Partly: the wall edits. The integration extension's admission, queue and revision conflicts are not ported.
    const {directory, config} = parity(context);
    write(directory, db => execute(db, "INSERT INTO comets (session, turn, queued, source, started, device) VALUES ('task-a','turn',1,0,2,'wall')"));
    // An edit that moves the comet's source Line is saved as a pending wall edit.
    write(directory, db => edits.settings(db, config, {style: 'project'}));
    const deferred = saved(directory);
    assert.deepEqual((JSON.parse(String((deferred.pending as SqlValue[][])[0]?.[0])) as Patch).settings, {style: 'project'});
    assert.equal((deferred.settings as {style: unknown}).style, 'classic');
    // An edit away from the comet applies at once.
    write(directory, db => edits.projectColor(db, '/work/beta', '#010203'));
    assert.deepEqual(query(directory, "SELECT color FROM projects WHERE id='/work/beta'"), [['#010203']]);
  });

  test('test_browser_only_edits_keep_their_ledger_scope', context => {
    // Partly: the Lines ledger revision is not ported; each edit still wakes the display once.
    const {directory, config} = parity(context);
    let before = wakeups(directory);
    write(directory, db => edits.settings(db, config, {palette: {working: '#00e5ff'}}));
    assert.equal(wakeups(directory) - before, 1);
    before = wakeups(directory);
    write(directory, db => edits.locate(db, config, '101:102'));
    assert.equal(wakeups(directory) - before, 1);
  });
});

// test_integration_api.py: the edit cases, without the extension's admission, opaque IDs or snapshot.
/** IntegrationTest.setUp without the controller ledger. */
function integration(context: TestContext): {directory: string; config: DeviceConfig & {line_groups: number[][]}} {
  const directory = temporary(context);
  const config = {line_groups: [[101, 102], [103, 104]]};
  writeJson(join(directory, 'config.json'), config);
  writeJson(join(directory, 'layout.json'), {line_groups: config.line_groups});
  write(directory, db => {
    execute(db, "INSERT INTO activity VALUES ('task','turn','working',42)");
    execute(db, "INSERT INTO projects VALUES ('/private/project', 'PRIVATE_TITLE', '#112233', '[\"/private/root\"]')");
    execute(db, "INSERT INTO task_info VALUES ('private-session','PRIVATE_TASK','/private/root','/private/project',NULL,'turn',42)");
    execute(db, "INSERT INTO sessions VALUES ('private-session','turn','working',42)");
  });
  return {directory, config};
}

suite('IntegrationTest', () => {
  test('test_all_operations_preserve_unrelated_state_and_scene', context => {
    // Partly: the four edits run directly, in their own transactions, with the local project and task IDs the extension
    // mapped to opaque ones; its admission, receipts and snapshot are not ported.
    const {directory, config} = integration(context);
    const scene = '{"scene":"PRIVATE_SCENE"}';
    writeFileSync(join(directory, 'scene-state.json'), scene);
    write(directory, db => execute(db, "INSERT INTO receipts VALUES ('private-session','turn',10,0)"));
    const project = '/private/project';
    write(directory, db => edits.settings(db, config, {style: 'project', coverage: 'status'}));
    write(directory, db => edits.assign(db, config, {'101:102': {project, signature: 1}}));
    write(directory, db => edits.taskProject(db, config, 'private-session', project));
    write(directory, db => edits.projectColor(db, project, '#AABBCC'));
    withState(directory, db => {
      assert.deepEqual(rows(db, 'SELECT color FROM projects'), [['#aabbcc']]);
      assert.deepEqual(rows(db, 'SELECT manual_project FROM task_info'), [[project]]);
      assert.deepEqual(owners(db, config), [[project, 1], [null, 0]]);
      assert.equal(state(db).source, NOT_SELECTED);
      assert.deepEqual(rows(db, 'SELECT started FROM activity'), [[42]]);
      assert.deepEqual(rows(db, 'SELECT observed FROM receipts'), [[0]]);
    });
    assert.equal(readFileSync(join(directory, 'scene-state.json'), 'utf8'), scene);
  });

  test('test_shared_mapping_source_and_notices_survive_edits', context => {
    // Partly: the task project edit runs directly on the shared task; the extension's opaque IDs, private snapshot and
    // admission are not ported.
    const {directory, config} = integration(context);
    const value = envelope();
    const session = firstSession(value);
    const key = identityKey(session.identity);
    const project = 'shared-project-' + (session.projectId ?? 'chosen-project');
    session.projectId = session.projectId ?? 'chosen-project';
    write(directory, db => {
      execute(db, "UPDATE shared_input SET source='shared',envelope=?,generation=2", JSON.stringify(value));
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', project, session.projectId ?? null, '#aabbcc', '[]');
      execute(db, 'INSERT INTO task_info VALUES (?,?,?,?,?,?,?)', key, 'PRIVATE_SHARED_TITLE', 'PRIVATE_SHARED_ROOT', project, null, 'turn', 42);
    });
    write(directory, db => edits.taskProject(db, config, key, project));
    withState(directory, db => {
      const current = state(db);
      assert.equal(current.source, 'shared');
      assert.deepEqual(current.envelope, JSON.parse(JSON.stringify(value)));
      assert.deepEqual(rows(db, 'SELECT manual_project FROM task_info WHERE session=?', key), [[project]]);
    });
  });
});

suite('mode command checks the port adds', () => {
  test('an explicit mode command ends power and brightness overrides, even for the same mode', context => {
    // Python ended overrides only on a device with a controller ledger, the only devices that could hold them. The port
    // takes controls on every device (PORTING.md), so every mode command ends them.
    const directory = temporary(context);
    const keys = ['controller_power@panels', 'controller_brightness@panels'];
    write(directory, db => {
      execute(db, 'INSERT INTO meta VALUES (?,?),(?,?)', keys[0] ?? '', '0', keys[1] ?? '', '40');
      execute(db, "INSERT INTO meta VALUES ('controller_power','1')");
    });
    assert.equal(setMode(directory, 'work', 1000, 'panels'), true);
    assert.deepEqual(query(directory, "SELECT key FROM meta WHERE key LIKE 'controller_%' ORDER BY key"), [['controller_power']]);
    withState(directory, db => {
      assert.deepEqual(controlState(db, 'panels'), {mode: 'work', revision: 1, applied: 0, wave_cutoff: -Infinity, error: null});
      assert.deepEqual(modeStatus(db, 'panels'), {mode: 'work', pending: true, error: null});
    });
  });

  test('an unknown mode is refused before anything changes', context => {
    const directory = temporary(context);
    assert.throws(() => setMode(directory, 'party'), {name: 'ValueError', message: 'Unknown lighting mode.'});
    assert.deepEqual(query(directory, "SELECT * FROM meta WHERE key IN ('mode','mode_revision','wave_cutoff','dirty')"), []);
  });
});
