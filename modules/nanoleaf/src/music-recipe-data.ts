import type {Direction} from './effect-data.js';

export type MusicRecipeBase = Readonly<{rendererVersion: 1; palette: readonly string[]; intensity: number; sensitivity: number; smoothingMs: number}>;
export type MusicRecipeV1 = MusicRecipeBase & (
  {readonly effect: 'level-glow' | 'ambient'}
  | {readonly effect: 'bass-pulse'; readonly halfLifeMs: number}
  | {readonly effect: 'spectrum'; readonly direction: Direction}
  | {readonly effect: 'traveling-wave'; readonly direction: Direction; readonly periodMs: number}
);

// Browser-safe recipe preparation, shared by owner storage and synthetic preview.
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const MUSIC_DIRECTIONS = ['left', 'right', 'up', 'down', 'outward', 'inward', 'clockwise', 'counterclockwise'] as const satisfies readonly Direction[];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_COLORS = 1, MAX_COLORS = 8;
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
    const direction = MUSIC_DIRECTIONS.find(known => known === (input.direction === undefined ? 'right' : input.direction));
    if (direction === undefined) throw new TypeError('Invalid music direction.');
    if (effect === 'spectrum') return Object.freeze({...base, effect, direction});
    return Object.freeze({...base, effect, direction, periodMs: bounded(input.periodMs, 2000, 400, 10000)});
  }
  return Object.freeze({...base, effect});
}
