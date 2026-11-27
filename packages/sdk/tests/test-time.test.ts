import assert from 'node:assert/strict';
import {test} from 'node:test';
import {manualClock, waitForObservation} from '../src/testing/index.js';

void test('a timeout names the condition, the budget and the final observation', async () => {
  await assert.rejects(waitForObservation(() => 'syncing', value => value === 'ready',
    'fixture records', {timeoutMs: 0, intervalMs: 0}), /fixture records after 0 ms; last observed: syncing/);
  await assert.rejects(waitForObservation(() => ({workers: 3}), value => value.workers === 0,
    'worker drain', {timeoutMs: 0, intervalMs: 0}), /last observed: .*workers: 3/);
  const failure = new Error('read failed');
  await assert.rejects(waitForObservation(() => { throw failure; }, () => true,
    'fixture records', {timeoutMs: 0, intervalMs: 0}), error => error === failure);
  assert.equal(await waitForObservation(() => 0, value => value === 0,
    'empty queue', {timeoutMs: 0, intervalMs: 0}), 0);
});

void test('advancing a turn fires its original due timers at the end of the turn', () => {
  const clock = manualClock(100);
  const order: number[] = [];
  clock.scheduler.after(3, () => {
    order.push(clock.now());
    clock.scheduler.after(0, () => { order.push(clock.now()); });
  });
  const cancel = clock.scheduler.after(3, () => { assert.fail('cancelled timer ran'); });
  cancel();
  clock.advance(8);
  assert.deepEqual(order, [108]);
  assert.equal(clock.next(), 108);
  clock.advance(0);
  assert.deepEqual(order, [108, 108]);
});

void test('individual timers preserve their deadlines, cancellation and order between turns', () => {
  const clock = manualClock(10);
  const calls: string[] = [];
  clock.scheduler.after(4, () => {
    calls.push('first');
    clock.scheduler.after(0, () => { calls.push('new'); });
  });
  const cancel = clock.scheduler.after(4, () => { calls.push('cancelled'); });
  clock.scheduler.after(4, () => { calls.push('second'); });
  assert.equal(clock.stepToNextTimer(13), false);
  assert.equal(clock.stepToNextTimer(20), true);
  assert.deepEqual(calls, ['first']);
  assert.equal(clock.now(), 14);
  cancel();
  assert.equal(clock.stepToNextTimer(20), true);
  assert.equal(clock.stepToNextTimer(20), true);
  assert.equal(clock.stepToNextTimer(20), false);
  assert.deepEqual(calls, ['first', 'second', 'new']);
  assert.equal(clock.pending(), 0);
  assert.equal(clock.now(), 20);
});

void test('a slow callback can make another timer due while timers still arm against loop time', () => {
  const loop = manualClock(0);
  let observed = 5;
  const calls: string[] = [];
  loop.scheduler.after(5, () => {
    observed += 10;
    loop.scheduler.after(20, () => { calls.push('later'); });
  });
  loop.scheduler.after(12, () => { calls.push('due during stall'); });
  loop.advance(5, () => observed);
  assert.deepEqual(calls, ['due during stall']);
  assert.equal(loop.now(), 5);
  assert.equal(loop.next(), 25);
});
