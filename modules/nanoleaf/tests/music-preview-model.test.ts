import assert from 'node:assert/strict';
import {test} from './support.js';
import {freezeMusicRecipe} from '../src/music-recipe-data.js';
import {MusicPreviewDraft, parseMusicPreview} from '../src/frontend/music-preview-model.js';
import {prepareMusicPreview} from '../src/music-preview.js';
import {musicPreviewDefault, MUSIC_PREVIEW_MODELS, MUSIC_PREVIEW_PRESETS} from '../src/music-preview-data.js';

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};

test('page connection, edits and local scrubbing never read automatically', async () => {
  const paths: string[] = [];
  const model = new MusicPreviewDraft(path => {
    paths.push(path);
    return Promise.resolve(prepareMusicPreview(JSON.parse(new URL(path, 'http://synthetic.invalid').searchParams.get('request') ?? 'null')));
  });
  model.setConnected(true); model.edit({palette: ['#abcdef'], intensity: 0.8});
  assert.equal(paths.length, 0);
  await model.preview(); assert.equal(paths.length, 1);
  assert.equal(model.snapshot().sample, 6, 'the initial displayed example contains generated sound');
  assert.equal(model.snapshot().result?.recipe.intensity, 0.8);
  model.selectSample(19); assert.equal(model.snapshot().sample, 19); assert.equal(paths.length, 1);
  for (const invalid of [-1, 20, 1.5, NaN]) model.selectSample(invalid);
  assert.equal(model.snapshot().sample, 19);
  model.setConnected(false); model.setConnected(true);
  assert.equal(model.snapshot().result, undefined); assert.equal(paths.length, 1);
  model.reset(); assert.equal(paths.length, 1); assert.deepEqual(model.snapshot().draft, musicPreviewDefault());
  assert.equal(paths[0]?.startsWith('/modules/nanoleaf/content/music-preview?request='), true);
});

test('one delayed read cannot replace an edited draft or cause a second read before settlement', async () => {
  const pending = deferred<unknown>(); let reads = 0;
  const model = new MusicPreviewDraft(() => {reads += 1; return pending.promise;});
  model.setConnected(true);
  const reading = model.preview();
  const original = musicPreviewDefault();
  model.edit({intensity: 0.3}); await model.preview();
  assert.equal(reads, 1); assert.equal(model.snapshot().pending, true);
  pending.resolve(prepareMusicPreview(original)); await reading;
  assert.equal(model.snapshot().result, undefined); assert.equal(model.snapshot().draft.intensity, 0.3);
  assert.equal(model.snapshot().pending, false); assert.equal(model.snapshot().error, undefined);
});

test('disconnect and a new connection fence an old success or failure without retry', async () => {
  for (const fail of [false, true]) {
    const pending = deferred<unknown>(); let reads = 0;
    const model = new MusicPreviewDraft(() => {reads += 1; return pending.promise;});
    model.setConnected(true); const reading = model.preview();
    model.setConnected(false); model.setConnected(true);
    if (fail) pending.reject(new Error('synthetic private failure'));
    else pending.resolve(prepareMusicPreview(musicPreviewDefault()));
    await reading;
    assert.equal(reads, 1); assert.equal(model.snapshot().result, undefined); assert.equal(model.snapshot().error, undefined);
    assert.equal(model.snapshot().pending, false);
  }
});

test('unmounted connection receives no visible result and a fresh page keeps no prior draft', async () => {
  const pending = deferred<unknown>();
  const model = new MusicPreviewDraft(() => pending.promise);
  model.setConnected(true); model.edit({palette: ['#ffffff']});
  const reading = model.preview(); model.setConnected(false);
  pending.resolve(prepareMusicPreview({...musicPreviewDefault(), palette: ['#ffffff']})); await reading;
  assert.equal(model.snapshot().result, undefined);
  const fresh = new MusicPreviewDraft(() => Promise.reject(new Error('no read expected')));
  assert.deepEqual(fresh.snapshot().draft, musicPreviewDefault());
  await fresh.preview(); assert.equal(fresh.snapshot().error, undefined);
});

test('failures and invalid local drafts require explicit retry without leaking exception text', async () => {
  let reads = 0;
  const model = new MusicPreviewDraft(() => {
    reads += 1;
    if (reads === 1) return Promise.reject(new Error('synthetic private value'));
    return Promise.resolve(prepareMusicPreview(musicPreviewDefault()));
  });
  model.setConnected(true); model.edit({intensity: NaN}); await model.preview(); assert.equal(reads, 0);
  assert.equal(model.snapshot().error?.includes('Intensity'), true);
  model.reset(); await model.preview(); assert.equal(reads, 1);
  assert.equal(model.snapshot().error?.includes('unavailable'), true); assert.notEqual(model.snapshot().error?.includes('private value'), true);
  await model.preview(); assert.equal(reads, 2); assert.ok(model.snapshot().result !== undefined);
});

test('content boundary accepts canonical documents for every effect/model and rejects malformed or mismatched values', () => {
  for (const preset of MUSIC_PREVIEW_PRESETS) for (const model of MUSIC_PREVIEW_MODELS) {
    const request = {...musicPreviewDefault(), preset: preset.id, model: model.id, palette: ['#ABCDEF']};
    const document = prepareMusicPreview(request);
    assert.deepEqual(parseMusicPreview(document, request), document);
  }
  const request = musicPreviewDefault(), original = prepareMusicPreview(request);
  const changed: unknown[] = [null, {...original, schema: 'other/2.0'}, {...original, stimulus: 'live'}, {...original, model: 'nl22-demo-v1'},
    {...original, extra: true}, {...original, recipe: {...original.recipe, intensity: 0.1}}, {...original, samples: original.samples.slice(1)}];
  for (const patch of [{offsetMs: -1}, {rms: NaN}, {bands: {bass: 1.1, mid: 0, treble: 0}}, {zones: []}, {extra: true}]) {
    changed.push({...original, samples: [{...original.samples[0], ...patch}, ...original.samples.slice(1)]});
  }
  const sample = original.samples[0]; assert.ok(sample !== undefined);
  for (const rgb of [[-1, 0, 0], [0.1, 0, 0], [256, 0, 0], [0, 0], [0, 0, 0, 0]]) {
    changed.push({...original, samples: [{...sample, zones: [{id: 1, rgb}, ...sample.zones.slice(1)]}, ...original.samples.slice(1)]});
  }
  for (const value of changed) assert.throws(() => parseMusicPreview(value, request));
});

test('loading a full recipe changes only the local draft and preserves all fields through edits and preview', async () => {
  const paths: string[] = [];
  const model = new MusicPreviewDraft(path => {
    paths.push(path); return Promise.resolve(prepareMusicPreview(JSON.parse(new URL(path, 'https://synthetic.invalid').searchParams.get('request') ?? 'null')));
  });
  const saved = {rendererVersion: 1, effect: 'traveling-wave', palette: ['#12ab34'], intensity: 0.3, sensitivity: 3,
    smoothingMs: 900, direction: 'inward', periodMs: 9000} as const;
  model.setConnected(true); model.load(saved); assert.equal(paths.length, 0); assert.deepEqual(model.recipe(), saved);
  model.edit({intensity: 0.4, palette: ['#ffffff']}); await model.preview();
  assert.equal(paths.length, 1); assert.deepEqual(model.snapshot().result?.recipe, {...saved, intensity: 0.4, palette: ['#ffffff']});
  const request: unknown = JSON.parse(new URL(paths[0] ?? '', 'https://synthetic.invalid').searchParams.get('request') ?? 'null');
  assert.deepEqual(request, {version: 1, recipe: model.recipe(), model: 'lines-demo-v1'});
  model.edit({model: 'nl22-demo-v1'}); assert.equal(model.recipe().sensitivity, 3);
  model.edit({preset: 'ambient'}); assert.equal(model.snapshot().recipeOverride, undefined); assert.equal(model.recipe().smoothingMs, 1500);
});

test('loading a saved recipe invalidates an older pending preview', async () => {
  const pending = deferred<unknown>(), model = new MusicPreviewDraft(() => pending.promise);
  model.setConnected(true); const reading = model.preview();
  model.load({rendererVersion: 1, effect: 'bass-pulse', palette: ['#ffffff'], intensity: 0.4, sensitivity: 2, smoothingMs: 600, halfLifeMs: 1000});
  pending.resolve(prepareMusicPreview(musicPreviewDefault())); await reading;
  assert.equal(model.snapshot().result, undefined); assert.equal(model.recipe().effect, 'bass-pulse');
});

test('motion edits produce complete bounded recipes without reads, field leakage or changing a loaded recipe', () => {
  const model = new MusicPreviewDraft(() => {throw new Error('Editing must not read.');});
  const loaded = {rendererVersion: 1, effect: 'traveling-wave', palette: ['#12ab34'], intensity: 0.3, sensitivity: 3,
    smoothingMs: 900, direction: 'inward', periodMs: 9000} as const;
  model.load(loaded);
  assert.equal(model.editMotion({kind: 'wave-period', value: 400}), true);
  assert.equal(model.editMotion({kind: 'direction', value: 'outward'}), true);
  assert.deepEqual(model.recipe(), {...loaded, periodMs: 400, direction: 'outward'});
  assert.equal(loaded.periodMs, 9000); assert.equal(loaded.direction, 'inward');
  for (const value of [399, 10001, NaN, Infinity]) {
    const before = model.snapshot();
    assert.equal(model.editMotion({kind: 'wave-period', value}), false); assert.equal(model.snapshot(), before);
  }
  assert.equal(model.editMotion({kind: 'wave-period', value: 10000}), true);
  model.edit({preset: 'bass-pulse'});
  assert.equal(model.editMotion({kind: 'direction', value: 'left'}), false);
  assert.equal(model.editMotion({kind: 'wave-period', value: 1000}), false);
  for (const value of [100, 2000]) assert.equal(model.editMotion({kind: 'pulse-half-life', value}), true);
  for (const value of [99, 2001, NaN]) assert.equal(model.editMotion({kind: 'pulse-half-life', value}), false);
  assert.deepEqual(Object.keys(model.recipe()).sort(), ['rendererVersion', 'effect', 'palette', 'intensity', 'sensitivity', 'smoothingMs', 'halfLifeMs'].sort());
  model.edit({preset: 'spectrum'});
  for (const value of ['left', 'right', 'up', 'down', 'outward', 'inward', 'clockwise', 'counterclockwise'] as const)
    assert.equal(model.editMotion({kind: 'direction', value}), true);
  assert.equal(model.editMotion({kind: 'pulse-half-life', value: 200}), false);
  assert.equal(model.editMotion({kind: 'wave-period', value: 1000}), false);
  model.edit({preset: 'ambient'}); assert.equal(model.editMotion({kind: 'direction', value: 'left'}), false);
  assert.equal(model.recipe().smoothingMs, 1500); assert.equal(model.recipe().sensitivity, 1);
  assert.deepEqual(Object.keys(model.recipe()).sort(), ['rendererVersion', 'effect', 'palette', 'intensity', 'sensitivity', 'smoothingMs'].sort());
});


test('a motion edit fences a pending preview and full nondefault recipes round trip on both example models', async () => {
  const pending = deferred<unknown>(); let reads = 0;
  const model = new MusicPreviewDraft(path => {
    reads += 1;
    return reads === 1 ? pending.promise : Promise.resolve(prepareMusicPreview(JSON.parse(new URL(path, 'https://synthetic.invalid').searchParams.get('request') ?? 'null')));
  });
  model.setConnected(true); model.edit({preset: 'traveling-wave'});
  const oldRequest = model.recipe(), reading = model.preview();
  assert.equal(model.editMotion({kind: 'wave-period', value: 9499.5}), true);
  assert.equal(model.editMotion({kind: 'direction', value: 'counterclockwise'}), true);
  await model.preview(); assert.equal(reads, 1);
  pending.resolve(prepareMusicPreview({version: 1, recipe: oldRequest, model: 'lines-demo-v1'})); await reading;
  assert.equal(model.snapshot().result, undefined);
  const tuned = model.recipe();
  for (const example of MUSIC_PREVIEW_MODELS) {
    model.edit({model: example.id}); await model.preview();
    assert.deepEqual(model.snapshot().result?.recipe, tuned);
    const reloaded = new MusicPreviewDraft(() => {throw new Error('Load must remain local.');});
    reloaded.load(freezeMusicRecipe(JSON.parse(JSON.stringify(tuned))));
    assert.deepEqual(reloaded.recipe(), tuned);
  }
  model.edit({preset: 'bass-pulse'}); assert.equal(model.editMotion({kind: 'pulse-half-life', value: 125.5}), true);
  await model.preview(); assert.deepEqual(model.snapshot().result?.recipe, model.recipe());
});
