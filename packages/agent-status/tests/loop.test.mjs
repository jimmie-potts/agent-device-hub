import assert from 'node:assert/strict';
import test from 'node:test';
import { EvaluationLoop, BoundedReader, systemTimers } from '../dist/index.js';

/** Deterministic timers on a fake monotonic clock. */
function fakeTimers(clock) {
  const pending = new Set();
  return {
    pending,
    setTimeout(callback, ms) { const timer = { at: clock.now + ms, callback }; pending.add(timer); return timer; },
    clearTimeout(timer) { pending.delete(timer); },
    fire() { for (const timer of [...pending]) { pending.delete(timer); timer.callback(); } },
  };
}

test('systemTimers wraps the real setTimeout/clearTimeout', async () => {
  let called = false;
  const handle = systemTimers.setTimeout(() => { called = true; }, 0);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(called, true);
  systemTimers.clearTimeout(handle); // no-op on an already-fired timer; must not throw
});

test('requests made while an evaluation runs coalesce into a single rerun', async () => {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  let calls = 0;
  let unblock;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const loop = new EvaluationLoop(async () => { calls++; if (calls === 1) await blocked; return 1000; }, timers);
  const first = loop.update();
  void loop.update(); // requested while the first evaluation is still pending
  void loop.update();
  unblock();
  await first;
  assert.equal(calls, 2, 'one rerun, not one per coalesced request');
});

test('stop cancels the scheduled timer and further updates resolve immediately', async () => {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  let calls = 0;
  const loop = new EvaluationLoop(async () => { calls++; return 1000; }, timers);
  await loop.update();
  assert.equal(timers.pending.size, 1);
  loop.stop();
  assert.equal(timers.pending.size, 0);
  assert.equal(loop.stopped, true);
  await loop.update();
  assert.equal(calls, 1, 'no further evaluation runs once stopped');
});

test('whenIdle resolves once no evaluation is running', async () => {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  const loop = new EvaluationLoop(async () => 1000, timers);
  await loop.whenIdle(); // nothing running yet
  const running = loop.update();
  await running;
  await loop.whenIdle();
});

test('a read that settles in time returns its value', async () => {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  const reader = new BoundedReader(() => 'value', 1000, timers);
  assert.equal(await reader.read(), 'value');
});

test('a read that throws returns undefined', async () => {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  const reader = new BoundedReader(() => { throw new Error('boom'); }, 1000, timers);
  assert.equal(await reader.read(), undefined);
});

test('a hung read times out, and no further read starts until it settles', async () => {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  let resolveHung;
  const hung = new Promise(resolve => { resolveHung = resolve; });
  let reads = 0;
  const reader = new BoundedReader(() => { reads++; return hung; }, 1000, timers);
  const first = reader.read();
  timers.fire();
  assert.equal(await first, undefined);
  assert.equal(await reader.read(), undefined, 'a read is still pending, so nothing new starts');
  resolveHung('late');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await reader.read(), 'late', 'once the hung read settles, a fresh read is allowed');
  assert.equal(reads, 2);
});
