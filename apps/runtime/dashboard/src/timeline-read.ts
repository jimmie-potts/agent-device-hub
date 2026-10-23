import {historyRows, type HistoryRow} from './timeline-model.ts';

export type HistorySnapshot = {rows: readonly HistoryRow[]; phase: 'loading' | 'ready' | 'unavailable'; readAt: number | undefined};
type FetchHistory = (query: string, signal: AbortSignal) => Promise<{ok: boolean; json: () => Promise<unknown>}>;

/** One active GET. Identity checks also protect against transports that finish after abort. */
export function createHistoryReader(fetchHistory: FetchHistory, changed: (snapshot: HistorySnapshot) => void): {read: (query: string) => Promise<void>; dispose: () => void} {
  let active: AbortController | undefined, disposed = false;
  let snapshot: HistorySnapshot = {rows: [], phase: 'loading', readAt: undefined};
  const publish = (next: HistorySnapshot): void => {snapshot = next;changed(next);};
  return {
    read: async query => {
      if (disposed) return;
      active?.abort();const request = new AbortController();active = request;
      publish({...snapshot, phase: 'loading'});
      try {
        const response = await fetchHistory(query, request.signal);
        const rows = response.ok ? historyRows(await response.json()) : undefined;
        if (disposed || request !== active) return;
        publish(rows === undefined ? {...snapshot, phase: 'unavailable'} : {rows, phase: 'ready', readAt: Date.now()});
      } catch {if (!disposed && request === active) publish({...snapshot, phase: 'unavailable'});}
    },
    dispose: () => {disposed = true;active?.abort();active = undefined;},
  };
}
