// One clock for a whole dashboard world (Hub #1708): the runtime's clock and scheduler, the monotonic clocks the harness
// hands its modules, and every page the journey installs it on. Time moves only when the journey advances it, in the
// steps the in-memory scenario tier takes (Hub #1684), so every runtime timer fires at its virtual instant and in order.
// Before each step, time waits for the module worker calls in flight and gives the process's real work its turn, so a
// worker's or a file write's deadline never passes while it works in real time. The page's clock keeps running from the
// virtual time it was installed at, so its own liveness and retry timers still work; each advance moves it forward by the
// same amount first, so a page never stamps a request behind the runtime's clock.
import type {Clock, Scheduler} from '@jimmie-potts/sdk';
import type {Page} from 'playwright';
import {realWork, settle} from '../../dist/tests/scenarios/real-work.js';
import {stepThrough} from '../../dist/tests/scenarios/stepping.js';
import {manualClock} from '../../dist/tests/support.js';

/** The real work in flight in this process, such as a file write or a decode on the thread pool. */
const work = realWork();
/** The longest time holds, in real time, for one worker call from its start; a stalled call then takes its chances. */
export const WORKER_WAIT_MS = 10_000;

export type WorldClock = {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** Takes each module worker call the harness sees, so time waits for it. */
  working(call: Promise<unknown>): void;
  /** Fakes `page`'s clock from the world's current time; later advances move it too. */
  install(page: Page): Promise<void>;
  /** Moves every installed page, then the runtime, on by `ms`, and fires every timer due by then. */
  advance(ms: number): Promise<void>;
};

/**
 * A world clock that starts at `start`, the real time now unless given. `workerWaitMs` bounds each worker call once,
 * from when it starts, as the in-memory scenario tier does; a test of this clock sets it small.
 */
export function worldClock(start = Date.now(), {workerWaitMs = WORKER_WAIT_MS}: {workerWaitMs?: number} = {}): WorldClock {
  // Each entry settles when its call settles or its bound passes, whichever is first, and then leaves the set.
  const manual = manualClock(start), calls = new Set<Promise<void>>(), pages = new Set<Page>();
  const ready = async (): Promise<void> => { await Promise.all([...calls]); };
  const turn = (): Promise<void> => settle(work.busy);
  return {
    clock: {now: manual.now},
    scheduler: manual.scheduler,
    working: call => {
      let bound: ReturnType<typeof setTimeout> | undefined;
      const held: Promise<void> = Promise.race([call.then(() => {}, () => {}), new Promise<void>(resolve => {
        bound = setTimeout(resolve, workerWaitMs);
        bound.unref();
      })]).then(() => {
        clearTimeout(bound);
        calls.delete(held);
      });
      calls.add(held);
    },
    install: async page => {
      await page.clock.install({time: manual.now()});
      pages.add(page);
      page.once('close', () => { pages.delete(page); });
    },
    advance: async ms => {
      for (const page of pages) await page.clock.fastForward(ms);
      await stepThrough(manual, ms, ready, turn);
      // What a timer scheduled for now, during the last turn, does.
      await ready();
      manual.advance(0);
      await turn();
    },
  };
}
