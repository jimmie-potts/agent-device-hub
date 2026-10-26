import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {RunRecord, RunsPage, VacuumStatus, Value} from '../contracts.js';

export const ROBOROCK_MAX_AGE_MS = 120_000;
export type RoborockFreshness = 'current' | 'stale' | 'unknown' | 'unavailable';
export type RoborockCardData = {
  availability: RoborockFreshness; title: string; battery: string; batteryPercent: number | undefined;
  batteryLabel: string; cleaning: boolean; duration: string; area: string;
  care: readonly (readonly [string, string])[]; careNote: string;
  run: {label: string; time: string; at: number | undefined; duration: string; area: string};
  notices: readonly string[];
  historyAvailable: boolean;
};
const decimal = new Intl.NumberFormat('en', {maximumFractionDigits: 1});
function amount(value: Value<number>, divisor: number, unit: string): string {
  if (value.status !== 'known') return 'Unknown';
  const n = value.value / divisor;
  return `${n > 0 && n < .1 ? '<0.1' : decimal.format(n)} ${unit}`;
}
export function duration(value: Value<number>): string {
  return amount(value, value.status === 'known' && value.value < 60 ? 1 : 60, value.status === 'known' && value.value < 60 ? 's' : 'min');
}
export function freshness(at: Value<number>, now: number, live: boolean): RoborockFreshness {
  if (!live) return 'stale';
  if (at.status === 'unknown' || !Number.isFinite(now) || at.value > now) return 'unknown';
  return now - at.value > ROBOROCK_MAX_AGE_MS ? 'stale' : 'current';
}
export function lastRecordedRun(page: RunsPage | undefined): RunRecord | undefined {
  // The owning latest-run projection selects greatest reported start, independently of archive insertion order.
  return page?.runs[0];
}
function robotTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(new Date(at).getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(at);
}

/** Pure projection of already validated owner data. It never supplies missing fields from another measurement. */
export function roborockCardData({doc, live, error, now, runs, runsError}: {
  doc: VacuumStatus | undefined; live: boolean; error: ErrorCode | undefined; now: number;
  runs: RunsPage | undefined; runsError: ErrorCode | undefined;
}): RoborockCardData {
  const availability: RoborockFreshness = error !== undefined || doc === undefined || doc.availability === 'unavailable'
    ? 'unavailable' : doc.availability === 'unknown' ? 'unknown' : freshness(doc.observedAtMs, now, live);
  const notices: string[] = [];
  if (availability === 'unavailable') notices.push(error === undefined ? 'Roborock is unavailable.' : `Roborock read refused: ${error}.`);
  if (availability === 'stale') notices.push('Status is stale. Shown measurements are last observed values.');
  if (availability === 'unknown') notices.push('Current status or observation time is unknown. Future timestamps do not establish freshness.');
  const careAge = doc === undefined ? 'unknown' : freshness(doc.consumables.observedAtMs, now, live);
  if (doc !== undefined && careAge !== 'current') notices.push('Care usage is last observed; its observation time is stale or unknown.');
  for (const [label, field] of [['Roborock', doc?.status.errorCode], ['Dock', doc?.status.dockErrorStatus]] as const) {
    if (field?.status === 'known' && field.value !== 0) notices.push(`${label} reported code ${field.value}. Check the Roborock app.`);
  }
  if (runsError !== undefined) notices.push(`Run history read refused: ${runsError}.`);
  const current = availability === 'current';
  const title = !current ? availability === 'stale' ? 'Stale' : availability === 'unknown' ? 'Unknown' : 'Unavailable'
    : doc?.activity === 'cleaning' ? 'Cleaning' : doc?.activity === 'returning' ? 'Returning'
      : doc?.status.state.status === 'known' ? `State ${doc.status.state.value}` : 'Unknown';
  const battery = doc?.status.batteryPercent;
  const run = lastRecordedRun(runs);
  const complete = run?.complete;
  const runLabel = run === undefined ? runsError !== undefined || runs === undefined && availability === 'unavailable' ? 'History unavailable' : runs === undefined ? 'Loading history' : 'No retained runs'
    : complete?.status !== 'known' ? 'Completion unknown' : complete.value === 1 ? 'Completed' : complete.value === 0 ? 'Not completed' : `Complete code ${complete.value}`;
  const unknown: Value<number> = {status: 'unknown'};
  const care = doc?.consumables;
  return {
    availability, title, battery: battery?.status === 'known' ? `${battery.value}%` : 'Unknown',
    batteryPercent: battery?.status === 'known' ? battery.value : undefined,
    batteryLabel: current ? 'Battery' : 'Last battery', cleaning: current && doc?.activity === 'cleaning',
    duration: duration(doc?.status.cleanTimeSeconds ?? unknown), area: amount(doc?.status.cleanAreaMm2 ?? unknown, 1_000_000, 'm²'),
    care: [['Main brush', `${amount(care?.mainBrushSeconds ?? unknown, 3600, 'h')}`],
      ['Side brush', amount(care?.sideBrushSeconds ?? unknown, 3600, 'h')],
      ['Filter', amount(care?.filterSeconds ?? unknown, 3600, 'h')], ['Sensors', amount(care?.sensorSeconds ?? unknown, 3600, 'h')]],
    careNote: careAge === 'current' ? 'Recorded usage' : 'Last observed usage',
    run: {label: runLabel, at: run?.startAtMs, time: robotTime(run?.startAtMs), duration: duration(run?.durationSeconds ?? unknown),
      area: amount(run?.cleanedAreaMm2 ?? unknown, 1_000_000, 'm²')}, notices, historyAvailable: doc !== undefined,
  };
}
