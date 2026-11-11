import React, {useId, useState} from 'react';
import {historyFace, selectedHistory, type HistoryCategory, type HistoryPeriod, type HistoryRow} from './timeline-model.ts';
import type {HistorySnapshot} from './timeline-read.ts';
import {PagedList} from './paged-list.tsx';
import {fitRows, listFit, listPageSize} from './paging.ts';
import {useHomeCardBox} from './home-shape-context.ts';
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

function HistoryEntry({row, hidden}: {row: HistoryRow; hidden: boolean}): React.JSX.Element {
  const face = historyFace(row), at = new Date(row.atMs);
  const close = (host: HTMLElement): void => {
    const entry = host.closest('details');if (entry === null) return;
    entry.open = false;entry.querySelector('summary')?.focus();
  };
  return <li data-history-row={row.seq} data-history-kind={row.kind} data-paged-key={String(row.seq)} hidden={hidden}>
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
  /** Entries per page: the Home card's size by default; the dedicated page shows more. */
  pageSize?: number;
};

/** Read-only presentation, identical in a Home placement or the dedicated page. */
export function TimelineCard({snapshot, period, onPeriod, onRefresh, advanced, headingId, connected = true, pageSize = listPageSize.timeline}: TimelineCardProps): React.JSX.Element {
  const uid = useId(), [category, setCategory] = useState<HistoryCategory>('All');
  const rows = selectedHistory(snapshot.rows, category);
  const failure = snapshot.errorCode === 'invalid-request' ? 'Check filters (invalid-request)'
    : snapshot.errorCode === 'unauthenticated' ? 'Sign in again (unauthenticated)'
      : snapshot.errorCode === 'forbidden' ? 'Access denied (forbidden)'
        : snapshot.errorCode === 'too-large' ? 'History too large (too-large)'
          : snapshot.errorCode === 'internal' ? 'History unavailable (internal)' : 'History unavailable';
  const status = snapshot.phase === 'loading' ? snapshot.readAt === undefined ? 'Loading history…' : 'Refreshing · previous results'
    : snapshot.phase === 'unavailable' ? snapshot.readAt === undefined ? failure : `${failure} · previous results`
      : !connected ? 'Offline · saved history' : '';
  // In a Home shape (#1672) one row shows the latest entries and Open Timeline; Tall adds the period and paging; the
  // category filters stay in Large square and on the Timeline page.
  const box = useHomeCardBox(), shape = box?.shape, oneRow = shape === 'square' || shape === 'wide', filters = shape === undefined || shape === 'large-square';
  // In a Home shape (#1672) a page holds the closed entries that fit below the heading, the Tall link or the Large
  // square filters, and the status line.
  const fit = listFit.timeline;
  const chrome = shape === 'tall' ? fit.tallHeading + fit.tallLink : shape === 'large-square' ? fit.heading + fit.filters : fit.heading;
  // A refresh never changes the page size: Tall and Large square always reserve the status line's height, and the
  // one-row shapes show it over the card's bottom edge instead of in the flow.
  const size = box === undefined ? pageSize : fitRows(box.height - listFit.frame - chrome - (oneRow ? 0 : fit.status), fit.row, rows.length, 0, !oneRow);
  // A shape without the category buttons shows every category, so no hidden filter narrows its list.
  if (!filters && category !== 'All') setCategory('All');
  return <div className="timeline-card" data-timeline-card data-history-error={snapshot.errorCode} aria-labelledby={headingId ?? uid}>
    <header className="timeline-heading"><h2 id={headingId ?? uid}>Timeline</h2>{oneRow ? <a className="timeline-open" href="#/timeline">Open Timeline</a> : <div className="timeline-tools">
      <select aria-label="Activity period" value={period} onChange={event => {onPeriod(event.target.value as HistoryPeriod);}}>
        <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="recent">Recent</option>{period === 'custom' && <option value="custom">Custom</option>}
      </select><button type="button" className="secondary timeline-refresh" aria-label="Refresh history" onClick={onRefresh}>↻</button>
    </div>}</header>
    {shape === 'tall' && <a className="timeline-open" href="#/timeline">Filters on the Timeline page</a>}
    {filters && <div className="timeline-filters" role="group" aria-label="Activity filters" aria-describedby={`${uid}-window`}>{(['All', 'Agents', 'Devices', 'Automation'] as const).map(value => <button type="button" className="secondary" key={value} aria-pressed={category === value} onClick={() => {setCategory(value);}}>{value}</button>)}</div>}
    <p className="vh" id={`${uid}-window`}>Categories filter only the latest {snapshot.rows.length} loaded entries, up to 200 matching records.</p>
    <p className={status === '' && box === undefined ? 'vh' : 'timeline-status'} role="status">{status !== '' ? status : box === undefined ? `${rows.length} history entries.` : <span className="vh">{rows.length} history entries.</span>}</p>
    {snapshot.readAt !== undefined && status === '' && shape === undefined && <p className="timeline-read-at">Latest {snapshot.rows.length} · Read {new Date(snapshot.readAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</p>}
    <PagedList keys={rows.map(row => String(row.seq))} pageSize={size} pager={!oneRow} label="Timeline" resetKey={`${category}:${period}`}>{shown =>
      <ol className="timeline-entries" aria-label="Activity entries">{rows.map(row => <HistoryEntry key={row.seq} row={row} hidden={!shown(String(row.seq))}/>)}</ol>}</PagedList>
    {rows.length === 0 && snapshot.phase === 'ready' && <p className="timeline-empty">No matches in these entries</p>}
    {shape === undefined && advanced}
  </div>;
}
