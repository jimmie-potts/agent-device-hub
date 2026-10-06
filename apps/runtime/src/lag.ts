// The watchdog's decision, kept apart from its thread so that it can be tested with chosen times.

/** What the watchdog remembers: the last beat count it saw, and since when, in its own monotonic milliseconds. */
export type LagState = {seen: number; since: number};

/**
 * One check, after a wait that was asked to last `intervalMs` and lasted `sleptMs`. Returns how long the main thread has
 * gone without a beat while the watchdog was awake. A wait that overran means the watchdog itself did not run: the whole
 * process was paused, as when it is stopped or its VM sleeps, or starved. That time is not counted, because the main
 * thread could not beat either; a stuck main thread is still caught once the watchdog has been awake for the limit.
 */
export function observe(state: LagState, beats: number, now: number, sleptMs: number, intervalMs: number): number {
  const overrun = sleptMs - intervalMs;
  if (overrun > 0) state.since += overrun;
  if (beats !== state.seen) {
    state.seen = beats;
    state.since = now;
  }
  return now - state.since;
}
