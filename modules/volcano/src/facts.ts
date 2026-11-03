// What the Volcano module stores: facts, never sessions (Hub #614, #615). `reduce` is the one place that turns a snapshot
// into facts. It is pure, so a refused commit changes nothing and a restart resumes from the state committed with the last
// facts. Repeated, delayed and out-of-order snapshots never add a fact, and a missing observation stays unknown: a
// disconnect is never off, and a gap never invents a transition inside it.
//
// The device's facts, from the live trial on #614: the heater is status1 bit 0x0020 and the pump bit 0x2000, and the device
// ran the pump bit for about a second by itself on reaching its setpoint (0x2623, against 0x3623 from the button), so a
// pump run never implies a press and the raw register is kept. status2 bit 0x0200 means the display is in Fahrenheit;
// its bit 13 flips by itself every 10 to 15 s and is never a change. The counter counts whole minutes, only while heating,
// and survives a disconnect and a collector kill. Whether it survives power-off and how minutes roll into hours are not
// verified, so hours*60+minutes is the cumulative value and any decrease is a discontinuity.
import type {VolcanoLink, VolcanoObservation, VolcanoReading} from '@jimmie-potts/event-contracts/v2/families';

export const HEATER_BIT = 0x0020;
export const PUMP_BIT = 0x2000;
export const FAHRENHEIT_BIT = 0x0200;
/** How long a feed stands without a snapshot. A collector publishes at least every 5 s, so this is three missed heartbeats. */
export const STALE_MS = 15_000;
/** At most one temperature sample in this time while the heater is on, besides those at a transition. */
export const SAMPLE_MS = 30_000;
export const DEFAULT_GAP_MINUTES = 15;
export const MIN_GAP_MINUTES = 1;
export const MAX_GAP_MINUTES = 240;

/** How exactly a transition's time is known: as it happened, or only as first seen. */
export type Edge = 'observed' | 'first-observation' | 'after-gap';
export type HeaterKnown = 'on' | 'off' | 'unknown';
export type LinkFact = VolcanoLink | 'stale';
export type DiscontinuityReason = 'counter-decrease' | 'counter-jump' | 'identity-mismatch' | 'clock-step';

export type FactData =
  | {kind: 'heater'; on: boolean; status1: number; edge: Edge}
  | {kind: 'pump'; on: boolean; status1: number; edge: Edge}
  | {kind: 'setpoint'; targetDeciC: number}
  | {kind: 'temperature'; currentDeciC: number}
  | {kind: 'counter'; hours: number; minutes: number; totalMinutes: number}
  | {kind: 'link'; state: LinkFact}
  | {kind: 'collector-restart'}
  /** An interval with no observation. `creditedMinutes` is the counter's gain across it, null when no valid baseline spans it. */
  | {kind: 'gap'; fromMs: number; toMs: number; heaterBefore: HeaterKnown; heaterAfter: HeaterKnown; creditedMinutes: number | null}
  /** `lastReadingAtMs` is the last reading before it, which bounds whatever it interrupts. */
  | {kind: 'discontinuity'; reason: DiscontinuityReason; lastReadingAtMs: number | null};
/** One fact: when the collector observed it and, separately, when this module received it. */
export type Fact = FactData & {observedAtMs: number; receivedAtMs: number};

/** What the module keeps between snapshots, committed with the facts each one adds. */
export type Continuity = {
  /** The last snapshot taken. */
  epoch: string | null; sequence: number; takenAtMs: number | null;
  /** Ordering baseline: a snapshot not newer than this is not taken. It can move back only when the feed went stale. */
  baselineMs: number | null;
  /** The observation time of the last snapshot taken, to recognize a clock that stepped back. */
  latestMs: number | null;
  link: LinkFact | null;
  /** The last connected snapshot with a reading, and whether the link broke since. */
  lastReadingAtMs: number | null; broken: boolean;
  heater: boolean | null; pump: boolean | null; status1: number | null; currentDeciC: number | null; targetDeciC: number | null;
  counter: number | null; counterAtMs: number | null; lastSampleAtMs: number | null; displayFahrenheit: boolean | null;
};

export const emptyContinuity = (): Continuity => ({
  epoch: null, sequence: 0, takenAtMs: null, baselineMs: null, latestMs: null, link: null, lastReadingAtMs: null, broken: false,
  heater: null, pump: null, status1: null, currentDeciC: null, targetDeciC: null, counter: null, counterAtMs: null, lastSampleAtMs: null, displayFahrenheit: null,
});

export const counterOf = (reading: VolcanoReading): number | null =>
  reading.heatingHours === null || reading.heatingMinutes === null ? null : reading.heatingHours * 60 + reading.heatingMinutes;

/**
 * Whether a snapshot may be taken, and otherwise what is left of the state. A repeat of an epoch's sequence is dropped with
 * no effect. A snapshot not newer than the baseline is dropped too and renews nothing; once the feed has gone stale it
 * moves the baseline to its own stamp instead, so that a clock that stepped back or a snapshot stamped in the future holds
 * the feed for one freshness window and one cycle, never for good. The snapshot that moves the baseline gives no evidence.
 * One that follows it and is newer is taken, even if it too was delayed: `reduce` then records a `clock-step` when it is
 * older than the last one taken, so no interval or counter gain crosses it, but its reading stands as evidence.
 */
export function admit(state: Continuity, snapshot: Pick<VolcanoObservation, 'collectorEpoch' | 'sequence' | 'observedAtMs'>, nowMs: number): {take: true} | {take: false; baselineMs: number | null; reason: 'duplicate' | 'stale'} {
  if (snapshot.collectorEpoch === state.epoch && snapshot.sequence <= state.sequence) return {take: false, baselineMs: state.baselineMs, reason: 'duplicate'};
  if (state.baselineMs !== null && snapshot.observedAtMs <= state.baselineMs) {
    const stale = state.takenAtMs === null || nowMs - state.takenAtMs >= STALE_MS;
    return {take: false, baselineMs: stale ? snapshot.observedAtMs : state.baselineMs, reason: 'stale'};
  }
  return {take: true};
}

const known = (value: boolean | null): HeaterKnown => (value === null ? 'unknown' : value ? 'on' : 'off');

/** The facts one taken snapshot adds, in the order they apply, and the state after them. */
export function reduce(state: Continuity, snapshot: VolcanoObservation, receivedAtMs: number): {state: Continuity; facts: Fact[]} {
  const {observedAtMs, collectorEpoch, sequence, link, reading} = snapshot;
  const facts: Fact[] = [];
  const add = (data: FactData): void => { facts.push({...data, observedAtMs, receivedAtMs}); };
  const next: Continuity = {...state, epoch: collectorEpoch, sequence, takenAtMs: receivedAtMs, baselineMs: observedAtMs, latestMs: observedAtMs, link};
  const forget = (): void => {
    next.lastReadingAtMs = null; next.broken = false; next.heater = null; next.pump = null; next.status1 = null; next.currentDeciC = null;
    next.counter = null; next.counterAtMs = null; next.lastSampleAtMs = null;
  };
  // A clock that stepped back orders nothing across it: whatever was open ends unknown, and no counter gain crosses it.
  if (state.latestMs !== null && observedAtMs < state.latestMs) {
    add({kind: 'discontinuity', reason: 'clock-step', lastReadingAtMs: state.lastReadingAtMs});
    forget();
  }
  if (state.epoch !== null && state.epoch !== collectorEpoch) add({kind: 'collector-restart'});
  // The collector counts every snapshot it tries, so a skipped sequence is one that never arrived, and a new process held
  // no link for a while: either way something went unobserved, however short the time.
  const missed = state.epoch !== null && (state.epoch !== collectorEpoch || sequence > state.sequence + 1);
  if (missed && next.lastReadingAtMs !== null) next.broken = true;
  if (state.link !== link) add({kind: 'link', state: link});
  if (link === 'identity-mismatch' && state.link !== 'identity-mismatch') {
    add({kind: 'discontinuity', reason: 'identity-mismatch', lastReadingAtMs: next.lastReadingAtMs});
    forget();
    next.targetDeciC = null;
  }
  if (link !== 'connected' || reading === null) {
    if (next.lastReadingAtMs !== null) next.broken = true;
    return {state: next, facts};
  }
  applyReading(next, reading, observedAtMs, add);
  return {state: next, facts};
}

function applyReading(next: Continuity, reading: VolcanoReading, at: number, add: (data: FactData) => void): void {
  const heater = (reading.status1 & HEATER_BIT) !== 0, pump = (reading.status1 & PUMP_BIT) !== 0;
  const first = next.lastReadingAtMs === null;
  const unobserved = !first && (next.broken || at - (next.lastReadingAtMs ?? at) > STALE_MS);
  const value = counterOf(reading);
  const previous = next.counter;
  let credited: number | null = null;
  let reason: DiscontinuityReason | undefined;
  if (value !== null && previous !== null) {
    const elapsed = at - (next.counterAtMs ?? at);
    if (value < previous) reason = 'counter-decrease';
    // The counter counts whole minutes of real time, so a larger gain is not usage: it is a reset or another counter.
    else if (value - previous > Math.ceil(elapsed / 60_000) + 1) reason = 'counter-jump';
    else if (unobserved) credited = value - previous;
  }
  if (unobserved) {
    add({kind: 'gap', fromMs: next.lastReadingAtMs ?? at, toMs: at, heaterBefore: known(next.heater), heaterAfter: known(heater), creditedMinutes: credited});
  }
  if (reason !== undefined) add({kind: 'discontinuity', reason, lastReadingAtMs: next.lastReadingAtMs});
  if (value !== null) {
    if (value !== previous) add({kind: 'counter', hours: reading.heatingHours ?? 0, minutes: reading.heatingMinutes ?? 0, totalMinutes: value});
    next.counter = value;
    next.counterAtMs = at;
  }
  const edge: Edge = first || next.heater === null ? 'first-observation' : unobserved ? 'after-gap' : 'observed';
  let transition = false;
  if (next.heater !== heater) {
    add({kind: 'heater', on: heater, status1: reading.status1, edge});
    // A first sight of the heater off is a baseline, not a transition.
    transition = heater || next.heater !== null;
  }
  if (next.pump !== pump && (next.pump !== null || pump)) {
    add({kind: 'pump', on: pump, status1: reading.status1, edge: first || next.pump === null ? 'first-observation' : unobserved ? 'after-gap' : 'observed'});
    transition = true;
  }
  if (reading.targetDeciC !== null && reading.targetDeciC !== next.targetDeciC) add({kind: 'setpoint', targetDeciC: reading.targetDeciC});
  if (reading.currentDeciC !== null && (transition || (heater && (next.lastSampleAtMs === null || at - next.lastSampleAtMs >= SAMPLE_MS || at < next.lastSampleAtMs)))) {
    add({kind: 'temperature', currentDeciC: reading.currentDeciC});
    next.lastSampleAtMs = at;
  }
  next.heater = heater;
  next.pump = pump;
  next.status1 = reading.status1;
  next.currentDeciC = reading.currentDeciC;
  next.targetDeciC = reading.targetDeciC ?? next.targetDeciC;
  next.displayFahrenheit = (reading.status2 & FAHRENHEIT_BIT) !== 0;
  next.lastReadingAtMs = at;
  next.broken = false;
}

/** The feed went stale at `nowMs`: one marker, and the next reading starts from an unobserved gap. Nothing about the heater. */
export function stale(state: Continuity, nowMs: number): {state: Continuity; facts: Fact[]} {
  if (state.link === null || state.link === 'stale') return {state, facts: []};
  return {
    state: {...state, link: 'stale', broken: state.lastReadingAtMs !== null},
    facts: [{kind: 'link', state: 'stale', observedAtMs: nowMs, receivedAtMs: nowMs}],
  };
}
