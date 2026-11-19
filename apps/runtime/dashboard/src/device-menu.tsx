import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {deviceMenu, menuStep, openGroup} from './device-menu.ts';
import {NavLink} from './navigation.tsx';
import {RailIcon} from './rail.tsx';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

/** Where focus goes when the menu closes: back to the Devices row, to the page that was chosen, or nowhere new. */
export type DeviceMenuClose = 'row' | 'page' | 'stay';

/** The phone layout, where the menu covers the drawer (the stylesheet's 680px rule). */
const PHONE = matchMedia('(max-width: 680px)');

/**
 * The Devices menu (Hub #1889): the configured hardware, grouped as the directory groups it, with "All devices"
 * leading to the directory. Each lighting brand is a disclosure over its overview and its lights (Hub #1950); the
 * brands start collapsed, and the one that holds the open page starts expanded. It only navigates, and expanding a
 * brand only shows what the page already holds. It is not modal: Escape, a press outside it, a chosen page or focus
 * moving elsewhere closes it, and so does focus moving into a framed module page, which the shell sees only as its
 * window losing focus. While it is open it reads Escape and the arrow keys wherever focus is in it, so the phone
 * drawer under it does not close with it. The arrow keys move through the items that are shown, so a collapsed
 * brand's lights are skipped; the right arrow expands a brand and the left arrow collapses it.
 */
export function DeviceMenu({id, runtime, pins, route, row, onClose, onDropped}: {
  id: string; runtime: RuntimeData; pins: readonly string[]; route: Route; row: React.RefObject<HTMLElement | null>; onClose: (focus: DeviceMenuClose) => void;
  /** Called when the menu is removed while focus is still inside it, before that focus is lost. */
  onDropped: () => void;
}): React.JSX.Element {
  const columns = useMemo(() => deviceMenu(runtime), [runtime]);
  // The menu is mounted each time it opens, so the brands start as this says each time.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => { const open = openGroup(columns, route); return new Set(open === undefined ? [] : [open]); });
  const toggle = (module: string): void => { setExpanded(open => { const next = new Set(open); if (!next.delete(module)) next.add(module); return next; }); };
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const dropped = useRef(onDropped);
  dropped.current = onDropped;
  // A layout effect is cleaned up while the menu is still in the page, so focus inside it can still be seen.
  useLayoutEffect(() => {
    const menu = root.current;
    return () => { if (menu?.contains(document.activeElement) === true) dropped.current(); };
  }, []);
  useEffect(() => {
    const items = (): HTMLElement[] => [...root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []];
    const inside = (target: EventTarget | null): boolean => target instanceof Node && (root.current?.contains(target) === true || row.current?.contains(target) === true);
    (root.current?.querySelector<HTMLElement>('[role=menuitem][aria-current]') ?? items()[0])?.focus();
    const keys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current('row');
        return;
      }
      // Focus can be on nothing while the menu is open, for example after Tab from its last stop in the phone drawer;
      // the arrow keys then start from the ends.
      const active = document.activeElement;
      if (event.metaKey || event.ctrlKey || event.altKey || (active !== null && active !== document.body && !inside(active))) return;
      const list = items(), at = active instanceof HTMLElement ? list.indexOf(active) : -1;
      if (event.key === ' ' && at >= 0) {
        event.preventDefault(); event.stopPropagation(); list[at]?.click();
        return;
      }
      // Right expands the brand whose disclosure has focus; left collapses it, from the disclosure or one of its lights.
      const brand = active instanceof HTMLElement && at >= 0 ? active.closest('.device-menu-brand')?.querySelector<HTMLElement>('.device-menu-toggle') : undefined;
      if (brand !== undefined && brand !== null && ((event.key === 'ArrowRight' && active === brand) || event.key === 'ArrowLeft')) {
        event.preventDefault(); event.stopPropagation();
        if ((brand.getAttribute('aria-expanded') === 'true') === (event.key === 'ArrowLeft')) brand.click();
        brand.focus();
        return;
      }
      const to = menuStep(event.key, at, list.length);
      if (to === undefined) return;
      event.preventDefault(); event.stopPropagation();
      list[to]?.focus();
    };
    const press = (event: PointerEvent): void => { if (!inside(event.target)) close.current('stay'); };
    const moved = (event: FocusEvent): void => { if (!inside(event.target)) close.current('stay'); };
    // A press or a focus move inside a frame never reaches this document. The window loses focus to the frame instead.
    const framed = (): void => { if (document.activeElement instanceof HTMLIFrameElement) close.current('stay'); };
    window.addEventListener('keydown', keys, true);
    window.addEventListener('blur', framed);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('focusin', moved);
    return () => {
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', framed);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('focusin', moved);
    };
  }, [row]);
  // Beside the rail the menu opens level with the Devices row, as the prototype's does, no lower than two fifths of the
  // window, and no taller than the room under it. Over the phone drawer the stylesheet places it.
  useLayoutEffect(() => {
    const menu = root.current, top = row.current?.getBoundingClientRect().top;
    if (menu === null || top === undefined || PHONE.matches) return;
    const at = Math.round(Math.min(Math.max(8, top), innerHeight * .4));
    menu.style.insetBlockStart = `${String(at)}px`;
    menu.style.maxBlockSize = `calc(100dvh - ${String(at + 8)}px)`;
  }, [row]);
  const here = routeHash(route);
  const link = (label: string, to: Route, className: string): React.JSX.Element => {
    const hash = routeHash(to);
    return <NavLink key={hash} route={to} current={route} role="menuitem" tabIndex={-1} className={`device-menu-item ${className}`} onChosen={() => { onClose('page'); }}>
      <span className="device-menu-name">{label}</span>
      {pins.includes(hash) && <span className="device-menu-mark" role="img" aria-label="Pinned"><RailIcon name="pin" size={12}/></span>}
      {hash === here && <span className="device-menu-mark"><RailIcon name="check" size={14}/></span>}
    </NavLink>;
  };
  const note = runtime.catalogFailed ? 'The module catalog is unavailable.' : runtime.modules === undefined ? 'Loading device pages.' : columns.length === 0 ? 'No device pages are declared.' : undefined;
  // The head and "All devices" stay in place while the lists between them scroll, so the directory is in reach with
  // every brand open. A press on a heading does not take focus from the entry that has it.
  return <div ref={root} id={id} className="device-menu"
    onMouseDown={event => { if (!(event.target instanceof Element) || event.target.closest('a, button') === null) event.preventDefault(); }}>
    <div className="device-menu-head"><strong>Devices</strong>
      <button type="button" className="secondary rail-button" aria-label="Close device pages" onClick={() => { onClose('row'); }}><RailIcon name="close"/></button></div>
    <div role="menu" aria-label="Device pages">
      <div className="device-menu-scroll" role="presentation">
        {note !== undefined && <p className="device-menu-note">{note}</p>}
        <div className="device-menu-columns" role="presentation">{columns.map(column => <div key={column[0]?.category} role="presentation">{column.map(group =>
          <div key={group.category} role="group" aria-label={group.category}>
            <p className="device-menu-category" aria-hidden="true">{group.category}</p>
            {group.modules.map(module => module.expandable ? <div key={module.id} className="device-menu-brand">
              <button type="button" role="menuitem" tabIndex={-1} className="device-menu-item device-menu-toggle" aria-expanded={expanded.has(module.id)}
                aria-controls={expanded.has(module.id) ? `${id}-${module.id}` : undefined} onClick={() => { toggle(module.id); }}>
                <span className="device-menu-name">{module.label}{module.note !== '' && <small> · {module.note}</small>}</span>
                <span className="device-menu-chevron"><RailIcon name="chevron" size={14}/></span>
              </button>
              {expanded.has(module.id) && <div role="group" id={`${id}-${module.id}`} className="device-menu-lights" aria-label={`${module.label} lights`}>
                {module.items.map((item, index) => link(item.label, item.route, index === module.items.length - 1 ? 'device-menu-light device-menu-overview' : 'device-menu-light'))}</div>}
            </div> : <React.Fragment key={module.id}>
              {module.heading && <p className="device-menu-module">{module.label}{module.note !== '' && <small> · {module.note}</small>}</p>}
              {module.items.map(item => link(item.label, item.route, module.heading ? 'nested' : ''))}
            </React.Fragment>)}
          </div>)}</div>)}</div>
      </div>
      <NavLink route={{kind: 'devices'}} current={route} role="menuitem" tabIndex={-1} className="device-menu-item device-menu-all" onChosen={() => { onClose('page'); }}>
        <span className="device-menu-name">All devices</span><RailIcon name="chevron" size={14}/></NavLink>
    </div>
  </div>;
}
