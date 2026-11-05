import {isObject, pyRound} from './compat.js';
import {projection, validateElements, type LayoutEntry} from './devices.js';
import {COLOR, DIRECTIONS, display, MAX_BYTES, MAX_COLORS, MAX_FRAMES, MIN_COLORS, phases, Rejected, rgb, scale, size,
  type Display, type Rgb, type Zone} from './effects.js';
import {musicBinding, type MusicBinding, type MusicSample} from './music-input.js';
import type {MusicRecipeBase, MusicRecipeV1} from './music-recipe-data.js';
export type {MusicRecipeV1} from './music-recipe-data.js';

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max) throw new TypeError('Invalid music parameter.');
  return result;
}

/** Version-one defaults are part of the interpretation and must not change when a later version is added. */
export function freezeMusicRecipe(input: unknown): MusicRecipeV1 {
  if (!isObject(input) || input.rendererVersion !== 1) throw new TypeError('Unsupported music recipe version.');
  const effect = input.effect;
  if (effect !== 'level-glow' && effect !== 'bass-pulse' && effect !== 'spectrum' && effect !== 'traveling-wave' && effect !== 'ambient')
    throw new TypeError('Unsupported music effect.');
  const keys = ['rendererVersion', 'effect', 'palette', 'intensity', 'sensitivity', 'smoothingMs'];
  if (effect === 'bass-pulse') keys.push('halfLifeMs');
  if (effect === 'spectrum' || effect === 'traveling-wave') keys.push('direction');
  if (effect === 'traveling-wave') keys.push('periodMs');
  if (Object.keys(input).some(key => !keys.includes(key))) throw new TypeError('Unknown music recipe field.');
  const palette = input.palette;
  if (!Array.isArray(palette) || palette.length < MIN_COLORS || palette.length > MAX_COLORS
      || !palette.every((color: unknown): color is string => typeof color === 'string' && COLOR.test(color)))
    throw new TypeError('Invalid music palette.');
  const base: MusicRecipeBase = {rendererVersion: 1, palette: Object.freeze(palette.map(color => color.toLowerCase())),
    intensity: bounded(input.intensity, 1, 0, 1), sensitivity: bounded(input.sensitivity, 1, 0.1, 8),
    smoothingMs: bounded(input.smoothingMs, effect === 'ambient' ? 1500 : 100, 0, 2000)};
  if (effect === 'bass-pulse') return Object.freeze({...base, effect, halfLifeMs: bounded(input.halfLifeMs, 200, 100, 2000)});
  if (effect === 'spectrum' || effect === 'traveling-wave') {
    const direction = DIRECTIONS.find(known => known === (input.direction === undefined ? 'right' : input.direction));
    if (direction === undefined) throw new TypeError('Invalid music direction.');
    if (effect === 'spectrum') return Object.freeze({...base, effect, direction});
    return Object.freeze({...base, effect, direction, periodMs: bounded(input.periodMs, 2000, 400, 10000)});
  }
  return Object.freeze({...base, effect});
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
  readonly #recipe: MusicRecipeV1;
  readonly #binding: MusicBinding;
  readonly #colors: readonly Rgb[];
  readonly #zones: readonly (readonly number[])[];
  readonly #phases: readonly number[];
  readonly #lines: boolean;
  #previous: {sequence: number; endMs: number; elapsedMs: number} | null = null;
  #levels: readonly [number, number, number, number] = [0, 0, 0, 0];
  #pulse = 0;
  #retired = false;
  #ambient: Rgb | null = null;

  constructor(recipe: unknown, layout: LayoutEntry, binding: MusicBinding) {
    this.#recipe = freezeMusicRecipe(recipe);
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
    if (before !== null && (frame.discontinuity || frame.endMonotonicMs <= before.endMs || sample.elapsedMs <= before.elapsedMs)) {
      this.#retired = true;
      return null;
    }
    const delta = before === null ? 0 : frame.endMonotonicMs - before.endMs;
    const recipe = this.#recipe;
    const alpha = before === null || recipe.smoothingMs === 0 ? 1 : -Math.expm1(-delta / recipe.smoothingMs);
    const response = (value: number): number => clamp(value * recipe.sensitivity);
    const target = [response(frame.rms), response(frame.bands.bass), response(frame.bands.mid), response(frame.bands.treble)] as const;
    const smooth = (index: 0 | 1 | 2 | 3): number => mix(this.#levels[index], target[index], alpha);
    const levels = [smooth(0), smooth(1), smooth(2), smooth(3)] as const;
    const pulse = recipe.effect === 'bass-pulse' ? Math.max(levels[1], this.#pulse * 2 ** (-delta / recipe.halfLifeMs)) : 0;
    const sum = frame.bands.bass + frame.bands.mid + frame.bands.treble;
    const centroid = sum === 0 ? null : (0.5 * frame.bands.mid + frame.bands.treble) / sum;
    const desired = centroid === null ? this.#ambient ?? this.#colors[0] ?? [0, 0, 0] : paletteAt(this.#colors, centroid);
    const priorColor = this.#ambient ?? desired;
    const ambient: Rgb = [mix(priorColor[0], desired[0], alpha), mix(priorColor[1], desired[1], alpha), mix(priorColor[2], desired[2], alpha)];
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
    this.#levels = levels;
    this.#pulse = pulse;
    this.#ambient = ambient;
    return payload;
  }
}
