// The glass layer's pure parts (#1929): reading the scene from marked elements, comparing reads, and the skin colors.
// The drawing itself is checked in a browser by home-glass.browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {MAX_PANELS, readScene, sameScene, type GlassScene} from '../src/glass-scene.ts';
import {luminance, parseColor} from '../src/glass-renderer.ts';
import {LAG_RATE, LEAD_RATE, stepThumb, thumbSettled, type GlassThumb} from '../src/glass-thumb.ts';

type Fake = {dataset: Record<string, string>; radius: string; box: {left: number; top: number; width: number; height: number}; shown?: boolean};
const element = (id: string, left: number, top: number, width = 220, height = 220, radius = '34px'): Fake => ({dataset: {glassPanel: id}, radius, box: {left, top, width, height}});
/** A root whose querySelectorAll returns fake marked elements; getComputedStyle reads their radius. */
function page(panels: Fake[], veils: Fake[] = [], thumbs: Fake[] = []): ParentNode {
  const wrap = (fake: Fake): unknown => ({dataset: fake.dataset, radius: fake.radius, getBoundingClientRect: () => fake.box, checkVisibility: () => fake.shown !== false});
  (globalThis as {getComputedStyle?: unknown}).getComputedStyle = (node: {radius: string}) => ({getPropertyValue: () => node.radius});
  return {querySelectorAll: (selector: string) => (selector === '[data-glass-panel]' ? panels : selector === '[data-glass-thumb]' ? thumbs : veils).map(wrap)} as unknown as ParentNode;
}
const viewport = {width: 1440, height: 900};
const veil = (left: number, top: number, width: number, height: number, extra: Partial<Fake> = {}, mark = ''): Fake => ({dataset: {glassVeil: mark}, radius: '', box: {left, top, width, height}, ...extra});

void test('the scene holds the marked panels in or near the window, with their radius', () => {
  const root = page([element('a', 0, 0), element('far', 0, 2000), element('edge', 0, 940), element('hidden', 0, 0, 0, 0), element('round', 300, 0, 100, 40, '34px')]);
  const scene = readScene(root, root, viewport);
  assert.deepEqual(scene.panels.map(panel => panel.id), ['a', 'edge', 'round'], 'off-screen and empty boxes are not drawn; a shadow\'s reach is');
  assert.equal(scene.panels[2]?.radius, 20, 'a radius never exceeds half the shorter side');
  assert.equal(readScene(page([element('x', 0, 0, 220, 220, '')]), page([]), viewport).panels[0]?.radius, 34, 'the reference radius without a token');
});

void test('only veils that are shown and in the window count, and an edge veil says so', () => {
  const root = page([], [veil(0, 0, 184, 900, {}, 'edge'), veil(-300, 0, 280, 900, {shown: false}, 'edge'), veil(216, 40, 300, 40), veil(216, -60, 300, 40), veil(216, 120, 300, 20, {shown: false})]);
  const scene = readScene(root, root, viewport);
  assert.deepEqual(scene.veils, [{rect: {x: 0, y: 0, width: 184, height: 900}, edge: true}, {rect: {x: 216, y: 40, width: 300, height: 40}, edge: false}],
    'a closed drawer, a heading scrolled out of the window and a hidden notice draw no veil');
});

void test('the scene is capped at Home\'s placement limit', () => {
  const root = page(Array.from({length: MAX_PANELS + 10}, (_, index) => element(String(index), index % 6 * 230, Math.floor(index / 6) * 10)));
  assert.equal(readScene(root, root, viewport).panels.length, MAX_PANELS);
});

void test('a read that moves nothing compares equal, so it draws no frame', () => {
  const scene = (x: number, radius = 34): GlassScene => ({panels: [{id: 'a', rect: {x, y: 0, width: 220, height: 220}, radius}], veils: [{rect: {x: 0, y: 0, width: 10, height: 10}, edge: false}], thumb: {x: 0, y: 300, width: 90, height: 40}});
  assert.equal(sameScene(scene(10), scene(10.1)), true, 'subpixel noise is not a change');
  assert.equal(sameScene(scene(10), scene(11)), false, 'a moved box is');
  assert.equal(sameScene(scene(10), scene(10, 20)), false, 'a new radius is');
  assert.equal(sameScene(scene(10), {...scene(10), veils: []}), false, 'a removed veil is');
  assert.equal(sameScene(scene(10), {...scene(10), veils: [{rect: {x: 0, y: 0, width: 10, height: 10}, edge: true}]}), false, 'a veil that changes its edge is');
  assert.equal(sameScene(scene(10), {...scene(10), thumb: {x: 90, y: 300, width: 90, height: 40}}), false, 'a thumb that moves to the next segment is');
  assert.equal(sameScene(scene(10), {...scene(10), thumb: null}), false, 'a thumb that goes is');
});

// #1930: the hub mode switch's thumb.
void test('the scene holds the first marked thumb in view, or none', () => {
  const thumb = (left: number, top = 300): Fake => ({dataset: {glassThumb: ''}, radius: '', box: {left, top, width: 90, height: 40}});
  assert.deepEqual(readScene(page([], [], [thumb(0, 2000), thumb(100)]), page([]), viewport).thumb, {x: 100, y: 300, width: 90, height: 40});
  assert.equal(readScene(page([]), page([]), viewport).thumb, null);
});

void test('the thumb travels on a time base, stretching as its fast capsule leads, and then rests', () => {
  const from = {x: 0, y: 300, width: 90, height: 40}, to = {x: 180, y: 300, width: 90, height: 40};
  // The reference's 30% and 12% per frame at 60 frames a second.
  assert.equal(Math.round((1 - Math.exp(-LEAD_RATE / 60)) * 1000), 300);assert.equal(Math.round((1 - Math.exp(-LAG_RATE / 60)) * 1000), 120);
  const start = stepThumb(null, from, 1 / 60, false);
  assert.deepEqual(start, {lead: [0, 300, 90, 40], lag: [0, 300, 90, 40]}, 'a new thumb sits on its segment');
  assert.equal(thumbSettled(start, from), true);
  const first = stepThumb(start, to, 1 / 60, false);
  assert.ok(first !== null && Math.abs(first.lead[0] - 54) < 0.01 && Math.abs(first.lag[0] - 21.6) < 0.01, `one frame moves the capsules 30% and 12%: ${JSON.stringify(first)}`);
  // Two half frames cover the same distance as one whole frame: the speed does not depend on the refresh rate.
  const halves = stepThumb(stepThumb(start, to, 1 / 120, false), to, 1 / 120, false);
  assert.ok(halves !== null && Math.abs(halves.lead[0] - 54) < 0.01 && Math.abs(halves.lag[0] - 21.6) < 0.01);
  let thumb: GlassThumb | null = first, seconds = 1 / 60;
  while (!thumbSettled(thumb, to)) {thumb = stepThumb(thumb, to, 1 / 60, false);seconds += 1 / 60;assert.ok(seconds < 2, 'the thumb comes to rest');}
  assert.deepEqual(thumb, {lead: [180, 300, 90, 40], lag: [180, 300, 90, 40]});
  assert.ok(seconds > 0.3 && seconds < 1.2, `it settles in under a second and a quarter: ${String(seconds)}`);
  assert.deepEqual(stepThumb(start, to, 1 / 60, true), {lead: [180, 300, 90, 40], lag: [180, 300, 90, 40]}, 'reduced motion jumps');
  assert.equal(stepThumb(start, null, 1 / 60, false), null, 'no segment, no thumb');
  assert.equal(thumbSettled(null, null), true);
});

void test('computed colors parse into channels and an amount', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 51)'), [1, 0, 0.2, 1]);
  assert.deepEqual(parseColor('rgba(7, 11, 20, 0.13)').map(value => Math.round(value * 1000) / 1000), [0.027, 0.043, 0.078, 0.13]);
  assert.deepEqual(parseColor(''), [0, 0, 0, 1], 'a missing token reads as black');
  assert.equal(Math.round(luminance(parseColor('rgb(255, 255, 255)')) * 1000), 1000);
  assert.equal(Math.round(luminance(parseColor('rgb(83, 97, 122)')) * 1000), 118, 'the light skin\'s faintest text');
});
