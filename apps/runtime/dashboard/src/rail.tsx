import React, {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {RAIL_WIDE_QUERY, RailPreferenceStore, railExpanded, type RailPreference, type RailSize} from './rail-preference.ts';

const preference = new RailPreferenceStore(() => window.localStorage);
try {window.addEventListener('storage', event => {preference.storageChanged(event.key, event.newValue);});} catch {/* No cross-tab follow. */}
const wide = window.matchMedia(RAIL_WIDE_QUERY);
const subscribeWide = (listener: () => void): (() => void) => {wide.addEventListener('change', listener); return () => {wide.removeEventListener('change', listener);};};

const phone = window.matchMedia('(max-width: 680px)');
const subscribePhone = (listener: () => void): (() => void) => {phone.addEventListener('change', listener); return () => {phone.removeEventListener('change', listener);};};
/** Whether the window is at phone width, where the rail is a drawer. The width matches the shell stylesheet's phone rules. */
export const usePhone = (): boolean => useSyncExternalStore(subscribePhone, () => phone.matches);

/**
 * The saved choices, which the shell publishes as attributes for the stylesheet; whether the rail is expanded at this
 * window size, for the toggle's name; and the toggle, which remembers the choice for that size. The stylesheet, not
 * this hook, decides the layout, so a resize never waits for a script.
 */
export function useRail(): {saved: RailPreference; expanded: boolean; toggle: () => void} {
  const saved = useSyncExternalStore(preference.subscribe, preference.getSnapshot);
  const size: RailSize = useSyncExternalStore(subscribeWide, () => wide.matches) ? 'wide' : 'narrow';
  return {saved, expanded: railExpanded(saved, size), toggle: () => {preference.toggle(size);}};
}

const px = (value: string): number => {const number = Number.parseFloat(value); return Number.isNaN(number) ? 0 : number;};
const outer = (element: Element | null): number => {
  if (element === null) return 0;
  const style = getComputedStyle(element);
  return element.getBoundingClientRect().height + px(style.marginTop) + px(style.marginBottom);
};
/** The room under a pinned row that its focus ring is drawn in. It matches the pinned list's padding in the stylesheet. */
const RING = 6;

/**
 * The height the rail needs to show everything in it: its head, the jump field, the destinations, the foot, and of
 * the pinned pages their heading with one row, or with the hint when nothing is pinned. A longer pinned list scrolls
 * inside the rail and asks for no more. The Devices menu is fixed to the window and takes no room in the rail.
 */
export function railNeed(rail: Element): number {
  const style = getComputedStyle(rail);
  let need = px(style.paddingTop) + px(style.paddingBottom), parts = 0;
  for (const child of rail.children) {
    if (child.classList.contains('device-menu')) continue;
    parts += 1;
    if (!child.classList.contains('rail-pins')) {
      need += child.getBoundingClientRect().height;
      continue;
    }
    const row = child.querySelector('.rail-pin');
    need += outer(child.querySelector('.rail-label')) + (row === null ? outer(child.querySelector('.rail-hint')) : row.getBoundingClientRect().height + RING);
  }
  return need + Math.max(0, parts - 1) * px(style.rowGap);
}

/**
 * Whether the window is too short to hold the rail, in which case the stylesheet lets the rail scroll with the page
 * instead of staying in view. It is measured, not a fixed height: what the rail needs depends on the fonts, which wrap
 * its text differently from one computer to the next, on the session, whose ended state adds "Sign in again", and on
 * what is pinned. Everything in the rail is rendered by the shell, which renders at least once a second, so measuring
 * after each render follows every change; a resized window is measured at once. The phone drawer is a fixed panel
 * and is never short.
 */
export function useRailShort(rail: React.RefObject<Element | null>, phone: boolean): boolean {
  const [short, setShort] = useState(false);
  const measure = useRef<() => void>(() => {});
  measure.current = () => {
    const element = rail.current;
    setShort(!phone && element !== null && railNeed(element) > window.innerHeight);
  };
  useLayoutEffect(() => { measure.current(); });
  useEffect(() => {
    const resized = (): void => { measure.current(); };
    window.addEventListener('resize', resized);
    return () => { window.removeEventListener('resize', resized); };
  }, []);
  return short;
}

const PATHS = {
  home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/></>,
  habitat: <><path d="M3 19h18"/><path d="M5 19a7 7 0 0 1 14 0"/><path d="M10 19v-2.5a2 2 0 0 1 4 0V19"/></>,
  rooms: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5V11"/><path d="M3.5 13.5H9"/><path d="M13 13.5h7.5"/></>,
  devices: <><rect x="3" y="5" width="12" height="9" rx="1.5"/><path d="M6.5 18h5"/><path d="M9 14v4"/><rect x="17" y="9" width="4.5" height="9.5" rx="1.2"/></>,
  automation: <path d="M13 3 5.5 13H11l-1 8 7.5-10H12l1-8Z"/>,
  settings: <><path d="M4 7h9"/><path d="M19 7h1"/><circle cx="16" cy="7" r="2.5"/><path d="M4 17h1"/><path d="M11 17h9"/><circle cx="8" cy="17" r="2.5"/></>,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/></>,
  menu: <><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  chevron: <path d="m9.5 6 6 6-6 6"/>,
  pin: <><path d="M9 3.5h6l-.8 6.2 3.3 3.3h-11l3.3-3.3L9 3.5Z"/><path d="M12 13v7.5"/></>,
  close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
} as const;

/** A rail line icon. It is decoration: the control it sits in carries the name. */
export function RailIcon({name, size = 18}: {name: keyof typeof PATHS; size?: number}): React.JSX.Element {
  return <svg className="rail-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}
