import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, prepareMessage} from '@jimmie-potts/sdk';
import {bindCoreRuntimeOwnership, createCoreModule, DEFAULT_CONSUMERS, isCoreModule, type CoreModule} from '../src/core/core.js';
import {AutomationError, DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS} from '../src/core/automation.js';
import {AutomationStore} from '../src/core/automation-store.js';
import {DEFAULT_ART_POLICY, initialArtRecord} from '../src/core/art-schedule-model.js';
import {ArtScheduleStore} from '../src/core/art-schedule-store.js';
import {CoreStore} from '../src/core/store.js';
import type {ArtPlan} from '../src/core/art-plans.js';
import type {Action} from '../src/core/tracker.js';
import {tokenDigest} from '../src/credentials.js';
import {coreFactory, standbyCoreFactory} from '../src/modules.js';
import {acquireRuntimeOwnership} from '../src/runtime-ownership.js';
import {openModuleDatabase} from '../src/state.js';
import {CoreHarness} from './fixtures/core-harness.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {observation, OTHER, runtimeEnded, sessionStarted, turnEnded, turnStarted} from './fixtures/agents.js';
import {deferred, flush, health, manualClock, run, stateDir} from './support.js';

function snapshot(core: CoreModule) {
  const result = core.history.settings({mode: 'snapshot'});
  assert.ok('settings' in result && result.settings === 'snapshot', JSON.stringify(result));
  return result;
}

const at = new Date(2026, 9, 12, 16, 59).getTime();
const action: Action = {
  key: 'bunny.cmd.power-set.wall', requestedBy: 'bunny/core', requestId: 'synthetic-standby',
  draft: {type: 'org.bunny.power.set.requested', subject: 'wall', dataschema: SCHEMA_BASE + 'power-set/2.0',
    data: {on: true, expectedConfigurationRevision: 1, expectedGeneration: 1}},
};
const eventRule = {name: 'Synthetic event rule', kind: 'event', enabled: true,
  trigger: {source: 'core', kind: 'turn-ended'},
  action: {mood: 'celebrate', priorityClass: 'flourish', durationMs: 1_000, targets: ['wall']}};
const routine = {name: 'Synthetic evening', days: [1], time: '17:00', enabled: true,
  actions: [{target: 'wall', family: 'power-set', data: {on: true}}]};
const unavailable = (error: unknown): boolean => error instanceof AutomationError && error.code === 'unavailable';

void test('shipped standby holds the process lease, serves local health and keeps the configured gateway off', async t => {
  const root = await stateDir(t), clock = manualClock(at);
  await mkdir(join(root, 'modules'), {mode: 0o700});
  await writeFile(join(root, 'modules', 'core.sqlite-owner'), '', {mode: 0o600, flag: 'wx'});
  const owner = await acquireRuntimeOwnership(root);
  const standby = standbyCoreFactory.create(), active = coreFactory.create();
  assert.ok(isCoreModule(standby) && isCoreModule(active));
  assert.deepEqual(standby.history.rules, active.history.rules);
  bindCoreRuntimeOwnership(standby, owner);
  const proof = 'synthetic-standby-private-proxy-proof';
  const {runtime} = await run(t, {stateDir: root, modules: [standby], clock, scheduler: clock.scheduler,
    config: {modules: {}, edge: {credentials: '/unused/synthetic-standby.json', launcher: false, mcp: false,
      editorLinks: {}, placeLinks: {}, privateProxy: {origin: 'https://synthetic.ts.net', tokenDigest: tokenDigest(proof)}}}});
  const local = await health(runtime.url);
  assert.equal(local.status, 200);
  assert.deepEqual(local.body.modules.map(module => [module.name, module.state, module.serves]), [['core', 'running', undefined]]);
  assert.equal(snapshot(standby).records.length, 7);
  await assert.rejects(acquireRuntimeOwnership(root));
  const gatewayPath = new URL('/api/v2/history?settings=snapshot', runtime.url);
  for (const attempt of [0, 1]) {
    if (attempt === 1) await runtime.reload();
    assert.equal(runtime.gateway(), undefined);
    const ordinary = await fetch(gatewayPath);
    assert.equal(ordinary.status, 404);
    await ordinary.arrayBuffer();
    const proxy = await fetch(gatewayPath, {headers: {'bunny-private-proxy': proof, host: 'synthetic.ts.net'}});
    assert.equal(proxy.status, 403);
    await proxy.arrayBuffer();
  }
  await runtime.stop();
  assert.ok('error' in standby.history.settings({mode: 'snapshot'}));
  await assert.rejects(acquireRuntimeOwnership(root));
  const db = openModuleDatabase(root, 'core');
  try { assert.deepEqual(db.prepare('SELECT * FROM state').all(), []); } finally { db.close(); }
});

const rows = (db: DatabaseSync) => Object.fromEntries([
  'state', 'core_records', 'core_operations', 'core_history', 'core_revision', 'core_taken', 'bunny_outbox',
  'automation_power_guard', 'automation_events', 'automation_log', 'automation_art_plans',
  'automation_moment_reservations', 'automation_art_schedule', 'automation_art_claims', 'automation_power_limits',
  'music_capture',
].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

void test('standby restarts keep session, tracker and outbox rows while holding otherwise eligible work', async t => {
  const directory = await stateDir(t), clock = manualClock(at);
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const source = bus.connect('bunny/parts/standby-fixture');
  const device = bus.connect('bunny/modules/nanoleaf');
  const sends: string[] = [];
  let reads = 0;
  const lamp = deviceRecord('wall', 1, 'nanoleaf', 'available');
  lamp.capabilities.power = {supported: true};
  lamp.capabilities.moments = {supported: true, moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true};
  lamp.desired.mode = {status: 'known', value: 'free'};
  lamp.observed = {status: 'known', observedAtMs: clock.now(), power: {status: 'known', value: true},
    brightness: {status: 'unknown'}};
  await device.serveSync(['device'], () => { reads += 1; return {revision: 1, states: [deviceState(lamp)]}; });
  for (const family of ['power-set', 'moment-play']) {
    await device.respond(`bunny.cmd.${family}.wall`, () => {
      sends.push(family);
      return {status: 'accepted'};
    });
  }
  t.after(async () => { await source.close(); await device.close(); });
  const active = createCoreModule();
  const activeHarness = new CoreHarness(active, {bus, stateDir: directory, clock, scheduler: clock.scheduler});
  await activeHarness.start();
  t.after(() => activeHarness.stop());
  active.setModeParticipants([{id: 'wall', kind: 'nanoleaf'}]);
  active.setAutomationDevices([{id: 'wall', owner: device.source}]);
  await flush();
  const saved = await active.automation.routines?.create(routine);
  assert.ok(saved);
  await active.automation.create(eventRule, true);
  await active.automation.replaceSettings({...DEFAULT_SETTINGS, budgets: {...DEFAULT_SETTINGS.budgets, globalHour: 5}});
  await active.automation.replaceInterruptSet({kinds: []});
  const power = await active.automation.limits?.save('wall', {enabled: true, durationMs: 1_000});
  assert.ok(power);
  const activeDatabase = activeHarness.moduleDatabase();
  assert.ok(activeDatabase);
  const art = new ArtScheduleStore(activeDatabase);
  await art.change(data => {
    data.record.policy = {...DEFAULT_ART_POLICY, enabled: true, generation: true};
  });
  for (const [index, event] of [sessionStarted, turnStarted, turnEnded].entries()) {
    const {key, draft} = observation(event, clock.now(), {sequence: index + 1});
    await source.publish(key, draft);
    await flush();
  }
  await active.automation.settled();
  const ended = observation(runtimeEnded, clock.now(), {identity: OTHER});
  await source.publish(ended.key, ended.draft);
  await flush();
  await active.actions.dispatch(action);
  assert.ok(sends.includes('power-set') && reads > 0, 'the fake device accepts active work');
  assert.ok(active.automation.log(20).some(row => row.event.kind === 'turn-ended'), 'the active core evaluates the occurrence');
  const expected = snapshot(active);
  await activeHarness.stop();

  const pendingSettings = prepareMessage('bunny/core', {kind: 'state', type: 'org.bunny.automation-interrupt-set.updated',
    subject: 'interrupt-set', dataschema: SCHEMA_BASE + 'automation-interrupt-set/2.0',
    data: {id: 'interrupt-set', revision: 9, kinds: []}}, {now: clock.now});
  const pendingOperation = prepareMessage('bunny/core', {kind: 'occurrence', type: 'org.bunny.turn.ended',
    subject: 'synthetic-session', dataschema: SCHEMA_BASE + 'turn-ended/2.0', data: {fixture: true}}, {now: clock.now});
  let before: ReturnType<typeof rows>;
  {
    const db = new DatabaseSync(join(directory, 'core.sqlite'));
    try {
      const queue = db.prepare('INSERT INTO bunny_outbox (id, kind, routing_key, message) VALUES (?, ?, ?, ?)');
      queue.run(pendingSettings.id, pendingSettings.kind, 'bunny.state.automation-interrupt-set.interrupt-set', JSON.stringify(pendingSettings));
      queue.run(pendingOperation.id, pendingOperation.kind, 'bunny.event.turn-ended.synthetic-session', JSON.stringify(pendingOperation));
      before = rows(db);
    } finally { db.close(); }
  }

  const workBefore = {sends: [...sends], reads};
  for (const attempt of [0, 1]) {
    const standby = createCoreModule({standby: true});
    const harness = new CoreHarness(standby, {bus, stateDir: directory, clock, scheduler: clock.scheduler});
    t.after(() => harness.stop());
    await harness.start();
    const db = harness.moduleDatabase();
    assert.ok(db);
    standby.setModeParticipants([{id: 'wall', kind: 'nanoleaf'}]);
    standby.setAutomationDevices([{id: 'wall', owner: device.source}]);
    const {key, draft} = observation(turnEnded, clock.now(), {sequence: attempt + 9});
    await source.publish(key, draft);
    clock.advance(60_000);
    await flush();
    assert.equal(clock.pending(), 0, 'standby arms no work timer');
    const current = snapshot(standby);
    assert.deepEqual(current, expected);
    for (const family of ['power-limit', 'art-schedule', 'automation-routine', 'automation-rule']) {
      assert.equal(current.records.filter(record => record.family === family).length, 1);
    }
    assert.deepEqual({sends, reads}, workBefore);
    const direct = await standby.actions.dispatch(action);
    const operator = await standby.operatorActions.dispatch(action);
    assert.ok('error' in direct && direct.error.code === 'unavailable');
    assert.ok('error' in operator && operator.error.code === 'unavailable');
    assert.throws(() => standby.automation.routines?.run(saved.id), unavailable);
    assert.throws(() => standby.automation.replaceSettings(DEFAULT_SETTINGS), unavailable);
    const plan: ArtPlan = {id: 'synthetic-plan', artworkId: 'synthetic-art', mood: 'celebrate', priorityClass: 'flourish',
      coversStatus: false, startAtMs: clock.now() + 60_000, prepareUntilMs: clock.now() + 30_000, toleranceMs: 5_000,
      displays: [], browser: {compositionId: 'a'.repeat(64)}};
    let permits = 0;
    assert.throws(() => standby.automation.art?.present(plan, () => { permits += 1; return undefined; }), unavailable);
    assert.equal(permits, 0);
    assert.throws(() => standby.automation.limits?.save('wall', {enabled: false, durationMs: 1_000}), unavailable);
    assert.deepEqual(rows(db), before);
    await harness.stop();
    assert.ok('error' in standby.history.settings({mode: 'snapshot'}));
  }

  const recovered: string[] = [];
  await source.subscribe('bunny.state.automation-interrupt-set.interrupt-set', message => { recovered.push(message.id); });
  await source.subscribe('bunny.event.turn-ended.synthetic-session', message => { recovered.push(message.id); });
  const restarted = createCoreModule();
  const restartedHarness = new CoreHarness(restarted, {bus, stateDir: directory, clock, scheduler: clock.scheduler});
  t.after(() => restartedHarness.stop());
  await restartedHarness.start();
  await flush();
  assert.deepEqual(recovered, [pendingSettings.id, pendingOperation.id]);
  assert.deepEqual(sends, workBefore.sends, 'active recovery does not resend stored commands');
  assert.ok((restarted.automation.routines?.get(saved.id).next?.atMs ?? 0) > clock.now(), 'the missed routine is never replayed');
  await restartedHarness.stop();
});

void test('standby validates retained settings and the existing ordered consumer list before becoming readable', async t => {
  for (const fault of ['settings', 'consumers'] as const) {
    await t.test(fault, async tt => {
      const root = await stateDir(tt), clock = manualClock(at);
      const active = createCoreModule({consumers: fault === 'consumers' ? [...DEFAULT_CONSUMERS].reverse() : DEFAULT_CONSUMERS});
      const running = await run(tt, {stateDir: root, modules: [active], clock, scheduler: clock.scheduler});
      await running.runtime.stop();
      if (fault === 'settings') {
        const db = openModuleDatabase(root, 'core');
        try { db.prepare('UPDATE core_mode SET record = ?').run(JSON.stringify({id: 'hub', mode: 'invalid'})); }
        finally { db.close(); }
      }
      const failures: unknown[] = [];
      const standby = createCoreModule({standby: true});
      const {runtime} = await run(tt, {stateDir: root, modules: [standby], clock, scheduler: clock.scheduler,
        onCoreFailure: error => { failures.push(error); }});
      assert.equal(failures.length, 1);
      assert.equal(runtime.health().status, 'degraded');
      assert.ok('error' in standby.history.settings({mode: 'snapshot'}));
    });
  }
});

void test('standby adds only the settings history metadata to a pre-reader store', async t => {
  const root = await stateDir(t), clock = manualClock(at);
  const active = createCoreModule();
  const previous = await run(t, {stateDir: root, modules: [active], clock, scheduler: clock.scheduler});
  await active.automation.replaceInterruptSet({kinds: []});
  await previous.runtime.stop();

  const columns = 'seq, at_ms, revision, kind, source, message_id, type, subject, request_id, record, origin, origin_seq';
  const oldRows = (db: DatabaseSync) => db.prepare(`SELECT ${columns} FROM core_history ORDER BY seq`).all();
  const retained = (db: DatabaseSync) => ({
    history: oldRows(db),
    latest: db.prepare('SELECT * FROM core_history_latest ORDER BY rowid').all(),
    spans: db.prepare('SELECT * FROM core_history_span ORDER BY rowid').all(),
    session: db.prepare('SELECT * FROM state').all(),
    revision: db.prepare('SELECT * FROM core_revision').all(),
    outbox: db.prepare('SELECT * FROM bunny_outbox ORDER BY seq').all(),
  });
  const old = openModuleDatabase(root, 'core');
  const before = retained(old);
  assert.ok(before.history.length > 0);
  old.exec('DROP INDEX core_history_legacy_barrier; ALTER TABLE core_history DROP COLUMN continuity; ALTER TABLE core_history DROP COLUMN settings_patch');
  old.close();

  let anchor: unknown;
  for (const attempt of [0, 1]) {
    const core = createCoreModule({standby: true});
    const {runtime} = await run(t, {stateDir: root, modules: [core], clock, scheduler: clock.scheduler});
    assert.equal(snapshot(core).records.length, 7);
    await runtime.stop();
    const reopened = openModuleDatabase(root, 'core');
    try {
      assert.deepEqual(retained(reopened), before);
      const metadata = reopened.prepare('SELECT continuity, settings_patch FROM core_history ORDER BY origin_seq').all();
      const tail = metadata.at(-1)?.continuity;
      assert.equal(typeof tail, 'string');
      assert.match(String(tail), /^legacy:/);
      assert.ok(metadata.every(row => row.settings_patch === null));
      if (attempt === 1) assert.equal(tail, anchor);
      anchor = tail;
    } finally { reopened.close(); }
  }
});

void test('standby copies the exact historical power-window guard once', async t => {
  const root = await stateDir(t), clock = manualClock(at);
  const first = openModuleDatabase(root, 'core');
  const store = new AutomationStore(first, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]});
  const watermark = at - 60_000;
  store.insertRule({id: 'legacy-window', name: 'Synthetic window', enabled: true, kind: 'routine',
    trigger: JSON.stringify({schema: 'power-window/1.0', days: [1], onTime: '17:00', offTime: '20:00'}),
    action: JSON.stringify({target: 'wall', definitionId: 'legacy-definition'}), createdAtMs: watermark, updatedAtMs: watermark}, 64);
  assert.equal(store.claimPowerBoundary('legacy-window', 'legacy-definition', watermark), true);
  first.close();
  let previous: unknown;
  for (const attempt of [0, 1]) {
    const core = createCoreModule({standby: true});
    const {runtime} = await run(t, {stateDir: root, modules: [core], clock, scheduler: clock.scheduler});
    const result = snapshot(core);
    const routines = result.records.filter(record => record.family === 'automation-routine');
    assert.equal(routines.length, 2);
    assert.deepEqual(result.records.find(record => record.family === 'art-schedule')?.value, {policy: initialArtRecord().policy});
    await runtime.stop();
    const db = openModuleDatabase(root, 'core');
    try {
      const guards = db.prepare('SELECT * FROM automation_power_guard ORDER BY rule_id').all();
      assert.deepEqual(guards.map(row => row.at_ms), [watermark, watermark]);
      assert.deepEqual(guards.map(row => row.rule_id).sort(), routines.map(record => record.id).sort());
      assert.deepEqual(db.prepare('SELECT * FROM bunny_outbox').all(), []);
      assert.deepEqual(db.prepare('SELECT * FROM core_history').all(), []);
      if (attempt === 1) assert.deepEqual({result, guards}, previous);
      previous = {result, guards};
    } finally { db.close(); }
  }
});

void test('abort during standby acquisition or load fences reads and releases the acquired logical lease', async t => {
  for (const phase of ['acquire', 'load'] as const) {
    await t.test(phase, async tt => {
      const root = await stateDir(tt), clock = manualClock(at);
      const core = createCoreModule({standby: true});
      const entered = deferred<void>(), proceed = deferred<void>();
      const original = Object.getOwnPropertyDescriptor(CoreStore.prototype, 'acquire');
      assert.ok(original?.value instanceof Function);
      const acquire = original.value as CoreStore['acquire'];
      const signal = new AbortController();
      let loaded = 0, released = 0;
      tt.mock.method(CoreStore.prototype, 'acquire', async function (this: CoreStore, owner: string, abort: AbortSignal) {
        const lease = await acquire.call(this, owner, abort);
        if (phase === 'acquire') {
          entered.resolve();
          await proceed.promise;
        }
        return {
          ...lease,
          load: async (loadSignal: AbortSignal) => {
            loaded += 1;
            const state = await lease.load(loadSignal);
            if (phase === 'load') {
              entered.resolve();
              await proceed.promise;
            }
            return state;
          },
          release: () => { released += 1; return lease.release(); },
        };
      });
      const harness = new CoreHarness({...core, start: context => core.start({...context, signal: signal.signal})}, {
        bus: new InProcessBus({now: clock.now, scheduler: clock.scheduler}), stateDir: root, clock, scheduler: clock.scheduler,
      });
      tt.after(() => harness.stop());
      const starting = harness.start();
      const refused = assert.rejects(starting, {name: 'AbortError'});
      await entered.promise;
      assert.ok('error' in core.history.settings({mode: 'snapshot'}));
      signal.abort();
      proceed.resolve();
      await refused;
      assert.ok('error' in core.history.settings({mode: 'snapshot'}));
      assert.equal(released, 1);
      assert.equal(loaded, phase === 'acquire' ? 0 : 1);
      await harness.stop();
    });
  }
});

void test('standby capacity leaves the core running with unavailable settings and no recovery timer', async t => {
  const root = await stateDir(t), clock = manualClock(at);
  const core = createCoreModule({standby: true});
  const harness = new CoreHarness({...core, start: context => {
    const db = context.database();
    assert.equal(db.prepare('PRAGMA max_page_count=1').get()?.max_page_count, 1);
    return core.start(context);
  }}, {bus: new InProcessBus({now: clock.now, scheduler: clock.scheduler}), stateDir: root, clock, scheduler: clock.scheduler});
  t.after(() => harness.stop());
  await harness.start();
  assert.ok('error' in core.history.settings({mode: 'snapshot'}));
  assert.ok(harness.logs.some(record => record.event === 'operation.failed' && record.fields['bunny.code'] === 'capacity'));
  assert.equal(harness.pendingTimers(), 0);
});
