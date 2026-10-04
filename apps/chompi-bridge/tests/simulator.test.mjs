import assert from 'node:assert/strict';
import test from 'node:test';
import { ManualClock } from '../dist/clock.js';
import { ChompiSimulator } from '../dist/simulator.js';
import { createChompiBridge, DEFAULT_TIMING } from '../dist/bridge.js';
import { matchesController } from '../dist/matcher.js';
import { encodeReport, decodeDeviceReport } from '../dist/protocol.js';
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
  assert.equal(simulator.counters.lostReports, 0, 'no hello is sent before the first host heartbeat');
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
  const raw = new Uint8Array(64); raw[0] = 0x7f; raw[1] = 1;
  simulator.sendRaw(raw);
  await settle();
  assert.equal(bridge.status().counters.malformed['unknown-type'], 1);
  assert.throws(() => simulator.turn(3, 1), RangeError);
  assert.throws(() => simulator.press(41), RangeError);
});

/** A bare host handle on the simulator, without a bridge. */
async function rawHost(clock, simulator) {
  const messages = [];
  const [device] = await simulator.transport.list();
  const connection = await simulator.transport.open(device, { report: r => messages.push(decodeDeviceReport(r).message), closed() {} });
  const beat = async () => { await connection.write(encodeReport({ type: 'host-heartbeat', version: 1, profileVersion: 0, brightnessPercent: 50 })); await settle(); };
  const take = type => messages.splice(0).filter(m => !type || m.type === type);
  return { connection, beat, take };
}

test('hello comes only with the first host heartbeat after enumeration or after a host timeout', async t => {
  const { clock, simulator } = rig(t);
  simulator.plug();
  const host = await rawHost(clock, simulator);
  await advance(clock, 1000);
  assert.deepEqual(host.take('hello'), [], 'nothing before a host heartbeat');
  await host.beat();
  assert.deepEqual(host.take('hello').map(m => m.epoch), [0x1111]);
  await advance(clock, 400);
  await host.beat();
  assert.deepEqual(host.take('hello'), [], 'a current host gets no second hello');
  await advance(clock, 2100);
  assert.equal(host.take('heartbeat').at(-1).hostAlive, false);
  await host.beat();
  assert.deepEqual(host.take('hello').map(m => m.epoch), [0x1111], 'a new host session keeps the epoch');
});

test('sequence numbers wrap from 65535 to 1, skipping 0', async t => {
  const { clock, simulator } = rig(t);
  simulator.plug();
  const host = await rawHost(clock, simulator);
  await host.beat();
  host.take();
  for (let i = 0; i < 65536; i++) simulator.turn(41, 1);
  await settle();
  const sequences = host.take('input').map(m => m.sequence);
  assert.equal(sequences.length, 65536);
  assert.deepEqual(sequences.slice(0, 2), [1, 2]);
  assert.deepEqual(sequences.slice(-2), [65535, 1]);
  assert.equal(sequences.includes(0), false);
});

test('a host timeout turns the lights off, reports frame 0 and forgets reported keys', async t => {
  const { clock, simulator } = rig(t);
  simulator.plug();
  const host = await rawHost(clock, simulator);
  await host.beat();
  const colors35 = colors(3);
  await host.connection.write(encodeReport({ type: 'leds', version: 1, frame: 9, part: 0, first: 0, colors: colors35.slice(0, 19) }));
  await host.connection.write(encodeReport({ type: 'leds', version: 1, frame: 9, part: 1, first: 19, colors: colors35.slice(19) }));
  simulator.press(26);
  simulator.press(27);
  await settle();
  assert.equal(simulator.appliedFrame, 9);
  host.take();
  await advance(clock, 2100);
  assert.equal(simulator.display, 'disconnected');
  assert.equal(simulator.appliedFrame, 0);
  assert.deepEqual(simulator.leds, colors().map(() => [0, 0, 0]));
  assert.deepEqual(host.take('heartbeat').at(-1), { type: 'heartbeat', version: 1, epoch: 0x1111, ledFrame: 0, hostAlive: false });
  await host.beat();
  simulator.release(26);
  simulator.press(26);
  simulator.release(27);
  await settle();
  assert.deepEqual(host.take('input').map(m => [m.control, m.kind]), [[26, 'press']], 'keys held across the timeout stay silent until pressed again');
  assert.deepEqual(simulator.pressed, [26]);
});

test('a host stall restarts the firmware session; the bridge releases and restores the lights', async t => {
  const { clock, simulator, bridge, events } = rig(t);
  simulator.plug();
  bridge.start();
  await advance(clock, DEFAULT_TIMING.helloQuietMs + 100);
  bridge.setLeds(colors(7));
  simulator.press(26);
  await advance(clock, 1000);
  assert.deepEqual(simulator.leds, colors(7));
  events.drain();
  simulator.dropHostReports(true);
  await advance(clock, 2600);
  assert.deepEqual(strip(events.drain()).map(e => [e.type, e.control ?? null, e.reason ?? e.cause]), [
    ['input', 26, 'session-restart'], ['session-restart', null, 'host-flag-dropped'],
  ]);
  assert.equal(simulator.appliedFrame, 0);
  assert.equal(bridge.status().appliedLedFrame, null);
  simulator.dropHostReports(false);
  await advance(clock, 1100);
  assert.deepEqual(simulator.leds, colors(7), 'the bridge resent its frame after the new hello');
  assert.equal(bridge.status().appliedLedFrame, simulator.appliedFrame);
  simulator.release(26);
  simulator.press(26);
  await settle();
  assert.deepEqual(strip(events.drain()).map(e => [e.type, e.control, e.kind, e.synthetic]), [['input', 26, 'press', false]]);
  assert.equal(bridge.status().state, 'connected');
});
