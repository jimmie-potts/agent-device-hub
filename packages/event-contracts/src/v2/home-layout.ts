import type {Message} from './index.js';
import {defineFamily} from './registry.js';

export type HomePlacement = {widget: string; size: 'small' | 'medium' | 'large'; hidden: boolean};
export type HomeArrangements = {desktop: HomePlacement[]; phone: HomePlacement[]};
export type HomeLayoutRecord = {id: 'home'; revision: number; version: 1; layouts: HomeArrangements | null};
export type HomeLayoutSetRequest = {requestId: string; expectedRevision: number; layouts: HomeArrangements};
function checkHome(message: Message): string | undefined {
  if (message.subject !== 'home') return 'envelope /subject must be home';
  if (message.kind === 'state' && message.source !== 'bunny/core') return 'envelope /source not the core';
  const {layouts} = message.data as HomeLayoutRecord | HomeLayoutSetRequest;
  if (layouts !== null && Object.values(layouts).some(entries => new Set(entries.map(entry => entry.widget)).size !== entries.length)) return 'payload /layouts duplicate widget identity';
  return undefined;
}
export const homeLayoutFamilies = [
  defineFamily('home-layout', 'state', 'org.bunny.home-layout.updated', checkHome),
  defineFamily('home-layout-set', 'command', 'org.bunny.home-layout.set.requested', checkHome),
] as const;
