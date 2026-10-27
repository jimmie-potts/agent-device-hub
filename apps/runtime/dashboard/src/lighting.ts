// Lighting composition is metadata. Only prepareLighting creates existing, guarded module actions.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {LightingLayout, LightingSelection} from '@jimmie-potts/event-contracts/v2/families';
import type {LifxLight} from '@jimmie-potts/lifx';
import type {WallRecord} from '@jimmie-potts/nanoleaf/frontend';
import type {BrowserAction} from './actions.ts';
import {contentBlocked, deviceAction, deviceBlocked, type DeviceIntent} from './devices.ts';
import type {RuntimeCopy} from './runtime-feeds.ts';
export type LightingDevice = {record: DeviceRecord; owner: string; live: boolean; color?: LifxLight; colorLive?: boolean; wall?: WallRecord; wallLive?: boolean};
export type LightingCard = {selection: LightingSelection; name: string; members: string[]; brand?: string};
export type LightingIntent = Extract<DeviceIntent, {family: 'power-set' | 'brightness-set' | 'scene-activate'}>
  | {family: 'lifx-color-set'; data: {hue: number; saturation: number}} | {family: 'lifx-temperature-set'; data: {kelvin: number}};
export const emptyLightingLayout = (): LightingLayout => ({rooms: [], assignments: [], groups: [], home: null});
export const isLighting = (record: DeviceRecord): boolean => record.kind === 'lifx' || record.kind === 'nanoleaf';
export const brandOf = (device: LightingDevice): string => device.owner.slice(device.owner.lastIndexOf('/') + 1);
export const brandName = (brand: string): string => brand === 'lifx' ? 'LIFX' : brand === 'nanoleaf' ? 'Nanoleaf' : brand;
export const selectionKey = (selection: LightingSelection): string => `${selection.kind}:${selection.id}`;
export function lightingDevices(copies: readonly RuntimeCopy[], connected: boolean): LightingDevice[] {
  return copies.filter(copy => copy.family === 'device').flatMap(copy => (copy.records as readonly DeviceRecord[]).filter(isLighting).map(record => {
    const colorCopy = copy.owner === 'bunny/modules/lifx' ? copies.find(item => item.owner === copy.owner && item.family === 'lifx-light') : undefined;
    const wallCopy = copy.owner === 'bunny/modules/nanoleaf' ? copies.find(item => item.owner === copy.owner && item.family === 'nanoleaf-wall') : undefined;
    const color = (colorCopy?.records as readonly LifxLight[] | undefined)?.find(item => item.id === record.id);
    const wall = (wallCopy?.records as readonly WallRecord[] | undefined)?.find(item => item.id === record.id);
    return {record, owner: copy.owner, live: connected && copy.synced,
      ...(color === undefined ? {} : {color, colorLive: connected && colorCopy?.synced === true}),
      ...(wall === undefined ? {} : {wall, wallLive: connected && wallCopy?.synced === true})};
  }));
}
export function resolveCard(selection: LightingSelection, layout: LightingLayout, devices: readonly LightingDevice[]): LightingCard {
  switch (selection.kind) {
    case 'device': return {selection, name: devices.find(item => item.record.id === selection.id)?.record.label ?? selection.id, members: [selection.id]};
    case 'room': return {selection, name: layout.rooms.find(room => room.id === selection.id)?.name ?? 'Unavailable room', members: layout.assignments.filter(item => item.room === selection.id).map(item => item.device)};
    case 'group': { const group = layout.groups.find(item => item.id === selection.id); return {selection, name: group?.name ?? 'Unavailable group', members: group?.devices ?? []}; }
  }
}
export function cardsFor(scope: string, layout: LightingLayout, devices: readonly LightingDevice[]): LightingCard[] {
  if (scope.startsWith('room-')) return [resolveCard({kind: 'room', id: scope.slice(5)}, layout, devices)];
  const groups = layout.groups.filter(group => group.scope === scope);
  const eligible = devices.filter(device => scope === 'home' || scope === `brand-${brandOf(device)}`);
  const automatic: LightingSelection[] = eligible.filter(device => !groups.some(group => group.devices.includes(device.record.id))).map(device => ({kind: 'device', id: device.record.id}));
  // Keep a deterministic order so ungrouping does not reorder the remaining cards.
  const selections = scope === 'home' && layout.home !== null ? layout.home : [...groups.map(group => ({kind: 'group' as const, id: group.id})), ...automatic];
  return selections.map(selection => {
    const card = resolveCard(selection, layout, devices);
    return scope.startsWith('brand-') ? {...card, brand: scope.slice(6)} : card;
  });
}
export function lightCapabilities(ids: readonly string[], devices: readonly LightingDevice[], control: boolean, operationsLive: boolean, locks: ReadonlySet<string> = new Set(), brand?: string): {
  blocked: string | undefined; power: boolean; brightness: boolean; color: boolean; temperature: boolean; scenes: string[];
} {
  let blocked: string | undefined = !control ? 'Read-only access' : !operationsLive ? 'Operation records are stale' : ids.length === 0 ? 'No lights in this room or group' : undefined;
  const members: LightingDevice[] = [];
  for (const id of ids) {
    const matches = devices.filter(item => item.record.id === id);
    const member = matches[0];
    if (matches.length !== 1 || member === undefined) { blocked ??= 'A light is unavailable or has conflicting owners'; continue; }
    members.push(member);
    if (brand !== undefined && brandOf(member) !== brand) blocked ??= 'A light no longer belongs to this brand';
    blocked ??= deviceBlocked(member.record, member.live, control);
    if (member.record.held !== undefined) blocked ??= 'A light is held after an uncertain write';
    if (member.record.availability !== 'available') blocked ??= 'A light is unavailable or its status is unknown';
    if (member.record.pending > 0 || locks.has(id)) blocked ??= 'Waiting for a light’s command result';
  }
  const all = (predicate: (member: LightingDevice) => boolean): boolean => blocked === undefined && members.length > 0 && members.every(predicate);
  const scenes = members[0]?.record.capabilities.scenes;
  return {blocked,
    power: all(member => member.record.capabilities.power.supported),
    brightness: all(member => member.record.capabilities.brightness.supported),
    color: all(member => member.owner === 'bunny/modules/lifx' && member.colorLive === true && member.color?.capabilities.color.supported === true),
    temperature: all(member => member.owner === 'bunny/modules/lifx' && member.colorLive === true && member.color?.capabilities.temperature.supported === true),
    scenes: all(member => contentBlocked(member.record) === undefined) && scenes?.supported === true
      ? scenes.sceneIds.filter(id => members.every(member => member.record.capabilities.scenes.supported && member.record.capabilities.scenes.sceneIds.includes(id))) : [],
  };
}
export function prepareLighting(ids: readonly string[], devices: readonly LightingDevice[], intent: LightingIntent, control: boolean, operationsLive: boolean, locks: ReadonlySet<string>, requestId: () => string, brand?: string): BrowserAction[] | string {
  const cap = lightCapabilities(ids, devices, control, operationsLive, locks, brand);
  if (cap.blocked !== undefined) return cap.blocked;
  const supported = intent.family === 'power-set' ? cap.power : intent.family === 'brightness-set' ? cap.brightness : intent.family === 'lifx-color-set' ? cap.color
    : intent.family === 'lifx-temperature-set' ? cap.temperature : cap.scenes.includes(intent.data.sceneId);
  if (!supported) return 'This control is unavailable for one or more lights';
  if (intent.family === 'lifx-color-set' && (!Number.isInteger(intent.data.hue) || intent.data.hue < 0 || intent.data.hue > 360 || !Number.isInteger(intent.data.saturation) || intent.data.saturation < 0 || intent.data.saturation > 100)) return 'Choose a valid color';
  if (intent.family === 'lifx-temperature-set' && (!Number.isInteger(intent.data.kelvin) || intent.data.kelvin < 1500 || intent.data.kelvin > 9000)) return 'Choose a temperature from 1500 to 9000 K';
  const actions: BrowserAction[] = [];
  for (const id of ids) {
    const member = devices.find(item => item.record.id === id);
    if (member === undefined) return 'A light is unavailable';
    const action = intent.family === 'lifx-color-set' || intent.family === 'lifx-temperature-set'
      ? {family: intent.family, target: id, requestId: requestId(), data: {...intent.data, expectedConfigurationRevision: member.record.configurationRevision, expectedGeneration: member.record.generation}}
      : deviceAction(member.record, intent, requestId());
    if (typeof action === 'string') return action;
    actions.push(action);
  }
  return actions;
}
export function groupCards(layout: LightingLayout, scope: string, first: LightingSelection, second: LightingSelection, devices: readonly LightingDevice[], id: string, homeSelections?: readonly LightingSelection[]): LightingLayout | string {
  if (scope !== 'home' && !scope.startsWith('brand-')) return 'Use a custom group on Home or a brand page';
  if (selectionKey(first) === selectionKey(second) || first.kind === 'room' || second.kind === 'room') return 'Choose two different light cards';
  const visible = scope === 'home' && homeSelections !== undefined ? homeSelections.map(selection => resolveCard(selection, layout, devices)) : cardsFor(scope, layout, devices);
  if (![first, second].every(selection => visible.some(card => selectionKey(card.selection) === selectionKey(selection)))) return 'Choose cards on this page';
  const members = [...new Set([resolveCard(first, layout, devices), resolveCard(second, layout, devices)].flatMap(card => card.members))];
  if (members.length < 2 || members.length > 64) return 'A group needs between 2 and 64 lights';
  if (scope !== 'home' && members.some(member => !devices.some(device => device.record.id === member && scope === `brand-${brandOf(device)}`))) return 'Brand groups can contain only that brand';
  const next = structuredClone(layout);
  next.groups = next.groups.flatMap(group => {
    if ([first, second].some(selection => selection.kind === 'group' && selection.id === group.id)) return [];
    if (group.scope !== scope) return [group];
    // A hidden Home group may still own these IDs. Reuse them without leaving overlapping saved membership.
    const remaining = group.devices.filter(device => !members.includes(device));
    return remaining.length < 2 ? [] : [{...group, devices: remaining}];
  });
  next.groups.push({id, name: 'Light group', scope, devices: members});
  if (scope === 'home') {
    const removed = new Set([selectionKey(first), selectionKey(second)]);
    const selections = visible.map(card => card.selection);
    const index = selections.findIndex(selection => removed.has(selectionKey(selection)));
    next.home = selections.filter(selection => !removed.has(selectionKey(selection)));
    next.home.splice(index, 0, {kind: 'group', id});
  }
  return next;
}
export function ungroupCard(layout: LightingLayout, id: string): LightingLayout {
  const next = structuredClone(layout), group = next.groups.find(item => item.id === id);
  next.groups = next.groups.filter(item => item.id !== id);
  if (group !== undefined && next.home !== null) next.home = next.home.flatMap(selection => selection.kind === 'group' && selection.id === id ? group.devices.map(device => ({kind: 'device' as const, id: device})) : [selection]);
  return next;
}
