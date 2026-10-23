import React, {useId, useState} from 'react';
import {number} from './wispr-data.js';
import type {WisprSummary} from './wispr-card-data.js';
import './wispr-card.css';

export type WisprCardProps = {summary: WisprSummary; onRefresh: () => void};
const value = (n: number | null, digits = 0): string => n === null ? '—' : number(n, digits);
const weekday = (date: string): string => new Intl.DateTimeFormat(undefined, {weekday: 'short', timeZone: 'UTC'}).format(new Date(date));

/** Presentation only: its owner supplies captured numeric evidence and the explicit read action. */
export function WisprCard({summary: s, onRefresh}: WisprCardProps): React.JSX.Element {
  const [selected, setSelected] = useState<string>();
  const [noteOpen, setNoteOpen] = useState(false);
  const noteId = useId();
  const day = s.days.find(item => item.date === selected) ?? s.days.at(-1);
  const maximum = Math.max(1, ...s.days.map(item => item.words ?? 0));
  const x = (index: number): number => 24 + index * 52;
  const y = (words: number): number => 75 - words / maximum * 60;
  const segments: string[] = [];
  let gap = true;
  for (const [index, item] of s.days.entries()) {
    if (item.words === null) { gap = true; continue; }
    const point = `${x(index)},${y(item.words)}`;
    if (gap) segments.push(point); else segments[segments.length - 1] += ` ${point}`;
    gap = false;
  }
  const hasChart = s.state === 'available' || s.state === 'stale';
  const warning = s.state === 'stale' || s.state === 'unavailable';
  return <article className="widget wispr-card" data-widget="wispr-summary" data-size="small" data-state={s.state} aria-label="Wispr summary" aria-busy={s.loading}>
    <header className="wispr-card-head">
      <div className="wispr-card-identity"><span className="wispr-card-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/></svg></span><h2>Wispr</h2></div>
      <div className="wispr-card-actions">{warning && <button type="button" className="wispr-card-alert" aria-label="Wispr status" aria-expanded={noteOpen} aria-controls={noteId} onClick={() => setNoteOpen(open => !open)}>!</button>}
        <button type="button" className="wispr-card-refresh" aria-label="Refresh Wispr summary" disabled={s.loading} onClick={onRefresh}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></svg></button></div>
    </header>
    <p className="wispr-card-period" role="status">{s.state === 'stale' ? 'Stale · ' : ''}{s.period}</p>
    <dl className="wispr-card-metrics"><div><dt>words</dt><dd>{value(s.words)}</dd></div><div><dt>speaking min</dt><dd>{value(s.minutes, 1)}</dd></div></dl>
    <div className="wispr-card-chart-space">{hasChart ? <figure>
      <figcaption><span>7 days · words</span><span aria-live="polite">{day === undefined ? '' : `${weekday(day.date)} · ${day.words === null ? 'Not observed' : number(day.words)}`}</span></figcaption>
      <svg className="wispr-card-chart" viewBox="0 0 360 90" role="img" aria-label="Captured daily words; missing observations are gaps"><title>Seven-day captured words</title><path className="wispr-card-grid" d="M0 80h360"/>{segments.map((points, index) => <polyline key={index} points={points}/>)}{s.days.map((item, index) => item.words === null ? null : <circle key={item.date} cx={x(index)} cy={y(item.words)} r={day?.date === item.date ? 4 : 2.5}/>)}</svg>
      <div className="wispr-card-days" role="group" aria-label="Captured daily words">{s.days.map(item => <button type="button" key={item.date} aria-pressed={day?.date === item.date} aria-label={`${item.date}: ${item.words === null ? 'Not observed' : `${number(item.words)} words`}`} onClick={() => setSelected(item.date)}>{weekday(item.date)}</button>)}</div>
      <table className="wispr-card-accessible"><caption>Seven-day captured totals</caption><thead><tr><th scope="col">Date</th><th scope="col">Words</th><th scope="col">Speaking minutes</th></tr></thead><tbody>{s.days.map(item => <tr key={item.date}><th scope="row">{item.date}</th><td>{item.words === null ? 'Not observed' : number(item.words)}</td><td>{value(item.minutes, 1)}</td></tr>)}</tbody></table>
    </figure> : <p className="wispr-card-empty">{s.loading ? 'Loading…' : ''}</p>}</div>
    <footer className="wispr-card-foot"><span>{s.observedAt === null ? s.age : <time dateTime={s.observedAt}>{s.age}</time>}</span><a href="#/module/wispr/analytics">Open Wispr <span aria-hidden="true">↗</span></a></footer>
    {warning && <p id={noteId} className="wispr-card-note" hidden={!noteOpen}>{s.note}</p>}
  </article>;
}
