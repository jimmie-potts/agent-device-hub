// Sessions are derived when they are read, never stored (Hub #614): heater-on stretches separated by less than the gap
// threshold form one session, so changing the threshold regroups all history and rewrites nothing. A session is heater
// activity. It is not consumption, dose or inhalation, and a pump run is not a filled balloon.
//
// Nothing here invents a time. A stretch first seen on starts `startedBeforeObservation` at the time it was first seen. A
// stretch last seen on before an unobserved interval has no end time, only the time it was last seen on and the first time
// it was seen off. An unobserved interval with the heater on at both edges stays inside its stretch and creates no
// boundary, whatever its length; the counter's gain across it is credited in whole minutes, separately from observed time.
import type {Fact} from './facts.js';

export const MAX_STRETCHES = 32;
export const MAX_UNOBSERVED = 8;

export type Unobserved = {fromMs: number; toMs: number; creditedMinutes: number | null};
export type Stretch = {
  startAtMs: number; startedBeforeObservation: boolean;
  /** When the heater was seen going off, or null. */
  endAtMs: number | null;
  /** The first time the heater was seen off after an unobserved interval, or null. */
  endedUnobservedBy: number | null;
  lastObservedOnAtMs: number;
  /** No evidence of an end yet: the heater was last seen on, whether or not it is observed now. */
  open: boolean;
  observedHeatingMs: number; creditedMinutes: number; pumpRuns: number;
  unobserved: Unobserved[]; omittedUnobserved: number;
};
export type Session = {
  startAtMs: number; startedBeforeObservation: boolean; endAtMs: number | null; endedUnobservedBy: number | null; lastObservedOnAtMs: number; open: boolean;
  observedHeatingMs: number; creditedMinutes: number; pumpRuns: number; discontinuities: number;
  stretches: Stretch[]; omittedStretches: number;
};
/** One heater-off interval between two stretches. It is `uncertain` when either of its edges was not seen as it happened. */
export type Separation = {ms: number; uncertain: boolean};
/** What a read needs of all history, before any threshold applies. */
export type Derived = {
  stretches: readonly DerivedStretch[];
  separations: readonly Separation[];
  /** The counter's gain over unobserved intervals, each at the time it was found. */
  credits: readonly {atMs: number; minutes: number}[];
  pumpRunsAtMs: readonly number[];
};
export type DerivedStretch = Stretch & {discontinuities: number; segments: readonly {fromMs: number; toMs: number}[]};

type Open = {stretch: DerivedStretch; segmentFromMs: number};

const lastEdge = (stretch: Stretch): number => stretch.endAtMs ?? stretch.endedUnobservedBy ?? stretch.lastObservedOnAtMs;

/**
 * Walks the structural facts in stored order. `observedThroughMs` is the module's last reading, which bounds a stretch with
 * no end evidence yet.
 */
export function derive(facts: Iterable<Fact>, observedThroughMs: number | null): Derived {
  const stretches: DerivedStretch[] = [], credits: {atMs: number; minutes: number}[] = [], pumpRunsAtMs: number[] = [];
  let open: Open | undefined;
  let pendingDiscontinuities = 0;
  const segment = (current: Open, toMs: number): void => {
    if (toMs <= current.segmentFromMs) return;
    current.stretch.observedHeatingMs += toMs - current.segmentFromMs;
    (current.stretch.segments as {fromMs: number; toMs: number}[]).push({fromMs: current.segmentFromMs, toMs});
  };
  for (const fact of facts) {
    switch (fact.kind) {
      case 'heater':
        if (fact.on) {
          // An open stretch never meets another `on`: an identity or clock discontinuity closes it, and off closes it.
          if (open !== undefined) break;
          const firstSeen = fact.edge !== 'observed';
          open = {
            segmentFromMs: fact.observedAtMs,
            stretch: {
              startAtMs: fact.observedAtMs, startedBeforeObservation: firstSeen, endAtMs: null, endedUnobservedBy: null, lastObservedOnAtMs: fact.observedAtMs, open: true,
              observedHeatingMs: 0, creditedMinutes: 0, pumpRuns: 0, unobserved: [], omittedUnobserved: 0, discontinuities: pendingDiscontinuities, segments: [],
            },
          };
          pendingDiscontinuities = 0;
          stretches.push(open.stretch);
        } else if (open !== undefined) {
          const {stretch} = open;
          stretch.open = false;
          if (fact.edge === 'observed') {
            segment(open, fact.observedAtMs);
            stretch.endAtMs = fact.observedAtMs;
            stretch.lastObservedOnAtMs = fact.observedAtMs;
          } else {
            stretch.endedUnobservedBy = fact.observedAtMs;
          }
          open = undefined;
        }
        break;
      case 'gap':
        if (fact.creditedMinutes !== null && fact.creditedMinutes > 0) credits.push({atMs: fact.toMs, minutes: fact.creditedMinutes});
        if (open !== undefined) {
          const {stretch} = open;
          segment(open, fact.fromMs);
          open.segmentFromMs = fact.toMs;
          stretch.lastObservedOnAtMs = fact.fromMs;
          stretch.creditedMinutes += fact.creditedMinutes ?? 0;
          if (stretch.unobserved.length < MAX_UNOBSERVED) stretch.unobserved.push({fromMs: fact.fromMs, toMs: fact.toMs, creditedMinutes: fact.creditedMinutes});
          else stretch.omittedUnobserved += 1;
        }
        break;
      case 'pump':
        if (fact.on) {
          pumpRunsAtMs.push(fact.observedAtMs);
          if (open !== undefined) open.stretch.pumpRuns += 1;
        }
        break;
      case 'discontinuity':
        if (open !== undefined) open.stretch.discontinuities += 1;
        else pendingDiscontinuities += 1;
        // A different device or a stepped clock says nothing about the heater: what was open ends with no end time.
        if (open !== undefined && (fact.reason === 'identity-mismatch' || fact.reason === 'clock-step')) {
          const through = fact.lastReadingAtMs ?? open.stretch.lastObservedOnAtMs;
          segment(open, through);
          open.stretch.lastObservedOnAtMs = Math.max(open.stretch.lastObservedOnAtMs, through);
          open.stretch.open = false;
          open = undefined;
        }
        break;
      case 'setpoint': case 'temperature': case 'counter': case 'link': case 'collector-restart':
        break;
    }
  }
  if (open !== undefined && observedThroughMs !== null) {
    segment(open, observedThroughMs);
    open.stretch.lastObservedOnAtMs = Math.max(open.stretch.lastObservedOnAtMs, observedThroughMs);
  }
  const separations: Separation[] = [];
  for (let index = 1; index < stretches.length; index += 1) {
    const before = stretches[index - 1] as DerivedStretch, after = stretches[index] as DerivedStretch;
    const ms = after.startAtMs - lastEdge(before);
    if (ms >= 0) separations.push({ms, uncertain: before.endAtMs === null || after.startedBeforeObservation});
  }
  return {stretches, separations, credits, pumpRunsAtMs};
}

const copy = ({startAtMs, startedBeforeObservation, endAtMs, endedUnobservedBy, lastObservedOnAtMs, open, observedHeatingMs, creditedMinutes, pumpRuns, unobserved, omittedUnobserved}: DerivedStretch): Stretch =>
  ({startAtMs, startedBeforeObservation, endAtMs, endedUnobservedBy, lastObservedOnAtMs, open, observedHeatingMs, creditedMinutes, pumpRuns, unobserved, omittedUnobserved});

/** All sessions, oldest first: stretches join while the time between them is less than `gapMinutes`. */
export function groupSessions(derived: Derived, gapMinutes: number): Session[] {
  const gapMs = gapMinutes * 60_000;
  const sessions: Session[] = [];
  let last: DerivedStretch | undefined;
  let current: Session | undefined;
  for (const stretch of derived.stretches) {
    const separation = last === undefined ? undefined : stretch.startAtMs - lastEdge(last);
    if (current === undefined || separation === undefined || separation < 0 || separation >= gapMs) {
      current = {
        startAtMs: stretch.startAtMs, startedBeforeObservation: stretch.startedBeforeObservation, endAtMs: null, endedUnobservedBy: null, lastObservedOnAtMs: stretch.lastObservedOnAtMs,
        open: false, observedHeatingMs: 0, creditedMinutes: 0, pumpRuns: 0, discontinuities: 0, stretches: [], omittedStretches: 0,
      };
      sessions.push(current);
    }
    current.endAtMs = stretch.endAtMs;
    current.endedUnobservedBy = stretch.endedUnobservedBy;
    current.lastObservedOnAtMs = stretch.lastObservedOnAtMs;
    current.open = stretch.open;
    current.observedHeatingMs += stretch.observedHeatingMs;
    current.creditedMinutes += stretch.creditedMinutes;
    current.pumpRuns += stretch.pumpRuns;
    current.discontinuities += stretch.discontinuities;
    if (current.stretches.length < MAX_STRETCHES) current.stretches.push(copy(stretch));
    else current.omittedStretches += 1;
    last = stretch;
  }
  return sessions;
}

/** The buckets of the separations between stretches, for choosing a threshold: `toMinutes` is exclusive, and null is unbounded. */
export const GAP_BUCKETS: readonly (readonly [number, number | null])[] = [[0, 1], [1, 2], [2, 5], [5, 10], [10, 15], [15, 20], [20, 30], [30, 60], [60, 120], [120, 240], [240, 1440], [1440, null]];

export function gapDistribution(derived: Derived): {fromMinutes: number; toMinutes: number | null; count: number; uncertain: number}[] {
  return GAP_BUCKETS.map(([fromMinutes, toMinutes]) => {
    const inside = derived.separations.filter(({ms}) => ms >= fromMinutes * 60_000 && (toMinutes === null || ms < toMinutes * 60_000));
    return {fromMinutes, toMinutes, count: inside.length, uncertain: inside.filter(({uncertain}) => uncertain).length};
  });
}

export type DayTotal = {date: string; observedHeatingMs: number; creditedMinutes: number; stretches: number; sessions: number; pumpRuns: number};

/** A function from an instant to its calendar date in `zone`, which throws for an unknown zone. */
export function dayIn(zone: string): (atMs: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'});
  return atMs => format.format(atMs);
}

/** The first instant after `fromMs` and at most `toMs` that falls on another date than `fromMs`. */
function nextDay(day: (atMs: number) => string, fromMs: number, toMs: number): number {
  const date = day(fromMs);
  let low = fromMs, high = toMs;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (day(middle) === date) low = middle;
    else high = middle;
  }
  return high;
}

/** Daily totals in `zone`, newest first. Observed time splits at local midnight; a credit lands on the day it was found. */
export function dailyTotals(derived: Derived, sessions: readonly Session[], zone: string): DayTotal[] {
  const day = dayIn(zone);
  const days = new Map<string, DayTotal>();
  const of = (atMs: number): DayTotal => {
    const date = day(atMs);
    let total = days.get(date);
    if (total === undefined) {
      total = {date, observedHeatingMs: 0, creditedMinutes: 0, stretches: 0, sessions: 0, pumpRuns: 0};
      days.set(date, total);
    }
    return total;
  };
  for (const stretch of derived.stretches) {
    of(stretch.startAtMs).stretches += 1;
    for (const {fromMs, toMs} of stretch.segments) {
      let from = fromMs;
      while (from < toMs) {
        const date = day(from);
        const until = day(toMs) === date ? toMs : nextDay(day, from, toMs);
        of(from).observedHeatingMs += until - from;
        from = until;
      }
    }
  }
  for (const session of sessions) of(session.startAtMs).sessions += 1;
  for (const {atMs, minutes} of derived.credits) of(atMs).creditedMinutes += minutes;
  for (const atMs of derived.pumpRunsAtMs) of(atMs).pumpRuns += 1;
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
