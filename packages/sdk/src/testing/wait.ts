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
/** Poll a test observation on real time. The final value comes from the same read as the failed predicate. */
export async function waitForObservation<T>(read: () => T, ready: (value: T) => boolean, what: string, budget: Budget): Promise<T> {
  const deadline = performance.now() + budget.timeoutMs;
  for (;;) {
    const observed = read();
    if (ready(observed)) return observed;
    if (performance.now() > deadline) {
      const last = typeof observed === 'string' ? observed : inspect(observed, {depth: 2, maxArrayLength: 8, maxStringLength: 160});
      assert.fail(`timed out waiting for ${what} after ${budget.timeoutMs} ms; last observed: ${last}`);
    }
    await pause(budget.intervalMs);
  }
}
