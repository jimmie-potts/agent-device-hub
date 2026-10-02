import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkloadSchedule } from '../workload-schedule.mjs';

test('monotonic slots retain omissions after a stalled driver without catch-up dispatches', () => {
  const schedule = createWorkloadSchedule({ startMs: 1000 });
  assert.deepEqual(schedule.advance(1000, 0), [{ kind: 'dispatch', slot: 0, phase: 'warmup', scheduledMs: 1000, dispatchMs: 1000, lagMs: 0 }]);
  assert.deepEqual(schedule.advance(1049, 0), []);
  const resumed = schedule.advance(1210, 0);
  assert.deepEqual(resumed.map(row => [row.kind, row.slot, row.reason]), [
    ['omitted', 1, 'driver-lag'], ['omitted', 2, 'driver-lag'], ['omitted', 3, 'driver-lag'], ['dispatch', 4, undefined],
  ]);
  assert.equal(resumed.at(-1).lagMs, 10);
  assert.deepEqual(schedule.advance(1210, 0), []);
  assert.throws(() => schedule.advance(1209, 0), /monotonic/);
});

test('capacity omissions are never retried and phase boundaries use scheduled time', () => {
  const schedule = createWorkloadSchedule({ startMs: 0 });
  assert.deepEqual(schedule.advance(0, 8), [{ kind: 'omitted', slot: 0, phase: 'warmup', scheduledMs: 0, observedMs: 0, reason: 'concurrency' }]);
  assert.deepEqual(schedule.advance(1, 0), []);
  const rows = schedule.advance(30000, 0);
  assert.equal(rows.at(-1).slot, 600); assert.equal(rows.at(-1).phase, 'measurement');
  const finish = schedule.advance(90000, 0);
  assert.equal(finish.filter(row => row.kind === 'dispatch').length, 0);
  assert.equal(finish.at(-1).slot, 1799);
  assert.equal(schedule.complete, true);
  assert.deepEqual(schedule.advance(91000, 0), []);
});

test('invalid timing and capacity cannot create a schedule or advance its cursor', () => {
  for (const startMs of [-1, NaN, Infinity, '0']) assert.throws(() => createWorkloadSchedule({ startMs }));
  const schedule = createWorkloadSchedule({ startMs: 0 });
  for (const capacity of [-1, 9, 1.1, NaN]) assert.throws(() => schedule.advance(0, capacity));
  assert.equal(schedule.advance(0, 0)[0].slot, 0);
});
