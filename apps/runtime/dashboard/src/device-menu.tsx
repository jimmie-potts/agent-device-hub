import React, {useEffect, useMemo, useRef} from 'react';
import {deviceMenu, menuStep} from './device-menu.ts';
import {NavLink} from './navigation.tsx';
import {RailIcon} from './rail.tsx';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

/** Where focus goes when the menu closes: back to the Devices row, to the page that was chosen, or nowhere new. */
export type DeviceMenuClose = 'row' | 'page' | 'stay';

/**
 * The Devices menu (Hub #1889): every device and module page, grouped as the directory groups them, with "All
 * devices" leading to the directory. It only navigates. It is not modal: Escape, a press outside it, a chosen page
 * or focus moving elsewhere closes it. While it is open it reads Escape and the arrow keys wherever focus is in it,
 * so the phone drawer under it does not close with it.
 */
export function DeviceMenu({id, runtime, pins, route, row, onClose}: {
  id: string; runtime: RuntimeData; pins: readonly string[]; route: Route; row: React.RefObject<HTMLElement | null>; onClose: (focus: DeviceMenuClose) => void;
}): React.JSX.Element {
  const columns = useMemo(() => deviceMenu(runtime), [runtime]);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const items = (): HTMLElement[] => [...root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []];
    const inside = (target: EventTarget | null): boolean => target instanceof Node && (root.current?.contains(target) === true || row.current?.contains(target) === true);
    (root.current?.querySelector<HTMLElement>('[role=menuitem][aria-current]') ?? items()[0])?.focus();
    const keys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current('row');
        return;
      }
      const active = document.activeElement;
      if (event.metaKey || event.ctrlKey || event.altKey || !inside(active)) return;
      const list = items(), at = active instanceof HTMLElement ? list.indexOf(active) : -1;
      if (event.key === ' ' && at >= 0) {
        event.preventDefault(); event.stopPropagation(); list[at]?.click();
        return;
      }
      const to = menuStep(event.key, at, list.length);
      if (to === undefined) return;
      event.preventDefault(); event.stopPropagation();
      list[to]?.focus();
    };
    const press = (event: PointerEvent): void => { if (!inside(event.target)) close.current('stay'); };
    const moved = (event: FocusEvent): void => { if (!inside(event.target)) close.current('stay'); };
    window.addEventListener('keydown', keys, true);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('focusin', moved);
    return () => {
      window.removeEventListener('keydown', keys, true);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('focusin', moved);
    };
  }, [row]);
  const here = routeHash(route);
  const link = (label: string, to: Route, nested: boolean): React.JSX.Element => {
    const hash = routeHash(to);
    return <NavLink key={hash} route={to} current={route} role="menuitem" tabIndex={-1} className={nested ? 'device-menu-item nested' : 'device-menu-item'} onChosen={() => { onClose('page'); }}>
      <span className="device-menu-name">{label}</span>
      {pins.includes(hash) && <span className="device-menu-mark" role="img" aria-label="Pinned"><RailIcon name="pin" size={12}/></span>}
      {hash === here && <span className="device-menu-mark"><RailIcon name="check" size={14}/></span>}
    </NavLink>;
  };
  const note = runtime.catalogFailed ? 'The module catalog is unavailable.' : runtime.modules === undefined ? 'Loading device pages.' : columns.length === 0 ? 'No device pages are declared.' : undefined;
  // A press on a heading must not take focus from the entry that has it, or the keys would stop.
  return <div ref={root} id={id} className="device-menu"
    onMouseDown={event => { if (!(event.target instanceof Element) || event.target.closest('a, button') === null) event.preventDefault(); }}>
    <div className="device-menu-head"><strong>Devices</strong>
      <button type="button" className="secondary rail-button" aria-label="Close device pages" onClick={() => { onClose('row'); }}><RailIcon name="close"/></button></div>
    <div role="menu" aria-label="Device pages">
      {note !== undefined && <p className="device-menu-note">{note}</p>}
      <div className="device-menu-columns" role="presentation">{columns.map(column => <div key={column[0]?.category} role="presentation">{column.map(group =>
        <div key={group.category} role="group" aria-label={group.category}>
          <p className="device-menu-category" aria-hidden="true">{group.category}</p>
          {group.modules.map(module => <React.Fragment key={module.id}>
            {module.heading && <p className="device-menu-module">{module.label}{module.note !== '' && <small> · {module.note}</small>}</p>}
            {module.items.map(item => link(item.label, item.route, module.heading))}
          </React.Fragment>)}
        </div>)}</div>)}</div>
      <NavLink route={{kind: 'devices'}} current={route} role="menuitem" tabIndex={-1} className="device-menu-item device-menu-all" onChosen={() => { onClose('page'); }}>
        <span className="device-menu-name">All devices</span><RailIcon name="chevron" size={14}/></NavLink>
    </div>
  </div>;
}
