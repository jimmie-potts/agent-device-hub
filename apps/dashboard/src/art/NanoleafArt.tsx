/* The shared Nanoleaf device art (ADR 0007, Hub #355): one React host around the Prism renderer for the Lines
   and the triangle renderer for the Panels, with a schematic strip when the physical layout is unavailable.
   The host issues no request and opens no device state; the page passes it what the hub has read. */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Renderer, color} from './prism';
import {PanelsRenderer} from './panels';
import {prismLayout, panelsLayout, presentation, strip, fallbackReason, type GeometryRead, type ArtSnapshot, type ElementStatus, type StatusTokens} from './nanoleaf';

export type NanoleafArtProps = {
 /** Names the device in the figure's label and caption, such as the component alias. */
 title: string;
 /** The page's latest geometry read, or undefined before the first read. */
 read: GeometryRead | undefined;
 /** The page's latest `nanoleaf.integration/1.0` snapshot, or undefined when none was read. */
 snapshot: ArtSnapshot | undefined;
 /** True while the page's last device read failed; the art stays and is marked stale. */
 stale: boolean;
 /** Per-element task status. The hub snapshot carries none today; consumers with a source pass it here. */
 status?: Record<string, ElementStatus>;
 /** Elements whose task is active; the Work flow runs on them. Derived from status, never from device frames. */
 activity?: string[];
 selection?: string[];
 onSelect?: (id: string) => void;
 /** Play the opening assembly once on first draw (skipped under reduced motion). Default true. */
 assemble?: boolean;
};
// Used only when a skin token is missing: a visible neutral, never a status meaning.
const NEUTRAL = '#808080';
/** The fixed-meaning wall status colors from the application skin (`--wall-*`). */
export function readStatusTokens(root: Element = document.documentElement): StatusTokens {
 const style = getComputedStyle(root), pick = (name: string) => color(style.getPropertyValue('--wall-' + name).trim()) ?? NEUTRAL;
 return {working: pick('working'), question: pick('question'), blocked: pick('blocked'), unread: pick('unread')};
}
type Art = Renderer | PanelsRenderer;
export function NanoleafArt({title, read, snapshot, stale, status, activity, selection, onSelect, assemble = true}: NanoleafArtProps) {
 const host = useRef<HTMLDivElement>(null), art = useRef<Art | null>(null), select = useRef(onSelect); select.current = onSelect;
 const [tokens] = useState(readStatusTokens);
 const geometry = read?.geometry, kind: 'lines' | 'panels' = geometry?.kind === 'panels' ? 'panels' : 'lines';
 const lines = useMemo(() => prismLayout(geometry), [geometry]), panels = useMemo(() => lines ? undefined : panelsLayout(geometry), [geometry, lines]);
 const layoutKey = useMemo(() => lines ? 'lines:' + JSON.stringify(lines) : panels ? 'panels:' + JSON.stringify(panels) : '', [lines, panels]);
 const elements = useMemo(() => lines ? lines.lines.map(l => ({id: String(l.id), number: l.number ?? l.id})) : panels ? panels.elements.map(e => ({id: e.id, number: e.number})) : [], [layoutKey]);
 const drawable = layoutKey !== '';
 useEffect(() => {
  if (!host.current || !drawable) return;
  const pick = (_event: Event, element: {id: string}) => select.current?.(element.id);
  if (lines) { if (art.current instanceof Renderer) art.current.setLayout(lines); else { art.current?.destroy(); art.current = new Renderer(host.current, lines, {animate: assemble, onSelect: pick}); } }
  else if (panels) { if (art.current instanceof PanelsRenderer) art.current.setLayout(panels); else { art.current?.destroy(); art.current = new PanelsRenderer(host.current, panels, {onSelect: pick}); } }
 }, [layoutKey]);
 useEffect(() => () => { art.current?.destroy(); art.current = null; }, []);
 const view = useMemo(() => drawable ? presentation({kind, elements, snapshot, status, activity, tokens}) : undefined, [kind, elements, snapshot, status, activity, tokens, drawable]);
 useEffect(() => {
  const current = art.current; if (!current || !view) return;
  for (const [id, colors] of view.colors) current.setColors(id, colors);
  current.setMode(view.mode); current.setActivity(view.activity); current.setPending(view.pending); current.setLineMetadata(view.metadata);
  current.setSelection((selection ?? []).filter(id => view.colors.has(id)));
 }, [view, layoutKey, selection]);
 const cells = useMemo(() => drawable ? [] : strip({read, snapshot, status, tokens}), [drawable, read, snapshot, status, tokens]);
 const shown = Object.keys(status ?? {}).length > 0, style = snapshot?.settings.style;
 const count = drawable ? elements.length : cells.length, noun = kind === 'lines' ? (count === 1 ? 'Line' : 'Lines') : (count === 1 ? 'Panel' : 'Panels');
 const sentences = [
  drawable ? `${count} ${noun} from the controller’s saved layout.` : `Physical layout unavailable: ${fallbackReason(read)}. Showing one cell per element.`,
  snapshot ? `Mode ${snapshot.mode}.` : 'Mode unknown: no integration snapshot.',
  snapshot ? (style === 'project' ? 'Signature zones show reservation colors.' : 'Classic layout: reservations are not drawn.') : '',
  shown ? '' : 'Task status isn’t in the hub snapshot, so no task is shown.',
 ].filter(Boolean).join(' ');
 return <figure className="device-art" data-art-state={stale ? 'stale' : drawable ? 'drawn' : 'schematic'} data-art-kind={kind} aria-label={`${title} device art`}>
  <div ref={host} className="device-art-host" hidden={!drawable}/>
  {!drawable && (cells.length ? <ol className="art-strip" aria-label={`${title} elements`}>{cells.map(cell => { const selected = !!selection?.includes(cell.id); return <li key={cell.id}><button type="button" className={'art-cell' + (selected ? ' selected' : '') + (cell.pending ? ' pending' : '')} aria-pressed={selected} aria-label={cell.label} onClick={() => onSelect?.(cell.id)}><span style={{background: cell.colors[0]}}/><span style={{background: cell.colors[1]}}/><small>{cell.number}</small></button></li>; })}</ol> : <p className="hint">No elements to show yet.</p>)}
  <figcaption>{stale && <span className="warning">Stale: showing the last snapshot. </span>}{sentences}</figcaption>
 </figure>;
}
