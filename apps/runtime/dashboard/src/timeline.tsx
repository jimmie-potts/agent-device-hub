import React, {useEffect, useRef, useState} from 'react';
import {childOf} from '@jimmie-potts/sdk/remote';
import {TimelineCard} from './timeline-card.tsx';
import {emptyHistoryFilters, historyQuery, type HistoryFilters, type HistoryPeriod} from './timeline-model.ts';
import {createHistoryReader, type HistorySnapshot} from './timeline-read.ts';

/** Transport adapter: entry and explicit reads only, no subscription, polling or command path. */
export function TimelinePanel({headingId, connected = true}: {headingId?: string; connected?: boolean}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>({rows: [], phase: 'loading', readAt: undefined});
  const [period, setPeriod] = useState<HistoryPeriod>('today'), [draft, setDraft] = useState(emptyHistoryFilters);
  const [invalid, setInvalid] = useState('');
  const applied = useRef<HistoryFilters>(emptyHistoryFilters()), selection = useRef<HistoryPeriod>('today');
  const reader = useRef<ReturnType<typeof createHistoryReader> | undefined>(undefined);
  useEffect(() => {
    const active = createHistoryReader((query, signal) => fetch(`/api/v2/history${query}`, {signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: childOf(undefined)}), setSnapshot);
    reader.current = active;void active.read(historyQuery(selection.current, applied.current));
    return () => {active.dispose();reader.current = undefined;};
  }, []);
  const read = (nextPeriod: HistoryPeriod, filters: HistoryFilters): void => {
    try {
      const query = historyQuery(nextPeriod, filters);
      applied.current = {...filters};selection.current = nextPeriod;setPeriod(nextPeriod);setInvalid('');
      void reader.current?.read(query);
    } catch {setInvalid('Check the date range.');}
  };
  const edit = (field: keyof HistoryFilters, value: string): void => {setDraft(previous => ({...previous, [field]: value}));};
  return <TimelineCard snapshot={snapshot} period={period} onPeriod={next => {
    setDraft(previous => ({...previous, from: '', to: ''}));read(next, {...applied.current, from: '', to: ''});
  }} connected={connected} {...(headingId === undefined ? {} : {headingId})}
    onRefresh={() => {read(selection.current, applied.current);}} advanced={<details className="timeline-advanced"><summary>Filters</summary>
      <form onSubmit={event => {event.preventDefault();read('custom', draft);}}>
        <label>From<input type="datetime-local" value={draft.from} onChange={event => {edit('from', event.target.value);}}/></label>
        <label>To<input type="datetime-local" value={draft.to} onChange={event => {edit('to', event.target.value);}}/></label>
        <label>Kind<select aria-label="Kind" value={draft.kind} onChange={event => {edit('kind', event.target.value);}}><option value="">All kinds</option>{['change', 'removal', 'occurrence', 'outcome', 'operation'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Source<input value={draft.source} onChange={event => {edit('source', event.target.value);}} placeholder="bunny/core"/></label>
        <label>Session<input value={draft.session} onChange={event => {edit('session', event.target.value);}} placeholder="Qualified session ID"/></label>
        <button type="submit">Apply filters</button>
      </form>{invalid !== '' && <p role="alert">{invalid}</p>}
    </details>}/>;
}

export function Timeline({connected = true}: {connected?: boolean}): React.JSX.Element {
  return <section className="timeline" aria-label="Timeline"><h1 className="vh">Timeline</h1>
    <article className="widget"><TimelinePanel connected={connected}/></article>
  </section>;
}
