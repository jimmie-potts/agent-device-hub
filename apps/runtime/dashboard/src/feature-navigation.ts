import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleLabel} from './directory.ts';
import {moduleOwner, type ModuleEntry} from './modules.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

/**
 * The tabs over a device or module page: the pages of the module the open page belongs to. Displays have views of
 * their own, laid out as the owner's selected device-only prototype has them (Hub #1950). Tidbyt is one view, its
 * Status and Content card, so it has no tabs. Pixoo has three: Display for current playback and screen controls,
 * which links Advanced playback and Device settings; Media for Library and Playlists; and Agent status for the
 * Monitor. A linked page shows as a tab of its own while it is open. Every page keeps its own address, which opens its
 * view. It is a projection of the catalog and the device records the page holds; it reads nothing and sends nothing.
 */
export type FeatureTab = {label: string; route: Route; current: boolean};
/** A view: its tab, the tabs of its own pages when it has several, and the pages it links. */
export type FeatureView = FeatureTab & {pages: FeatureTab[]; links: FeatureTab[]};
export type FeatureNavigation = {module: string; views: FeatureView[]};

/** A view of a display: the pages it holds and the pages it links, each the display's own page (`DEVICE`) or a declared page. */
type ViewPlan = {label: string; pages: {page: string; label: string}[]; links?: {page: string; label: string}[]};
const DEVICE = '';
const VIEWS: Readonly<Record<string, readonly ViewPlan[]>> = {
  tidbyt: [],
  pixoo: [
    {label: 'Display', pages: [{page: DEVICE, label: 'Display'}], links: [{page: 'player', label: 'Advanced playback'}, {page: 'settings', label: 'Device settings'}]},
    {label: 'Media', pages: [{page: 'library', label: 'Library'}, {page: 'playlists', label: 'Playlists'}]},
    {label: 'Agent status', pages: [{page: 'monitor', label: 'Agent status'}]},
  ],
};

/** The module the open page belongs to: a module page's module, a lighting brand, or the owner of a device page. */
export function contextModule(route: Route, runtime: RuntimeData): ModuleEntry | undefined {
  const modules = runtime.modules ?? [];
  if (route.kind === 'module') return modules.find(module => module.name === route.module);
  if (route.kind === 'lighting-brand') return modules.find(module => module.name === route.brand);
  if (route.kind !== 'component') return undefined;
  return modules.find(module => runtime.copies.some(copy => copy.owner === moduleOwner(module.name) && copy.family === 'device'
    && (copy.records as readonly DeviceRecord[]).some(record => record.id === route.id)));
}

export function featureNavigation(route: Route, runtime: RuntimeData): FeatureNavigation | undefined {
  const module = contextModule(route, runtime);
  if (module === undefined) return undefined;
  const here = routeHash(route);
  const tab = (label: string, to: Route): FeatureTab => ({label, route: to, current: routeHash(to) === here});
  const pageRoute = (page: string): Route => ({kind: 'module', module: module.name, page});
  const plans = VIEWS[module.name];
  if (plans === undefined) {
    const views = module.pages.map(page => ({...tab(page.title, pageRoute(page.id)), pages: [], links: []}));
    return views.length === 0 ? undefined : {module: module.name, views};
  }
  // The display's own page: the open one, or the first the module's records hold.
  const devices = runtime.copies.filter(copy => copy.owner === moduleOwner(module.name) && copy.family === 'device').flatMap(copy => copy.records as readonly DeviceRecord[]);
  const device = (route.kind === 'component' ? devices.find(record => record.id === route.id) : undefined) ?? devices[0];
  const declared = new Set(module.pages.map(page => page.id));
  const planned = new Set(plans.flatMap(plan => [...plan.pages, ...plan.links ?? []].map(page => page.page)));
  const tabs = (pages: readonly {page: string; label: string}[]): FeatureTab[] => pages.flatMap(page => page.page === DEVICE
    ? device === undefined ? [] : [tab(page.label, {kind: 'component', id: device.id})]
    : declared.has(page.page) ? [tab(page.label, pageRoute(page.page))] : []);
  const views: FeatureView[] = [], opened: FeatureView[] = [];
  for (const plan of plans) {
    const pages = tabs(plan.pages), links = tabs(plan.links ?? []);
    // Without its own page a view opens its first linked page.
    const first = pages[0] ?? links.shift();
    if (first === undefined) continue;
    views.push({label: plan.label, route: first.route, current: first.current || pages.some(page => page.current), pages: pages.length > 1 ? pages : [], links});
    for (const link of links) if (link.current) opened.push({...link, pages: [], links: []});
  }
  // A page the display declares that no view names yet is a view of its own, so it stays reachable.
  for (const page of module.pages) if (!planned.has(page.id)) views.push({...tab(page.title, pageRoute(page.id)), pages: [], links: []});
  views.push(...opened);
  return views.length < 2 ? undefined : {module: module.name, views};
}

/** A display's pages are titled with the display's name, and their tabs name the view, as the prototype has them. */
export function displayTitle(route: Route, runtime: RuntimeData): string | undefined {
  const module = route.kind === 'module' ? contextModule(route, runtime) : undefined;
  return module !== undefined && VIEWS[module.name] !== undefined ? moduleLabel(module.name) : undefined;
}

/** Whether the open page is a display's (Pixoo's or Tidbyt's), which draws on the glass layer (#1950). */
export function isDisplayPage(route: Route, runtime: RuntimeData): boolean {
  if (route.kind !== 'module' && route.kind !== 'component') return false;
  const module = contextModule(route, runtime);
  return module !== undefined && VIEWS[module.name] !== undefined;
}
