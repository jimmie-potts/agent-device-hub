import assert from 'node:assert/strict';
import test from 'node:test';
import {homeArtShapes, homeShapeSize, type HomePlacement, type HomeShape} from '@jimmie-potts/event-contracts/v2/families';
import {addHomeCard, defaultHomeArrangements, homeCardShapes, homeCatalog, savedHomeCard, shapeOf, withShapes, type HomeCardDefinition} from '../src/home-catalog.ts';
import {artFormatShapes, shapeStoredSize} from '../src/home-shapes.ts';
import {widgetCatalog} from '../src/widgets.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {emptyStatus} from '../../../../modules/roborock/src/contracts.ts';
import {deviceRecord} from '../../../../modules/roborock/dist/src/state.js';
const runtime: RuntimeData = {modules: [], copies: [], control: true, catalogFailed: false};
void test('art is offered by its running Gallery and never silently added to saved defaults', () => {
  const ready: RuntimeData = {...runtime, modules: [{name: 'art', state: 'running', serves: ['art'], pages: [{id: 'gallery', title: 'Art Gallery', path: '/modules/art/gallery', presentation: 'react'}]}]};
  const catalog = homeCatalog(ready, true), card = catalog.find(value => value.id === 'art');
  assert.ok(card !== undefined, 'the exposed art module has one reusable card');
  assert.equal(card.defaultSelected, false);
  assert.equal(card.reason, undefined);
  assert(!defaultHomeArrangements(catalog).desktop.some(value => value.widget === 'art'));
  assert.equal(homeCatalog(runtime, true).find(value => value.id === 'art')?.source.kind, 'unavailable');
  assert.equal(homeCatalog(ready, false).find(value => value.id === 'art')?.source.kind, 'unavailable');
  const layouts = addHomeCard(defaultHomeArrangements(catalog), 'desktop', card);
  // Added art is a pinned Large square (#1672), with the square format an older dashboard shows.
  assert.deepEqual(layouts.desktop.at(-1), {widget: 'art', size: 'medium', hidden: false, shape: 'large-square', art: {format: 'square', pinned: true}});
  assert.deepEqual(layouts.phone.at(-1)?.art, {format: 'square', pinned: true});
});

// #1672 acceptance example 2: width-only placements convert to stated shapes; an explicit save stores them.
void test('width-only placements show stated shapes, and an explicit save stores each shape with an agreeing width', () => {
  const ready: RuntimeData = {...runtime, modules: [{name: 'art', state: 'running', serves: ['art'], pages: [{id: 'gallery', title: 'Art Gallery', path: '/modules/art/gallery', presentation: 'react'}]}]};
  const catalog = homeCatalog(ready, true);
  // Present light and device sources, as the catalog lists them while their records are synced.
  const card = (id: string): Pick<HomeCardDefinition, 'id' | 'source'> => {
    const [kind, owner, instance] = id.split(':');
    if (kind === 'light') return {id, source: {kind: 'light', selection: {kind: owner === 'room' ? 'room' : 'device', id: instance ?? ''}}};
    if (kind === 'device') return {id, source: {kind: 'device', owner: owner ?? '', instance: instance ?? ''}};
    const value = savedHomeCard(id, catalog);assert.ok(value !== undefined, id);return value;
  };
  const cases: [HomePlacement, HomeShape][] = [
    [{widget: 'hub-mode', size: 'medium', hidden: false}, 'wide'], [{widget: 'hub-mode', size: 'large', hidden: false}, 'large-square'],
    [{widget: 'inbox', size: 'small', hidden: false}, 'tall'], [{widget: 'inbox', size: 'medium', hidden: false}, 'tall'],
    [{widget: 'sessions', size: 'medium', hidden: false}, 'large-square'], [{widget: 'timeline', size: 'medium', hidden: false}, 'tall'],
    [{widget: 'light:device:lamp', size: 'medium', hidden: false}, 'tall'], [{widget: 'light:room:office', size: 'large', hidden: false}, 'large-square'],
    [{widget: 'light:device:lamp', size: 'small', hidden: false}, 'square'], [{widget: 'device:bunny/modules/roborock:vacuum', size: 'small', hidden: false}, 'square'],
    [{widget: 'device:bunny/modules/pixoo:pixoo-1', size: 'large', hidden: false}, 'square'], [{widget: 'wispr', size: 'medium', hidden: false}, 'square'],
    [{widget: 'art', size: 'medium', hidden: false, art: {format: 'banner', pinned: true}}, 'wide'], [{widget: 'art', size: 'medium', hidden: false, art: {format: 'auto', pinned: true}}, 'large-square'],
    [{widget: 'music-visualizer', size: 'large', hidden: false}, 'large-square'],
    // A saved shape wins when the card offers it; one it no longer offers converts like a width.
    [{widget: 'hub-mode', size: 'small', hidden: false, shape: 'square'}, 'square'], [{widget: 'inbox', size: 'small', hidden: false, shape: 'square'}, 'tall'],
  ];
  for (const [entry, shape] of cases) assert.equal(shapeOf(entry, card(entry.widget)), shape, JSON.stringify(entry));
  const layouts = {desktop: cases.slice(0, 3).map(([entry]) => entry).filter((entry, index, all) => all.findIndex(other => other.widget === entry.widget) === index), phone: [{widget: 'inbox', size: 'small' as const, hidden: true}]};
  const saved = withShapes(layouts, catalog);
  assert.deepEqual(saved.desktop, [{widget: 'hub-mode', size: 'medium', hidden: false, shape: 'wide'}, {widget: 'inbox', size: 'small', hidden: false, shape: 'tall'}]);
  assert.deepEqual(saved.phone, [{widget: 'inbox', size: 'small', hidden: true, shape: 'tall'}]);
  assert.deepEqual(layouts.desktop[0], {widget: 'hub-mode', size: 'medium', hidden: false}, 'conversion never changes the loaded layout');
  // The dashboard's stored widths equal the contract's, which the core uses to keep a shape.
  assert.deepEqual(shapeStoredSize, homeShapeSize);
  assert.deepEqual(artFormatShapes, homeArtShapes);
});

void test('every Home card offers only shapes from the catalog, with an existing page behind its generic face', () => {
  for (const widget of widgetCatalog) {
    const shapes = homeCardShapes({id: widget.id, source: {kind: 'core'}});
    assert.ok(shapes.shapes.includes(shapes.standard), widget.id);
    assert.ok(shapes.generic.every(shape => shapes.shapes.includes(shape)), widget.id);
    if (shapes.generic.length > 0 && widget.id !== 'volcano') assert.match(shapes.open ?? '', /^#\//, widget.id);
  }
  assert.deepEqual(homeCardShapes({id: 'inbox', source: {kind: 'core'}}).shapes, ['wide', 'tall', 'large-square']);
  assert.deepEqual(homeCardShapes({id: 'device:bunny/modules/pixoo:pixoo-1', source: {kind: 'device', owner: 'bunny/modules/pixoo', instance: 'pixoo-1'}}),
    {shapes: ['square'], standard: 'square', generic: ['square'], open: '#/component/pixoo-1'});
  assert.deepEqual(homeCardShapes({id: 'music:bunny/modules/playback:room', source: {kind: 'music', owner: 'bunny/modules/playback', instance: 'room'}}).open, '#/music/room');
  assert.deepEqual(homeCardShapes({id: 'light:room:office', source: {kind: 'light', selection: {kind: 'room', id: 'office'}}}).shapes, ['square', 'wide', 'tall', 'large-square']);
});
void test('Roborock keeps existing device placements and offers an unavailable source without a duplicate', () => {
  const catalog = homeCatalog(runtime, true), missing = catalog.find(value => value.id === 'module:roborock');
  assert.ok(missing !== undefined); assert.equal(missing.source.kind, 'core'); assert.equal(missing.defaultSelected, false);
  const configured = homeCatalog({...runtime, copies: [{owner: 'bunny/modules/roborock', family: 'device', synced: true, records: [deviceRecord(emptyStatus('vacuum'))]}]}, true);
  const vacuum = configured.find(value => value.id === 'device:bunny/modules/roborock:vacuum');
  assert.ok(vacuum !== undefined); assert.deepEqual(vacuum.sizes, ['small', 'medium', 'large']);
  assert.equal(configured.filter(value => value.name === 'Roborock' || value.id.includes('roborock')).length, 1);
  assert(!configured.some(value => value.id === 'module:roborock'));
  assert.deepEqual(savedHomeCard(vacuum.id, configured), vacuum);
  assert.deepEqual(savedHomeCard(vacuum.id, catalog)?.source, {kind: 'device', owner: 'bunny/modules/roborock', instance: 'vacuum'});
  assert.equal(savedHomeCard('module:roborock', configured)?.source.kind, 'core');
});
void test('Timeline is placeable without silently adding it to an existing or default Home', () => {
  const catalog = homeCatalog(runtime, true), card = catalog.find(value => value.id === 'timeline');
  assert.ok(card !== undefined, 'Timeline is offered in Add card');
  assert.deepEqual(card.sizes, ['medium', 'large']);
  assert.equal(card.defaultSelected, false);
  const defaults = defaultHomeArrangements(catalog);
  assert(!defaults.desktop.some(value => value.widget === 'timeline'));
  const next = addHomeCard(defaults, 'desktop', card);
  assert.equal(next.desktop.at(-1)?.widget, 'timeline');
  assert.equal(next.phone.at(-1)?.widget, 'timeline');
  assert.deepEqual(savedHomeCard('timeline', catalog), card);
});
void test('the picker describes unavailable modules and keeps unavailable saved instances separate from retired definitions', () => {
  const catalog = homeCatalog(runtime, true);
  assert.equal(catalog.find(card => card.id === 'module:pixoo')?.reason, 'No configured source is available.');
  assert.equal(catalog.find(card => card.id === 'wispr')?.defaultSelected, false);
  assert.equal(savedHomeCard('wispr', catalog)?.source.kind, 'unavailable');
  assert.equal(savedHomeCard('device:bunny/modules/wemo:desk-plug', catalog)?.source.kind, 'unavailable');
  assert.equal(savedHomeCard('light:room:office', catalog)?.source.kind, 'unavailable');
  assert.equal(savedHomeCard('retired-widget', catalog), undefined);
});
void test('adding appends to the other breakpoint without replacing its independent order, size or hidden choice', () => {
  const catalog = homeCatalog(runtime, true), layouts = defaultHomeArrangements(catalog), original = structuredClone(layouts);
  layouts.phone.reverse();const first = layouts.phone[0];assert.ok(first !== undefined);first.hidden = true;
  const base = catalog[0];assert.ok(base !== undefined);const card = {...base, id: 'test-card', sizes: ['medium'] as const};
  const next = addHomeCard(layouts, 'desktop', card);
  assert.equal(next.desktop.at(-1)?.widget, 'test-card');assert.equal(next.phone.at(-1)?.widget, 'test-card');
  assert.deepEqual(next.phone.slice(0, -1), layouts.phone);assert.deepEqual(layouts.desktop, original.desktop);
  const added = next.desktop.find(entry => entry.widget === 'test-card');assert.ok(added !== undefined);added.hidden = true;
  const shown = addHomeCard(next, 'desktop', card);assert.equal(shown.desktop.at(-1)?.hidden, false);assert.equal(shown.phone.length, next.phone.length);
});

void test('a Volcano is one device placement at the card sizes, and a saved one stays its own source when it is absent', () => {
  const record = {id: 'volcano', revision: 1, kind: 'volcano'} as unknown as Parameters<typeof homeCatalog>[0]['copies'][number]['records'][number];
  const configured = homeCatalog({...runtime, copies: [{owner: 'bunny/modules/volcano', family: 'device', synced: true, records: [record]}]}, true);
  const card = configured.find(value => value.id === 'device:bunny/modules/volcano:volcano');
  assert.deepEqual(card?.sizes, ['small', 'medium', 'large']);
  assert.equal(configured.filter(value => value.id.includes('volcano')).length, 1);
  assert.equal(homeCatalog(runtime, true).some(value => value.id.includes('volcano')), false);
  assert.deepEqual(savedHomeCard('device:bunny/modules/volcano:volcano', homeCatalog(runtime, true))?.source, {kind: 'device', owner: 'bunny/modules/volcano', instance: 'volcano'});
});
