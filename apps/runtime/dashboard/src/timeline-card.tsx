import React, {useId, useState} from 'react';
import {historyFace, selectedHistory, type HistoryCategory, type HistoryPeriod, type HistoryRow} from './timeline-model.ts';
import type {HistorySnapshot} from './timeline-read.ts';
import './timeline-card.css';

function HistoryIcon({category, warning = false}: {category: ReturnType<typeof historyFace>['category']; warning?: boolean}): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {warning ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></>
      : category === 'Devices' ? <><path d="M9 18h6m-5 3h4M8 13a6 6 0 1 1 8 0l-1 2H9Z"/></>
        : category === 'Agents' ? <><rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 3v3M8 11h.01M16 11h.01M8 16h8"/></>
          : category === 'Automation' ? <><path d="m13 2-9 12h7l-1 8 10-12h-7Z"/></>
            : <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
  </svg>;
}

function HistoryEntry({row}: {row: HistoryRow}): React.JSX.Element {
  const face = historyFace(row), at = new Date(row.atMs);
  const close = (host: HTMLElement): void => {
    const entry = host.closest('details');if (entry === null) return;
    entry.open = false;entry.querySelector('summary')?.focus();
  };
  return <li data-history-row={row.seq} data-history-kind={row.kind}>
    <details className="timeline-entry" onKeyDown={event => {if (event.key === 'Escape') {event.stopPropagation();close(event.currentTarget);}}}>
      <summary><span className="timeline-mark" data-warning={face.warning}><HistoryIcon category={face.category} warning={face.warning}/></span>
        <span className="timeline-face"><span className="timeline-title">{face.title}</span><span className="timeline-context">{face.context}</span></span>
        <time dateTime={at.toISOString()} title={at.toLocaleString()}>{at.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}<span>{at.toLocaleDateString([], {month: 'short', day: 'numeric'})}</span></time>
        <span className="timeline-caret" aria-hidden="true">›</span>
      </summary>
      <div className="timeline-evidence"><div className="timeline-evidence-heading"><h3>Evidence</h3><button type="button" className="secondary" aria-label="Close evidence" onClick={event => {close(event.currentTarget);}}>×</button></div>
        <p>{face.detail}</p><dl><div><dt>Source</dt><dd>{row.source}</dd></div><div><dt>Recorded</dt><dd>{at.toLocaleString()}</dd></div></dl>
        <details className="timeline-technical"><summary>Technical record</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
      </div>
    </details>
  </li>;
}

export type TimelineCardProps = {
  snapshot: HistorySnapshot; period: HistoryPeriod; onPeriod: (period: HistoryPeriod) => void; onRefresh: () => void;
  advanced?: React.ReactNode; headingId?: string; connected?: boolean;
};

/** Read-only presentation, identical in a Home placement or the dedicated page. */
export function TimelineCard({snapshot, period, onPeriod, onRefresh, advanced, headingId, connected = true}: TimelineCardProps): React.JSX.Element {
  const uid = useId(), [category, setCategory] = useState<HistoryCategory>('All'), [visible, setVisible] = useState(20);
  const rows = selectedHistory(snapshot.rows, category);
  const failure = snapshot.errorCode === 'invalid-request' ? 'Check filters (invalid-request)'
    : snapshot.errorCode === 'unauthenticated' ? 'Sign in again (unauthenticated)'
      : snapshot.errorCode === 'forbidden' ? 'Access denied (forbidden)'
        : snapshot.errorCode === 'too-large' ? 'History too large (too-large)'
          : snapshot.errorCode === 'internal' ? 'History unavailable (internal)' : 'History unavailable';
  const status = snapshot.phase === 'loading' ? snapshot.readAt === undefined ? 'Loading history…' : 'Refreshing · previous results'
    : snapshot.phase === 'unavailable' ? snapshot.readAt === undefined ? failure : `${failure} · previous results`
      : !connected ? 'Offline · saved history' : '';
  return <div className="timeline-card" data-timeline-card data-history-error={snapshot.errorCode} aria-labelledby={headingId ?? uid}>
    <header className="timeline-heading"><h2 id={headingId ?? uid}>Timeline</h2><div className="timeline-tools">
      <select aria-label="Activity period" value={period} onChange={event => {setVisible(20);onPeriod(event.target.value as HistoryPeriod);}}>
        <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="recent">Recent</option>{period === 'custom' && <option value="custom">Custom</option>}
      </select><button type="button" className="secondary timeline-refresh" aria-label="Refresh history" onClick={onRefresh}>↻</button>
    </div></header>
    <div className="timeline-filters" role="group" aria-label="Activity filters" aria-describedby={`${uid}-window`}>{(['All', 'Agents', 'Devices', 'Automation'] as const).map(value => <button type="button" className="secondary" key={value} aria-pressed={category === value} onClick={() => {setCategory(value);setVisible(20);}}>{value}</button>)}</div>
    <p className="vh" id={`${uid}-window`}>Categories filter only the latest {snapshot.rows.length} loaded entries, up to 200 matching records.</p>
    <p className={status === '' ? 'vh' : 'timeline-status'} role="status">{status !== '' ? status : `${rows.length} history entries.`}</p>
    {snapshot.readAt !== undefined && status === '' && <p className="timeline-read-at">Latest {snapshot.rows.length} · Read {new Date(snapshot.readAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</p>}
    <ol className="timeline-entries" aria-label="Activity entries">{rows.slice(0, visible).map(row => <HistoryEntry key={row.seq} row={row}/>)}</ol>
    {rows.length === 0 && snapshot.phase === 'ready' && <p className="timeline-empty">No matches in these entries</p>}
    {rows.length > visible && <button type="button" className="secondary" onClick={() => {setVisible(count => count + 20);}}>Show more</button>}
    {advanced}
  </div>;
}
