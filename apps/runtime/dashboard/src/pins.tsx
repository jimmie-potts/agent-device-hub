import React, {createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {NavLink} from './navigation.tsx';
import {PinStore, pinName, pinTargets, type PinTarget} from './pins.ts';
import {RailIcon} from './rail.tsx';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

const store = new PinStore(() => window.localStorage);
try {
  window.addEventListener('storage', event => {
    // Session storage reports its own changes with the same event.
    try {if (event.storageArea !== window.localStorage) return;} catch {return;}
    store.storageChanged(event.key, event.newValue);
  });
} catch {/* No cross-tab follow. */}

/** The saved pins, as addresses, in the order they were pinned. */
export const usePins = (): readonly string[] => useSyncExternalStore(store.subscribe, store.getSnapshot);

const Targets = createContext<ReadonlyMap<string, PinTarget>>(new Map());
/** Gives the rail and every page header the pages that can be pinned now, worked out once for each catalog and record change. */
export function PinTargetsProvider({runtime, children}: {runtime: RuntimeData; children: React.ReactNode}): React.JSX.Element {
  const targets = useMemo(() => pinTargets(runtime), [runtime]);
  return <Targets.Provider value={targets}>{children}</Targets.Provider>;
}

/**
 * The toggle in a page's header (Hub #1889). It is shown only on a page that can be shown as a pin, so a pin made
 * here always appears in the rail. It changes this browser's list and nothing else.
 */
export function PinToggle({route}: {route: Route}): React.JSX.Element | null {
  const pins = usePins(), targets = useContext(Targets), hash = routeHash(route);
  if (!targets.has(hash)) return null;
  const pinned = pins.includes(hash);
  return <button type="button" className="secondary pin-toggle" aria-pressed={pinned} onClick={() => {store.toggle(route);}}>
    <RailIcon name="pin"/><span>{pinned ? 'Pinned' : 'Pin to rail'}</span></button>;
}

/**
 * The rail's pinned pages. A saved pin whose page is not declared now is left out and stays saved. The page that is
 * open, when it could be pinned and is not, is a temporary row with a pin button. After a row's own button is used,
 * focus stays on that row's button when the row is still there and otherwise moves to the row before it, so it is
 * never dropped on the page.
 */
export function PinnedPages({route, fallback}: {route: Route; fallback: React.RefObject<HTMLElement | null>}): React.JSX.Element {
  const pins = usePins(), targets = useContext(Targets), here = routeHash(route);
  const shown = pins.flatMap(pin => {const target = targets.get(pin); return target === undefined ? [] : [target];});
  const visiting = pins.includes(here) ? undefined : targets.get(here);
  const list = useRef<HTMLElement>(null);
  const used = useRef<{hash: string; before: string | undefined}>(undefined);
  useEffect(() => {
    const last = used.current;
    if (last === undefined) return;
    used.current = undefined;
    const row = (hash: string | undefined): HTMLElement | null => hash === undefined ? null
      : [...list.current?.querySelectorAll<HTMLElement>('[data-pin]') ?? []].find(element => element.dataset.pin === hash) ?? null;
    (row(last.hash)?.querySelector<HTMLElement>('button') ?? row(last.before)?.querySelector<HTMLElement>('a') ?? fallback.current)?.focus();
  }, [pins, fallback]);
  const rows = visiting === undefined ? shown : [...shown, visiting];
  const row = (target: PinTarget, index: number): React.JSX.Element => {
    const temporary = target === visiting, name = pinName(target);
    return <div key={target.hash} className={temporary ? 'rail-pin visiting' : 'rail-pin'} data-pin={target.hash}>
      <NavLink route={target.route} current={route} label={name} title={temporary ? `${name} · not pinned` : name}>
        <span className="rail-mono" aria-hidden="true">{target.mono}</span><span className="rail-pin-name">{target.name}</span>
        {target.group !== '' && <small className="rail-pin-group">{target.group}</small>}</NavLink>
      <button type="button" className="rail-pin-button" aria-label={`${temporary ? 'Pin' : 'Unpin'} ${name}`} title={temporary ? 'Pin to rail' : 'Unpin'}
        onClick={() => {used.current = {hash: target.hash, before: rows[index - 1]?.hash}; store.toggle(target.route);}}><RailIcon name={temporary ? 'pin' : 'close'}/></button>
    </div>;
  };
  return <div className="rail-pins">
    <p className="rail-label"><span>Pinned</span></p>
    {rows.length > 0 ? <nav ref={list} aria-label="Pinned pages">{rows.map(row)}</nav>
      : pins.length === 0 && <p className="rail-hint">Pin a device page to keep it one click away.</p>}
  </div>;
}
