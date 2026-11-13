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

/**
 * An entity's open span, as the history read's optional `open` member gives it (#1773): the stretch its next row would
 * close, from the reading that wrote the row at `revision` (or an unknown start) to its last confirmation. It is a past
 * reading, never current state.
 */
export type HistoryOpenSpan = {source: string; family: string; id: string; revision: number; sinceAtMs: number | null; lastConfirmedAtMs: number; confirmations: number};
const instant = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * The reply's open spans, or none: the member is optional, and one that does not hold exactly that shape is left out as
 * a whole, so the rows read as they would without it.
 */
export function historyOpen(value: unknown): HistoryOpenSpan[] {
  const open = object(value)?.open;
  if (!Array.isArray(open)) return [];
  const valid = (open as unknown[]).every(item => {
    const span = object(item);
    return span !== undefined && ['source', 'family', 'id'].every(key => typeof span[key] === 'string') && typeof span.revision === 'number' &&
      Number.isSafeInteger(span.revision) && (span.sinceAtMs === null || instant(span.sinceAtMs)) && instant(span.lastConfirmedAtMs) && count(span.confirmations);
  });
  return valid ? open as HistoryOpenSpan[] : [];
}

/** Match known starts to rows. Unknown starts use a change row only for the entity's label and category. */
export function openSpans(rows: readonly HistoryRow[], open: readonly HistoryOpenSpan[], category: HistoryCategory = 'All'): {
  byRow: Map<number, HistoryOpenSpan>;
  unknownStarts: {key: string; context: string; note: string}[];
} {
  const newest = new Map<string, HistoryRow>();
  for (const row of rows) {
    const family = text(row.record.family), id = text(row.record.id);
    if (row.kind !== 'change' || family === undefined || id === undefined) continue;
    const key = JSON.stringify([row.source, family, id]), held = newest.get(key);
    if (held === undefined || held.seq < row.seq) newest.set(key, row);
  }
  const byRow = new Map<number, HistoryOpenSpan>();
  const unknownStarts: {key: string; context: string; note: string}[] = [];
  for (const span of open) {
    const key = JSON.stringify([span.source, span.family, span.id]);
    const row = newest.get(key);
    if (row === undefined) continue;
    if (span.sinceAtMs === null) {
      const face = historyFace(row);
      if (category === 'All' || face.category === category) {
        unknownStarts.push({key, context: `${face.context} · ${span.family}`, note: openSpanNote(span, recordedAt)});
      }
    } else if (row.record.revision === span.revision && span.sinceAtMs === row.atMs) {
      byRow.set(row.seq, span);
    }
  }
  return {byRow, unknownStarts};
}

/** A length of time in the Timeline's short form: `45 s`, `12 min`, `4 h 29 min`, `3 d 2 h`; under a second is `less than 1 s`. */
export function lengthOf(ms: number): string {
  if (ms < 1000) return 'less than 1 s';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (minutes === 0) return `${seconds} s`;
  if (hours === 0) return `${minutes} min`;
  if (days === 0) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}
const readings = (n: number): string => `${n.toLocaleString('en-US')} reading${n === 1 ? '' : 's'}`;
/** A recorded instant as the Timeline writes it in a sentence: the date and the time of day, in the viewer's zone. */
export const recordedAt = (atMs: number): string => new Date(atMs).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

/** The stretch a row closes: how long it held and how many readings history took in it, never a negative length. */
function closed(span: Record<string, unknown>, at: (atMs: number) => string): string | undefined {
  const {sinceAtMs, lastConfirmedAtMs, confirmations} = span;
  if (!(sinceAtMs === null || instant(sinceAtMs)) || !instant(lastConfirmedAtMs) || !count(confirmations)) return undefined;
  if (sinceAtMs === null) return `${readings(confirmations)} unchanged from an unknown start, the last at ${at(lastConfirmedAtMs)}`;
  if (lastConfirmedAtMs < sinceAtMs) return `${readings(confirmations)} unchanged; the recorded times run backward, so no length is shown`;
  return `${lengthOf(lastConfirmedAtMs - sinceAtMs)} unchanged, ${readings(confirmations)}`;
}

function openSpanNote(span: HistoryOpenSpan, at: (atMs: number) => string): string {
  const {sinceAtMs, lastConfirmedAtMs, confirmations} = span;
  const last = `last reading at ${at(lastConfirmedAtMs)}, ${readings(confirmations)}`;
  if (sinceAtMs === null) return `Unchanged from an unknown start, ${last}`;
  if (lastConfirmedAtMs < sinceAtMs) return `First reading at ${at(sinceAtMs)}, ${last}. The recorded times run backward.`;
  return `Unchanged since ${at(sinceAtMs)}, ${last}`;
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
/** How a row reads. `notes`, present only for a change row with a span, a gap, a closing row or an open span, are lines under the context. */
export type HistoryFace = {title: string; context: string; detail: string; category: Exclude<HistoryCategory, 'All'> | 'Hub'; warning: boolean; notes?: string[]};
const capital = (line: string): string => line.charAt(0).toUpperCase() + line.slice(1);
/**
 * `open` is the entity's open span when this row is the one it continues (`openSpans`); `at` writes a recorded instant.
 * A row without a span, a gap, a closing mark or an open span reads exactly as before #1773.
 */
export function historyFace(row: HistoryRow, open?: HistoryOpenSpan, at: (atMs: number) => string = recordedAt): HistoryFace {
  const data = object(row.record.data) ?? row.record, changed = object(row.record.changed) ?? {};
  const family = text(row.record.family) ?? '';
  const category: HistoryFace['category'] = family === 'session' || /^org\.bunny\.(attention|turn|session)\./.test(row.type) ? 'Agents'
    : row.source === 'bunny/core/automation' || /^org\.bunny\.(automation|rule|routine|moment|mode)\./.test(row.type) || family === 'automation-rule' ? 'Automation'
      : row.source.startsWith('bunny/modules/') || family === 'device' || data.kind === 'device' ? 'Devices' : 'Hub';
  const context = `${text(object(changed.label)?.value) ?? text(changed.label) ?? row.subject} · ${row.source.startsWith('bunny/modules/') ? row.source.slice('bunny/modules/'.length) : category}`;
  let title = `${row.kind} · ${row.subject}`, detail = 'Retained record. No current state is inferred.', warning = false;
  const notes: string[] = [];
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
    const span = object(row.record.span), stretch = span === undefined ? undefined : closed(span, at), gapMs = row.record.gapMs;
    if (row.record.closedBy === 'removal') {
      title = 'Last readings before removal';
      detail = 'This entry closes the readings that held the same state before the record was removed. It changes nothing.';
      if (stretch !== undefined) notes.push(capital(stretch));
    } else {
      if (stretch !== undefined) notes.push(`After ${stretch}`);
      if (typeof gapMs === 'number' && Number.isSafeInteger(gapMs) && gapMs > 0) {
        title = 'Readings resumed';
        detail = 'The recorded times show readings stopped and resumed. This entry does not say why.';
        notes.push(`No reading for ${lengthOf(gapMs)}, then the same state`);
      }
    }
    if (open !== undefined) notes.push(openSpanNote(open, at));
  } else if (row.kind === 'occurrence') {
    const names: Readonly<Record<string, string>> = {'org.bunny.attention.raised': 'Attention requested', 'org.bunny.attention.cleared': 'Attention cleared', 'org.bunny.turn.ended': 'Turn finished', 'org.bunny.session.ended': 'Session ended', 'org.bunny.moment.ended': 'Moment ended'};
    title = names[row.type] ?? 'Event recorded';
    detail = 'The source recorded this event at this time. It does not establish current state.';
  } else if (row.kind === 'removal') {title = 'Record removed';detail = 'This record was removed. No physical effect is implied.';}
  return notes.length === 0 ? {title, context, detail, category, warning} : {title, context, detail, category, warning, notes};
}

export function selectedHistory(rows: readonly HistoryRow[], category: HistoryCategory): HistoryRow[] {
  return rows.filter(row => category === 'All' || historyFace(row).category === category).sort((a, b) => a.atMs === b.atMs ? b.seq - a.seq : b.atMs - a.atMs);
}
