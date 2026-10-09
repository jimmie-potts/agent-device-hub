/**
 * The shell's navigation value. Built-in pages and registered components are distinct kinds, so a component alias such
 * as `activity` or `connections` never selects a built-in page (Hub #247). Every route has a hash URL, so pages have
 * addresses and the back button walks the history. The Wispr page comes back with #927 and module pages with #922's
 * third slice.
 */
export type Route =
  | {kind: 'home'}
  | {kind: 'timeline'}
  | {kind: 'automation'}
  | {kind: 'component'; id: string}
  | {kind: 'playback'; sourceId: string}
  | {kind: 'module'; module: string; page: string}
  | {kind: 'connections'}
  | {kind: 'missing'; hash: string};

export const homeRoute: Route = {kind: 'home'};

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * Parses a location hash. An empty hash, `#/`, `#/home` and `#/activity` open the home. A hash that is not a route,
 * including the launcher's `#launch=` fragment, is reported as missing rather than guessed.
 */
export function parseRoute(hash: string): Route {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  if (path === '' || path === '/' || path === '/home' || path === '/activity') return homeRoute;
  if (!path.startsWith('/')) return {kind: 'missing', hash};
  const parts = path.slice(1).split('/').map(decode);
  const [first, second, third] = parts;
  if (parts.length === 3 && first === 'module' && second !== undefined && third !== undefined && second !== '' && third !== '') return {kind: 'module', module: second, page: third};
  if (parts.length === 1 && first === 'timeline') return {kind: 'timeline'};
  if (parts.length === 1 && first === 'automation') return {kind: 'automation'};
  if (parts.length === 1 && first === 'connections') return {kind: 'connections'};
  if (parts.length === 2 && first === 'component' && second !== undefined && second !== '') return {kind: 'component', id: second};
  if (parts.length === 2 && first === 'music' && second !== undefined && second !== '') return {kind: 'playback', sourceId: second};
  return {kind: 'missing', hash};
}

/** The canonical hash for a route; the value a navigation link carries. */
export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'timeline': return '#/timeline';
    case 'automation': return '#/automation';
    case 'module':
      return `#/module/${encodeURIComponent(route.module)}/${encodeURIComponent(route.page)}`;
    case 'connections':
      return '#/connections';
    case 'component':
      return `#/component/${encodeURIComponent(route.id)}`;
    case 'playback':
      return `#/music/${encodeURIComponent(route.sourceId)}`;
    case 'missing':
      return route.hash;
  }
}

export const sameRoute = (a: Route, b: Route): boolean => routeHash(a) === routeHash(b);
