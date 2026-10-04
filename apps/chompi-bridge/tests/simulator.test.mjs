import assert from 'node:assert/strict';
import test from 'node:test';
import { ManualClock } from '../dist/clock.js';
import { ChompiSimulator } from '../dist/simulator.js';
import { createChompiBridge, DEFAULT_TIMING } from '../dist/bridge.js';
import { matchesController } from '../dist/matcher.js';
import { encodeReport } from '../dist/protocol.js';
import { settle, advance, colors } from './helpers.mjs';

const strip = events => events.map(({ at, ...rest }) => rest);

function rig(t, options = {}) {
  const clock = new ManualClock();
  const epochs = [0x1111, 0x2222, 0x3333];
  const simulator = new ChompiSimulator({ clock, nextEpoch: () => epochs.shift(), ...options });
  const bridge = createChompiBridge({ transport: simulator.transport, clock, profileVersion: 7 });
  const events = bridge.events();
  t.after(async () => { await bridge.stop(); simulator.unplug(); });
  return { clock, simulator, bridge, events };
}

test('the simulator presents the controller identity only while plugged in', async t => {
  const { simulator } = rig(t);
  assert.deepEqual(await simulator.transport.list(), []);
  simulator.plug();
  const [device] = await simulator.transport.list();
  assert.equal(matchesController(device), true);
  simulator.unplug();
  assert.deepEqual(await simulator.transport.list(), []);
});

test('a fake host roundtrip carries events and RGB frames through protocol v1', async t => {
  const { clock, simulator, bridge, events } = rig(t);
  simulator.plug();
  bridge.start();
  await settle();
  assert.equal(simulator.counters.lostReports, 1, 'the enumeration hello had no reader');
  await advance(clock, DEFAULT_TIMING.helloQuietMs + 100);
  assert.deepEqual(strip(events.drain()), [{ type: 'connected', epoch: 0x1111, firmware: [0, 1, 0] }]);

  simulator.press(1);
  simulator.release(1);
  simulator.turn(45, -1);
  simulator.click(33);
  await settle();
  assert.deepEqual(strip(events.drain()).map(e => [e.sequence, e.control, e.kind, e.delta]), [
    [1, 1, 'press', 0], [2, 1, 'release', 0], [3, 45, 'turn', -1], [4, 33, 'press', 0], [5, 33, 'release', 0],
  ]);

  bridge.setLeds(colors(9));
  bridge.setBrightness(40);
  await advance(clock, 1000);
  assert.deepEqual(simulator.leds, colors(9));
  assert.equal(simulator.appliedFrame, bridge.status().appliedLedFrame);
  assert.equal(simulator.brightnessPercent, 40);
  assert.equal(simulator.profileVersion, 7);
  assert.equal(simulator.display, 'host');
  assert.equal(bridge.status().deviceHostAlive, true);
  assert.deepEqual(simulator.counters.rejected, {});
});

test('unplug releases held keys, input while unplugged is never replayed, and replug starts a new epoch', async t => {
  const { clock, simulator, bridge, events } = rig(t);
  simulator.plug();
  bridge.start();
  await advance(clock, DEFAULT_TIMING.helloQuietMs + 100);
  simulator.press(26);
  await settle();
  events.drain();
  simulator.unplug();
  await settle();
  assert.deepEqual(strip(events.drain()).map(e => [e.type, e.control ?? null, e.reason ?? null]), [
    ['input', 26, 'device-closed'], ['disconnected', null, 'device-closed'],
  ]);
  simulator.release(26);
  simulator.press(33);
  simulator.plug();
  await advance(clock, DEFAULT_TIMING.reconnectMs + DEFAULT_TIMING.helloQuietMs + 600);
  assert.deepEqual(strip(events.drain()), [{ type: 'connected', epoch: 0x2222, firmware: [0, 1, 0] }]);
  simulator.release(33);
  simulator.press(2);
  await settle();
  assert.deepEqual(strip(events.drain()).map(e => [e.control, e.kind]), [[2, 'press']], 'the release of a press from before the epoch is not delivered');
});

test('the device shows its disconnected pattern when host heartbeats stop and queues nothing meanwhile', async t => {
  const { clock, simulator, bridge, events } = rig(t);
  simulator.plug();
  bridge.start();
  await advance(clock, DEFAULT_TIMING.helloQuietMs + 100);
  await bridge.stop();
  events.drain();
  await advance(clock, 2100);
  assert.equal(simulator.display, 'disconnected');
  simulator.click(5);
  assert.equal(simulator.counters.droppedWithoutHost, 2);
});

test('a heartbeat pause on the device makes the bridge report stale, then recovered', async t => {
  const { clock, simulator, bridge, events } = rig(t);
  simulator.plug();
  bridge.start();
  await advance(clock, DEFAULT_TIMING.helloQuietMs + 100);
  events.drain();
  simulator.pauseHeartbeats(true);
  await advance(clock, DEFAULT_TIMING.staleAfterMs + 100);
  assert.deepEqual(strip(events.drain()).map(e => e.type), ['stale']);
  simulator.pauseHeartbeats(false);
  await advance(clock, 600);
  assert.deepEqual(strip(events.drain()).map(e => e.type), ['recovered']);
});

test('the simulator rejects malformed host reports and can send raw device reports', async t => {
  const { clock, simulator, bridge, events } = rig(t);
  simulator.plug();
  bridge.start();
  await advance(clock, DEFAULT_TIMING.helloQuietMs + 100);
  events.drain();
  const [connection] = simulator.connections;
  const bad = encodeReport({ type: 'host-heartbeat', version: 1, profileVersion: 1, brightnessPercent: 50 }); bad[6] = 101;
  await connection.write(bad);
  await connection.write(new Uint8Array(10));
  await settle();
  assert.deepEqual(simulator.counters.rejected, { 'invalid-brightness': 1, 'invalid-length': 1 });
  simulator.sendRaw(new Uint8Array(64).fill(0x7f));
  await settle();
  assert.equal(bridge.status().counters.malformed['unknown-type'], 1);
  assert.throws(() => simulator.turn(3, 1), RangeError);
  assert.throws(() => simulator.press(41), RangeError);
});
