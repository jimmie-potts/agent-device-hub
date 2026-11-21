// The liquid state's pure part (#1932): how fast a panel's box changes sets how liquid it is, on a time base, and it
// settles in about a second. The drawing itself is checked in a browser by home-glass.browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {FULL_SPEED, liquidFrame, RISE_RATE, SETTLED, SETTLE_RATE, stirPanels, type Liquid} from '../src/glass-liquid.ts';
import type {GlassPanel} from '../src/glass-scene.ts';

const panel = (id: string, x: number, y = 0, width = 220, height = 220): GlassPanel => ({id, rect: {x, y, width, height}, radius: 34});
const origin = {x: 0, y: 0}, frame = 1 / 60;
const run = (previous: ReadonlyMap<string, Liquid>, panels: GlassPanel[], options: {seconds?: number; still?: boolean; rebase?: boolean; at?: {x: number; y: number}} = {}): {liquid: Map<string, Liquid>; moving: boolean} =>
  stirPanels(previous, panels, options.at ?? origin, options.seconds ?? frame, {still: options.still ?? false, rebase: options.rebase ?? false});
const wobOf = (state: {liquid: Map<string, Liquid>}, id: string): number => state.liquid.get(id)?.wob ?? Number.NaN;

void test('the rates are the reference\'s per-frame values at 60 frames a second', () => {
  assert.equal(FULL_SPEED, 9 * 60, '9 CSS pixels per frame is full');
  assert.ok(Math.abs(1 - Math.exp(-RISE_RATE / 60) - 0.5) < 1e-9, 'the state rises half the gap per frame');
  assert.equal(SETTLE_RATE, 3.4, 'it settles by exp(-3.4 s)');
});

void test('a panel seen for the first time or standing still is not liquid', () => {
  const first = run(new Map(), [panel('a', 0)]);
  assert.equal(wobOf(first, 'a'), 0);assert.equal(first.moving, false);
  const again = run(first.liquid, [panel('a', 0)]);
  assert.equal(wobOf(again, 'a'), 0);assert.equal(again.moving, false, 'nothing to draw at rest');
});

void test('box change speed stirs the panel, toward full at 9 px per frame, and it settles in about a second', () => {
  const start = run(new Map(), [panel('a', 0), panel('b', 300)]);
  // a moves 9 px in one frame (full), b grows 3 px in width (a third).
  const stirred = run(start.liquid, [panel('a', 9), panel('b', 300, 0, 223)]);
  assert.ok(Math.abs(wobOf(stirred, 'a') - 0.5) < 1e-9, `full speed rises half way in one frame: ${String(wobOf(stirred, 'a'))}`);
  assert.ok(Math.abs(wobOf(stirred, 'b') - 0.5 / 3) < 1e-9, `a third of full speed rises toward a third: ${String(wobOf(stirred, 'b'))}`);
  assert.equal(stirred.moving, true);
  // The same distance over twice the time is half the speed: the rate is per second, not per frame.
  const slow = run(start.liquid, [panel('a', 9), panel('b', 300)], {seconds: 2 * frame});
  assert.ok(Math.abs(wobOf(slow, 'a') - 0.5 * (1 - 0.25)) < 1e-9, `half speed over two frames: ${String(wobOf(slow, 'a'))}`);
  // Standing still again, it decays by exp(-3.4 s) and snaps to rest.
  const later = run(stirred.liquid, [panel('a', 9), panel('b', 300, 0, 223)], {seconds: 0.2});
  assert.ok(Math.abs(wobOf(later, 'a') - 0.5 * Math.exp(-3.4 * 0.2)) < 1e-9);
  let state = stirred, seconds = 0;
  while (state.moving && seconds < 5) {state = run(state.liquid, [panel('a', 9), panel('b', 300, 0, 223)]);seconds += frame;}
  assert.equal(state.moving, false);assert.equal(wobOf(state, 'a'), 0);
  assert.ok(seconds > 1.2 && seconds < 1.8, `it rests after about a second (${seconds.toFixed(2)} s)`);
});

void test('scrolling or anything above the page moves every box with the root and stirs nothing', () => {
  const start = run(new Map(), [panel('a', 0, 100)], {at: {x: 0, y: 40}});
  const scrolled = run(start.liquid, [panel('a', 0, -300)], {at: {x: 0, y: -360}});
  assert.equal(wobOf(scrolled, 'a'), 0);assert.equal(scrolled.moving, false);
});

void test('a rebased read takes the boxes as they are, so a window resize stirs nothing', () => {
  const start = run(new Map(), [panel('a', 0)]);
  const resized = run(start.liquid, [panel('a', 400, 0, 300)], {rebase: true});
  assert.equal(wobOf(resized, 'a'), 0);assert.equal(resized.moving, false);
  assert.deepEqual(resized.liquid.get('a')?.box, [400, 0, 300, 220], 'the next read measures from the new box');
});

void test('with reduced motion nothing turns liquid', () => {
  const start = run(new Map(), [panel('a', 0)]);
  const moved = run(start.liquid, [panel('a', 200)], {still: true});
  assert.equal(wobOf(moved, 'a'), 0);assert.equal(moved.moving, false);
});

void test('a step with no time passed changes nothing and keeps a liquid panel drawing', () => {
  const start = run(new Map(), [panel('a', 0)]);
  const stirred = run(start.liquid, [panel('a', 9)]);
  // The same timestamp again, with the box moved further: no time, so no speed and no decay yet.
  const repeated = run(stirred.liquid, [panel('a', 30)], {seconds: 0});
  assert.equal(wobOf(repeated, 'a'), wobOf(stirred, 'a'));assert.equal(repeated.moving, true, 'a liquid panel still asks for the next frame');
  assert.deepEqual(repeated.liquid.get('a')?.box, stirred.liquid.get('a')?.box, 'the next step measures the whole move over the time it took');
  const still = run(start.liquid, [panel('a', 0)], {seconds: 0});
  assert.equal(still.moving, false);
  const fresh = run(new Map(), [panel('b', 0)], {seconds: 0});
  assert.equal(wobOf(fresh, 'b'), 0, 'a new panel starts at rest');
});

void test('panels that leave the scene are forgotten', () => {
  const start = run(new Map(), [panel('a', 0), panel('b', 300)]);
  assert.deepEqual([...run(start.liquid, [panel('b', 300)]).liquid.keys()], ['b']);
});

void test('the frame clock: a first step after rest is one frame, a repeated timestamp keeps asking for frames, a stall is capped', () => {
  const options = {still: false, rebase: false, animating: false};
  const first = liquidFrame(SETTLED, [panel('a', 0)], origin, 5000, options);
  assert.equal(first.again, false);assert.equal(first.changed, false);
  // A box that jumps with no animation running stirs nothing: one frame, as before.
  const jumped = liquidFrame(first.clock, [panel('a', 200)], origin, 5500, options);
  assert.equal(jumped.again, false);assert.equal(jumped.wobs.size, 0);
  // A move 1 s after rest while a panel animates is measured as one 60 fps frame: 9 px is full speed.
  const moved = liquidFrame(first.clock, [panel('a', 9)], origin, 6000, {...options, animating: true});
  assert.ok(Math.abs((moved.wobs.get('a') ?? 0) - 0.5) < 1e-9);assert.equal(moved.changed, true);assert.equal(moved.again, true);
  // The same timestamp again: nothing changes, yet the layer must draw another frame.
  const repeated = liquidFrame(moved.clock, [panel('a', 9)], origin, 6000, {...options, animating: true});
  assert.equal(repeated.changed, false);assert.equal(repeated.again, true);assert.equal(repeated.wobs.get('a'), moved.wobs.get('a'));
  // A stall of two seconds decays by at most one capped step.
  const stalled = liquidFrame(repeated.clock, [panel('a', 9)], origin, 8000, options);
  assert.ok(Math.abs((stalled.wobs.get('a') ?? 0) - 0.5 * Math.exp(-3.4 * 0.1)) < 1e-9);
  // An animating panel element keeps frames coming even with nothing liquid, and they measure real time.
  const animating = liquidFrame(first.clock, [panel('a', 0)], origin, 6000, {...options, animating: true});
  assert.equal(animating.again, true);
  const next = liquidFrame(animating.clock, [panel('a', 1)], origin, 6050, {...options, animating: true});
  assert.ok(Math.abs((next.wobs.get('a') ?? 0) - (1 / 0.05 / 540) * (1 - Math.exp(-RISE_RATE * 0.05))) < 1e-9, 'a slow move over 50 ms is a slow speed');
  // Settled: no frame asked for once every panel is at rest and nothing animates.
  let clock = stalled.clock, now = 8000, last = stalled;
  while (last.again && now < 20000) {now += 16;last = liquidFrame(clock, [panel('a', 9)], origin, now, options);clock = last.clock;}
  assert.equal(last.again, false);assert.equal(last.wobs.size, 0);
});
