import assert from 'node:assert/strict';
import test from 'node:test';
import { BRIDGE_INTERFACE_VERSION, DEFAULT_TIMING } from '../dist/bridge.js';
import { CONTROLLER, STOCK_CHOMPI, setup, settle, advance, hello, input, heartbeat, sent, colors } from './helpers.mjs';

const strip = events => events.map(({ at, ...rest }) => rest);
const inputs = events => events.filter(e => e.type === 'input');

test('the public interface is versioned and its timing defaults follow the protocol', () => {
  assert.equal(BRIDGE_INTERFACE_VERSION, 1);
  assert.equal(DEFAULT_TIMING.hostHeartbeatMs, 500);
  assert.ok(DEFAULT_TIMING.helloQuietMs > 2000, 'quiet period must outlast the firmware 2 s host timeout');
  assert.ok(DEFAULT_TIMING.staleAfterMs >= 1000 && DEFAULT_TIMING.staleAfterMs < DEFAULT_TIMING.disconnectAfterMs);
});

test('only the exact controller identity is opened', async t => {
  const near = [
    STOCK_CHOMPI,
    { ...CONTROLLER, path: 'p1', product: 'Agent Controller 2' },
    { ...CONTROLLER, path: 'p2', usagePage: 0xff01 },
    { ...CONTROLLER, path: 'p3', usage: 0x02 },
    { ...CONTROLLER, path: 'p4', productId: 0x000d },
    { ...CONTROLLER, path: 'p5', vendorId: 0x303a },
    { ...CONTROLLER, path: 'p6', usagePage: undefined },
  ];
  const s = await setup(t, { epoch: 0, devices: near });
  assert.deepEqual(s.transport.opens, []);
  s.transport.devices = [...near, CONTROLLER];
  await advance(s.clock, DEFAULT_TIMING.reconnectMs);
  assert.deepEqual(s.transport.opens, ['fake-controller']);
});

test('a configured serial must match, and two candidates without one are refused', async t => {
  const other = { ...CONTROLLER, path: 'second', serialNumber: 'FFFFFFFFFFFFFFFFFFFFFFFF' };
  const ambiguous = await setup(t, { epoch: 0, devices: [CONTROLLER, other] });
  assert.deepEqual(ambiguous.transport.opens, []);
  assert.equal(ambiguous.bridge.status().counters.ambiguousDevices, 1);
  const pinned = await setup(t, { epoch: 0, devices: [CONTROLLER, other], serialNumber: other.serialNumber });
  assert.deepEqual(pinned.transport.opens, ['second']);
  const absent = await setup(t, { epoch: 0, devices: [CONTROLLER], serialNumber: other.serialNumber });
  assert.deepEqual(absent.transport.opens, []);
});

test('input before a compatible hello is dropped; hello starts the connection', async t => {
  const s = await setup(t, { epoch: 0 });
  assert.equal(s.bridge.status().state, 'awaiting-hello');
  s.connection().inject(input(0x1234, 1, 1, 'press'));
  s.connection().inject(heartbeat(0x1234));
  s.connection().inject(hello(0x1234, { leds: 36 }));
  s.connection().inject(hello(0x1234, { encoders: 5 }));
  s.connection().inject(hello(0));
  await settle();
  assert.deepEqual(s.events.drain(), []);
  const { counters } = s.bridge.status();
  assert.equal(counters.beforeHello, 2);
  assert.equal(counters.malformed['incompatible-device'], 3);
  s.connection().inject(hello(0x1234, { firmware: [1, 2, 3] }));
  s.connection().inject(input(0x1234, 1, 1, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'connected', epoch: 0x1234, firmware: [1, 2, 3] },
    { type: 'input', epoch: 0x1234, sequence: 1, control: 1, kind: 'press', delta: 0, synthetic: false },
  ]);
  assert.equal(s.bridge.status().state, 'connected');
});

test('older epochs, duplicate and older sequences are dropped; sequence wrap is accepted', async t => {
  const s = await setup(t);
  s.events.drain();
  const c = s.connection();
  c.inject(input(0x4321, 9, 2, 'press'));
  c.inject(input(0x1234, 65534, 41, 'turn', 1));
  c.inject(input(0x1234, 65534, 41, 'turn', 1));
  c.inject(input(0x1234, 65000, 41, 'turn', 1));
  c.inject(input(0x1234, 65535, 41, 'turn', -2));
  c.inject(input(0x1234, 1, 41, 'turn', 3));
  c.inject(input(0x1234, 65535, 41, 'turn', 1));
  await settle();
  assert.deepEqual(inputs(s.events.drain()).map(e => [e.sequence, e.delta]), [[65534, 1], [65535, -2], [1, 3]]);
  const { counters } = s.bridge.status();
  assert.equal(counters.otherEpoch, 1);
  assert.equal(counters.duplicateSequence, 1);
  assert.equal(counters.olderSequence, 2);
});

test('turns and clicks stay distinct, a repeated press and an orphan release are dropped', async t => {
  const s = await setup(t);
  s.events.drain();
  const c = s.connection();
  c.inject(input(0x1234, 1, 29, 'press'));
  c.inject(input(0x1234, 2, 41, 'turn', 1));
  c.inject(input(0x1234, 3, 29, 'press'));
  c.inject(input(0x1234, 4, 29, 'release'));
  c.inject(input(0x1234, 5, 30, 'release'));
  await settle();
  assert.deepEqual(inputs(s.events.drain()).map(e => [e.control, e.kind, e.delta]), [[29, 'press', 0], [41, 'turn', 1], [29, 'release', 0]]);
  assert.equal(s.bridge.status().counters.repeatedPress, 1);
  assert.equal(s.bridge.status().counters.orphanRelease, 1);
  assert.deepEqual(s.bridge.status().held, []);
});

test('disconnect releases every held control and reconnect never replays input', async t => {
  const s = await setup(t);
  s.events.drain();
  const first = s.connection();
  first.inject(input(0x1234, 1, 26, 'press'));
  first.inject(input(0x1234, 2, 33, 'press'));
  first.inject(input(0x1234, 3, 45, 'turn', 1));
  await settle();
  assert.deepEqual(s.bridge.status().held, [26, 33]);
  s.events.drain();
  first.disconnect();
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 26, kind: 'release', delta: 0, synthetic: true, reason: 'device-closed' },
    { type: 'input', epoch: 0x1234, sequence: null, control: 33, kind: 'release', delta: 0, synthetic: true, reason: 'device-closed' },
    { type: 'disconnected', epoch: 0x1234, reason: 'device-closed' },
  ]);
  assert.deepEqual(s.bridge.status().held, []);
  assert.equal(s.bridge.status().state, 'searching');

  first.inject(input(0x1234, 4, 1, 'press'));
  await advance(s.clock, DEFAULT_TIMING.reconnectMs);
  assert.equal(s.transport.opens.length, 2);
  const second = s.connection();
  assert.notEqual(second, first);
  second.inject(input(0x1234, 5, 26, 'release'));
  await settle();
  assert.deepEqual(s.events.drain(), [], 'no input is accepted on a new handle before its hello');

  second.inject(hello(0x1234));
  second.inject(input(0x1234, 6, 26, 'release'));
  second.inject(input(0x1234, 7, 1, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'connected', epoch: 0x1234, firmware: [0, 1, 0] },
    { type: 'input', epoch: 0x1234, sequence: 7, control: 1, kind: 'press', delta: 0, synthetic: false },
  ]);
});

test('a new epoch on the same handle ends the old connection first', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(input(0x1234, 1, 5, 'press'));
  await settle();
  s.events.drain();
  c.inject(hello(0x9999));
  c.inject(input(0x1234, 2, 5, 'release'));
  c.inject(input(0x9999, 1, 6, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 5, kind: 'release', delta: 0, synthetic: true, reason: 'epoch-change' },
    { type: 'disconnected', epoch: 0x1234, reason: 'epoch-change' },
    { type: 'connected', epoch: 0x9999, firmware: [0, 1, 0] },
    { type: 'input', epoch: 0x9999, sequence: 1, control: 6, kind: 'press', delta: 0, synthetic: false },
  ]);
});

test('the bridge sends host heartbeats every 500 ms with the profile version and brightness', async t => {
  const s = await setup(t, { profileVersion: 3, brightnessPercent: 60 });
  const beats = () => sent(s.connection()).filter(m => m.type === 'host-heartbeat');
  assert.deepEqual(beats(), [{ type: 'host-heartbeat', version: 1, profileVersion: 3, brightnessPercent: 60 }]);
  for (let i = 0; i < 4; i++) { s.connection().inject(heartbeat(0x1234)); await advance(s.clock, 500); }
  assert.equal(beats().length, 5);
  s.bridge.setBrightness(25);
  await advance(s.clock, DEFAULT_TIMING.commandMinIntervalMs + 10, 10);
  assert.deepEqual(beats().at(-1), { type: 'host-heartbeat', version: 1, profileVersion: 3, brightnessPercent: 25 });
  assert.equal(beats().length, 6);
  for (const bad of [-1, 101, 2.5, Number.NaN]) assert.throws(() => s.bridge.setBrightness(bad), RangeError);
});

test('a new profile version goes out in the next host heartbeat', async t => {
  const s = await setup(t, { profileVersion: 3 });
  const beats = () => sent(s.connection()).filter(m => m.type === 'host-heartbeat');
  s.bridge.setProfileVersion(7);
  s.connection().inject(heartbeat(0x1234));
  await advance(s.clock, 500);
  assert.equal(beats().at(-1).profileVersion, 7);
  for (const bad of [-1, 2 ** 32, 1.5]) assert.throws(() => s.bridge.setProfileVersion(bad), RangeError);
});

test('heartbeat loss marks the link stale, releases held controls, and later disconnects', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(heartbeat(0x1234));
  c.inject(input(0x1234, 1, 26, 'press'));
  await settle();
  s.events.drain();
  await advance(s.clock, DEFAULT_TIMING.staleAfterMs);
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 26, kind: 'release', delta: 0, synthetic: true, reason: 'stale' },
    { type: 'stale', epoch: 0x1234 },
  ]);
  assert.equal(s.bridge.status().state, 'stale');
  c.inject(input(0x1234, 2, 3, 'press'));
  c.inject(heartbeat(0x4321));
  await settle();
  assert.deepEqual(s.events.drain(), [], 'input is not accepted while stale, and another epoch\'s heartbeat does not recover');
  assert.equal(s.bridge.status().counters.whileStale, 1);

  c.inject(heartbeat(0x1234));
  c.inject(input(0x1234, 3, 26, 'release'));
  c.inject(input(0x1234, 4, 3, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'recovered', epoch: 0x1234 },
    { type: 'input', epoch: 0x1234, sequence: 4, control: 3, kind: 'press', delta: 0, synthetic: false },
  ]);

  await advance(s.clock, DEFAULT_TIMING.disconnectAfterMs);
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 3, kind: 'release', delta: 0, synthetic: true, reason: 'stale' },
    { type: 'stale', epoch: 0x1234 },
    { type: 'disconnected', epoch: 0x1234, reason: 'heartbeat-timeout' },
  ]);
  assert.equal(c.closed, true, 'the bridge closes the silent handle');
});

test('without a hello the bridge stays quiet, then solicits one, then retries the open', async t => {
  const s = await setup(t, { epoch: 0 });
  const beats = () => sent(s.connection()).filter(m => m.type === 'host-heartbeat').length;
  await advance(s.clock, DEFAULT_TIMING.helloQuietMs - 100);
  assert.equal(beats(), 0, 'no host heartbeat during the quiet period, so the firmware sees the host as absent');
  await advance(s.clock, 1100);
  assert.ok(beats() >= 2, 'heartbeats resume to solicit a hello');
  await advance(s.clock, DEFAULT_TIMING.helloQuietMs + DEFAULT_TIMING.helloTimeoutMs + 100 - s.clock.now());
  assert.equal(s.transport.opens.length, 1);
  assert.equal(s.connection().closed, true);
  assert.equal(s.bridge.status().counters.helloTimeouts, 1);
  await advance(s.clock, DEFAULT_TIMING.reconnectMs);
  assert.equal(s.transport.opens.length, 2);
  assert.deepEqual(s.events.drain(), [], 'no connection events without a hello');
});

test('a hello during the quiet period connects at once', async t => {
  const s = await setup(t, { epoch: 0 });
  await advance(s.clock, 300);
  s.connection().inject(hello(0x77));
  await settle();
  assert.equal(s.bridge.status().state, 'connected');
  assert.equal(sent(s.connection()).filter(m => m.type === 'host-heartbeat').length, 1);
});

test('LED frames wait for the first device heartbeat, split into two parts and resend until applied', async t => {
  const s = await setup(t);
  const leds = () => sent(s.connection()).filter(m => m.type === 'leds');
  s.bridge.setLeds(colors(1));
  await settle();
  assert.deepEqual(leds(), [], 'the frame number continues from the device heartbeat');
  s.connection().inject(heartbeat(0x1234, 41));
  await settle();
  assert.deepEqual(leds().map(m => [m.frame, m.part, m.first, m.colors.length]), [[42, 0, 0, 19], [42, 1, 19, 16]]);
  assert.deepEqual([...leds()[0].colors, ...leds()[1].colors], colors(1));
  assert.equal(s.bridge.status().pendingLedFrame, 42);

  await advance(s.clock, DEFAULT_TIMING.ledResendMs);
  s.connection().inject(heartbeat(0x1234, 41));
  await advance(s.clock, 500);
  assert.deepEqual(leds().map(m => [m.frame, m.part]), [[42, 0], [42, 1], [42, 0], [42, 1]]);
  assert.equal(s.bridge.status().counters.ledResends, 1);

  s.connection().inject(heartbeat(0x1234, 42));
  await settle();
  assert.equal(s.bridge.status().appliedLedFrame, 42);
  assert.equal(s.bridge.status().pendingLedFrame, null);
  await advance(s.clock, 2 * DEFAULT_TIMING.ledResendMs, 250);
  assert.equal(leds().length, 4, 'an applied frame is not resent');
});

test('rapid LED updates coalesce to the newest frame within the minimum interval', async t => {
  const s = await setup(t);
  s.connection().inject(heartbeat(0x1234, 0));
  s.bridge.setLeds(colors(1));
  await settle();
  s.bridge.setLeds(colors(2));
  s.bridge.setLeds(colors(3));
  await settle();
  const leds = () => sent(s.connection()).filter(m => m.type === 'leds');
  assert.equal(leds().length, 2);
  await advance(s.clock, DEFAULT_TIMING.ledMinIntervalMs, 10);
  assert.deepEqual(leds().map(m => [m.frame, m.part]), [[1, 0], [1, 1], [2, 0], [2, 1]]);
  assert.deepEqual([...leds()[2].colors, ...leds()[3].colors], colors(3));
  assert.throws(() => s.bridge.setLeds(colors().slice(1)), RangeError);
  assert.throws(() => s.bridge.setLeds(colors().map((c, i) => i ? c : [0, 0, 300])), RangeError);
});

test('the last LED frame is sent again after a reconnect', async t => {
  const s = await setup(t);
  s.connection().inject(heartbeat(0x1234, 5));
  s.bridge.setLeds(colors(4));
  await settle();
  s.connection().disconnect();
  await advance(s.clock, DEFAULT_TIMING.reconnectMs);
  s.connection().inject(hello(0x2222));
  s.connection().inject(heartbeat(0x2222, 900));
  await settle();
  const leds = sent(s.connection()).filter(m => m.type === 'leds');
  assert.deepEqual(leds.map(m => [m.frame, m.part]), [[901, 0], [901, 1]]);
  assert.deepEqual([...leds[0].colors, ...leds[1].colors], colors(4));
});

test('malformed reports are counted and ignored', async t => {
  const s = await setup(t);
  s.events.drain();
  const c = s.connection();
  const unknown = new Uint8Array(64); unknown[0] = 0x81; unknown[1] = 1;
  const version = input(0x1234, 1, 1, 'press'); version[1] = 2;
  const control = input(0x1234, 1, 1, 'press'); control[6] = 0;
  c.inject(new Uint8Array(3));
  c.inject(unknown);
  c.inject(version);
  c.inject(control);
  await settle();
  assert.deepEqual(s.events.drain(), []);
  assert.equal(s.bridge.status().state, 'connected');
  assert.deepEqual(Object.fromEntries(Object.entries(s.bridge.status().counters.malformed).filter(([, n]) => n)), {
    'invalid-length': 1, 'unknown-type': 1, 'unsupported-version': 1, 'invalid-control': 1,
  });
});

test('a subscriber that falls behind its bounded queue is closed, others continue', async t => {
  const s = await setup(t, { epoch: 0 });
  const slow = s.bridge.events({ limit: 3 });
  s.connection().inject(hello(0x1234));
  for (let n = 1; n <= 4; n++) s.connection().inject(input(0x1234, n, 41, 'turn', 1));
  await settle();
  assert.equal(slow.closedReason, 'overflow');
  assert.deepEqual(slow.drain(), [], 'an overflowed queue is discarded so a partial press/release history is never delivered');
  assert.deepEqual(await slow.next(), { done: true, value: undefined });
  assert.equal(s.events.drain().length, 5);
  assert.equal(s.bridge.status().counters.subscriberOverflows, 1);
  assert.throws(() => s.bridge.events({ limit: 0 }), RangeError);
});

test('subscriptions are async iterables and end when the bridge stops', async t => {
  const s = await setup(t, { epoch: 0 });
  const seen = [];
  const reader = (async () => { for await (const event of s.bridge.events()) seen.push(event.type); })();
  s.connection().inject(hello(0x1234));
  s.connection().inject(input(0x1234, 1, 27, 'press'));
  await settle();
  await s.bridge.stop();
  await reader;
  assert.deepEqual(seen, ['connected', 'input', 'input', 'disconnected']);
  assert.equal(s.connection().closed, true);
  assert.equal(s.bridge.status().state, 'stopped');
  const tail = s.events.drain();
  assert.deepEqual(strip(tail.slice(-2)), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 27, kind: 'release', delta: 0, synthetic: true, reason: 'stopped' },
    { type: 'disconnected', epoch: 0x1234, reason: 'stopped' },
  ]);
  assert.equal(s.events.closedReason, 'stopped');
});

test('a failed write is a transport error that releases held controls', async t => {
  const s = await setup(t);
  s.connection().inject(input(0x1234, 1, 26, 'press'));
  await settle();
  s.events.drain();
  s.transport.failWrites = true;
  s.bridge.setBrightness(10);
  await advance(s.clock, DEFAULT_TIMING.commandMinIntervalMs + 10, 10);
  assert.deepEqual(strip(s.events.drain()).map(e => [e.type, e.reason]), [['input', 'transport-error'], ['disconnected', 'transport-error']]);
  assert.equal(s.connection().closed, true);
});

test('writes that stop completing are bounded and end the connection', async t => {
  const s = await setup(t);
  s.connection().inject(input(0x1234, 1, 26, 'press'));
  await settle();
  s.events.drain();
  s.transport.hangWrites = true;
  for (let i = 0; i < 40 && s.bridge.status().state === 'connected'; i++) {
    s.connection().inject(heartbeat(0x1234));
    await advance(s.clock, DEFAULT_TIMING.hostHeartbeatMs);
  }
  assert.deepEqual(strip(s.events.drain()).map(e => [e.type, e.reason]), [['input', 'transport-error'], ['disconnected', 'transport-error']]);
  assert.equal(s.connection().closed, true);
});

test('a burst of brightness changes coalesces and cannot overflow the write queue', async t => {
  const s = await setup(t);
  s.connection().inject(heartbeat(0x1234));
  await settle();
  s.events.drain();
  s.transport.hangWrites = true;
  for (let i = 0; i <= 100; i++) s.bridge.setBrightness(i);
  await advance(s.clock, DEFAULT_TIMING.commandMinIntervalMs + 10, 10);
  assert.equal(s.bridge.status().state, 'connected', 'a healthy link is not dropped by a burst');
  assert.deepEqual(s.events.drain(), []);

  const healthy = await setup(t);
  const before = sent(healthy.connection()).filter(m => m.type === 'host-heartbeat').length;
  for (let i = 0; i <= 100; i++) healthy.bridge.setBrightness(100 - i);
  await advance(healthy.clock, DEFAULT_TIMING.commandMinIntervalMs + 10, 10);
  const beats = sent(healthy.connection()).filter(m => m.type === 'host-heartbeat').slice(before);
  assert.ok(beats.length <= 2, `burst sent ${beats.length} heartbeats`);
  assert.equal(beats.at(-1).brightnessPercent, 0, 'the newest value wins');
});

test('stop waits for an open in flight and closes that handle', async t => {
  const s = await setup(t, { epoch: 0, devices: [] });
  let release;
  s.transport.openGate = new Promise(resolve => { release = resolve; });
  s.transport.devices = [CONTROLLER];
  await advance(s.clock, DEFAULT_TIMING.reconnectMs);
  assert.equal(s.transport.opens.length, 1);
  let stopped = false;
  const stopping = s.bridge.stop().then(() => { stopped = true; });
  await settle();
  assert.equal(stopped, false, 'stop does not resolve while the open is in flight');
  release();
  await stopping;
  assert.equal(s.transport.connection.closed, true);
  assert.equal(s.bridge.status().state, 'stopped');
});

test('a dropped host-current flag and then a same-epoch hello restart the session', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(heartbeat(0x1234, 5));
  s.bridge.setLeds(colors(2));
  c.inject(input(0x1234, 1, 26, 'press'));
  await settle();
  c.inject(heartbeat(0x1234, 6));
  await settle();
  assert.equal(s.bridge.status().appliedLedFrame, 6);
  s.events.drain();
  const ledCount = () => sent(c).filter(m => m.type === 'leds').length;
  const ledsBefore = ledCount();

  c.inject(heartbeat(0x1234, 0, false));
  c.inject(heartbeat(0x1234, 0, false));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 26, kind: 'release', delta: 0, synthetic: true, reason: 'session-restart' },
    { type: 'session-restart', epoch: 0x1234, cause: 'host-flag-dropped' },
  ], 'releases come first, then one session-restart however many heartbeats repeat the drop');
  assert.equal(s.bridge.status().appliedLedFrame, null, 'a frame the firmware cleared is not reported as applied');
  c.inject(input(0x1234, 2, 3, 'press'));
  await settle();
  assert.deepEqual(s.events.drain(), [], 'no input until the firmware sends hello again');

  c.inject(hello(0x1234));
  c.inject(input(0x1234, 1, 26, 'release'));
  c.inject(input(0x1234, 2, 26, 'press'));
  await settle();
  const leds = sent(c).filter(m => m.type === 'leds').slice(ledsBefore);
  assert.deepEqual(leds.map(m => [m.frame, m.part]), [[7, 0], [7, 1]], 'the current frame is resent under a new number');
  assert.deepEqual([...leds[0].colors, ...leds[1].colors], colors(2));
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: 2, control: 26, kind: 'press', delta: 0, synthetic: false },
  ], 'the hello after a drop completes that restart; it is not a second one');
  assert.equal(s.bridge.status().counters.repeatedPress, 0);
  assert.equal(s.bridge.status().counters.sessionRestarts, 1);
  assert.equal(s.bridge.status().state, 'connected');
  c.inject(heartbeat(0x1234, 0));
  await settle();
  assert.equal(s.bridge.status().appliedLedFrame, null);
  c.inject(heartbeat(0x1234, 7));
  await settle();
  assert.equal(s.bridge.status().appliedLedFrame, 7);
  assert.ok(ledCount() > ledsBefore);
});

test('a same-epoch hello without a prior timeout also restarts the session', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(heartbeat(0x1234, 1));
  s.bridge.setLeds(colors(5));
  c.inject(input(0x1234, 40, 26, 'press'));
  await settle();
  s.events.drain();
  const ledsBefore = sent(c).filter(m => m.type === 'leds').length;
  c.inject(hello(0x1234));
  c.inject(input(0x1234, 1, 26, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 26, kind: 'release', delta: 0, synthetic: true, reason: 'session-restart' },
    { type: 'session-restart', epoch: 0x1234, cause: 'same-epoch-hello' },
    { type: 'input', epoch: 0x1234, sequence: 1, control: 26, kind: 'press', delta: 0, synthetic: false },
  ]);
  assert.deepEqual(sent(c).filter(m => m.type === 'leds').slice(ledsBefore).map(m => [m.frame, m.part]), [[3, 0], [3, 1]]);
  assert.equal(s.bridge.status().counters.repeatedPress, 0);

  c.inject(hello(0x1234));
  c.inject(hello(0x1234));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'input', epoch: 0x1234, sequence: null, control: 26, kind: 'release', delta: 0, synthetic: true, reason: 'session-restart' },
    { type: 'session-restart', epoch: 0x1234, cause: 'same-epoch-hello' },
    { type: 'session-restart', epoch: 0x1234, cause: 'same-epoch-hello' },
  ], 'each same-epoch hello is its own restart, with one event each');
  assert.equal(s.bridge.status().counters.sessionRestarts, 3);
});

test('a session restart without a new hello reopens the device', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(heartbeat(0x1234, 0, false));
  for (let i = 0; i < 14; i++) { c.inject(heartbeat(0x1234, 0, true)); await advance(s.clock, 500); }
  assert.equal(c.closed, true);
  assert.deepEqual(strip(s.events.drain()).slice(-1), [{ type: 'disconnected', epoch: 0x1234, reason: 'hello-timeout' }]);
});

test('LED frame numbers skip 0, which the firmware reports after a host timeout', async t => {
  const s = await setup(t);
  s.connection().inject(heartbeat(0x1234, 0xffff));
  s.bridge.setLeds(colors(1));
  await settle();
  assert.deepEqual(sent(s.connection()).filter(m => m.type === 'leds').map(m => m.frame), [1, 1]);
});

test('a restart that begins while stale ends with one recovered, after session-restart and before input', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(heartbeat(0x1234));
  c.inject(input(0x1234, 1, 26, 'press'));
  await settle();
  await advance(s.clock, 1600);
  c.inject(heartbeat(0x1234, 0, false));
  c.inject(hello(0x1234));
  c.inject(heartbeat(0x1234, 0, true));
  c.inject(input(0x1234, 1, 26, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()).map(({ epoch, ...e }) => e), [
    { type: 'connected', firmware: [0, 1, 0] },
    { type: 'input', sequence: 1, control: 26, kind: 'press', delta: 0, synthetic: false },
    { type: 'input', sequence: null, control: 26, kind: 'release', delta: 0, synthetic: true, reason: 'stale' },
    { type: 'stale' },
    { type: 'session-restart', cause: 'host-flag-dropped' },
    { type: 'recovered' },
    { type: 'input', sequence: 1, control: 26, kind: 'press', delta: 0, synthetic: false },
  ]);
  assert.equal(s.bridge.status().state, 'connected');
});

test('a same-epoch hello while stale restarts the session and recovers at once', async t => {
  const s = await setup(t);
  const c = s.connection();
  c.inject(heartbeat(0x1234));
  await settle();
  await advance(s.clock, 1600);
  s.events.drain();
  c.inject(hello(0x1234));
  c.inject(input(0x1234, 1, 3, 'press'));
  await settle();
  assert.deepEqual(strip(s.events.drain()), [
    { type: 'session-restart', epoch: 0x1234, cause: 'same-epoch-hello' },
    { type: 'recovered', epoch: 0x1234 },
    { type: 'input', epoch: 0x1234, sequence: 1, control: 3, kind: 'press', delta: 0, synthetic: false },
  ]);
  assert.equal(s.bridge.status().state, 'connected');
  await advance(s.clock, DEFAULT_TIMING.staleAfterMs);
  assert.deepEqual(strip(s.events.drain()).map(e => e.type), ['input', 'stale'], 'the hello re-armed liveness, so silence goes stale again');
});

test('stop gives up waiting for an open that does not settle, and closes it if it ever does', async t => {
  const s = await setup(t, { epoch: 0, devices: [] });
  let release;
  s.transport.openGate = new Promise(resolve => { release = resolve; });
  s.transport.devices = [CONTROLLER];
  await advance(s.clock, DEFAULT_TIMING.reconnectMs);
  assert.equal(s.transport.opens.length, 1);
  let stopped = false;
  const stopping = s.bridge.stop().then(() => { stopped = true; });
  await advance(s.clock, DEFAULT_TIMING.stopTimeoutMs - 100);
  assert.equal(stopped, false);
  await advance(s.clock, 200);
  await stopping;
  assert.equal(s.transport.connections.length, 0, 'the open is still in flight');
  release();
  await settle();
  assert.equal(s.transport.connection.closed, true, 'a late handle is closed as soon as it opens');
  assert.equal(s.bridge.status().state, 'stopped');
});
