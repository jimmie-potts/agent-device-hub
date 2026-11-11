// Placement metadata is separate from the module-owned controls and observations.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {HomeArrangements, HomePlacement, LightingLayoutRecord, LightingSelection, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {RuntimeData} from './runtime-feeds.ts';
import {cardsFor, emptyLightingLayout, lightingDevices, selectionKey} from './lighting.ts';
import {widgetCatalog, widgetDefinition, type WidgetSize} from './widgets.ts';
import {artFormatShapes, placementShape, shapeArtFormat, shapeStoredSize, type HomeShape} from './home-shapes.ts';

type CardSource = {kind: 'core'} | {kind: 'device' | 'music'; owner: string; instance: string} | {kind: 'light'; selection: LightingSelection} | {kind: 'unavailable'};
export type HomeCardDefinition = {id: string; name: string; category: string; sizes: readonly WidgetSize[]; source: CardSource; reason?: string; defaultSelected: boolean};
const ordinarySizes: readonly WidgetSize[] = ['medium', 'large'];
export function homeCatalog(runtime: RuntimeData, connected: boolean): HomeCardDefinition[] {
  // Roborock and Volcano metadata describe each existing device placement, not a second default card.
  const result: HomeCardDefinition[] = widgetCatalog.filter(widget => widget.id !== 'roborock' && widget.id !== 'volcano').map(widget => ({id: widget.id, name: widget.id === 'sessions' ? 'Agent status' : widget.name, category: 'Hub', sizes: widget.sizes, source: {kind: 'core'}, defaultSelected: !['art', 'wispr', 'duck-latest', 'reachy', 'timeline', 'music-visualizer'].includes(widget.id)}));
  // The visualizer stays addable while measurement is off; the placed card rests and says why.
  const visualizer = result.find(card => card.id === 'music-visualizer');
  if (visualizer !== undefined) visualizer.category = 'Audio';
  const art = result.find(card => card.id === 'art');
  if (art !== undefined) {
    art.category = 'Art';
    const exposed = runtime.modules?.some(module => module.name === 'art' && module.state === 'running' && module.pages.some(page => page.id === 'gallery')) === true;
    if (!exposed || !connected) {art.source = {kind: 'unavailable'};art.reason = !exposed ? 'Art Gallery is unavailable.' : 'Art records are unavailable or stale.';}
  }
  for (const id of ['duck-latest', 'reachy']) {
    const card = result.find(card => card.id === id);
    if (card === undefined) continue;
    card.category = 'Companions';
    if (runtime.modules?.some(module => module.name === 'companions' && module.state === 'running' && module.pages.some(page => page.id === (id === 'reachy' ? 'reachy' : 'duck-conversation'))) !== true) {
      card.source = {kind: 'unavailable'}; card.reason = 'Companion source is unavailable.';
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
        sizes: device.kind === 'roborock' && copy.owner === 'bunny/modules/roborock' ? widgetDefinition('roborock')?.sizes ?? ordinarySizes : device.kind === 'volcano' && copy.owner === 'bunny/modules/volcano' ? widgetDefinition('volcano')?.sizes ?? ordinarySizes : ordinarySizes,
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
  const volcano = /^device:bunny\/modules\/volcano:([a-z0-9-]+)$/.exec(id)?.[1];
  if (volcano !== undefined) return {id, name: 'Volcano', category: 'Devices', sizes: widgetDefinition('volcano')?.sizes ?? ordinarySizes, source: {kind: 'device', owner: 'bunny/modules/volcano', instance: volcano}, defaultSelected: false};
  if (/^(device|music):bunny\/modules\/[a-z0-9-]+:[a-z0-9-]+$/.test(id) || /^light:(device|room|group):[a-z0-9-]+$/.test(id)) return {id, name: id.split(':').at(-1) ?? id, category: 'Unavailable', sizes: ordinarySizes, source: {kind: 'unavailable'}, reason: 'This saved source is unavailable.', defaultSelected: false};
  return undefined;
}
export function defaultHomeArrangements(catalog: readonly HomeCardDefinition[]): HomeArrangements {
  // The built-in layout shows each card in its Standard shape (#1672).
  const entry = (card: HomeCardDefinition): HomePlacement => {const shape = homeCardShapes(card).standard;return {widget: card.id, size: shapeStoredSize[shape], hidden: false, shape};};
  const selected = catalog.filter(card => card.defaultSelected && card.id !== 'sessions' && card.id !== 'inbox' && card.id !== 'wispr');
  const tail = ['sessions', 'inbox', 'wispr'].flatMap(id => catalog.filter(card => card.id === id && card.defaultSelected));
  return {desktop: [...selected, ...tail].map(entry), phone: [...selected, ...tail].map(entry)};
}
export function addHomeCard(layouts: HomeArrangements, breakpoint: keyof HomeArrangements, card: HomeCardDefinition): HomeArrangements {
  const next = structuredClone(layouts);
  for (const key of ['desktop', 'phone'] as const) {
    const found = next[key].find(entry => entry.widget === card.id);
    if (found === undefined) {
      const shape = homeCardShapes(card).standard;
      next[key].push({widget: card.id, size: shapeStoredSize[shape], hidden: false, shape, ...(card.id === 'art' ? {art: {format: shapeArtFormat[shape], pinned: true}} : {})});
    }
    else if (key === breakpoint) found.hidden = false;
  }
  return next;
}

const allShapes: readonly HomeShape[] = ['square', 'wide', 'tall', 'large-square'];
export type HomeCardShapes = {
  /** The shapes the card offers, each fitting the 220px unit with nothing clipped and no scrolling inside the card. */
  shapes: readonly HomeShape[];
  /** The shape a placement saved as Standard shows. */
  standard: HomeShape;
  /** Offered shapes that show the generic compact face: name, current state and Open. */
  generic: readonly HomeShape[];
  /** The existing page that holds the card's full content and controls. */
  open?: string;
};
/**
 * The shapes a Home card offers (#1672). Core widgets declare theirs in the widget catalog. Light, room and Nanoleaf
 * cards have compact content in every shape. Device and Music cards without compact content of their own (Pixoo,
 * Tidbyt, Wemo, Roborock, Volcano, the sign, Music) show the generic compact face in one unit, since their full content
 * fits no shape at the 220px unit; Open leads to their existing device or Music page.
 */
export function homeCardShapes(card: Pick<HomeCardDefinition, 'id' | 'source'>): HomeCardShapes {
  const widget = widgetDefinition(card.id === 'module:roborock' ? 'roborock' : card.id);
  if (widget !== undefined) return {shapes: widget.shapes, standard: widget.standard, generic: widget.generic ?? [], ...(widget.open === undefined ? {} : {open: widget.open})};
  if (card.source.kind === 'light') return {shapes: allShapes, standard: 'tall', generic: []};
  const generic = {shapes: ['square'], standard: 'square', generic: ['square']} as const;
  if (card.source.kind === 'device') return {...generic, open: `#/component/${encodeURIComponent(card.source.instance)}`};
  if (card.source.kind === 'music') return {...generic, open: `#/music/${encodeURIComponent(card.source.instance)}`};
  return generic;
}

/** The shape a saved placement shows now: its saved shape, or the conversion of a width-only placement. */
export function shapeOf(entry: HomePlacement, card: Pick<HomeCardDefinition, 'id' | 'source'>): HomeShape {
  const {shapes, standard} = homeCardShapes(card);return placementShape(entry, shapes, standard);
}
/**
 * The layout an explicit save writes: every known placement in both arrangements carries the shape it shows and the
 * width that agrees with it, and art keeps a format an older dashboard understands. Loading never calls this.
 */
export function withShapes(layouts: HomeArrangements, catalog: readonly HomeCardDefinition[]): HomeArrangements {
  const next = structuredClone(layouts);
  for (const key of ['desktop', 'phone'] as const) for (const entry of next[key]) {
    const card = savedHomeCard(entry.widget, catalog);if (card === undefined) continue;
    const shape = shapeOf(entry, card);entry.shape = shape;entry.size = shapeStoredSize[shape];
    // Art keeps its format while it agrees with the shape (auto stays auto), so a one-column format choice survives.
    if (entry.art !== undefined && !artFormatShapes[entry.art.format].includes(shape)) entry.art = {...entry.art, format: shapeArtFormat[shape]};
  }
  return next;
}

/** The current state the generic compact face shows, from records the dashboard already holds. */
export function homeCardState(card: HomeCardDefinition, runtime: RuntimeData, connected: boolean): string {
  if (card.reason !== undefined) return card.reason;
  if (!connected) return 'Offline';
  const source = card.source;
  if (source.kind === 'device') {
    const copy = runtime.copies.find(value => value.owner === source.owner && value.family === 'device');
    const record = (copy?.records as readonly DeviceRecord[] | undefined)?.find(value => value.id === source.instance);
    if (record === undefined || copy?.synced !== true) return 'Unavailable';
    const power = record.observed.status === 'known' && record.observed.power.status === 'known' ? record.observed.power.value ? ' · On' : ' · Off' : '';
    return `${record.availability === 'available' ? 'Available' : record.availability === 'unavailable' ? 'Unavailable' : 'Stale'}${power}`;
  }
  if (source.kind === 'music') {
    const copy = runtime.copies.find(value => value.owner === source.owner && value.family === 'playback');
    const record = (copy?.records as readonly PlaybackState[] | undefined)?.find(value => value.id === source.instance);
    if (record === undefined || copy?.synced !== true || record.availability !== 'available') return 'Unavailable';
    return record.playback.status === 'known' ? `${record.playback.player[0]?.toUpperCase() ?? ''}${record.playback.player.slice(1)}${record.playback.title === undefined ? '' : ` · ${record.playback.title}`}` : 'Unknown';
  }
  const module = card.id === 'module:roborock' ? 'roborock' : card.id === 'reachy' || card.id === 'duck-latest' ? 'companions' : card.id;
  const state = runtime.modules?.find(value => value.name === module)?.state;
  return state === 'running' ? 'Available' : state === undefined ? 'Unavailable' : `Module ${state}`;
}
