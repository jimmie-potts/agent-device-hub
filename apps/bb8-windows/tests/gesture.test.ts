import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {InProcessBus} from '@jimmie-potts/sdk';
import {HELPER_SOURCE, MODULE_SOURCE, type Operation} from '@jimmie-potts/bb8/link';
import {executeDraft, HelperOwner} from '../src/owner.js';
import {FakeGatt, scheduler} from './fake.js';
void test('Stop cancels a queued dock gesture before any heading write', async () => {
  const database = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
  gatt.power[1] = 1;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)})});
  const send = async (operation: Operation) => {
    const id = crypto.randomUUID(), state = owner.state;
    const reply = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {operationId: id, requestId: id, parentRequestId: id, expectedConfigurationRevision: 0, expectedHelperEpoch: state.helperEpoch, expectedConnectionGeneration: state.connectionGeneration, operationExpiresAtMs: Date.now() + 5000, operation}), {requestId: id, timeoutMs: 1000});
    assert.equal(reply.status, 'accepted'); return id;
  };
  let release: (() => void) | undefined;
  try {
    await owner.start(); await send({kind: 'connect'}); await owner.drain();
    const gate = new Promise<void>(resolve => {release = resolve;}), original = gatt.write.bind(gatt);
    gatt.write = async (uuid, bytes, signal) => {await original(uuid, bytes, signal); if (bytes[2] === 2 && bytes[3] === 32) await gate;};
    await send({kind: 'led-set', led: {target: 'main', rgb: [0, 0, 0]}});
    const id = await send({kind: 'gesture', gesture: 'look-left', docked: true});
    await send({kind: 'stop'}); release?.(); await owner.drain();
    assert.equal(gatt.writes.filter(w => w.bytes[2] === 2 && w.bytes[3] === 48 && w.bytes[9] === 1).length, 0, 'queued gesture must never start after Stop');
    const result = owner.results.find(r => r.id === id); assert.ok(result);
    assert.equal(result.result, 'failed'); assert.equal(result.error?.code, 'cancelled');
  } finally {release?.(); await owner.stop(); await sdk.close(); await module.close(); database.close();}
});

void test('a later charging refusal retains acknowledged gesture transmission without claiming success', async () => {
  const database = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
  gatt.power[1] = 1;
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)})});
  const send = async (operation: Operation) => {
    const id = crypto.randomUUID(), state = owner.state;
    const reply = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {operationId: id, requestId: id, parentRequestId: id, expectedConfigurationRevision: 0, expectedHelperEpoch: state.helperEpoch, expectedConnectionGeneration: state.connectionGeneration, operationExpiresAtMs: Date.now() + 5000, operation}), {requestId: id, timeoutMs: 1000});
    assert.equal(reply.status, 'accepted'); await owner.drain(); return owner.results.find(result => result.id === id);
  };
  try {
    await owner.start(); await send({kind: 'connect'});
    const before = gatt.writes.length, original = gatt.write.bind(gatt); let reports = 0;
    gatt.write = async (uuid, bytes, signal) => {if (bytes[2] === 0 && bytes[3] === 32 && ++reports === 2) gatt.power[1] = 2; await original(uuid, bytes, signal);};
    const receipt = await send({kind: 'gesture', gesture: 'shake-head', docked: true}); assert.ok(receipt);
    assert.equal(receipt.evidence, 'transmitted', 'prior heading and selected Stop replies remain evidence');
    assert.equal(receipt.result, 'failed'); assert.equal(receipt.error?.code, 'invalid-state');
    assert.equal(reports, 2); assert.equal(gatt.writes.length, before + 4); assert.equal(owner.state.connection, 'connected');
  } finally {await owner.stop(); await sdk.close(); await module.close(); database.close();}
});

void test('gesture transmission survives an unconfirmed later Stop without claiming a usable link', async () => {
  for (const loss of ['later-both', 'first-stop', 'first-both', 'stop-refusal'] as const) {
    const database = new DatabaseSync(':memory:'), bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE), module = bus.connect(MODULE_SOURCE), gatt = new FakeGatt();
    gatt.power[1] = 1;
    const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => Promise.resolve(gatt)})});
    const send = async (operation: Operation) => {
      const id = crypto.randomUUID(), state = owner.state;
      const reply = await module.request('bunny.cmd.bb8-link-execute.bb8', executeDraft('bb8', {operationId: id, requestId: id, parentRequestId: id, expectedConfigurationRevision: 0, expectedHelperEpoch: state.helperEpoch, expectedConnectionGeneration: state.connectionGeneration, operationExpiresAtMs: Date.now() + 5000, operation}), {requestId: id, timeoutMs: 1000});
      assert.equal(reply.status, 'accepted'); await owner.drain(); return owner.results.find(result => result.id === id);
    };
    try {
      await owner.start(); await send({kind: 'connect'});
      const before = gatt.writes.length, original = gatt.write.bind(gatt); let headings = 0;
      gatt.write = async (uuid, bytes, signal) => {
        if (bytes[2] === 2 && bytes[3] === 48) {
          if (bytes[9] === 1) headings++;
          if (loss === 'later-both' && headings === 2 || loss === 'first-both' || loss === 'first-stop' && bytes[9] === 0) gatt.reply = false;
          if (loss === 'stop-refusal') {gatt.reply = bytes[9] === 0; gatt.mrsp = 7;}
        }
        await original(uuid, bytes, signal);
      };
      const receipt = await send({kind: 'gesture', gesture: 'shake-head', docked: true}); assert.ok(receipt);
      assert.equal(receipt.evidence, loss === 'first-both' ? 'none' : 'transmitted', loss);
      assert.equal(receipt.result, 'uncertain'); assert.equal(receipt.error?.code, 'uncertain-result');
      assert.equal(owner.state.connection, 'unavailable', 'an earlier Stop does not confirm the latest Stop'); assert.equal(gatt.closed, true);
      assert.equal(headings, loss === 'later-both' ? 2 : 1); assert.equal(gatt.writes.length, before + (loss === 'later-both' ? 6 : 3));
    } finally {await owner.stop(); await sdk.close(); await module.close(); database.close();}
  }
});
