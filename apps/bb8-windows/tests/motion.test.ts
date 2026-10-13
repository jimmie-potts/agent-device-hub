import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PacketTransport, StepFailure, UUID} from '../src/transport.js';
import {FakeGatt, MotionClock as Clock} from './fake.js';
const signal = () => new AbortController().signal;
async function connected() {
  const clock = new Clock(), gatt = new FakeGatt();
  const transport = new PacketTransport(() => ({open: () => Promise.resolve(gatt)}), clock, clock.now);
  const connect = transport.execute({kind: 'connect'}, signal(), () => {}, () => {});
  await clock.tick(500); await connect;
  return {clock, gatt, transport};
}
const step = {kind: 'step' as const, direction: 'forward' as const, speed: 20, durationMs: 300, forwardReference: 'reference-1'};
void test('forward reference uses only the three selected bounded setup packets; clear is passive', async () => {
  const {clock, gatt, transport} = await connected();
  try {
    const before = gatt.writes.length;
    const setting = transport.execute({kind: 'aim', action: 'set'}, signal(), () => {}, () => {});
    await clock.tick(500); await setting;
    assert.deepEqual(gatt.writes.slice(before).map(w => [w.bytes[2], w.bytes[3], w.bytes.slice(6, -1)]), [[2, 2, [0]], [2, 1, [0, 0]], [2, 2, [1]]]);
    await transport.execute({kind: 'aim', action: 'clear'}, signal(), () => {}, () => {});
    assert.equal(gatt.writes.length, before + 3);
  } finally {await transport.close();}
});
void test('deadline sends Stop before a missing GO reply and a late GO cannot acknowledge Stop', async () => {
  const {clock, gatt, transport} = await connected();
  try {
    gatt.reply = false;
    const start = gatt.writes.length;
    const moving = transport.execute(step, signal(), () => {}, () => {});
    const result = moving.then(() => undefined, error => error as unknown);
    await clock.tick(299); assert.equal(gatt.writes.length, start + 1);
    await clock.tick(1); assert.equal(gatt.writes.length, start + 2, 'deadline selects Stop without a GO reply');
    const go = gatt.writes[start], stop = gatt.writes[start + 1]; assert.ok(go); assert.ok(stop);
    assert.notEqual(go.bytes[4], stop.bytes[4]);
    const reply = (sequence: number) => gatt.callback?.(Uint8Array.of(255, 255, 0, sequence, 1, 255 - ((sequence + 1) & 255)));
    reply(go.bytes[4] ?? -1); await clock.flush();
    let done = false; void result.then(() => {done = true;}); await clock.flush(); assert.equal(done, false);
    reply(stop.bytes[4] ?? -1); await clock.flush();
    const failure = await result; assert.ok(failure instanceof StepFailure); assert.equal(failure.stopAcknowledged, true);
    assert.equal(gatt.closed, false); assert.equal(gatt.writes.length, start + 2, 'no GO retry');
  } finally {await transport.close();}
});
void test('step deadline is anchored at GO write; a slow callback cannot defer requesting Stop', async () => {
  const {clock, gatt, transport} = await connected();
  try {
    const original = gatt.write.bind(gatt); let finish: (() => void) | undefined;
    gatt.write = async (uuid, bytes, live) => {
      await original(uuid, bytes, live);
      if (uuid === UUID.command && bytes[3] === 48 && bytes[9] === 1) await new Promise<void>(resolve => {finish = resolve;});
    };
    const start = gatt.writes.length;
    const moving = transport.execute(step, signal(), () => {}, () => {});
    const result = moving.then(() => undefined, error => error as unknown);
    await clock.tick(300);
    assert.equal(gatt.writes.length, start + 2); assert.equal(gatt.writes.at(-1)?.bytes[9], 0);
    assert.ok(await result instanceof StepFailure);
    finish?.(); await clock.flush();
  } finally {await transport.close();}
});
void test('an explicit interrupt sends selected Stop early; invalid bounds send no roll', async () => {
  const {clock, gatt, transport} = await connected();
  try {
    const start = gatt.writes.length;
    const moving = transport.execute(step, signal(), () => {}, () => {});
    await clock.tick(80); transport.interruptStep(); await clock.tick(0); await moving;
    assert.equal(gatt.writes.length, start + 2); assert.equal(gatt.writes.at(-1)?.bytes[9], 0);
    for (const invalid of [{...step, speed: 33}, {...step, speed: 0}, {...step, durationMs: 501}, {...step, durationMs: 99}]) await assert.rejects(transport.execute(invalid, signal(), () => {}, () => {}));
    assert.equal(gatt.writes.length, start + 2);
  } finally {await transport.close();}
});
void test('sequence exhaustion refuses GO while retaining packet space for an explicit Stop', async () => {
  const {clock, gatt, transport} = await connected();
  try {
    for (let n = 0; n < 252; n++) {
      const led = transport.execute({kind: 'led-set', led: {target: 'tail', brightness: 0}}, signal(), () => {}, () => {});
      await clock.tick(60); await led;
    }
    const before = gatt.writes.length;
    await assert.rejects(transport.execute(step, signal(), () => {}, () => {})); assert.equal(gatt.writes.length, before);
    const stop = transport.execute({kind: 'stop'}, signal(), () => {}, () => {}); await clock.tick(60); await stop;
    assert.equal(gatt.writes.length, before + 1); assert.equal(gatt.writes.at(-1)?.bytes[9], 0);
  } finally {await transport.close();}
});
