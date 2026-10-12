import type {HistoryState} from '../history-types.js';
export type SessionProjection = HistoryState['current'][number];
export type Coverage = HistoryState['coverage'];
import type {HistoryRecord} from './history-documents.js';
export {readState, readRecord, readPage, readDetail, type HistoryRecord} from './history-documents.js';
export function dateFilters(from: string, through: string): {fromMs?: number; toMs?: number} {
  const midnight = (value: string): Date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
    const [year, month, day] = value.split('-').map(Number) as [number,number,number];
    const date = new Date(0);
    date.setFullYear(year, month - 1, day); date.setHours(0,0,0,0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getTime() < 0) throw new Error('Invalid date');
    return date;
  };
  const result: {fromMs?: number; toMs?: number} = {};
  if (from !== '') result.fromMs = midnight(from).getTime();
  if (through !== '') {const end = midnight(through); end.setDate(end.getDate() + 1); result.toMs = end.getTime();}
  if (result.fromMs !== undefined && result.toMs !== undefined && result.fromMs >= result.toMs) throw new Error('Invalid date range');
  return result;
}
export function sessionFacts(session: SessionProjection): [string,string][] {
  const metadata = session.metadata, playback = session.playback;
  return [
    ['App', session.app === 'youtube' ? 'YouTube' : 'Stremio'],
    ['Evidence', session.app === 'youtube' ? 'Selected-title observed' : 'Title observed'],
    ['Title', metadata?.title ?? metadata?.displayTitle ?? 'Unknown'],
    ['Display title (source)', metadata?.displayTitle ?? 'Unknown'],
    ['Episode / subtitle (source)', metadata?.subtitle ?? 'Unknown'],
    ['Channel / artist (source)', metadata?.artist ?? 'Unknown'],
    ['Series / album (source)', metadata?.album ?? 'Unknown'],
    ['Genre (source)', metadata?.genre ?? 'Unknown'],
    ['Description (source)', metadata?.description ?? 'Unknown'],
    ['Media ID (source)', metadata?.mediaId ?? 'Unknown'],
    ['Source position', playback === null || playback.positionMs < 0 ? 'Unknown' : `${playback.positionMs} ms`],
    ['Source duration', metadata?.durationMs == null ? 'Unknown' : `${metadata.durationMs} ms`],
    ['Playback state (source code)', playback === null ? 'Unknown' : String(playback.state)],
    ['Playback speed (source)', playback === null ? 'Unknown' : String(playback.speed)],
    ['Position update (device elapsed)', playback === null ? 'Unknown' : `${playback.positionUpdatedElapsedMs} ms`],
  ];
}
export function currentStatus(state: HistoryState, live: boolean, now: number): HistoryState['status'] {
  if (!state.enabled) return 'disabled';
  if (state.status !== 'fresh') return state.status;
  const observed = state.lastAccepted?.receivedAtMs;
  return live && state.currentEvidence === 'fresh-observation' && observed !== undefined && now >= observed && now - observed < 15_000 ? 'fresh' : 'stale';
}
export function timestamp(value: number | null | undefined): string {
  if (value == null) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? `Unrepresentable timestamp (${value} ms)` : date.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
}
export type Filters = {app: '' | 'youtube' | 'stremio'; from: string; through: string; title: string};
export function historyPath(filters: Filters, cursor?: string): string {
  const range = dateFilters(filters.from, filters.through);
  if (filters.title.length > 256) throw new Error('Title filter is too long');
  const query = new URLSearchParams({limit:'50'});
  if (filters.app !== '') query.set('app',filters.app);
  if (filters.title !== '') query.set('title',filters.title);
  if (range.fromMs !== undefined) query.set('fromMs',String(range.fromMs));
  if (range.toMs !== undefined) query.set('toMs',String(range.toMs));
  if (cursor !== undefined) query.set('cursor',cursor);
  return `/modules/onn/content/history?${query}`;
}
export function detailPath(id: string, cursor?: string): string {
  const query = new URLSearchParams({id,limit:'50'});
  if (cursor !== undefined) query.set('cursor',cursor);
  return `/modules/onn/content/history-detail?${query}`;
}

export function recordOrder(current: HistoryRecord, next: HistoryRecord): 'accept' | 'ignore' | 'conflict' {
  if (next.id !== current.id) return 'conflict';
  if (next.revision < current.revision) return 'ignore';
  if (next.revision === current.revision && JSON.stringify(next) !== JSON.stringify(current)) return 'conflict';
  return 'accept';
}
