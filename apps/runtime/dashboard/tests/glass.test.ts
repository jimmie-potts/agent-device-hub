// The glass layer's pure parts (#1929): reading the scene from marked elements, comparing reads, and the skin colors.
// The drawing itself is checked in a browser by home-glass.browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {MAX_PANELS, readScene, sameScene, type GlassScene} from '../src/glass-scene.ts';
import {luminance, parseColor} from '../src/glass-renderer.ts';

type Fake = {dataset: Record<string, string>; radius: string; box: {left: number; top: number; width: number; height: number}};
const element = (id: string, left: number, top: number, width = 220, height = 220, radius = '34px'): Fake => ({dataset: {glassPanel: id}, radius, box: {left, top, width, height}});
/** A root whose querySelectorAll returns fake marked elements; getComputedStyle reads their radius. */
function page(panels: Fake[], veils: Fake[] = []): ParentNode {
  const wrap = (fake: Fake): unknown => ({dataset: fake.dataset, radius: fake.radius, getBoundingClientRect: () => fake.box});
  (globalThis as {getComputedStyle?: unknown}).getComputedStyle = (node: {radius: string}) => ({getPropertyValue: () => node.radius});
  return {querySelectorAll: (selector: string) => (selector === '[data-glass-panel]' ? panels : veils).map(wrap)} as unknown as ParentNode;
}
const viewport = {width: 1440, height: 900};

void test('the scene holds the marked panels in or near the window, with their radius', () => {
  const root = page([element('a', 0, 0), element('far', 0, 2000), element('edge', 0, 940), element('hidden', 0, 0, 0, 0), element('round', 300, 0, 100, 40, '34px')]);
  const scene = readScene(root, root, viewport);
  assert.deepEqual(scene.panels.map(panel => panel.id), ['a', 'edge', 'round'], 'off-screen and empty boxes are not drawn; a shadow\'s reach is');
  assert.equal(scene.panels[2]?.radius, 20, 'a radius never exceeds half the shorter side');
  assert.equal(readScene(page([element('x', 0, 0, 220, 220, '')]), page([]), viewport).panels[0]?.radius, 34, 'the reference radius without a token');
});

void test('the scene is capped at Home\'s placement limit', () => {
  const root = page(Array.from({length: MAX_PANELS + 10}, (_, index) => element(String(index), index % 6 * 230, Math.floor(index / 6) * 10)));
  assert.equal(readScene(root, root, viewport).panels.length, MAX_PANELS);
});

void test('a read that moves nothing compares equal, so it draws no frame', () => {
  const scene = (x: number, radius = 34): GlassScene => ({panels: [{id: 'a', rect: {x, y: 0, width: 220, height: 220}, radius}], veils: [{x: 0, y: 0, width: 10, height: 10}]});
  assert.equal(sameScene(scene(10), scene(10.1)), true, 'subpixel noise is not a change');
  assert.equal(sameScene(scene(10), scene(11)), false, 'a moved box is');
  assert.equal(sameScene(scene(10), scene(10, 20)), false, 'a new radius is');
  assert.equal(sameScene(scene(10), {...scene(10), veils: []}), false, 'a removed veil is');
});

void test('computed colors parse into channels and an amount', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 51)'), [1, 0, 0.2, 1]);
  assert.deepEqual(parseColor('rgba(7, 11, 20, 0.13)').map(value => Math.round(value * 1000) / 1000), [0.027, 0.043, 0.078, 0.13]);
  assert.deepEqual(parseColor(''), [0, 0, 0, 1], 'a missing token reads as black');
  assert.equal(Math.round(luminance(parseColor('rgb(255, 255, 255)')) * 1000), 1000);
  assert.equal(Math.round(luminance(parseColor('rgb(83, 97, 122)')) * 1000), 118, 'the light skin\'s faintest text');
});
