// Lighting composition is metadata. Only prepareLighting creates existing, guarded module actions.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {LightingGroup, LightingLayout, LightingPlug, LightingSelection} from '@jimmie-potts/event-contracts/v2/families';
import type {LifxLight} from '@jimmie-potts/lifx';
import type {WallRecord} from '@jimmie-potts/nanoleaf/frontend';
import type {BrowserAction} from './actions.ts';
import {contentBlocked, deviceAction, deviceBlocked, type DeviceIntent} from './devices.ts';
import type {RuntimeCopy} from './runtime-feeds.ts';
import {wemoCardState} from './wemo.ts';
export type LightingDevice = {record: DeviceRecord; owner: string; live: boolean; color?: LifxLight; colorLive?: boolean; wall?: WallRecord; wallLive?: boolean};
/** A Wemo plug on Home (#1933): a group may hold it beside lights. `live` as its own card counts it. */
export type PlugDevice = {record: DeviceRecord; owner: string; live: boolean};
/** What can be grouped on Home: a light card (a light or a group) or a plug (#1933). */
export type GroupUnit = LightingSelection | {kind: 'plug'; id: string; owner: string};
/** `plugs` lists the members of a group that are plugs (lighting-layout/2.1); every other member is a light. */
export type LightingCard = {selection: LightingSelection; name: string; members: string[]; brand?: string; plugs?: readonly LightingPlug[]};
export type LightingIntent = Extract<DeviceIntent, {family: 'power-set' | 'brightness-set' | 'scene-activate'}>
  | {family: 'lifx-color-set'; data: {hue: number; saturation: number}} | {family: 'lifx-temperature-set'; data: {kelvin: number}};
export const emptyLightingLayout = (): LightingLayout => ({rooms: [], assignments: [], groups: [], home: null});
export const isLighting = (record: DeviceRecord): boolean => record.kind === 'lifx' || record.kind === 'nanoleaf';
export const brandOf = (device: LightingDevice): string => device.owner.slice(device.owner.lastIndexOf('/') + 1);
export const brandName = (brand: string): string => brand === 'lifx' ? 'LIFX' : brand === 'nanoleaf' ? 'Nanoleaf' : brand;
export const selectionKey = (selection: LightingSelection): string => `${selection.kind}:${selection.id}`;
/** A unit's Home card identity: `light:<kind>:<id>` for a light card and `device:<owner>:<id>` for a plug. */
export const unitKey = (unit: GroupUnit): string => unit.kind === 'plug' ? `device:${unit.owner}:${unit.id}` : `light:${selectionKey(unit)}`;
/** The plugs on Home: Wemo plug records, each live only while its owner's copy is current and its identity is unique. */
export function plugDevices(copies: readonly RuntimeCopy[], connected: boolean): PlugDevice[] {
  const found = copies.filter(copy => copy.family === 'device' && copy.owner === 'bunny/modules/wemo').flatMap(copy =>
    (copy.records as readonly DeviceRecord[]).filter(record => record.kind === 'wemo').map(record => ({record, owner: copy.owner, synced: copy.synced})));
  return found.map(({record, owner, synced}) => ({record, owner, live: connected && synced && found.filter(item => item.record.id === record.id).length === 1}));
}
/** The members of a group that are lights: every member its plugs do not name. */
export const lightMembers = (group: Pick<LightingGroup, 'devices' | 'plugs'>): string[] => group.devices.filter(id => !(group.plugs ?? []).some(plug => plug.device === id));
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
    case 'group': { const group = layout.groups.find(item => item.id === selection.id);
      return {selection, name: group?.name ?? 'Unavailable group', members: group?.devices ?? [], ...(group?.plugs === undefined ? {} : {plugs: group.plugs})}; }
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
/**
 * Groups two units in one view. A plug (#1933) groups only on Home, with a light, a group or another plug shown there
 * (`plugs` lists those); its ID joins the group's devices and its plugs. The first unit's members come first, so a drop
 * passes its target first and the dragged unit joins the end of the group.
 */
export function groupCards(layout: LightingLayout, scope: string, first: GroupUnit, second: GroupUnit, devices: readonly LightingDevice[], id: string, homeSelections?: readonly LightingSelection[], plugs: readonly PlugDevice[] = []): LightingLayout | string {
  if (scope !== 'home' && !scope.startsWith('brand-')) return 'Use a custom group on Home or a brand page';
  if (unitKey(first) === unitKey(second) || first.kind === 'room' || second.kind === 'room') return 'Choose two different light or plug cards';
  if ((first.kind === 'plug' || second.kind === 'plug') && scope !== 'home') return 'Plugs group only on Home';
  const visible = scope === 'home' && homeSelections !== undefined ? homeSelections.map(selection => resolveCard(selection, layout, devices)) : cardsFor(scope, layout, devices);
  const shown = (unit: GroupUnit): boolean => unit.kind === 'plug' ? plugs.some(item => item.record.id === unit.id && item.owner === unit.owner)
    : visible.some(card => selectionKey(card.selection) === selectionKey(unit));
  if (![first, second].every(shown)) return 'Choose cards on this page';
  const parts = [first, second].map(unit => unit.kind === 'plug' ? {members: [unit.id], plugs: [{device: unit.id, owner: unit.owner}]} : (() => {
    const card = resolveCard(unit, layout, devices);return {members: card.members, plugs: card.plugs ?? []};
  })());
  const members = [...new Set(parts.flatMap(part => part.members))];
  const plugMembers = parts.flatMap(part => part.plugs).filter((plug, index, all) => all.findIndex(other => other.device === plug.device) === index);
  if (members.length < 2 || members.length > 64) return 'A group needs between 2 and 64 lights and plugs';
  if (scope !== 'home' && members.some(member => !devices.some(device => device.record.id === member && scope === `brand-${brandOf(device)}`))) return 'Brand groups can contain only that brand';
  const next = structuredClone(layout);
  next.groups = next.groups.flatMap(group => {
    if ([first, second].some(unit => unit.kind === 'group' && unit.id === group.id)) return [];
    if (group.scope !== scope) return [group];
    // A hidden Home group may still own these IDs. Reuse them without leaving overlapping saved membership.
    const remaining = group.devices.filter(device => !members.includes(device));
    if (remaining.length >= 2 && remaining.length === group.devices.length) return [group];
    const kept = (group.plugs ?? []).filter(plug => remaining.includes(plug.device));
    const {plugs: _plugs, ...rest} = group;
    return remaining.length < 2 ? [] : [{...rest, devices: remaining, ...(kept.length === 0 ? {} : {plugs: kept})}];
  });
  const lights = members.length - plugMembers.length;
  next.groups.push({id, name: plugMembers.length === 0 ? 'Light group' : lights === 0 ? 'Plug group' : 'Group', scope, devices: members, ...(plugMembers.length === 0 ? {} : {plugs: plugMembers})});
  if (scope === 'home') {
    // The lighting Home selection holds light cards only; a plug keeps its own Home card until the core folds it in.
    const removed = new Set([first, second].flatMap(unit => unit.kind === 'plug' ? [] : [selectionKey(unit)]));
    const selections = visible.map(card => card.selection);
    const index = selections.findIndex(selection => removed.has(selectionKey(selection)));
    next.home = selections.filter(selection => !removed.has(selectionKey(selection)));
    next.home.splice(index < 0 ? next.home.length : index, 0, {kind: 'group', id});
  }
  return next;
}
export function ungroupCard(layout: LightingLayout, id: string): LightingLayout {
  const next = structuredClone(layout), group = next.groups.find(item => item.id === id);
  next.groups = next.groups.filter(item => item.id !== id);
  // A plug member returns to its own Home card, which the core restores; only lights return to the lighting selection.
  if (group !== undefined && next.home !== null) next.home = next.home.flatMap(selection => selection.kind === 'group' && selection.id === id ? lightMembers(group).map(device => ({kind: 'device' as const, id: device})) : [selection]);
  return next;
}

export type GroupGuards = {control: boolean; operationsLive: boolean; locks: ReadonlySet<string>; now: number};
/**
 * All on or All off for a group (#1933): each member's own existing power command with that member's own guards, or the
 * reason it is not sent. A light goes through `prepareLighting` alone; a plug goes through its Wemo card's guards and
 * `deviceAction`, so a plug never receives a lighting command. A member that is refused here is not sent; the others are.
 */
export function groupPower(group: Pick<LightingGroup, 'devices' | 'plugs'>, devices: readonly LightingDevice[], plugs: readonly PlugDevice[], on: boolean, guards: GroupGuards, requestId: () => string): {target: string; action: BrowserAction | string}[] {
  return group.devices.map(target => ({target, action: memberPower(group, target, devices, plugs, on, guards, requestId)}));
}
export function memberPower(group: Pick<LightingGroup, 'plugs'>, target: string, devices: readonly LightingDevice[], plugs: readonly PlugDevice[], on: boolean, guards: GroupGuards, requestId: () => string): BrowserAction | string {
  const plug = group.plugs?.find(item => item.device === target);
  if (plug === undefined) {
    const actions = prepareLighting([target], devices, {family: 'power-set', data: {on}}, guards.control, guards.operationsLive, guards.locks, requestId);
    return typeof actions === 'string' ? actions : actions[0] ?? 'A light is unavailable';
  }
  const matches = plugs.filter(item => item.record.id === target && item.owner === plug.owner), found = matches[0];
  if (matches.length !== 1 || found === undefined) return 'The plug is unavailable';
  const gate = wemoCardState(found.record, found.live, guards.control, guards.operationsLive, guards.locks.has(target), guards.now);
  return gate.reason ?? deviceAction(found.record, {family: 'power-set', data: {on}}, requestId());
}
