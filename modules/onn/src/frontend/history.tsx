import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import type {FrontendApi, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {HistoryDetail, HistoryObservation, HistoryPage} from '../history-types.js';
import type {Coverage, SessionProjection} from './history-data.js';
import {currentStatus, dateFilters, detailPath, historyPath, readDetail, readPage, readRecord, recordOrder, sessionFacts, timestamp, type Filters, type HistoryRecord} from './history-data.js';
import './history.css';

const EMPTY_FILTERS: Filters = {app:'',from:'',through:'',title:''};
type ReadState<T> = {api: FrontendApi; key: string; data?: T; error?: string};
function useRead<T>(context: FrontendContext, path: string | undefined, attempt: number, owner: string, parse: (value: unknown) => T | undefined): {data?: T; error?: string; loading: boolean} {
  const {api, connected} = context;
  const key = JSON.stringify([path,attempt,owner,connected]);
  const [state,setState] = useState<ReadState<T>>({api,key});
  useEffect(() => {
    let stopped = false;
    setState({api,key});
    if (!connected || path === undefined) return () => {stopped = true;};
    void api.read(path).then(value => {
      if (stopped) return;
      const data = parse(value);
      setState(data === undefined ? {api,key,error:'This read is unavailable or uses an unsupported format.'} : {api,key,data});
    }).catch(() => {if (!stopped) setState({api,key,error:'This read failed. Try refreshing.'});});
    return () => {stopped = true;};
  },[api,connected,path,key,parse]);
  if (!connected) return {error:'Disconnected. Reconnect to read history.',loading:false};
  if (path === undefined) return {loading:false};
  const current = state.api === api && state.key === key ? state : undefined;
  return {loading:current?.data === undefined && current?.error === undefined,...(current?.data !== undefined ? {data:current.data} : {}),...(current?.error !== undefined ? {error:current.error} : {})};
}
function useCurrent(context: FrontendContext, attempt: number): {record?: HistoryRecord; live: boolean; error?: string} {
  const {api,connected} = context;
  const key = JSON.stringify([connected,attempt]);
  const [state,setState] = useState<{api: FrontendApi; key: string; record?: HistoryRecord; live: boolean; error?: string}>({api,key,live:false});
  useEffect(() => {
    let stopped = false, copy: SyncedCopy<HistoryRecord> | undefined, latest: HistoryRecord | undefined;
    let valid = true, live = false;
    setState({api,key,live:false});
    const retire = (error: string): void => {valid = false; latest = undefined; if (!stopped) setState({api,key,live:false,error});};
    const publish = (): void => {if (!stopped && valid) setState({api,key,live,...(latest === undefined ? {} : {record:latest})});};
    const accept = (value: unknown): void => {
      if (stopped || !valid) return;
      const record = readRecord(value);
      if (record === undefined) {retire('Current content is unavailable or uses an unsupported format.'); return;}
      if (latest !== undefined) {
        const order = recordOrder(latest,record);
        if (order === 'ignore') return;
        if (order === 'conflict') {retire('Current content has conflicting evidence. Reload content.'); return;}
      }
      latest = record; publish();
    };
    if (!connected) return () => {stopped = true;};
    void api.sync<HistoryRecord>(['onn-history-state'],change => {
      if (stopped) return;
      if (change.type === 'updated') accept(change.message.data);
      else if (change.type === 'synced') {live = true; publish();}
      else if (change.type === 'failed') {live = false; publish();}
      else if (change.type === 'removed') {latest = undefined; live = false; publish();}
    }).then(result => {
      if (result.status !== 'synced') {if (!stopped) retire('Current content could not be synced. Reload content.'); return;}
      if (stopped) {void result.copy.close().catch(() => {}); return;}
      copy = result.copy;
      const values = [...copy.states()];
      if (values.length > 1) {retire('Current content has conflicting owners. Reload content.'); return;}
      latest = undefined;
      for (const value of values) accept(value.data);
      live = true; publish();
    }).catch(() => {if (!stopped) retire('Current content could not be synced. Reload content.');});
    return () => {stopped = true; void copy?.close().catch(() => {});};
  },[api,connected,key]);
  return state.api === api && state.key === key ? {...(state.record !== undefined ? {record:state.record} : {}),live:state.live && connected,...(state.error !== undefined ? {error:state.error} : {})} : {live:false};
}
function SourceValues({context,session}: {context: FrontendContext; session: SessionProjection}): React.JSX.Element {
  const Facts = context.ui.Facts;
  const facts = sessionFacts(session);
  return <><Facts items={[...facts.slice(0,3),...facts.slice(4,7),...facts.slice(10,12)]}/>
    <details><summary>More source fields</summary><Facts items={[facts[3],...facts.slice(7,10),...facts.slice(12)].filter((item): item is [string,string] => item !== undefined)}/></details>
    {(session.omissions.length > 0 || session.projectionOmissions.length > 0) && <p className="warning">Metadata omissions: {[...session.omissions.map(item => `${item.field}: ${item.reason}`),...session.projectionOmissions.map(item => `${item.field}: projection limit (${item.originalBytes} original bytes)`)].join('; ')}</p>}
  </>;
}
function CoverageView({context,coverage,cutoff}: {context: FrontendContext; coverage: Coverage; cutoff?: number}): React.JSX.Element {
  const Facts = context.ui.Facts;
  return <details className="onn-history-coverage"><summary>{cutoff === undefined ? 'Current collection coverage' : `Retained coverage at evidence cutoff ${cutoff}`}</summary>
    <Facts items={[
      ['Collection started',timestamp(coverage.collectionStartedAtMs)],['Recorded gaps',String(coverage.gapCount)],
      ['Current storage health',coverage.storageAvailable ? 'Available at read time' : 'Unavailable at read time'],
      ['Current unpersisted storage gap',coverage.pendingGap === null ? 'None reported at read time' : `${timestamp(coverage.pendingGap.receivedAtMs)} · poll ${coverage.pendingGap.poll}`],
      ['Evidence','Observations only; gaps do not prove no use'],
      ['Read limits',`${coverage.limits.candidates} candidates per page; ${coverage.limits.textBytes} bytes per text field; ${coverage.limits.responseBytes} response bytes`],
      ['Source limits',`${coverage.limits.sourceSessions} sessions; ${coverage.limits.sourceTextBytes} bytes per text field; ${coverage.limits.sourceReplyBytes} reply bytes`],
    ]}/>
    <p>Recent gaps{cutoff === undefined ? '' : ' within this cutoff'} (up to {coverage.limits.recentGaps}; the count can include older gaps):</p>
    {coverage.recentGaps.length === 0 ? <p>No recorded gaps in this returned window.</p> : <ul>{coverage.recentGaps.map(gap => <li key={gap.sequence}>{timestamp(gap.receivedAtMs)} · {gap.reason} · evidence {gap.sequence} · intake {gap.intakeId} · run {gap.runId} · poll {gap.poll}</li>)}</ul>}
  </details>;
}
function Observation({context,observation}: {context: FrontendContext; observation: HistoryObservation}): React.JSX.Element {
  const Facts = context.ui.Facts;
  return <><SourceValues context={context} session={observation}/><Facts items={[
    ['Observed at (host receive)',timestamp(observation.receivedAtMs)],['Evidence sequence',String(observation.sequence)],
    ['Provenance',`${observation.provenance.source} · ${observation.provenance.readerSchema} · ${observation.provenance.semantics}`],
    ['Reader identity',`${observation.reader.sourceVersion} · ${observation.reader.sha256}`],
    ['Intake / run / poll',`${observation.intakeId} / ${observation.runId} / ${observation.poll}`],['Device elapsed',`${observation.deviceElapsedMs} ms`],
  ]}/></>;
}
export function History({ctx}: {ctx: FrontendContext}): React.JSX.Element {
  const [now,setNow] = useState(Date.now), [currentAttempt,setCurrentAttempt] = useState(0);
  useEffect(() => {const timer = window.setInterval(() => {setNow(Date.now());},1000); return () => {window.clearInterval(timer);};},[]);
  const current = useCurrent(ctx,currentAttempt), record = current.record;
  const owner = record === undefined ? 'unknown' : `${record.id}/${record.configurationRevision}`;
  const [draft,setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [query,setQuery] = useState({filters:EMPTY_FILTERS,path:historyPath(EMPTY_FILTERS),attempt:0});
  const [formError,setFormError] = useState('');
  const [selected,setSelected] = useState<{id: string; path: string; owner: string; attempt: number} | undefined>();
  const history = useRead<HistoryPage>(ctx,query.path,query.attempt,owner,readPage);
  const selection = selected?.owner === owner ? selected : undefined;
  const detailId = selection?.id;
  const detailRegion = useRef<HTMLElement | null>(null), detailTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {if (detailId !== undefined) detailRegion.current?.focus();},[detailId,owner]);
  const parseDetail = useMemo(() => (value: unknown): HistoryDetail | undefined => {const parsed = readDetail(value); return parsed?.occurrence.id === detailId ? parsed : undefined;},[detailId]);
  const detail = useRead<HistoryDetail>(ctx,selection?.path,selection?.attempt ?? 0,owner,parseDetail);
  const id = useId(), Facts = ctx.ui.Facts, Badge = ctx.ui.Badge;
  const status = record === undefined ? undefined : currentStatus(record,current.live,now);
  const boundary = dateFilters(query.filters.from,query.filters.through);
  const search = (): void => {
    try {const filters = {...draft}; const path = historyPath(filters); setQuery(old => ({filters,path,attempt:old.attempt + 1})); setSelected(undefined); setFormError('');}
    catch {setFormError('Choose valid calendar dates in order and a title filter up to 256 characters.');}
  };
  return <div className="onn-history">
    <section aria-label="Current ONN content" className="card">
      <header className="page"><h2>Current ONN content</h2><button className="secondary" disabled={!ctx.connected} onClick={() => {setCurrentAttempt(value => value + 1);}}>Reload content</button></header>
      {current.error !== undefined && <p role="status">{current.error}</p>}
      {record === undefined ? <p role="status">Current content is unknown.</p> : <>
        <p><Badge warning={status !== 'fresh'}>{status === 'fresh' ? 'Fresh observation' : status === 'disabled' ? 'Collection disabled' : status === 'unavailable' ? 'Collection unavailable' : 'Stale observation'}</Badge>{(record.coverage.gapCount > 0 || record.coverage.pendingGap !== null) && <> · <Badge warning>Known collection gaps</Badge></>}</p>
        {!current.live && <p role="status">Current-content sync is stale. Reload content or reconnect.</p>}
        <p>{status === 'fresh' ? 'Latest accepted observation' : 'Last observed; current playback is unknown'}: {timestamp(record.lastAccepted?.receivedAtMs)}. Freshness expires after 15 seconds.</p>
        <details><summary>Observation source</summary><Facts items={[
          ['Source','Android MediaSession'],
          ['Reader identity',record.lastAccepted === null ? 'Unknown' : `${record.lastAccepted.reader.sourceVersion} · ${record.lastAccepted.reader.sha256}`],
          ['Accepted evidence',record.lastAccepted === null ? 'None' : `${record.lastAccepted.sequence} · intake ${record.lastAccepted.intakeId} · run ${record.lastAccepted.runId} · poll ${record.lastAccepted.poll}`],
        ]}/></details>
        {!record.coverage.storageAvailable && <p className="warning">Current collector storage is unavailable. Retained cutoff pages can still contain older evidence.</p>}
        {record.ambiguous && <p className="warning">Multiple supported sessions; current identity is ambiguous.</p>}
        {record.current.length === 0 ? <p>{record.lastAccepted === null ? 'No accepted supported-content sample.' : 'No supported current content in the latest accepted sample.'}</p> : <div className="onn-history-list">{record.current.map((session,index) => <article key={index} aria-label={`Observed session ${index + 1}`}><SourceValues context={ctx} session={session}/></article>)}</div>}
        <CoverageView context={ctx} coverage={record.coverage}/>
      </>}
      <p className="hint">YouTube: selected-title observed. During an ad, the main title can remain visible with ad timing. Reported position and duration do not prove watched time or completion; values are never extrapolated.</p>
    </section>
    <section aria-label="ONN title history" className="card">
      <h2>ONN title history</h2>
      <form autoComplete="off" onSubmit={event => {event.preventDefault(); search();}} aria-describedby={`${id}-boundaries`}>
        <div className="onn-history-filters">
          <label htmlFor={`${id}-app`}>App<select aria-label="App" id={`${id}-app`} value={draft.app} onChange={event => {setDraft(old => ({...old,app:event.target.value as Filters['app']}));}}><option value="">Both apps</option><option value="youtube">YouTube</option><option value="stremio">Stremio</option></select></label>
          <label htmlFor={`${id}-from`}>From date<input id={`${id}-from`} type="date" value={draft.from} onChange={event => {setDraft(old => ({...old,from:event.target.value}));}}/></label>
          <label htmlFor={`${id}-through`}>Through date<input id={`${id}-through`} type="date" value={draft.through} onChange={event => {setDraft(old => ({...old,through:event.target.value}));}}/></label>
          <label htmlFor={`${id}-title`}>Title contains<input id={`${id}-title`} type="text" autoComplete="off" maxLength={256} value={draft.title} onChange={event => {setDraft(old => ({...old,title:event.target.value}));}}/></label>
        </div>
        <p id={`${id}-boundaries`} className="hint">Dates use this browser’s local time zone. From date includes its midnight; Through date includes that whole calendar day and excludes the next midnight. Empty boundaries are unbounded. Times filter host receive timestamps.</p>
        <div className="onn-history-actions"><button type="submit" disabled={!ctx.connected}>Search history</button><button type="button" className="secondary" disabled={!ctx.connected} onClick={() => {setQuery(old => ({filters:old.filters,path:historyPath(old.filters),attempt:old.attempt + 1})); setSelected(undefined); setFormError('');}}>Refresh history</button></div>
      </form>
      {formError !== '' && <p role="alert">{formError} The submitted query below is unchanged.</p>}
      <Facts items={[
        ['Submitted app',query.filters.app === '' ? 'Both apps' : query.filters.app],['Submitted title filter',query.filters.title === '' ? 'None' : query.filters.title],
        ['From (inclusive)',boundary.fromMs === undefined ? 'Unbounded' : `${timestamp(boundary.fromMs)} (${boundary.fromMs} ms)`],
        ['Through boundary (exclusive)',boundary.toMs === undefined ? 'Unbounded' : `${timestamp(boundary.toMs)} (${boundary.toMs} ms)`],
      ]}/>
      {history.loading && <p role="status">Loading history…</p>}{history.error !== undefined && <p role="status">{history.error}</p>}
      {history.data !== undefined && <>
        <p>Evidence cutoff {history.data.cutoff} · newest evidence first · bounded page of up to 50 records.</p>
        {history.data.items.length === 0 && <p>No matching titles in this page.{history.data.nextCursor !== null ? ' More evidence windows are available.' : ' No continuation in this query.'}</p>}
        <ol className="onn-history-list">{history.data.items.map(item => <li key={item.id} aria-label={`Occurrence ${item.id}`}><article>
          <h3>{item.observation.metadata?.title ?? item.observation.metadata?.displayTitle ?? 'Unknown title'}</h3>
          <p>{item.app === 'youtube' ? 'YouTube · selected-title observed' : 'Stremio · title observed'}</p>
          <Facts items={[
            ['Occurrence',item.id],['First observed',timestamp(item.firstObservedAtMs)],['Matching observation',timestamp(item.matchingObservedAtMs)],
            ['Identity',item.identityConfidence === 'source-id' ? 'Source ID continuity' : item.identityConfidence === 'ambiguous' ? 'Ambiguous; title alone does not establish identity' : 'Unsupported identity; title alone does not join observations'],
          ]}/><SourceValues context={ctx} session={item.observation}/>
          <button className="secondary" aria-controls={selection === undefined ? undefined : `${id}-detail`} onClick={event => {detailTrigger.current = event.currentTarget; setSelected(old => ({id:item.id,path:detailPath(item.id),owner,attempt:(old?.attempt ?? 0) + 1}));}}>View observations</button>
        </article></li>)}</ol>
        {history.data.pageOmissions.length > 0 && <p className="warning">Response limit reached; continue to inspect remaining evidence.</p>}
        <button className="secondary" disabled={history.data.nextCursor === null || !ctx.connected} onClick={() => {const cursor = history.data?.nextCursor; if (cursor == null) return; setQuery(old => ({...old,path:historyPath(old.filters,cursor),attempt:old.attempt + 1})); setSelected(undefined);}}>Next history page</button>
        <CoverageView context={ctx} coverage={history.data.coverage} cutoff={history.data.cutoff}/>
      </>}
    </section>
    {selection !== undefined && <section id={`${id}-detail`} ref={detailRegion} tabIndex={-1} className="card" aria-label="ONN observation detail">
      <header className="page"><h2>ONN observation detail · {selection.id}</h2><button className="secondary" onClick={() => {setSelected(undefined); detailTrigger.current?.focus();}}>Close details</button></header>
      {detail.loading && <p role="status">Loading observations…</p>}{detail.error !== undefined && <p role="status">{detail.error}</p>}
      {detail.data !== undefined && <>
        <p>Evidence cutoff {detail.data.cutoff} · occurrence {detail.data.occurrence.id} · identity {detail.data.occurrence.identityConfidence}.</p>
        {detail.data.observations.length === 0 && <p>No observations in this page.{detail.data.nextCursor !== null && ' More evidence windows are available.'}</p>}
        <ol className="onn-history-list">{detail.data.observations.map(observation => <li key={observation.id}><article aria-label={`Observation ${observation.id}`}><h3>Observation {observation.id}</h3><Observation context={ctx} observation={observation}/></article></li>)}</ol>
        {detail.data.pageOmissions.length > 0 && <p className="warning">Response limit reached; continue to inspect remaining observations.</p>}
        <button className="secondary" disabled={detail.data.nextCursor === null || !ctx.connected} onClick={() => {const cursor = detail.data?.nextCursor; if (cursor == null) return; setSelected(old => old === undefined ? undefined : {...old,path:detailPath(old.id,cursor),attempt:old.attempt + 1});}}>Next observation page</button>
        <CoverageView context={ctx} coverage={detail.data.coverage} cutoff={detail.data.cutoff}/>
      </>}
    </section>}
  </div>;
}
