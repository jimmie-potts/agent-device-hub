import React, {useEffect, useState} from 'react';
import {childOf} from '@jimmie-potts/sdk/remote';

type Row = {seq: number; atMs: number; kind: string; source: string; subject: string; type: string; requestId: string | null; record: unknown};
/** History is read on entry and explicit filter submission. There is no polling or command path. */
export function Timeline(): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>([]), [status, setStatus] = useState('Loading history…');
  const [kind, setKind] = useState(''), [source, setSource] = useState(''), [session, setSession] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const read = async (query = ''): Promise<void> => {
    setStatus('Loading history…');
    try {
      const response = await fetch(`/api/v2/history${query}`, {cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: childOf(undefined)});
      const answer = await response.json() as {rows?: Row[]; error?: {code?: string}};
      if (!response.ok || !Array.isArray(answer.rows)) { setStatus(`History unavailable: ${answer.error?.code ?? 'invalid reply'}`); return; }
      setRows(answer.rows); setStatus(`${answer.rows.length} history entries. Reading sends no command.`);
    } catch { setStatus('History unavailable. Use Apply filters to read again.'); }
  };
  useEffect(() => { void read(); }, []);
  return <section className="timeline" aria-label="Timeline"><header className="page"><h1>Timeline</h1></header>
    <form onSubmit={event => {
      event.preventDefault(); const filters = new URLSearchParams();
      for (const [key, value] of [['kind', kind], ['source', source], ['session', session]]) if (value !== undefined && value !== '') filters.set(key ?? '', value);
      if (from !== '') filters.set('fromAtMs', String(new Date(from).getTime()));
      if (to !== '') filters.set('toAtMs', String(new Date(to).getTime()));
      void read(`?${filters}`);
    }}>
      <label>From <input type="datetime-local" value={from} onChange={event => { setFrom(event.target.value); }}/></label>
      <label>To <input type="datetime-local" value={to} onChange={event => { setTo(event.target.value); }}/></label>
      <label>Kind <select aria-label="Kind" value={kind} onChange={event => { setKind(event.target.value); }}><option value="">All kinds</option>{['change','removal','occurrence','outcome','operation'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Source <input value={source} onChange={event => { setSource(event.target.value); }} placeholder="bunny/core"/></label>
      <label>Session <input value={session} onChange={event => { setSession(event.target.value); }} placeholder="Qualified session ID"/></label>
      <button>Apply filters</button>
    </form><p role="status">{status}</p>
    <ol>{rows.map(row => <li key={row.seq}><article className="session"><h2>{row.kind} · {row.subject}</h2><p>{new Date(row.atMs).toLocaleString()} · {row.source}</p><p>{row.type}{row.requestId === null ? '' : ` · ${row.requestId}`}</p><details><summary>Evidence</summary><pre>{JSON.stringify(row.record, null, 2)}</pre></details></article></li>)}</ol>
  </section>;
}
