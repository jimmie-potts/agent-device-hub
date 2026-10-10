import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PacketTransport, UUID} from '../src/transport.js';
import {FakeGatt, scheduler} from './fake.js';
void test('explicit connect writes selected handshake/ping/version then main RGB to the enrolled characteristic', async () => {
  const gatt = new FakeGatt(); let opens = 0, effects = 0;
  const transport = new PacketTransport(() => ({open: () => {opens++; return Promise.resolve(gatt);}}), scheduler, Date.now);
  assert.equal(opens, 0);
  const check = () => {}, effect = () => {effects++;};
  const version = await transport.execute({kind: 'connect'}, new AbortController().signal, check, effect);
  assert.equal(opens, 1); assert.deepEqual(version.version?.bytes, [1, 2, 3, 4, 5, 6, 7, 8]);
  await transport.execute({kind: 'led-set', led: {target: 'main', rgb: [10, 20, 30]}}, new AbortController().signal, check, effect);
  assert.deepEqual(gatt.writes.map(w => w.uuid), [UUID.unlock, UUID.txPower, UUID.command, UUID.command, UUID.command]);
  assert.deepEqual(gatt.writes.at(-1)?.bytes.slice(2, -1), [2, 32, 2, 4, 10, 20, 30]);
  assert.ok(gatt.writes.every(w => w.bytes.length <= 20)); assert.ok(effects >= 5);
  await transport.close();
});
void test('power is a timed versioned category and voltage, not a percentage', async () => {
  const gatt = new FakeGatt(), transport = new PacketTransport(() => ({open: () => Promise.resolve(gatt)}), scheduler, Date.now);
  await transport.execute({kind: 'connect'}, new AbortController().signal, () => {}, () => {});
  const result = await transport.execute({kind: 'power-refresh'}, new AbortController().signal, () => {}, () => {});
  assert.deepEqual({...result.power, observedAtMs: 0}, {recordVersion: 1, category: 2, voltageHundredths: 420, rechargeCount: 5, secondsAwakeSinceRecharge: 100, observedAtMs: 0});
  await transport.close();
});
void test('wrong sequence, corrupt reply and notification overflow cannot complete an operation or retry it', async () => {
  for (const scenario of ['stale', 'corrupt', 'overflow'] as const) {
    const gatt = new FakeGatt();
    gatt.staleSequence = scenario === 'stale'; gatt.corrupt = scenario === 'corrupt';
    const original = gatt.write.bind(gatt);
    if (scenario === 'overflow') gatt.write = async (uuid, bytes, signal) => {await original(uuid, bytes, signal); if (uuid === UUID.command) for (let n = 0; n < 130; n++) gatt.callback?.(Uint8Array.of(0));};
    const transport = new PacketTransport(() => ({open: () => Promise.resolve(gatt)}), scheduler, Date.now);
    await assert.rejects(transport.execute({kind: 'connect'}, new AbortController().signal, () => {}, () => {}), scenario);
    assert.equal(gatt.writes.filter(w => w.uuid === UUID.command).length, 1, 'only one ping; no resend or version after an invalid reply');
    await transport.close();
  }
});
void test('cancellation between writes prevents the next handshake effect and obsolete callbacks cannot answer a new connection', async () => {
  const first = new FakeGatt(), second = new FakeGatt(); let opens = 0;
  const transport = new PacketTransport(() => ({open: () => Promise.resolve(opens++ === 0 ? first : second)}), scheduler, Date.now);
  const controller = new AbortController(), write = first.write.bind(first);
  first.write = async (uuid, bytes, signal) => {await write(uuid, bytes, signal); controller.abort();};
  await assert.rejects(transport.execute({kind: 'connect'}, controller.signal, () => {}, () => {}));
  assert.equal(first.writes.length, 1);
  await transport.close();
  const old = first.callback;
  second.reply = false;
  const next = transport.execute({kind: 'connect'}, new AbortController().signal, () => {}, () => {});
  await new Promise(resolve => setTimeout(resolve, 150));
  old?.(Uint8Array.of(255, 255, 0, 0, 1, 254));
  await assert.rejects(next); assert.equal(second.writes.length, 3);
  await transport.close();
});
