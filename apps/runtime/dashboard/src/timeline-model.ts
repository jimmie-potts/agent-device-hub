/** Retained history is evidence of past records, never a source of current device state. */
export type HistoryRow = {seq: number; atMs: number; kind: string; source: string; subject: string; type: string; requestId: string | null; record: Record<string, unknown>};
export type HistoryCategory = 'All' | 'Agents' | 'Devices' | 'Automation';
export type HistoryPeriod = 'today' | 'yesterday' | 'recent' | 'custom';
export type HistoryFilters = {kind: string; source: string; session: string; from: string; to: string};
export const emptyHistoryFilters = (): HistoryFilters => ({kind: '', source: '', session: '', from: '', to: ''});
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined;

/** Check the whole reply before replacing a last-good snapshot. */
export function historyRows(value: unknown): HistoryRow[] | undefined {
  const rows = object(value)?.rows;
  if (!Array.isArray(rows)) return undefined;
  const seen = new Set<number>();
  for (const item of rows as unknown[]) {
    const row = object(item);
    if (row === undefined || typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq) || row.seq < 0 || seen.has(row.seq) ||
      typeof row.atMs !== 'number' || !Number.isSafeInteger(row.atMs) || row.atMs < 0 || row.atMs > 8.64e15 ||
      !['change', 'removal', 'occurrence', 'outcome', 'operation'].includes(String(row.kind)) ||
      !['source', 'subject', 'type'].every(key => typeof row[key] === 'string') ||
      !(row.requestId === null || typeof row.requestId === 'string') || object(row.record) === undefined) return undefined;
    seen.add(row.seq);
  }
  return rows as HistoryRow[];
}

/** Local midnight boundaries account for 23/25-hour daylight-saving days. */
export function historyQuery(period: HistoryPeriod, filters: HistoryFilters, now = new Date()): string {
  const query = new URLSearchParams({limit: '200'});
  for (const key of ['kind', 'source', 'session'] as const) if (filters[key] !== '') query.set(key, filters[key]);
  if (period === 'custom') {
    for (const [field, key] of [['from', 'fromAtMs'], ['to', 'toAtMs']] as const) if (filters[field] !== '') {
      const at = new Date(filters[field]).getTime();
      if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid date');
      query.set(key, String(at));
    }
  } else if (period !== 'recent') {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (period === 'today' ? 1 : 0));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (period === 'yesterday' ? 1 : 0));
    query.set('fromAtMs', String(start.getTime()));query.set('toAtMs', String(end.getTime() - 1));
  }
  const from = query.get('fromAtMs'), to = query.get('toAtMs');
  if (from !== null && to !== null && Number(from) > Number(to)) throw new Error('From must precede To');
  return query.size === 0 ? '' : `?${query}`;
}

const commandNames: Readonly<Record<string, string>> = {
  'org.bunny.power.set.requested': 'Power', 'org.bunny.brightness.set.requested': 'Brightness',
  'org.bunny.mode.set.requested': 'Hub mode', 'org.bunny.device-mode.set.requested': 'Device mode',
  'org.bunny.scene.activate.requested': 'Scene', 'org.bunny.media.start.requested': 'Media',
  'org.bunny.media.control.requested': 'Media control', 'org.bunny.playback.control.requested': 'Playback',
  'org.bunny.moment.play.requested': 'Moment', 'org.bunny.home-layout.set.requested': 'Home layout',
};
export type HistoryFace = {title: string; context: string; detail: string; category: Exclude<HistoryCategory, 'All'> | 'Hub'; warning: boolean};
export function historyFace(row: HistoryRow): HistoryFace {
  const data = object(row.record.data) ?? row.record, changed = object(row.record.changed) ?? {};
  const family = text(row.record.family) ?? '';
  const category: HistoryFace['category'] = family === 'session' || /^org\.bunny\.(attention|turn|session)\./.test(row.type) ? 'Agents'
    : row.source === 'bunny/core/automation' || /^org\.bunny\.(automation|rule|routine|moment|mode)\./.test(row.type) || family === 'automation-rule' ? 'Automation'
      : row.source.startsWith('bunny/modules/') || family === 'device' || data.kind === 'device' ? 'Devices' : 'Hub';
  const context = `${text(object(changed.label)?.value) ?? text(changed.label) ?? row.subject} · ${row.source.startsWith('bunny/modules/') ? row.source.slice('bunny/modules/'.length) : category}`;
  let title = `${row.kind} · ${row.subject}`, detail = 'Retained record. No current state is inferred.', warning = false;
  if (row.kind === 'operation' || row.kind === 'outcome') {
    const action = commandNames[row.type] ?? (row.kind === 'operation' ? 'Command' : 'Result');
    const result = data.result, status = data.status;
    const state = result === 'conflict' || status === 'conflict' ? 'conflicting results'
      : result === 'uncertain' || status === 'uncertain' ? 'uncertain'
        : status === 'expired' ? 'expired'
          : result === 'failed' || status === 'rejected' ? 'failed'
            : result === 'succeeded' ? data.evidence === 'observed' ? 'observed' : data.evidence === 'transmitted' ? 'transmitted' : 'succeeded'
              : status === 'accepted' ? 'accepted' : status === 'sent' ? 'requested' : 'recorded';
    title = `${action} · ${state}`;
    warning = ['failed', 'uncertain', 'expired', 'conflicting results'].includes(state);
    detail = state === 'requested' || state === 'accepted' ? 'The request was recorded. Completion is not established by this entry.'
      : state === 'transmitted' ? 'The owner reported transmission. This does not establish an observed device change.'
        : state === 'observed' ? 'The owner reported an observed effect at this time.'
          : state === 'uncertain' ? 'The effect is unknown. This entry does not establish the device state.'
            : state === 'conflicting results' ? 'Both success and failure were recorded. The effect needs review.'
            : state === 'expired' ? 'The request expired before execution; no effect was attempted.'
              : state === 'failed' ? 'The request did not complete successfully. This entry does not establish the device state.'
                : state === 'succeeded' ? 'The owner reported success without observed or transmitted evidence.' : detail;
  } else if (row.kind === 'change') {
    if (family === 'session') title = Array.isArray(changed.attention) ? 'Attention updated'
      : changed.activity === 'active' ? 'Agent working' : 'Agent updated';
    else if (family === 'mode' && ['work', 'free', 'quiet'].includes(String(changed.mode))) title = `Hub mode · ${String(changed.mode)}`;
    else if (family === 'device') title = 'Device updated';
    else title = `${family !== '' ? family : 'Record'} updated`;
    detail = 'This entry contains changed fields only; missing fields have no new evidence.';
  } else if (row.kind === 'occurrence') {
    const names: Readonly<Record<string, string>> = {'org.bunny.attention.raised': 'Attention requested', 'org.bunny.attention.cleared': 'Attention cleared', 'org.bunny.turn.ended': 'Turn finished', 'org.bunny.session.ended': 'Session ended', 'org.bunny.moment.ended': 'Moment ended'};
    title = names[row.type] ?? 'Event recorded';
    detail = 'The source recorded this event at this time. It does not establish current state.';
  } else if (row.kind === 'removal') {title = 'Record removed';detail = 'This record was removed. No physical effect is implied.';}
  return {title, context, detail, category, warning};
}

export function selectedHistory(rows: readonly HistoryRow[], category: HistoryCategory): HistoryRow[] {
  return rows.filter(row => category === 'All' || historyFace(row).category === category).sort((a, b) => a.atMs === b.atMs ? b.seq - a.seq : b.atMs - a.atMs);
}
