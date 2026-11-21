import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import type {LightingLayoutRecord, LightingSelection, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {useAttempt} from './command-control.tsx';
import {homeLine} from './home-line.ts';
import {emptyLightingLayout, groupCards, lightingDevices, plugDevices, resolveCard, unitKey, type GroupUnit} from './lighting.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import './fuse.css';

/**
 * Fuse (#1933): on Home, a light or a plug dragged by its handle onto another light, plug or group groups them.
 *
 * The handle starts a pointer drag (mouse, pen and touch alike). Its Home card follows the pointer; the glass layer reads
 * the card's moved box and joins it to the panels it nears. A light, plug or group card under the pointer is the target:
 * it is marked `data-fuse-target` and `data-glass-target`, so it lights up on the glass and in Quiet glass. Dropping on a
 * target groups the two with `groupCards` and saves the lighting layout through the existing `lighting-layout-set`; the
 * core folds their Home cards into the group's card in the same transaction. Dropping anywhere else, Escape or a
 * cancelled pointer returns the card. A refused or failed save changes nothing and says "Not grouped". Rooms and every
 * other card are not targets. The keyboard path is each card's "Group with" selector, which offers the same units.
 * Near the window's top or bottom edge a drag scrolls the page. A lost pointer capture, Escape, leaving Home or
 * grouping becoming unavailable ends a drag and returns the card. Read-only sessions, stale records, an unresolved save
 * and Edit Home show no handle.
 */
export type FuseOption = {key: string; unit: GroupUnit; name: string};
export type Fuse = {
  /** Whether grouping can be saved now. */
  editable: boolean;
  /** The other units shown on Home that the unit `key` can be grouped with, in Home order. */
  options: (key: string) => FuseOption[];
  /** Groups `first` with `second` (the first's members come first) and saves the layout. */
  group: (first: GroupUnit, second: GroupUnit) => void;
  /** Shows a Home card's own note (a local refusal) on Home's one status line until a newer save result; '' clears it. */
  say: (text: string) => void;
  /** The drag handle for a unit's card, or nothing while grouping cannot be saved. */
  handle: (unit: GroupUnit, name: string) => React.ReactNode;
};
const FuseContext = createContext<Fuse | undefined>(undefined);
/** The Home fuse, or undefined off Home. */
export const useFuse = (): Fuse | undefined => useContext(FuseContext);

/** How far the pointer moves before a press on the handle becomes a drag, in CSS pixels. */
const DRAG_SLOP = 4;
/** How long a card takes to return after its drop (the reference's 340 ms). */
const RETURN_MS = 340;

/** How near the window's top or bottom edge a drag scrolls the page, and how fast at the edge, in CSS pixels a frame. */
const EDGE = 56, SCROLL = 14;

/** A drag: where it started (pointer and page scroll), the pointer now, its target and its auto-scroll frame. */
type Drag = {pointer: number; unit: GroupUnit; panel: HTMLElement; x: number; y: number; px: number; py: number; sx: number; sy: number; moved: boolean; target: HTMLElement | null; scroll: number; armed: boolean};

function mark(element: HTMLElement | null, on: boolean): void {
  if (element === null) return;
  if (on) {element.dataset['fuseTarget'] = '';element.dataset['glassTarget'] = '';} else {delete element.dataset['fuseTarget'];delete element.dataset['glassTarget'];}
}
/**
 * Eases a card back from where it was dropped, on a time base, so the glass follows it home frame by frame; a card that
 * groups jumps when its save lands (one frame, as #1932's liquid only follows panels that animate).
 */
function returnHome(panel: HTMLElement, dx: number, dy: number): void {
  const view = panel.ownerDocument.defaultView;
  // The panel stays marked dragged until it is home, so the glass layer keeps reading it as moving (it turns liquid).
  const done = (): void => {panel.style.removeProperty('transform');if (panel.getAttribute('style') === '') panel.removeAttribute('style');delete panel.dataset['glassDragged'];};
  if (view === null || view.matchMedia('(prefers-reduced-motion: reduce)').matches || (dx === 0 && dy === 0)) {done();return;}
  const start = view.performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / RETURN_MS), left = (1 - t) ** 4;
    if (t >= 1) {done();return;}
    panel.style.transform = `translate(${String(dx * left)}px, ${String(dy * left)}px)`;view.requestAnimationFrame(step);
  };
  view.requestAnimationFrame(step);
}
const offsetOf = (panel: HTMLElement): [number, number] => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(panel.style.transform);
  return match === null ? [0, 0] : [Number(match[1]), Number(match[2])];
};

export function FuseProvider({runtime, connected, operations, operationsLive, units, selections, enabled, refresh, children}: {
  runtime: RuntimeData; connected: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  /** The light (light or group) and plug units shown on Home, in Home order. */
  units: readonly GroupUnit[];
  /** Every light card shown on Home, rooms included: the lighting Home selection a group save keeps. */
  selections: readonly LightingSelection[];
  /** Reads current records again after a save whose result needs attention. */
  refresh: () => Promise<void>;
  /** False while Home is being edited. */
  enabled: boolean; children: React.ReactNode;
}): React.JSX.Element {
  const devices = lightingDevices(runtime.copies, connected), plugs = plugDevices(runtime.copies, connected);
  const layoutCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'lighting-layout');
  const record = (layoutCopy?.records as readonly LightingLayoutRecord[] | undefined)?.find(item => item.id === 'lighting');
  const layout = record?.layout ?? emptyLightingLayout();
  // The same attempt as every lighting card's layout saves, so there is one save at a time and its lock is shared.
  const command = useAttempt('lighting', operations, operationsLive);
  const editable = enabled && runtime.control && connected && layoutCopy?.synced === true && record !== undefined && operationsLive && !command.locked;
  // The line's inputs (home-line.ts): a card's note and the latest save, stamped from one counter so the newer shows.
  const stamps = useRef({counter: 0, key: '', save: 0});
  const saveKey = `${command.requestId ?? ''}|${command.text}|${String(command.locked)}`;
  if (saveKey !== stamps.current.key) {stamps.current.key = saveKey;stamps.current.counter += 1;stamps.current.save = stamps.current.counter;}
  const [note, setNote] = useState<{text: string; stamp: number}>(), [grouping, setGrouping] = useState<{requestId: string; text: string}>();
  const say = (text: string): void => {stamps.current.counter += 1;setNote(text === '' ? undefined : {text, stamp: stamps.current.counter});};
  const nameOf = (unit: GroupUnit): string => unit.kind === 'plug'
    ? plugs.find(item => item.record.id === unit.id && item.owner === unit.owner)?.record.label ?? unit.id : resolveCard(unit, layout, devices).name;
  const group = (first: GroupUnit, second: GroupUnit): void => {
    if (!editable || record === undefined) {say('Not grouped: layout changes are unavailable until records are current and the last save is resolved.');return;}
    const next = groupCards(layout, 'home', first, second, devices, crypto.randomUUID(), selections, plugs);
    if (typeof next === 'string') {say(`Not grouped: ${next}.`);return;}
    const requestId = crypto.randomUUID();setNote(undefined);setGrouping({requestId, text: `Grouping ${nameOf(first)} with ${nameOf(second)}.`});
    void command.run({family: 'lighting-layout-set', target: 'lighting', requestId, data: {expectedRevision: record.revision, layout: next}});
  };
  // The latest save's state, every one that needs attention included (uncertain and conflicting stay locked), or a
  // card's newer note. Home's cards leave every layout result to this one line.
  const line = homeLine({save: {requestId: command.requestId, text: command.text, locked: command.locked}, saveStamp: stamps.current.save,
    ...(grouping === undefined ? {} : {grouping}), ...(note === undefined ? {} : {note})});
  const latest = useRef({units, group, editable});latest.current = {units, group, editable};
  const drag = useRef<Drag | null>(null);
  const finish = useRef((drop: boolean): void => {
    const current = drag.current;drag.current = null;if (current === null) return;
    if (current.scroll !== 0) cancelAnimationFrame(current.scroll);
    const {panel, target, moved, unit} = current;delete panel.dataset['fuseDragging'];mark(target, false);
    const [dx, dy] = offsetOf(panel);returnHome(panel, dx, dy);
    const found = target === null ? undefined : latest.current.units.find(item => unitKey(item) === target.dataset['homeCard']);
    if (drop && moved && found !== undefined && panel.isConnected) latest.current.group(found, unit);
  }).current;
  // The card follows the pointer, with what the page has scrolled since the drag began, and the card under the pointer
  // is the target; rooms and other cards are never targets.
  const place = useRef((current: Drag): void => {
    const dx = current.px - current.x + (scrollX - current.sx), dy = current.py - current.y + (scrollY - current.sy);
    current.panel.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;
    const known = new Set(latest.current.units.map(unitKey));known.delete(unitKey(current.unit));
    const target = [...(current.panel.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-home-card]') ?? [])].find(element => {
      if (element === current.panel || !known.has(element.dataset['homeCard'] ?? '')) return false;
      const box = element.getBoundingClientRect();return current.px >= box.left && current.px <= box.right && current.py >= box.top && current.py <= box.bottom;
    }) ?? null;
    if (target !== current.target) {mark(current.target, false);mark(target, true);current.target = target;}
  }).current;
  // Near the window's top or bottom edge the page scrolls under the dragged card, so a card below the fold, or above
  // it, can be reached by touch, where the handle keeps the page from scrolling itself.
  const autoScroll = useRef((current: Drag): void => {
    // A drag that starts near an edge scrolls nothing until the pointer has been away from the edges once.
    const inZone = current.py < EDGE || current.py > innerHeight - EDGE;
    if (!inZone) current.armed = true;
    if (!current.armed) return;
    const speed = (): number => current.py < EDGE ? -SCROLL * (EDGE - current.py) / EDGE : current.py > innerHeight - EDGE ? SCROLL * (current.py - innerHeight + EDGE) / EDGE : 0;
    if (current.scroll !== 0 || speed() === 0) return;
    const tick = (): void => {
      current.scroll = 0;if (drag.current !== current) return;
      const step = speed(), before = scrollY;if (step === 0) return;
      scrollBy(0, step);if (scrollY === before) return;
      place(current);current.scroll = requestAnimationFrame(tick);
    };
    current.scroll = requestAnimationFrame(tick);
  }).current;
  // Escape returns a dragged card, and so do leaving Home and grouping becoming unavailable mid-drag.
  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {if (event.key === 'Escape' && drag.current !== null) {event.preventDefault();finish(false);}};
    window.addEventListener('keydown', cancel);
    return () => {window.removeEventListener('keydown', cancel);finish(false);};
  }, [finish]);
  useEffect(() => {if (!editable) finish(false);}, [editable, finish]);
  const value: Fuse = {
    editable,
    options: key => units.filter(unit => unitKey(unit) !== key).map(unit => ({key: unitKey(unit), unit, name: nameOf(unit)})),
    group, say,
    handle: (unit, name) => !editable ? null : <button type="button" className="fuse-handle" tabIndex={-1} data-fuse-handle={unitKey(unit)}
      aria-label={`Drag ${name} onto a light or plug to group them; from the keyboard, use Group with in its options`} title="Drag onto a light or plug to group"
      onPointerDown={event => {
        // A drag whose card has gone (a save regrouped it) is over.
        if (drag.current !== null && !drag.current.panel.isConnected) finish(false);
        if (event.button > 0 || drag.current !== null || !latest.current.editable) return;
        const panel = event.currentTarget.closest<HTMLElement>('[data-home-card]');if (panel === null) return;
        event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {pointer: event.pointerId, unit, panel, x: event.clientX, y: event.clientY, px: event.clientX, py: event.clientY, sx: scrollX, sy: scrollY, moved: false, target: null, scroll: 0, armed: false};
      }}
      onPointerMove={event => {
        const current = drag.current;if (current?.pointer !== event.pointerId) return;
        current.px = event.clientX;current.py = event.clientY;
        if (!current.moved && Math.hypot(current.px - current.x, current.py - current.y) < DRAG_SLOP) return;
        current.moved = true;current.panel.dataset['fuseDragging'] = '';current.panel.dataset['glassDragged'] = '';
        place(current);autoScroll(current);
      }}
      onPointerUp={event => {if (drag.current?.pointer === event.pointerId) finish(true);}}
      onPointerCancel={event => {if (drag.current?.pointer === event.pointerId) finish(false);}}
      onLostPointerCapture={event => {if (drag.current?.pointer === event.pointerId) finish(false);}}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>
    </button>,
  };
  return <FuseContext.Provider value={value}>
    {line.text !== '' && <p role="status" className="fuse-status" data-fuse-status data-glass-veil>{line.text}{line.recover && <> <button type="button" className="secondary" onClick={() => {void refresh();}}>Refresh records</button></>}</p>}
    {children}
  </FuseContext.Provider>;
}

/** The keyboard path to grouping on Home (#1933): a select of every other light, group and plug shown there. */
export function GroupWith({name, self, fuse, group}: {name: string; self: string; fuse: Fuse; group: (target: GroupUnit) => void}): React.JSX.Element {
  const options = fuse.options(self);
  return <label>Group with<select aria-label={`Group ${name} with`} value="" disabled={!fuse.editable} onChange={event => {
    const target = options.find(item => item.key === event.target.value);event.currentTarget.closest('details')?.removeAttribute('open');if (target !== undefined) group(target.unit);
  }}><option value="">Choose a card</option>{options.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>;
}
