// The authenticated module catalog is the only source of module pages and device owners (Hub #922).
import {childOf} from '@jimmie-potts/sdk/remote';
export type ModulePage = {id: string; title: string; path: string; presentation: 'passive' | 'react' | 'trusted-editor'};
export type ModuleEntry = {name: string; state: string; serves: string[]; pages: ModulePage[]};
const PAGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Ignore malformed or external destinations. The gateway constructs this exact local page path. */
export function moduleEntries(value: unknown): ModuleEntry[] {
  if (!object(value) || value.schema !== 'module-list/2.0' || !Array.isArray(value.modules)) return [];
  return value.modules.flatMap((entry: unknown) => {
    if (!object(entry) || typeof entry.name !== 'string' || !NAME.test(entry.name) || typeof entry.state !== 'string') return [];
    const name = entry.name;
    const serves = Array.isArray(entry.serves) ? entry.serves.filter((item): item is string => typeof item === 'string' && NAME.test(item)) : [];
    const pages = Array.isArray(entry.pages) ? entry.pages.flatMap((page: unknown): ModulePage[] => {
      if (!object(page) || typeof page.id !== 'string' || !PAGE_ID.test(page.id) || page.id.length > 64 || ['content', 'assets'].includes(page.id) || typeof page.title !== 'string' ||
          page.path !== `/modules/${name}/${page.id}`) return [];
      const presentation = page.presentation ?? 'passive';
      if (presentation !== 'passive' && presentation !== 'react' && presentation !== 'trusted-editor') return [];
      return [{id: page.id, title: page.title, path: page.path, presentation}];
    }) : [];
    return [{name, state: entry.state, serves, pages}];
  });
}
export const moduleOwner = (name: string): string => name === 'core' ? 'bunny/core' : `bunny/modules/${name}`;
export async function readModules(): Promise<ModuleEntry[]> {
  const response = await fetch('/api/v2/modules', {cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: childOf(undefined)});
  if (!response.ok) { await response.body?.cancel(); throw new Error('module catalog unavailable'); }
  return moduleEntries(await response.json());
}
export async function mayControl(): Promise<boolean> {
  try {
    const response = await fetch('/api/v2/authority?scope=control', {cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: childOf(undefined)});
    await response.body?.cancel();
    return response.status === 200;
  } catch { return false; }
}
