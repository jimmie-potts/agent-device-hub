// How the in-memory harness moves virtual time through a wait (Hub #1684). Each step gives real I/O a turn, which costs
// real time (a pause while real work is in flight, Hub #1685), so a long wait skips the steps at which no timer is due, while every timer still fires at the virtual
// instant, and in the order, that one fine step at a time gives.

/** How far virtual time moves before real I/O, such as the edge's HTTP, gets to run. */
export const STEP_MS = 10;
/** A wait longer than this skips the steps at which no timer is due. Shorter waits, such as polls, take every step. */
export const LONG_WAIT_MS = 1000;
/** The most one step of a long wait advances, so real work still gets a turn at least this often in virtual time. */
export const LONG_STEP_MS = 100;

/** The clock a wait advances: its time, when its earliest pending timer is due, and a move that fires the timers due. */
export type SteppedClock = {now: () => number; next: () => number | undefined; advance: (ms: number) => void};

/**
 * How far the next step moves, `elapsed` into a wait of `ms`, when the earliest pending timer is due `dueIn` after the
 * wait began (undefined with none pending). Steps fall on a grid of `STEP_MS` from the wait's start, and a timer fires at
 * the first grid point at or after it is due. A short wait stops at every grid point. A long wait stops only at the point
 * where the next timer fires, at most `LONG_STEP_MS` on, and at its end. A timer due at infinity never fires, so it
 * counts as none. Any other due time that is not a finite number, such as one from a NaN delay, counts as due now, so
 * the wait takes one fine step, as one fine step at a time would.
 */
export function stepOf(elapsed: number, ms: number, dueIn: number | undefined): number {
  const remaining = ms - elapsed;
  if (ms <= LONG_WAIT_MS) return Math.min(STEP_MS, remaining);
  if (dueIn === undefined || dueIn === Number.POSITIVE_INFINITY) return Math.min(LONG_STEP_MS, remaining);
  if (!Number.isFinite(dueIn)) return Math.min(STEP_MS, remaining);
  const fires = Math.max(STEP_MS, Math.ceil((dueIn - elapsed) / STEP_MS) * STEP_MS);
  return Math.min(LONG_STEP_MS, fires, remaining);
}

/**
 * Moves `clock` on by `ms` of virtual time in steps. Before each step `ready` runs, and after each step, which fires the
 * timers due by then, `turn` gives real work its turn. A timer that `ready` or `turn` schedules counts from then on.
 */
export async function stepThrough(clock: SteppedClock, ms: number, ready: () => Promise<void>, turn: () => Promise<void>): Promise<void> {
  const start = clock.now();
  for (let elapsed = 0; elapsed < ms;) {
    await ready();
    const due = clock.next();
    const step = stepOf(elapsed, ms, due === undefined ? undefined : due - start);
    clock.advance(step);
    elapsed += step;
    await turn();
  }
}
