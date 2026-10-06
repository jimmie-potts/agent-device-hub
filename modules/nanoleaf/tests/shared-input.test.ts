// Translated from codex-nanoleaf tests/test_shared_input.py (PORTING.md lists every case and where untranslated parts went).
// Suite names are the Python classes and test names the Python methods.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {sha256Hex, type JsonObject} from '../src/compat.js';
import {withState} from '../src/database.js';
import {FeedError} from '../src/errors.js';
import {writeJson} from '../src/jsonfile.js';
import {dashboard} from '../src/line-projection.js';
import {Metadata} from '../src/project-map.js';
import {BACKUP_TABLES, declared, dumpTables, identityKey, presented, restoreLegacyTasks, restoreTables, saveLegacyTasks, semanticStatus,
  validateConfig, type Envelope, type Identity, type SharedConfig, type SharedSession, type Snapshot} from '../src/shared-input.js';
import {selectSource} from '../src/shared-source.js';
import {execute, rows, transaction, type Row} from '../src/sqlite.js';
import {accept, clone, configure, envelope, evictTask, exists, failed, firstSession, fixture, fixtureJson, generation, loadDump, query,
  recordedSetup, selectionSetup, selectLegacy, selectShared, setMode, sharedState, suite, temporary, test, wallView, write,
  type WallTask} from './support.js';

const KEY = identityKey(firstSession(envelope()).identity);
/** Rows in a stable order, as Python's sorted(..., key=repr). */
const byText = (values: readonly Row[]): Row[] => [...values].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
const throwsFeed = (body: () => unknown, code?: string): void => {
  assert.throws(body, (error: unknown) => error instanceof FeedError && (code === undefined || error.message === code));
};

suite('TransportTest', () => {
  test('test_configuration_rejects_remote_targets_and_unqualified_sources', () => {
    const config: JsonObject = {version: 1, ownerId: 'owner', consumerId: 'nanoleaf', endpoint: 'http://127.0.0.1:41000/api/monitor/v1',
      tokenFile: '/synthetic/token', clearOnNewTurn: true,
      qualifiedSources: [{provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source'}], bindings: []};
    validateConfig(config);
    for (const [key, value] of [['endpoint', 'http://example.com/api/monitor/v1'], ['endpoint', 'http://127.0.0.1:42/api/monitor/v1?x=1'],
      ['clearOnNewTurn', false], ['qualifiedSources', []]] as const) {
      throwsFeed(() => validateConfig({...config, [key]: value}), 'invalid-config');
    }
  });
});

suite('SelectionTest', () => {
  test('test_atomic_cutover_identity_and_legacy_suppression', context => {
    const {path} = selectionSetup(context);
    assert.equal(sharedState(path).source, 'legacy');
    const value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    assert.deepEqual(query(path, 'SELECT id,status FROM sessions'), [[KEY, 'working']]);
    assert.deepEqual(query(path, 'SELECT session,slot FROM slots'), [[KEY, 0]]);
    assert.deepEqual(query(path, 'SELECT started FROM activity'), [[1000]]);
    // The ignored legacy hook event moves with legacy input (slice 3); the inspection view is not ported.
    assert.equal(sharedState(path).source, 'shared');
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
  });

  test('test_failed_preflight_and_comet_reservation_preserve_legacy', context => {
    const {path} = selectionSetup(context);
    // A failed fetch never reaches the port, which receives envelopes from the runtime; legacy input stays selected.
    assert.equal(sharedState(path).source, 'legacy');
    write(path, db => execute(db, "INSERT INTO comets (session, turn, queued, source, started) VALUES ('legacy','turn',1000,0,1000)"));
    throwsFeed(() => selectShared(path), 'active-comet');
    assert.deepEqual(query(path, 'SELECT id FROM sessions'), [['legacy']]);
  });

  test('test_rollback_preserves_mode_and_current_bound_assignment', context => {
    const {path} = selectionSetup(context);
    selectShared(path);
    write(path, db => {
      execute(db, 'UPDATE slots SET slot=2 WHERE session=?', KEY);
      execute(db, "INSERT OR REPLACE INTO meta VALUES ('mode','free')");
    });
    selectLegacy(path);
    assert.deepEqual(query(path, 'SELECT id,status FROM sessions'), [['legacy', 'working']]);
    assert.deepEqual(query(path, 'SELECT session,slot FROM slots'), [['legacy', 2]]);
    assert.deepEqual(query(path, "SELECT value FROM meta WHERE key='mode'"), [['free']]);
    assert.equal(sharedState(path).source, 'legacy');
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
  });

  test('test_notices_read_and_same_project_concurrency', context => {
    const {path} = selectionSetup(context);
    let value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    value = clone(value);
    value.snapshot.revision = 3;
    const session = firstSession(value);
    session.activity = 'idle';
    session.notices[0]?.acknowledgedBy.push('nanoleaf');
    accept(path, value, 1001);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['idle']]);
    value.snapshot.revision = 4;
    const notice = session.notices[0];
    if (notice !== undefined) notice.acknowledgedBy = ['pixoo'];
    session.read = 'read';
    accept(path, value, 1002);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['idle']]);
    session.read = 'unknown';
    session.projectId = 'chosen';
    const other = clone(session);
    other.identity.sessionId = 'other';
    value.snapshot.sessions.push(other);
    value.snapshot.revision = 5;
    accept(path, value, 1003);
    assert.equal(query(path, 'SELECT id FROM sessions').length, 2);
    assert.equal(query(path, 'SELECT DISTINCT project FROM task_info').length, 1);
  });

  test('test_wall_projects_survive_retirement_recreation_restart_and_source_switch', context => {
    const {path} = selectionSetup(context);
    const layout = {line_groups: [[100, 101], [102, 103]], line_positions: [[0, 0], [10, 0]]};
    write(path, db => {
      execute(db, `UPDATE projects SET roots='["/synthetic/project"]' WHERE id='project'`);
      execute(db, "INSERT INTO line_prefs (line_id,project,signature,device) VALUES ('100:101','project',1,'wall')");
    });
    const saved = query(path, 'SELECT * FROM projects');
    const reservations = query(path, 'SELECT * FROM line_prefs');
    const value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    write(path, db => execute(db, "UPDATE task_info SET manual_project='project' WHERE session=?", KEY));
    const view = (device = 'wall'): ReturnType<typeof wallView> => wallView(path, {...layout, device}, 1000);
    const first = view();
    assert.equal(first.projects[0]?.active, 1);
    assert.equal(first.tasks[0]?.project, 'project');
    assert.equal(first.tasks[0]?.line, '100:101');
    const other = view('second');
    assert.equal(other.tasks[0]?.line, null);
    assert.equal(other.projects[0]?.waiting, 1);
    assert.equal(other.projects[0]?.assigned, 0);
    // Retained unread is still current; only owner disappearance retires it.
    value.snapshot.revision += 1;
    firstSession(value).activity = 'idle';
    accept(path, value, 1001);
    assert.equal(view().tasks[0]?.status, 'unread');
    const retired = clone(value);
    retired.snapshot.revision += 1;
    retired.snapshot.sessions = [];
    accept(path, retired, 1002);
    for (let reopen = 0; reopen < 2; reopen += 1) {
      const empty = view();
      assert.deepEqual(empty.tasks, []);
      assert.equal(empty.projects[0]?.active, 0);
      assert.deepEqual(query(path, 'SELECT * FROM projects'), saved);
      assert.deepEqual(query(path, 'SELECT * FROM line_prefs'), reservations);
    }
    const fresh = clone(value);
    fresh.snapshot.revision = retired.snapshot.revision + 1;
    delete firstSession(fresh).projectId;
    accept(path, fresh, 1003);
    assert.equal(view().tasks[0]?.project, null, 'Retired task overrides do not return without new attribution');
    write(path, db => execute(db, "UPDATE task_info SET manual_project='project' WHERE session=?", KEY));
    assert.equal(view().projects[0]?.active, 1);
    selectLegacy(path);
    assert.equal(view().projects[0]?.color, '#112233');
    assert.deepEqual(query(path, 'SELECT * FROM projects'), saved);
    assert.deepEqual(query(path, 'SELECT * FROM line_prefs'), reservations);
  });
});

suite('RetirementTest', () => {
  test('test_missed_retirement_resets_only_recreated_task_after_restart', context => {
    const {path} = selectionSetup(context);
    const value = envelope();
    const session = firstSession(value);
    session.activity = 'active';
    session.generation = 1;
    const peer = clone(session);
    peer.identity.sessionId = 'peer';
    value.snapshot.sessions.push(peer);
    selectShared(path, value);
    const key = identityKey(session.identity);
    const other = identityKey(peer.identity);
    write(path, db => {
      execute(db, "UPDATE task_info SET manual_project='project'");
      execute(db, 'INSERT INTO slots (session,slot) VALUES (?,1)', other);
      execute(db, 'INSERT INTO receipts VALUES (?,?,?,?)', key, 'turn', 1000, 0);
      execute(db, 'INSERT INTO waits VALUES (?,?,?,?,?)', key, 'turn', 'old', 'input', 'Ask');
      execute(db, 'INSERT INTO comets (session,turn,queued,source,started,device) VALUES (?,?,?,NULL,NULL,?)', key, 'old', 1000, 'wall');
    });
    const projects = query(path, 'SELECT * FROM projects');
    const peers = query(path, 'SELECT * FROM task_info WHERE session=?', other);
    const peerEpoch = query(path, 'SELECT * FROM activity WHERE session=?', other);
    // Every operation opens the saved database; no in-memory generation cache survives.
    const fresh = clone(value);
    fresh.snapshot.revision = 4;
    firstSession(fresh).generation = 4;
    accept(path, fresh, 1020);
    assert.deepEqual(query(path, 'SELECT manual_project FROM task_info WHERE session=?', key), [[null]]);
    assert.deepEqual(query(path, 'SELECT * FROM projects'), projects);
    assert.deepEqual(query(path, 'SELECT * FROM task_info WHERE session=?', other), peers);
    assert.deepEqual(query(path, 'SELECT * FROM activity WHERE session=?', other), peerEpoch);
    assert.deepEqual(query(path, 'SELECT session,slot FROM slots'), [[other, 1]]);
    for (const table of ['waits', 'receipts', 'comets']) assert.deepEqual(query(path, 'SELECT * FROM ' + table), [], table);
    assert.notDeepEqual(query(path, 'SELECT started FROM activity WHERE session=?', key), [[1000]]);
    accept(path, fresh, 1021);
    assert.deepEqual(query(path, 'SELECT session,slot FROM slots'), [[other, 1]]);
    failed(path, sharedState(path).generation);
    assert.equal(query(path, 'SELECT * FROM sessions').length, 2, 'unavailable is not retirement');
    const empty = clone(fresh);
    empty.snapshot.revision = 5;
    empty.snapshot.sessions = [];
    accept(path, empty, 1022);
    for (const table of ['sessions', 'slots', 'activity', 'task_info', 'comets', 'waits', 'receipts']) {
      assert.deepEqual(query(path, 'SELECT * FROM ' + table), [], table);
    }
    assert.deepEqual(query(path, 'SELECT * FROM projects'), projects);
  });
});

const LINE_LAYOUT = {line_groups: [[100, 101]], line_positions: [[0, 0]]};

suite('RecoveryTest', () => {
  test('test_owner_recovery_clears_stale_red_without_clearing_other_state', context => {
    // The rendered colors this test also checks move with the renderer (slice 2).
    const {path} = selectionSetup(context);
    let value = envelope();
    let session = firstSession(value);
    session.attention = [{id: {status: 'unknown'}, kind: 'approval', turn: session.turn}];
    session.unavailable = [{kind: 'evidence.unavailable', dimension: 'attention', reason: 'ambiguous'}];
    selectShared(path, value);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['blocked']]);
    value = clone(value);
    value.snapshot.revision = 3;
    session = firstSession(value);
    session.freshness = 'uncertain';
    session.restartUncertain = true;
    accept(path, value, 1001);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['blocked']]);
    assert.equal(wallView(path, LINE_LAYOUT, 1001).tasks[0]?.statusEvidence, 'uncertain');
    value = clone(value);
    value.snapshot.revision = 4;
    firstSession(value).attention = [];
    accept(path, value, 1002);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['unread']]);
    assert.equal(query(path, 'SELECT * FROM shared_stale').length, 1);
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
    const snapshot = write(path, db => dashboard(db, LINE_LAYOUT, 1002));
    assert.equal(snapshot[0]?.[0], 'unread');
  });

  test('test_loss_freezes_colors_and_reconnect_preserves_epoch', context => {
    // The frozen working color this test also checks moves with the renderer (slice 2).
    const {path} = selectionSetup(context);
    const value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    const epoch = query(path, 'SELECT started FROM activity');
    failed(path, generation(path));
    assert.deepEqual(query(path, 'SELECT session FROM shared_stale'), [[KEY]]);
    accept(path, value, 1002, {resync: true});
    assert.deepEqual(query(path, 'SELECT started FROM activity'), epoch);
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
  });

  test('test_uncertain_snapshot_retains_last_color_and_recovery_no_old_comet', context => {
    const {path} = selectionSetup(context);
    let value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    value = clone(value);
    value.snapshot.revision = 3;
    const session = firstSession(value);
    session.activity = 'idle';
    session.restartUncertain = true;
    session.freshness = 'uncertain';
    accept(path, value, 1001);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['working']]);
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
  });

  test('test_recovered_session_keeps_epoch_without_replaying_outward_wave', context => {
    // The suppressed outward wave this test also checks moves with the renderer (slice 2); the saved suppression is checked here.
    const {path} = selectionSetup(context);
    let value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    value = clone(value);
    value.snapshot.revision += 1;
    const session = firstSession(value);
    session.turn = {status: 'known', id: 'next'};
    accept(path, value, 1001);
    session.freshness = 'uncertain';
    session.restartUncertain = true;
    accept(path, value, 1001.1);
    session.freshness = 'current';
    session.restartUncertain = false;
    accept(path, value, 1001.2);
    const layout = {line_groups: [[100, 101], [102, 103]], line_positions: [[0, 0], [1, 0]]};
    write(path, db => dashboard(db, layout, 1002));
    assert.deepEqual(query(path, 'SELECT started FROM activity'), [[1001]]);
    assert.deepEqual(query(path, 'SELECT session,epoch FROM shared_suppressed_waves'), [[KEY, 1001]]);
  });

  test('test_read_during_comet_retains_source_until_finish', context => {
    const {path} = selectionSetup(context);
    let value = envelope();
    selectShared(path, value);
    const key = identityKey(firstSession(value).identity);
    write(path, db => execute(db, 'INSERT INTO comets (session, turn, queued, source, started) VALUES (?,?,?,0,?)', key, 'turn', 1000, 1000));
    value = clone(value);
    value.snapshot.revision += 1;
    firstSession(value).read = 'read';
    accept(path, value, 1000.5);
    assert.deepEqual(query(path, 'SELECT session,source,started FROM comets'), [[key, 0, 1000]]);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['idle']]);
  });

  test('test_new_turn_cancels_active_old_notice_comet', context => {
    const {path} = selectionSetup(context);
    let value = envelope();
    selectShared(path, value);
    const key = identityKey(firstSession(value).identity);
    write(path, db => execute(db, 'INSERT INTO comets (session, turn, queued, source, started) VALUES (?,?,?,0,?)', key, 'turn', 1000, 1000));
    value = clone(value);
    value.snapshot.revision += 1;
    const session = firstSession(value);
    session.turn = {status: 'known', id: 'next'};
    session.activity = 'active';
    session.notices[0]?.acknowledgedBy.push('nanoleaf');
    accept(path, value, 1001);
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['working']]);
  });

  test('test_delayed_poll_cannot_overwrite_rollback', context => {
    const {path} = selectionSetup(context);
    selectShared(path);
    const before = generation(path);
    selectLegacy(path);
    assert.equal(accept(path, envelope(), 1001, {generation: before}), false);
    failed(path, before);
    assert.deepEqual(query(path, 'SELECT id FROM sessions'), [['legacy']]);
    assert.equal(sharedState(path).source, 'legacy');
  });
});

suite('ReleaseTest', () => {
  test('test_released_owner_clears_only_nanoleaf_on_evidenced_new_turn', () => {
    // The owner's snapshot is recorded from the released agent-state 3.3.0 owner (recorded/owner-snapshot.json).
    const recorded = fixtureJson('recorded/owner-snapshot.json') as {snapshot: Snapshot; status: string};
    const session = recorded.snapshot.sessions[0];
    assert.ok(session !== undefined);
    assert.deepEqual(session.notices[0]?.acknowledgedBy, ['nanoleaf']);
    assert.equal(session.read, 'unknown');
    assert.equal(semanticStatus(session, 'nanoleaf'), 'working');
    assert.equal(recorded.status, 'working');
  });
});

suite('DeviceSwitchTest', () => {
  test('test_switching_preserves_bound_placements_on_every_device', context => {
    const {path} = selectionSetup(context);
    write(path, db => execute(db, "INSERT INTO slots (session, slot, device) VALUES ('legacy',4,'panels')"));
    selectShared(path);
    assert.deepEqual(byText(query(path, 'SELECT session,slot,device FROM slots')), byText([[KEY, 0, 'wall'], [KEY, 4, 'panels']]));
    write(path, db => {
      execute(db, "UPDATE slots SET slot=7 WHERE session=? AND device='panels'", KEY);
      execute(db, "UPDATE slots SET slot=2 WHERE session=? AND device='wall'", KEY);
    });
    selectLegacy(path);
    assert.deepEqual(byText(query(path, 'SELECT session,slot,device FROM slots')), byText([['legacy', 2, 'wall'], ['legacy', 7, 'panels']]));
  });

  test('test_shared_completion_queues_comets_on_registered_work_devices', context => {
    const {path} = selectionSetup(context);
    writeJson(join(path, 'config.json'), {ip: '192.0.2.1', token: 'fake', panelsToken: 'other', devices: {
      panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
    setMode(path, 'quiet', 1000, 'panels');
    const complete = (revision: number): [Envelope, Envelope] => {
      const active = envelope();
      const first = firstSession(active);
      const notice = first.notices.pop();
      first.activity = 'active';
      active.snapshot.revision = revision;
      const done = clone(active);
      done.snapshot.revision = revision + 1;
      const second = firstSession(done);
      second.activity = 'idle';
      second.notices = notice === undefined ? [] : [notice];
      return [active, done];
    };
    let [active, done] = complete(1);
    selectShared(path, active);
    accept(path, done, 1001);
    assert.deepEqual(query(path, 'SELECT device FROM comets'), [['wall']]);
    write(path, db => execute(db, 'DELETE FROM comets'));
    setMode(path, 'work', 1001, 'panels');
    [active, done] = complete(3);
    accept(path, active, 1002);
    accept(path, done, 1003);
    assert.deepEqual(query(path, 'SELECT device FROM comets ORDER BY device'), [['panels'], ['wall']]);
  });
});

/**
 * A subagent session as the owner records it: its own identity, the evidenced
 * parent and an unknown turn, so its turn-ended notice never clears on a new turn.
 */
export function childOf(parent: SharedSession, name: string, activity: SharedSession['activity'] = 'idle',
  attention: readonly ('question' | 'input' | 'approval')[] = [], fresh = true): SharedSession {
  const child = clone(parent);
  delete child.label;
  delete child.projectId;
  child.identity = {...parent.identity, sessionId: name};
  child.parent = {status: 'known', identity: clone(parent.identity)};
  child.turn = {status: 'unknown'};
  child.activity = activity;
  child.attention = attention.map(kind => ({id: {status: 'unknown'}, kind, turn: {status: 'unknown'}}));
  child.notices = [{id: sha256Hex(name), kind: 'turn-ended', turn: {status: 'unknown'}, acknowledgedBy: []}];
  child.unavailable = [{kind: 'evidence.unavailable', dimension: 'turn', reason: 'missing'}];
  child.restartUncertain = !fresh;
  child.freshness = fresh ? 'current' : 'uncertain';
  return child;
}

const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.provider === b.provider && a.client === b.client && a.hostId === b.hostId && a.sourceId === b.sourceId && a.sessionId === b.sessionId;

/** Owner-derived child counts, which the released validator requires to match. */
export function recount(value: Envelope): Envelope {
  const sessions = value.snapshot.sessions;
  for (const session of sessions) {
    const counts = {active: 0, uncertain: 0};
    for (const child of sessions) {
      if (child.parent.status !== 'known' || !sameIdentity(child.parent.identity, session.identity)
          || child.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) continue;
      if (child.activity === 'unknown' || child.unavailable.some(item => item.dimension === 'activity'
          || ((item.dimension === 'turn' || item.dimension === 'ordering') && item.reason === 'ambiguous'))) {
        counts.uncertain += 1;
      } else if (child.activity === 'active') {
        if (child.freshness === 'current') counts.active += 1;
        else counts.uncertain += 1;
      }
    }
    session.children = counts;
  }
  return value;
}

const CHILD_LAYOUT = {line_groups: [[100, 101], [102, 103]], line_positions: [[0, 0], [1, 0]]};
type Seen = Record<string, [unknown, number | null, unknown]>;

/** ChildSessionTest's fixture: the selection setup, the working envelope and the projected tasks. */
class Children {
  readonly path: string;
  readonly config: JsonObject;
  value: Envelope = envelope();
  root: SharedSession;
  readonly key: string;

  constructor(context: TestContext) {
    ({path: this.path, config: this.config} = selectionSetup(context));
    this.root = firstSession(this.value);
    this.key = identityKey(this.root.identity);
  }

  select(): void {
    selectShared(this.path, this.value);
  }

  advance(instant: number, resync = false): void {
    this.value = recount(clone(this.value));
    this.value.snapshot.revision += 1;
    accept(this.path, this.value, instant, {resync});
    this.root = firstSession(this.value);
  }

  set(index: number, session: SharedSession): void {
    this.value.snapshot.sessions[index] = session;
  }

  /** {task: [status, first zone of its Line, status evidence]}, after a projection pass at `instant`. */
  tasks(instant: number): Seen {
    write(this.path, db => dashboard(db, CHILD_LAYOUT, instant));
    const lines: Record<string, number> = {'100:101': 100, '102:103': 102};
    const seen: Seen = {};
    for (const task of wallView(this.path, CHILD_LAYOUT, instant).tasks) {
      seen[task.id] = [task.status, task.line === null ? null : lines[task.line] ?? null, task.statusEvidence];
    }
    return seen;
  }

  wall(device = 'wall'): WallTask[] {
    return wallView(this.path, {...CHILD_LAYOUT, device}, 1000).tasks;
  }
}

const statusesOf = (seen: Seen): Record<string, unknown> => Object.fromEntries(Object.entries(seen).map(([key, value]) => [key, value[0]]));
const statusAndLine = (seen: Seen, key: string): unknown[] => seen[key]?.slice(0, 2) ?? [];

suite('ChildSessionTest', () => {
  test('test_read_task_keeps_row_and_line_until_owner_removes_it', context => {
    // The steady base color this test also checks moves with the renderer (slice 2).
    const c = new Children(context);
    c.select();
    assert.deepEqual(statusAndLine(c.tasks(1000), c.key), ['unread', 100]);
    c.root.read = 'read';
    c.advance(1001);
    assert.deepEqual(statusAndLine(c.tasks(1001), c.key), ['idle', 100]);
    assert.deepEqual(query(c.path, 'SELECT session FROM comets'), []);
    c.value.snapshot.sessions = [];
    c.value.snapshot.revision += 1;
    accept(c.path, c.value, 1003);
    assert.deepEqual(c.tasks(1003), {});
    assert.deepEqual(query(c.path, 'SELECT session FROM slots'), []);
  });

  test('test_eviction_is_device_local_and_survives_read_reconnect_and_restart', context => {
    const c = new Children(context);
    c.select();
    c.tasks(1000);
    write(c.path, db => {
      dashboard(db, {...CHILD_LAYOUT, device: 'panels'}, 1000);
      for (const device of ['wall', 'panels']) {
        execute(db, 'INSERT INTO comets (session,turn,queued,source,started,device) VALUES (?,?,?,?,?,?)',
          c.key, c.root.turn.status === 'known' ? c.root.turn.id : '', 1000, 0, 1000, device);
      }
    });
    const before = clone(sharedState(c.path).envelope);
    const task = c.wall()[0];
    assert.ok(task?.evictionToken !== undefined);
    const payload = {id: task.id, evictionToken: task.evictionToken};
    // Eviction never writes to the shared owner: the port has no owner connection at all.
    evictTask(c.path, 'wall', payload);
    evictTask(c.path, 'wall', payload);
    assert.deepEqual(c.wall(), []);
    assert.deepEqual(c.tasks(1000), {});
    assert.deepEqual(sharedState(c.path).envelope, before);
    assert.deepEqual(query(c.path, 'SELECT device FROM slots'), [['panels']]);
    assert.deepEqual(query(c.path, 'SELECT device FROM comets'), [['panels']]);
    assert.equal(c.wall('panels').length, 1);
    c.root.read = 'read';
    c.advance(1001);
    failed(c.path, generation(c.path));
    c.advance(1002, true);
    assert.deepEqual(c.wall(), [], 'Saved eviction survives a new database connection');
    assert.deepEqual(c.tasks(1002), {});
    assert.deepEqual(query(c.path, 'SELECT id FROM sessions'), [[c.key]]);
    c.root.turn = {status: 'known', id: 'next-turn'};
    c.root.activity = 'active';
    c.root.notices = [];
    c.advance(1003);
    assert.deepEqual(statusAndLine(c.tasks(1003), c.key), ['working', 100]);
    assert.throws(() => evictTask(c.path, 'wall', payload), {name: 'ValueError'});
    assert.deepEqual(statusAndLine(c.tasks(1003), c.key), ['working', 100]);
  });

  test('test_eviction_does_not_hide_a_recreated_generation_or_peer', context => {
    const c = new Children(context);
    const peer = clone(c.root);
    peer.identity.sessionId = 'peer';
    c.value.snapshot.sessions.push(peer);
    c.select();
    c.tasks(1000);
    const task = c.wall().find(item => item.id === c.key);
    assert.ok(task?.evictionToken !== undefined);
    const payload = {id: c.key, evictionToken: task.evictionToken};
    evictTask(c.path, 'wall', payload);
    assert.equal(Object.keys(c.tasks(1000)).length, 1);
    c.root.generation = c.value.snapshot.revision + 1;
    c.advance(1001, true);
    assert.equal(Object.keys(c.tasks(1001)).length, 2);
    assert.ok(c.key in c.tasks(1001));
    assert.deepEqual(query(c.path, 'SELECT session FROM comets'), []);
    assert.throws(() => evictTask(c.path, 'wall', payload), {name: 'ValueError'});
    assert.equal(Object.keys(c.tasks(1001)).length, 2);
  });

  test('test_eviction_http_requires_origin_token_and_current_task', context => {
    // The origin and wall-token checks and the unknown-device refusal belong to the wall server, which is not ported;
    // the stale-token refusal is the shared-input eviction's own.
    const c = new Children(context);
    c.select();
    const task = c.wall()[0];
    assert.ok(task?.evictionToken !== undefined);
    assert.throws(() => evictTask(c.path, 'wall', {id: task.id, evictionToken: 'old'}), {name: 'ValueError'});
    assert.equal(c.wall().length, 1);
    evictTask(c.path, 'wall', {id: task.id, evictionToken: task.evictionToken});
    assert.deepEqual(c.wall(), []);
  });

  test('test_eviction_unknown_turn_and_source_selection_do_not_replay', context => {
    const c = new Children(context);
    c.root.turn = {status: 'unknown'};
    c.select();
    const task = c.wall()[0];
    assert.ok(task?.evictionToken !== undefined);
    const payload = {id: task.id, evictionToken: task.evictionToken};
    evictTask(c.path, 'wall', payload);
    c.root.activity = 'active';
    c.advance(1001);
    c.root.activity = 'idle';
    c.root.read = 'read';
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {});
    selectLegacy(c.path);
    assert.equal(c.wall()[0]?.evictionToken, undefined);
    assert.throws(() => evictTask(c.path, 'wall', payload), {name: 'ValueError'});
    selectShared(c.path, c.value, 1004);
    assert.throws(() => evictTask(c.path, 'wall', payload), {name: 'ValueError'});
    assert.ok(c.key in c.tasks(1004));
    const again = c.wall()[0];
    assert.ok(again?.evictionToken !== undefined);
    evictTask(c.path, 'wall', {id: again.id, evictionToken: again.evictionToken});
    c.value.snapshot.sessions = [];
    c.value.snapshot.revision += 1;
    accept(c.path, c.value, 1005);
    assert.deepEqual(query(c.path, 'SELECT session FROM shared_evictions'), []);
  });

  test('test_subagent_children_are_part_of_their_parent_task', context => {
    const c = new Children(context);
    c.value.snapshot.sessions.push(childOf(c.root, 'child-1'), childOf(c.root, 'child-2'));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(query(c.path, 'SELECT id,status FROM sessions'), [[c.key, 'unread']]);
    assert.deepEqual(c.tasks(1000), {[c.key]: ['unread', 100, 'current']});
    assert.deepEqual(query(c.path, 'SELECT session FROM slots'), [[c.key]]);
    assert.deepEqual(query(c.path, 'SELECT session FROM comets'), []);
  });

  test('test_child_attention_and_activity_raise_their_parent', context => {
    const c = new Children(context);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['approval']));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['blocked', 100, 'current']});
    const cases: [readonly ('question' | 'input' | 'approval')[], SharedSession['activity'], string][] =
      [[[], 'active', 'working'], [['question'], 'idle', 'question'], [[], 'idle', 'idle']];
    for (const [attention, activity, expected] of cases) {
      c.set(1, childOf(c.root, 'child', activity, attention));
      c.advance(1001);
      assert.deepEqual(query(c.path, 'SELECT id FROM sessions'), [[c.key]]);
      assert.deepEqual(statusesOf(c.tasks(1001)), {[c.key]: expected}, expected);
    }
  });

  test('test_current_child_evidence_is_not_frozen_by_an_uncertain_parent', context => {
    const c = new Children(context);
    c.root.activity = 'active';
    c.value = recount(c.value);
    c.select();
    c.root = firstSession(c.value);
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['input']));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['blocked', 100, 'current']});
    // Without current contributing evidence the uncertain task keeps its last color steadily.
    c.set(1, childOf(c.root, 'child', 'idle', ['input'], false));
    firstSession(c.value).activity = 'idle';
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['blocked', 100, 'uncertain']});
  });

  test('test_retained_child_tasks_leave_without_disturbing_other_tasks', context => {
    const c = new Children(context);
    const peer = clone(c.root);
    peer.identity.sessionId = 'peer';
    delete peer.label;
    c.value.snapshot.sessions.push(peer);
    const child = childOf(c.root, 'child');
    const childKey = identityKey(child.identity);
    const peerKey = identityKey(peer.identity);
    c.value = recount(c.value);
    c.select();
    // State that the earlier projection left behind: the child held the second Line.
    write(c.path, db => {
      execute(db, "INSERT INTO sessions VALUES (?,'','unread',1000)", childKey);
      execute(db, "INSERT INTO activity VALUES (?,'','unread',1000)", childKey);
      execute(db, "INSERT INTO task_info VALUES (?,'','',NULL,NULL,'',NULL)", childKey);
      execute(db, 'DELETE FROM slots WHERE session=?', peerKey);
      execute(db, 'INSERT INTO slots (session,slot) VALUES (?,1)', childKey);
      execute(db, "INSERT OR REPLACE INTO meta VALUES ('mode','quiet')");
      execute(db, "INSERT INTO line_prefs (line_id,project,signature) VALUES ('100','project',1)");
    });
    const scene = join(c.path, 'scene-state.json');
    writeFileSync(scene, '{"version":1,"scene":{"name":"Chosen"},"owned":true}');
    const before = query(c.path, 'SELECT session,turn,status,started FROM activity WHERE session=?', c.key);
    assert.equal(c.tasks(1000)[peerKey]?.[1], null);
    c.value.snapshot.sessions.push(child);
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['unread', 100, 'current'], [peerKey]: ['unread', 102, 'current']});
    assert.deepEqual(query(c.path, 'SELECT session,turn,status,started FROM activity WHERE session=?', c.key), before);
    assert.deepEqual(query(c.path, 'SELECT manual_project FROM task_info WHERE session=?', c.key), [['project']]);
    assert.deepEqual(query(c.path, "SELECT value FROM meta WHERE key='mode'"), [['quiet']]);
    assert.deepEqual(query(c.path, 'SELECT line_id,project,signature,device FROM line_prefs'), [['100', 'project', 1, 'wall']]);
    assert.deepEqual(query(c.path, 'SELECT * FROM sessions WHERE id=?', childKey), []);
    assert.equal(exists(scene), true);
  });

  test('test_child_without_its_parent_shows_only_attention', context => {
    const c = new Children(context);
    const missing = clone(c.root);
    missing.identity.sessionId = 'gone';
    const orphan = childOf(missing, 'orphan', 'idle', ['approval']);
    const orphanKey = identityKey(orphan.identity);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    c.value.snapshot.sessions.push(orphan);
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['idle', 100, 'current'], [orphanKey]: ['blocked', 102, 'current']});
    c.set(1, childOf(missing, 'orphan', 'active'));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['idle', 100, 'current']});
    assert.deepEqual(query(c.path, 'SELECT id FROM sessions'), [[c.key]]);
  });

  test('test_notice_lifecycle_follows_documented_count_and_allocation', context => {
    const c = new Children(context);
    c.value.snapshot.sessions.push(childOf(c.root, 'child'));
    c.value = recount(c.value);
    c.select();
    // A genuine completion notice stays unread; the child's unknown-turn notice never counts.
    assert.deepEqual(c.tasks(1000), {[c.key]: ['unread', 100, 'current']});
    c.root.read = 'read';
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['idle', 100, 'current']});
    c.root.read = 'unknown';
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['unread', 100, 'current']});
    // A new turn: under clearOnNewTurn the owner acknowledges the still-unread notice for this consumer.
    c.root.turn = {status: 'known', id: 'next'};
    c.root.activity = 'active';
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    c.advance(1003);
    assert.deepEqual(c.tasks(1003), {[c.key]: ['working', 100, 'current']});
    c.root.activity = 'idle';
    c.root.notices.push({id: 'b'.repeat(64), kind: 'turn-ended', turn: {status: 'known', id: 'next'}, acknowledgedBy: []});
    c.set(1, childOf(c.root, 'child-next'));
    c.advance(1004);
    assert.deepEqual(c.tasks(1004), {[c.key]: ['unread', 100, 'current']});
    assert.deepEqual(query(c.path, 'SELECT session FROM comets'), [[c.key]]);
    write(c.path, db => execute(db, 'DELETE FROM comets'));
    const epoch = query(c.path, 'SELECT started FROM activity');
    // Uncertain evidence keeps the retained notice and its Line steady. Owner read evidence
    // or full acknowledgment would clear it (#88); uncertain activity does not.
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.root.activity = 'active';
    c.advance(1005);
    assert.deepEqual(c.tasks(1005), {[c.key]: ['unread', 100, 'uncertain']});
    // Restart or reconnect replaces the projection from the current snapshot without replaying effects.
    c.root.freshness = 'current';
    c.root.restartUncertain = false;
    c.root.activity = 'idle';
    c.advance(1006, true);
    assert.deepEqual(c.tasks(1006), {[c.key]: ['unread', 100, 'current']});
    assert.deepEqual(query(c.path, 'SELECT started FROM activity'), epoch);
    assert.deepEqual(query(c.path, 'SELECT session FROM comets'), []);
    // Explicit acknowledgment of the exact notice for this consumer clears the unread pulse while retaining the task and Line.
    c.root.notices[1]?.acknowledgedBy.push('nanoleaf');
    c.advance(1007);
    assert.deepEqual(c.tasks(1007), {[c.key]: ['idle', 100, 'current']});
  });

  test('test_resolved_child_alert_clears_under_an_uncertain_parent', context => {
    const c = new Children(context);
    c.root.activity = 'active';
    c.value = recount(c.value);
    c.select();
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['input']));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['blocked', 100, 'current']});
    c.set(1, childOf(c.root, 'child'));
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['working', 100, 'uncertain']});
    assert.deepEqual(query(c.path, 'SELECT started FROM activity'), [[992]]);
  });

  test('test_uncertain_child_alert_stays_steady_under_a_current_parent', context => {
    const c = new Children(context);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    // A newly seen alert is shown, but steadily, when only uncertain evidence supplies it.
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['approval'], false));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['blocked', 100, 'uncertain']});
    assert.deepEqual(query(c.path, 'SELECT started FROM activity'), [[990]]);
    c.set(1, childOf(c.root, 'other', 'idle', ['question']));
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['question', 100, 'current']});
    c.set(1, childOf(c.root, 'other', 'idle', ['question'], false));
    c.advance(1003);
    assert.deepEqual(c.tasks(1003), {[c.key]: ['question', 100, 'uncertain']});
    assert.deepEqual(query(c.path, 'SELECT started FROM activity'), [[992]]);
    // Before this, a first projection with no retained row also stays steady.
    c.set(1, childOf(c.root, 'late', 'idle', ['approval'], false));
    write(c.path, db => execute(db, 'DELETE FROM sessions'));
    c.advance(1004);
    assert.deepEqual(c.tasks(1004), {[c.key]: ['blocked', 100, 'uncertain']});
    assert.deepEqual(query(c.path, 'SELECT started FROM activity'), [[994]]);
  });

  test('test_uncertain_child_alert_is_not_hidden_behind_a_retained_color', context => {
    // An uncertain parent's working color is retained; a higher subagent alert still shows steadily.
    const c = new Children(context);
    c.root.activity = 'active';
    c.value = recount(c.value);
    c.select();
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['working', 100, 'uncertain']});
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['question'], false));
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['question', 100, 'uncertain']});
    c.set(1, childOf(c.root, 'child', 'idle', ['question', 'approval'], false));
    c.advance(1003);
    assert.deepEqual(c.tasks(1003), {[c.key]: ['blocked', 100, 'uncertain']});
    assert.deepEqual(query(c.path, 'SELECT session FROM comets'), []);
  });

  test('test_uncertain_child_red_escalates_past_a_current_question', context => {
    const c = new Children(context);
    c.root.attention = [{id: {status: 'known', id: 'ask'}, kind: 'question', turn: c.root.turn}];
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['question', 100, 'current']});
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['approval'], false));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['blocked', 100, 'uncertain']});
  });

  test('test_silent_subagent_follows_the_owners_active_count', context => {
    const c = new Children(context);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'active'));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['working', 100, 'current']});
    // Five minutes without subagent evidence: the owner no longer counts it active, and the
    // task follows the parent's current evidence, as the owner's counts and Tidbyt do.
    c.set(1, childOf(c.root, 'child', 'active', [], false));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['idle', 100, 'current']});
    // The parent's own turns show normally under the silent subagent.
    c.root.turn = {status: 'known', id: 'turn-2'};
    c.root.activity = 'active';
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['working', 100, 'current']});
    c.root.activity = 'idle';
    c.root.notices.push({id: 'c'.repeat(64), kind: 'turn-ended', turn: {status: 'known', id: 'turn-2'}, acknowledgedBy: []});
    c.advance(1003);
    assert.deepEqual(c.tasks(1003), {[c.key]: ['unread', 100, 'current']});
    // When the parent is uncertain too, the task keeps its last color steadily. Uncertain
    // activity cannot change it; read evidence or full acknowledgment would (#88).
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.root.activity = 'active';
    c.advance(1004);
    assert.deepEqual(c.tasks(1004), {[c.key]: ['unread', 100, 'uncertain']});
  });

  test('test_read_evidence_clears_a_stale_unread_parent_with_a_subagent', context => {
    const c = new Children(context);
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', [], false));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['unread', 100, 'current']});
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['unread', 100, 'uncertain']});
    c.root.read = 'read';
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['idle', 100, 'uncertain']});
  });

  test('test_silent_subagent_clears_when_it_returns_idle_under_an_uncertain_parent', context => {
    const c = new Children(context);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'active'));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['working', 100, 'current']});
    // Parent and silent subagent both uncertain: the task keeps working steadily.
    c.set(1, childOf(c.root, 'child', 'active', [], false));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['working', 100, 'uncertain']});
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['working', 100, 'uncertain']});
    // The subagent's current evidence that it finished clears working while retaining the idle task and its Line.
    c.set(1, childOf(c.root, 'child'));
    c.advance(1003);
    assert.deepEqual(c.tasks(1003), {[c.key]: ['idle', 100, 'uncertain']});
  });

  test('test_owner_recovery_clears_an_uncertain_child_approval', context => {
    const c = new Children(context);
    c.root.freshness = 'uncertain';
    c.root.restartUncertain = true;
    c.value.snapshot.sessions.push(childOf(c.root, 'child', 'idle', ['approval'], false));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['blocked', 100, 'uncertain']});
    const child = c.value.snapshot.sessions[1];
    if (child !== undefined) child.attention = [];
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['unread', 100, 'uncertain']});
  });

  test('test_grandchildren_and_ambiguous_parentage', context => {
    const c = new Children(context);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    const child = childOf(c.root, 'child');
    child.notices = [];
    c.value.snapshot.sessions.push(child, childOf(child, 'grandchild', 'idle', ['approval']));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['blocked', 100, 'current']});
    c.set(2, childOf(child, 'grandchild', 'active'));
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['working', 100, 'current']});
    // Parentage the owner marks ambiguous leaves that session top-level, as in the owner's counts.
    const unsure = childOf(c.root, 'unsure');
    unsure.unavailable.push({kind: 'evidence.unavailable', dimension: 'parent', reason: 'ambiguous'});
    c.set(2, unsure);
    c.advance(1002);
    assert.deepEqual(c.tasks(1002), {[c.key]: ['idle', 100, 'current'], [identityKey(unsure.identity)]: ['unread', 102, 'current']});
  });

  test('test_grouping_does_not_depend_on_snapshot_order', context => {
    const c = new Children(context);
    const missing = clone(c.root);
    missing.identity.sessionId = 'gone';
    const parent = childOf(missing, 'parent');
    parent.notices = [];
    const chain = [parent, childOf(parent, 'child', 'idle', ['approval'])];
    const first = childOf(c.root, 'first');
    const second = childOf(c.root, 'second');
    first.parent = {status: 'known', identity: clone(second.identity)};
    second.parent = {status: 'known', identity: clone(first.identity)};
    const cycle = [{...first, attention: [{id: {status: 'unknown' as const}, kind: 'question' as const, turn: {status: 'unknown' as const}}]}, second];
    for (const members of [chain, cycle]) {
      const groups = [members, [...members].reverse()].map(order => {
        const grouped: Record<string, [boolean, string[]]> = {};
        for (const [key, [, children, orphan]] of presented({sessions: clone(order)})) {
          grouped[key] = [orphan, children.map(item => identityKey(item.identity)).sort()];
        }
        return grouped;
      });
      assert.deepEqual(groups[0], groups[1]);
      assert.equal(Object.keys(groups[0] ?? {}).length, 1);
      assert.deepEqual(Object.values(groups[0] ?? {}).map(([orphan]) => orphan), [true]);
    }
  });
});

suite('StaleReadEvidenceTest', () => {
  // #88: owner read evidence and full acknowledgment clear a stale retained unread task.
  const stale = (path: string, value: Envelope): Envelope => {
    const next = clone(value);
    next.snapshot.revision += 1;
    for (const session of next.snapshot.sessions) {
      session.freshness = 'uncertain';
      session.restartUncertain = true;
    }
    accept(path, next, 1001);
    return next;
  };
  const change = (path: string, value: Envelope, instant: number, update: (session: SharedSession) => void, index = 0): Envelope => {
    const next = clone(value);
    next.snapshot.revision += 1;
    const session = next.snapshot.sessions[index];
    if (session !== undefined) update(session);
    accept(path, next, instant);
    return next;
  };
  const staleUnread = (path: string): Envelope => {
    const value = envelope();
    selectShared(path, value);
    const next = stale(path, value);
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['unread']]);
    return next;
  };

  test('test_owner_read_evidence_clears_a_stale_unread_task', context => {
    const {path} = selectionSetup(context);
    change(path, staleUnread(path), 1002, session => { session.read = 'read'; });
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['idle']]);
    assert.deepEqual(query(path, 'SELECT * FROM activity'), []);
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
  });

  test('test_full_acknowledgment_clears_a_stale_unread_task', context => {
    const {path} = selectionSetup(context);
    change(path, staleUnread(path), 1002, session => {
      for (const notice of session.notices) notice.acknowledgedBy.push('nanoleaf');
    });
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['idle']]);
    assert.deepEqual(query(path, 'SELECT * FROM activity'), []);
    assert.deepEqual(query(path, 'SELECT * FROM comets'), []);
  });

  test('test_partial_acknowledgment_keeps_the_task_unread', context => {
    const {path} = selectionSetup(context);
    change(path, staleUnread(path), 1002, session => {
      const notice = session.notices[0];
      if (notice === undefined) return;
      const extra = {...clone(notice), id: 'b'.repeat(64), acknowledgedBy: []};
      notice.acknowledgedBy.push('nanoleaf');
      session.notices.push(extra);
    });
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['unread']]);
  });

  test('test_other_stale_statuses_stay_frozen_when_read', context => {
    const {path} = selectionSetup(context);
    const value = envelope();
    firstSession(value).activity = 'active';
    selectShared(path, value);
    change(path, stale(path, value), 1002, session => {
      session.activity = 'idle';
      session.read = 'read';
    });
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['working']]);
  });

  test('test_stale_alerts_stay_frozen_when_resolved_and_read', context => {
    for (const [kind, status] of [['question', 'question'], ['approval', 'blocked']] as const) {
      const {path} = selectionSetup(context);
      const value = envelope();
      const session = firstSession(value);
      session.attention = [{id: {status: 'known', id: 'ask'}, kind, turn: session.turn}];
      selectShared(path, value);
      assert.deepEqual(query(path, 'SELECT status FROM sessions'), [[status]]);
      change(path, stale(path, value), 1002, item => {
        item.attention = [];
        item.read = 'read';
      });
      assert.deepEqual(query(path, 'SELECT status FROM sessions'), [[status]], kind);
    }
  });

  test('test_stale_unread_does_not_become_working_from_uncertain_activity', context => {
    const {path} = selectionSetup(context);
    change(path, staleUnread(path), 1002, session => {
      session.activity = 'active';
      session.read = 'read';
    });
    assert.deepEqual(query(path, 'SELECT status FROM sessions'), [['unread']]);
  });

  test('test_a_read_stale_task_keeps_its_line_until_evicted', context => {
    const {path} = selectionSetup(context);
    const layout = {line_groups: [[100, 101]], line_positions: [[0, 0]]};
    const lineHolders = (instant: number): Row[] => write(path, db => {
      dashboard(db, layout, instant);
      return rows(db, 'SELECT session FROM slots');
    });
    let value = envelope();
    selectShared(path, value);
    const staleKey = identityKey(firstSession(value).identity);
    assert.deepEqual(lineHolders(1000), [[staleKey]]);
    value = stale(path, value);
    const waiting = clone(fixture().sessions[0]);
    assert.ok(waiting !== undefined);
    waiting.identity.sessionId = 'waiting';
    value = clone(value);
    value.snapshot.revision += 1;
    value.snapshot.sessions.push(waiting);
    accept(path, value, 1002);
    assert.deepEqual(lineHolders(1002), [[staleKey]]);
    change(path, value, 1003, session => { session.read = 'read'; });
    assert.deepEqual(lineHolders(1003), [[staleKey]]);
    const task = wallView(path, layout, 1003).tasks.find(item => item.id === staleKey);
    assert.ok(task?.evictionToken !== undefined);
    evictTask(path, 'wall', {id: staleKey, evictionToken: task.evictionToken});
    assert.deepEqual(lineHolders(1004), [[identityKey(waiting.identity)]]);
  });
});

const CLAUDE = {provider: 'claude', client: 'code', hostId: 'host', sourceId: 'claude-source'};

/** A Claude Code session with its own source identity. */
function claudeSession(name: string, parent?: SharedSession, activity: SharedSession['activity'] = 'idle',
  attention: readonly ('question' | 'input' | 'approval')[] = []): SharedSession {
  let session = clone(firstSession(envelope()));
  delete session.label;
  if (parent !== undefined) session = childOf(parent, name, activity, attention);
  session.identity = {...CLAUDE, sessionId: name};
  if (parent === undefined) session.activity = activity;
  return session;
}

suite('UndeclaredSourceTest', () => {
  // #111: a session from an undeclared source stays off the wall; the rest keep following the feed.
  test('test_one_undeclared_session_among_declared_ones_is_skipped', context => {
    const c = new Children(context);
    c.value.snapshot.sessions.push(claudeSession('claude-1', undefined, 'active'));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['unread', 100, 'current']});
    assert.deepEqual(query(c.path, 'SELECT id FROM sessions'), [[c.key]]);
    assert.deepEqual(sharedState(c.path).envelope?.skipped, {sessions: 1, sources: [CLAUDE]});
    // The declared task keeps updating while the undeclared one changes beside it.
    c.root.activity = 'active';
    const claude = c.value.snapshot.sessions[1];
    if (claude !== undefined) claude.activity = 'idle';
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {[c.key]: ['working', 100, 'current']});
    assert.equal(sharedState(c.path).connection, 'current');
    assert.deepEqual(sharedState(c.path).envelope?.snapshot.sessions.map(session => session.identity.provider), ['codex']);
    assert.deepEqual(query(c.path, 'SELECT * FROM comets'), []);
  });

  test('test_only_undeclared_sessions_leave_the_wall_idle_and_the_connection_current', context => {
    const c = new Children(context);
    c.value.snapshot.sessions = [claudeSession('claude-1'), claudeSession('claude-2', undefined, 'active')];
    c.value = recount(c.value);
    c.select();
    c.advance(1001);
    assert.deepEqual(c.tasks(1001), {});
    assert.deepEqual(query(c.path, 'SELECT * FROM sessions'), []);
    assert.deepEqual(query(c.path, 'SELECT * FROM slots'), []);
    const current = sharedState(c.path);
    assert.deepEqual([current.connection, current.error, current.envelope?.snapshot.sessions], ['current', null, []]);
    assert.deepEqual(current.envelope?.skipped, {sessions: 2, sources: [CLAUDE]});
  });

  test('test_skipped_sessions_take_no_part_in_grouping_or_acknowledgment', context => {
    // The pinned contract keeps a parent and its subagents on one source, so an undeclared
    // group is skipped whole and cannot raise or split a declared task. Acknowledging a notice to the owner is not
    // ported, so only the grouping half is translated.
    const c = new Children(context);
    c.root.notices[0]?.acknowledgedBy.push('nanoleaf');
    const parent = claudeSession('claude-parent');
    c.value.snapshot.sessions.push(parent, claudeSession('claude-child', parent, 'idle', ['approval']));
    c.value = recount(c.value);
    c.select();
    assert.deepEqual(c.tasks(1000), {[c.key]: ['idle', 100, 'current']});
    assert.equal(sharedState(c.path).envelope?.skipped?.sessions, 2);
  });

  test('test_declared_subagent_of_an_undeclared_parent_follows_the_missing_parent_rule', context => {
    // The released validator's rejection of cross-source parentage belongs to the feed check, which is not ported.
    const c = new Children(context);
    const parent = claudeSession('claude-parent');
    const orphan = childOf(parent, 'orphan', 'idle', ['approval']);
    orphan.identity = {...c.root.identity, sessionId: 'orphan'};
    const stray = claudeSession('claude-child', c.root, 'idle', ['approval']);
    c.value.snapshot.sessions.push(parent, orphan, stray);
    // Grouping runs only over declared sessions, so such a child would be a missing-parent orphan.
    const [snapshot, skipped] = declared(c.value.snapshot, c.config as unknown as SharedConfig);
    assert.deepEqual(skipped, {sessions: 2, sources: [CLAUDE]});
    const orphanKey = identityKey(orphan.identity);
    const tasks = presented(snapshot);
    assert.deepEqual(new Set(tasks.keys()), new Set([c.key, orphanKey]));
    assert.deepEqual([tasks.get(c.key)?.[1], tasks.get(c.key)?.[2]], [[], false]);
    assert.deepEqual([tasks.get(orphanKey)?.[1], tasks.get(orphanKey)?.[2]], [[], true]);
  });

  test('test_declaring_a_source_later_does_not_replay_comets_or_waves', context => {
    const c = new Children(context);
    const claude = claudeSession('claude-1', undefined, 'active');
    claude.turn = {status: 'known', id: 'turn'};
    const notice = claude.notices[0];
    if (notice !== undefined) notice.acknowledgedBy = [];
    const claudeKey = identityKey(claude.identity);
    c.value.snapshot.sessions.push(claude);
    c.value = recount(c.value);
    c.select();
    // The skipped task completes with a fresh notice while Nanoleaf cannot show it.
    const skipped = c.value.snapshot.sessions[1];
    assert.ok(skipped !== undefined);
    skipped.activity = 'idle';
    const first = skipped.notices[0];
    if (first !== undefined) first.id = 'b'.repeat(64);
    c.advance(1001);
    selectLegacy(c.path);
    const sources = c.config.qualifiedSources as JsonObject[];
    configure(c.path, {...c.config, qualifiedSources: [...sources, CLAUDE]});
    c.value = recount(clone(c.value));
    c.value.snapshot.revision += 1;
    selectShared(c.path, c.value, 1003);
    assert.equal(c.tasks(1003)[claudeKey]?.[0], 'unread');
    assert.deepEqual(query(c.path, 'SELECT * FROM comets'), []);
    assert.deepEqual(query(c.path, 'SELECT started FROM activity WHERE session=?', claudeKey), [[993]]);
    assert.deepEqual(sharedState(c.path).envelope?.skipped, {sessions: 0, sources: []});
  });
});

suite('DeclaredSourceConfigTest', () => {
  test('test_qualified_sources_accept_a_claude_code_source', () => {
    const config = {version: 1, ownerId: 'owner', consumerId: 'nanoleaf', endpoint: 'http://127.0.0.1:12345/api/monitor/v1',
      tokenFile: '/synthetic/token', clearOnNewTurn: true, qualifiedSources: [CLAUDE]};
    assert.deepEqual(validateConfig(config).qualifiedSources, [CLAUDE]);
    for (const invalid of [{...CLAUDE, client: 'desktop'}, {...CLAUDE, sessionId: 'x'}]) {
      throwsFeed(() => validateConfig({...config, qualifiedSources: [invalid]}), 'invalid-config');
    }
  });
});

suite('TaskBackupTest', () => {
  // #120: the legacy task backup and the source switch around it, as whole operations.
  const BACKED_UP = ['sessions', 'slots', 'waits', 'activity', 'receipts', 'comets', 'task_info'];

  const setup = (context: TestContext): {path: string; config: JsonObject} => {
    const path = temporary(context);
    // SelectionTest.setUp and TaskBackupTest.setUp's legacy events, mode and rows, as Python saved them.
    loadDump(path, recordedSetup('taskBackup'));
    writeJson(join(path, 'config.json'), {ip: '192.0.2.1', token: 'fake', panelsToken: 'other', devices: {
      panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
    for (const name of ['scene-state.json', 'scene-state.panels.json']) {
      writeFileSync(join(path, name), JSON.stringify({scene: {name, brightness: 30}}));
    }
    const config = {version: 1, ownerId: 'owner', consumerId: 'nanoleaf', endpoint: 'http://127.0.0.1:12345/api/monitor/v1',
      tokenFile: join(path, 'token'), clearOnNewTurn: true,
      qualifiedSources: [{provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source'}],
      bindings: [{identity: firstSession(envelope()).identity as unknown as JsonObject, legacySessionId: 'legacy'}]};
    configure(path, config);
    return {path, config};
  };

  const snapshot = (path: string): Record<string, unknown> => {
    const tables: Record<string, unknown> = {};
    for (const table of [...BACKED_UP, 'projects', 'line_prefs', 'map_settings']) tables[table] = byText(query(path, 'SELECT * FROM ' + table));
    tables.modes = byText(query(path, "SELECT key,value FROM meta WHERE key LIKE 'mode%'"));
    tables.scenes = ['scene-state.json', 'scene-state.panels.json'].map(name => readFileSync(join(path, name), 'utf8'));
    return tables;
  };

  test('test_stored_backup_keeps_each_row_in_table_column_order', context => {
    const {path} = setup(context);
    const expected = Object.fromEntries(BACKED_UP.map(table => [table, byText(query(path, 'SELECT * FROM ' + table))]));
    selectShared(path);
    const stored = JSON.parse(String(query(path, 'SELECT backup FROM shared_input WHERE id=1')[0]?.[0])) as Record<string, Row[]>;
    assert.deepEqual(new Set(Object.keys(stored)), new Set(BACKED_UP));
    assert.deepEqual(Object.fromEntries(Object.entries(stored).map(([table, values]) => [table, byText(values)])), expected);
  });

  test('test_cutover_and_rollback_preserve_legacy_state_and_carry_bound_choices', context => {
    const {path} = setup(context);
    const before = snapshot(path) as Record<string, Row[]>;
    selectShared(path);
    // Only the bound task crosses over, keeping its placements, epoch and manual project.
    assert.deepEqual(byText(query(path, 'SELECT session,slot,device FROM slots')), byText([[KEY, 0, 'wall'], [KEY, 4, 'panels']]));
    assert.deepEqual(query(path, 'SELECT manual_project FROM task_info'), [['project']]);
    write(path, db => {
      execute(db, "UPDATE slots SET slot=5 WHERE session=? AND device='wall'", KEY);
      execute(db, "UPDATE slots SET slot=6 WHERE session=? AND device='panels'", KEY);
      execute(db, "UPDATE task_info SET manual_project='chosen' WHERE session=?", KEY);
    });
    const sharedProject = query(path, 'SELECT project FROM task_info')[0]?.[0] ?? null;
    selectLegacy(path);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const after = snapshot(path) as Record<string, Row[]>;
      assert.equal(sharedState(path).source, 'legacy');
      for (const table of ['sessions', 'waits', 'activity', 'modes', 'scenes', 'line_prefs', 'map_settings']) {
        assert.deepEqual(after[table], before[table], table);
      }
      assert.deepEqual(after.receipts, []);
      assert.deepEqual(after.comets, []);
      const projects = new Set((after.projects ?? []).map(row => JSON.stringify(row)));
      assert.ok((before.projects ?? []).every(row => projects.has(JSON.stringify(row))));
      assert.deepEqual(after.slots, byText([...(before.slots ?? []).filter(row => row[0] !== 'legacy'), ['legacy', 5, 'wall'], ['legacy', 6, 'panels']]));
      const legacy = (before.task_info ?? []).find(row => row[0] === 'legacy');
      assert.ok(legacy !== undefined);
      assert.deepEqual(after.task_info, byText([...(before.task_info ?? []).filter(row => row[0] !== 'legacy'),
        [...legacy.slice(0, 3), sharedProject, 'chosen', ...legacy.slice(5)]]));
    }
  });

  test('test_failed_cutover_leaves_legacy_state_untouched', context => {
    const {path} = setup(context);
    const before = snapshot(path);
    // Python patched project_envelope to fail; a metadata reader that fails inside the projection does the same here.
    class Failing extends Metadata {
      override syncCatalog(): boolean {
        throw new Error('projection failed');
      }
    }
    assert.throws(() => write(path, db => selectSource(db, {source: 'shared', envelope: envelope(), instant: 1000,
      metadata: new Failing({})})), /projection failed/);
    assert.deepEqual(snapshot(path), before);
    assert.deepEqual(query(path, 'SELECT source,generation,backup FROM shared_input'), [['legacy', 1, null]]);
  });

  test('test_switch_operations_stay_inside_the_callers_transaction', context => {
    const {path, config} = setup(context);
    const bindings = (config.bindings ?? []) as unknown as SharedConfig['bindings'];
    const operate = (action: (db: Parameters<typeof saveLegacyTasks>[0]) => void): Row[] => {
      const before = snapshot(path);
      const changed = withState(path, db => {
        db.exec('BEGIN IMMEDIATE');
        // The port's switch operations take the caller's connection; they cannot open another.
        action(db);
        assert.equal(db.isTransaction, true, 'no hidden commit');
        const result = rows(db, 'SELECT * FROM slots');
        db.exec('ROLLBACK');
        return result;
      });
      assert.deepEqual(snapshot(path), before);
      return changed;
    };
    assert.deepEqual(byText(operate(db => saveLegacyTasks(db, bindings))), byText([[KEY, 0, 'wall'], [KEY, 4, 'panels']]));
    selectShared(path);
    write(path, db => execute(db, "UPDATE slots SET slot=3 WHERE session=? AND device='wall'", KEY));
    const restored = operate(db => restoreLegacyTasks(db, bindings));
    assert.ok(restored.some(row => JSON.stringify(row) === JSON.stringify(['legacy', 3, 'wall'])));
    assert.ok(!restored.some(row => row[0] === KEY));
  });

  test('test_malformed_backup_rows_are_rejected', context => {
    const {path} = setup(context);
    withState(path, db => {
      db.exec('BEGIN IMMEDIATE');
      const saved = dumpTables(db);
      for (const [table, row] of [['sessions', ['a', 't']], ['slots', ['a']], ['comets', ['a', 't', 1.0]], ['task_info', 'not-a-row']] as const) {
        throwsFeed(() => restoreTables(db, {...saved, [table]: [row]}), 'invalid-backup');
      }
      const damaged = Object.fromEntries(Object.entries(saved).filter(([table]) => table !== 'waits'));
      for (const value of [null, [], damaged]) throwsFeed(() => restoreTables(db, value), 'invalid-backup');
      assert.equal(BACKUP_TABLES.length, 7);
      db.exec('ROLLBACK');
    });
  });

  test('test_damaged_backup_refuses_rollback_without_partial_restore', context => {
    // Python ran this through the shared-select command; its fixed error output is the command line's, which is not ported.
    const {path} = setup(context);
    selectShared(path);
    write(path, db => {
      const saved = JSON.parse(String(rows(db, 'SELECT backup FROM shared_input WHERE id=1')[0]?.[0])) as Record<string, unknown[]>;
      saved.task_info?.push(['damaged', 'row']); // Every earlier table would already be restored.
      execute(db, 'UPDATE shared_input SET backup=? WHERE id=1', JSON.stringify(saved));
    });
    const before = snapshot(path);
    throwsFeed(() => selectLegacy(path), 'invalid-backup');
    assert.deepEqual(snapshot(path), before);
    assert.equal(sharedState(path).source, 'shared');
  });
});

suite('transaction helpers', () => {
  test('a failed body rolls back', context => {
    const path = temporary(context);
    assert.throws(() => withState(path, db => transaction(db, () => {
      execute(db, "INSERT INTO meta VALUES ('x','1')");
      throw new Error('stop');
    })), /stop/);
    assert.deepEqual(query(path, "SELECT * FROM meta WHERE key='x'"), []);
  });
});
