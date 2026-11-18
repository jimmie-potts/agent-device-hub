import {directoryEntries, type DeviceCategory} from './directory.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

/**
 * The Devices menu (Hub #1889): every page the Devices directory lists, grouped as the directory groups them. It is
 * a projection of what the page already holds; it reads nothing and sends nothing.
 */
export type DeviceMenuItem = {label: string; route: Route};
/**
 * One module in the menu. `note` is empty for a running module with current observations, `stale` when its
 * observations are stale, and otherwise the state the catalog reports. With `heading` the module's name is a line
 * above its pages; without it the module is its one page, under the module's name.
 */
export type DeviceMenuModule = {id: string; label: string; note: string; heading: boolean; items: DeviceMenuItem[]};
export type DeviceMenuCategory = {category: DeviceCategory; modules: DeviceMenuModule[]};

/** The menu's two columns beside the rail. On a phone they follow each other in one column. */
export const DEVICE_MENU_COLUMNS: readonly (readonly DeviceCategory[])[] = [['Lighting', 'Displays', 'Audio'], ['Other']];

/**
 * The menu's columns. A module that is not running is named with its state and offers no page, so it is never
 * presented as available; the directory keeps the full warning. Each address appears once. A category with nothing
 * to show is left out, and so is a column.
 */
export function deviceMenu(runtime: RuntimeData): DeviceMenuCategory[][] {
  const entries = directoryEntries(runtime), seen = new Set<string>();
  const modules = new Map<DeviceCategory, DeviceMenuModule[]>();
  for (const entry of entries) {
    const running = entry.state === 'running';
    const links = running ? entry.links.filter(link => {
      const hash = routeHash(link.route);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    }) : [];
    const note = !running ? entry.state : entry.stale ? 'stale' : '';
    if (links.length === 0 && note === '') continue;
    const heading = note !== '' || links.length > 1;
    const items = links.map(link => ({label: !heading ? entry.label : link.label.toLowerCase() === entry.label.toLowerCase() ? 'Overview' : link.label, route: link.route}));
    modules.set(entry.category, [...modules.get(entry.category) ?? [], {id: entry.id, label: entry.label, note, heading, items}]);
  }
  return DEVICE_MENU_COLUMNS.map(column => column.flatMap(category => {
    const found = modules.get(category);
    return found === undefined ? [] : [{category, modules: found}];
  })).filter(column => column.length > 0);
}

/** Where an arrow, Home or End key moves focus among `count` menu items from item `from` (-1 when focus is on none). */
export function menuStep(key: string, from: number, count: number): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case 'ArrowDown': return from < 0 ? 0 : (from + 1) % count;
    case 'ArrowUp': return from < 0 ? count - 1 : (from + count - 1) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return undefined;
  }
}
