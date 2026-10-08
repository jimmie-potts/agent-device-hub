// Hub #933: the Nanoleaf migration's module half. It reads the bridge's state directory without changing it, carries the
// layout, preferences, project map and colors, palette, scenes and favorites into the module's store and folder, leaves
// tasks, reservations, epochs, caches, the ledger, the legacy backup and `bindings` in the backup, converts the registry
// into the module's section with each token as a secret, refuses what it cannot carry, and its verifier counts every
// mismatch. The module then starts on the migrated store.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  chmodSync, copyFileSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {configureNanoleaf, LINES_ADDRESS, PANELS_ADDRESS, SYNTHETIC_TOKEN} from '../src/index.js';
import {layoutDevices} from '../src/devices.js';
import {readJson} from '../src/jsonfile.js';
import {
  convertNanoleafState, FRESH_SHARED_INPUT, InstalledState, MIGRATION_SCHEMA, MigrationError, migrateNanoleaf, secretFileName, SYNTHETIC_SOURCE,
  verifyNanoleafStore, writeSyntheticNanoleafState, type MigrationReport, type NanoleafSection, type StoreMismatches,
} from '../src/migration/index.js';
import {selected} from '../src/shared-input.js';
import {ModuleWorld} from './module-support.js';
import {FIXTURES, suite, temporary, test} from './support.js';

const LINUX_STATE = join(FIXTURES, 'linux-state-v4');

/** The pre-change Linux state of `linux-state-v4`, as the bridge's tests load it. */
function linuxState(directory: string): string {
  const source = join(directory, 'source');
  mkdirSync(source, {mode: 0o700});
  copyFileSync(join(LINUX_STATE, 'config-fixture.json'), join(source, 'config.json'));
  copyFileSync(join(LINUX_STATE, 'layout-fixture.json'), join(source, 'layout.json'));
  copyFileSync(join(LINUX_STATE, 'scene-state-fixture.json'), join(source, 'scene-state.json'));
  const db = new DatabaseSync(join(source, 'status.sqlite'));
  db.exec(readFileSync(join(LINUX_STATE, 'status.sql'), 'utf8'));
  db.close();
  return source;
}

async function syntheticState(directory: string, options: Parameters<typeof writeSyntheticNanoleafState>[1] = {}): Promise<string> {
  const source = join(directory, 'source');
  mkdirSync(source, {recursive: true, mode: 0o700});
  await writeSyntheticNanoleafState(source, options);
  return source;
}

/** The module's store and folder as the SDK's harness lays them out: `<dir>/nanoleaf.sqlite` and `<dir>/nanoleaf/`. */
function destinationOf(directory: string): {dir: string; databaseFile: string; folder: string} {
  const dir = join(directory, 'destination');
  mkdirSync(join(dir, 'nanoleaf'), {recursive: true, mode: 0o700});
  chmodSync(dir, 0o700);
  // The module's database is private from its creation, as the runtime creates it.
  writeFileSync(join(dir, 'nanoleaf.sqlite'), '', {mode: 0o600});
  return {dir, databaseFile: join(dir, 'nanoleaf.sqlite'), folder: join(dir, 'nanoleaf')};
}

/** Migrates `source` into a fresh destination under `directory`, closing both. */
function migrate(source: string, directory: string): {report: MigrationReport; databaseFile: string; folder: string; dir: string} {
  const destination = destinationOf(directory);
  const state = InstalledState.open(source);
  try {
    const database = new DatabaseSync(destination.databaseFile);
    try {
      const report = migrateNanoleaf(state, {database, folder: destination.folder});
      return {report, ...destination};
    } finally {
      database.close();
    }
  } finally {
    state.close();
  }
}

function verify(source: string, store: {databaseFile: string; folder: string}): ReturnType<typeof verifyNanoleafStore> {
  const state = InstalledState.open(source);
  try {
    return verifyNanoleafStore(state, store);
  } finally {
    state.close();
  }
}

function rowsOf(file: string, sql: string): unknown[][] {
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    const statement = db.prepare(sql);
    statement.setReturnArrays(true);
    return statement.all() as unknown as unknown[][];
  } finally {
    db.close();
  }
}

function change(file: string, sql: string): void {
  const db = new DatabaseSync(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

const refusal = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof MigrationError) return error.code;
    throw error;
  }
  return 'none';
};

/** Every entry under `directory`: its type, mode, size, modification time and content's SHA-256. */
function snapshot(directory: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = join(relative, name);
      const info = lstatSync(join(directory, path));
      const content = info.isFile() ? createHash('sha256').update(readFileSync(join(directory, path))).digest('hex') : '';
      entries[path] = `${info.isDirectory() ? 'd' : info.isFile() ? 'f' : 'o'} ${info.mode} ${info.size} ${info.mtimeMs} ${content}`;
      if (info.isDirectory()) walk(path);
    }
  };
  walk('');
  return entries;
}

const START_FRESH = ['sessions', 'activity', 'waits', 'receipts', 'slots', 'comets', 'task_info', 'display_v3', 'locate', 'shared_stale',
  'shared_suppressed_waves', 'shared_ack', 'shared_evictions', 'control_journal', 'control_scenes', 'nanoleaf_devices', 'nanoleaf_transmissions',
  'nanoleaf_commands', 'nanoleaf_machine_edits', 'nanoleaf_module'];

const zeroMismatches: StoreMismatches = {database: 0, projects: 0, palette: 0, elements: 0, mapSettings: 0, pendingEdits: 0, favorites: 0, deviceState: 0,
  startFresh: 0, layout: 0, scenes: 0, unexpected: 0};

suite('the linux-state-v4 fixture', () => {
  test('carries the layout, preferences, project map and colors and the scene, and leaves tasks, caches and epochs behind', context => {
    const directory = temporary(context);
    const source = linuxState(directory);
    const {report, databaseFile, folder} = migrate(source, directory);
    assert.equal(report.schema, MIGRATION_SCHEMA);
    assert.deepEqual(report.counts, {devices: 1, projects: 2, palette: 0, elements: 3, mapSettings: 1, pendingEdits: 1, favorites: 0, deviceState: 3,
      layouts: 1, scenes: 1});
    assert.deepEqual(report.leftInBackup, {sessions: 5, taskRows: 14, reservations: 5, comets: 2, locates: 1, displayCaches: 1, controllerLedger: 6,
      integrationRequests: 2, legacyBackup: 0, bindings: 0, otherMeta: 2, unregistered: 0});

    assert.deepEqual(rowsOf(databaseFile, 'SELECT id,name,color,roots FROM projects ORDER BY id'), [
      ['project-a', 'Project A', '#aa55ff', '["/home/fixture/project-a"]'], ['project-b', 'Project B', '#123456', '["/home/fixture/project-b"]']]);
    // The pre-change rows gain the Lines' device key, as the bridge's own in-place migration gives them.
    assert.deepEqual(rowsOf(databaseFile, 'SELECT line_id,project,signature,device FROM line_prefs ORDER BY line_id'), [
      ['100:101', 'project-a', 1, 'wall'], ['102:103', 'project-a', 0, 'wall'], ['104:105', 'project-b', 1, 'wall']]);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT id,style,coverage,rotation,flip_x,flip_y,device FROM map_settings'), [[1, 'project', 'status', 90, 1, 0, 'wall']]);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT payload,device FROM map_pending'), [['{"settings": {}, "lines": {"108:109": {"project": "project-b"}}, "tasks": {}}', 'wall']]);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT key,value FROM meta ORDER BY key'), [['mode', 'work'], ['mode_applied', '2'], ['mode_revision', '2'], ['model_version', '4']]);
    for (const table of START_FRESH) assert.deepEqual(rowsOf(databaseFile, `SELECT * FROM ${table}`), [], table);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT * FROM shared_input'), [[...FRESH_SHARED_INPUT]]);
    const db = new DatabaseSync(databaseFile, {readOnly: true});
    assert.equal(selected(db), false, 'the stored \'legacy\' reads as not selected');
    db.close();

    // The Lines-only layout becomes the module's per-device layout, with every Line, its zones and its position.
    const layout = layoutDevices(readJson(join(folder, 'layout.json'))).get('wall');
    assert.equal(layout?.elements.length, 15);
    assert.deepEqual(layout?.elements[1], {id: '102:103', number: 2, zones: [102, 103], position: [10, 0]});
    assert.deepEqual(readJson(join(folder, 'scene-state.json')), readJson(join(source, 'scene-state.json')));
    assert.deepEqual(readdirSync(folder).sort(), ['layout.json', 'scene-state.json']);
    for (const name of readdirSync(folder)) assert.equal(statSync(join(folder, name)).mode & 0o777, 0o600, name);

    const verified = verify(source, {databaseFile, folder});
    assert.deepEqual(verified.mismatches, zeroMismatches);
    assert.deepEqual(verified.digest, report.digest);
    assert.deepEqual(verified.counts, report.counts);
  });
});

suite('the installed shape, with the Lines and NL22 Light Panels', () => {
  test('carries both devices\' preferences, the palette and favorites, and leaves the legacy backup, bindings and a removed device behind', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const {report, databaseFile, folder} = migrate(source, directory);
    assert.deepEqual(report.counts, {devices: 2, projects: 3, palette: 2, elements: 5, mapSettings: 2, pendingEdits: 1, favorites: 2, deviceState: 8,
      layouts: 2, scenes: 2});
    assert.deepEqual(report.leftInBackup, {sessions: 2, taskRows: 4, reservations: 3, comets: 1, locates: 1, displayCaches: 1, controllerLedger: 2,
      integrationRequests: 1, legacyBackup: 1, bindings: 2, otherMeta: 6, unregistered: 3});
    assert.deepEqual(rowsOf(databaseFile, 'SELECT role,color FROM palette ORDER BY role'), [['unread', '#cc33ff'], ['working', '#11aa22']]);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT name FROM animation_favorites ORDER BY name'), [['Marker Favorite Calm'], ['Marker Favorite Wave']]);
    assert.deepEqual(rowsOf(databaseFile, "SELECT line_id,project FROM line_prefs WHERE device='panels' ORDER BY line_id"), [['200', 'project-beta'], ['201', 'project-gamma']]);
    assert.deepEqual(rowsOf(databaseFile, "SELECT device FROM line_prefs WHERE device NOT IN ('wall','panels')"), [], 'no row of a removed device');
    assert.deepEqual(rowsOf(databaseFile, "SELECT key,value FROM meta WHERE key LIKE '%@panels' ORDER BY key"),
      [['controller_power@panels', '1'], ['mode@panels', 'quiet'], ['mode_applied@panels', '1'], ['mode_revision@panels', '2']]);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT * FROM shared_input'), [[...FRESH_SHARED_INPUT]], 'no configuration, bindings, envelope or legacy backup');
    for (const table of START_FRESH) assert.deepEqual(rowsOf(databaseFile, `SELECT * FROM ${table}`), [], table);
    assert.deepEqual(readdirSync(folder).sort(), ['layout.json', 'scene-state.json', 'scene-state.panels.json']);
    assert.deepEqual([...layoutDevices(readJson(join(folder, 'layout.json'))).keys()], ['wall', 'panels']);
    assert.deepEqual(readJson(join(folder, 'scene-state.panels.json')), readJson(join(source, 'scene-state.panels.json')));

    const verified = verify(source, {databaseFile, folder});
    assert.deepEqual(verified.mismatches, zeroMismatches);
    assert.deepEqual(verified.digest, report.digest);
    // Two migrations of one source give the same digests and files.
    const again = migrate(source, join(directory, 'again'));
    assert.deepEqual(again.report, report);
  });

  test('reports counts, codes and hashes only', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory, {codexMetadata: {path: '/home/fixture/codex/state.json'}});
    const {report, databaseFile, folder} = migrate(source, directory);
    const text = JSON.stringify([report, verify(source, {databaseFile, folder})]);
    for (const marker of ['Marker', LINES_ADDRESS, PANELS_ADDRESS, SYNTHETIC_TOKEN, '/home/fixture', directory, 'wall', 'panels', 'project-']) {
      assert.ok(!text.includes(marker), `the report holds ${marker}`);
    }
  });
});

suite('the configuration conversion', () => {
  test('turns the registry into the module\'s section, each token into a secret, and drops bindings and the 1.x feed\'s settings', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory, {codexMetadata: {path: '/home/fixture/codex/state.json', titleIndexPath: '/home/fixture/codex/index.jsonl'}});
    const state = InstalledState.open(source);
    try {
      const converted = convertNanoleafState(state, '/secrets');
      assert.deepEqual(converted.section, {
        devices: [{id: 'wall', kind: 'lines', address: LINES_ADDRESS, secret: 'wall-token'}, {id: 'panels', kind: 'panels', address: PANELS_ADDRESS, secret: 'panels-token'}],
        qualifiedSources: [SYNTHETIC_SOURCE],
        codexMetadata: {path: '/home/fixture/codex/state.json', titleIndexPath: '/home/fixture/codex/index.jsonl'},
        secrets: {'wall-token': `/secrets/${secretFileName('wall')}`, 'panels-token': `/secrets/${secretFileName('panels')}`},
      });
      assert.deepEqual([...converted.tokens], [['wall-token', SYNTHETIC_TOKEN], ['panels-token', SYNTHETIC_TOKEN]]);
      assert.deepEqual(converted.counts, {qualifiedSources: 1, codexMetadata: 1});
      assert.ok(!('error' in configureNanoleaf(converted.section)), 'the module takes the section');
      assert.ok(!JSON.stringify(converted.section).includes(SYNTHETIC_TOKEN), 'the section holds no token');
    } finally {
      state.close();
    }
  });

  test('the linux-state-v4 registry, which predates the device list, converts as the Lines with the top-level address and token', context => {
    const directory = temporary(context);
    const source = linuxState(directory);
    change(join(source, 'status.sqlite'), `UPDATE shared_input SET config='${JSON.stringify({version: 1, ownerId: 'owner', consumerId: 'nanoleaf',
      clearOnNewTurn: true, qualifiedSources: [SYNTHETIC_SOURCE], bindings: []})}' WHERE id=1`);
    const state = InstalledState.open(source);
    try {
      const converted = convertNanoleafState(state, '/secrets');
      assert.deepEqual(converted.section.devices, [{id: 'wall', kind: 'lines', address: '192.0.2.41', secret: 'wall-token'}]);
      assert.deepEqual([...converted.tokens], [['wall-token', 'fixtureToken']]);
      assert.equal(converted.section.codexMetadata, undefined);
    } finally {
      state.close();
    }
  });

  test('refuses a state it cannot convert, with fixed text', async context => {
    const directory = temporary(context);
    const cases: [string, (source: string) => void, string][] = [
      ['shared input never configured', source => { change(join(source, 'status.sqlite'), 'UPDATE shared_input SET config=NULL'); }, 'source-not-configured'],
      ['a public address', source => { editConfig(source, config => { (config.devices as {panels: {ip: string}}).panels.ip = '8.8.8.8'; }); }, 'source-config'],
      ['a missing token', source => { editConfig(source, config => { delete config['token@panels']; }); }, 'source-config'],
      ['a token with a space', source => { editConfig(source, config => { config.token = 'tok en'; }); }, 'source-config'],
      ['a relative metadata path', source => { editConfig(source, config => { config.metadata_path = 'codex/state.json'; }); }, 'source-config'],
      ['a title index without its catalog', source => { editConfig(source, config => { config.title_index_path = '/home/fixture/index.jsonl'; }); }, 'source-config'],
      ['qualified sources the module refuses', source => {
        change(join(source, 'status.sqlite'), `UPDATE shared_input SET config='{"qualifiedSources": [{"provider": "other"}]}'`);
      }, 'source-config'],
    ];
    for (const [name, damage, code] of cases) {
      const source = await syntheticState(join(directory, name.replaceAll(' ', '-')));
      damage(source);
      const state = InstalledState.open(source);
      try {
        assert.equal(refusal(() => convertNanoleafState(state, '/secrets')), code, name);
      } finally {
        state.close();
      }
    }
  });
});

function editConfig(source: string, edit: (config: Record<string, unknown>) => void): void {
  const config = JSON.parse(readFileSync(join(source, 'config.json'), 'utf8')) as Record<string, unknown>;
  edit(config);
  writeFileSync(join(source, 'config.json'), JSON.stringify(config));
}

suite('refusals of the source', () => {
  test('refuses a state it cannot carry safely, naming the code', async context => {
    const directory = temporary(context);
    const cases: [string, (source: string) => void, string][] = [
      ['no status database', source => { unlinkSync(join(source, 'status.sqlite')); }, 'source-missing'],
      ['no configuration', source => { unlinkSync(join(source, 'config.json')); }, 'source-missing'],
      ['model version 3', source => { change(join(source, 'status.sqlite'), "UPDATE meta SET value='3' WHERE key='model_version'"); }, 'source-schema'],
      ['an added column', source => { change(join(source, 'status.sqlite'), 'ALTER TABLE projects ADD COLUMN extra TEXT'); }, 'source-schema'],
      ['a WAL database', source => { change(join(source, 'status.sqlite'), 'PRAGMA journal_mode=WAL'); }, 'source-schema'],
      ['a damaged layout', source => { writeFileSync(join(source, 'layout.json'), '{"version": 2, "devices": {"wall": {"kind": "lines"}}}'); }, 'source-corrupt'],
      ['a damaged scene file', source => { writeFileSync(join(source, 'scene-state.panels.json'), '{"version": 2}'); }, 'source-corrupt'],
      ['a linked configuration', source => {
        copyFileSync(join(source, 'config.json'), join(source, 'config-copy.json'));
        unlinkSync(join(source, 'config.json'));
        symlinkSync(join(source, 'config-copy.json'), join(source, 'config.json'));
      }, 'source-corrupt'],
      ['a linked worker lock', source => {
        unlinkSync(join(source, 'notification-lock.sqlite'));
        symlinkSync(join(source, 'notification-lock.panels.sqlite'), join(source, 'notification-lock.sqlite'));
      }, 'source-corrupt'],
      ['a malformed registry', source => { editConfig(source, config => { config.devices = {wall: {kind: 'lines'}}; }); }, 'source-config'],
      ['a device ID that is no routing ID', source => {
        editConfig(source, config => {
          const devices = config.devices as Record<string, unknown>;
          devices.Panels_1 = devices.panels;
          delete devices.panels;
        });
      }, 'source-device-id'],
    ];
    for (const [name, damage, code] of cases) {
      const source = await syntheticState(join(directory, name.replaceAll(' ', '-')));
      damage(source);
      assert.equal(refusal(() => InstalledState.open(source).close()), code, name);
    }
  });

  test('refuses a running worker, and a worker that starts during the migration cannot take its lock', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const worker = new DatabaseSync(join(source, 'notification-lock.panels.sqlite'), {timeout: 0});
    worker.exec('BEGIN EXCLUSIVE');
    assert.equal(refusal(() => InstalledState.open(source).close()), 'source-in-use');
    worker.exec('ROLLBACK');
    const enrollment = new DatabaseSync(join(source, 'registry-lock.sqlite'), {timeout: 0});
    enrollment.exec('BEGIN EXCLUSIVE');
    assert.equal(refusal(() => InstalledState.open(source).close()), 'source-in-use');
    enrollment.exec('ROLLBACK');
    enrollment.close();
    const state = InstalledState.open(source);
    try {
      assert.throws(() => { worker.exec('BEGIN EXCLUSIVE'); }, {errcode: 5}, 'the worker cannot take its lock');
      const writer = new DatabaseSync(join(source, 'status.sqlite'), {timeout: 0});
      assert.throws(() => { writer.exec("INSERT INTO sessions VALUES ('late','t1','working',1.0)"); }, {errcode: 5}, 'no bridge process commits');
      writer.close();
    } finally {
      state.close();
      worker.close();
    }
  });

  test('refuses a second reader of an open source, so no plain read drops the first one\'s locks', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const state = InstalledState.open(source);
    try {
      assert.equal(refusal(() => InstalledState.open(source).close()), 'source-in-use');
      const writer = new DatabaseSync(join(source, 'status.sqlite'), {timeout: 0});
      assert.throws(() => { writer.exec("INSERT INTO sessions VALUES ('late','t1','working',1.0)"); }, {errcode: 5}, 'the first reader\'s lock still holds');
      writer.close();
    } finally {
      state.close();
    }
    // Once closed, the source opens again.
    InstalledState.open(source).close();
  });

  test('refuses a database with a journal to roll back', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const file = join(source, 'status.sqlite');
    // A writer that spills its change into the file and is killed leaves a hot journal behind.
    const script = [
      'const {DatabaseSync} = require("node:sqlite");',
      `const db = new DatabaseSync(${JSON.stringify(file)});`,
      'db.exec("PRAGMA cache_size=1; BEGIN EXCLUSIVE");',
      'for (let i = 0; i < 400; i++) db.exec("INSERT INTO projects VALUES (\'p" + i + "\', randomblob(2000), NULL, NULL)");',
      'process.kill(process.pid, "SIGKILL");',
    ].join('\n');
    const child = spawnSync(process.execPath, ['-e', script]);
    assert.equal(child.signal, 'SIGKILL');
    const before = snapshot(source);
    assert.ok(Object.keys(before).includes('status.sqlite-journal'), 'a journal was left');
    assert.equal(refusal(() => InstalledState.open(source).close()), 'source-not-clean');
    assert.deepEqual(snapshot(source), before, 'the refusal rolled nothing back');
  });

  test('never changes the source state', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const before = snapshot(source);
    const {databaseFile, folder} = migrate(source, directory);
    verify(source, {databaseFile, folder});
    const state = InstalledState.open(source);
    convertNanoleafState(state, '/secrets');
    state.close();
    assert.deepEqual(snapshot(source), before, 'every entry keeps its type, mode, size, time and content, and none is added');
  });
});

suite('the verifier', () => {
  test('counts each planted corruption, so the cutover stops', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const cases: [string, (store: {databaseFile: string; folder: string}) => void, Partial<StoreMismatches>][] = [
      ['a palette color', store => { change(store.databaseFile, "UPDATE palette SET color='#000000' WHERE role='unread'"); }, {palette: 1}],
      ['a removed project', store => { change(store.databaseFile, "DELETE FROM projects WHERE id='project-beta'"); }, {projects: 1}],
      ['an added project', store => { change(store.databaseFile, "INSERT INTO projects VALUES ('project-x','X',NULL,'[]')"); }, {projects: 1}],
      ['a project color', store => { change(store.databaseFile, "UPDATE projects SET color='#000000' WHERE id='project-alpha'"); }, {projects: 1}],
      ['a Line\'s halves', store => { change(store.databaseFile, "UPDATE line_prefs SET signature=0 WHERE line_id='100:101'"); }, {elements: 1}],
      ['a rotation', store => { change(store.databaseFile, "UPDATE map_settings SET rotation=0 WHERE device='panels'"); }, {mapSettings: 1}],
      ['a lost pending edit', store => { change(store.databaseFile, 'DELETE FROM map_pending'); }, {pendingEdits: 1}],
      ['a renamed favorite', store => { change(store.databaseFile, "UPDATE animation_favorites SET name='Other' WHERE name='Marker Favorite Calm'"); }, {favorites: 2}],
      ['a mode', store => { change(store.databaseFile, "UPDATE meta SET value='free' WHERE key='mode@panels'"); }, {deviceState: 1}],
      ['an epoch', store => { change(store.databaseFile, "INSERT INTO meta VALUES ('wave_cutoff','1.0')"); }, {startFresh: 1}],
      ['a task', store => { change(store.databaseFile, "INSERT INTO sessions VALUES ('task','t1','working',1.0)"); }, {startFresh: 1}],
      ['a selected shared input', store => { change(store.databaseFile, "UPDATE shared_input SET source='shared'"); }, {startFresh: 1}],
      ['an extra table', store => { change(store.databaseFile, 'CREATE TABLE extra (x)'); }, {database: 1}],
      ['an edited layout', store => {
        const path = join(store.folder, 'layout.json');
        writeFileSync(path, readFileSync(path, 'utf8').replace('"position": [', '"position": [1'));
      }, {layout: 1}],
      ['a missing scene', store => { unlinkSync(join(store.folder, 'scene-state.panels.json')); }, {scenes: 1}],
      ['a scene others can read', store => { chmodSync(join(store.folder, 'scene-state.json'), 0o644); }, {scenes: 1}],
      ['a linked scene', store => { linkSync(join(store.folder, 'scene-state.json'), join(store.folder, 'scene-copy.json')); }, {scenes: 1, unexpected: 1}],
      ['an extra file', store => { writeFileSync(join(store.folder, 'stray'), 'x', {mode: 0o600}); }, {unexpected: 1}],
      ['a folder others can open', store => { chmodSync(store.folder, 0o755); }, {unexpected: 1}],
      ['a database others can read', store => { chmodSync(store.databaseFile, 0o644); }, {database: 1}],
    ];
    for (const [name, damage, expected] of cases) {
      const store = migrate(source, join(directory, name.replaceAll(' ', '-').replaceAll('\'', '')));
      damage(store);
      assert.deepEqual(verify(source, store).mismatches, {...zeroMismatches, ...expected}, name);
    }
  });

  test('requires every table that starts fresh to be empty, the module\'s own included', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const store = migrate(source, directory);
    const carried = new Set(['projects', 'palette', 'line_prefs', 'map_settings', 'map_pending', 'animation_favorites', 'meta', 'shared_input']);
    const tables = rowsOf(store.databaseFile, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map(([name]) => String(name)).filter(name => !carried.has(name));
    assert.deepEqual(tables, [...START_FRESH].sort(), 'every other table of the module\'s schema starts fresh');
    for (const table of tables) {
      // One row of plausible values: an integer for an INTEGER column, a real for a REAL one, text otherwise.
      const columns = rowsOf(store.databaseFile, `PRAGMA table_info("${table}")`).map(([, name, type]) => [String(name), String(type)] as const);
      const values = columns.map(([name, type]) => name === 'phase' ? "'queued'" : type === 'INTEGER' ? '1' : type === 'REAL' ? '1.5' : "'x'");
      change(store.databaseFile, `INSERT INTO "${table}" (${columns.map(([name]) => `"${name}"`).join(', ')}) VALUES (${values.join(', ')})`);
      assert.deepEqual(verify(source, store).mismatches, {...zeroMismatches, startFresh: 1}, table);
      change(store.databaseFile, `DELETE FROM "${table}"`);
    }
  });

  test('a missing database counts as the database and every carried row', async context => {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const store = migrate(source, directory);
    rmSync(store.databaseFile);
    const {mismatches} = verify(source, store);
    assert.deepEqual(mismatches, {...zeroMismatches, database: 1, projects: 3, palette: 2, elements: 5, mapSettings: 2, pendingEdits: 1, favorites: 2, deviceState: 8});
  });
});

/** The parts of the Lines' wall view that the migration carries. */
type MigratedWall = {
  source: string; layout: string; settings: Record<string, unknown>; palette: Record<string, string>; projects: {id: string; color: string | null}[];
  elements: {id: string; project: string | null}[];
};

function migratedWall(world: ModuleWorld): MigratedWall {
  const wall = world.state<MigratedWall>('nanoleaf-wall', 'wall');
  assert.ok(wall !== undefined, 'the Lines\' wall view');
  return wall;
}

suite('the module on the migrated store', () => {
  async function migratedWorld(context: TestContext, address = LINES_ADDRESS): Promise<{world: ModuleWorld; section: NanoleafSection}> {
    const directory = temporary(context);
    const source = await syntheticState(directory);
    const stateDir = join(directory, 'state');
    mkdirSync(join(stateDir, 'nanoleaf'), {recursive: true, mode: 0o700});
    const state = InstalledState.open(source);
    let section: NanoleafSection;
    try {
      const database = new DatabaseSync(join(stateDir, 'nanoleaf.sqlite'));
      migrateNanoleaf(state, {database, folder: join(stateDir, 'nanoleaf')});
      database.close();
      section = convertNanoleafState(state, '/secrets').section;
    } finally {
      state.close();
    }
    // An address change is a one-line edit of the section: the device keeps its ID.
    const moved = {...section, devices: section.devices.map(device => device.id === 'wall' ? {...device, address} : device)};
    const world = await ModuleWorld.open(context, {
      stateDir, section: moved, secrets: {'wall-token': SYNTHETIC_TOKEN, 'panels-token': SYNTHETIC_TOKEN},
      devices: {[address]: 'lines', [PANELS_ADDRESS]: 'panels'},
    });
    return {world, section: moved};
  }

  test('shows the migrated settings, palette, projects, mode and favorites, and selects shared input at its first sync', async context => {
    const {world} = await migratedWorld(context);
    await world.start();
    await world.until(() => world.wall()?.source === 'shared', 5000, 'shared input selected at the first sync');
    const wall = migratedWall(world);
    assert.deepEqual(wall.settings, {style: 'project', coverage: 'status', rotation: 90, flipX: 1, flipY: 0});
    assert.equal(wall.palette.working, '#11aa22');
    assert.equal(wall.palette.unread, '#cc33ff');
    assert.deepEqual(wall.projects.map(project => [project.id, project.color]), [['project-alpha', '#aa55ff'], ['project-beta', '#123456'], ['project-gamma', '#00aa88']]);
    assert.equal(wall.layout, 'saved');
    assert.equal(wall.elements.find(element => element.id === '100:101')?.project, 'project-alpha');
    assert.deepEqual(world.device_()?.desired, {power: {status: 'unknown'}, brightness: {status: 'known', value: 40}, mode: {status: 'known', value: 'work'}});
    assert.deepEqual(world.state<DeviceRecord>('device', 'panels')?.desired.mode, {status: 'known', value: 'quiet'});
    const favorites = world.state<{favorites: {name: string}[]}>('nanoleaf-animations', 'wall')?.favorites.map(favorite => favorite.name);
    assert.deepEqual(favorites, ['Marker Favorite Calm', 'Marker Favorite Wave']);
    world.verify();
  });

  test('an address change in the section keeps the device\'s identity and preferences', async context => {
    const moved = '192.0.2.20';
    const {world} = await migratedWorld(context, moved);
    await world.start();
    await world.until(() => world.device_()?.availability === 'available', 10_000, 'the Lines answer at their new address');
    const wall = migratedWall(world);
    assert.deepEqual(wall.settings, {style: 'project', coverage: 'status', rotation: 90, flipX: 1, flipY: 0});
    assert.equal(wall.palette.working, '#11aa22');
    assert.ok((world.device.state().devices[moved]?.reads ?? 0) > 0, 'the module reaches the new address');
    assert.equal(world.device.state().devices[LINES_ADDRESS], undefined, 'and not the old one');
    world.verify();
  });
});
