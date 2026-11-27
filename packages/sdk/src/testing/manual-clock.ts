import type {Scheduler} from '../sdk.js';

/** A clock and scheduler that move only when the test advances them. */
export function manualClock(start: number): {
  now: () => number;
  scheduler: Scheduler;
  advance: (ms: number, dueBy?: () => number) => void;
  pending: () => number;
  next: () => number | undefined;
  stepToNextTimer: (end: number) => boolean;
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
    // A fixture may model a synchronous stall inside a callback. Its clock for
    // deciding what is due can then move ahead of the time used to arm timers.
    advance: (ms, dueBy = () => now) => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > dueBy()) break;
        if (timers.delete(timer)) timer.callback();
      }
    },
    // Move to the earliest timer through end, or to end itself when there is none.
    // Equal deadlines keep their insertion order. The caller can settle I/O between callbacks.
    stepToNextTimer: end => {
      let due: {at: number; callback: () => void} | undefined;
      for (const timer of timers) {
        if (timer.at <= end && (due === undefined || timer.at < due.at)) due = timer;
      }
      if (due === undefined) {
        now = end;
        return false;
      }
      timers.delete(due);
      now = due.at;
      due.callback();
      return true;
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
