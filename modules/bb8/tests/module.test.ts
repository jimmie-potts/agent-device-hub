import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createBb8Module} from '../src/module.js';
import {SimulatedLink} from '../src/simulated.js';
import {commandType, schemaOf} from '../src/contracts.js';

void test('public accepted reply has durable responsibility before the helper executes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bb8-module-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const bus = new InProcessBus(), operator = bus.connect('bunny/parts/operator'), transport = new SimulatedLink();
  const host = new ModuleHarness(createBb8Module({transport}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  t.after(async () => {await host.stop(); await operator.close();});
  await host.start();
  const link = transport.state();
  const result = await operator.request('bunny.cmd.bb8-connect.bb8', {type: commandType('bb8-connect'), subject: 'bb8', dataschema: schemaOf('bb8-connect'), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: link.helperEpoch, expectedConnectionGeneration: link.connectionGeneration}}, {timeoutMs: 1000, requestId: 'connect-1'});
  assert.equal(result.status, 'accepted', JSON.stringify({result, logs: host.logs, failures: host.failures}));
  const database = host.moduleDatabase(); assert.ok(database, 'accepted responsibility must open the private store');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM bb8_responsibility WHERE request_id=?').get('connect-1')?.n, 1);
});

void test('uncertain held state survives a restart and cannot be rebound to another robot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bb8-recovery-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const bus = new InProcessBus(), operator = bus.connect('bunny/parts/operator');
  let host = new ModuleHarness(createBb8Module({transport: new SimulatedLink()}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  await host.start();
  const db = host.moduleDatabase(); assert.ok(db);
  const saved = JSON.parse(String(db.prepare('SELECT state FROM bb8_state').get()?.state)) as Record<string, unknown>;
  saved.held = {requestId: 'uncertain-1', heldAtMs: Date.now()};
  db.prepare('UPDATE bb8_state SET state=?').run(JSON.stringify(saved));
  await host.stop();
  host = new ModuleHarness(createBb8Module({transport: new SimulatedLink()}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  await host.start();
  const copy = await operator.sync<Record<string, unknown>>(['device'], () => {}, {owner: 'bunny/modules/bb8', timeoutMs: 1000});
  assert.equal(copy.status, 'synced'); if (copy.status !== 'synced') throw Error('no copy');
  assert.deepEqual(copy.copy.states()[0]?.data.held, saved.held);
  await copy.copy.close(); await host.stop();
  host = new ModuleHarness(createBb8Module({transport: new SimulatedLink()}), {bus, stateDir: directory, section: {id: 'other', configurationRevision: 0}});
  await assert.rejects(() => host.start());
  await host.stop(); await operator.close();
});
void test('failed WSL completion storage cannot consume the helper receipt or report success', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bb8-completion-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const bus = new InProcessBus(), operator = bus.connect('bunny/parts/operator'), transport = new SimulatedLink(); let consumed = 0;
  const recorded = transport.recorded.bind(transport);
  transport.recorded = async (id, parent) => {consumed++; await recorded(id, parent);};
  const host = new ModuleHarness(createBb8Module({transport}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  t.after(async () => {await host.stop(); await operator.close();}); await host.start();
  const db = host.moduleDatabase(); assert.ok(db);
  db.exec("CREATE TRIGGER reject_completion BEFORE UPDATE OF stage ON bb8_responsibility WHEN NEW.stage='done' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
  const state = transport.state();
  const answer = await operator.request('bunny.cmd.bb8-connect.bb8', {type: commandType('bb8-connect'), subject: 'bb8', dataschema: schemaOf('bb8-connect'), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: state.helperEpoch, expectedConnectionGeneration: state.connectionGeneration}}, {timeoutMs: 1000, requestId: 'completion-1'});
  assert.equal(answer.status, 'accepted');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(consumed, 0); assert.equal(transport.results().length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bb8_responsibility WHERE stage='done'").get()?.n, 0);
  const copy = await operator.sync(['bb8-robot'], () => {}, {owner: 'bunny/modules/bb8', timeoutMs: 1000});
  assert.equal(copy.status, 'rejected'); db.exec('DROP TRIGGER reject_completion');
});
void test('the module requires a reference, rejects a second step and permits Stop through an uncertain movement hold', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bb8-move-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const bus = new InProcessBus(), operator = bus.connect('bunny/parts/operator'), transport = new SimulatedLink();
  const host = new ModuleHarness(createBb8Module({transport}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  t.after(async () => {await host.stop(); await operator.close();}); await host.start();
  const send = (family: string, extra: object = {}) => {
    const link = transport.state();
    return operator.request(`bunny.cmd.${family}.bb8`, {type: commandType(family), subject: 'bb8', dataschema: schemaOf(family), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: link.helperEpoch, expectedConnectionGeneration: link.connectionGeneration, ...extra}}, {timeoutMs: 1000, requestId: crypto.randomUUID()});
  };
  const flush = async () => {for (let n = 0; n < 40; n++) await new Promise(resolve => setImmediate(resolve));};
  assert.equal((await send('bb8-connect')).status, 'accepted'); await flush();
  const step = {direction: 'forward', speed: 20, durationMs: 100, forwardReference: 'old-reference'};
  assert.equal((await send('bb8-step', {step})).status, 'rejected');
  assert.equal((await send('bb8-aim', {action: 'set'})).status, 'accepted'); await flush();
  const reference = transport.state().forwardReference; assert.ok(reference !== undefined);
  transport.next('uncertain');
  assert.equal((await send('bb8-step', {step: {...step, forwardReference: reference}})).status, 'accepted');
  assert.equal((await send('bb8-step', {step: {...step, forwardReference: reference}})).status, 'rejected');
  await new Promise(resolve => setTimeout(resolve, 120)); await flush();
  const db = host.moduleDatabase(); assert.ok(db);
  const before = JSON.parse(String(db.prepare('SELECT state FROM bb8_state').get()?.state)) as {held?: unknown}; assert.ok(before.held !== undefined);
  assert.equal((await send('bb8-stop')).status, 'accepted'); await flush();
  assert.equal(transport.snapshot().operations.filter(o => o.kind === 'step').length, 1);
  assert.equal(transport.snapshot().operations.at(-1)?.kind, 'stop');
  assert.equal((await send('bb8-step', {step: {...step, forwardReference: reference}})).status, 'rejected');
});
void test('concurrent ordinary admission cannot consume the step-reserved Stop slot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bb8-stop-slot-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const bus = new InProcessBus(), operator = bus.connect('bunny/parts/operator'), transport = new SimulatedLink();
  const host = new ModuleHarness(createBb8Module({transport}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  t.after(async () => {await host.stop(); await operator.close();}); await host.start();
  const revisions: number[] = [];
  await operator.subscribe('bunny.state.bb8-robot.bb8', message => {revisions.push((message.data as {revision: number}).revision);});
  const send = (family: string, extra: object = {}) => {
    const link = transport.state(); return operator.request(`bunny.cmd.${family}.bb8`, {type: commandType(family), subject: 'bb8', dataschema: schemaOf(family), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: link.helperEpoch, expectedConnectionGeneration: link.connectionGeneration, ...extra}}, {timeoutMs: 1000, requestId: crypto.randomUUID()});
  };
  const flush = async () => {for (let n = 0; n < 40; n++) await new Promise(resolve => setImmediate(resolve));};
  assert.equal((await send('bb8-connect')).status, 'accepted'); await flush();
  assert.equal((await send('bb8-aim', {action: 'set'})).status, 'accepted'); await flush();
  const reference = transport.state().forwardReference; assert.ok(reference !== undefined);
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => {release = resolve;}); const execute = transport.execute.bind(transport);
  transport.execute = async (request, parent, signal) => {if (request.operation.kind !== 'stop') await gate; return execute(request, parent, signal);};
  try {
    for (let n = 0; n < 7; n++) assert.equal((await send('bb8-wake')).status, 'accepted');
    const replies = await Promise.all([send('bb8-step', {step: {direction: 'forward', speed: 20, durationMs: 300, forwardReference: reference}}), send('bb8-power-refresh')]);
    assert.ok(replies.some(reply => reply.status === 'accepted'));
    const database = host.moduleDatabase(); assert.ok(database);
    const durable = JSON.parse(String(database.prepare('SELECT state FROM bb8_state').get()?.state)) as {revision: number};
    const synced = await operator.sync<{revision: number}>(['bb8-robot'], () => {}, {owner: 'bunny/modules/bb8', timeoutMs: 1000});
    assert.equal(synced.status, 'synced');
    if (synced.status !== 'synced') throw Error('no robot copy');
    try {assert.equal(synced.copy.states()[0]?.data.revision, durable.revision, 'a refused concurrent admission must preserve committed owner state');}
    finally {await synced.copy.close();}
    const stop = await send('bb8-stop');
    assert.equal(stop.status, 'accepted', 'a concurrent stale capacity snapshot must not consume the reserved Stop slot');
  } finally {release?.(); await flush();}
  assert.equal(revisions.filter((revision, index) => index > 0 && revision <= revisions[index - 1]!).length, 0, 'each new published state revision must increase');
});
