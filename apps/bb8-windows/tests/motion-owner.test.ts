import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {InProcessBus} from '@jimmie-potts/sdk';
import {HELPER_SOURCE, MODULE_SOURCE, type Operation} from '@jimmie-potts/bb8/link';
import {HelperOwner, executeDraft} from '../src/owner.js';
import {Receipts} from '../src/receipts.js';
import {FakeGatt, MotionClock} from './fake.js';
async function setup() {
  const db = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt(), clock = new MotionClock();
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: clock.now, scheduler: clock, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)})});
  await owner.start();
  const send = async (operation: Operation, options: {id?: string; deadline?: number; epoch?: string} = {}) => {
    const id = options.id ?? crypto.randomUUID();
    return module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {requestId: id, operationId: id, parentRequestId: id, expectedConfigurationRevision: 0, expectedHelperEpoch: options.epoch ?? owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: options.deadline ?? clock.now() + (operation.kind === 'connect' ? 14000 : 4000), operation}), {requestId: id, timeoutMs: 1000});
  };
  const finish = async () => {await owner.stop(); await sdk.close(); await module.close(); db.close();};
  const connect = await send({kind: 'connect'}); assert.equal(connect.status, 'accepted'); await clock.tick(500); await owner.drain();
  const aim = await send({kind: 'aim', action: 'set'}); assert.equal(aim.status, 'accepted'); await clock.tick(500); await owner.drain();
  assert.ok(owner.state.forwardReference !== undefined);
  return {db, gatt, clock, owner, send, finish};
}
void test('one step, priority Stop and stale/duplicate/expired movement never extend rolling', async () => {
  const {gatt, clock, owner, send, finish} = await setup();
  try {
    const ref = owner.state.forwardReference; assert.ok(ref !== undefined);
    const step = {kind: 'step' as const, direction: 'left' as const, speed: 20, durationMs: 300, forwardReference: ref};
    const before = gatt.writes.length;
    assert.equal((await send(step, {id: 'step-1'})).status, 'accepted'); await clock.tick(80);
    assert.equal((await send(step)).status, 'rejected');
    assert.equal((await send({kind: 'power-refresh'})).status, 'accepted');
    assert.equal((await send({kind: 'stop'}, {id: 'stop-1'})).status, 'accepted');
    await clock.tick(500); await owner.drain();
    const writes = gatt.writes.slice(before);
    assert.deepEqual(writes.map(w => w.bytes[3]), [48, 48, 48, 32], 'local Stop then explicit Stop both precede queued power');
    assert.deepEqual(writes[0]?.bytes.slice(6, -1), [20, 1, 14, 1, 0]);
    assert.equal(owner.results.find(r => r.id === 'step-1')?.result, 'uncertain');
    assert.equal(owner.results.find(r => r.id === 'stop-1')?.result, 'succeeded');
    assert.equal(owner.state.connection, 'connected'); assert.equal(owner.state.forwardReference, undefined);
    const count = gatt.writes.length;
    for (const options of [{id: 'step-1'}, {epoch: 'old-helper'}, {deadline: clock.now() - 1}]) assert.equal((await send(step, options)).status, 'rejected');
    assert.equal((await send(step)).status, 'rejected', 'reference cleared'); assert.equal(gatt.writes.length, count);
  } finally {await finish();}
});
void test('expiry after GO still completes selected local Stop and clears reference', async () => {
  const {gatt, clock, owner, send, finish} = await setup();
  try {
    const reference = owner.state.forwardReference; assert.ok(reference !== undefined); const before = gatt.writes.length;
    assert.equal((await send({kind: 'step', direction: 'back', speed: 20, durationMs: 300, forwardReference: reference}, {id: 'short-expiry', deadline: clock.now() + 100})).status, 'accepted');
    await clock.tick(500); await owner.drain();
    assert.deepEqual(gatt.writes.slice(before).map(w => w.bytes.slice(6, -1)), [[20, 0, 180, 1, 0], [0, 0, 180, 0, 0]]);
    assert.equal(owner.results.find(r => r.id === 'short-expiry')?.result, 'uncertain');
    assert.equal(owner.state.connection, 'connected'); assert.equal(owner.state.forwardReference, undefined);
  } finally {await finish();}
});
void test('queued step invalidated by Stop never writes GO', async () => {
  const {gatt, clock, owner, send, finish} = await setup();
  try {
    const reference = owner.state.forwardReference; assert.ok(reference !== undefined); const before = gatt.writes.length;
    let release: (() => void) | undefined;
    const write = gatt.write.bind(gatt);
    gatt.write = async (uuid, bytes, signal) => {await write(uuid, bytes, signal); if (bytes[3] === 32) await new Promise<void>(resolve => {release = resolve;});};
    assert.equal((await send({kind: 'power-refresh'})).status, 'accepted'); await clock.tick(0);
    assert.equal((await send({kind: 'step', direction: 'forward', speed: 20, durationMs: 300, forwardReference: reference})).status, 'accepted');
    assert.equal((await send({kind: 'stop'})).status, 'accepted'); release?.(); await clock.tick(500); await owner.drain();
    assert.deepEqual(gatt.writes.slice(before).map(w => w.bytes[3]), [32, 48]);
    assert.equal(gatt.writes.at(-1)?.bytes[9], 0, 'only an explicit Stop, no queued GO');
  } finally {await finish();}
});
void test('restart resolves interrupted movement without adapter access or retained reference', async () => {
  const db = new DatabaseSync(':memory:'), store = new Receipts(db), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE); let opens = 0;
  const now = Date.now();
  store.admit({requestId: 'old-step', operationId: 'old-step', parentRequestId: 'old-parent', expectedConfigurationRevision: 0, expectedHelperEpoch: 'old-helper', expectedConnectionGeneration: 4, operationExpiresAtMs: now + 4000, operation: {kind: 'step', direction: 'forward', speed: 20, durationMs: 300, forwardReference: 'old-reference'}}, '00-11111111111111111111111111111111-1111111111111111-01'); store.effect('old-step', 4);
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler: {after: (ms, run) => {const timer = setTimeout(run, ms); return () => {clearTimeout(timer);};}}, clockErrorMs: () => 0, adapter: () => {opens++; throw Error('no replay');}});
  try {await owner.start(); assert.equal(opens, 0); assert.equal(owner.state.connection, 'disconnected'); assert.equal(owner.state.forwardReference, undefined); assert.equal(owner.results[0]?.result, 'uncertain');}
  finally {await owner.stop(); await sdk.close(); db.close();}
});
void test('step admission reserves one result slot for Stop', async () => {
  const {db, gatt, clock, owner, send, finish} = await setup();
  try {
    const store = new Receipts(db), reference = owner.state.forwardReference; assert.ok(reference !== undefined);
    for (let n = 0; n < 60; n++) store.admit({requestId: `held-${n}`, operationId: `held-${n}`, parentRequestId: `parent-${n}`, expectedConfigurationRevision: 0, expectedHelperEpoch: owner.state.helperEpoch, expectedConnectionGeneration: owner.state.connectionGeneration, operationExpiresAtMs: clock.now() + 4000, operation: {kind: 'power-refresh'}}, '00-11111111111111111111111111111111-1111111111111111-01');
    assert.equal((await send({kind: 'step', direction: 'forward', speed: 20, durationMs: 300, forwardReference: reference})).status, 'accepted'); await clock.tick(80);
    assert.equal((await send({kind: 'led-set', led: {target: 'tail', brightness: 0}})).status, 'rejected');
    assert.equal((await send({kind: 'stop'})).status, 'accepted'); await clock.tick(500); await owner.drain();
    assert.equal(store.count(), 64); assert.equal(gatt.writes.at(-1)?.bytes[9], 0);
  } finally {await finish();}
});
void test('step admission reserves one pending slot for priority Stop', async () => {
  const {clock, owner, send, finish} = await setup();
  try {
    const reference = owner.state.forwardReference; assert.ok(reference !== undefined);
    assert.equal((await send({kind: 'step', direction: 'forward', speed: 20, durationMs: 300, forwardReference: reference})).status, 'accepted'); await clock.tick(80);
    for (let n = 0; n < 7; n++) assert.equal((await send({kind: 'power-refresh'})).status, 'accepted');
    assert.equal((await send({kind: 'power-refresh'})).status, 'rejected');
    assert.equal((await send({kind: 'stop'})).status, 'accepted'); await clock.tick(2000); await owner.drain();
    assert.equal(owner.results.at(3)?.result, 'succeeded', 'priority Stop completed before queued power');
  } finally {await finish();}
});
