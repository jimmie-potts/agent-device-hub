import React, {useMemo, useSyncExternalStore} from 'react';
import {RailIcon} from './rail.tsx';
import {navigationDestination, parseRoute, routeHash, type Route} from './routes.ts';

const listeners = new Set<() => void>();
const emit = (): void => {for (const listener of listeners) listener();};
addEventListener('hashchange', emit);
const subscribe = (listener: () => void): (() => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
/** The route of the current address. It is the same object until the address changes, so it can key a memo. */
export const useRoute = (): Route => {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
};

/**
 * Opens a route as a chosen navigation link does. The address changes, the page opens at its top and the shell is told
 * before hashchange. The rail stays in view (Hub #1887), so a destination can be chosen while the page is scrolled. The
 * shell does nothing to scroll on back and forward; that is left to the browser.
 */
export function navigate(route: Route): void {
  const href = routeHash(route);
  if (location.hash !== href) location.hash = href;
  window.scrollTo(0, 0);
  emit();
}

/** A real anchor keeps modified clicks native; an ordinary click navigates through the shell and then calls `onChosen`. */
export function NavLink({route, current, selected, label, title, role, tabIndex, className, onChosen, children}: {
  route: Route; current?: Route; selected?: boolean; label?: string; title?: string; role?: 'menuitem'; tabIndex?: number; className?: string;
  onChosen?: () => void; children: React.ReactNode;
}): React.JSX.Element {
  const href = routeHash(route);
  return <a href={href} role={role} tabIndex={tabIndex} className={className} aria-label={label} title={title}
    aria-current={selected === true || (current !== undefined && routeHash(current) === href) ? 'page' : undefined} onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(route);
      onChosen?.();
    }}>{children}</a>;
}

/**
 * The Devices row's menu (Hub #1889), as the shell holds it: whether it is open, the row itself, whether the open page
 * has a row of its own in the rail, and what a press on the row does.
 */
export type DevicesRow = {open: boolean; menuId: string; button: React.RefObject<HTMLButtonElement | null>; ownRow: boolean; toggle: () => void; show: () => void};

/**
 * The five destinations. Four are links. Devices is a button that opens the menu of every device page; the menu's
 * "All devices" is the link to the directory. The row is marked current on the directory and on every page under it.
 * On a page that has its own row in the rail, among the pinned pages or the conversations, the mark is drawn lightly,
 * so the rail boxes one row; a page with no row of its own leaves the box on Devices.
 */
export function ShellNavigation({route, devices}: {route: Route; devices: DevicesRow}): React.JSX.Element {
  const destination = navigationDestination(route);
  return <nav className="primary-navigation" aria-label="Main navigation">
    {([['home', 'Home'], ['habitat', 'Habitat'], ['rooms', 'Rooms'], ['devices', 'Devices'], ['automation', 'Automation']] as const).map(([kind, label]) => kind === 'devices'
      ? <button key={kind} ref={devices.button} type="button" className="rail-devices" aria-haspopup="menu" aria-expanded={devices.open} aria-controls={devices.open ? devices.menuId : undefined}
        aria-current={destination === 'devices' ? 'page' : undefined} data-ancestor={destination === 'devices' && devices.ownRow ? '' : undefined}
        onClick={devices.toggle} onKeyDown={event => {
          if (event.key !== 'ArrowDown' || devices.open) return;
          event.preventDefault();
          devices.show();
        }}><RailIcon name="devices"/><span className="rail-text">{label}</span><span className="rail-go"><RailIcon name="chevron" size={14}/></span></button>
      : <NavLink key={kind} route={{kind}} selected={destination === kind}><RailIcon name={kind}/><span className="rail-text">{label}</span></NavLink>)}
  </nav>;
}
