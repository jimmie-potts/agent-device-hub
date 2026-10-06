// The watchdog's decision, kept apart from its thread so that it can be tested with chosen times.

/** What the watchdog remembers: the last beat count it saw, and since when, in its own monotonic milliseconds. */
export type LagState = {seen: number; since: number};

/**
 * One check, after a wait that was asked to last `intervalMs` and lasted `sleptMs`. Returns how long the main thread has
 * gone without a beat.
 */
export function observe(state: LagState, beats: number, now: number, _sleptMs: number, _intervalMs: number): number {
  if (beats !== state.seen) {
    state.seen = beats;
    state.since = now;
  }
  return now - state.since;
}
