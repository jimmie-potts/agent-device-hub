// The glass layer's pure parts (#1929): reading the scene from marked elements, comparing reads, and the skin colors.
// The drawing itself is checked in a browser by home-glass.browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {MAX_PANELS, easeTarget, readScene, sameScene, visibleScene, type GlassScene} from '../src/glass-scene.ts';
import {luminance, parseColor} from '../src/glass-renderer.ts';
import {FRAGMENT} from '../src/glass-shader.ts';
import {MAX_LIGHTS} from '../src/glass-light.ts';
import {LAG_RATE, LEAD_RATE, advanceThumb, stepThumb, thumbSettled, type GlassThumb} from '../src/glass-thumb.ts';

type Box = {left: number; top: number; width: number; height: number};
type Fake = {dataset: Record<string, string>; radius: string; box: Box; shown?: boolean; lamp?: {dataset: Record<string, string>; box: Box}};
const element = (id: string, left: number, top: number, width = 220, height = 220, radius = '34px'): Fake => ({dataset: {glassPanel: id}, radius, box: {left, top, width, height}});
/** A root whose querySelectorAll returns fake marked elements; getComputedStyle reads their radius. */
function page(panels: Fake[], veils: Fake[] = [], thumbs: Fake[] = []): ParentNode {
  const wrap = (fake: Fake): unknown => ({dataset: fake.dataset, radius: fake.radius, getBoundingClientRect: () => fake.box, checkVisibility: () => fake.shown !== false,
    querySelector: () => fake.lamp === undefined ? null : {dataset: fake.lamp.dataset, getBoundingClientRect: () => fake.lamp?.box}});
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

void test('a panel\'s lamp gives its light: level, color, lamp center and press (#1931)', () => {
  const lamp = (dataset: Record<string, string>): NonNullable<Fake['lamp']> => ({dataset, box: {left: 60, top: 20, width: 80, height: 80}});
  const root = page([{...element('lit', 0, 0), lamp: lamp({glassLamp: '0.6', glassLampColor: '1 0.5 0'})}, {...element('warm', 300, 0), lamp: lamp({glassLamp: '2', glassPressed: ''})},
    {...element('bad', 600, 0), lamp: lamp({glassLamp: 'x', glassLampColor: '1 0'})}, element('plain', 900, 0)]);
  const [lit, warm, bad, plain] = readScene(root, root, viewport).panels;
  assert.deepEqual(lit?.light, {color: [1, 0.5, 0], level: 0.6, lamp: {x: 100, y: 60}, pressed: false});
  assert.deepEqual(warm?.light, {color: null, level: 1, lamp: {x: 100, y: 60}, pressed: true}, 'no color is the skin\'s warm white; the level is at most 1');
  assert.deepEqual(bad?.light, {color: null, level: 0, lamp: {x: 100, y: 60}, pressed: false}, 'unreadable values draw no light');
  assert.equal(plain?.light, undefined, 'a panel without a lamp has no light');
});

void test('a read that moves nothing compares equal, so it draws no frame', () => {
  const scene = (x: number, radius = 34): GlassScene => ({panels: [{id: 'a', rect: {x, y: 0, width: 220, height: 220}, radius}], veils: [{rect: {x: 0, y: 0, width: 10, height: 10}, edge: false}], thumb: {rect: {x: 0, y: 300, width: 90, height: 40}, key: 'work'}});
  assert.equal(sameScene(scene(10), scene(10.1)), true, 'subpixel noise is not a change');
  assert.equal(sameScene(scene(10), scene(11)), false, 'a moved box is');
  assert.equal(sameScene(scene(10), scene(10, 20)), false, 'a new radius is');
  assert.equal(sameScene(scene(10), {...scene(10), veils: []}), false, 'a removed veil is');
  assert.equal(sameScene(scene(10), {...scene(10), veils: [{rect: {x: 0, y: 0, width: 10, height: 10}, edge: true}]}), false, 'a veil that changes its edge is');
  const lit = (level: number, pressed = false, color: readonly [number, number, number] | null = null): GlassScene => ({panels: [{id: 'a', rect: {x: 0, y: 0, width: 220, height: 220}, radius: 34, light: {color, level, lamp: {x: 110, y: 60}, pressed}}], veils: [], thumb: null});
  assert.equal(sameScene(lit(0.5), lit(0.5)), true);
  assert.equal(sameScene(lit(0.5), lit(0.6)), false, 'a new level is a change');
  assert.equal(sameScene(lit(0.5), lit(0.5, true)), false, 'a press is');
  assert.equal(sameScene(lit(0.5), lit(0.5, false, [1, 0, 0])), false, 'a new color is');
  assert.equal(sameScene(lit(0.5), {...lit(0.5), panels: [{id: 'a', rect: {x: 0, y: 0, width: 220, height: 220}, radius: 34}]}), false, 'a lamp that goes away is');
  assert.equal(sameScene(scene(10), {...scene(10), thumb: {rect: {x: 90, y: 300, width: 90, height: 40}, key: 'free'}}), false, 'a thumb that moves to the next segment is');
  assert.equal(sameScene(scene(10), {...scene(10), thumb: {rect: {x: 0, y: 300, width: 90, height: 40}, key: 'free'}}), false, 'another segment in the same place is');
  assert.equal(sameScene(scene(10), {...scene(10), thumb: null}), false, 'a thumb that goes is');
});

// #1930: the hub mode switch's thumb.
void test('the scene holds the first marked thumb in view with its segment, or none', () => {
  const thumb = (left: number, key: string, top = 300): Fake => ({dataset: {glassThumb: key}, radius: '', box: {left, top, width: 90, height: 40}});
  assert.deepEqual(readScene(page([], [], [thumb(0, 'work', 2000), thumb(100, 'free')]), page([]), viewport).thumb, {rect: {x: 100, y: 300, width: 90, height: 40}, key: 'free'});
  assert.equal(readScene(page([]), page([]), viewport).thumb, null);
});

void test('the thumb travels on a time base when another segment is selected, stretching as its fast capsule leads, and then rests', () => {
  const from = {rect: {x: 0, y: 300, width: 90, height: 40}, key: 'work'}, to = {rect: {x: 180, y: 300, width: 90, height: 40}, key: 'quiet'};
  // The reference's 30% and 12% per frame at 60 frames a second.
  assert.equal(Math.round((1 - Math.exp(-LEAD_RATE / 60)) * 1000), 300);assert.equal(Math.round((1 - Math.exp(-LAG_RATE / 60)) * 1000), 120);
  const start = stepThumb(null, from, 1 / 60, false);
  assert.deepEqual(start, {lead: [0, 300, 90, 40], lag: [0, 300, 90, 40], key: 'work', target: [0, 300, 90, 40]}, 'a new thumb sits on its segment');
  assert.equal(thumbSettled(start, from), true);
  const first = stepThumb(start, to, 1 / 60, false);
  assert.ok(first !== null && Math.abs(first.lead[0] - 54) < 0.01 && Math.abs(first.lag[0] - 21.6) < 0.01, `one frame moves the capsules 30% and 12%: ${JSON.stringify(first)}`);
  // Two half frames cover the same distance as one whole frame: the speed does not depend on the refresh rate.
  const halves = stepThumb(stepThumb(start, to, 1 / 120, false), to, 1 / 120, false);
  assert.ok(halves !== null && Math.abs(halves.lead[0] - 54) < 0.01 && Math.abs(halves.lag[0] - 21.6) < 0.01);
  let thumb: GlassThumb | null = first, seconds = 1 / 60;
  while (!thumbSettled(thumb, to)) {thumb = stepThumb(thumb, to, 1 / 60, false);seconds += 1 / 60;assert.ok(seconds < 2, 'the thumb comes to rest');}
  assert.deepEqual(thumb, {lead: [180, 300, 90, 40], lag: [180, 300, 90, 40], key: 'quiet', target: [180, 300, 90, 40]});
  assert.ok(seconds > 0.3 && seconds < 1.2, `it settles in under a second and a quarter: ${String(seconds)}`);
  // A resize or a repack that moves the resting segment moves the thumb with it in one step, so it draws one frame.
  const moved = {rect: {x: 400, y: 320, width: 100, height: 40}, key: 'quiet'};
  assert.deepEqual(stepThumb(thumb, moved, 1 / 60, false), {lead: [400, 320, 100, 40], lag: [400, 320, 100, 40], key: 'quiet', target: [400, 320, 100, 40]});
  // While it travels, a moved goal keeps the travel going toward its new box.
  const travelling = stepThumb(first, {...to, rect: {...to.rect, x: 300}}, 1 / 60, false);
  assert.ok(travelling !== null && travelling.lead[0] > (first?.lead[0] ?? 0) && travelling.lead[0] < 300, 'the travel continues to the moved segment');
  assert.deepEqual(stepThumb(start, to, 1 / 60, true), {lead: [180, 300, 90, 40], lag: [180, 300, 90, 40], key: 'quiet', target: [180, 300, 90, 40]}, 'reduced motion jumps');
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

// #1930: in software WebGL the page's main thread waits for every frame, and the veil loop runs for every pixel. The
// need for a veil is the same for every veil at a pixel, so it is worked out once, after the loop, not once per veil.
void test('the veil loop only finds the strongest mask; the costly need is worked out once per pixel', () => {
  const loop = /for \(int i = 0; i < \d+; i\+\+\)\{ if \(i >= uVeilCount\) break;([\s\S]*?)\}\n/.exec(FRAGMENT)?.[1];
  assert.ok(loop !== undefined, 'the veil loop is found');
  assert.doesNotMatch(loop, /needed|backdrop|art\(/, 'nothing per veil samples the artwork or works out a need');
  assert.match(FRAGMENT, /if \(mask > 0\.\) col = veiled\(col, mask \* max\(needed\(col\)/);
});

void test('a frame at the same time as the last moves the thumb nothing but keeps it travelling, so it never stalls', () => {
  const from = {rect: {x: 0, y: 300, width: 90, height: 40}, key: 'work'}, to = {rect: {x: 180, y: 300, width: 90, height: 40}, key: 'quiet'};
  const start = advanceThumb(null, -1, from, 1000, false);
  assert.deepEqual({moved: start.moved, travelling: start.travelling, at: start.at}, {moved: true, travelling: false, at: -1}, 'a new thumb lands at once');
  const first = advanceThumb(start.thumb, start.at, to, 2000, false);
  assert.equal(first.moved, true);assert.equal(first.travelling, true);assert.equal(first.at, 2000);
  const zero = advanceThumb(first.thumb, first.at, to, 2000, false);
  assert.deepEqual({moved: zero.moved, travelling: zero.travelling, at: zero.at}, {moved: false, travelling: true, at: 2000}, 'a zero-length step asks for another frame');
  assert.deepEqual(zero.thumb, first.thumb);
  // Frames keep coming until the thumb lands; then it rests and asks for none.
  let frame = zero, now = 2000;
  while (frame.travelling) {now += 16;frame = advanceThumb(frame.thumb, frame.at, to, now, false);assert.ok(now < 4000, 'the thumb lands');}
  assert.equal(thumbSettled(frame.thumb, to), true);assert.equal(frame.at, -1);
  assert.deepEqual(advanceThumb(frame.thumb, frame.at, to, now + 16, false), {thumb: frame.thumb, at: -1, moved: false, travelling: false});
  // A clock that runs backwards never steps backwards.
  const back = advanceThumb(first.thumb, first.at, to, 1990, false);
  assert.equal(back.moved, false);assert.equal(back.travelling, true);
});

// #1931 (PR 1966 review): in software WebGL the page waits for every pixel of every frame, so the lit room's cost must
// not grow with every panel on the page. The light loops visit only the lit panels' rows (at most MAX_LIGHTS), the
// spill estimates a panel in the way from the field and gradient worked out once per pixel instead of walking every
// panel for each lamp, and the backdrop takes light only where it shows.
void test('the light loops visit only the lit panels, and no lamp walks every panel', () => {
  const body = (name: string): string => {
    const start = FRAGMENT.indexOf(`${name}(`), open = FRAGMENT.indexOf('{', start);assert.ok(start >= 0 && open > start, `${name} is found`);
    let depth = 0;for (let at = open; at < FRAGMENT.length; at += 1) {if (FRAGMENT[at] === '{') depth += 1;if (FRAGMENT[at] === '}' && (depth -= 1) === 0) return FRAGMENT.slice(open, at + 1);}
    throw new Error(`${name} is not closed`);
  };
  const spill = body('vec3 spill'), glass = body('vec3 glass');
  for (const [name, code] of [['spill', spill], ['glass', glass]] as const) {
    assert.match(code, new RegExp(`for \\(int k = 0; k < ${String(MAX_LIGHTS)}; k\\+\\+\\)\\{ if \\(k >= uLights\\) break; int i = uLightIndex\\[k\\];`), `${name} visits the lit rows`);
    assert.doesNotMatch(code, /i < \d+; i\+\+\)\{ if \(i >= uCount\)/, `${name} has no loop over every panel`);
  }
  assert.doesNotMatch(spill, /field\(/, 'no lamp works out the whole field');
  assert.match(FRAGMENT, /vec3 light = uLights > 0 && D > -1\. \? spill\(p, D, g\) : vec3\(0\.\)/, 'the backdrop takes light only where it shows, and none when nothing is lit');
  assert.match(FRAGMENT, /if \(lamps && uLights > 0\)\{/, 'a panel works out light only when something is lit');
});

void test('a change beyond the window and its shadow is no visible change, so it draws no frame (#1950)', () => {
  const viewport = {width: 1440, height: 900};
  const page = (height: number, y = 120): GlassScene => ({panels: [{id: 'page', rect: {x: 216, y, width: 1000, height}, radius: 26}], veils: [{rect: {x: 216, y: 40, width: 300, height: 40}, edge: false}], thumb: null});
  const seen = (scene: GlassScene): GlassScene => visibleScene(scene, viewport);
  assert.equal(sameScene(seen(page(2000)), seen(page(2400))), true, 'a module page that grows below the window looks the same');
  assert.equal(sameScene(seen(page(700)), seen(page(760))), false, 'a page whose bottom edge is in view looks different');
  assert.equal(sameScene(seen(page(2000)), seen(page(2000, 100))), false, 'a page that moves in view looks different');
  assert.equal(sameScene(seen(page(900, -60)), seen(page(900, -60))), true);
  assert.deepEqual(seen(page(2000)).panels[0]?.rect, {x: 216, y: 120, width: 1000, height: 844}, 'the box is cut 64px past the window, past its shadow and lip');
  assert.equal(sameScene(page(2000), page(2400)), false, 'the full scene still records the new box');
});

void test('a drop target is read from its mark and its light eases in and out on a time base (#1933)', () => {
  const root = page([{...element('target', 0, 0), dataset: {glassPanel: 'target', glassTarget: ''}}, element('other', 300, 0)]);
  const [target, other] = readScene(root, root, viewport).panels;
  assert.equal(target?.target, true);assert.equal(other?.target, undefined);
  const plain = readScene(page([element('target', 0, 0), element('other', 300, 0)]), page([]), viewport);
  assert.equal(sameScene(readScene(root, root, viewport), plain), false, 'marking a target draws a frame');
  assert.deepEqual(easeTarget(undefined, 'target', 0.08, false), {id: 'target', glow: 0.5}, 'half way after 80 ms');
  assert.deepEqual(easeTarget({id: 'target', glow: 0.5}, 'target', 0.2, false), {id: 'target', glow: 1}, 'and no further than full');
  assert.deepEqual(easeTarget({id: 'target', glow: 1}, 'other', 0.04, false), {id: 'other', glow: 0.25}, 'a new target starts from nothing');
  assert.deepEqual(easeTarget({id: 'other', glow: 0.5}, undefined, 0.04, false), {id: 'other', glow: 0.25}, 'with no mark it goes out');
  assert.equal(easeTarget({id: 'other', glow: 0.25}, undefined, 0.04, false), undefined, 'and is gone once out');
  assert.deepEqual(easeTarget(undefined, 'target', 0, true), {id: 'target', glow: 1}, 'reduced motion switches at once');
});
