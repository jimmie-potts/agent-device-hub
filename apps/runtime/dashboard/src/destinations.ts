import {namedDevices} from './device-names.ts';
import {categoryOf, isHardware, moduleLabel} from './directory.ts';
import {moduleOwner} from './modules.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import type {Route} from './routes.ts';

/**
 * Every page the catalog and the device records declare now (Hub #1950): each hardware module's brand page, device
 * pages and task pages, and every other module's pages. The jump palette and the pins are built from it, so they keep
 * the pages that the hardware inventory leaves out. It is a projection of what the page already holds.
 *
 * `name` is the page's own name and `module` its module's. `alone` is true when the page is its module's only page or
 * is named like the module, so it can stand for the module. `hint` is where the page belongs: a hardware category,
 * Companions, or nothing for another page. `state` is the module's state in the catalog.
 */
export type Destination = {route: Route; name: string; module: string; alone: boolean; hint: string; state: string; hardware: boolean};

/** A destination's name with its module's, as one line names it: the module alone for a page named like it. */
export const fullName = (destination: Destination): string =>
  destination.name.toLowerCase() === destination.module.toLowerCase() ? destination.module : `${destination.module} · ${destination.name}`;

export function destinations(runtime: RuntimeData): Destination[] {
  const found: Destination[] = [];
  for (const module of runtime.modules ?? []) {
    if (module.name === 'core' && module.pages.length === 0) continue;
    const label = moduleLabel(module.name), hardware = isHardware(module, runtime);
    const category = hardware ? categoryOf(module, runtime) : undefined;
    const pages: {name: string; route: Route}[] = [];
    if (category === 'Lighting' && module.serves.includes('device')) pages.push({name: label, route: {kind: 'lighting-brand', brand: module.name}});
    if (hardware) {
      const devices = namedDevices(runtime, moduleOwner(module.name));
      // A module with one device, other than a light, is that device: its page goes by the module's name.
      for (const {record, name} of devices) pages.push({name: devices.length === 1 && category !== 'Lighting' ? label : name, route: {kind: 'component', id: record.id}});
    }
    for (const page of module.pages) pages.push({name: page.title, route: {kind: 'module', module: module.name, page: page.id}});
    const hint = category ?? (module.name === 'companions' ? 'Companions' : '');
    for (const page of pages) {
      found.push({route: page.route, name: page.name, module: label, alone: pages.length === 1 || page.name.toLowerCase() === label.toLowerCase(), hint, state: module.state, hardware});
    }
  }
  return found;
}
