import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import type {FrontendApi, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {VolcanoStatus} from '../status-document.js';
import {bucketLabel, clock, dayLabel, sessionRow, shiftDay, thresholdValue, timelineRows, totalsLine, volcanoNow} from './card-data.js';
import {gapsDocument, sessionsDocument, timelineDocument, totalsDocument, type SessionsDocument} from './documents.js';
import {CONTENT, useRead, useReadKey, useVolcanoStatus} from './reads.js';
import './volcano-card.css';

type Tab = 'now' | 'timeline' | 'sessions' | 'totals' | 'gaps';
const tabs: readonly {id: Tab; label: string}[] = [{id: 'now', label: 'Now'}, {id: 'timeline', label: 'Timeline'}, {id: 'sessions', label: 'Sessions'}, {id: 'totals', label: 'Totals'}, {id: 'gaps', label: 'Gaps'}];
type Source = {api: FrontendApi | undefined; id: string; refresh: string};

function Art(): React.JSX.Element {
  return <div className="volcano-art" role="img" aria-label="Illustration of a VOLCANO HYBRID">
    <svg viewBox="0 0 200 124" aria-hidden="true">
      <ellipse className="volcano-shadow" cx="100" cy="112" rx="72" ry="9"/>
      <path className="volcano-body" d="M50 108 66 30a6 6 0 0 1 6-5h56a6 6 0 0 1 6 5l16 78a4 4 0 0 1-4 5H54a4 4 0 0 1-4-5Z"/>
      <path className="volcano-top" d="M78 25V15a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v10Z"/>
      <rect className="volcano-panel" x="70" y="48" width="60" height="34" rx="5"/>
      <rect className="volcano-screen" x="77" y="54" width="46" height="12" rx="2"/>
      <circle className="volcano-key" cx="85" cy="74" r="3.5"/><circle className="volcano-key" cx="100" cy="74" r="3.5"/><circle className="volcano-key" cx="115" cy="74" r="3.5"/>
    </svg>
  </div>;
}

function Refusal({code, what}: {code: ErrorCode | undefined; what: string}): React.JSX.Element | null {
  return code === undefined ? null : <p className="volcano-note" role="alert">{what} unavailable: {code}.</p>;
}
function Pager({older, newer, onOlder, onNewer, olderLabel, newerLabel}: {older: boolean; newer: boolean; onOlder: () => void; onNewer: () => void; olderLabel: string; newerLabel: string}): React.JSX.Element | null {
  if (!older && !newer) return null;
  return <div className="volcano-pager"><button type="button" className="secondary" disabled={!newer} onClick={onNewer}>{newerLabel}</button><button type="button" className="secondary" disabled={!older} onClick={onOlder}>{olderLabel}</button></div>;
}
/** A stack of cursors, emptied when the documents they count change, such as a saved threshold. */
function useCursors(reset: string): {current: string | undefined; depth: number; push: (next: string) => void; pop: () => void} {
  const [state, setState] = useState<{reset: string; cursors: readonly string[]}>({reset, cursors: []});
  const cursors = state.reset === reset ? state.cursors : [];
  return {
    current: cursors.at(-1), depth: cursors.length,
    push: next => { setState({reset, cursors: [...cursors, next]}); },
    pop: () => { setState({reset, cursors: cursors.slice(0, -1)}); },
  };
}
const withCursor = (path: string, cursor: string | undefined): string => (cursor === undefined ? path : `${path}&cursor=${encodeURIComponent(cursor)}`);

function TimelinePanel({api, id, refresh, now}: Source & {now: number}): React.JSX.Element {
  const today = shiftDay(now, 0);
  const [day, setDay] = useState(today);
  const pages = useCursors(`${id}:${String(day)}`);
  const decode = useMemo(() => (value: unknown) => timelineDocument(value, id), [id]);
  const path = withCursor(`${CONTENT}timeline?from=${String(day)}&to=${String(shiftDay(day, 1) - 1)}&limit=200`, pages.current);
  const read = useRead(api, api === undefined ? undefined : path, refresh, decode);
  const rows = useMemo(() => timelineRows(read?.value?.facts ?? []), [read?.value]);
  return <>
    <div className="volcano-day"><button type="button" className="secondary" onClick={() => { setDay(shiftDay(day, -1)); }}>Previous day</button><strong>{dayLabel(day)}<span className="volcano-local">Local time</span></strong><button type="button" className="secondary" disabled={day >= today} onClick={() => { setDay(shiftDay(day, 1)); }}>Next day</button></div>
    <Refusal code={read?.error} what="The timeline is"/>
    {read?.value === undefined ? read?.error === undefined && <p className="volcano-note" role="status">{api === undefined ? 'The timeline is unavailable.' : 'Loading the timeline.'}</p>
      : read.value.facts.length > 0 && rows.length === 0 ? <p className="volcano-note">No heating, pump or gap changes on this page.</p>
      : pages.depth > 0 && rows.length === 0 ? <p className="volcano-note">Nothing more for this day.</p>
      : rows.length === 0 ? <p className="volcano-note">Nothing recorded for this day. That is not evidence of no use: the collector may not have been running.</p>
        : <ul className="volcano-rows">{rows.map(row => <li key={row.key} data-kind={row.kind}><span className="volcano-row-title">{row.title}</span>{row.detail !== '' && <span className="volcano-row-detail">{row.detail}</span>}</li>)}</ul>}
    <Pager older={typeof read?.value?.next === 'string'} newer={pages.depth > 0} olderLabel="Later" newerLabel="Earlier" onOlder={() => { const next = read?.value?.next; if (typeof next === 'string') pages.push(next); }} onNewer={pages.pop}/>
  </>;
}

const stretchCount = (count: number): string => `${String(count)} stretch${count === 1 ? '' : 'es'}`;
function SessionList({doc, current}: {doc: SessionsDocument; current: boolean}): React.JSX.Element {
  return <ul className="volcano-rows">{doc.sessions.map(session => {
    const row = sessionRow(session, current);
    return <li key={row.key} data-kind="session" data-partial={row.partial}>
      <span className="volcano-row-title">{row.start}</span><span className="volcano-row-detail">{row.end}</span>
      {row.note !== '' && <span className="volcano-row-detail volcano-partial">{row.note}</span>}
      <dl className="volcano-facts">{row.facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    </li>;
  })}</ul>;
}
function SessionsPanel({api, id, refresh, gapMinutes, current}: Source & {gapMinutes: number | undefined; current: boolean}): React.JSX.Element {
  const pages = useCursors(`${id}:${String(gapMinutes)}`);
  const decode = useMemo(() => (value: unknown) => sessionsDocument(value, id), [id]);
  const read = useRead(api, api === undefined ? undefined : withCursor(`${CONTENT}sessions?limit=25`, pages.current), refresh, decode);
  return <>
    <p className="volcano-note">Heater activity{read?.value === undefined ? '' : `, grouped when less than ${String(read.value.gapMinutes)} min apart`}. Not consumption or dose. Times are local to this browser.</p>
    <Refusal code={read?.error} what="The session list is"/>
    {read?.value === undefined ? read?.error === undefined && <p className="volcano-note" role="status">{api === undefined ? 'The session list is unavailable.' : 'Loading sessions.'}</p>
      : read.value.sessions.length === 0 ? <p className="volcano-note">No sessions recorded yet.</p> : <SessionList doc={read.value} current={current}/>}
    <Pager older={typeof read?.value?.next === 'string'} newer={pages.depth > 0} olderLabel="Older" newerLabel="Newer" onOlder={() => { const next = read?.value?.next; if (typeof next === 'string') pages.push(next); }} onNewer={pages.pop}/>
  </>;
}

function TotalsPanel({api, id, refresh}: Source): React.JSX.Element {
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const pages = useCursors(`${id}:${zone}`);
  const decode = useMemo(() => (value: unknown) => totalsDocument(value, id), [id]);
  const read = useRead(api, api === undefined ? undefined : withCursor(`${CONTENT}totals?zone=${encodeURIComponent(zone)}&limit=31`, pages.current), refresh, decode);
  return <>
    <p className="volcano-note">Per day in {read?.value?.zone ?? zone}. Observed time excludes unobserved intervals; credit is the counter's gain across them.</p>
    <Refusal code={read?.error} what="The daily totals are"/>
    {read?.value === undefined ? read?.error === undefined && <p className="volcano-note" role="status">{api === undefined ? 'The daily totals are unavailable.' : 'Loading totals.'}</p>
      : read.value.days.length === 0 ? <p className="volcano-note">No days recorded yet.</p>
        : <ul className="volcano-rows">{read.value.days.map(day => <li key={day.date} data-kind="day"><span className="volcano-row-title">{day.date}</span><span className="volcano-row-detail">{totalsLine(day)}</span></li>)}</ul>}
    <Pager older={typeof read?.value?.next === 'string'} newer={pages.depth > 0} olderLabel="Older" newerLabel="Newer" onOlder={() => { const next = read?.value?.next; if (typeof next === 'string') pages.push(next); }} onNewer={pages.pop}/>
  </>;
}

function GapsPanel({context, api, id, refresh, doc, live}: Source & {context: FrontendContext; doc: VolcanoStatus | undefined; live: boolean}): React.JSX.Element {
  const decode = useMemo(() => (value: unknown) => gapsDocument(value, id), [id]);
  const read = useRead(api, api === undefined ? undefined : `${CONTENT}gaps`, refresh, decode);
  const saved = doc?.gapMinutes;
  const [draft, setDraft] = useState<string | undefined>();
  const [asked, setAsked] = useState<number | undefined>();
  const text = draft ?? (saved === undefined ? '' : String(saved));
  const value = thresholdValue(text);
  const decodePreview = useMemo(() => (input: unknown) => sessionsDocument(input, id, asked), [id, asked]);
  const decodeSaved = useMemo(() => (input: unknown) => sessionsDocument(input, id, saved), [id, saved]);
  const preview = useRead(api, api === undefined || asked === undefined ? undefined : `${CONTENT}sessions?limit=25&gapMinutes=${String(asked)}`, refresh, decodePreview);
  const current = useRead(api, api === undefined || asked === undefined ? undefined : `${CONTENT}sessions?limit=25`, refresh, decodeSaved);
  const counted = (result: SessionsDocument | undefined): string => (result === undefined ? 'unknown' : `${String(result.sessions.length)}${result.next === null ? '' : '+'} session${result.sessions.length === 1 && result.next === null ? '' : 's'}`);
  const buckets = read?.value?.buckets ?? [];
  const largest = Math.max(1, ...buckets.map(bucket => bucket.count));
  const uid = useId();
  const Command = context.ui.Command;
  const controls = (command: FrontendCommand): React.JSX.Element => {
    const blocked = !context.control || !live || doc === undefined || command.locked;
    return <>
      <div className="volcano-threshold">
        <label htmlFor={`${uid}-gap`}>Session gap (1 to 240 min)</label>
        <input id={`${uid}-gap`} type="number" inputMode="numeric" min="1" max="240" step="1" value={text} aria-invalid={value === undefined} onChange={event => { setDraft(event.currentTarget.value); }}/>
        <button type="button" className="secondary" disabled={value === undefined || api === undefined} onClick={() => { setAsked(value); }}>Preview</button>
        <button type="button" disabled={blocked || value === undefined || value === saved} onClick={() => {
          if (doc !== undefined && value !== undefined) void command.run({family: 'volcano-session-gap', target: doc.id, requestId: crypto.randomUUID(), data: {gapMinutes: value, expectedConfigurationRevision: doc.configurationRevision}});
        }}>Save</button>
      </div>
      {value === undefined && <p className="volcano-note" role="alert">Enter a whole number of minutes from 1 to 240.</p>}
      {!context.control && <p className="volcano-note">Saving needs control access. Previews still work.</p>}
      {command.text !== '' && <p className="volcano-note" role="status">{command.text}</p>}
    </>;
  };
  return <>
    <Refusal code={read?.error} what="The gap distribution is"/>
    {read?.value === undefined ? read?.error === undefined && <p className="volcano-note" role="status">{api === undefined ? 'The gap distribution is unavailable.' : 'Loading the gap distribution.'}</p>
      : buckets.every(bucket => bucket.count === 0) ? <p className="volcano-note">No separations between heating stretches yet.</p>
        : <ul className="volcano-buckets" aria-label="Time between heating stretches">{buckets.filter(bucket => bucket.count > 0).map(bucket => <li key={bucket.fromMinutes} data-threshold={saved !== undefined && saved >= bucket.fromMinutes && (bucket.toMinutes === null || saved < bucket.toMinutes)}>
          <span className="volcano-bucket-label">{bucketLabel(bucket)}</span><span className="volcano-bucket-track" aria-hidden="true"><span style={{width: `${String((bucket.count / largest) * 100)}%`}}/></span>
          <span className="volcano-bucket-count">{bucket.count}{bucket.uncertain > 0 && ` (${String(bucket.uncertain)} uncertain)`}</span>
        </li>)}</ul>}
    <Command context={context} target={id}>{controls}</Command>
    {asked !== undefined && <section aria-label="Regroup preview" className="volcano-preview">
      <Refusal code={preview?.error ?? current?.error} what="The preview is"/>
      <p className="volcano-note" role="status">At {asked} min: {counted(preview?.value)}. Saved threshold: {counted(current?.value)}. Nothing is stored by a preview.</p>
      {preview?.value !== undefined && preview.value.sessions.length > 0 && <ul className="volcano-rows">{preview.value.sessions.slice(0, 5).map(session => <li key={session.startAtMs} data-kind="preview"><span className="volcano-row-title">{clock(session.startAtMs)}</span><span className="volcano-row-detail">{stretchCount(session.stretches.length + session.omittedStretches)}</span></li>)}</ul>}
    </section>}
  </>;
}

export type VolcanoWidgetProps = {context: FrontendContext; expectedTarget?: string | undefined; label?: string | undefined};
/** Scoped reads on the shell participant. The threshold save is its one command, and it never reaches the device. */
export function VolcanoWidget({context, expectedTarget, label = 'Volcano'}: VolcanoWidgetProps): React.JSX.Element {
  const uid = useId(), warningButton = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0), [tab, setTab] = useState<Tab>('now'), [note, setNote] = useState(false), [now, setNow] = useState(Date.now);
  const view = useVolcanoStatus(context, attempt, expectedTarget);
  const doc = view?.doc;
  const live = context.connected && view?.live === true;
  useEffect(() => { const timer = window.setInterval(() => { setNow(Date.now()); }, 1000); return () => { window.clearInterval(timer); }; }, []);
  const data = volcanoNow({doc, connected: context.connected, live, error: view?.error, now});
  const refresh = useReadKey(doc?.revision, `${String(attempt)}:${String(doc?.gapMinutes)}`);
  const id = expectedTarget ?? doc?.id ?? 'volcano';
  const source: Source = {api: context.connected && context.module === 'volcano' && doc !== undefined ? context.api : undefined, id, refresh};
  const warning = data.notices.length > 0;
  return <article className="widget volcano-card" data-volcano-card="tabs" data-device={id} data-state={data.freshness} aria-label={`${label} card`}
    onKeyDown={event => { if (event.key === 'Escape' && note) { setNote(false); warningButton.current?.focus(); } }}>
    <header className="volcano-head"><div><h2>{label}</h2><p className="volcano-state" aria-live="polite">{data.title}</p></div>
      {warning && <button ref={warningButton} type="button" className="volcano-warning" aria-label="Volcano status" aria-expanded={note} aria-controls={`${uid}-notice`} onClick={() => { setNote(value => !value); }}><span aria-hidden="true">!</span></button>}
    </header>
    <div className="volcano-notice" id={`${uid}-notice`} hidden={!warning || !note}>
      {data.notices.map(message => <p key={message}>{message}</p>)}<button type="button" className="secondary" onClick={() => { setAttempt(value => value + 1); }}>Reload observations</button>
    </div>
    <Art/>
    <div className="volcano-tabs" role="tablist" aria-label="Volcano information" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = tabs.findIndex(value => value.id === tab);
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (next !== undefined) { setTab(next.id); document.getElementById(`${uid}-${next.id}`)?.focus(); }
    }}>{tabs.map(value => <button type="button" key={value.id} role="tab" id={`${uid}-${value.id}`} aria-controls={`${uid}-${value.id}-panel`} aria-selected={tab === value.id} tabIndex={tab === value.id ? 0 : -1} onClick={() => { setTab(value.id); }}>{value.label}</button>)}</div>
    <div className="volcano-plane">
      <section role="tabpanel" id={`${uid}-now-panel`} aria-labelledby={`${uid}-now`} hidden={tab !== 'now'} tabIndex={0}>
        <dl className="volcano-facts volcano-now">
          <div><dt>Heater</dt><dd>{data.heater}</dd></div><div><dt>Pump</dt><dd>{data.pump}</dd></div>
          <div><dt>Temperature</dt><dd>{data.current}</dd></div><div><dt>Target</dt><dd>{data.target}</dd></div>
          <div><dt>Heating counter</dt><dd>{data.counter}</dd></div>
          <div><dt>Last change seen</dt><dd>{data.lastSeen}<span className="volcano-age"> · {data.lastSeenAge}</span></dd></div>
        </dl>
      </section>
      <section role="tabpanel" id={`${uid}-timeline-panel`} aria-labelledby={`${uid}-timeline`} hidden={tab !== 'timeline'} tabIndex={0}><TimelinePanel {...source} now={now}/></section>
      <section role="tabpanel" id={`${uid}-sessions-panel`} aria-labelledby={`${uid}-sessions`} hidden={tab !== 'sessions'} tabIndex={0}><SessionsPanel {...source} gapMinutes={doc?.gapMinutes} current={data.freshness === 'current'}/></section>
      <section role="tabpanel" id={`${uid}-totals-panel`} aria-labelledby={`${uid}-totals`} hidden={tab !== 'totals'} tabIndex={0}><TotalsPanel {...source}/></section>
      <section role="tabpanel" id={`${uid}-gaps-panel`} aria-labelledby={`${uid}-gaps`} hidden={tab !== 'gaps'} tabIndex={0}><GapsPanel {...source} context={context} doc={doc} live={live}/></section>
    </div>
  </article>;
}
