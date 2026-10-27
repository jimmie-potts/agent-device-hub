// Placement metadata is separate from the module-owned controls and observations.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {HomeArrangements, HomePlacement, LightingLayoutRecord, LightingSelection, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {RuntimeData} from './runtime-feeds.ts';
import {cardsFor, emptyLightingLayout, lightingDevices, selectionKey} from './lighting.ts';
import {homeLayout, widgetCatalog, widgetDefinition, type WidgetSize} from './widgets.ts';

type CardSource = {kind: 'core'} | {kind: 'device' | 'music'; owner: string; instance: string} | {kind: 'light'; selection: LightingSelection} | {kind: 'unavailable'};
export type HomeCardDefinition = {id: string; name: string; category: string; sizes: readonly WidgetSize[]; source: CardSource; reason?: string; defaultSelected: boolean};
const ordinarySizes: readonly WidgetSize[] = ['medium', 'large'];
export function homeCatalog(runtime: RuntimeData, connected: boolean): HomeCardDefinition[] {
  // Roborock metadata describes each existing device placement, not a second default card.
  const result: HomeCardDefinition[] = widgetCatalog.filter(widget => widget.id !== 'roborock').map(widget => ({id: widget.id, name: widget.id === 'sessions' ? 'Agent status' : widget.name, category: 'Hub', sizes: widget.sizes, source: {kind: 'core'}, defaultSelected: widget.id !== 'wispr' && widget.id !== 'duck-latest' && widget.id !== 'timeline'}));
  const duck = result.find(card => card.id === 'duck-latest');
  if (duck !== undefined) {
    duck.category = 'Companions';
    if (runtime.modules?.some(module => module.name === 'companions' && module.state === 'running' && module.pages.some(page => page.id === 'duck-conversation')) !== true) {
      duck.source = {kind: 'unavailable'}; duck.reason = 'Companion conversation is unavailable.';
    }
  }
  const wispr = result.find(card => card.id === 'wispr');
  if (wispr !== undefined) {
    wispr.category = 'Data';
    const exposed = runtime.modules?.some(module => module.name === 'wispr' && module.state === 'running' && module.pages.some(page => page.id === 'analytics')) === true;
    wispr.defaultSelected = exposed;
    if (!exposed || !connected) {wispr.source = {kind: 'unavailable'};wispr.reason = !exposed ? 'Wispr browser exposure is not available.' : 'Wispr records are unavailable or stale.';}
  }
  const devices = lightingDevices(runtime.copies, connected);
  const layoutCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'lighting-layout');
  const lighting = (layoutCopy?.records as readonly LightingLayoutRecord[] | undefined)?.find(record => record.id === 'lighting')?.layout ?? emptyLightingLayout();
  const selected = new Set(cardsFor('home', lighting, devices).map(card => selectionKey(card.selection)));
  const lightCards: {selection: LightingSelection; name: string}[] = [...lighting.rooms.map(room => ({selection: {kind: 'room' as const, id: room.id}, name: room.name})),
    ...devices.map(device => ({selection: {kind: 'device' as const, id: device.record.id}, name: device.record.label ?? device.record.id})),
    ...lighting.groups.filter(group => group.scope === 'home').map(group => ({selection: {kind: 'group' as const, id: group.id}, name: group.name}))];
  for (const card of lightCards) {
    const id = `light:${selectionKey(card.selection)}`;
    if (result.some(value => value.id === id)) continue;
    result.push({id, name: card.name, category: card.selection.kind === 'room' ? 'Rooms' : 'Lights', sizes: ordinarySizes,
      source: {kind: 'light', selection: card.selection}, defaultSelected: selected.has(selectionKey(card.selection)),
      ...(layoutCopy?.synced !== true ? {reason: 'Lighting composition is unavailable or stale.'} : {})});
  }
  for (const copy of runtime.copies) {
    if (copy.family === 'device') for (const device of copy.records as readonly DeviceRecord[]) {
      if (device.kind === 'lifx' || device.kind === 'nanoleaf') continue;
      result.push({id: `device:${copy.owner}:${device.id}`, name: device.label ?? device.id,
        category: device.kind === 'roborock' && copy.owner === 'bunny/modules/roborock' ? 'Cleaning' : device.kind === 'wemo' ? 'Plugs' : device.kind === 'pixoo' || device.kind === 'tidbyt' ? 'Displays' : 'Devices',
        sizes: device.kind === 'roborock' && copy.owner === 'bunny/modules/roborock' ? widgetDefinition('roborock')?.sizes ?? ordinarySizes : ordinarySizes,
        source: {kind: 'device', owner: copy.owner, instance: device.id}, defaultSelected: true, ...(!connected || !copy.synced ? {reason: 'Device records are unavailable or stale.'} : {})});
    }
    if (copy.family === 'playback') for (const playback of copy.records as readonly PlaybackState[]) result.push({id: `music:${copy.owner}:${playback.id}`, name: `Music · ${playback.id}`, category: 'Audio', sizes: ordinarySizes,
      source: {kind: 'music', owner: copy.owner, instance: playback.id}, defaultSelected: true, ...(!connected || !copy.synced ? {reason: 'Playback records are unavailable or stale.'} : {})});
  }
  if (lighting.rooms.length === 0) result.push({id: 'rooms-setup', name: 'Rooms', category: 'Rooms', sizes: ordinarySizes, source: {kind: 'unavailable'}, defaultSelected: false, reason: 'Create rooms on the Rooms page first.'});
  if (!result.some(card => card.source.kind === 'device' && card.source.owner === 'bunny/modules/roborock')) result.push({id: 'module:roborock', name: 'Roborock', category: 'Cleaning', sizes: widgetDefinition('roborock')?.sizes ?? ordinarySizes, source: {kind: 'core'}, defaultSelected: false});
  for (const [module, name, category] of [['pixoo', 'Pixoo', 'Displays'], ['tidbyt', 'Tidbyt', 'Displays'], ['wemo', 'Wemo', 'Plugs'], ['lifx', 'LIFX', 'Lights'], ['nanoleaf', 'Nanoleaf', 'Lights'], ['playback', 'Music', 'Audio']] as const) {
    if (!result.some(card => ('owner' in card.source && card.source.owner === `bunny/modules/${module}`) || (card.source.kind === 'light' && devices.some(device => device.owner === `bunny/modules/${module}`)))) result.push({id: `module:${module}`, name, category, sizes: ordinarySizes, source: {kind: 'unavailable'}, defaultSelected: false, reason: 'No configured source is available.'});
  }
  const seen = new Set<string>();
  return result.filter(card => {if (seen.has(card.id)) return false;seen.add(card.id);return true;});
}

/** Missing configured instances remain distinguishable from removed widget definitions. */
export function savedHomeCard(id: string, catalog: readonly HomeCardDefinition[]): HomeCardDefinition | undefined {
  const current = catalog.find(card => card.id === id);if (current !== undefined) return current;
  if (id === 'module:roborock') return {id, name: 'Roborock', category: 'Cleaning', sizes: widgetDefinition('roborock')?.sizes ?? ordinarySizes, source: {kind: 'core'}, defaultSelected: false};
  const vacuum = /^device:bunny\/modules\/roborock:([a-z0-9-]+)$/.exec(id)?.[1];
  if (vacuum !== undefined) return {id, name: 'Roborock', category: 'Cleaning', sizes: widgetDefinition('roborock')?.sizes ?? ordinarySizes, source: {kind: 'device', owner: 'bunny/modules/roborock', instance: vacuum}, defaultSelected: false};
  if (/^(device|music):bunny\/modules\/[a-z0-9-]+:[a-z0-9-]+$/.test(id) || /^light:(device|room|group):[a-z0-9-]+$/.test(id)) return {id, name: id.split(':').at(-1) ?? id, category: 'Unavailable', sizes: ordinarySizes, source: {kind: 'unavailable'}, reason: 'This saved source is unavailable.', defaultSelected: false};
  return undefined;
}
export function defaultHomeArrangements(catalog: readonly HomeCardDefinition[]): HomeArrangements {
  const base = homeLayout(), coreSizes = new Map([...base.wide, ...base.narrow].map(value => [value.widget, value.size]));
  const entry = (card: HomeCardDefinition): HomePlacement => ({widget: card.id, size: coreSizes.get(card.id) ?? 'medium', hidden: false});
  const selected = catalog.filter(card => card.defaultSelected && card.id !== 'sessions' && card.id !== 'inbox' && card.id !== 'wispr');
  const tail = ['sessions', 'inbox', 'wispr'].flatMap(id => catalog.filter(card => card.id === id && card.defaultSelected));
  return {desktop: [...selected, ...tail].map(entry), phone: [...selected, ...tail].map(entry)};
}
export function addHomeCard(layouts: HomeArrangements, breakpoint: keyof HomeArrangements, card: HomeCardDefinition): HomeArrangements {
  const next = structuredClone(layouts);
  for (const key of ['desktop', 'phone'] as const) {
    const found = next[key].find(entry => entry.widget === card.id);
    if (found === undefined) next[key].push({widget: card.id, size: card.sizes.includes('medium') ? 'medium' : card.sizes[0] ?? 'small', hidden: false});
    else if (key === breakpoint) found.hidden = false;
  }
  return next;
}
