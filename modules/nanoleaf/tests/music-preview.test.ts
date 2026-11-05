import assert from 'node:assert/strict';
import {ModuleWorld} from './module-support.js';
import {test, decode} from './support.js';
import {musicPreviewContent} from '../src/module/music-preview-content.js';
import {prepareMusicPreview} from '../src/music-preview.js';
import {freezeMusicRecipe, MusicRenderer} from '../src/music-effects.js';
import type {MusicSample} from '../src/music-input.js';
import {elementId, type LayoutEntry} from '../src/devices.js';
import {MUSIC_PREVIEW_LIMITS, MUSIC_PREVIEW_MODELS, MUSIC_PREVIEW_PRESETS, MUSIC_PREVIEW_SCHEMA, MUSIC_PREVIEW_STIMULUS} from '../src/music-preview-data.js';

const request = {version: 1, preset: 'level-glow', palette: ['#112233'], intensity: 0.5, model: 'lines-demo-v1'};
const content = (value: unknown) => musicPreviewContent({query: {request: JSON.stringify(value)}, signal: new AbortController().signal});

test('all built-ins are explicit frozen V1 recipes', () => {
  assert.equal(MUSIC_PREVIEW_PRESETS.length, 5);
  assert.equal(new Set(MUSIC_PREVIEW_PRESETS.map(value => value.id)).size, 5);
  assert.ok(Object.isFrozen(MUSIC_PREVIEW_PRESETS));
  for (const preset of MUSIC_PREVIEW_PRESETS) {
    assert.equal(preset.id, preset.recipe.effect);
    assert.deepEqual(preset.recipe, freezeMusicRecipe(preset.recipe));
    assert.ok(Object.isFrozen(preset) && Object.isFrozen(preset.recipe) && Object.isFrozen(preset.recipe.palette));
  }
});

test('every effect and example model agrees with canonical RGB at both intensity bounds', () => {
  const binding = {endpointId: 'canonical-test', generation: '00000000-0000-4000-8000-000000000777'};
  for (const preset of MUSIC_PREVIEW_PRESETS) for (const model of MUSIC_PREVIEW_MODELS) {
    const layout: LayoutEntry = {kind: model.kind, elements: Array.from({length: 6}, (_, index) => {
      const zones = model.kind === 'lines' ? [2 * index + 1, 2 * index + 2] : [index + 1];
      return {id: elementId(zones), number: index + 1, zones, position: [index % 3, Math.floor(index / 3)]};
    })};
    for (const intensity of [0, 1]) for (const palette of [['#abcdef'], Array(8).fill('#ffffff')]) {
      const value = {...request, preset: preset.id, model: model.id, palette, intensity};
      const response = content(value); assert.ok(!('error' in response));
      assert.ok(response.bytes.byteLength <= MUSIC_PREVIEW_LIMITS.responseBytes);
      const prepared = prepareMusicPreview(value);
      assert.deepEqual(JSON.parse(Buffer.from(response.bytes).toString()), prepared);
      assert.equal(prepared.schema, MUSIC_PREVIEW_SCHEMA); assert.equal(prepared.stimulus, MUSIC_PREVIEW_STIMULUS);
      assert.equal(prepared.model, model.id); assert.equal(prepared.samples.length, 20);
      assert.deepEqual(prepared.recipe, freezeMusicRecipe({...preset.recipe, palette, intensity}));
      const canonical = new MusicRenderer(prepared.recipe, layout, binding);
      for (const [index, sample] of prepared.samples.entries()) {
        assert.equal(sample.offsetMs, index * 100);
        const feature: MusicSample['feature'] = {generation: binding.generation, input: 'music', sequence: index + 1, sampleRateHz: 48000, channels: 2, frameCount: 4800,
          startMonotonicMs: 900000 + sample.offsetMs, endMonotonicMs: 900100 + sample.offsetMs, emittedMonotonicMs: 900101 + sample.offsetMs,
          observedAtMs: 1793836800000 + sample.offsetMs, validUntilMs: 1793836800400 + sample.offsetMs,
          rms: sample.rms, peak: Math.max(sample.rms, 0.9), clippedFraction: 0, bands: {...sample.bands},
          onset: {strength: 0, confidence: 0}, discontinuity: index === 0};
        const output = canonical.render({endpointId: binding.endpointId, elapsedMs: sample.offsetMs, feature}); assert.ok(output !== null);
        assert.deepEqual(sample.zones, [...decode(output)].map(([id, frames]) => ({id, rgb: frames[0]?.slice(0, 3)})));
        assert.equal(sample.zones.length, model.zones);
        assert.ok(sample.zones.flatMap(zone => zone.rgb).every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255));
      }
    }
  }
});

test('invalid closed requests refuse before returning any content', () => {
  const invalid: unknown[] = [null, [], {}, {...request, version: 2}, {...request, preset: 'beat'}, {...request, model: '../wall'},
    {...request, palette: []}, {...request, palette: Array(9).fill('#ffffff')}, {...request, palette: ['red']},
    {...request, intensity: -0.1}, {...request, intensity: 1.1}, {...request, intensity: null}, {...request, intensity: NaN},
    {...request, target: 'wall'}, {...request, file: '/private/synthetic'}, {...request, action: 'start'}];
  for (const value of invalid) {
    const response = content(value);
    assert.equal('error' in response && response.error.code, 'invalid-request');
    assert.ok(!JSON.stringify(response).includes('/private/synthetic'));
  }
  for (const query of [{}, {request: '{'}, {request: JSON.stringify(request), extra: 'value'}, {request: '"' + 'é'.repeat(1024) + '"'}]) {
    const response = musicPreviewContent({query, signal: new AbortController().signal});
    assert.equal('error' in response && response.error.code, 'invalid-request');
  }
  const absent = musicPreviewContent(); assert.equal('error' in absent && absent.error.code, 'invalid-request');
});

test('the exact decoded request byte boundary is accepted and one extra byte refuses', () => {
  const json = JSON.stringify(request);
  const padded = json + ' '.repeat(MUSIC_PREVIEW_LIMITS.requestBytes - Buffer.byteLength(json));
  const read = (text: string) => musicPreviewContent({query: {request: text}, signal: new AbortController().signal});
  const exact = read(padded); assert.ok(!('error' in exact));
  const oversized = read(padded + ' '); assert.equal('error' in oversized && oversized.error.code, 'invalid-request');
});

test('cancelled preparation returns registered cancellation and recipient mutations cannot alter future previews', () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = musicPreviewContent({query: {request: JSON.stringify(request)}, signal: controller.signal});
  assert.equal('error' in cancelled && cancelled.error.code, 'cancelled');
  const first = prepareMusicPreview(request), expected = JSON.stringify(first);
  const sample = first.samples[0]; assert.ok(sample !== undefined);
  Object.assign(sample, {rms: 99});
  Object.assign(sample.zones[0]?.rgb ?? [], {0: 255});
  assert.equal(JSON.stringify(prepareMusicPreview(request)), expected);
});

test('explicit synthetic preview returns bounded RGB without changing module or device state', async context => {
  const world = await ModuleWorld.open(context);
  await world.start(); await world.advance(2000);
  const snapshot = () => ({changes: world.query('SELECT total_changes()'), commands: world.query('SELECT * FROM nanoleaf_commands'),
    meta: world.query('SELECT * FROM meta'), writes: world.writes().length, messages: world.seen.length, sent: world.harness.sent.length});
  const before = snapshot();
  const answer = await world.content('music-preview', {query: {request: JSON.stringify(request)}, signal: new AbortController().signal});
  assert.ok(answer !== undefined && !('error' in answer), 'the declared preview content is available');
  assert.equal(answer.type, 'application/json');
  assert.ok(answer.bytes.byteLength <= 16 * 1024);
  const value: unknown = JSON.parse(Buffer.from(answer.bytes).toString());
  assert.ok(typeof value === 'object' && value !== null && 'schema' in value && value.schema === 'nanoleaf-music-preview/2.0');
  assert.ok('samples' in value && Array.isArray(value.samples) && value.samples.length === 20);
  assert.deepEqual(snapshot(), before);
  world.verifyMessages();
});

test('full-recipe preview keeps every V1 field and maximal requests fit the unchanged gateway query bound', () => {
  for (const effect of ['level-glow', 'bass-pulse', 'spectrum', 'traveling-wave', 'ambient']) {
    const extra = effect === 'bass-pulse' ? {halfLifeMs: 1999.9999999999998}
      : effect === 'traveling-wave' ? {direction: 'counterclockwise', periodMs: 9999.999999999998}
        : effect === 'spectrum' ? {direction: 'counterclockwise'} : {};
    const recipe = freezeMusicRecipe({rendererVersion: 1, effect, palette: Array.from({length: 8}, () => '#abcdef'),
      intensity: 0.0000010000000000000002, sensitivity: 7.999999999999999, smoothingMs: 1999.9999999999998, ...extra});
    for (const model of ['lines-demo-v1', 'nl22-demo-v1']) {
      const request = {version: 1, recipe, model}, encoded = JSON.stringify(request);
      assert.ok(encoded.length <= 512);
      // A finite JS number's shortest JSON representation is at most 25 characters; reserve that for every editable numeric value.
      const upper = encoded.replace(/0\.0000010000000000000002|7\.999999999999999|1999\.9999999999998|9999\.999999999998/g, '9'.repeat(25));
      assert.ok(upper.length <= 512, `maximal full recipe request upper bound ${String(upper.length)}`);
      const prepared = prepareMusicPreview(request); assert.deepEqual(prepared.recipe, recipe); assert.equal(prepared.samples.length, 20);
    }
  }
  for (const request of [
    {version: 1, recipe: {rendererVersion: 2}, model: 'lines-demo-v1'},
    {version: 1, recipe: {rendererVersion: 1, effect: 'ambient', palette: ['#ffffff'], calibration: 1}, model: 'lines-demo-v1'},
    {version: 1, recipe: {}, model: 'lines-demo-v1', preset: 'ambient'},
  ]) assert.throws(() => prepareMusicPreview(request), TypeError);
});
