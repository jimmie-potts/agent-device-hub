// The lit room's pure parts (#1931): a light's color from its observed reading, its glow from observed state, and the
// easing of light and press on a time base. The drawing itself is checked in a browser by home-glass.browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {easeLights, glowOf, lampColor, lightFrame, litRows, LIGHT_RATE, MAX_LIGHTS, PRESS_RATE, RESTING, type EasedLight, type LightClock} from '../src/glass-light.ts';
import type {GlassPanel} from '../src/glass-scene.ts';
import type {LightingDevice} from '../src/lighting.ts';

const near = (actual: readonly number[], expected: readonly number[], tolerance = 0.02): void => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {assert.ok(Math.abs(value - (expected[index] ?? 0)) <= tolerance, `${actual.join(',')} is near ${expected.join(',')}`);});
};

void test('a LIFX reading becomes the color its bulb shows, at full value', () => {
  near(lampColor({hue: 0, saturation: 100, kelvin: 3500}), [1, 0, 0]);
  near(lampColor({hue: 120, saturation: 100, kelvin: 3500}), [0, 1, 0]);
  near(lampColor({hue: 240, saturation: 100, kelvin: 9000}), [0, 0, 1]);
  const warm = lampColor({hue: 0, saturation: 0, kelvin: 2700});
  assert.equal(warm[0], 1);assert.ok(warm[0] > warm[1] && warm[1] > warm[2], `2700 K is a warm white: ${warm.join(',')}`);
  const daylight = lampColor({hue: 200, saturation: 0, kelvin: 6500});
  assert.ok(daylight.every(value => value > 0.9), `6500 K is close to white: ${daylight.join(',')}`);
  const pastel = lampColor({hue: 0, saturation: 50, kelvin: 6500});
  assert.ok(pastel[0] === 1 && pastel[1] > 0.3 && pastel[1] < 0.7, `half saturation mixes the hue with the white: ${pastel.join(',')}`);
});

const device = (id: string, observed: {power: boolean; brightness: number} | undefined, options: {live?: boolean; color?: {hue: number; saturation: number; kelvin: number}; colorLive?: boolean} = {}): LightingDevice => ({
  owner: options.color === undefined ? 'bunny/modules/nanoleaf' : 'bunny/modules/lifx', live: options.live ?? true,
  record: {id, availability: 'available', observed: observed === undefined ? {status: 'unknown'}
    : {status: 'known', observedAtMs: 1, power: {status: 'known', value: observed.power}, brightness: {status: 'known', value: observed.brightness}}} as unknown as LightingDevice['record'],
  ...(options.color === undefined ? {} : {color: {id, revision: 1, capabilities: {color: {supported: true}, temperature: {supported: false}},
    observed: {status: 'known', observedAtMs: 1, brightness: 50, ...options.color}}, colorLive: options.colorLive ?? true}),
});

void test('a light glows from its observed state only', () => {
  const red = {hue: 0, saturation: 100, kelvin: 3500};
  const lit = glowOf(['a'], [device('a', {power: true, brightness: 60}, {color: red})]);
  assert.equal(lit.level, 0.6);near(lit.color ?? [], [1, 0, 0]);
  assert.deepEqual(glowOf(['a'], [device('a', {power: false, brightness: 60}, {color: red})]), {level: 0, color: null}, 'an observed-off light draws no light');
  assert.deepEqual(glowOf(['a'], [device('a', undefined, {color: red})]), {level: 0, color: null}, 'an unknown observation draws no light');
  assert.deepEqual(glowOf(['a'], [device('a', {power: true, brightness: 60}, {live: false, color: red})]), {level: 0, color: null}, 'stale records draw no light');
  assert.deepEqual(glowOf(['a'], [device('a', {power: true, brightness: 40})]), {level: 0.4, color: null}, 'a light whose module reports no color glows warm white (null)');
  assert.equal(glowOf(['a'], [device('a', {power: true, brightness: 40}, {color: red, colorLive: false})]).color, null, 'a stale color reading is not used');
  const group = glowOf(['a', 'b', 'c'], [device('a', {power: true, brightness: 30}, {color: red}), device('b', {power: true, brightness: 80}, {color: {hue: 240, saturation: 100, kelvin: 3500}}), device('c', {power: false, brightness: 100})]);
  assert.equal(group.level, 0.8, 'a group glows as brightly as its brightest lit member');
  near(group.color ?? [], [0.5, 0, 0.5], 0.05);
  assert.equal(glowOf(['a', 'b'], [device('a', {power: true, brightness: 30}, {color: red}), device('b', {power: true, brightness: 30})]).color, null, 'a lit member without color makes the group warm white');
});

const panel = (id: string, level: number, pressed = false): GlassPanel => ({id, rect: {x: 0, y: 0, width: 220, height: 220}, radius: 34, light: {color: null, level, lamp: {x: 110, y: 60}, pressed}});
const frames = (count: number, from: ReadonlyMap<string, EasedLight>, panels: GlassPanel[], still = false): {lights: Map<string, EasedLight>; moving: boolean} => {
  let state = {lights: new Map(from), moving: false};
  for (let index = 0; index < count; index += 1) state = easeLights(state.lights, panels, 1 / 60, still);
  return state;
};

void test('light eases 16% and press 24% of the gap per frame at 60 fps, on a time base', () => {
  assert.ok(Math.abs(Math.exp(-LIGHT_RATE / 60) - 0.84) < 1e-9 && Math.abs(Math.exp(-PRESS_RATE / 60) - 0.76) < 1e-9);
  const first = frames(1, new Map(), [panel('a', 1, true)]);
  assert.ok(Math.abs((first.lights.get('a')?.level ?? 0) - 0.16) < 1e-6 && Math.abs((first.lights.get('a')?.press ?? 0) - 0.24) < 1e-6 && first.moving);
  // Two frames at 30 fps land where four at 60 fps do.
  const slow = easeLights(easeLights(new Map(), [panel('a', 1)], 1 / 30, false).lights, [panel('a', 1)], 1 / 30, false);
  assert.ok(Math.abs((slow.lights.get('a')?.level ?? 0) - (frames(4, new Map(), [panel('a', 1)]).lights.get('a')?.level ?? 0)) < 1e-6, 'speed does not depend on the refresh rate');
  const settled = frames(90, new Map(), [panel('a', 0.6)]);
  assert.deepEqual(settled.lights.get('a'), {level: 0.6, press: 0}, 'it lands exactly on the target');
  assert.equal(settled.moving, false, 'and then stops asking for frames');
  const off = frames(90, settled.lights, [panel('a', 0)]);
  assert.equal(off.moving, false);assert.equal(off.lights.get('a')?.level, 0, 'switching off fades to exactly nothing');
});

void test('reduced motion and departed panels', () => {
  const still = frames(1, new Map(), [panel('a', 0.7, true)], true);
  assert.deepEqual(still.lights.get('a'), {level: 0.7, press: 1});assert.equal(still.moving, false, 'reduced motion jumps to the target');
  const plain: GlassPanel = {id: 'b', rect: {x: 0, y: 0, width: 1, height: 1}, radius: 0};
  const gone = frames(1, new Map([['a', {level: 1, press: 0}]]), [plain]);
  assert.equal(gone.lights.size, 0, 'a panel without a lamp or no longer on the page keeps no light');
});

/** Drives frames the way the layer does: another frame only while `again` says so, at the given timestamps. */
function drive(clock: LightClock, panels: GlassPanel[], times: readonly number[]): {clock: LightClock; frames: number; again: boolean} {
  let state = clock, again = true, frames = 0;
  for (const now of times) {if (!again) break;const step = lightFrame(state, panels, now, false);state = step.clock;again = step.again;frames += 1;}
  return {clock: state, frames, again};
}

void test('a frame that repeats the last timestamp changes nothing but asks for the next (#1966 review, F8)', () => {
  const moving = lightFrame(RESTING, [panel('a', 1, true)], 1000, false);
  assert.equal(moving.changed, true);assert.equal(moving.again, true);
  const repeat = lightFrame(moving.clock, [panel('a', 1, true)], 1000, false);
  assert.equal(repeat.changed, false, 'a zero-length step moves nothing');
  assert.equal(repeat.again, true, 'but the layer must still draw the next frame, or the easing stalls');
  assert.deepEqual(repeat.clock.lights, moving.clock.lights);
  const earlier = lightFrame(moving.clock, [panel('a', 1, true)], 990, false);
  assert.equal(earlier.again, true, 'a timestamp that goes backwards is a zero-length step too');
});

void test('light and press always reach their targets and then rest, whatever the frame timing', () => {
  // Frames at 60 fps where every other one repeats the previous timestamp, then at uneven gaps.
  const repeats = Array.from({length: 400}, (_, index) => 1000 + Math.floor(index / 2) * 1000 / 60);
  const uneven = Array.from({length: 400}, (_, index) => 1000 + index * (index % 3 === 0 ? 0 : index % 3 === 1 ? 7 : 40));
  for (const times of [repeats, uneven]) {
    const up = drive(RESTING, [panel('a', 0.6, true)], times);
    assert.equal(up.again, false, 'it stops asking for frames');
    assert.deepEqual(up.clock.lights.get('a'), {level: 0.6, press: 1}, 'exactly at the targets');
    const down = drive(up.clock, [panel('a', 0, false)], times.map(time => time + 10_000));
    assert.equal(down.again, false);assert.deepEqual(down.clock.lights.get('a'), {level: 0, press: 0}, 'and back to nothing');
    const rest = lightFrame(down.clock, [panel('a', 0, false)], 99_000, false);
    assert.equal(rest.changed, false);assert.equal(rest.again, false, 'at rest a frame changes nothing and asks for none');
  }
  const still = lightFrame(RESTING, [panel('a', 0.6, true)], 1000, true);
  assert.equal(still.again, false);assert.deepEqual(still.clock.lights.get('a'), {level: 0.6, press: 1}, 'reduced motion jumps');
});

void test('the renderer passes the rows of at most MAX_LIGHTS panels that draw light now', () => {
  const plain: GlassPanel = {id: 'plain', rect: {x: 0, y: 0, width: 1, height: 1}, radius: 0};
  const panels = [plain, panel('off', 0), panel('lit', 0.5), panel('pressed', 0, true), panel('later', 0.5)];
  const lights = new Map<string, EasedLight>([['off', {level: 0, press: 0}], ['lit', {level: 0.5, press: 0}], ['pressed', {level: 0, press: 0.3}], ['later', {level: 0.5, press: 0}]]);
  assert.deepEqual(litRows(panels, lights, panels.length), [2, 3, 4], 'unlit panels and panels without a lamp are left out');
  assert.deepEqual(litRows(panels, lights, 4), [2, 3], 'only the panels the layer draws count');
  const many = Array.from({length: MAX_LIGHTS + 5}, (_, index) => panel(`p${String(index)}`, 1));
  const all = new Map(many.map(item => [item.id, {level: 1, press: 0}]));
  assert.equal(litRows(many, all, many.length).length, MAX_LIGHTS, 'the shader visits at most MAX_LIGHTS');
});
