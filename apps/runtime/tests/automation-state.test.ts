import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test, type TestContext} from 'node:test';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, traceFields, type Keyed} from '@jimmie-potts/sdk';
import {CoreHarness} from './fixtures/core-harness.js';
import {DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS} from '../src/core/automation.js';
import {AutomationStore} from '../src/core/automation-store.js';
import {createCoreModule} from '../src/core/core.js';
import {observation, sessionStarted, turnEnded, turnStarted} from './fixtures/agents.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {automationRoute} from '../src/gateway/automation-routes.js';
import {contextOf, edgeConfig, fixture, flush, manualClock, run, stateDir} from './support.js';
import {Redactions} from '../src/log.js';
import {openModuleDatabase} from '../src/state.js';

const families = ['automation-rule', 'automation-routine', 'automation-settings', 'automation-interrupt-set'];
const eventRule = {name: 'Synthetic event rule', kind: 'event', enabled: true,
  trigger: {source: 'core', kind: 'turn-ended'},
  action: {mood: 'celebrate', priorityClass: 'flourish', durationMs: 1_000, targets: ['wall']}};

async function world(context: TestContext, seed?: (store: AutomationStore, now: number) => void, redactions?: Redactions) {
  const directory = await stateDir(context), clock = manualClock();
  if (seed !== undefined) {
    const database = new DatabaseSync(join(directory, 'core.sqlite'));
    try { seed(new AutomationStore(database, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]}), clock.now()); }
    finally { database.close(); }
  }
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const core = createCoreModule();
  if (redactions !== undefined) core.setAutomationRedactions(redactions);
  const reader = bus.connect('bunny/test/reader'), hook = bus.connect('bunny/parts/hook');
  const owner = bus.connect('bunny/modules/nanoleaf');
  const device = deviceRecord('wall', 1, 'nanoleaf', 'available');
  device.capabilities.power = {supported: true};
  await owner.serveSync(['device'], () => ({revision: device.revision, states: [deviceState(device)]}));
  const messages: Message[] = [], attempted: Message<object>[] = [];
  await reader.subscribe('bunny.state.*.*', message => {
    if (message.type.startsWith('org.bunny.automation-')) messages.push(message);
  });
  let refuse = false;
  const start = async () => {
    const harness = new CoreHarness({...core, start: context => core.start({...context, sdk: {...context.sdk,
      publishMessage: async (key, message) => {
        if (message.type.startsWith('org.bunny.automation-')) {
          attempted.push(message);
          if (refuse) throw new Error('synthetic publish refusal');
        }
        return context.sdk.publishMessage(key, message);
      },
    }})}, {bus, stateDir: directory, clock: {now: clock.now}, scheduler: clock.scheduler});
    await harness.start();
    core.setModeParticipants([{id: 'wall', kind: 'nanoleaf'}]);
    core.setAutomationDevices([{id: 'wall', owner: owner.source}]);
    await flush();
    return harness;
  };
  let harness = await start();
  context.after(async () => { await reader.close(); await hook.close(); await owner.close(); await harness.stop(); });
  const db = harness.moduleDatabase();
  assert.ok(db);
  const restart = async () => { await harness.stop(); harness = await start(); };
  const sync = async () => {
    const result = await reader.sync<Keyed & Record<string, unknown>>(families, () => {}, {owner: harness.source, timeoutMs: 1_000});
    assert.equal(result.status, 'synced');
    if (result.status !== 'synced') throw new Error('automation state did not sync');
    context.after(() => result.copy.close());
    return result.copy;
  };
  const history = () => {
    const rows = core.history.read({source: harness.source});
    assert.ok(Array.isArray(rows));
    return rows.filter(row => row.type.startsWith('org.bunny.automation-'));
  };
  return {core, clock, db, hook, sync, history, restart, attempted, messages,
    diagnostics: () => harness.logs, refusePublication: (value: boolean) => { refuse = value; }};

}

void test('populated automation state syncs at startup without inventing history', async context => {
  const w = await world(context, (store, now) => {
    store.insertRule({id: 'rule-saved', name: eventRule.name, enabled: true, kind: 'event',
      trigger: JSON.stringify(eventRule.trigger), action: JSON.stringify(eventRule.action), createdAtMs: now, updatedAtMs: now}, 64);
    store.insertRule({id: 'power-saved', name: 'Synthetic power window', enabled: true, kind: 'routine',
      trigger: JSON.stringify({schema: 'power-window/1.0', days: [1], onTime: '17:00', offTime: '20:00'}),
      action: JSON.stringify({target: 'wall', definitionId: 'legacy-definition'}), createdAtMs: now, updatedAtMs: now}, 64);
    assert.equal(store.claimPowerBoundary('power-saved', 'legacy-definition', now), true);
    store.replaceInterruptSet([]);
    store.replaceSettings({...DEFAULT_SETTINGS, noFlourishes: true});
  });
  const copy = await w.sync();
  const record = (family: string, id: string) => copy.get({family, id})?.data;
  assert.deepEqual(record('automation-rule', 'rule-saved'),
    {id: 'rule-saved', revision: 0, name: eventRule.name, enabled: true, trigger: eventRule.trigger, action: eventRule.action});
  assert.deepEqual(record('automation-routine', 'power-saved'), {id: 'power-saved', revision: 0,
    name: 'Synthetic power window on', enabled: true, days: [1], time: '17:00', actions: [{target: 'wall', family: 'power-set', data: {on: true}}]});
  assert.equal(copy.states().length, 5, 'the migrated off routine is also current');
  assert.deepEqual(record('automation-interrupt-set', 'interrupt-set'), {id: 'interrupt-set', revision: 0, kinds: []});
  assert.deepEqual(record('automation-settings', 'settings'), {id: 'settings', revision: 0, ...DEFAULT_SETTINGS, noFlourishes: true});
  assert.deepEqual(w.history(), []);
  assert.equal(w.db.prepare('SELECT at_ms FROM automation_power_guard').all().length, 2);
});

void test('a refused automation fact leaves the saved rule and live evaluation unchanged', async context => {
  const w = await world(context);
  const rule = await w.core.automation.create(eventRule, true);
  await flush();
  const key = {family: 'automation-rule', id: rule.id};
  const history = w.history(), outbox = w.db.prepare('SELECT * FROM bunny_outbox').all();
  w.db.exec(`CREATE TEMP TRIGGER refuse_definition BEFORE INSERT ON core_history
    WHEN NEW.type = 'org.bunny.automation-rule.updated' BEGIN SELECT RAISE(ABORT, 'synthetic history refusal'); END`);
  const routed = await automationRoute(w.core.automation, {method: 'POST',
    url: new URL(`http://runtime.invalid/api/v2/automation/rules/${rule.id}/disable`), authorize: () => {},
    parent: requestParent, body: () => Promise.resolve({})});
  assert.deepEqual(routed, {status: 500, body: {error: {code: 'internal', retryable: false}}});
  const diagnostic = w.diagnostics().find(record => record.event === 'operation.failed' && record.trace !== undefined);
  assert.equal(diagnostic?.trace?.traceparent, requestParent.traceparent);
  assert.deepEqual(w.core.automation.rule(rule.id), rule);
  assert.equal(w.db.prepare('SELECT enabled FROM rules WHERE id = ?').get(rule.id)?.enabled, 1);
  assert.deepEqual(w.history(), history);
  assert.deepEqual(w.db.prepare('SELECT * FROM bunny_outbox').all(), outbox);
  assert.deepEqual((await w.sync()).get(key)?.data, {id: rule.id, revision: history[0]?.revision,
    name: eventRule.name, enabled: true, trigger: eventRule.trigger, action: eventRule.action});
  for (const event of [sessionStarted, turnStarted, turnEnded]) {
    w.clock.advance(10);
    const {key, draft} = observation(event, w.clock.now());
    await w.hook.publish(key, draft);
    await flush();
  }
  await w.core.automation.settled();
  assert.equal(w.core.automation.log(1)[0]?.ruleId, rule.id, 'the still-enabled rule evaluates the new occurrence');
  assert.deepEqual(w.history(), history, 'execution appends no definition rows');
});

const requestParent = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};

void test('owner routes publish only effective automation edits and retain same-ID removals', async context => {
  const w = await world(context), copy = await w.sync();
  assert.deepEqual(copy.get({family: 'automation-settings', id: 'settings'})?.data, {id: 'settings', revision: 0, ...DEFAULT_SETTINGS});
  assert.deepEqual(copy.get({family: 'automation-interrupt-set', id: 'interrupt-set'})?.data,
    {id: 'interrupt-set', revision: 0, kinds: [...DEFAULT_INTERRUPT_SET].sort()});
  const call = async (method: string, path: string, input: unknown = {}, status = 200) => {
    const result = await automationRoute(w.core.automation, {method, url: new URL(`http://runtime.invalid/api/v2/automation/${path}`),
      parent: requestParent, body: () => Promise.resolve(input), authorize: () => {}});
    assert.ok(result);
    assert.equal(result.status, status);
    await flush();
    return result.body;
  };
  const ruleInput = {name: eventRule.name, kind: eventRule.kind, trigger: eventRule.trigger, action: eventRule.action};
  const routineInput = {name: 'Synthetic routine', days: [1], time: '17:00',
    actions: [{target: 'wall', family: 'power-set', data: {on: true}}]};
  const definitions = [
    {path: 'rules', family: 'automation-rule', input: ruleInput},
    {path: 'routines', family: 'automation-routine', input: routineInput},
  ];
  for (const {path, family, input} of definitions) {
    const created = await call('POST', path, input, 201);
    assert.ok('id' in created && typeof created.id === 'string');
    const {id} = created, entity = {family, id};
    const initial = copy.get(entity);
    assert.equal(initial?.data.enabled, false);
    assert.equal(initial?.data.name, input.name);
    await call('POST', `${path}/${id}/enable`);
    const enabled = copy.get(entity);
    assert.equal(enabled?.data.enabled, true);
    assert.ok((enabled?.data.revision ?? 0) > (initial?.data.revision ?? 0));
    const updated = {...input, name: 'Edited definition'};
    await call('PUT', `${path}/${id}`, updated);
    assert.equal(copy.get(entity)?.data.name, updated.name);
    const count = w.history().length;
    w.clock.advance(1);
    await call('PUT', `${path}/${id}`, updated);
    await call('POST', `${path}/${id}/enable`);
    assert.equal(w.history().length, count);
    await call('POST', `${path}/${id}/disable`);
    assert.equal(copy.get(entity)?.data.enabled, false);
    await call('DELETE', `${path}/${id}`);
    assert.equal(copy.get(entity), undefined);
    const removal = w.messages.at(-1);
    assert.ok(removal);
    assert.equal(removal.kind, 'removal');
    assert.equal(removal.subject, id);
    assert.deepEqual(removal.data.entity, entity);
    assert.equal(removal.data.reason, 'deleted');
    assert.equal(coreValidator().validate(removal).ok, true);
    assert.equal(w.db.prepare('SELECT revision FROM automation_definition_revisions WHERE id = ?').get(id), undefined);
  }
  const newSettings = {...DEFAULT_SETTINGS, noFlourishes: true};
  await call('PUT', 'settings', newSettings);
  await call('PUT', 'settings', {budgets: newSettings.budgets, quietHours: newSettings.quietHours, noFlourishes: true});
  await call('PUT', 'interrupt-set', {kinds: ['turn-ended', 'attention-raised']});
  await call('PUT', 'interrupt-set', {kinds: ['attention-raised', 'turn-ended']});
  const rows = w.history();
  assert.equal(rows.length, 12);
  assert.equal(w.messages.length, 12, 'identical saves produce no outbox publication or history confirmation');
  for (const message of w.messages) {
    assert.equal(coreValidator().validate(message).ok, true);
    assert.equal(traceFields(message)?.traceId, traceFields(requestParent)?.traceId);
  }
  const before = copy.states().map(message => message.data);
  await copy.close();
  await w.restart();
  assert.deepEqual((await w.sync()).states().map(message => message.data), before);
  assert.deepEqual(w.history(), rows);
  const recreated = await call('POST', 'rules', ruleInput, 201);
  assert.ok('id' in recreated && typeof recreated.id === 'string');
  const record = (await w.sync()).get({family: 'automation-rule', id: recreated.id});
  assert.ok(record !== undefined && record.data.revision > (rows.at(-1)?.revision ?? 0));
});

void test('a refused publication leaves a committed definition and retries its original envelope', async context => {
  const w = await world(context), copy = await w.sync();
  w.refusePublication(true);
  const created = await w.core.automation.create(eventRule, true);
  await flush();
  const original = w.attempted[0];
  assert.ok(original);
  assert.deepEqual(w.messages, []);
  assert.equal(w.history().length, 1);
  assert.equal((await w.sync()).get({family: 'automation-rule', id: created.id})?.data.revision, (original.data as Keyed).revision);
  assert.equal(w.diagnostics().filter(record => record.event === 'outbox.deferred').length, 1);
  w.refusePublication(false);
  await w.core.automation.setEnabled(created.id, false);
  await flush();
  assert.deepEqual(w.attempted[1], original);
  assert.deepEqual(w.messages[0], original);
  assert.equal(copy.get({family: 'automation-rule', id: created.id})?.data.enabled, false);
  assert.equal(w.history().length, 2);
  assert.equal(w.db.prepare('SELECT id FROM bunny_outbox').all().length, 0);
});

const registeredMarker = 'Arbitrary synthetic registry marker';
const escapedMarker = 'Synthetic "quoted" registry marker';
const routine = {name: 'Synthetic routine', days: [1], time: '17:00',
  actions: [{target: 'wall', family: 'power-set', data: {on: true}}]};

void test('registered secrets refuse automation writes before owner data or definition facts commit', async context => {
  const clock = manualClock(), core = createCoreModule(), redactions = new Redactions();
  const control = {source: 'bunny/parts/control', token: 'synthetic-automation-owner-token'};
  const owner = {manifest: {name: 'nanoleaf', apiVersion: '1.2', configure: () => ({config: {}, devices: ['wall']})},
    start: () => {}, stop: () => {}};
  const files = await edgeConfig(context, [control], {modules: {nanoleaf: {}}});
  let opened: DatabaseSync | undefined;
  const hosted = {...core, start: async (context: Parameters<typeof core.start>[0]) => {
    opened = context.database();
    await core.start(context);
  }};
  const {runtime, logs} = await run(context, {modules: [hosted, owner], configFile: files.config, edge: {schemas: {}},
    redactions, clock: {now: clock.now}, scheduler: clock.scheduler});
  redactions.add(registeredMarker);
  redactions.add(escapedMarker);
  const headers = {authorization: `Bearer ${control.token}`, 'bunny-request': '1', 'content-type': 'application/json'};
  for (const marker of [registeredMarker, escapedMarker]) {
    const write = await fetch(new URL('/api/v2/automation/rules', runtime.url), {
      method: 'POST', headers, body: JSON.stringify({...eventRule, name: marker}),
    });
    assert.equal(write.status, 500);
    assert.equal((await write.text()).includes(marker), false);
  }
  assert.deepEqual(core.automation.rules(), []);
  assert.ok(opened);
  for (const table of ['rules', 'automation_definition_revisions', 'bunny_outbox']) {
    assert.deepEqual(opened.prepare(`SELECT * FROM ${table}`).all(), [], table);
  }
  const rows = core.history.read({});
  assert.ok(Array.isArray(rows));
  assert.equal(rows.some(row => row.type === 'org.bunny.automation-rule.updated'), false);
  for (const path of ['/api/v2/families/automation-rule', '/api/v2/snapshot?families=automation-rule', '/api/v2/history']) {
    const response = await fetch(new URL(path, runtime.url), {headers});
    assert.equal(response.status, 200, path);
    assert.equal((await response.text()).includes(registeredMarker), false, path);
  }
  assert.equal(JSON.stringify(logs).includes(registeredMarker), false);
});

void test('a populated secret-bearing rule keeps private evaluation and refuses new state reads', async context => {
  const clock = manualClock(), core = createCoreModule(), redactions = new Redactions();
  const control = {source: 'bunny/parts/control', token: 'synthetic-automation-reader-token'};
  const files = await edgeConfig(context, [control]), directory = await stateDir(context);
  const db = openModuleDatabase(directory, 'core');
  try {
    const store = new AutomationStore(db, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]});
    assert.equal(store.insertRule({id: 'rule-private', name: registeredMarker, enabled: true, kind: 'event',
      trigger: JSON.stringify(eventRule.trigger), action: JSON.stringify(eventRule.action),
      createdAtMs: clock.now(), updatedAtMs: clock.now()}, 64), true);
  } finally { db.close(); }
  const hook = fixture('synthetic-hook');
  const {runtime} = await run(context, {modules: [core, hook], stateDir: directory, configFile: files.config, edge: {schemas: {}},
    redactions, clock: {now: clock.now}, scheduler: clock.scheduler});
  redactions.add(registeredMarker);
  assert.equal(core.automation.rule('rule-private').enabled, true);
  const headers = {authorization: `Bearer ${control.token}`};
  for (const path of ['/api/v2/families/automation-rule', '/api/v2/snapshot?families=automation-rule,automation-settings']) {
    const response = await fetch(new URL(path, runtime.url), {headers});
    assert.equal(response.status, 500, path);
    assert.equal((await response.text()).includes(registeredMarker), false, path);
  }
  assert.equal((await fetch(new URL('/api/v2/families/automation-settings', runtime.url), {headers})).status, 200);
  assert.equal(core.automation.rule('rule-private').name, registeredMarker);
  assert.deepEqual(core.history.read({}), []);
  for (const event of [sessionStarted, turnStarted, turnEnded]) {
    clock.advance(10);
    const {key, draft} = observation(event, clock.now());
    await contextOf(hook).sdk.publish(key, draft);
    await flush();
  }
  await core.automation.settled();
  assert.equal(core.automation.log(1)[0]?.ruleId, 'rule-private');
});

void test('an ignored routine insertion rolls back without a definition after reopen', async context => {
  const w = await world(context), routines = w.core.automation.routines;
  assert.ok(routines);
  const live = await w.sync();
  w.db.exec("CREATE TEMP TRIGGER ignore_rule BEFORE INSERT ON rules BEGIN SELECT RAISE(IGNORE); END");
  await assert.rejects(async () => routines.create({...routine, enabled: true}), /internal/);
  await flush();
  assert.deepEqual(routines.list(), []);
  assert.equal(live.states().some(message => message.type === 'org.bunny.automation-routine.updated'), false);
  for (const table of ['rules', 'automation_definition_revisions', 'automation_power_guard', 'bunny_outbox']) {
    assert.deepEqual(w.db.prepare(`SELECT * FROM ${table}`).all(), [], table);
  }
  assert.deepEqual(w.history(), []);
  assert.deepEqual(w.messages, []);
  await live.close();
  await w.restart();
  assert.deepEqual(w.core.automation.routines?.list(), []);
  assert.equal((await w.sync()).states().some(message => message.type === 'org.bunny.automation-routine.updated'), false);
});

void test('an ignored routine deletion keeps its definition, occurrence guard and revision after reopen', async context => {
  const w = await world(context), routines = w.core.automation.routines;
  assert.ok(routines);
  const saved = await routines.create({...routine, enabled: true});
  await flush();
  const key = {family: 'automation-routine', id: saved.id}, live = await w.sync(), before = live.get(key);
  assert.ok(before);
  w.db.prepare('INSERT INTO automation_power_guard VALUES (?, ?)').run(saved.id, w.clock.now());
  const history = w.history(), messages = [...w.messages], outbox = w.db.prepare('SELECT * FROM bunny_outbox').all();
  w.db.exec("CREATE TEMP TRIGGER ignore_rule BEFORE DELETE ON rules BEGIN SELECT RAISE(IGNORE); END");
  await assert.rejects(async () => routines.remove(saved.id), /internal/);
  await flush();
  assert.equal(routines.get(saved.id).enabled, true);
  assert.equal(w.db.prepare('SELECT at_ms FROM automation_power_guard WHERE rule_id = ?').get(saved.id)?.at_ms, w.clock.now());
  assert.equal(w.db.prepare('SELECT revision FROM automation_definition_revisions WHERE id = ?').get(saved.id)?.revision, before.data.revision);
  assert.deepEqual(w.history(), history);
  assert.deepEqual(w.messages, messages);
  assert.deepEqual(w.db.prepare('SELECT * FROM bunny_outbox').all(), outbox);
  assert.deepEqual(live.get(key), before);
  await live.close();
  await w.restart();
  assert.deepEqual((await w.sync()).get(key)?.data, before.data);
  assert.deepEqual(w.history(), history);
});

for (const fault of ['settings update', 'interrupt insert', 'interrupt delete', 'interrupt clear'] as const) {
  void test(`an ignored ${fault} preserves the prior singleton definition through reopen`, async context => {
    const w = await world(context);
    const rule = await w.core.automation.create(eventRule, true);
    const settings = {...DEFAULT_SETTINGS, noFlourishes: true};
    const initialKinds = {kinds: ['attention-raised', 'turn-ended']};
    await w.core.automation.replaceSettings(settings);
    await w.core.automation.replaceInterruptSet(initialKinds);
    await flush();
    const live = await w.sync(), history = w.history(), messages = [...w.messages];
    const current = live.states().map(message => message.data);
    const tables = ['automation_settings', 'interrupt_set', 'automation_definition_revisions', 'bunny_outbox'];
    const rows = () => tables.map(table => w.db.prepare(`SELECT * FROM ${table}`).all());
    const before = rows();
    const [operation, table, condition] = fault === 'settings update'
      ? ['UPDATE', 'automation_settings', ''] : fault === 'interrupt insert'
        ? ['INSERT', 'interrupt_set', "WHEN NEW.kind = 'turn-ended'"] : ['DELETE', 'interrupt_set', "WHEN OLD.kind = 'turn-ended'"];
    w.db.exec(`CREATE TEMP TRIGGER ignore_singleton BEFORE ${operation} ON ${table} ${condition} BEGIN SELECT RAISE(IGNORE); END`);
    if (fault === 'settings update') {
      await assert.rejects(async () => w.core.automation.replaceSettings(DEFAULT_SETTINGS), /internal/);
    } else {
      const kinds = fault === 'interrupt insert' ? ['session-ended', 'turn-ended'] : fault === 'interrupt delete' ? ['session-ended'] : [];
      await assert.rejects(async () => w.core.automation.replaceInterruptSet({kinds}), /internal/);
    }
    await flush();
    assert.deepEqual(rows(), before);
    assert.deepEqual(w.core.automation.settings(), settings);
    assert.deepEqual(w.core.automation.interruptSet(), initialKinds.kinds);
    assert.deepEqual(w.history(), history);
    assert.deepEqual(w.messages, messages);
    assert.deepEqual(live.states().map(message => message.data), current);
    for (const event of [sessionStarted, turnStarted, turnEnded]) {
      w.clock.advance(10);
      const {key, draft} = observation(event, w.clock.now());
      await w.hook.publish(key, draft);
      await flush();
    }
    await w.core.automation.settled();
    assert.deepEqual(w.core.automation.log(1).map(entry => [entry.ruleId, entry.reason]), [[rule.id, 'no-flourishes']]);
    assert.deepEqual(w.history(), history);
    await live.close();
    await w.restart();
    assert.deepEqual((await w.sync()).states().map(message => message.data), current);
    assert.deepEqual(w.history(), history);
  });
}

for (const drain of ['next commit', 'restart'] as const) {
  void test(`a deferred definition with a newly registered secret stays off the bus on ${drain}`, async context => {
    const redactions = new Redactions(), w = await world(context, undefined, redactions);
    const live = await w.sync();
    w.refusePublication(true);
    const rule = await w.core.automation.create({...eventRule, name: escapedMarker}, true);
    await flush();
    assert.equal(w.attempted.length, 1);
    assert.equal(w.messages.length, 0);
    const first = w.history()[0];
    assert.ok(first);
    const ruleAttempts = () => w.attempted.filter(message => message.type === 'org.bunny.automation-rule.updated').length;
    if (drain === 'restart') {
      await w.core.automation.replaceInterruptSet({kinds: ['turn-ended']});
      await flush();
      const attempts = ruleAttempts();
      redactions.add(escapedMarker);
      w.refusePublication(false);
      await live.close();
      await w.restart();
      assert.equal(ruleAttempts(), attempts);
    } else {
      redactions.add(escapedMarker);
      w.refusePublication(false);
      await w.core.automation.replaceInterruptSet({kinds: ['turn-ended']});
      await flush();
      assert.equal(ruleAttempts(), 1);
      assert.equal(live.get({family: 'automation-rule', id: rule.id}), undefined);
    }
    assert.deepEqual(w.messages.map(message => message.type), ['org.bunny.automation-interrupt-set.updated']);
    assert.equal(w.core.automation.rule(rule.id).name, escapedMarker);
    assert.deepEqual(w.history()[0], first, 'the committed history is kept');
    const diagnostics = w.diagnostics().filter(record => record.event === 'operation.failed' && record.fields['bunny.code'] === 'forbidden');
    assert.equal(diagnostics.length, 1);
    assert.equal(JSON.stringify(diagnostics).includes(escapedMarker), false);
  });
}
