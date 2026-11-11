import type {Message} from './index.js';
import {defineFamily} from './registry.js';

export type HomeArtFormat = 'auto' | 'banner' | 'square' | 'tall';
export type HomeArtPlacement = {format: HomeArtFormat; pinned: boolean};
/** A Home card's shape on the unit grid (#1672): 1×1, 2 wide × 1 tall, 1 wide × 2 tall and 2×2. */
export type HomeShape = 'square' | 'wide' | 'tall' | 'large-square';
export type HomeSize = 'small' | 'medium' | 'large';
/**
 * The width a placement with a shape stores beside it, so a dashboard that knows only widths shows a close one. The core
 * keeps a saved shape only while the placement's size agrees with it (home-layout/2.2).
 */
export const homeShapeSize: Readonly<Record<HomeShape, HomeSize>> = {square: 'small', tall: 'small', wide: 'medium', 'large-square': 'medium'};
/**
 * The shapes each art format agrees with. An art placement whose format and shape disagree is one an older dashboard
 * re-formatted without knowing shapes; the core then drops the shape so the format decides (#1672).
 */
export const homeArtShapes: Readonly<Record<HomeArtFormat, readonly HomeShape[]>> = {banner: ['wide'], tall: ['tall'], square: ['square', 'large-square'], auto: ['large-square']};
export type HomePlacement = {widget: string; size: HomeSize; hidden: boolean; shape?: HomeShape; art?: HomeArtPlacement};
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
  defineFamily('home-layout', 'state', 'org.bunny.home-layout.updated', checkHome, '2.1'),
  defineFamily('home-layout', 'state', 'org.bunny.home-layout.updated', checkHome, '2.2'),
  defineFamily('home-layout-set', 'command', 'org.bunny.home-layout.set.requested', checkHome),
] as const;
