import {isObject} from './compat.js';
import {elementId, type LayoutEntry} from './devices.js';
import type {Display} from './effects.js';
import {freezeMusicRecipe, MusicRenderer} from './music-effects.js';
import type {MusicSample} from './music-input.js';
import {MUSIC_PREVIEW_MODELS, MUSIC_PREVIEW_PRESETS, MUSIC_PREVIEW_SCHEMA, MUSIC_PREVIEW_STIMULUS,
  type MusicPreview, type MusicPreviewZone} from './music-preview-data.js';

const keys = ['version', 'preset', 'palette', 'intensity', 'model'];
const binding = {endpointId: 'synthetic-preview', generation: '00000000-0000-4000-8000-000000000722'};
const bands = [
  [0, 0, 0], [0.2, 0.1, 0.1], [0.9, 0.15, 0.05], [0.4, 0.25, 0.1], [0.1, 0.5, 0.25],
  [0.05, 0.8, 0.4], [0.15, 0.3, 0.8], [0.7, 0.2, 0.5], [0.2, 0.6, 0.4], [0.05, 0.2, 0.9],
  [0.8, 0.4, 0.2], [0.3, 0.6, 0.1], [0.1, 0.8, 0.3], [0.05, 0.35, 0.7], [0.6, 0.1, 0.2],
  [0.2, 0.25, 0.5], [0.1, 0.15, 0.25], [0, 0, 0], [0, 0, 0], [0, 0, 0],
] as const;

function exampleLayout(model: (typeof MUSIC_PREVIEW_MODELS)[number]): LayoutEntry {
  return {kind: model.kind, elements: Array.from({length: 6}, (_, index) => {
    const zones = model.kind === 'lines' ? [index * 2 + 1, index * 2 + 2] : [index + 1];
    return {id: elementId(zones), number: index + 1, zones, position: [index % 3, Math.floor(index / 3)]};
  })};
}

function stimulus(index: number, [bass, mid, treble]: readonly [number, number, number]): MusicSample {
  const offset = index * 100, rms = Math.max(bass, mid, treble) * 0.8;
  return {endpointId: binding.endpointId, elapsedMs: offset, feature: {
    generation: binding.generation, input: 'music', sequence: index + 1, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: offset, endMonotonicMs: offset + 100, emittedMonotonicMs: offset + 101,
    observedAtMs: 10000 + offset, validUntilMs: 10400 + offset, rms, peak: Math.min(1, rms * 1.5), clippedFraction: 0,
    bands: {bass, mid, treble}, onset: {strength: 0, confidence: 0}, discontinuity: index === 0,
  }};
}

function channel(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid preview renderer output.');
  return value;
}

/** Project only the canonical static encoder's one RGB frame per example zone. */
function rgbZones(payload: Display, count: number): MusicPreviewZone[] {
  const write = payload.write, values = write.animData.split(' ').map(Number);
  if (write.animType !== 'static' || write.loop || values[0] !== count || values.length !== 1 + count * 7)
    throw new Error('Invalid preview renderer output.');
  return Array.from({length: count}, (_, index) => {
    const cursor = 1 + index * 7;
    if (values[cursor] !== index + 1 || values[cursor + 1] !== 1 || values[cursor + 5] !== 0 || values[cursor + 6] !== 1)
      throw new Error('Invalid preview renderer output.');
    return {id: index + 1, rgb: [channel(values[cursor + 2]), channel(values[cursor + 3]), channel(values[cursor + 4])]};
  });
}

/** Finite synthetic computation. It reads no device, state, storage, capture or clock. */
export function prepareMusicPreview(input: unknown): MusicPreview {
  if (!isObject(input) || Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))
      || input.version !== 1 || typeof input.intensity !== 'number') throw new TypeError('Invalid Music preview request.');
  const preset = MUSIC_PREVIEW_PRESETS.find(value => value.id === input.preset);
  const model = MUSIC_PREVIEW_MODELS.find(value => value.id === input.model);
  if (preset === undefined || model === undefined) throw new TypeError('Invalid Music preview request.');
  const recipe = freezeMusicRecipe({...preset.recipe, palette: input.palette, intensity: input.intensity});
  const renderer = new MusicRenderer(recipe, exampleLayout(model), binding);
  const samples = bands.map((levels, index) => {
    const sample = stimulus(index, levels), rendered = renderer.render(sample);
    if (rendered === null) throw new Error('Music preview could not render.');
    return {offsetMs: sample.elapsedMs, rms: sample.feature.rms, bands: {...sample.feature.bands}, zones: rgbZones(rendered, model.zones)};
  });
  return {schema: MUSIC_PREVIEW_SCHEMA, recipe, model: model.id, stimulus: MUSIC_PREVIEW_STIMULUS, samples};
}
