import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness, type HarnessOptions} from '@jimmie-potts/sdk/testing';
import {createOnnModule} from '../src/module.js';
import {schemaOf, types, type Family} from '../src/contracts.js';
import type {OnnAction, OnnTransport} from '../src/transport.js';
export const section = {id: 'onn', configurationRevision: 1, adbSocket: '/not-configured/s', serial: '192.0.2.10:12345', hostExecutable: '/not-configured/adb', hostExecutableSha256: '0'.repeat(64), hostVersion: '37.0.1', hostKeyDirectory: '/not-configured/keys'};
const turns = async (): Promise<void> => {for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve));};
void test('the durable fence is rechecked at the transport effect boundary after preparation', {timeout: 10_000}, async context => {
  let prepared: () => void = () => {}, release: () => void = () => {}, effects = 0;
  const ready = new Promise<void>(resolve => {prepared = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const {command, host} = await setup(context, {read: () => Promise.resolve({}),
    execute: async (_action, _signal, beforeEffect: () => ErrorCode | undefined = () => undefined) => {
      prepared(); await gate;
      const code = beforeEffect();
      if (code !== undefined) return {result: 'failed', evidence: 'none', code, connection: 'unknown'};
      effects += 1; return {result: 'succeeded', evidence: 'transmitted', connection: 'available'};
    }});
  assert.equal((await command('onn-key-press', {key: 'right'}, 'effect-fence')).status, 'accepted');
  await ready;
  const database = host.moduleDatabase(); assert.ok(database);
  database.prepare("UPDATE onn_requests SET record = json_set(record, '$.digest', 'synthetic-changed-fence') WHERE request_id = ?").run('effect-fence');
  release(); await turns();
  assert.equal(effects, 0, 'preparation must not authorize an effect after its fence changes');
  const row = database.prepare('SELECT record FROM onn_requests WHERE request_id = ?').get('effect-fence') as {record: string};
  assert.equal((JSON.parse(row.record) as {outcome: {result: string}}).outcome.result, 'failed');
});
async function setup(context: TestContext, transport: OnnTransport, timing: Pick<HarnessOptions, 'clock' | 'scheduler'> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'onn-boundary-')), bus = new InProcessBus(), operator = bus.connect('bunny/parts/operator');
  const states: Record<string, unknown>[] = [];
  await operator.subscribe<Record<string, unknown>>('bunny.state.*.*', message => {states.push({...message.data, type: message.type});});
  const host = new ModuleHarness(createOnnModule({transport}), {bus, stateDir: dir, section, ...timing});
  context.after(async () => {await host.stop(); await operator.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const command = (family: Family, data: object, requestId: string, target = 'onn', timeoutMs = 1000) => operator.request(`bunny.cmd.${family}.${target}`,
    {type: types[family], subject: target, dataschema: schemaOf(family), data}, {requestId, timeoutMs});
  return {host, operator, command, dir, bus, states};
}
function controlledTime() {
  let now = Date.now();
  const timers: Array<{ms: number; callback: () => void; canceled: boolean}> = [];
  const scheduler: Scheduler = {after: (ms, callback) => {
    const timer = {ms, callback, canceled: false}; timers.push(timer); return () => {timer.canceled = true;};
  }};
  return {clock: {now: () => now}, scheduler, async tick(ms: number): Promise<void> {
    const index = timers.findIndex(timer => !timer.canceled && timer.ms === ms); assert.ok(index >= 0);
    const timer = timers.splice(index, 1)[0]; assert.ok(timer); now += ms; timer.callback(); await turns();
  }};
}
for (const damage of ['missing', 'replaced'] as const) void test(`private key ${damage} during transport preparation refuses text without replay`, {timeout: 10_000}, async context => {
  let prepared: () => void = () => {}, release: () => void = () => {}, effects = 0;
  const ready = new Promise<void>(resolve => {prepared = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const {command, host, dir} = await setup(context, {read: () => Promise.resolve({app: 'youtube'}),
    execute: async (_action, _signal, beforeEffect) => {
      prepared(); await gate; const code = beforeEffect();
      if (code !== undefined) return {result: 'failed', evidence: 'none', code, connection: 'unknown' as const};
      effects += 1; return {result: 'succeeded', evidence: 'transmitted', connection: 'available' as const};
    }});
  context.after(release);
  const input = {text: 'SYNTHETIC_PRIVATE_KEY_BOUNDARY'};
  assert.equal((await command('onn-text', input, `key-${damage}`)).status, 'accepted'); await ready;
  const key = join(dir, 'onn', 'request-digest.key');
  if (damage === 'missing') await unlink(key); else await writeFile(key, Buffer.alloc(32, 7));
  release(); await turns();
  assert.equal(effects, 0);
  const database = host.moduleDatabase(); assert.ok(database);
  const row = JSON.parse((database.prepare('SELECT record FROM onn_requests WHERE request_id = ?').get(`key-${damage}`) as {record: string}).record) as {state: string; outcome: {result: string; evidence: string; error: {code: string}}};
  assert.equal(row.state, 'done'); assert.equal(row.outcome.result, 'failed'); assert.equal(row.outcome.evidence, 'none'); assert.equal(row.outcome.error.code, 'unavailable');
  const retry = await command('onn-text', input, `key-${damage}`);
  assert.equal('error' in retry && retry.error.error.code, 'unavailable'); assert.equal(effects, 0);
});
void test('a disconnected command immediately publishes unavailable state and a new generation', {timeout: 10_000}, async context => {
  const time = controlledTime();
  const {command, states} = await setup(context, {read: () => Promise.resolve({app: 'youtube'}), execute: () => Promise.resolve({result: 'failed', evidence: 'none', code: 'unavailable', connection: 'unavailable' as const})}, time);
  await time.tick(0);
  const before = states.filter(state => state.type === 'org.bunny.onn-state.updated').at(-1); assert.ok(before);
  assert.equal(before.connection, 'available');
  assert.equal((await command('onn-key-press', {key: 'right'}, 'disconnect')).status, 'accepted'); await turns();
  const after = states.filter(state => state.type === 'org.bunny.onn-state.updated').at(-1); assert.ok(after);
  assert.equal(after.connection, 'unavailable'); assert.deepEqual(after.currentApp, {status: 'unknown'});
  assert.equal((after.generation as {sequence: number}).sequence, (before.generation as {sequence: number}).sequence + 1);
  assert.equal(states.filter(state => state.type === 'org.bunny.device.updated').at(-1)?.availability, 'unavailable');
});
void test('local final-guard refusal preserves available state without outage or recovery diagnostics', {timeout: 10_000}, async context => {
  const time = controlledTime(); let prepared: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => {prepared = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const {command, host, states} = await setup(context, {read: () => Promise.resolve({app: 'youtube'}), execute: async (_action, _signal, beforeEffect) => {
    prepared(); await gate; const code = beforeEffect(); assert.equal(code, 'internal'); return {result: 'failed', evidence: 'none', code, connection: 'unknown' as const};
  }}, time);
  context.after(release); await time.tick(0);
  assert.equal((await command('onn-key-press', {key: 'right'}, 'local-guard')).status, 'accepted'); await ready;
  const database = host.moduleDatabase(); assert.ok(database);
  database.prepare("UPDATE onn_requests SET record = json_set(record, '$.digest', 'changed-fence') WHERE request_id = ?").run('local-guard');
  release(); await turns(); await time.tick(5000);
  assert.equal(states.filter(state => state.type === 'org.bunny.onn-state.updated').at(-1)?.connection, 'available');
  assert.equal(host.logs.filter(record => ['device.unavailable', 'device.available'].includes(record.event)).length, 0);
});
void test('unchanged offline and unknown-app polls publish no state; new observations and recovery do', {timeout: 10_000}, async context => {
  const time = controlledTime(); let observation: {app?: 'youtube'} | undefined;
  const {states, host} = await setup(context, {read: () => Promise.resolve(observation), execute: () => Promise.reject(new Error('no effect permitted'))}, time);
  await time.tick(0); const offlineCount = states.length;
  await time.tick(5000); await time.tick(5000); assert.equal(states.length, offlineCount);
  observation = {}; await time.tick(5000); const unknownAppCount = states.length;
  assert.ok(unknownAppCount > offlineCount); await time.tick(5000); assert.equal(states.length, unknownAppCount);
  observation = {app: 'youtube'}; await time.tick(5000);
  const first = states.filter(state => state.type === 'org.bunny.onn-state.updated').at(-1); assert.ok(first);
  const knownCount = states.length; await time.tick(5000); assert.equal(states.length, knownCount + 2);
  const second = states.filter(state => state.type === 'org.bunny.onn-state.updated').at(-1); assert.ok(second);
  assert.notDeepEqual(second.currentApp, first.currentApp, 'new timestamped evidence remains publishable');
  assert.equal(host.logs.filter(record => record.event === 'device.unavailable' && record.level === 'warn').length, 1);
  assert.equal(host.logs.filter(record => record.event === 'device.available').length, 1);
});
void test('actual module SQLite exhaustion returns capacity before effects and retains no admission fence', {timeout: 10_000}, async context => {
  let effects = 0;
  const {command, host} = await setup(context, {read: () => Promise.resolve({}), execute: () => {effects += 1; return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});}});
  const database = host.moduleDatabase(); assert.ok(database);
  database.exec('CREATE TABLE pressure (value BLOB); CREATE TRIGGER full_admission BEFORE INSERT ON onn_requests BEGIN INSERT INTO pressure VALUES (zeroblob(100000)); END;');
  const pages = (database.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  database.exec(`PRAGMA max_page_count = ${String(pages)}`);
  const refused = await command('onn-key-press', {key: 'right'}, 'full-store');
  assert.equal('error' in refused && refused.error.error.code, 'capacity'); assert.equal(effects, 0);
  assert.equal(database.prepare('SELECT 1 FROM onn_requests WHERE request_id = ?').get('full-store'), undefined);
  database.exec('DROP TRIGGER full_admission');
  assert.equal((await command('onn-key-press', {key: 'right'}, 'safe-new-request')).status, 'accepted'); await turns(); assert.equal(effects, 1);
});
void test('one accepted key reaches the module-owned writer; matching retries and restart send nothing', {timeout: 10_000}, async context => {
  const dir = await mkdtemp(join(tmpdir(), 'onn-module-'));
  const bus = new InProcessBus();
  const operator = bus.connect('bunny/parts/operator');
  const effects: OnnAction[] = [];
  const transport: OnnTransport = {execute: action => {effects.push(action); return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});}, read: () => Promise.resolve({app: 'youtube'})};
  const host = new ModuleHarness(createOnnModule({transport}), {bus, stateDir: dir, section});
  const hosts = [host];
  context.after(async () => {for (const owner of hosts) await owner.stop(); await operator.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const press = () => operator.request('bunny.cmd.onn-key-press.onn', {type: types['onn-key-press'], subject: 'onn', dataschema: schemaOf('onn-key-press'), data: {key: 'right'}}, {requestId: 'once', timeoutMs: 1000});
  assert.equal((await press()).status, 'accepted');
  for (let turn = 0; turn < 10 && effects.length === 0; turn += 1) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(effects, [{kind: 'key', key: 'right'}]);
  assert.equal((await press()).status, 'accepted');
  assert.equal(effects.length, 1);
  await host.stop();
  const restarted = new ModuleHarness(createOnnModule({transport}), {bus, stateDir: dir, section});
  hosts.push(restarted); await restarted.start();
  assert.equal((await press()).status, 'accepted'); assert.equal(effects.length, 1);
});

void test('the bound includes the in-flight action, preserves order and refuses the seventeenth pending effect', {timeout: 10_000}, async context => {
  const effects: OnnAction[] = []; let release: () => void = () => {};
  const gate = new Promise<void>(resolve => {release = resolve;});
  const {command} = await setup(context, {read: () => Promise.resolve({app: 'youtube'}), execute: async (action, signal) => {
    effects.push(action);
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {reject(new Error('synthetic canceled'));};
      signal.addEventListener('abort', abort, {once: true});
      void gate.then(() => {signal.removeEventListener('abort', abort); resolve();});
    });
    return {result: 'succeeded', evidence: 'transmitted', connection: 'available'};
  }});
  for (let index = 0; index < 16; index += 1) assert.equal((await command('onn-key-press', {key: index % 2 === 1 ? 'left' : 'right'}, `queue-${index}`)).status, 'accepted');
  const refused = await command('onn-key-press', {key: 'down'}, 'queue-17');
  assert.equal(refused.status, 'rejected'); assert.equal('error' in refused && refused.error.error.code, 'capacity');
  assert.equal(effects.length, 1, 'only the head is in flight'); release();
  for (let i = 0; i < 50 && effects.length < 16; i += 1) await turns();
  assert.deepEqual(effects, Array.from({length: 16}, (_, index) => ({kind: 'key', key: index % 2 === 1 ? 'left' : 'right'})));
});

void test('expiry while queued and stale guards cause no effect', {timeout: 10_000}, async context => {
  const effects: OnnAction[] = []; let release: () => void = () => {};
  const gate = new Promise<void>(resolve => {release = resolve;});
  const {command, host} = await setup(context, {read: () => Promise.resolve({app: 'youtube'}), execute: async action => {effects.push(action); await gate; return {result: 'succeeded', evidence: 'transmitted', connection: 'available'};}});
  assert.equal((await command('onn-key-press', {key: 'up'}, 'head')).status, 'accepted');
  assert.equal((await command('onn-key-press', {key: 'down'}, 'expires', 'onn', 50)).status, 'accepted');
  const stale = await command('onn-key-press', {key: 'right', expectedConfigurationRevision: 2}, 'stale');
  assert.equal(stale.status, 'rejected'); assert.equal('error' in stale && stale.error.error.code, 'revision-conflict');
  await new Promise(resolve => setTimeout(resolve, 70)); release(); await turns();
  const database = host.moduleDatabase(); assert.ok(database);
  const row = database.prepare('SELECT record FROM onn_requests WHERE request_id = ?').get('expires') as {record: string};
  assert.equal((JSON.parse(row.record) as {outcome: {error: {code: string}}}).outcome.error.code, 'expired'); assert.equal(effects.length, 1);
});

void test('text is memory-only in the module journal, WAL, outbox and logs; deliberate new IDs still execute', {timeout: 10_000}, async context => {
  const effects: OnnAction[] = [], text = 'SYNTHETIC_ONN_MEMORY_ONLY_1039';
  const {command, host, dir} = await setup(context, {read: () => Promise.resolve({}), execute: action => {effects.push(action); return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});}});
  for (const id of ['text-first', 'text-first', 'text-second']) assert.equal((await command('onn-text', {text}, id)).status, 'accepted');
  await turns(); assert.equal(effects.length, 2);
  const conflict = await command('onn-text', {text: 'changed'}, 'text-first');
  assert.equal('error' in conflict && conflict.error.error.code, 'duplicate-conflict');
  const unsupported = await command('onn-text', {text: 'unqualified 😊'}, 'unsupported');
  assert.equal('error' in unsupported && unsupported.error.error.code, 'unsupported-capability');
  for (const suffix of ['', '-wal']) {
    const bytes = await readFile(join(dir, 'onn.sqlite' + suffix));
    assert.equal(bytes.includes(Buffer.from(text)), false, `text leaked into module database${suffix}`);
  }
  assert.equal(JSON.stringify(host.logs).includes(text), false);
  assert.equal(effects.length, 2);
});

void test('a failed storage commit refuses admission before any effect and leaves no fence', {timeout: 10_000}, async context => {
  const effects: OnnAction[] = [];
  const {command, host} = await setup(context, {read: () => Promise.resolve({}), execute: action => {effects.push(action); return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});}});
  const database = host.moduleDatabase(); assert.ok(database); database.exec('PRAGMA query_only = ON');
  const refused = await command('onn-key-press', {key: 'right'}, 'store-refused');
  assert.equal('error' in refused && refused.error.error.code, 'internal'); assert.equal(effects.length, 0);
  assert.equal(database.prepare('SELECT 1 FROM onn_requests WHERE request_id = ?').get('store-refused'), undefined);
  database.exec('PRAGMA query_only = OFF');
  assert.equal((await command('onn-key-press', {key: 'right'}, 'new-request')).status, 'accepted'); await turns();
  assert.equal(effects.length, 1);
});

void test('startup settles durable accepted and started stages without reconstructing or replaying input', {timeout: 10_000}, async context => {
  let effects = 0;
  const transport: OnnTransport = {read: () => Promise.resolve({}), execute: () => {effects += 1; return Promise.resolve({result: 'succeeded', evidence: 'transmitted', connection: 'available'});}};
  const {command, host, dir, bus} = await setup(context, transport);
  for (const id of ['accepted-before-crash', 'started-before-crash']) assert.equal((await command('onn-key-press', {key: 'left'}, id)).status, 'accepted');
  await turns(); assert.equal(effects, 2);
  const database = host.moduleDatabase(); assert.ok(database);
  // Model the two journal states left by an abrupt process loss, preserving their semantic fences.
  database.prepare("UPDATE onn_requests SET record = json_remove(json_set(record, '$.state', ?), '$.outcome') WHERE request_id = ?").run('accepted', 'accepted-before-crash');
  database.prepare("UPDATE onn_requests SET record = json_remove(json_set(record, '$.state', ?), '$.outcome') WHERE request_id = ?").run('started', 'started-before-crash');
  await host.stop();
  const restarted = new ModuleHarness(createOnnModule({transport}), {bus, stateDir: dir, section});
  context.after(() => restarted.stop());
  await restarted.start();
  const recovered = restarted.moduleDatabase(); assert.ok(recovered);
  const outcome = (id: string) => JSON.parse((recovered.prepare('SELECT record FROM onn_requests WHERE request_id = ?').get(id) as {record: string}).record) as {state: string; outcome: {result: string; evidence: string}};
  assert.equal(outcome('accepted-before-crash').state, 'done');
  assert.equal(outcome('accepted-before-crash').outcome.result, 'failed');
  assert.equal(outcome('accepted-before-crash').outcome.evidence, 'none');
  assert.equal(outcome('started-before-crash').state, 'done');
  assert.equal(outcome('started-before-crash').outcome.result, 'uncertain');
  assert.equal(outcome('started-before-crash').outcome.evidence, 'none');
  assert.equal(effects, 2);
  assert.equal((await command('onn-key-press', {key: 'left'}, 'started-before-crash')).status, 'accepted');
  assert.equal(effects, 2, 'the retained accepted reply never repeats a possibly transmitted effect');
});
