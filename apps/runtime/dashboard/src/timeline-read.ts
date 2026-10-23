import {historyRows, type HistoryRow} from './timeline-model.ts';

const refusalCodes = ['invalid-request', 'unauthenticated', 'forbidden', 'unavailable', 'internal', 'too-large'] as const;
export type HistoryRefusal = typeof refusalCodes[number];
export type HistorySnapshot = {rows: readonly HistoryRow[]; phase: 'loading' | 'ready' | 'unavailable'; readAt: number | undefined; errorCode?: HistoryRefusal | undefined};
type FetchHistory = (query: string, signal: AbortSignal) => Promise<{ok: boolean; json: () => Promise<unknown>}>;

function refusal(value: unknown): HistoryRefusal | undefined {
  if (typeof value !== 'object' || value === null || !('error' in value)) return undefined;
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return refusalCodes.find(code => code === error.code);
}

/** One active GET. Identity checks also protect against transports that finish after abort. */
export function createHistoryReader(fetchHistory: FetchHistory, changed: (snapshot: HistorySnapshot) => void): {read: (query: string) => Promise<void>; dispose: () => void} {
  let active: AbortController | undefined, disposed = false;
  let snapshot: HistorySnapshot = {rows: [], phase: 'loading', readAt: undefined};
  const publish = (next: HistorySnapshot): void => {snapshot = next;changed(next);};
  return {
    read: async query => {
      if (disposed) return;
      active?.abort();const request = new AbortController();active = request;
      publish({...snapshot, phase: 'loading', errorCode: undefined});
      try {
        const response = await fetchHistory(query, request.signal);
        const answer: unknown = await response.json();
        const rows = response.ok ? historyRows(answer) : undefined;
        if (disposed || request !== active) return;
        publish(rows === undefined ? {...snapshot, phase: 'unavailable', errorCode: response.ok ? undefined : refusal(answer)} : {rows, phase: 'ready', readAt: Date.now()});
      } catch {if (!disposed && request === active) publish({...snapshot, phase: 'unavailable', errorCode: undefined});}
    },
    dispose: () => {disposed = true;active?.abort();active = undefined;},
  };
}
