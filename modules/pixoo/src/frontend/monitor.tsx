// Adapted from divoom-app-upgrade apps/web/src/monitor.tsx (0777479c): cached previews, view filters and consumer-only dismissal.
import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {DisplayRecord, Filter} from '../module/schemas.js';
import {PreviewFrame} from './preview.js';

type Props = {context: FrontendContext; device: DeviceRecord | undefined; display: DisplayRecord | undefined; live: boolean};
// Browser projections contain data only; importing the Node helper's class-derived types would traverse implementations.
type MonitorSessionRow = Pick<SessionRecord, 'id' | 'identity' | 'title' | 'project' | 'projectId' | 'activity' | 'freshness'
  | 'observedAtMs' | 'lastEvidenceAtMs' | 'children' | 'attention' | 'unavailable' | 'notices'> & {label?: string};
type MonitorSessionPage = {items: MonitorSessionRow[]; total: number; offset: number; limit: number};
type MonitorReading = {status: {lastOutcome: {status: string} | null}; rendition: {frames: string[]; frameDelayMs: number | null};
  playback: {source: 'current' | 'stale' | 'unavailable'; frame: string | null;
    view: {card: false} | {card: true; status: 'playing' | 'paused'; title: string; artist: string; stale: boolean}}};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const codeOf = (error: unknown): string => object(error) && object(error.body) && object(error.body.error) && typeof error.body.error.code === 'string'
  ? error.body.error.code : 'unavailable';
function readingOf(value: unknown): MonitorReading {
  if (!object(value) || !object(value.status) || !object(value.status.configuration) || !object(value.rendition)
    || !Array.isArray(value.rendition.frames) || value.rendition.frames.length > 2
    || !value.rendition.frames.every((ref: unknown) => typeof ref === 'string' && /^monitor-frame\.[0-9]+\.[01]$/.test(ref))
    || !object(value.playback) || !object(value.playback.view) || typeof value.playback.view.card !== 'boolean'
    || !(value.playback.frame === null || value.playback.frame === 'now-playing-frame')) throw new Error('invalid monitor');
  return value as MonitorReading;
}
function pageOf(value: unknown): MonitorSessionPage {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 100 || !Number.isSafeInteger(value.total)
    || !Number.isSafeInteger(value.offset) || !Number.isSafeInteger(value.limit) || !value.items.every((item: unknown) => object(item)
      && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && object(item.identity) && typeof item.identity.sessionId === 'string'
      && Array.isArray(item.notices) && Array.isArray(item.attention) && Array.isArray(item.unavailable) && object(item.children))) throw new Error('invalid sessions');
  return value as MonitorSessionPage;
}
function matches(row: MonitorSessionRow, filter: Filter): boolean {
  return (filter.q === undefined || [row.label, row.title?.value, row.project, row.identity.sessionId].some(value => value?.toLowerCase().includes(filter.q?.toLowerCase() ?? '') === true))
    && (filter.provider === undefined || row.identity.provider === filter.provider)
    && (filter.projectId === undefined || row.projectId === filter.projectId)
    && (filter.session === undefined || Object.entries(filter.session).every(([key, value]) => row.identity[key as keyof typeof row.identity] === value));
}
function Pixels({context, refs, delay, revision, label}: {context: FrontendContext; refs: readonly string[]; delay: number | null; revision: number | undefined; label: string}): React.JSX.Element {
  const [bitmaps, setBitmaps] = useState<ImageBitmap[]>([]), [index, setIndex] = useState(0), [failure, setFailure] = useState<string>();
  const key = JSON.stringify(refs);
  useEffect(() => {
    let disposed = false;
    const owned: ImageBitmap[] = [];
    setBitmaps([]); setIndex(0); setFailure(undefined);
    // The generation owns these cached pixels. Every decoded bitmap is closed when that generation changes.
    void (async () => {
      try {
        for (const ref of JSON.parse(key) as string[]) {
          const bitmap = await createImageBitmap(await context.api.image(`/modules/pixoo/content/${ref}`));
          if (disposed) { bitmap.close(); return; }
          owned.push(bitmap);
        }
        if (!disposed) setBitmaps([...owned]);
      } catch (error) { if (!disposed) setFailure(codeOf(error)); }
    })();
    return () => { disposed = true; for (const bitmap of owned) bitmap.close(); };
  }, [context.api, key, revision]);
  useEffect(() => {
    if (bitmaps.length < 2 || delay === null || delay < 1) return;
    // This local preview animation performs no network reads or commands.
    const timer = window.setInterval(() => { setIndex(value => (value + 1) % bitmaps.length); }, delay);
    return () => { window.clearInterval(timer); };
  }, [bitmaps.length, delay]);
  return failure !== undefined ? <p role="alert">Preview unavailable ({failure}).</p> : bitmaps.length === 0
    ? <p>Updating exact preview…</p> : <PreviewFrame bitmap={bitmaps[index]} label={label}/>;
}
function Controls({context, device, display, live, reading, sessions, current, command}: Props & {
  device: DeviceRecord; reading: MonitorReading | undefined; sessions: readonly MonitorSessionRow[]; current: boolean; command: FrontendCommand;
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>({}), [cadence, setCadence] = useState(1000), [choice, setChoice] = useState('off');
  const [failure, setFailure] = useState<string>();
  const submitting = useRef(false);
  const filterKey = JSON.stringify(display?.monitor.filter ?? {});
  useEffect(() => { setFilter(JSON.parse(filterKey) as Filter); setCadence(display?.monitor.cadenceMs ?? 1000); }, [filterKey, display?.monitor.cadenceMs]);
  useEffect(() => { setChoice(display?.nowPlaying.media ?? 'off'); }, [display?.nowPlaying.media]);
  const blocked = !context.control ? 'Read-only access.' : !context.connected || !live || !current ? 'Monitor records are stale.'
    : !context.operationsLive ? 'Command records are stale.' : command.locked ? 'Wait for the current command result.' : undefined;
  const run = (family: string, data: object): void => {
    if (blocked !== undefined || submitting.current) return;
    submitting.current = true; setFailure(undefined);
    void command.run({family, target: device.id, requestId: crypto.randomUUID(), data: {...data,
      expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation}})
      .catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  };
  const update = (key: 'q' | 'provider' | 'projectId', value: string): void => setFilter(previous => {
    const next = {...previous}; if (value === '') delete next[key]; else Object.assign(next, {[key]: value}); return next;
  });
  const projects = [...new Set([...sessions.flatMap(row => row.projectId === undefined ? [] : [row.projectId]), ...(filter.projectId === undefined ? [] : [filter.projectId])])].sort();
  const validCadence = Number.isSafeInteger(cadence) && cadence >= 1000 && cadence <= 10000;
  const dirty = JSON.stringify(filter) !== filterKey || cadence !== display?.monitor.cadenceMs;
  const {Select} = context.ui;
  return <>
    {context.control ? <>
      <div className="actions">
        <button type="button" disabled={blocked !== undefined || display?.mode === 'monitor'} onClick={() => { run('device-mode-set', {mode: 'monitor'}); }}>Show monitor</button>
        <button type="button" className="secondary" disabled={blocked !== undefined || display?.mode === 'media'} onClick={() => { run('device-mode-set', {mode: 'media'}); }}>Select Media</button>
      </div>
      <fieldset disabled={blocked !== undefined}><legend>Monitor view</legend>
        <label>Session search<input aria-label="Session search" maxLength={120} value={filter.q ?? ''} onChange={event => { update('q', event.target.value); }}/></label>
        <Select label="Provider filter" value={filter.provider ?? ''} onChange={value => { update('provider', value); }} options={[{value: '', label: 'All providers'}, {value: 'codex', label: 'Codex'}, {value: 'claude', label: 'Claude'}]}/>
        <Select label="Project filter" value={filter.projectId ?? ''} onChange={value => { update('projectId', value); }} options={[{value: '', label: 'All projects'}, ...projects.map(value => ({value, label: value}))]}/>
        <Select label="Session filter" value={filter.session === undefined ? '' : JSON.stringify(filter.session)} onChange={value => { setFilter(previous => {
          const next = {...previous}; if (value === '') delete next.session; else next.session = JSON.parse(value) as NonNullable<Filter['session']>; return next;
        }); }} options={[{value: '', label: 'All sessions'}, ...sessions.map(row => ({value: JSON.stringify(row.identity), label: `${row.label ?? row.title?.value ?? row.identity.sessionId} · ${row.identity.provider} · ${row.identity.hostId}`}))]}/>
        <label>Minimum update interval (ms)<input aria-label="Monitor cadence" type="number" min={1000} max={10000} step={1000} value={cadence} onChange={event => { setCadence(Number(event.target.value)); }}/></label>
        <button type="button" disabled={!dirty || !validCadence} onClick={() => { if (dirty && validCadence) run('pixoo-monitor-set', {filter, cadenceMs: cadence}); }}>Apply monitor view</button>
      </fieldset>
    </> : <p className="hint">Read-only access.</p>}
    <p className="hint">Monitor pauses media. Selecting Media leaves it paused until you start or resume. Opening this page does not activate monitoring.</p>
    <h3>Now playing</h3>
    {reading?.playback.view.card === true ? <p>{reading.playback.view.status === 'playing' ? 'Playing' : 'Paused'}{reading.playback.view.stale ? ' (stale)' : ''}: {reading.playback.view.title === '' ? 'Unknown title' : reading.playback.view.title} · {reading.playback.view.artist === '' ? 'Unknown artist' : reading.playback.view.artist}</p> : <p>Nothing playing.</p>}
    <p>Hub playback: {reading?.playback.source ?? 'unavailable'}. Media option: {display?.nowPlaying.media ?? 'unknown'}. Takeover: {display?.nowPlaying.takeover ?? 'none'}.</p>
    {reading?.playback.frame !== null && reading?.playback.frame !== undefined
      && <Pixels context={context} refs={[reading.playback.frame]} delay={null} revision={display?.revision} label="Exact now-playing preview"/>}
    {context.control && <>
      <Select label="Now playing in Media" value={choice} onChange={setChoice} options={[{value: 'off', label: 'Off'}, {value: 'popup', label: 'Pop-up for 10 seconds'}, {value: 'whole', label: 'Whole song'}]}/>
      <button type="button" disabled={blocked !== undefined || choice === display?.nowPlaying.media} onClick={() => { run('pixoo-now-playing-set', {media: choice}); }}>Set now playing</button>
    </>}
    <p className="hint">In Monitor, a new track shows its card briefly unless a session needs attention. In Media, Pop-up and Whole song pause an active playlist for the card. Manual controls cancel automatic resume.</p>
    <p role="status">{failure ?? command.text}</p>
    {context.control && blocked !== undefined && <p className="hint">{blocked}</p>}
    <div className="monitor-sessions">{sessions.filter(row => matches(row, display?.monitor.filter ?? {})).map(row => {
      const name = row.label ?? row.title?.value ?? row.identity.sessionId;
      return <article className="widget" key={row.id}>
        <h3>{name}</h3>
        <p>{row.identity.provider} · {row.activity} · {row.freshness} · {row.identity.sessionId}</p>
        <p>Project: {row.project ?? 'Unknown'}. Children: {row.children.active} active, {row.children.uncertain} uncertain.</p>
        <p>Observed: {new Date(row.observedAtMs).toISOString()}. Last evidence: {new Date(row.lastEvidenceAtMs).toISOString()}.</p>
        {row.attention.length > 0 && <p>Attention: {row.attention.map(item => item.kind).join(', ')}.</p>}
        {row.unavailable.map((item, index) => <p key={index}>Unavailable {item.dimension}: {item.reason}.</p>)}
        {row.notices.map(notice => notice.acknowledgedBy.includes('pixoo') ? <p key={notice.id}>Notice dismissed on Pixoo.</p>
          : <div key={notice.id}><p>Finished turn notice. Dismissing affects Pixoo only.</p>{context.control && <button type="button" className="secondary" aria-label={`Dismiss notice for ${name}`} disabled={blocked !== undefined}
            onClick={() => { run('pixoo-notice-dismiss', {session: row.id, noticeId: notice.id}); }}>Dismiss turn-ended notice</button>}</div>)}
      </article>;
    })}</div>
  </>;
}

export function MonitorPage(props: Props): React.JSX.Element {
  const {context, device, display, live} = props;
  const [reading, setReading] = useState<MonitorReading>(), [sessions, setSessions] = useState<MonitorSessionPage>();
  const [failure, setFailure] = useState<string>(), [loading, setLoading] = useState(false), [sampleRevision, setSampleRevision] = useState<number>();
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const revision = display?.revision;
  useEffect(() => {
    let disposed = false; setFailure(undefined); setLoading(true);
    if (revision === undefined) { setReading(undefined); setSessions(undefined); setLoading(false); return; }
    void Promise.all([context.api.read('/modules/pixoo/content/monitor').then(readingOf),
      context.api.read(`/modules/pixoo/content/monitor-sessions?offset=${offset}&limit=25`).then(pageOf)])
      .then(([summary, page]) => { if (!disposed) { setReading(summary); setSessions(page); setSampleRevision(revision); setLoading(false); } })
      .catch((error: unknown) => { if (!disposed) { setFailure(codeOf(error)); setReading(undefined); setSessions(undefined); setLoading(false); } });
    return () => { disposed = true; };
  }, [context.api, revision, offset, refresh]);
  const current = context.connected && live && sampleRevision === revision && reading !== undefined && sessions !== undefined && !loading && failure === undefined;
  const {Badge, Facts, Command} = context.ui;
  return <section className="widget" aria-label="Pixoo monitor">
    <header className="widget-head"><h2>Agent monitor</h2><Badge warning={!current}>{current ? 'Current' : 'Stale'}</Badge></header>
    <button type="button" className="secondary" disabled={loading} onClick={() => { setRefresh(value => value + 1); }}>Refresh monitor</button>
    {failure !== undefined && <p role="alert">Monitor unavailable ({failure}). Refresh to try again.</p>}
    <p>{display?.participating === true ? 'Monitor presentation active' : 'Monitor presentation inactive'}</p>
    <Facts items={[
      ['Selected mode', display?.mode ?? 'Unknown'], ['Source', display?.monitor.connection ?? 'unavailable'],
      ['Matching sessions', display?.monitor.matched ?? 'Unknown'], ['Attention', display?.monitor.attention ?? 'Unknown'],
      ['Display page', display === undefined ? 'Unknown' : `${display.monitor.page + 1} of ${display.monitor.pages}`], ['Pending mode', display?.pendingMode ?? 'none'],
    ]}/>
    <p><a href="#/sessions">Edit session labels</a></p>
    {reading?.status.lastOutcome !== null && reading?.status.lastOutcome !== undefined && <p>Last monitor transport: {reading.status.lastOutcome.status}. This does not prove visible output.</p>}
    {reading !== undefined && <Pixels context={context} refs={reading.rendition.frames} delay={reading.rendition.frameDelayMs} revision={undefined} label="Exact monitor preview"/>}
    {device === undefined ? <p role="status">The Pixoo owner has no device record.</p>
      : <Command context={context} target={device.id} key={device.id}>{command =>
        <Controls {...props} device={device} reading={reading} sessions={sessions?.items ?? []} current={current} command={command}/>
      }</Command>}
    {sessions !== undefined && <>
      <p>Session records {sessions.total === 0 ? 0 : offset + 1}–{offset + sessions.items.length} of {sessions.total}. Saved filters apply to rows on this page.</p>
      <div className="actions"><button type="button" className="secondary" disabled={loading || offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 25)); }}>Previous sessions</button>
        <button type="button" className="secondary" disabled={loading || offset + sessions.items.length >= sessions.total} onClick={() => { setOffset(value => value + 25); }}>Next sessions</button></div>
    </>}
    <p className="hint">Cached previews are illustrative. A pending preview stays pending until the existing presentation renders it.</p>
  </section>;
}
