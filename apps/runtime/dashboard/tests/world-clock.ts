// One clock for a whole dashboard world (Hub #1708): the runtime's clock and scheduler, the monotonic clocks the harness
// hands its modules, and every page the journey installs it on. Time moves only when the journey advances it, in the
// steps the in-memory scenario tier takes (Hub #1684), so every runtime timer fires at its virtual instant and in order.
// Before each step, time waits for the module worker calls in flight and gives the process's real work its turn, so a
// worker's or a file write's deadline never passes while it works in real time. Browser clocks normally keep running
// between advances. The paused option steps each browser context alongside the runtime for freshness-sensitive journeys.
import type {Clock, Scheduler} from '@jimmie-potts/sdk';
import type {BrowserContext, Page} from 'playwright';
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
  /** Holds time for finite work, such as a module worker call or a fixture publication. */
  working(call: Promise<unknown>): void;
  /** Fakes `page`'s clock from the world's current time; later advances move it too. */
  install(page: Page): Promise<void>;
  /** Moves the installed browser clocks and the runtime on by `ms`. */
  advance(ms: number): Promise<void>;
};

/**
 * A world clock that starts at `start`, the real time now unless given. `workerWaitMs` bounds each worker call once,
 * from when it starts, as the in-memory scenario tier does. With `paused`, browser time moves only with the runtime.
 */
export function worldClock(start = Date.now(), {workerWaitMs = WORKER_WAIT_MS, paused = false}: {workerWaitMs?: number; paused?: boolean} = {}): WorldClock {
  // Each entry settles when its call settles or its bound passes, whichever is first, and then leaves the set.
  const manual = manualClock(start), calls = new Set<Promise<void>>(), pages = new Set<Page>();
  const contexts = new Set<BrowserContext>();
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
      if (paused) {
        const context = page.context();
        if (contexts.has(context)) return;
        // Playwright clock changes apply to the context and carry over to its new documents.
        await context.clock.pauseAt(manual.now());
        contexts.add(context);
        context.once('close', () => { contexts.delete(context); });
        return;
      }
      await page.clock.install({time: manual.now()});
      pages.add(page);
      page.once('close', () => { pages.delete(page); });
    },
    advance: async ms => {
      for (const page of pages) await page.clock.fastForward(ms);
      let browserTime = manual.now();
      await stepThrough(manual, ms, ready, async () => {
        const step = manual.now() - browserTime;
        for (const context of contexts) await context.clock.runFor(step);
        browserTime = manual.now();
        await turn();
      });
      // What a timer scheduled for now, during the last turn, does.
      await ready();
      manual.advance(0);
      await turn();
    },
  };
}
