// Collection adapter over the shell's existing session copy; no additional connection or state subscription.
import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {AgentStatusCard, AgentStatusSummary} from './agent-status-card.tsx';
import {LabelEditor} from './label-editor.tsx';
import {PagedList} from './paged-list.tsx';
import {listPageSize} from './paging.ts';
import {matches, needsAttention, sessionRows} from './sessions.ts';
import {Select} from './ui.tsx';

/** How many tile columns the grid lays out now, so a page holds whole rows at any card size. */
function useColumns(): [React.RefObject<HTMLDivElement | null>, number] {
  const grid = useRef<HTMLDivElement>(null), [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const node = grid.current;if (node === null) return;
    const measure = (): void => {setColumns(Math.max(1, getComputedStyle(node).gridTemplateColumns.split(' ').filter(value => value !== '' && value !== 'none').length));};
    measure();
    const observer = new ResizeObserver(measure);observer.observe(node);
    return () => {observer.disconnect();};
  }, []);
  return [grid, columns];
}

export function AgentSessions({records, synced, live, control, now}: {
  records: readonly SessionRecord[]; synced: boolean; live: boolean; control: boolean; now: number;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  // Sessions that need the owner come first, in record order otherwise, so they stay on the first page (#1658).
  const rows = useMemo(() => {const all = sessionRows(records);return [...all.filter(needsAttention), ...all.filter(row => !needsAttention(row))];}, [records]);
  const shown = new Set(records.filter(record => matches(record, query, provider)).map(record => record.id));
  const filtering = query !== '' || provider !== '';
  const providers = [...new Set(['codex', 'claude', ...records.map(record => record.identity.provider)])];
  const [grid, columns] = useColumns();
  const keys = rows.filter(row => shown.has(row.id)).map(row => `${row.id}:${String(row.generation)}`);
  const pageSize = listPageSize.sessionRows * columns, waiting = rows.filter(row => shown.has(row.id) && needsAttention(row)).length;
  return <div className="agent-sessions">
    <AgentStatusSummary rows={rows} live={live}/>
    <div className="filters">
      <label>Find a session<input type="search" maxLength={120} value={query} onChange={event => {setQuery(event.target.value);}} placeholder="Find a session"/></label>
      <Select label="Provider" value={provider} onChange={setProvider} options={[{value: '', label: 'All providers'}, ...providers.map(value => ({value, label: value}))]}/>
    </div>
    {shown.size === 0 && <div className="empty"><h3>{filtering ? 'No matching sessions' : synced ? 'No sessions observed' : 'Sessions not synced yet'}</h3>
      <p>{filtering ? 'Change the filters to see other sessions.' : 'Sessions appear when the core reports them.'}</p></div>}
    <PagedList keys={keys} pageSize={pageSize} label="Agent sessions"
      note={waiting > pageSize ? `${String(waiting)} need you, on the first ${String(Math.ceil(waiting / pageSize))} pages` : undefined}>{visible =>
      <div className="sessions agent-grid" ref={grid}>{rows.map(row => {
        const key = `${row.id}:${String(row.generation)}`;
        return <div key={key} data-paged-key={key} hidden={!visible(key)}>
          <AgentStatusCard row={row} live={live} now={now} actions={control ? <LabelEditor row={row} live={live}/> : undefined}/>
        </div>;
      })}</div>}</PagedList>
  </div>;
}
