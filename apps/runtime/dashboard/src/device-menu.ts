import {directoryEntries, type DeviceCategory, type DirectoryLink} from './directory.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

/**
 * The Devices menu (Hub #1889): the configured hardware the Devices directory lists, grouped as the directory groups
 * it (Hub #1950). It is a projection of what the page already holds; it reads nothing and sends nothing.
 */
export type DeviceMenuItem = {label: string; route: Route};
/**
 * One module in the menu. `note` is empty for a running module with current observations, `stale` when its
 * observations are stale, and otherwise the state the catalog reports. A lighting brand is `expandable`: a disclosure
 * over its lights and then its overview, which starts collapsed. Otherwise, with `heading` the module's name is a line
 * above its items, and without it the module is its one item, under the module's name.
 */
export type DeviceMenuModule = {id: string; label: string; note: string; heading: boolean; expandable: boolean; items: DeviceMenuItem[]};
export type DeviceMenuCategory = {category: DeviceCategory; modules: DeviceMenuModule[]};

/** The menu's two columns beside the rail, as the prototype has them. On a phone they follow each other in one column. */
export const DEVICE_MENU_COLUMNS: readonly (readonly DeviceCategory[])[] = [['Displays'], ['Lighting', 'Appliances']];

/**
 * The menu's columns. A module that is not running is named with its state and offers no item, so it is never
 * presented as available; the directory keeps the full warning. Each address appears once. A category with nothing
 * to show is left out, and so is a column.
 */
export function deviceMenu(runtime: RuntimeData): DeviceMenuCategory[][] {
  const seen = new Set<string>();
  const modules = new Map<DeviceCategory, DeviceMenuModule[]>();
  const once = (link: DirectoryLink): boolean => {
    const hash = routeHash(link.route);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  };
  for (const entry of directoryEntries(runtime)) {
    const running = entry.state === 'running';
    const note = !running ? entry.state : entry.stale ? 'stale' : '';
    const overview = running && entry.overview !== undefined && once(entry.overview) ? entry.overview : undefined;
    const links = running ? entry.links.filter(once) : [];
    let module: DeviceMenuModule;
    if (overview !== undefined) {
      module = {id: entry.id, label: entry.label, note, heading: false, expandable: true,
        items: [...links.map(link => ({label: link.label, route: link.route})), {label: overview.label, route: overview.route}]};
    } else {
      if (links.length === 0 && note === '') continue;
      const heading = note !== '' || links.length > 1;
      module = {id: entry.id, label: entry.label, note, heading, expandable: false, items: links.map(link => ({label: heading ? link.label : entry.label, route: link.route}))};
    }
    modules.set(entry.category, [...modules.get(entry.category) ?? [], module]);
  }
  return DEVICE_MENU_COLUMNS.map(column => column.flatMap(category => {
    const found = modules.get(category);
    return found === undefined ? [] : [{category, modules: found}];
  })).filter(column => column.length > 0);
}

/** The expandable module that holds the open page, which the menu opens with its group expanded. */
export function openGroup(columns: readonly DeviceMenuCategory[][], route: Route): string | undefined {
  const here = routeHash(route);
  for (const column of columns) for (const group of column) for (const module of group.modules) {
    if (module.expandable && module.items.some(item => routeHash(item.route) === here)) return module.id;
  }
  return undefined;
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
