import React, {useSyncExternalStore} from 'react';
import {navigationDestination, parseRoute, routeHash, type Route} from './routes.ts';

const listeners = new Set<() => void>();
const emit = (): void => {for (const listener of listeners) listener();};
addEventListener('hashchange', emit);
const subscribe = (listener: () => void): (() => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, () => location.hash));

/** A real anchor keeps modified clicks native; ordinary clicks notify the shell before hashchange. */
export function NavLink({route, current, selected, children}: {
  route: Route; current?: Route; selected?: boolean; children: React.ReactNode;
}): React.JSX.Element {
  const href = routeHash(route);
  return <a href={href} aria-current={selected === true || (current !== undefined && routeHash(current) === href) ? 'page' : undefined} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (location.hash !== href) location.hash = href;
    emit();
  }}>{children}</a>;
}

export function ShellNavigation({route}: {route: Route}): React.JSX.Element {
  const destination = navigationDestination(route);
  return <nav className="primary-navigation" aria-label="Main navigation">
    {([['home', 'Home'], ['rooms', 'Rooms'], ['devices', 'Devices'], ['automation', 'Automation']] as const).map(([kind, label]) =>
      <NavLink key={kind} route={{kind}} selected={destination === kind}>{label}</NavLink>)}
  </nav>;
}
