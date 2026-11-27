import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {inspect} from 'node:util';

/** Existing real-I/O budgets (#2061). On 564f1ef3, the MicroDuck module suite's 29
 * waits took at most 956 ms; the Pixoo long-playback suite's ten waits took at most 270 ms.
 * These local observations retain the previous limits for slower hosted runners.
 */
export const moduleWaitBudgets = {
  microduck: {timeoutMs: 4000, intervalMs: 5},
  pixoo: {timeoutMs: 5000, intervalMs: 5},
} as const;

type Budget = {readonly timeoutMs: number; readonly intervalMs: number};

export function waitForObservation<T, S extends T>(read: () => T, ready: (value: T) => value is S, what: string, budget: Budget): Promise<S>;
export function waitForObservation<T>(read: () => T, ready: (value: T) => boolean, what: string, budget: Budget): Promise<T>;
/** Always take one immediate sample, then poll on real time while the budget permits another read. */
export async function waitForObservation<T>(read: () => T, ready: (value: T) => boolean, what: string, budget: Budget): Promise<T> {
  const {timeoutMs, intervalMs} = budget;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError('Wait timeout and polling interval must be finite, non-negative milliseconds');
  }
  const started = performance.now();
  const deadline = started + timeoutMs;
  let observed = read();
  while (!ready(observed)) {
    const remaining = deadline - performance.now();
    if (remaining > 0) {
      await pause(Math.min(intervalMs, remaining));
      if (performance.now() <= deadline) {
        observed = read();
        continue;
      }
    }
    const last = typeof observed === 'string' ? observed : inspect(observed, {depth: 2, maxArrayLength: 8, maxStringLength: 160});
    const elapsed = Math.round(performance.now() - started);
    assert.fail(`timed out waiting for ${what} after ${elapsed} ms (budget ${timeoutMs} ms); last observed: ${last}`);
  }
  return observed;
}
