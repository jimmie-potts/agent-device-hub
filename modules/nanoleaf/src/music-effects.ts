import type {CaptureResponseSettings} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import {musicResponse, freezeResponseSettings, type MusicResponseValue} from './music-response.js';
import {isObject, pyRound} from './compat.js';
import {projection, validateElements, type LayoutEntry} from './devices.js';
import {display, MAX_BYTES, MAX_FRAMES, phases, Rejected, rgb, scale, size,
  type Direction, type Display, type Rgb, type Zone} from './effects.js';
import {musicBinding, type MusicBinding, type MusicSample} from './music-input.js';

import {freezeMusicRecipe, type MusicRecipeV1} from './music-recipe-data.js';
export {freezeMusicRecipe} from './music-recipe-data.js';
export type {MusicRecipeV1} from './music-recipe-data.js';
type EffectParameters = (
  {readonly effect: 'level-glow' | 'ambient'}
  | {readonly effect: 'bass-pulse'; readonly halfLifeMs: number}
  | {readonly effect: 'spectrum'; readonly direction: Direction}
  | {readonly effect: 'traveling-wave'; readonly direction: Direction; readonly periodMs: number}
);
export type MusicRecipeV2 = Readonly<{rendererVersion: 2; palette: readonly string[]; intensity: number; response: CaptureResponseSettings}> & EffectParameters;

export function freezeMusicRecipeV2(input: unknown): MusicRecipeV2 {
  if (!isObject(input) || input.rendererVersion !== 2 || Object.hasOwn(input, 'sensitivity') || Object.hasOwn(input, 'smoothingMs'))
    throw new TypeError('Unsupported version-two music recipe.');
  const {response, ...other} = input;
  const {rendererVersion: _version, sensitivity: _sensitivity, smoothingMs: _smoothing, ...effect} = freezeMusicRecipe({...other, rendererVersion: 1});
  return Object.freeze({...effect, rendererVersion: 2, response: freezeResponseSettings(response)});
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (before: number, after: number, alpha: number): number => before + (after - before) * alpha;
/** Non-cyclic palette: position one is the last color, unlike the requested-animation blend. */
function paletteAt(colors: readonly Rgb[], position: number): Rgb {
  const point = clamp(position) * (colors.length - 1);
  const index = Math.floor(point);
  const left = colors[index] ?? [0, 0, 0];
  const right = colors[index + 1] ?? left;
  return [pyRound(mix(left[0], right[0], point - index)), pyRound(mix(left[1], right[1], point - index)),
    pyRound(mix(left[2], right[2], point - index))];
}

/** Deterministic source-time math only. The caller owns freshness and authority; this class cannot contact a device. */
export class MusicRenderer {
  readonly #recipe: MusicRecipeV1 | MusicRecipeV2;
  readonly #settings: CaptureResponseSettings;
  #response: MusicResponseValue | undefined;
  readonly #binding: MusicBinding;
  readonly #colors: readonly Rgb[];
  readonly #zones: readonly (readonly number[])[];
  readonly #phases: readonly number[];
  readonly #lines: boolean;
  #previous: {sequence: number; endMs: number; elapsedMs: number} | null = null;
  #pulse = 0;
  #retired = false;
  #ambient: Rgb | null = null;

  constructor(recipe: unknown, layout: LayoutEntry, binding: MusicBinding) {
    this.#recipe = isObject(recipe) && recipe.rendererVersion === 2 ? freezeMusicRecipeV2(recipe) : freezeMusicRecipe(recipe);
    this.#settings = freezeResponseSettings(this.#recipe.rendererVersion === 2 ? this.#recipe.response :
      {sensitivity: this.#recipe.sensitivity, smoothingMs: this.#recipe.smoothingMs, emphasis: {bass: 1, mid: 1, treble: 1}, gate: {mode: 'off'}});
    this.#binding = musicBinding(binding);
    this.#colors = this.#recipe.palette.map(rgb);
    const saved = projection({kind: layout.kind, elements: validateElements(layout.kind, layout.elements)});
    this.#zones = saved.line_groups;
    this.#lines = layout.kind === 'lines';
    if ('direction' in this.#recipe) {
      if (saved.line_positions === undefined) throw new Rejected('unsupported-capability');
      this.#phases = phases(saved.line_positions, this.#recipe.direction);
      if (this.#phases.some(value => !Number.isFinite(value))) throw new Rejected('unsupported-capability');
    } else this.#phases = this.#zones.map(() => 0);
  }

  /** At most one static payload per accepted source sequence. Never performs catch-up interpolation. */
  render(sample: MusicSample): Display | null {
    const frame = sample.feature;
    if (this.#retired || sample.endpointId !== this.#binding.endpointId || frame.generation !== this.#binding.generation
        || !Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 0) return null;
    const before = this.#previous;
    if (before !== null && frame.sequence <= before.sequence) return null;
    // A missed window renders as an ordinary gap: decay and smoothing use the elapsed source time (#1588). Only source time
    // that runs backwards retires the renderer.
    if (before !== null && (frame.endMonotonicMs <= before.endMs || sample.elapsedMs <= before.elapsedMs)) {
      this.#retired = true;
      return null;
    }
    const delta = before === null ? 0 : frame.endMonotonicMs - before.endMs;
    const recipe = this.#recipe;
    const response = musicResponse(this.#settings, frame, delta, this.#response);
    const {alpha} = response;
    const levels = [response.level, response.bass, response.mid, response.treble] as const;
    const pulse = recipe.effect === 'bass-pulse' ? Math.max(levels[1], this.#pulse * 2 ** (-delta / recipe.halfLifeMs)) : 0;
    const bands = recipe.rendererVersion === 1 ? frame.bands : response;
    const sum = bands.bass + bands.mid + bands.treble;
    const centroid = sum === 0 ? null : (0.5 * bands.mid + bands.treble) / sum;
    const desired = centroid === null ? this.#ambient ?? this.#colors[0] ?? [0, 0, 0] : paletteAt(this.#colors, centroid);
    const priorColor = this.#ambient ?? desired;
    const ambient: Rgb = recipe.rendererVersion === 2 ? desired : [mix(priorColor[0], desired[0], alpha), mix(priorColor[1], desired[1], alpha), mix(priorColor[2], desired[2], alpha)];
    const zones: Zone[] = [];
    this.#zones.forEach((ids, index) => {
      const phase = this.#phases[index] ?? 0;
      let amount = levels[0];
      let color = this.#colors[0] ?? [0, 0, 0];
      switch (recipe.effect) {
        case 'level-glow': break;
        case 'bass-pulse': amount = pulse; break;
        case 'spectrum':
          amount = phase <= 0.5 ? mix(levels[1], levels[2], phase * 2) : mix(levels[2], levels[3], (phase - 0.5) * 2);
          color = paletteAt(this.#colors, phase);
          break;
        case 'traveling-wave': amount *= (1 + Math.cos(2 * Math.PI * (phase - sample.elapsedMs / recipe.periodMs))) / 2; break;
        case 'ambient': color = ambient; break;
      }
      const [red, green, blue] = scale(color, clamp(amount) * recipe.intensity);
      for (const id of ids) zones.push([id, [[red, green, blue, 1]]]);
    });
    const payload: Display = {write: display(zones, false, false, this.#lines)};
    if (zones.some(([, frames]) => frames.length > MAX_FRAMES) || size(payload) > MAX_BYTES) throw new Rejected('capacity');
    this.#previous = {sequence: frame.sequence, endMs: frame.endMonotonicMs, elapsedMs: sample.elapsedMs};
    this.#response = response;
    this.#pulse = pulse;
    this.#ambient = ambient;
    return payload;
  }
}
