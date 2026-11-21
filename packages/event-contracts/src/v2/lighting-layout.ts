import type {Message} from './index.js';
import {defineFamily} from './registry.js';

export type LightingRoom = {id: string; name: string};
/** A plug member of a Home group (lighting-layout/2.1, Hub #1933): its device ID and the module that owns it. */
export type LightingPlug = {device: string; owner: string};
/**
 * A group's `devices` lists every member, lights and plugs alike. `plugs` (2.1) names the members that are plugs, so a
 * reader switches each plug with its own power command and never sends it a lighting command.
 */
export type LightingGroup = {id: string; name: string; scope: string; devices: string[]; plugs?: LightingPlug[]};
export type LightingSelection = {kind: 'device' | 'room' | 'group'; id: string};
/** Null Home selection means all currently discovered lights; an array is an explicit saved selection. */
export type LightingLayout = {rooms: LightingRoom[]; assignments: {device: string; room: string}[];
  groups: LightingGroup[]; home: LightingSelection[] | null};
export type LightingLayoutRecord = {id: 'lighting'; revision: number; layout: LightingLayout};
export type LightingLayoutSetRequest = {requestId: string; expectedRevision: number; layout: LightingLayout};

function checkLayout(message: Message): string | undefined {
  if (message.subject !== 'lighting') return 'envelope /subject must be lighting';
  if (message.kind === 'state' && message.source !== 'bunny/core') return 'envelope /source not the core';
  const {layout} = message.data as LightingLayoutRecord | LightingLayoutSetRequest;
  const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
  const names = [...layout.rooms, ...layout.groups].map(item => item.name);
  if (names.some(name => name.trim() === '' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name))) return 'payload /layout invalid display name';
  if (!unique(layout.rooms.map(item => item.id)) || !unique(layout.groups.map(item => item.id))) return 'payload /layout duplicate identity';
  const rooms = new Set(layout.rooms.map(item => item.id));
  if (!unique(layout.assignments.map(item => item.device)) || layout.assignments.some(item => !rooms.has(item.room))) return 'payload /layout invalid room assignment';
  const membership = layout.groups.flatMap(group => group.devices.map(id => `${group.scope}/${id}`));
  if (!unique(membership)) return 'payload /layout overlapping group membership';
  for (const group of layout.groups) {
    const plugs = group.plugs ?? [];
    if (plugs.length > 0 && group.scope !== 'home') return 'payload /layout plugs belong only to Home groups';
    if (!unique(plugs.map(plug => plug.device)) || plugs.some(plug => !group.devices.includes(plug.device))) return 'payload /layout invalid plug member';
  }
  if (layout.home !== null) {
    const selectedGroups = layout.home.filter(item => item.kind === 'group').map(item => layout.groups.find(group => group.id === item.id));
    if (selectedGroups.some(group => group === undefined || group.scope !== 'home') || layout.home.some(item => item.kind === 'room' && !rooms.has(item.id))) return 'payload /layout invalid Home reference';
    if (!unique(layout.home.map(item => `${item.kind}/${item.id}`))) return 'payload /layout duplicate Home selection';
    const grouped = new Set(selectedGroups.flatMap(group => group?.devices ?? []));
    if (layout.home.some(item => item.kind === 'device' && grouped.has(item.id))) return 'payload /layout duplicate individual group control';
  }
  return undefined;
}

export const lightingLayoutFamilies = [
  defineFamily('lighting-layout', 'state', 'org.bunny.lighting-layout.updated', checkLayout),
  defineFamily('lighting-layout', 'state', 'org.bunny.lighting-layout.updated', checkLayout, '2.1'),
  defineFamily('lighting-layout-set', 'command', 'org.bunny.lighting-layout.set.requested', checkLayout),
] as const;
