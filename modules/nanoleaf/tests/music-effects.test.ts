import assert from 'node:assert/strict';
import {test, decode} from './support.js';
import {freezeMusicRecipe, MusicRenderer, type MusicRecipeV1} from '../src/music-effects.js';
import {MusicInput, type MusicSample} from '../src/music-input.js';
import {MAX_BYTES, size, type Display} from '../src/effects.js';
import {elementId, type Kind, type LayoutEntry} from '../src/devices.js';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';

const binding = {endpointId: 'music-mac', generation: '9df02246-518e-44f2-9412-a942735e63cd'};
const at = 1793836800000;
const layout = (kind: Kind = 'lines', positions: readonly number[] = [0, 1, 2]): LayoutEntry => ({kind,
  elements: positions.map((x, index) => {
    const zones = kind === 'lines' ? [2 * index + 1, 2 * index + 2] : [index + 1];
    return {id: elementId(zones), number: index + 1, zones, position: [x, 0]};
  })});
const recipe = (effect: MusicRecipeV1['effect'], patch: object = {}): MusicRecipeV1 =>
  freezeMusicRecipe({rendererVersion: 1, effect, palette: ['#64c850'], smoothingMs: 0, ...patch});
const sample = (delta = 0, patch: Partial<CaptureFeatures> = {}): MusicSample => ({endpointId: binding.endpointId, elapsedMs: delta, feature: {
  generation: binding.generation, input: 'music', sequence: delta / 100 + 1, sampleRateHz: 48000, channels: 2, frameCount: 4800,
  startMonotonicMs: 900000 + delta, endMonotonicMs: 900100 + delta, emittedMonotonicMs: 900102 + delta,
  observedAtMs: at + delta, validUntilMs: at + delta + 400, rms: 1, peak: 1, clippedFraction: 0,
  bands: {bass: 1, mid: 0.5, treble: 0.25}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...patch,
}});
const colors = (payload: Display | null): number[][] => {
  assert.ok(payload);
  return [...decode(payload).values()].map(frames => {
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.[3], 0);
    assert.equal(frames[0]?.[4], 1);
    return frames[0]?.slice(0, 3) ?? [];
  });
};

test('a rejected oversized frame cannot change V1 response state', () => {
  const large = layout('lines', Array.from({length: 184}, (_, index) => index));
  const make = () => new MusicRenderer(recipe('level-glow', {palette: ['#ffffff'], smoothingMs: 200}), large, binding);
  const rejected = make(), reference = make();
  const silence = (delta: number) => sample(delta, {rms: 0, peak: 0, bands: {bass: 0, mid: 0, treble: 0}});
  rejected.render(silence(0));reference.render(silence(0));
  assert.throws(() => rejected.render(sample(100)), /capacity/);
  assert.deepEqual(rejected.render(silence(200)), reference.render(silence(200)));
});

test('level, bass and three-band spectrum have exact measured vectors on both device kinds', () => {
  for (const kind of ['lines', 'panels'] as const) {
    const multiplier = kind === 'lines' ? 2 : 1;
    const level = new MusicRenderer(recipe('level-glow', {intensity: 0.8}), layout(kind), binding);
    assert.deepEqual(colors(level.render(sample(0, {rms: 0.5}))), Array(3 * multiplier).fill([40, 80, 32]));
    const pulse = new MusicRenderer(recipe('bass-pulse', {halfLifeMs: 200}), layout(kind), binding);
    assert.deepEqual(colors(pulse.render(sample(0, {bands: {bass: 0.8, mid: 0, treble: 0}}))), Array(3 * multiplier).fill([80, 160, 64]));
    assert.deepEqual(colors(pulse.render(sample(200, {rms: 0, bands: {bass: 0, mid: 0, treble: 0}}))), Array(3 * multiplier).fill([40, 80, 32]));
    const spectrum = new MusicRenderer(recipe('spectrum'), layout(kind), binding);
    assert.deepEqual(colors(spectrum.render(sample())), [[100, 200, 80], [50, 100, 40], [25, 50, 20]].flatMap(color => Array.from({length: multiplier}, () => color)));
    const reverse = new MusicRenderer(recipe('spectrum', {direction: 'left'}), layout(kind), binding);
    assert.deepEqual(colors(reverse.render(sample())), [[25, 50, 20], [50, 100, 40], [100, 200, 80]].flatMap(color => Array.from({length: multiplier}, () => color)));
  }
});

test('traveling waves follow source elapsed time and decorative period, without synthesized tempo', () => {
  const render = new MusicRenderer(recipe('traveling-wave', {periodMs: 400}), layout('panels', [0, 1, 2, 4]), binding);
  assert.deepEqual(colors(render.render(sample())).slice(0, 3), [[100, 200, 80], [50, 100, 40], [0, 0, 0]]);
  assert.deepEqual(colors(render.render(sample(100))).slice(0, 3), [[50, 100, 40], [100, 200, 80], [50, 100, 40]]);
});

test('ambient centroid selects palette endpoints and valid silence decays brightness', () => {
  for (const [bands, expected] of [
    [{bass: 1, mid: 0, treble: 0}, [255, 0, 0]],
    [{bass: 1, mid: 1, treble: 1}, [0, 255, 0]],
    [{bass: 0, mid: 0, treble: 1}, [0, 0, 255]],
  ] as const) {
    const render = new MusicRenderer(recipe('ambient', {palette: ['#ff0000', '#00ff00', '#0000ff']}), layout('panels'), binding);
    assert.deepEqual(colors(render.render(sample(0, {bands}))), Array(3).fill(expected));
    assert.deepEqual(colors(render.render(sample(100, {rms: 0, bands: {bass: 0, mid: 0, treble: 0}}))), Array(3).fill([0, 0, 0]));
  }
  const render = new MusicRenderer(recipe('ambient', {smoothingMs: 200}), layout('panels'), binding);
  render.render(sample());
  const expected = [Math.round(100 / Math.E), Math.round(200 / Math.E), Math.round(80 / Math.E)];
  assert.deepEqual(colors(render.render(sample(200, {rms: 0, bands: {bass: 0, mid: 0, treble: 0}}))), Array(3).fill(expected));
});

test('all five effects use bounded static payloads, correct zones and deterministic bytes', () => {
  for (const kind of ['lines', 'panels'] as const) for (const effect of ['level-glow', 'bass-pulse', 'spectrum', 'traveling-wave', 'ambient'] as const) {
    const first = new MusicRenderer(recipe(effect), layout(kind), binding);
    const second = new MusicRenderer(recipe(effect), layout(kind), binding);
    for (const delta of [0, 100, 300]) {
      const feature = sample(delta, {rms: 16, peak: 16, clippedFraction: 1, bands: {bass: 32, mid: 32, treble: 32}});
      const output = first.render(feature);
      assert.deepEqual(output, second.render(feature));
      assert.equal(output?.write.animType, 'static');
      assert.equal(output?.write.loop, false);
      assert.equal(output?.write.logicalPanelsEnabled, kind === 'lines' ? true : undefined);
      assert.ok(size(output) <= MAX_BYTES);
      const values = colors(output);
      assert.equal(values.length, kind === 'lines' ? 6 : 3);
      assert.ok(values.flat().every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255));
      if (kind === 'lines') for (let index = 0; index < values.length; index += 2) assert.deepEqual(values[index], values[index + 1]);
    }
  }
});

test('recipes are closed, bounded, versioned and frozen through serialization', () => {
  const original = {rendererVersion: 1, effect: 'ambient', palette: ['#AA0011']};
  const frozen = freezeMusicRecipe(original);
  assert.deepEqual(frozen, {rendererVersion: 1, effect: 'ambient', palette: ['#aa0011'], intensity: 1, sensitivity: 1, smoothingMs: 1500});
  original.palette[0] = '#000000';
  assert.equal(frozen.palette[0], '#aa0011');
  assert.equal(Object.isFrozen(frozen.palette), true);
  assert.equal(Object.isFrozen(frozen), true);
  assert.deepEqual(freezeMusicRecipe(JSON.parse(JSON.stringify(frozen))), frozen);
  for (const patch of [{rendererVersion: 2}, {effect: 'beat'}, {palette: []}, {palette: Array(9).fill('#ffffff')},
    {palette: ['red']}, {intensity: -1}, {intensity: 1.01}, {intensity: NaN}, {sensitivity: Infinity}, {sensitivity: 0},
    {smoothingMs: 2001}, {smoothingMs: -1}, {direction: 'right'}, {halfLifeMs: 200}, {periodMs: 2000}, {extra: true}]) {
    assert.throws(() => freezeMusicRecipe({...recipe('level-glow'), ...patch}));
  }
  assert.throws(() => recipe('bass-pulse', {halfLifeMs: 99}));
  assert.throws(() => recipe('traveling-wave', {periodMs: 399}));
  assert.throws(() => recipe('spectrum', {direction: 'diagonal'}));
  for (const effect of ['spectrum', 'traveling-wave'] as const) assert.throws(() => recipe(effect, {direction: null}));
});

test('prepared geometry is copied, missing spatial positions and oversized payloads are refused', () => {
  const saved = layout();
  const render = new MusicRenderer(recipe('level-glow'), saved, binding);
  saved.elements[0]?.zones.splice(0, 2, 600, 601);
  const output = render.render(sample());
  assert.ok(output);
  assert.deepEqual([...decode(output).keys()], [1, 2, 3, 4, 5, 6]);
  const missing = layout();
  for (const element of missing.elements) element.position = null;
  assert.throws(() => new MusicRenderer(recipe('spectrum'), missing, binding), /unsupported-capability/);
  assert.doesNotThrow(() => new MusicRenderer(recipe('level-glow'), missing, binding));
  const oversized = new MusicRenderer(recipe('level-glow'), layout('lines', Array.from({length: 300}, (_, i) => i)), binding);
  assert.throws(() => oversized.render(sample()), /capacity/);
});

test('renderer fences binding and repeated windows without changing future output', () => {
  const render = new MusicRenderer(recipe('bass-pulse'), layout('panels'), binding);
  const original = sample();
  const snapshot = structuredClone(original);
  render.render(original);
  assert.deepEqual(original, snapshot);
  assert.equal(render.render(original), null);
  assert.equal(render.render({...sample(100), endpointId: 'other'}), null);
  assert.equal(render.render(sample(100, {generation: '9df02246-518e-44f2-9412-a942735e63ce'})), null);
  assert.deepEqual(colors(render.render(sample(200, {bands: {bass: 0, mid: 0, treble: 0}}))), Array(3).fill([50, 100, 40]));
  assert.ok(render.render(sample(400, {discontinuity: true})), 'a missed window does not retire the renderer (#1588)');
  assert.equal(render.render(sample(500, {endMonotonicMs: 900450})), null, 'source time that runs backwards retires it');
  assert.equal(render.render(sample(600)), null, 'a later window cannot resume a retired renderer');
});

test('a discontinuity after a missed window continues the effect as an ordinary gap would', () => {
  for (const effect of ['level-glow', 'bass-pulse', 'spectrum', 'traveling-wave', 'ambient'] as const) {
    const patch = {halfLifeMs: 200, smoothingMs: 150};
    const flagged = new MusicRenderer(recipe(effect, effect === 'bass-pulse' ? patch : {smoothingMs: 150}), layout('lines'), binding);
    const plain = new MusicRenderer(recipe(effect, effect === 'bass-pulse' ? patch : {smoothingMs: 150}), layout('lines'), binding);
    for (const renderer of [flagged, plain]) renderer.render(sample(0, {bands: {bass: 0.8, mid: 0.4, treble: 0.2}}));
    const quiet = {rms: 0.1, bands: {bass: 0.1, mid: 0.05, treble: 0}};
    assert.deepEqual(flagged.render(sample(200, {...quiet, discontinuity: true})), plain.render(sample(200, quiet)), effect);
    assert.deepEqual(flagged.render(sample(300)), plain.render(sample(300)), `${effect} after the gap`);
  }
});

test('source intake and renderer accept the first native window together, then expire without rendering', () => {
  const input = new MusicInput(binding, {wallMs: at, monotonicMs: 20});
  const data = sample(0, {discontinuity: true}).feature;
  assert.equal(input.accept({specversion: '1.0', bunnyprofile: '2.0', id: 'first-window', source: 'bunny/parts/music-producer',
    type: 'org.bunny.music-capture.features.observed', subject: binding.endpointId, time: '2026-11-05T00:00:00.000Z',
    kind: 'occurrence', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/music-capture-features/2.0',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data}, {wallMs: at, monotonicMs: 20}), 'accepted');
  const current = input.current({wallMs: at, monotonicMs: 20});
  assert.ok(current);
  assert.deepEqual(colors(new MusicRenderer(recipe('level-glow'), layout('panels'), binding).render(current)), Array(3).fill([100, 200, 80]));
  assert.equal(input.current({wallMs: at + 400, monotonicMs: 420}), null);
});

test('zero intensity and valid silence produce black without treating low onset confidence as a beat', () => {
  for (const effect of ['level-glow', 'bass-pulse', 'spectrum', 'traveling-wave', 'ambient'] as const) {
    const zeroIntensity = new MusicRenderer(recipe(effect, {intensity: 0}), layout('panels'), binding);
    assert.deepEqual(colors(zeroIntensity.render(sample())), Array(3).fill([0, 0, 0]));
    const silence = new MusicRenderer(recipe(effect), layout('panels'), binding);
    assert.deepEqual(colors(silence.render(sample(0, {rms: 0, bands: {bass: 0, mid: 0, treble: 0},
      onset: {strength: 1, confidence: 0}}))), Array(3).fill([0, 0, 0]));
  }
});

test('smoothing follows source elapsed time despite skipped windows', () => {
  const frequent = new MusicRenderer(recipe('level-glow', {smoothingMs: 200}), layout('panels'), binding);
  const sparse = new MusicRenderer(recipe('level-glow', {smoothingMs: 200}), layout('panels'), binding);
  frequent.render(sample());
  sparse.render(sample());
  frequent.render(sample(100, {rms: 0}));
  assert.deepEqual(frequent.render(sample(200, {rms: 0})), sparse.render(sample(200, {rms: 0})));
});

test('explicit V2 and numerical response share a single gate, emphasis and smoothing interpretation', async () => {
  const {musicResponse} = await import('../src/music-response.js');
  const {freezeMusicRecipeV2} = await import('../src/music-effects.js');
  const settings = {sensitivity: 2, smoothingMs: 200, emphasis: {bass: 2, mid: 0.5, treble: 0}, gate: {mode: 'manual', threshold: 0.1}};
  const frozen = freezeMusicRecipeV2({rendererVersion: 2, effect: 'spectrum', palette: ['#ffffff'], response: settings});
  assert.throws(() => freezeMusicRecipeV2({...frozen, sensitivity: 1}));
  assert.throws(() => freezeMusicRecipeV2({...frozen, smoothingMs: 100}));
  for (const kind of ['lines', 'panels'] as const) {
    const render = new MusicRenderer(frozen, layout(kind), binding);
    let preview: import('../src/music-response.js').MusicResponseValue | undefined;
    for (const [delta, rms, bands] of [[0, 0.5, {bass: 0.2, mid: 0.4, treble: 1}], [100, 0.01, {bass: 0.01, mid: 0.01, treble: 0.01}]] as const) {
      const observation = sample(delta, {rms, bands}), value = musicResponse(settings, observation.feature, delta === 0 ? 0 : 100, preview);
      preview = value;
      assert.equal(value.gateOpen, delta === 0);
      const expected = [value.bass, value.mid, value.treble].flatMap(level => Array.from({length: kind === 'lines' ? 2 : 1}, () => {
        const channel = Math.round(255 * level);return [channel, channel, channel];
      }));
      assert.deepEqual(colors(render.render(observation)), expected);
    }
    assert.deepEqual(colors(new MusicRenderer(JSON.parse(JSON.stringify(frozen)), layout(kind), binding).render(sample())),
      colors(new MusicRenderer(frozen, layout(kind), binding).render(sample())));
  }
});
