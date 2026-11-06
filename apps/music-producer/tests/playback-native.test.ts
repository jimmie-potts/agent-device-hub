import assert from 'node:assert/strict';
import test from 'node:test';
import {MusicPlaybackNative, type PlaybackNativeRequest} from '../src/playback-native.js';
import {fakeChild, flush, timerWorld} from './support.js';
import {interval, playbackSample, sourceInstance} from './playback-fixtures.js';

function fixture() {
  const time = timerWorld(), children: ReturnType<typeof fakeChild>[] = [], requests: PlaybackNativeRequest[] = [];
  const native = new MusicPlaybackNative({helper: '/synthetic', clock: time.clock, scheduler: time.scheduler, launch: request => {
    const child = fakeChild(); requests.push(request); children.push(child); return child.port;
  }});
  return {...time, native, children, requests, child() {const child = children.at(-1); assert.ok(child); return child;}};
}
void test('native playback construction is inert and explicit reads wait for validated output and exit', async () => {
  const world = fixture(); assert.deepEqual(world.requests, []);
  const result = world.native.read(); const child = world.child(); child.spawn(); world.advance(50);
  const text = JSON.stringify(playbackSample()); child.raw(text.slice(0, 30)); child.raw(text.slice(30) + '\n'); child.exit(0);
  assert.deepEqual(await result, {status: 'record', record: playbackSample(), cleanup: 'confirmed'});
  assert.equal(world.requests.length, 1); await world.native.close();
});
void test('native playback clock checks only the harmless mode and parent bracket', async () => {
  const world = fixture(); const pending = world.native.qualifyClock(); world.child().spawn();
  world.child().output({schema: 'music-playback-clock/1.0', monotonicMs: 1000}); world.child().exit(0);
  assert.equal(await pending, true); assert.deepEqual(world.requests, [{mode: 'clock'}]); await world.native.close();
});
void test('unknown native exit retains ownership, refuses a second child and reports cleanup uncertainty', async () => {
  const world = fixture(), abort = new AbortController(); const pending = world.native.read({signal: abort.signal});
  const child = world.child(); child.spawn(); abort.abort(); world.advance(1500); await flush();
  const result = await pending; assert.equal(result.status, 'failure'); assert.equal(result.cleanup, 'uncertain');
  const second = await world.native.read(); assert.equal(second.status, 'failure'); assert.equal(world.requests.length, 1);
  assert.equal((await world.native.close()).status, 'uncertain'); child.exit(null, 'SIGKILL');
});
void test('late valid control reply preserves transmission evidence independently of unknown cleanup', async () => {
  const world = fixture(); const pending = world.native.control({action: 'pause', expectedSourceInstance: sourceInstance, deadlineMonotonicMs: 4000});
  const child = world.child(); child.spawn(); world.advance(3000);
  const record = {schema: 'music-playback-control/1.0', action: 'pause', expectedSourceInstance: sourceInstance,
    interval: interval(1000, 4100), sendInterval: interval(1100, 4100), status: 'sent'};
  world.advance(100); child.output(record); world.advance(1400); await flush();
  assert.deepEqual(await pending, {status: 'record', record, cleanup: 'uncertain'});
  assert.equal((await world.native.close()).status, 'uncertain'); child.exit(null, 'SIGKILL');
});
void test('a control cannot adopt another process result or begin after its deadline', async () => {
  const world = fixture(); const expired = await world.native.control({action: 'play', expectedSourceInstance: sourceInstance, deadlineMonotonicMs: 1000});
  assert.equal(expired.status, 'failure'); assert.deepEqual(world.requests, []);
  const pending = world.native.control({action: 'pause', expectedSourceInstance: sourceInstance, deadlineMonotonicMs: 4000});
  const child = world.child(); child.spawn(); world.advance(10);
  child.output({schema: 'music-playback-control/1.0', action: 'pause', expectedSourceInstance: 'b'.repeat(64),
    interval: interval(1000, 1010), sendInterval: interval(1001, 1010), status: 'sent'}); child.exit(1);
  const result = await pending; assert.equal(result.status, 'failure');
  if (result.status === 'failure') assert.equal(result.mayHaveSent, true); await world.native.close();
});
