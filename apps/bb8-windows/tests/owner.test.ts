import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {acknowledgmentOf, InProcessBus} from '@jimmie-potts/sdk';
import {commandType, schemaOf, HELPER_SOURCE, MODULE_SOURCE} from '@jimmie-potts/bb8/link';
import {executeDraft, HelperOwner} from '../src/owner.js';
const scheduler = {after: (ms: number, f: () => void) => {const t = setTimeout(f, ms); return () => clearTimeout(t);}};
void test('authenticated source refusal happens before native import, store admission or bytes', async () => {
  const db = new DatabaseSync(':memory:'); const bus = new InProcessBus();
  const helper = bus.connect(HELPER_SOURCE), stranger = bus.connect('bunny/parts/stranger');
  let opens = 0;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk: helper, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => {opens++; throw new Error('fake radio cannot open');}});
  await owner.start();
  const operationId = crypto.randomUUID();
  const draft = executeDraft('bb8', {operationId, requestId: operationId, parentRequestId: 'parent-1', expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: 0, operationExpiresAtMs: Date.now() + 5000, operation: {kind: 'connect'}});
  const result = await stranger.request('bunny.cmd.bb8-link-execute.bb8', draft, {timeoutMs: 1000, requestId: operationId});
  assert.equal(result.status === 'rejected' && result.error.error.code, 'forbidden');
  assert.equal(opens, 0);
  await helper.close(); await stranger.close(); db.close();
});

void test('expired internal work refuses before accepting responsibility or opening BLE', async () => {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus();
  const sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE);
  let opens = 0;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => {opens++; throw new Error('fake radio');}});
  await owner.start();
  const id = crypto.randomUUID();
  const response = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: 'parent-1', expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: 0, operationExpiresAtMs: Date.now() - 1, operation: {kind: 'connect'}}), {requestId: id, timeoutMs: 1000});
  assert.equal(response.status === 'rejected' && response.error.error.code, 'expired'); assert.equal(opens, 0);
  await sdk.close(); await module.close(); db.close();
});

import {FakeGatt} from './fake.js';
import {Receipts} from '../src/receipts.js';

void test('durable connect receipt, consumed projection and duplicate ID never repeat device effects', async () => {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus();
  const sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt(); let opens = 0;
  const errors: unknown[] = [];
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => {opens++; return Promise.resolve(gatt);}}), onError: e => {errors.push(e);}});
  let outcome: import('@jimmie-potts/event-contracts/v2').Message | undefined;
  await module.subscribe('bunny.event.bb8-link-execute.bb8', message => {outcome = message;});
  await owner.start(); assert.equal(opens, 0);
  const id = crypto.randomUUID();
  const data = {requestId: id, operationId: id, parentRequestId: 'parent-1', expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000, operation: {kind: 'connect'}};
  const response = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', data), {requestId: id, timeoutMs: 1000});
  assert.equal(response.status, 'accepted'); await owner.drain(); assert.deepEqual(errors, []);
  assert.equal(owner.results.length, 1); assert.equal(owner.results[0]?.result, 'succeeded'); assert.equal(owner.results[0]?.parentRequestId, 'parent-1');
  const writes = gatt.writes.length;
  const core = bus.connect('bunny/core');
  assert.ok(outcome);
  const ack = acknowledgmentOf(outcome); await core.publish(ack.key, ack.draft);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(owner.results.length, 1, 'core outcome acknowledgment does not consume the link receipt');
  const consumeId = crypto.randomUUID();
  const consumed = await module.request('bunny.cmd.bb8-link-recorded.bb8', {type: commandType('bb8-link-recorded'), subject: 'bb8', dataschema: schemaOf('bb8-link-recorded'), data: {requestId: consumeId, operationId: id}}, {requestId: consumeId, timeoutMs: 1000});
  assert.equal(consumed.status, 'accepted'); assert.equal(owner.results.length, 0);
  assert.equal(gatt.writes.length, writes, 'receipt consumption never writes radio bytes'); await core.close();
  // Bypass SDK's own request-ID memory so the helper must fence this duplicate itself.
  const after = {...data, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000};
  const repeat = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', after), {requestId: id, timeoutMs: 1000});
  assert.equal(repeat.status === 'rejected' && repeat.error.error.code, 'duplicate-conflict'); assert.equal(gatt.writes.length, writes);
  await owner.stop(); await sdk.close(); await module.close(); db.close();
});

void test('restart reconciles admitted and effect-start rows without opening an adapter', async () => {
  const db = new DatabaseSync(':memory:'), store = new Receipts(db), now = Date.now();
  for (const [id, effect] of [['operation-1', false], ['operation-2', true]] as const) {
    store.admit({requestId: id, operationId: id, parentRequestId: 'parent-1', expectedConfigurationRevision: 0, expectedHelperEpoch: 'old-helper', expectedConnectionGeneration: 2, operationExpiresAtMs: now + 5000, operation: {kind: 'wake'}}, '00-11111111111111111111111111111111-1111111111111111-01');
    if (effect) store.effect(id, 2);
  }
  const bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE); let opens = 0;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => {opens++; throw new Error('must remain passive');}});
  await owner.start();
  assert.equal(opens, 0); assert.equal(owner.state.connection, 'disconnected');
  assert.deepEqual(owner.results.map(r => [r.id, r.result, r.evidence]), [['operation-1', 'failed', 'none'], ['operation-2', 'uncertain', 'none']]);
  await owner.stop(); await sdk.close(); db.close();
});

void test('failed admission persistence, wrong target, stale guards and unqualified clock cause zero native effects', async () => {
  for (const scenario of ['storage', 'target', 'guard', 'clock', 'raw', 'motion'] as const) {
    const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE); let opens = 0;
    const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => scenario === 'clock' ? undefined : 0, adapter: () => {opens++; throw new Error('no-effect negative control');}});
    await owner.start();
    if (scenario === 'storage') db.exec("CREATE TRIGGER refuse_admission BEFORE INSERT ON bb8_receipts BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END");
    const id = crypto.randomUUID();
    const data = {requestId: id, operationId: id, parentRequestId: 'parent-1', expectedConfigurationRevision: 0, expectedHelperEpoch: scenario === 'guard' ? 'stale' : owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000, operation: scenario === 'motion' ? {kind: 'drive'} : {kind: 'connect'}, ...(scenario === 'raw' ? {bytes: [1]} : {})};
    const draft = executeDraft(scenario === 'target' ? 'another-robot' : 'bb8', data);
    if (scenario === 'target') await assert.rejects(() => module.request('bunny.cmd.bb8-link-execute.bb8', draft, {requestId: id, timeoutMs: 1000}), e => e instanceof Error);
    else {const result = await module.request('bunny.cmd.bb8-link-execute.bb8', draft, {requestId: id, timeoutMs: 1000}); assert.equal(result.status, 'rejected', scenario);}
    assert.equal(opens, 0, scenario);
    await owner.stop(); await sdk.close(); await module.close(); db.close();
  }
});

void test('completion storage failure fences the owner and preserves possible-effect responsibility for restart', async () => {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
  const failures: unknown[] = [];
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)}), onError: e => {failures.push(e);}});
  await owner.start();
  db.exec("CREATE TRIGGER refuse_completion BEFORE UPDATE OF completed ON bb8_receipts WHEN NEW.completed=1 BEGIN SELECT RAISE(ABORT,'synthetic completion failure'); END");
  const id = crypto.randomUUID(), guards = {expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration};
  const reply = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {...guards, requestId: id, operationId: id, parentRequestId: 'parent-1', operationExpiresAtMs: Date.now() + 14_000, operation: {kind: 'connect'}}), {requestId: id, timeoutMs: 1000});
  assert.equal(reply.status, 'accepted'); await owner.drain(); assert.equal(failures.length, 1);
  assert.equal(new Receipts(db).row(id)?.effect, 1); assert.equal(new Receipts(db).row(id)?.completed, 0);
  assert.equal(gatt.closed, true); assert.equal(owner.state.connection, 'unavailable');
  const sync = await module.sync(['bb8-link'], () => {}, {owner: HELPER_SOURCE, timeoutMs: 1000});
  assert.equal(sync.status, 'rejected', 'a fenced store cannot serve a false live connection');
  db.exec('DROP TRIGGER refuse_completion'); await owner.stop(); await sdk.close(); await module.close(); db.close();
});
void test('one active plus eight pending is bounded, and stale queued work never opens a second connection', async () => {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
  let release: ((gatt: FakeGatt) => void) | undefined, opens = 0;
  const opening = new Promise<FakeGatt>(resolve => {release = resolve;});
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => {opens++; return opening;}})});
  await owner.start();
  const replies: string[] = [];
  for (let n = 0; n < 10; n++) {
    const id = crypto.randomUUID();
    const response = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: `parent-${n}`, expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000, operation: {kind: 'connect'}}), {requestId: id, timeoutMs: 1000});
    replies.push(response.status === 'accepted' ? 'accepted' : response.error.error.code);
  }
  assert.deepEqual(replies, [...Array<string>(9).fill('accepted'), 'capacity']);
  release?.(gatt); await owner.drain();
  assert.equal(opens, 1); assert.equal(gatt.writes.length, 4); assert.equal(gatt.closed, false, 'queued stale work must not close the successfully connected robot');
  assert.equal(owner.results.filter(result => result.result === 'failed').length, 8);
  await owner.stop(); await sdk.close(); await module.close(); db.close();
});
void test('a full unconsumed receipt projection refuses new work, and receipt stores cannot change target', async () => {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE); let opens = 0;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => {opens++; throw Error('must remain passive');}});
  await owner.start();
  const store = new Receipts(db);
  for (let n = 0; n < 64; n++) store.admit({requestId: `receipt-${n}`, operationId: `receipt-${n}`, parentRequestId: `parent-${n}`, expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000, operation: {kind: 'connect'}}, '00-11111111111111111111111111111111-1111111111111111-01');
  const id = crypto.randomUUID();
  const response = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: 'parent-full', expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + 14_000, operation: {kind: 'connect'}}), {requestId: id, timeoutMs: 1000});
  assert.equal(response.status === 'rejected' && response.error.error.code, 'capacity'); assert.equal(opens, 0);
  assert.throws(() => new HelperOwner({id: 'other', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => {opens++; throw Error('must remain passive');}}));
  await owner.stop(); await sdk.close(); await module.close(); db.close();
});

import {RecordedSpans} from '@jimmie-potts/sdk/testing';
import type {Logger, LogFields, TraceContext} from '@jimmie-potts/sdk';
const sendTo = async (module: import('@jimmie-potts/sdk').Participant, owner: HelperOwner, operation: object) => {
  const id = crypto.randomUUID();
  return module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: id, expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: Date.now() + (('kind' in operation && operation.kind === 'connect') ? 14_000 : 4000), operation}), {requestId: id, timeoutMs: 1000});
};
void test('matching nonzero MRSP is a definitive failed transmission, including unknown device errors', async () => {
  for (const [mrsp, code] of [[4, 'unsupported-capability'], [7, 'invalid-request'], [1, 'internal'], [255, 'internal']] as const) {
    const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
    const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)})});
    try {
      await owner.start(); assert.equal((await sendTo(module, owner, {kind: 'connect'})).status, 'accepted'); await owner.drain();
      gatt.mrsp = mrsp;
      assert.equal((await sendTo(module, owner, {kind: 'led-set', led: {target: 'main', rgb: [10, 20, 30]}})).status, 'accepted'); await owner.drain();
      const result = owner.results.at(-1); assert.equal(result?.result, 'failed', `MRSP ${mrsp}`); assert.equal(result?.evidence, 'transmitted'); assert.equal(result.error?.code, code); assert.equal(gatt.writes.length, 5);
    } finally {await owner.stop(); await sdk.close(); await module.close(); db.close();}
  }
});
void test('native loss invalidates device work while healthy SDK permits a fresh explicit reconnect', async () => {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), first = new FakeGatt(), second = new FakeGatt(); let opens = 0;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(++opens === 1 ? first : second)})});
  try {
    await owner.start(); assert.equal((await sendTo(module, owner, {kind: 'connect'})).status, 'accepted'); await owner.drain();
    const old = owner.state; first.disconnect();
    for (let i = 0; i < 20 && owner.state.connection !== 'unavailable'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(owner.state.connection, 'unavailable'); assert.equal(opens, 1); assert.equal(first.writes.length, 4, 'loss does not reconnect automatically');
    const id = crypto.randomUUID(); const stale = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: id, expectedConfigurationRevision: 0, expectedHelperEpoch: old.helperEpoch, expectedConnectionGeneration: old.connectionGeneration, operationExpiresAtMs: Date.now() + 4000, operation: {kind: 'wake'}}), {requestId: id, timeoutMs: 1000});
    assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
    assert.equal((await sendTo(module, owner, {kind: 'connect'})).status, 'accepted'); await owner.drain(); assert.equal(opens, 2); assert.equal(owner.state.connection, 'connected'); assert.equal(second.writes.length, 4);
    await owner.streamLost(); assert.equal((await sendTo(module, owner, {kind: 'connect'})).status, 'rejected', 'actual SDK loss still fences commands');
  } finally {await owner.stop(); await sdk.close(); await module.close(); db.close();}
});
void test('helper decisions and outbox publications retain structured trace records and recorded device spans', async () => {
  const records: {level: string; event: string; fields?: LogFields; trace?: TraceContext}[] = [];
  const collect = (level: string) => (event: string, fields?: LogFields, trace?: TraceContext): void => {records.push({level, event, ...(fields === undefined ? {} : {fields}), ...(trace === undefined ? {} : {trace})});};
  const log: Logger = {debug: collect('debug'), info: collect('info'), warn: collect('warn'), error: collect('error')}; const trace = new RecordedSpans();
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
  const options = {id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)}), log, trace}; const owner = new HelperOwner(options);
  try {
    await owner.start(); assert.equal((await sendTo(module, owner, {kind: 'connect'})).status, 'accepted'); await owner.drain();
    assert.ok(records.some(record => record.event === 'command.admitted' && record.trace !== undefined));
    assert.ok(records.some(record => record.event === 'command.completed' && record.trace !== undefined));
    assert.ok(records.some(record => record.event === 'outcome.published' && record.trace !== undefined));
    assert.equal(trace.named('bunny.device.call').length, 1); assert.ok(trace.named('bunny.device.call')[0]?.endedAtMs !== undefined); assert.ok(trace.named('bunny.outcome.publish').length > 0);
  } finally {await owner.stop(); await sdk.close(); await module.close(); db.close();}
});
