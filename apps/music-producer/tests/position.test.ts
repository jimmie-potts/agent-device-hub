import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MusicPositionReader} from '../src/position.js';
import {fakeChild, timerWorld, flush} from './support.js';

const sample = (instance = 'a'.repeat(64)) => ({schema: 'music-position-read/1.0', status: 'sample', sourceInstance: instance,
  interval: {startedMonotonicMs: 1001, endedMonotonicMs: 1040},
  state: {value: 'playing', interval: {startedMonotonicMs: 1010, endedMonotonicMs: 1020}},
  position: {status: 'observed', seconds: 12.5, interval: {startedMonotonicMs: 1021, endedMonotonicMs: 1030}}});
function setup() {
  const world = timerWorld(), children: ReturnType<typeof fakeChild>[] = [];
  const reader = new MusicPositionReader({helper: '/unused', now: () => world.clock().monotonicMs, scheduler: world.scheduler,
    launch: () => {const child = fakeChild(); children.push(child); return child.port;}});
  const child = () => {const value = children.at(-1); assert.ok(value); return value;};
  return {reader, world, children, child};
}
void test('construction launches nothing, each explicit read waits for exit and assigns process epochs', async () => {
  const {reader, world, children, child} = setup(); assert.equal(children.length, 0);
  const first = reader.read(); assert.equal(children.length, 1); child().spawn(); world.advance(50); child().output(sample());
  let settled = false; void first.then(() => {settled = true;}); await flush(); assert.equal(settled, false);
  child().exit(0); const a = await first; assert.equal(a.status, 'sample');
  const second = reader.read(); child().spawn(); const next = sample();
  next.interval = {startedMonotonicMs: 1051, endedMonotonicMs: 1090};
  next.state.interval = {startedMonotonicMs: 1060, endedMonotonicMs: 1070}; next.position.interval = {startedMonotonicMs: 1071, endedMonotonicMs: 1080};
  world.advance(50); child().output(next); child().exit(0); const b = await second;
  assert.ok(a.status === 'sample' && b.status === 'sample'); assert.equal(a.sourceEpoch, b.sourceEpoch); assert.equal(b.sequence, 2);
  const third = reader.read(); child().spawn();
  for (const interval of [next.interval, next.state.interval, next.position.interval]) {interval.startedMonotonicMs += 50; interval.endedMonotonicMs += 50;}
  world.advance(50); child().output({...next, sourceInstance: 'b'.repeat(64)}); child().exit(0); const c = await third;
  assert.equal(c.status, 'sample'); if (c.status === 'sample') assert.notEqual(c.sourceEpoch, a.sourceEpoch);
});
void test('deadline retains child ownership, fences late data and never retries', async () => {
  const {reader, world, children, child} = setup(); const read = reader.read(); child().spawn();
  const overlapping = await reader.read(); assert.equal(overlapping.status, 'unavailable'); assert.equal(children.length, 1);
  world.advance(5000); assert.deepEqual(child().killed, ['SIGTERM']); child().output(sample('b'.repeat(64)));
  world.advance(1500); const result = await read;
  assert.ok(result.status === 'unavailable'); assert.equal(result.error.code, 'uncertain-result');
  await reader.read(); assert.equal(children.length, 1); assert.deepEqual(child().killed, ['SIGTERM', 'SIGKILL']);
  child().exit(null, 'SIGKILL'); const after = reader.read(); assert.equal(children.length, 2);
  child().spawn(); child().exit(1); await after;
});
void test('cancellation fences output and resolves only after exit or bounded uncertainty', async () => {
  const {reader, child} = setup(); const controller = new AbortController();
  const read = reader.read({signal: controller.signal}); child().spawn(); controller.abort(); child().output(sample()); child().exit(0);
  const result = await read; assert.ok(result.status === 'unavailable'); assert.equal(result.error.code, 'cancelled');
});
void test('pre-cancelled reads and launch failures return fixed errors without retries', async () => {
  const {reader, children, child} = setup(); const signal = AbortSignal.abort();
  const cancelled = await reader.read({signal}); assert.ok(cancelled.status === 'unavailable'); assert.equal(cancelled.error.code, 'cancelled');
  assert.equal(children.length, 0);
  const failed = reader.read(); child().error(); const result = await failed;
  assert.ok(result.status === 'unavailable'); assert.equal(result.error.code, 'unavailable');
  const after = reader.read(); assert.equal(children.length, 2); child().error(); await after;
});
void test('native unavailability preserves only its registered error after a confirmed failure exit', async () => {
  const {reader, world, child} = setup(); const read = reader.read(); child().spawn(); world.advance(50);
  child().output({schema: 'music-position-read/1.0', status: 'unavailable', interval: {startedMonotonicMs: 1001, endedMonotonicMs: 1040},
    error: {code: 'forbidden', retryable: false, detail: 'Music automation permission is unavailable without prompting.'}});
  child().exit(1); const result = await read; assert.ok(result.status === 'unavailable'); assert.equal(result.error.code, 'forbidden');
});
void test('delayed timers cannot admit a record or clean exit after the whole-read deadline', async () => {
  for (const mode of ['late-receive', 'late-exit']) {
    let now = 1000; const child = fakeChild();
    const reader = new MusicPositionReader({helper: '/unused', launch: () => child.port, now: () => now,
      scheduler: {after: () => () => {}}});
    const read = reader.read(); child.spawn(); now = mode === 'late-receive' ? 7000 : 1050;
    child.output(sample()); now = 7000; child.exit(0);
    const result = await read; assert.ok(result.status === 'unavailable', mode); assert.equal(result.error.code, 'unavailable');
  }
});
void test('rejects malformed, duplicated, excessive, future and nonzero-exit observations', async () => {
  for (const mode of ['malformed', 'duplicated', 'excessive', 'future', 'nonzero', 'unterminated', 'stderr']) {
    const {reader, world, child} = setup(); const read = reader.read(); child().spawn();
    if (mode !== 'future') world.advance(50);
    if (mode === 'malformed') child().raw('{}\n');
    else if (mode === 'excessive') child().raw('x'.repeat(4097));
    else if (mode === 'unterminated') child().raw(JSON.stringify(sample()));
    else {child().output(sample()); if (mode === 'duplicated') child().output(sample());}
    if (mode === 'stderr') child().port.stderr.emit('data', Buffer.alloc(4097));
    child().exit(mode === 'nonzero' ? 1 : 0); const result = await read;
    assert.equal(result.status, 'unavailable', mode);
  }
});
