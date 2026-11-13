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
import {flush, manualClock, stateDir} from './support.js';

const families = ['automation-rule', 'automation-routine', 'automation-settings', 'automation-interrupt-set'];
const eventRule = {name: 'Synthetic event rule', kind: 'event', enabled: true,
  trigger: {source: 'core', kind: 'turn-ended'},
  action: {mood: 'celebrate', priorityClass: 'flourish', durationMs: 1_000, targets: ['wall']}};

async function world(context: TestContext, seed?: (store: AutomationStore, now: number) => void) {
  const directory = await stateDir(context), clock = manualClock();
  if (seed !== undefined) {
    const database = new DatabaseSync(join(directory, 'core.sqlite'));
    try { seed(new AutomationStore(database, () => {}, {settings: DEFAULT_SETTINGS, interruptSet: [...DEFAULT_INTERRUPT_SET]}), clock.now()); }
    finally { database.close(); }
  }
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const core = createCoreModule();
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
