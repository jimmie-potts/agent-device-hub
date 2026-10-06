// The watchdog's decision: a main thread that stops beating is stuck, but a pause of the whole process is not.
import assert from 'node:assert/strict';
import {observe, type LagState} from '../src/lag.js';
import {it} from './support.js';

const INTERVAL = 250;

/** Runs checks of `INTERVAL` each, with the beats the main thread had counted by then and how long each wait lasted. */
function run(checks: readonly {beats: number; sleptMs?: number}[]): number[] {
  const state: LagState = {seen: 0, since: 0};
  let now = 0;
  return checks.map(({beats, sleptMs = INTERVAL}) => {
    now += sleptMs;
    return observe(state, beats, now, sleptMs, INTERVAL);
  });
}

it('a main thread that keeps beating is never stuck', () => {
  assert.deepEqual(run([{beats: 1}, {beats: 2}, {beats: 3}, {beats: 4}]), [0, 0, 0, 0]);
});

it('a main thread that stops beating is stuck for as long as the beats stay the same', () => {
  assert.deepEqual(run([{beats: 1}, {beats: 1}, {beats: 1}, {beats: 1}, {beats: 1}]), [0, 250, 500, 750, 1000]);
});

it('a pause of the whole process, which stops the watchdog too, does not count as the main thread being stuck', () => {
  // The process is stopped for 3 s, then continued; the watchdog checks before the main thread's overdue beat.
  const lags = run([{beats: 1}, {beats: 1, sleptMs: 3250}, {beats: 1}, {beats: 2}]);
  assert.deepEqual(lags, [0, 250, 500, 0], 'only the time the watchdog was awake counts');
});

it('a main thread stuck through a pause is still caught once the watchdog has been awake long enough', () => {
  const lags = run([{beats: 1}, {beats: 1}, {beats: 1, sleptMs: 10_250}, {beats: 1}, {beats: 1}]);
  assert.deepEqual(lags, [0, 250, 500, 750, 1000]);
});
