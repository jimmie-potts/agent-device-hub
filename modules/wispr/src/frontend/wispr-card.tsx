import React, {useId, useState} from 'react';
import type {FrontendPresentation} from '@jimmie-potts/sdk/frontend';
import {number} from './wispr-data.js';
import type {WisprSummary} from './wispr-card-data.js';
import './wispr-card.css';

/**
 * `shape` is the Home shape the shell places the card in (#1672 PR B). One unit shows the totals, and the seven-day line
 * where its cell is tall enough; Wide sets the line beside the totals; Tall and Large square add its caption and day
 * choices. Without it the card is in full.
 */
export type WisprCardProps = {summary: WisprSummary; onRefresh: () => void; shape?: FrontendPresentation['shape']};
const value = (n: number | null, digits = 0): string => n === null ? '—' : number(n, digits);
const weekday = (date: string): string => new Intl.DateTimeFormat(undefined, {weekday: 'short', timeZone: 'UTC'}).format(new Date(date));

/** Presentation only: its owner supplies captured numeric evidence and the explicit read action. */
export function WisprCard({summary: s, onRefresh, shape}: WisprCardProps): React.JSX.Element {
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
  // Wide and one unit show the line without its caption and day choices; one unit shows it only where its cells are
  // tall enough (wispr-card.css).
  const days = shape !== 'wide' && shape !== 'square';
  const stroke = shape === undefined ? {} : {vectorEffect: 'non-scaling-stroke' as const};
  const metrics = <dl className="wispr-card-metrics"><div><dt>words</dt><dd>{value(s.words)}</dd></div><div><dt>speaking min</dt><dd>{value(s.minutes, 1)}</dd></div></dl>;
  const trend = <div className="wispr-card-chart-space">{hasChart ? <figure>
    {days && <figcaption><span>7 days · words</span><span aria-live="polite">{day === undefined ? '' : `${weekday(day.date)} · ${day.words === null ? 'Not observed' : number(day.words)}`}</span></figcaption>}
    {/* In a Home shape the line stretches to the room its card leaves; strokes and round dots keep their size. */}
    <svg className="wispr-card-chart" viewBox="0 0 360 90" role="img" aria-label="Captured daily words; missing observations are gaps" {...(shape === undefined ? {} : {preserveAspectRatio: 'none'})}><title>Seven-day captured words</title><path className="wispr-card-grid" d="M0 80h360" {...stroke}/>{segments.map((points, index) => <polyline key={index} points={points} {...stroke}/>)}{s.days.map((item, index) => item.words === null ? null
      : shape === undefined ? <circle key={item.date} cx={x(index)} cy={y(item.words)} r={day?.date === item.date ? 4 : 2.5}/>
        : <path key={item.date} className="wispr-card-dot" data-selected={day?.date === item.date} d={`M${String(x(index))} ${String(y(item.words))}h0`} vectorEffect="non-scaling-stroke"/>)}</svg>
    {days && <div className="wispr-card-days" role="group" aria-label="Captured daily words">{s.days.map(item => <button type="button" key={item.date} aria-pressed={day?.date === item.date} aria-label={`${item.date}: ${item.words === null ? 'Not observed' : `${number(item.words)} words`}`} onClick={() => setSelected(item.date)}>{weekday(item.date)}</button>)}</div>}
    <div className="wispr-card-accessible"><table><caption>Seven-day captured totals</caption><thead><tr><th scope="col">Date</th><th scope="col">Words</th><th scope="col">Speaking minutes</th></tr></thead><tbody>{s.days.map(item => <tr key={item.date}><th scope="row">{item.date}</th><td>{item.words === null ? 'Not observed' : number(item.words)}</td><td>{value(item.minutes, 1)}</td></tr>)}</tbody></table></div>
  </figure> : <p className="wispr-card-empty">{s.loading ? 'Loading…' : ''}</p>}</div>;
  return <article className="widget wispr-card" data-widget="wispr-summary" data-size="small" data-shape={shape} data-state={s.state} aria-label="Wispr summary" aria-busy={s.loading}>
    <header className="wispr-card-head">
      <div className="wispr-card-identity"><span className="wispr-card-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/></svg></span><h2>Wispr</h2></div>
      <div className="wispr-card-actions">{warning && <button type="button" className="wispr-card-alert" aria-label="Wispr status" aria-expanded={noteOpen} aria-controls={noteId} onClick={() => setNoteOpen(open => !open)}>!</button>}
        <button type="button" className="wispr-card-refresh" aria-label="Refresh Wispr summary" disabled={s.loading} onClick={onRefresh}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></svg></button></div>
    </header>
    <p className="wispr-card-period" role="status">{s.state === 'stale' ? 'Stale · ' : ''}{s.period}</p>
    {shape === 'wide' ? <div className="wispr-card-body">{metrics}{trend}</div> : <>{metrics}{trend}</>}
    <footer className="wispr-card-foot"><span>{s.observedAt === null ? s.age : <time dateTime={s.observedAt}>{s.age}</time>}</span><a href="#/module/wispr/analytics">Open Wispr <span aria-hidden="true">↗</span></a></footer>
    {warning && <p id={noteId} className="wispr-card-note" hidden={!noteOpen}>{s.note}</p>}
  </article>;
}
