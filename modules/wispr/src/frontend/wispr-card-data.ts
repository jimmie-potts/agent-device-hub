import {metrics, type WisprRead} from './wispr-data.js';

export type WisprDay = {date: string; words: number | null; minutes: number | null};
export type WisprSummary = {
  state: 'available' | 'stale' | 'unavailable' | 'loading';
  loading: boolean;
  period: string;
  words: number | null;
  minutes: number | null;
  days: WisprDay[];
  observedAt: string | null;
  age: string;
  note: string;
};
const dayMs = 86_400_000;
const finite = (value: number | undefined): number | null => value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;

/** Calendar keys come from the producer's reporting zone; UTC arithmetic only spaces those date labels. */
export function wisprSummary(read: WisprRead | undefined, error: string | undefined, loading: boolean, now: number): WisprSummary {
  const today = read?.status.data.presets.find(p => p.key === 'today');
  const week = read?.status.data.presets.find(p => p.key === '7d');
  const end = week === undefined ? NaN : Date.parse(week.to);
  const rows = read?.numeric?.data.daily ?? [];
  const days: WisprDay[] = !Number.isFinite(end) ? [] : Array.from({length: 7}, (_, index) => {
    const date = new Date(end - (6 - index) * dayMs).toISOString().slice(0, 10);
    const row = rows.find(value => value.key === date);
    return {date, words: finite(row?.words), minutes: row === undefined ? null : metrics(row).speech};
  });
  const row = rows.find(value => value.key === today?.to);
  const expired = today !== undefined && (now < Date.parse(today.asOf) || now >= Date.parse(today.validUntil));
  const usable = days.some(day => day.words !== null);
  const state = !usable ? loading ? 'loading' : 'unavailable'
    : error !== undefined || read?.status.freshness === 'stale' || read?.status.reason !== null || expired ? 'stale' : 'available';
  const observedAt = read?.status.lastSuccessAt ?? null;
  const elapsed = observedAt === null ? NaN : now - Date.parse(observedAt);
  const age = !Number.isFinite(elapsed) ? 'Not observed' : elapsed < 0 ? 'Clock differs' : `Observed ${Math.floor(elapsed / 60000).toLocaleString()} min ago`;
  const period = state === 'unavailable' ? 'Unavailable' : expired ? today.to : 'Today';
  const note = state === 'unavailable' ? 'No captured numeric data is available. Open Wispr for source details.'
    : expired ? 'These totals belong to the captured date. Refresh reads the latest published collection.'
      : state === 'stale' ? 'Showing the last captured numeric data. Refresh reads published files; it does not run collection.' : '';
  return {state, loading, period, words: finite(row?.words), minutes: row === undefined ? null : metrics(row).speech,
    days, observedAt, age, note};
}
