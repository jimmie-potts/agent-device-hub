import React, {useSyncExternalStore} from 'react';
import {RailIcon} from './rail.tsx';
import {navigationDestination, parseRoute, routeHash, type Route} from './routes.ts';

const listeners = new Set<() => void>();
const emit = (): void => {for (const listener of listeners) listener();};
addEventListener('hashchange', emit);
const subscribe = (listener: () => void): (() => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, () => location.hash));

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

/** A real anchor keeps modified clicks native; an ordinary click navigates through the shell. */
export function NavLink({route, current, selected, children}: {
  route: Route; current?: Route; selected?: boolean; children: React.ReactNode;
}): React.JSX.Element {
  const href = routeHash(route);
  return <a href={href} aria-current={selected === true || (current !== undefined && routeHash(current) === href) ? 'page' : undefined} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(route);
  }}>{children}</a>;
}

export function ShellNavigation({route}: {route: Route}): React.JSX.Element {
  const destination = navigationDestination(route);
  return <nav className="primary-navigation" aria-label="Main navigation">
    {([['home', 'Home'], ['habitat', 'Habitat'], ['rooms', 'Rooms'], ['devices', 'Devices'], ['automation', 'Automation']] as const).map(([kind, label]) =>
      <NavLink key={kind} route={{kind}} selected={destination === kind}><RailIcon name={kind}/><span className="rail-text">{label}</span></NavLink>)}
  </nav>;
}
