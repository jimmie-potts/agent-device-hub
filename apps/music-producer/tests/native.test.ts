import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeCapture} from '../src/native.js';
import {fakeChild, timerWorld} from './support.js';

const frame = (sequence = 1) => ({schema: 'music-native-frame/1.0', sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
  startMonotonicMs: 1000 + sequence * 100, endMonotonicMs: 1100 + sequence * 100, emittedMonotonicMs: 1100 + sequence * 100,
  rms: 0.2, peak: 0.4, clippedFraction: 0, bands: {bass: 0.1, mid: 0.1, treble: 0.1}, onset: {strength: 0.1, confidence: 0.1}, discontinuity: false});

void test('native clock qualification never launches capture and brackets the actual parent clock', async () => {
  const world = timerWorld(), child = fakeChild(), launches: string[] = [];
  const native = new NativeCapture({helper: '/synthetic', ...world, launch: mode => {launches.push(mode); return child.port;}});
  assert.deepEqual(launches, []);
  const result = native.qualifyClock(); child.spawn(); world.advance(10);
  child.output({schema: 'music-native-clock/1.0', monotonicMs: 1005}); child.exit(0);
  assert.equal(await result, true); assert.deepEqual(launches, ['--clock']);
});

void test('stop fences frames immediately and needs a clean observed exit', async () => {
  const world = timerWorld(), child = fakeChild();
  const native = new NativeCapture({helper: '/synthetic', ...world, launch: () => child.port});
  const run = native.start(() => assert.fail('late frame'));
  child.spawn(); const stopped = run.stop();
  child.raw('private late malformed bytes'); child.exit(0);
  assert.deepEqual(await stopped, {status: 'stopped'}); assert.deepEqual(child.killed, []);
});

void test('unconfirmed teardown escalates once, remains uncertain and blocks a replacement helper', async () => {
  const world = timerWorld(), child = fakeChild();
  const native = new NativeCapture({helper: '/synthetic', ...world, launch: () => child.port});
  const run = native.start(() => {}); child.spawn(); void run.stop();
  world.advance(3500);
  assert.deepEqual(child.killed, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(await run.ended, {status: 'uncertain', error: {code: 'uncertain-result', retryable: false}});
  assert.throws(() => native.start(() => {}));
});

void test('invalid output is never emitted and a signalled exit does not prove cleanup', async () => {
  const world = timerWorld(), child = fakeChild();
  const native = new NativeCapture({helper: '/synthetic', ...world, launch: () => child.port});
  const run = native.start(() => assert.fail('invalid output escaped')); child.spawn();
  child.raw('{"pcm":"private"}\n'); child.exit(null, 'SIGKILL');
  assert.equal((await run.ended).status, 'uncertain');
});

void test('native failures distinguish confirmed cleanup from an explicit cleanup failure', async () => {
  for (const [detail, expected] of [['The selected Music audio process is unavailable.', 'failed'], ['Music capture cleanup did not complete.', 'uncertain']]) {
    const child = fakeChild(), world = timerWorld();
    const run = new NativeCapture({helper: '/synthetic', ...world, launch: () => child.port}).start(() => assert.fail('unexpected frame'));
    child.spawn(); child.output({schema: 'music-native-terminal/1.0', error: {code: 'unavailable', retryable: true, detail}}); child.exit(1);
    assert.equal((await run.ended).status, expected);
  }
});

void test('sequence gaps are visible while reordered frames and changed formats end capture', async () => {
  for (const invalid of [frame(3), {...frame(4), endMonotonicMs: 1200, startMonotonicMs: 1100}, {...frame(4), channels: 1}]) {
    const child = fakeChild(), world = timerWorld(), seen: {sequence: number; discontinuity: boolean}[] = [];
    const run = new NativeCapture({helper: '/synthetic', ...world, launch: () => child.port}).start(value => {seen.push(value);});
    child.spawn(); child.output(frame(1)); child.output(frame(3)); child.output(invalid); child.exit(0);
    assert.deepEqual(seen.map(value => [value.sequence, value.discontinuity]), [[1, true], [3, true]]);
    assert.deepEqual(await run.ended, {status: 'failed', error: {code: 'invalid-message', retryable: false}});
  }
});

void test('clock qualification is bounded and refuses duplicate records or a helper that stays alive', async () => {
  const first = fakeChild(), world = timerWorld();
  const duplicate = new NativeCapture({helper: '/synthetic', ...world, launch: () => first.port}).qualifyClock();
  first.spawn(); first.output({schema: 'music-native-clock/1.0', monotonicMs: 1000}); first.output({schema: 'music-native-clock/1.0', monotonicMs: 1000}); first.exit(0);
  assert.equal(await duplicate, false);
  const second = fakeChild();
  const hung = new NativeCapture({helper: '/synthetic', ...world, launch: () => second.port}).qualifyClock();
  second.spawn(); world.advance(5500); assert.equal(await hung, false); assert.deepEqual(second.killed, ['SIGTERM', 'SIGKILL']);
});

void test('stderr is discarded and its byte bound terminates the helper with a sanitized result', async () => {
  const child = fakeChild(), world = timerWorld();
  const run = new NativeCapture({helper: '/synthetic', ...world, launch: () => child.port}).start(() => assert.fail('unexpected frame'));
  child.spawn(); child.port.stderr.push(Buffer.alloc(8193, 120)); child.exit(0);
  assert.deepEqual(await run.ended, {status: 'failed', error: {code: 'invalid-message', retryable: false}});
});
