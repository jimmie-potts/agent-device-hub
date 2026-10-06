// Translated from codex-nanoleaf tests/test_enrollment.py (#45, #114). The command line, credential prompt, pairing request
// and controller ledger are not ported; PORTING.md lists every case and where the rest went.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {isObject, type JsonObject} from '../src/compat.js';
import {withState} from '../src/database.js';
import {linesEntry, lockFile, sceneFile, saveLayout} from '../src/devices.js';
import {changeAddress, check, enroll, remove, type Enrollment} from '../src/enrollment.js';
import {Partial as PartialChange} from '../src/errors.js';
import {writeJson} from '../src/jsonfile.js';
import {execute, rows, type Row} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import {fixtureJson, loadDump, recordedSetup, setMode, suite, temporary, test, write} from './support.js';

const FIXTURE = (fixtureJson('nl22-panels-fixture.json') as {panelLayout: JsonObject}).panelLayout;
const [LINES_IP, PANELS_IP, OTHER_IP, NEW_IP] = ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'];
const [LINES_TOKEN, PANELS_TOKEN] = ['fakeLines', 'fakePanelsCredential1'];

/** Fake Lines and NL22 controllers addressed by their configured address; only the verification read is answered. */
class FakeDevices {
  info: Record<string, JsonObject> = {
    [PANELS_IP]: {name: 'Light Panels', model: 'NL22', firmwareVersion: '5.2.2', panelLayout: structuredClone(FIXTURE)},
    [LINES_IP]: {name: 'Lines', model: 'NL59', firmwareVersion: '9.0.0'},
  };
  unreachable = new Set<string>();
  seen: [string, string, string, string][] = [];

  constructor() {
    // The same Panels after a new DHCP lease.
    this.info[NEW_IP] = structuredClone(this.info[PANELS_IP] ?? {});
  }

  request = (address: {ip: string; token: string}, method: string, endpoint = ''): Promise<unknown> => {
    this.seen.push([address.ip, address.token, method, endpoint]);
    if (this.unreachable.has(address.ip)) return Promise.reject(Object.assign(new Error('Device unavailable'), {code: 'EHOSTUNREACH'}));
    if (method === 'GET' && endpoint === '') return Promise.resolve(structuredClone(this.info[address.ip]));
    return Promise.reject(new Error(`Unexpected light request ${method} ${endpoint}`));
  };

  points(ip: string): Record<string, unknown>[] {
    const layout = this.info[ip]?.panelLayout;
    if (!isObject(layout) || !isObject(layout.layout) || !Array.isArray(layout.layout.positionData)) throw new Error('No layout.');
    return layout.layout.positionData as Record<string, unknown>[];
  }
}

type Snapshot = [Record<string, string>, Record<string, string[]>, string];

/** EnrollmentTest.setUp: an installed Lines device with tasks, a reservation and Quiet mode. */
class Enrolling {
  readonly directory: string;
  readonly hooks: string;
  readonly fake = new FakeDevices();

  constructor(context: TestContext) {
    const parent = temporary(context);
    this.directory = join(parent, 'state');
    mkdirSync(this.directory, {mode: 0o700});
    this.hooks = join(parent, 'hooks.json');
    writeFileSync(this.hooks, JSON.stringify({hooks: {Stop: [{hooks: [{type: 'command', command: 'trusted'}]}]}}));
    writeJson(join(this.directory, 'config.json'), {ip: LINES_IP, token: LINES_TOKEN,
      devices: {wall: {kind: 'lines', ip: LINES_IP, token_ref: 'token'}}, wall_port: 8765, controller_port: 41231, mcp_port: 41230});
    const lines = linesEntry(Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]), Array.from({length: 15}, (_, i) => [i * 10, 0]));
    saveLayout(join(this.directory, 'layout.json'), new Map([['wall', lines]]));
    writeJson(join(this.directory, 'mcp-credentials.json'), {principals: [{id: 'codex'}]});
    // Two prompted tasks, the alpha reservation and Quiet, as the Python setUp saved them.
    loadDump(this.directory, recordedSetup('enrollment'));
  }

  query(sql: string, ...params: (string | number | null)[]): Row[] {
    return withState(this.directory, db => rows(db, sql, ...params));
  }

  config(): JsonObject {
    return JSON.parse(readFileSync(join(this.directory, 'config.json'), 'utf8')) as JsonObject;
  }

  layout(): {devices: Record<string, {kind: string; elements: {id: string}[]}>} {
    return JSON.parse(readFileSync(join(this.directory, 'layout.json'), 'utf8')) as {devices: Record<string, {kind: string; elements: {id: string}[]}>};
  }

  /** Every file in the state directory and the hooks file, plus the shared rows. */
  snapshot(): Snapshot {
    const files: Record<string, string> = {};
    for (const name of readdirSync(this.directory).sort()) {
      const path = join(this.directory, name);
      if (statSync(path).isFile() && !/\.sqlite$|-journal$|-wal$|-shm$/.test(name)) files[name] = readFileSync(path, 'base64');
    }
    const tables = withState(this.directory, db => Object.fromEntries(
      rows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(([name]) =>
        [String(name), rows(db, `SELECT * FROM "${String(name)}"`).map(row => JSON.stringify(row)).sort()])));
    return [files, tables, readFileSync(this.hooks, 'utf8')];
  }

  enroll(options: Partial<Enrollment> = {}): ReturnType<typeof enroll> {
    return enroll(this.directory, {ip: PANELS_IP, token: PANELS_TOKEN, request: this.fake.request, ...options});
  }

  status(device = 'wall'): {mode: string; pending: boolean; error: string | null} {
    const state = withState(this.directory, db => controlState(db, device));
    return {mode: state.mode, pending: state.revision !== state.applied, error: state.error};
  }
}

const devicesOf = (config: JsonObject): JsonObject => (isObject(config.devices) ? config.devices : {});
const refused = (message: RegExp | string): {name: string; message: RegExp} =>
  ({name: 'ValueError', message: typeof message === 'string' ? new RegExp(message.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&')) : message});

suite('EnrollTest', () => {
  // AC1: verified registration beside Lines without fresh setup.
  test('test_enrolls_panels_beside_lines_without_touching_lines_or_tasks', async context => {
    const e = new Enrolling(context);
    const [files, tables, hooks] = e.snapshot();
    const summary = await e.enroll();
    assert.equal(summary.device, 'panels');
    assert.equal(summary.triangles, 18);
    const config = e.config();
    assert.deepEqual(devicesOf(config).panels, {kind: 'panels', ip: PANELS_IP, token_ref: 'token@panels'});
    assert.equal(config['token@panels'], PANELS_TOKEN);
    const before = JSON.parse(Buffer.from(files['config.json'] ?? '', 'base64').toString()) as JsonObject;
    const {devices: _after, 'token@panels': _token, ...rest} = config;
    const {devices: _before, ...earlier} = before;
    assert.deepEqual(rest, earlier);
    assert.deepEqual(devicesOf(config).wall, devicesOf(before).wall);
    const layout = e.layout();
    const savedLayout = JSON.parse(Buffer.from(files['layout.json'] ?? '', 'base64').toString()) as ReturnType<Enrolling['layout']>;
    assert.deepEqual(layout.devices.wall, savedLayout.devices.wall);
    assert.equal(layout.devices.panels?.kind, 'panels');
    assert.equal(layout.devices.panels?.elements.length, 18);
    assert.equal(e.snapshot()[2], hooks);
    const after = e.snapshot()[1];
    for (const table of ['sessions', 'activity', 'task_info', 'line_prefs', 'slots', 'comets']) assert.deepEqual(after[table], tables[table], table);
    assert.equal(e.status().mode, 'quiet');
    // Only the verification read reached the new device; Lines was not contacted.
    assert.deepEqual(e.fake.seen.map(([ip, , method, endpoint]) => [ip, method, endpoint]), [[PANELS_IP, 'GET', '']]);
  });

  test('test_wrong_model_or_unusable_layout_changes_nothing', async context => {
    const e = new Enrolling(context);
    const before = e.snapshot();
    const info = e.fake.info[PANELS_IP] ?? {};
    info.model = 'NL59';
    await assert.rejects(e.enroll(), refused('NL22'));
    assert.deepEqual(e.snapshot(), before);
    info.model = 'NL22';
    const first = e.fake.points(PANELS_IP)[0];
    if (first !== undefined) first.shapeType = 7;
    await assert.rejects(e.enroll(), refused('Unsupported'));
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_unreachable_device_writes_nothing', async context => {
    const e = new Enrolling(context);
    const before = e.snapshot();
    e.fake.unreachable.add(PANELS_IP);
    await assert.rejects(e.enroll(), {code: 'EHOSTUNREACH'});
    assert.deepEqual(e.snapshot(), before);
  });

  // AC4: conflicts never redirect an identity.
  test('test_conflicting_identity_or_address_is_refused', async context => {
    const e = new Enrolling(context);
    await e.enroll();
    const before = e.snapshot();
    const cases: [Partial<Enrollment>, string][] = [[{device: 'wall'}, 'reserved'], [{device: 'bad id'}, 'Invalid device'],
      [{device: 'second', ip: LINES_IP}, 'already uses'], [{device: 'second', ip: PANELS_IP}, 'already uses'],
      [{ip: OTHER_IP}, 'another address'], [{ip: '8.8.8.8'}, 'private IPv4'], [{token: 'has space'}, 'letters and numbers']];
    for (const [options, reason] of cases) {
      await assert.rejects(e.enroll(options), refused(reason), reason);
      assert.deepEqual(e.snapshot(), before);
    }
  });

  test('test_repeat_enrollment_replaces_only_the_credential', async context => {
    const e = new Enrolling(context);
    await e.enroll();
    setMode(e.directory, 'quiet', 1000, 'panels');
    const element = e.layout().devices.panels?.elements[0]?.id ?? '';
    write(e.directory, db => execute(db, "INSERT INTO line_prefs (line_id, project, signature, device) VALUES (?, 'beta', 0, 'panels')", element));
    const [files, tables] = e.snapshot();
    e.fake.points(PANELS_IP).pop();
    const summary = await e.enroll({token: 'replacementCredential2'});
    assert.ok(summary.repeat);
    const config = e.config();
    assert.equal(config['token@panels'], 'replacementCredential2');
    const before = JSON.parse(Buffer.from(files['config.json'] ?? '', 'base64').toString()) as JsonObject;
    const {'token@panels': _now, ...rest} = config;
    const {'token@panels': _then, ...earlier} = before;
    assert.deepEqual(rest, earlier);
    assert.deepEqual(e.snapshot()[1], tables);
    assert.equal(e.snapshot()[0]['layout.json'], files['layout.json']);
    assert.equal(e.status('panels').mode, 'quiet');
  });

  test('test_repeat_refuses_an_entry_that_shares_the_lines_credential', async context => {
    const e = new Enrolling(context);
    const config = e.config();
    devicesOf(config).panels = {kind: 'panels', ip: PANELS_IP, token_ref: 'token'};
    writeJson(join(e.directory, 'config.json'), config); // A hand-edited registry.
    const before = e.snapshot();
    await assert.rejects(e.enroll(), refused('shares'));
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_new_enrollment_refuses_a_credential_key_another_device_uses', async context => {
    const e = new Enrolling(context);
    const config = e.config();
    devicesOf(config).other = {kind: 'panels', ip: OTHER_IP, token_ref: 'token@panels'};
    config['token@panels'] = 'otherCredential';
    writeJson(join(e.directory, 'config.json'), config); // A hand-edited registry.
    const before = e.snapshot();
    await assert.rejects(e.enroll(), refused('other'));
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_malformed_layout_is_refused_before_any_write', async context => {
    const e = new Enrolling(context);
    writeJson(join(e.directory, 'layout.json'), {version: 99, devices: {}});
    const before = e.snapshot();
    await assert.rejects(e.enroll(), refused('layout'));
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_machine_credentials_are_unchanged', async context => {
    // The controller's credential table is not ported; the MCP credentials file is the machine credential left here.
    const e = new Enrolling(context);
    const credentials = readFileSync(join(e.directory, 'mcp-credentials.json'));
    await e.enroll();
    assert.deepEqual(readFileSync(join(e.directory, 'mcp-credentials.json')), credentials);
  });
});

suite('PrivacyTest', () => {
  // AC2: private storage, no credential in output or browser responses.
  test('test_files_are_owner_only_and_output_never_contains_the_credential', async context => {
    // Command output and the wall view are not ported; the private file modes are the enrollment's own.
    const e = new Enrolling(context);
    await e.enroll();
    for (const name of ['config.json', 'layout.json']) assert.equal(statSync(join(e.directory, name)).mode & 0o777, 0o600, name);
    e.fake.info[OTHER_IP] = {name: 'Canvas', model: 'NL29'};
    const error = await e.enroll({device: 'other', ip: OTHER_IP}).then(() => null, (failure: unknown) => failure);
    assert.ok(error instanceof Error && error.name === 'ValueError');
    assert.ok(!error.message.includes(PANELS_TOKEN));
  });

  test('test_conflicts_are_refused_before_pairing_or_prompting', async context => {
    // The command checks the target before it pairs or prompts; check() is that step.
    const e = new Enrolling(context);
    for (const [device, ip] of [['panels', LINES_IP], ['wall', PANELS_IP]] as const) await assert.rejects(check(e.directory, device, ip), {name: 'ValueError'});
    assert.deepEqual(e.fake.seen, []);
  });

  test('test_windows_mounted_state_is_refused', async () => {
    await assert.rejects(enroll('/mnt/c/Users/fixture/CodexNanoleaf', {ip: PANELS_IP, token: PANELS_TOKEN, request: () => Promise.resolve(null)}), refused('Windows'));
    await assert.rejects(remove('/mnt/c/Users/fixture/CodexNanoleaf', 'panels'), refused('Windows'));
  });

  test('test_symlink_to_a_windows_drive_is_refused', async context => {
    const e = new Enrolling(context);
    const linked = join(dirname(e.directory), 'linked-state');
    symlinkSync('/mnt/c/Users/fixture/CodexNanoleaf', linked);
    await assert.rejects(enroll(linked, {ip: PANELS_IP, token: PANELS_TOKEN, request: e.fake.request}), refused('Windows'));
  });
});

suite('FreeStartTest', () => {
  // AC3: dark until activated; activation replays nothing.
  test('test_enrolled_device_stays_dark_until_activated', async context => {
    // The worker pass that sends nothing moves with the worker (slice 3); an empty credential is refused before any request.
    const e = new Enrolling(context);
    await e.enroll();
    e.fake.seen = [];
    assert.deepEqual(e.status('panels'), {mode: 'free', pending: false, error: null});
    await assert.rejects(e.enroll({token: ''}), refused('letters and numbers'));
    assert.deepEqual(e.fake.seen, []);
  });

  test('test_stale_state_for_a_new_id_is_cleared_before_registration', async context => {
    const e = new Enrolling(context);
    write(e.directory, db => {
      for (const [key, value] of [['mode@panels', 'work'], ['mode_revision@panels', '4'], ['control_error@panels', 'old']]) {
        execute(db, 'INSERT INTO meta VALUES (?, ?)', key ?? '', value ?? '');
      }
      execute(db, "INSERT INTO comets (session, turn, queued, device) VALUES ('a', '1', 1, 'panels')");
    });
    writeFileSync(join(e.directory, sceneFile('panels')), '{}');
    await e.enroll();
    assert.deepEqual(e.status('panels'), {mode: 'free', pending: false, error: null});
    assert.deepEqual(e.query("SELECT * FROM comets WHERE device='panels'"), []);
    assert.equal(existsSync(join(e.directory, sceneFile('panels'))), false);
  });

  test('test_new_id_with_a_running_worker_is_refused', async context => {
    const e = new Enrolling(context);
    const lock = new DatabaseSync(join(e.directory, lockFile('panels')), {timeout: 0});
    try {
      lock.exec('BEGIN EXCLUSIVE');
      await assert.rejects(e.enroll(), refused('worker'));
    } finally {
      lock.close();
    }
    assert.ok(!('panels' in devicesOf(e.config())));
  });
});

/** RemoveTest.setUp: the Panels enrolled beside the Lines. */
async function enrolled(context: TestContext): Promise<Enrolling> {
  const e = new Enrolling(context);
  await e.enroll();
  return e;
}

const holdsPanels = (row: string): boolean => (JSON.parse(row) as unknown[]).some(value => value === 'panels');

function linesState(e: Enrolling): unknown[] {
  const tables = e.snapshot()[1];
  const kept = Object.fromEntries(Object.entries(tables).filter(([table]) => table !== 'meta').map(([table, values]) => [table, values.filter(row => !holdsPanels(row))]));
  return [kept, devicesOf(e.config()).wall, e.layout().devices.wall, e.status()];
}

suite('RemoveTest', () => {
  // AC4 and AC6: explicit removal leaves Lines and tasks alone.
  test('test_removes_a_free_device_and_everything_it_owned', async context => {
    const e = await enrolled(context);
    setMode(e.directory, 'work', 1000, 'panels');
    const element = e.layout().devices.panels?.elements[0]?.id ?? '';
    write(e.directory, db => {
      execute(db, "INSERT INTO line_prefs (line_id, project, device) VALUES (?, 'beta', 'panels')", element);
      execute(db, "INSERT INTO meta VALUES ('mode_applied@panels', '1')");
    });
    writeFileSync(join(e.directory, sceneFile('panels')), '{}');
    setMode(e.directory, 'free', 1000, 'panels');
    write(e.directory, db => execute(db, "INSERT OR REPLACE INTO meta VALUES ('mode_applied@panels', '2')"));
    const before = linesState(e);
    const result = await remove(e.directory, 'panels');
    assert.ok(result.cleaned);
    const config = e.config();
    assert.ok(!('panels' in devicesOf(config)));
    assert.ok(!('token@panels' in config));
    assert.ok(!('panels' in e.layout().devices));
    assert.equal(existsSync(join(e.directory, sceneFile('panels'))), false);
    const left = Object.values(e.snapshot()[1]).flat().filter(row => holdsPanels(row) || row.includes('@panels'));
    assert.deepEqual(left, []);
    assert.deepEqual(linesState(e), before);
  });

  test('test_refuses_before_the_free_handoff_unless_forced', async context => {
    const e = await enrolled(context);
    setMode(e.directory, 'work', 1000, 'panels');
    await assert.rejects(remove(e.directory, 'panels'), refused('mode free --device panels'));
    setMode(e.directory, 'free', 1000, 'panels'); // Pending: the worker has not applied Free yet.
    await assert.rejects(remove(e.directory, 'panels'), refused('not been applied'));
    assert.ok('panels' in devicesOf(e.config()));
    assert.ok((await remove(e.directory, 'panels', {force: true})).cleaned);
    assert.ok(!('panels' in devicesOf(e.config())));
  });

  test('test_lines_and_unknown_ids_cannot_be_removed', async context => {
    const e = await enrolled(context);
    const before = e.snapshot();
    for (const device of ['wall', 'missing']) await assert.rejects(remove(e.directory, device), {name: 'ValueError'}, device);
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_busy_worker_leaves_cleanup_for_a_rerun', async context => {
    const e = await enrolled(context);
    const lock = new DatabaseSync(join(e.directory, lockFile('panels')), {timeout: 0});
    let result: {cleaned: boolean};
    try {
      lock.exec('BEGIN EXCLUSIVE');
      result = await remove(e.directory, 'panels', {wait: 0.2});
    } finally {
      lock.close();
    }
    assert.equal(result.cleaned, false);
    assert.ok(!('panels' in devicesOf(e.config())));
    assert.ok('panels' in e.layout().devices);
    assert.ok(e.query("SELECT 1 FROM meta WHERE key='mode@panels'").length > 0);
    assert.ok((await remove(e.directory, 'panels')).cleaned);
    assert.ok(!('panels' in e.layout().devices));
    assert.deepEqual(e.query("SELECT 1 FROM meta WHERE key LIKE '%@panels'"), []);
    await assert.rejects(remove(e.directory, 'panels'), refused('Unknown'));
  });

  test('test_removing_the_only_layout_entry_removes_it', async context => {
    const e = await enrolled(context);
    const layout = e.layout();
    delete layout.devices.wall;
    writeJson(join(e.directory, 'layout.json'), layout);
    assert.ok((await remove(e.directory, 'panels')).cleaned);
    assert.equal(existsSync(join(e.directory, 'layout.json')), false);
    await assert.rejects(remove(e.directory, 'panels'), refused('Unknown'));
  });

  test('test_malformed_layout_is_refused_before_removal_writes', async context => {
    // Python ran this through the device-remove command; its message wording is the command line's.
    const e = await enrolled(context);
    writeJson(join(e.directory, 'layout.json'), {version: 99, devices: {}});
    const before = e.snapshot();
    await assert.rejects(remove(e.directory, 'panels'), refused('layout'));
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_failure_after_the_registry_write_asks_for_a_rerun', async context => {
    // Python patched worker_lock to fail; an unopenable lock file fails it the same way. The rerun request is the
    // command line's message for a Partial failure.
    const e = await enrolled(context);
    const lockPath = join(e.directory, lockFile('panels'));
    rmSync(lockPath);
    mkdirSync(lockPath);
    await assert.rejects(remove(e.directory, 'panels'), (error: unknown) => error instanceof PartialChange);
    assert.ok(!('panels' in devicesOf(e.config())));
    rmSync(lockPath, {recursive: true});
    assert.ok((await remove(e.directory, 'panels')).cleaned);
  });
});

/** AddressTest.setUp: enrolled Panels in Quiet with a reservation, a placed task and a saved scene. */
async function addressed(context: TestContext): Promise<Enrolling> {
  const e = await enrolled(context);
  setMode(e.directory, 'quiet', 1000, 'panels');
  const element = e.layout().devices.panels?.elements[0]?.id ?? '';
  write(e.directory, db => {
    execute(db, "INSERT INTO line_prefs (line_id, project, signature, device) VALUES (?, 'beta', 0, 'panels')", element);
    execute(db, "INSERT INTO slots (session, slot, device) VALUES ('a', 0, 'panels')");
  });
  writeFileSync(join(e.directory, sceneFile('panels')), '{"version": 1, "scene": "Forest"}');
  e.fake.seen = [];
  return e;
}

const change = (e: Enrolling, device = 'panels', ip = NEW_IP): ReturnType<typeof changeAddress> =>
  changeAddress(e.directory, device, ip, e.fake.request);

suite('AddressTest', () => {
  // #114: change a registered device's address without re-enrolling.
  test('test_changes_only_the_registered_address', async context => {
    // The configuration load that follows moves with configuration.load_config (slice 2); the saved registry is read instead.
    const e = await addressed(context);
    const [files, tables, hooks] = e.snapshot();
    assert.deepEqual(await change(e), {device: 'panels', ip: NEW_IP, triangles: 18});
    const config = e.config();
    const before = JSON.parse(Buffer.from(files['config.json'] ?? '', 'base64').toString()) as JsonObject;
    const panels = devicesOf(before).panels;
    if (isObject(panels)) panels.ip = NEW_IP;
    assert.deepEqual(config, before);
    assert.deepEqual(Object.keys(devicesOf(config)), ['wall', 'panels']);
    const after = e.snapshot();
    const {'config.json': _changed, ...unchanged} = after[0];
    const {'config.json': _original, ...originals} = files;
    assert.deepEqual(unchanged, originals);
    assert.deepEqual(after[1], tables);
    assert.equal(after[2], hooks);
    assert.equal(e.status('panels').mode, 'quiet');
    // AC3: one verification read with the stored credential, and no light write.
    assert.deepEqual(e.fake.seen, [[NEW_IP, PANELS_TOKEN, 'GET', '']]);
    assert.equal((devicesOf(e.config()).panels as JsonObject).ip, NEW_IP);
  });

  // AC2: the new address is checked before anything is written.
  test('test_address_in_use_or_not_private_is_refused_before_contacting_a_device', async context => {
    const e = await addressed(context);
    const config = e.config();
    devicesOf(config).second = {kind: 'panels', ip: OTHER_IP, token_ref: 'token@second'};
    writeJson(join(e.directory, 'config.json'), config); // A second registered Panels device.
    const before = e.snapshot();
    for (const [ip, reason] of [[LINES_IP, 'already uses'], [OTHER_IP, '`second` already uses'], [PANELS_IP, 'already registered at'],
      ['8.8.8.8', 'private IPv4'], ['fd00::1', 'private IPv4'], ['not-an-ip', 'address']] as const) {
      await assert.rejects(change(e, 'panels', ip), refused(reason), ip);
      assert.deepEqual(e.snapshot(), before);
    }
    assert.deepEqual(e.fake.seen, []);
  });

  test('test_a_different_device_at_the_new_address_is_refused', async context => {
    const e = await addressed(context);
    const before = e.snapshot();
    const info = e.fake.info[NEW_IP] ?? {};
    info.model = 'NL59';
    await assert.rejects(change(e), refused('NL22'));
    assert.deepEqual(e.snapshot(), before);
    info.model = 'NL22';
    e.fake.points(NEW_IP).pop();
    await assert.rejects(change(e), refused('saved layout'));
    assert.deepEqual(e.snapshot(), before);
    const first = e.fake.points(NEW_IP)[0];
    if (first !== undefined) first.shapeType = 7;
    await assert.rejects(change(e), refused('Unsupported'));
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_same_count_with_other_triangles_or_moved_geometry_is_refused', async context => {
    const e = await addressed(context);
    const before = e.snapshot();
    const points = e.fake.points(NEW_IP);
    const original = structuredClone(points);
    const triangle = points.find(point => point.shapeType !== 7);
    assert.ok(triangle !== undefined);
    const translate = (): void => {
      for (const point of points) point.x = Number(point.x) + 10; // Still connected, but every triangle sits elsewhere.
    };
    for (const mutate of [(point: Record<string, unknown>): void => { point.panelId = 65000; }, translate]) {
      points.splice(0, points.length, ...structuredClone(original));
      const target = points.find(point => point.panelId === triangle.panelId);
      assert.ok(target !== undefined);
      mutate(target);
      await assert.rejects(change(e), refused('saved layout'));
      assert.deepEqual(e.snapshot(), before);
    }
  });

  test('test_unreachable_address_writes_nothing', async context => {
    const e = await addressed(context);
    const before = e.snapshot();
    e.fake.unreachable.add(NEW_IP);
    await assert.rejects(change(e), {code: 'EHOSTUNREACH'});
    assert.deepEqual(e.snapshot(), before);
  });

  test('test_lines_and_unknown_ids_are_refused', async context => {
    const e = await addressed(context);
    const before = e.snapshot();
    for (const [device, reason] of [['wall', 'Lines'], ['missing', 'Unknown'], ['bad id', 'Invalid device']] as const) {
      await assert.rejects(change(e, device), refused(reason), device);
    }
    assert.deepEqual(e.snapshot(), before);
    assert.deepEqual(e.fake.seen, []);
  });

  test('test_malformed_layout_is_refused_before_any_request', async context => {
    const e = await addressed(context);
    writeJson(join(e.directory, 'layout.json'), {version: 99, devices: {}});
    const before = e.snapshot();
    await assert.rejects(change(e), refused('layout'));
    assert.deepEqual(e.snapshot(), before);
    assert.deepEqual(e.fake.seen, []);
  });
});
