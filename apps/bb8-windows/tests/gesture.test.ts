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
