/**
 * The shell's navigation value. Built-in pages and registered components are distinct kinds, so a component alias such
 * as `activity` or `connections` never selects a built-in page (Hub #247). Every route has a hash URL, so pages have
 * addresses and the back button walks the history. The Wispr page comes back with #927 and module pages with #922's
 * third slice.
 */
export type Route =
  | {kind: 'home'}
  /** The companions overview (#1950): Habitat and the companion features. */
  | {kind: 'companions'}
  | {kind: 'habitat'}
  | {kind: 'devices'}
  | {kind: 'settings'}
  | {kind: 'lighting-brand'; brand: string}
  | {kind: 'rooms'}
  | {kind: 'audio'}
  /** The music visualizer's full view (#1619), under Audio. */
  | {kind: 'visualizer'}
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
  if (parts.length === 1 && first === 'companions') return {kind: 'companions'};
  if (parts.length === 1 && first === 'habitat') return {kind: 'habitat'};
  if (parts.length === 1 && first === 'devices') return {kind: 'devices'};
  if (parts.length === 1 && first === 'settings') return {kind: 'settings'};
  if (parts.length === 3 && first === 'module' && second !== undefined && third !== undefined && second !== '' && third !== '') return {kind: 'module', module: second, page: third};
  if (parts.length === 1 && first === 'audio') return {kind: 'audio'};
  if (parts.length === 2 && first === 'audio' && second === 'visualizer') return {kind: 'visualizer'};
  if (parts.length === 1 && first === 'rooms') return {kind: 'rooms'};
  if (parts.length === 2 && first === 'lights' && second !== undefined && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(second)) return {kind: 'lighting-brand', brand: second};
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
    case 'companions': return '#/companions';
    case 'habitat': return '#/habitat';
    case 'devices': return '#/devices';
    case 'settings': return '#/settings';
    case 'audio': return '#/audio';
    case 'visualizer': return '#/audio/visualizer';
    case 'rooms': return '#/rooms';
    case 'lighting-brand': return `#/lights/${encodeURIComponent(route.brand)}`;
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

export type Destination = 'home' | 'companions' | 'rooms' | 'devices' | 'automation' | 'settings';

/**
 * The containing shell destination, independent of a component's alias or a module's page names. Audio and the music
 * pages are under Home, and Habitat and the companions module's pages under Companions (#1950). A hardware module's
 * pages are under Devices; the pages of a module that is not hardware, such as the Art Gallery, are under Home, whose
 * cards reach them. `hardware` says which a module is; without it, or for a module the shell does not know, its pages
 * are under Devices.
 */
export function navigationDestination(route: Route, hardware: (module: string) => boolean = () => true): Destination | undefined {
  switch (route.kind) {
    case 'home': case 'timeline': case 'audio': case 'visualizer': case 'playback': return 'home';
    case 'companions': case 'habitat': return 'companions';
    case 'module': return route.module === 'companions' ? 'companions' : hardware(route.module) ? 'devices' : 'home';
    case 'rooms': return 'rooms';
    case 'devices': case 'lighting-brand': case 'component': return 'devices';
    case 'automation': return 'automation';
    case 'connections': case 'settings': return 'settings';
    case 'missing': return undefined;
  }
}
