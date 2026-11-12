// What the in-memory harness and a disposable run on virtual time share (Hub #1684, #1710): a clock and scheduler that
// move only when the harness advances them, and the hold that keeps virtual time still while a module's worker call
// runs in real time (Hub #1442). The run's child imports this file, so it imports nothing of the test runner's.
import type {BunnyModule, Scheduler, WorkerCallOptions} from '@jimmie-potts/sdk';

export const START = Date.parse('2026-10-06T12:00:00.000Z');

/** A clock and scheduler that move only when the test advances them. */
export function manualClock(start = START): {
  now: () => number; scheduler: Scheduler; advance: (ms: number) => void; pending: () => number; next: () => number | undefined;
} {
  let now = start;
  const timers = new Set<{at: number; callback: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const timer = {at: now + delayMs, callback};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: ms => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) break;
        if (timers.delete(timer)) timer.callback();
      }
    },
    pending: () => timers.size,
    /** When the earliest pending timer is due, or undefined with none pending. NaN while a timer due at NaN is pending. */
    next: () => {
      let earliest: number | undefined;
      for (const {at} of timers) {
        if (Number.isNaN(at)) return at;
        if (earliest === undefined || at < earliest) earliest = at;
      }
      return earliest;
    },
  };
}

/**
 * How long, in real time, virtual time waits for one module's worker call. A worker runs in real time but its deadline
 * is on virtual time, which runs several times faster, so a stalled runner could time out a worker that had done nothing
 * wrong (Hub #1442). A call still running after this long takes its chances: a worker that never answers reaches its deadline.
 */
export const WORKER_WAIT_MS = 10_000;

/** The module worker calls under way, each held until it ends or `waitMs` of real time passes. */
export class WorkerHold {
  readonly #working = new Set<Promise<void>>();
  readonly #waitMs: number;

  constructor(waitMs = WORKER_WAIT_MS) {
    this.#waitMs = waitMs;
  }

  /** How many worker calls virtual time still waits for. */
  get size(): number {
    return this.#working.size;
  }

  /** The module, handing each worker call it makes to this hold. */
  wrap(module: BunnyModule): BunnyModule {
    return {...module, start: context => module.start({...context, workers: {...context.workers, call: <Reply>(file: URL, request: unknown, options: WorkerCallOptions): Promise<Reply> => {
      const call = context.workers.call<Reply>(file, request, options);
      this.hold(call);
      // A promise of its own, so a rejection the module leaves unhandled stays unhandled, as it would in the runtime.
      return call.then(reply => reply);
    }}})};
  }

  /** Holds virtual time while `call` runs, for at most the hold's real bound. */
  hold(call: Promise<unknown>): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = Promise.race([call.then(() => {}, () => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, this.#waitMs); })]).then(() => {
      clearTimeout(timer);
      this.#working.delete(ended);
    });
    this.#working.add(ended);
  }

  /** Resolves once no worker call is held. */
  async idle(): Promise<void> {
    while (this.#working.size > 0) await Promise.race([...this.#working]);
  }
}
