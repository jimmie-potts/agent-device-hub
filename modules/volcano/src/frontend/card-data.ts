// Pure projections of checked documents for the card (Hub #616). Nothing here fills a missing value from another one: an
// unknown stays unknown, an unobserved interval gets no drawn duration, and a session means heater activity only.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {Session} from '../sessions.js';
import type {VolcanoStatus} from '../status-document.js';
import type {GapBucket, TimelineFact, TotalsDay} from './documents.js';

export type VolcanoFreshness = 'loading' | 'current' | 'stale' | 'unavailable';
export type VolcanoNow = {
  freshness: VolcanoFreshness; title: string; heater: string; pump: string; current: string; target: string; counter: string; lastSeen: string; lastSeenAge: string; notices: readonly string[];
};
const UNKNOWN = 'Unknown';

/** A temperature in the unit the device displays, or Celsius when that is unknown. */
export function temperature(deciC: number | null, fahrenheit: boolean | null): string {
  if (deciC === null) return UNKNOWN;
  return fahrenheit === true ? `${String(Math.round((deciC * 9) / 50 + 32))} °F` : `${new Intl.NumberFormat('en', {maximumFractionDigits: 1}).format(deciC / 10)} °C`;
}
export function minutesText(total: number): string {
  if (total < 60) return `${String(total)} min`;
  const rest = total % 60;
  return rest === 0 ? `${String(Math.floor(total / 60))} h` : `${String(Math.floor(total / 60))} h ${String(rest)} min`;
}
/** Observed time. A real interval under a minute reads as such, never as nothing. */
export function durationText(ms: number): string {
  return ms > 0 && ms < 60_000 ? '<1 min' : minutesText(Math.round(ms / 60_000));
}
export function clock(at: number): string {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(date) : UNKNOWN;
}
function time(at: number): string {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit'}).format(date) : UNKNOWN;
}
/** A span in the local zone: times alone within one day, and with their dates otherwise, so two days never read as minutes. */
function spanText(fromMs: number, toMs: number): string {
  const sameDay = new Date(fromMs).toDateString() === new Date(toMs).toDateString();
  return sameDay ? `${time(fromMs)} to ${time(toMs)}` : `${clock(fromMs)} to ${clock(toMs)}`;
}
const endOf = (startMs: number, atMs: number): string => (new Date(startMs).toDateString() === new Date(atMs).toDateString() ? time(atMs) : clock(atMs));
export function ageText(at: number | null, now: number): string {
  if (at === null || !Number.isFinite(now) || at > now) return 'Age unknown';
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 60) return `${String(seconds)} s ago`;
  return `${minutesText(Math.floor(seconds / 60))} ago`;
}
const LINK: Readonly<Record<VolcanoStatus['link'], string>> = {
  connected: 'The collector is connected, but its reading is out of date.', disconnected: 'The collector has lost the device.', unavailable: 'The device is not available to the collector.',
  'identity-mismatch': 'The collector found a different device and stopped reading.', stale: 'The collector has stopped reporting.', unknown: 'No reading has arrived since the module started.',
};

export function volcanoNow({doc, connected, live, error, now}: {doc: VolcanoStatus | undefined; connected: boolean; live: boolean; error: ErrorCode | undefined; now: number}): VolcanoNow {
  const freshness: VolcanoFreshness = doc === undefined ? (error !== undefined || !connected ? 'unavailable' : 'loading') : !live ? 'stale' : doc.availability === 'available' ? 'current' : 'unavailable';
  const notices: string[] = [];
  if (error !== undefined) notices.push(`Volcano read refused: ${error}.`);
  if (doc === undefined && error === undefined && !connected) notices.push('The Volcano module is not connected. Nothing here means the heater is off.');
  if (freshness === 'stale') notices.push('The status stream is not live. Values are unknown until it returns, and this does not mean the heater is off.');
  if (freshness === 'unavailable' && doc !== undefined) notices.push(`${LINK[doc.link]} The heater and pump are unknown, not off.`);
  if (doc?.recording === 'refused') notices.push('Recording is refused because the module cannot write its history. New use is not being stored.');
  const current = freshness === 'current' && doc !== undefined;
  const title = freshness === 'loading' ? 'Loading' : freshness === 'stale' ? 'Stale' : !current ? 'Unavailable' : doc.heater === 'on' ? 'Heating' : doc.heater === 'off' ? 'Heater off' : 'Heater unknown';
  const onOff = (value: VolcanoStatus['heater'] | undefined): string => (!current || value === undefined || value === 'unknown' ? UNKNOWN : value === 'on' ? 'On' : 'Off');
  return {
    freshness, title, heater: onOff(doc?.heater), pump: onOff(doc?.pump),
    current: current ? temperature(doc.currentDeciC, doc.displayFahrenheit) : UNKNOWN, target: current ? temperature(doc.targetDeciC, doc.displayFahrenheit) : UNKNOWN,
    counter: current && doc.heatingCounterMinutes !== null ? minutesText(doc.heatingCounterMinutes) : UNKNOWN,
    lastSeen: doc?.observedAtMs === null || doc === undefined ? 'No observation yet' : clock(doc.observedAtMs), lastSeenAge: ageText(doc?.observedAtMs ?? null, now), notices,
  };
}

export type TimelineRow = {key: string; kind: 'heating' | 'pump' | 'gap' | 'discontinuity'; title: string; detail: string};
const DISCONTINUITY: Readonly<Record<Extract<TimelineFact, {kind: 'discontinuity'}>['reason'], string>> = {
  'counter-decrease': 'Heating counter decreased', 'counter-jump': 'Heating counter jumped', 'identity-mismatch': 'A different device was found', 'clock-step': 'The clock stepped',
};
const credit = (minutes: number | null): string => (minutes === null ? 'no credit' : `counter gained ${minutesText(minutes)}`);
const side = (value: 'on' | 'off' | 'unknown'): string => (value === 'unknown' ? 'unknown' : value);

/**
 * Heating stretches, pump runs, unobserved gaps and discontinuities, in order. A duration is drawn only between two edges
 * seen as they happened with nothing unobserved between them, and a stretch cut by the end of the page says so.
 */
export function timelineRows(facts: readonly TimelineFact[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  type Open = {row: TimelineRow; atMs: number; seen: boolean; crossed: boolean};
  let heating: Open | undefined, pump: Open | undefined;
  const unfinished = (open: Open | undefined, why: string): void => { if (open !== undefined) open.row.detail = [open.row.detail, why].filter(value => value !== '').join(' '); };
  for (const fact of facts) {
    const key = String(fact.seq);
    if (fact.kind === 'heater' && fact.on) {
      unfinished(heating, 'No end was seen.');
      const row: TimelineRow = {key, kind: 'heating', title: `Heating from ${time(fact.observedAtMs)}`, detail: fact.edge === 'observed' ? '' : 'Already on when first seen, so it may have started earlier.'};
      rows.push(row);
      heating = {row, atMs: fact.observedAtMs, seen: fact.edge === 'observed', crossed: false};
    } else if (fact.kind === 'heater') {
      if (heating === undefined) rows.push(fact.edge === 'first-observation' ? {key, kind: 'heating', title: `First seen off at ${time(fact.observedAtMs)}`, detail: ''}
        : {key, kind: 'heating', title: `Heater off at ${time(fact.observedAtMs)}`, detail: fact.edge === 'observed' ? 'It went on before this view.' : 'Seen off after an unobserved interval.'});
      else if (fact.edge === 'observed') {
        heating.row.title = `Heating ${spanText(heating.atMs, fact.observedAtMs)}`;
        if (heating.crossed) unfinished(heating, 'Includes unobserved time.');
        else if (heating.seen) heating.row.detail = durationText(fact.observedAtMs - heating.atMs);
      } else unfinished(heating, `The end was not seen: off by ${time(fact.observedAtMs)}.`);
      heating = undefined;
    } else if (fact.kind === 'pump' && fact.on) {
      const row: TimelineRow = {key, kind: 'pump', title: `Pump from ${time(fact.observedAtMs)}`, detail: fact.edge === 'observed' ? '' : 'Already on when first seen.'};
      rows.push(row);
      pump = {row, atMs: fact.observedAtMs, seen: fact.edge === 'observed', crossed: false};
    } else if (fact.kind === 'pump') {
      if (pump === undefined) rows.push({key, kind: 'pump', title: `Pump off at ${time(fact.observedAtMs)}`, detail: 'It went on before this view.'});
      else if (fact.edge === 'observed') {
        pump.row.title = `Pump ${spanText(pump.atMs, fact.observedAtMs)}`;
        if (pump.crossed) unfinished(pump, 'Includes unobserved time.');
      } else unfinished(pump, `The end was not seen: off by ${time(fact.observedAtMs)}.`);
      pump = undefined;
    } else if (fact.kind === 'gap') {
      rows.push({key, kind: 'gap', title: `Unobserved ${spanText(fact.fromMs, fact.toMs)}`, detail: `Heater ${side(fact.heaterBefore)} before, ${side(fact.heaterAfter)} after; ${credit(fact.creditedMinutes)}.`});
      if (heating !== undefined) heating.crossed = true;
      if (pump !== undefined) pump.crossed = true;
    } else if (fact.kind === 'discontinuity') {
      const closes = fact.reason === 'identity-mismatch' || fact.reason === 'clock-step';
      rows.push({key, kind: 'discontinuity', title: `${DISCONTINUITY[fact.reason]} at ${time(fact.observedAtMs)}`, detail: closes ? 'No time or credit is counted across this.' : 'No counter credit is counted across this.'});
      if (closes) {
        unfinished(heating, 'Its end is unknown.');
        heating = undefined;
      }
    }
  }
  unfinished(heating, 'No end in this view.');
  unfinished(pump, 'No end in this view.');
  return rows;
}

export type SessionRow = {key: string; start: string; end: string; partial: boolean; note: string; facts: readonly (readonly [string, string])[]};
const plural = (count: number, one: string): string => `${String(count)} ${one}${count === 1 ? '' : 's'}`;
export function sessionRow(session: Session): SessionRow {
  const inside = session.stretches.reduce((sum, stretch) => sum + stretch.unobserved.length + stretch.omittedUnobserved, 0);
  const unobserved = inside + session.unobservedBetween;
  const hidden = session.omittedStretches > 0;
  const end = session.endAtMs !== null ? `to ${endOf(session.startAtMs, session.endAtMs)}`
    : session.endedUnobservedBy !== null ? `End not seen: last on ${endOf(session.startAtMs, session.lastObservedOnAtMs)}, off by ${endOf(session.startAtMs, session.endedUnobservedBy)}`
      : session.open ? `No end seen yet: last on ${endOf(session.startAtMs, session.lastObservedOnAtMs)}` : `End unknown: last on ${endOf(session.startAtMs, session.lastObservedOnAtMs)}`;
  const facts: (readonly [string, string])[] = [['Observed heating', durationText(session.observedHeatingMs)], ['Stretches', String(session.stretches.length + session.omittedStretches)], ['Pump runs', String(session.pumpRuns)]];
  if (unobserved > 0 || hidden) facts.push(['Unobserved intervals', hidden ? `At least ${String(unobserved)}` : String(unobserved)]);
  if (inside > 0 || hidden) {
    // A null credit is unknown, and the module's sum counts it as nothing, so that sum alone is only a lower bound.
    const unknown = hidden || session.stretches.some(stretch => stretch.omittedUnobserved > 0 || stretch.unobserved.some(({creditedMinutes}) => creditedMinutes === null));
    facts.push(['Counter credit', !unknown ? minutesText(session.creditedMinutes) : session.creditedMinutes > 0 ? `At least ${minutesText(session.creditedMinutes)}` : 'Unknown']);
  }
  if (session.discontinuities > 0) facts.push(['Discontinuities', String(session.discontinuities)]);
  const firstSeen = session.startedBeforeObservation || session.stretches.some(stretch => stretch.startedBeforeObservation);
  // A running session has no end yet, which is not missing evidence, and a counter discontinuity has its own line.
  const endUnseen = session.stretches.some(stretch => stretch.endAtMs === null && !stretch.open);
  const partial = firstSeen || endUnseen || unobserved > 0 || hidden;
  return {
    key: String(session.startAtMs), start: `${session.startedBeforeObservation ? 'First seen on ' : ''}${clock(session.startAtMs)}`, end, partial,
    note: partial ? 'Incomplete evidence: the heater may have run at times not observed here.' : '', facts,
  };
}
export function totalsLine(day: TotalsDay): string {
  const parts = [`${durationText(day.observedHeatingMs)} observed`];
  if (day.creditedMinutes > 0) parts.push(`${minutesText(day.creditedMinutes)} credited`);
  return [...parts, plural(day.sessions, 'session'), plural(day.pumpRuns, 'pump run')].join(' · ');
}
export function bucketLabel({fromMinutes, toMinutes}: GapBucket): string {
  return toMinutes === null ? `${String(fromMinutes)}+ min` : `${String(fromMinutes)} to ${String(toMinutes)} min`;
}
/** A whole number of minutes the module takes, or undefined. */
export function thresholdValue(text: string): number | undefined {
  if (!/^[1-9][0-9]{0,2}$/u.test(text.trim())) return undefined;
  const value = Number(text);
  return value >= 1 && value <= 240 ? value : undefined;
}
/** Midnight in this browser's zone, a calendar day after `dayStartMs` by `days`. */
export function shiftDay(dayStartMs: number, days: number): number {
  const date = new Date(dayStartMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}
export function dayLabel(dayStartMs: number): string {
  return new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'}).format(dayStartMs);
}
