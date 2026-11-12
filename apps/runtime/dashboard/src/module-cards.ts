// Device cards drawn by a module's own frontend (#1672 PR B). main.tsx mounts them and the Home catalog offers their
// shapes from this one rule, so the two cannot disagree about whether a module card exists.
import type {ModuleEntry} from './modules.ts';

/** Device owners whose module frontend draws the device's card, in full and for every Home shape. */
export const moduleCardOwners: Readonly<Record<string, 'pixoo' | 'tidbyt'>> = {'bunny/modules/pixoo': 'pixoo', 'bunny/modules/tidbyt': 'tidbyt'};

/**
 * The module whose own card shows this device, when the running catalog provides it: the Pixoo module's card while it
 * serves `pixoo-display`, the Tidbyt module's while it runs with its `display` page. Otherwise the shell shows its
 * generic device card (and Home its generic face).
 */
export function moduleCard(modules: readonly ModuleEntry[] | undefined, owner: string, kind: string): 'pixoo' | 'tidbyt' | undefined {
  const module = moduleCardOwners[owner];
  if (module === undefined || kind !== module) return undefined;
  const entry = modules?.find(value => value.name === module);
  if (entry === undefined) return undefined;
  const mounts = module === 'pixoo' ? entry.serves.includes('pixoo-display') : entry.state === 'running' && entry.pages.some(page => page.id === 'display');
  return mounts ? module : undefined;
}
