// The dashboard world clock's hold on worker calls (Hub #1708): time waits for a call that is running, and a call that
// never settles costs at most its one bound, however many steps an advance takes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {worldClock} from './world-clock.ts';

void test('a never-settling worker call holds a multi-step advance for one bound, not one per step', async () => {
  const clock = worldClock(0, {workerWaitMs: 100});
  clock.working(new Promise<never>(() => {}));
  const started = performance.now();
  // A 2 s advance takes about twenty steps; a bound per step would hold it for about 2 s of real time.
  await clock.advance(2000);
  const elapsed = performance.now() - started;
  assert.equal(clock.clock.now(), 2000);
  assert.ok(elapsed < 1000, `the advance took ${Math.round(elapsed)} ms of real time`);
});

void test('time waits for a running worker call before it fires a timer', async () => {
  const clock = worldClock(0, {workerWaitMs: 5000});
  const order: string[] = [];
  clock.scheduler.after(10, () => { order.push('timer'); });
  clock.working(new Promise<void>(resolve => { setTimeout(() => { order.push('call'); resolve(); }, 30); }));
  await clock.advance(100);
  assert.deepEqual(order, ['call', 'timer']);
});
