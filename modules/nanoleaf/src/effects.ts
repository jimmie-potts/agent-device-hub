// Custom display effects: the shared frame encoder and requested animation patterns (effects.py).
// Frames are keyframes: the device fades into each frame's color over its transition time, in deciseconds, and loops the
// whole list when asked.
import {isObject, own, pyHypot, pyJson, pyMod, pyRound, pySum} from './compat.js';
import {ValueError} from './errors.js';

export type Pattern = 'wave' | 'gradient' | 'pulse' | 'breathe' | 'sparkle';
export type Speed = 'slow' | 'medium' | 'fast' | 'faster';
export type Direction = 'left' | 'right' | 'up' | 'down' | 'outward' | 'inward' | 'clockwise' | 'counterclockwise';
export type PresetName = 'cozy' | 'ocean' | 'sunset' | 'aurora' | 'campfire' | 'forest' | 'rain' | 'focus' | 'party' | 'celebration';
export type Rgb = readonly [number, number, number];
/** One keyframe: red, green, blue and the transition into it in deciseconds. */
export type Frame = readonly [number, number, number, number];
export type Zone = readonly [number, readonly Frame[]];

/** An explicit animation; a frozen recipe has every optional field its pattern takes. */
export interface Recipe {
  pattern: Pattern;
  colors: string[];
  speed?: Speed;
  direction?: Direction;
  loop?: boolean;
}
export type RecipeInput = Recipe | {preset: PresetName};
export type ExplicitAnimation = {kind: 'animation.play'} & Recipe;
export type AnimationCommand = ExplicitAnimation | {kind: 'animation.play'; preset: PresetName} | {kind: 'animation.play'; favorite: string};

export interface DisplayWrite {
  command: 'display';
  version: '2.0';
  animType: 'custom' | 'static';
  animData: string;
  loop: boolean;
  colorType: 'HSB';
  palette: {hue: number; saturation: number; brightness: number}[];
  logicalPanelsEnabled?: true;
}
export interface Display {
  write: DisplayWrite;
}

// Spatial patterns take a direction; the others light every Line together or per Line.
export const PATTERNS: Readonly<Record<Pattern, boolean>> = Object.freeze({wave: true, gradient: true, pulse: false, breathe: false, sparkle: false});
// Deciseconds per keyframe.
export const SPEEDS: Readonly<Record<Speed, number>> = Object.freeze({slow: 8, medium: 4, fast: 2, faster: 1});
export const DIRECTIONS: readonly Direction[] = Object.freeze(['left', 'right', 'up', 'down', 'outward', 'inward', 'clockwise', 'counterclockwise']);
export const DEFAULTS = Object.freeze({speed: 'medium', direction: 'right', loop: true} as const);
const preset = (recipe: Recipe): Readonly<Recipe> => Object.freeze({...recipe, colors: Object.freeze([...recipe.colors]) as string[]});
// Curated moods use the same explicit parameters and encoder as caller-authored effects.
export const PRESETS: Readonly<Record<PresetName, Readonly<Recipe>>> = Object.freeze({
  cozy: preset({pattern: 'breathe', speed: 'slow', colors: ['#ff8c1a', '#ff5a00', '#d93a1a']}),
  ocean: preset({pattern: 'wave', speed: 'slow', direction: 'right', colors: ['#003f8a', '#0077b6', '#00b4d8', '#48cae4', '#2ec4b6']}),
  sunset: preset({pattern: 'gradient', speed: 'slow', direction: 'up', colors: ['#ff4800', '#ff7b00', '#ff006e', '#8338ec', '#3a0ca3']}),
  aurora: preset({pattern: 'wave', speed: 'slow', direction: 'right', colors: ['#00ff87', '#00c9a7', '#7b2ff7', '#2d00f7']}),
  campfire: preset({pattern: 'sparkle', speed: 'fast', colors: ['#ff3c00', '#ff7a00', '#ffb000']}),
  forest: preset({pattern: 'gradient', speed: 'slow', direction: 'up', colors: ['#0b3d0b', '#1f7a1f', '#6ab04c', '#b8e994']}),
  rain: preset({pattern: 'sparkle', speed: 'medium', colors: ['#1e3a8a', '#3b82f6', '#93c5fd']}),
  focus: preset({pattern: 'breathe', speed: 'slow', colors: ['#1d4ed8', '#0ea5e9']}),
  party: preset({pattern: 'pulse', speed: 'fast', colors: ['#ff006e', '#fb5607', '#ffbe0b', '#3a86ff', '#8338ec']}),
  celebration: preset({pattern: 'sparkle', speed: 'fast', colors: ['#ffd700', '#ffffff', '#ff4fd8']}),
});
export const MAX_FAVORITES = 32;
export const MAX_NAME = 80;
export const MIN_COLORS = 1;
export const MAX_COLORS = 8;
// The envelope already verified on the Lines: the middle-Line comet preview sends 20 frames per zone in a 9,009-byte
// request. Stay at or below both.
export const MAX_FRAMES = 20;
export const MAX_BYTES = 8192;
export const KEYFRAMES = 12;
export const FIELDS: ReadonlySet<string> = new Set(['kind', 'pattern', 'colors', 'speed', 'direction', 'loop']);
export const COLOR = /^#[0-9a-fA-F]{6}$/;
export const AXES: Readonly<Record<'right' | 'left' | 'up' | 'down', readonly [number, number]>> =
  Object.freeze({right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1]});

/** A valid command that the configured Lines cannot play within the bounds. */
export class Rejected extends ValueError {
  override name = 'Rejected';
  constructor(readonly code: 'unsupported-capability' | 'capacity') {
    super(code);
  }
}

const TAU = 2 * Math.PI;
const ROTATIONS: readonly Direction[] = ['clockwise', 'counterclockwise'];
const isPattern = (value: unknown): value is Pattern => typeof value === 'string' && Object.hasOwn(PATTERNS, value);
const sameKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** The `display` write for [[panel, [[r, g, b, transition], ...]], ...] in zone order. */
export function display(zones: readonly Zone[], animated: boolean, loop: boolean, lines: boolean): DisplayWrite {
  const data: number[] = [zones.length];
  for (const [panel, frames] of zones) {
    data.push(panel, frames.length);
    for (const [red, green, blue, transition] of frames) data.push(red, green, blue, 0, transition);
  }
  const write: DisplayWrite = {command: 'display', version: '2.0', animType: animated ? 'custom' : 'static', animData: data.join(' '), loop,
    colorType: 'HSB', palette: [{hue: 0, saturation: 0, brightness: 100}]};
  // Lines address their two logical zones; the Light Panels API defines no such flag.
  if (lines) write.logicalPanelsEnabled = true;
  return write;
}

/** Request body bytes exactly as the light transport encodes them. */
export function size(payload: unknown): number {
  return Buffer.byteLength(pyJson(payload), 'utf8');
}

/** A favorite's name: 1 to MAX_NAME characters, not only spaces, and no control, format or unassigned characters. */
export function validName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  return length >= 1 && length <= MAX_NAME && value.trim() !== '' && !/\p{C}/u.test(value);
}

/** Copy caller-supplied fields or a preset into a complete, stable explicit recipe. */
export function freeze(recipe: RecipeInput): Recipe {
  if (Object.hasOwn(recipe, 'kind')) throw new TypeError("A recipe has no 'kind'.");
  const source: Readonly<Recipe> = 'preset' in recipe ? PRESETS[recipe.preset] : recipe;
  const result: Recipe = {...source, colors: [...source.colors]};
  result.speed ??= DEFAULTS.speed;
  result.loop ??= DEFAULTS.loop;
  if (PATTERNS[result.pattern]) result.direction ??= DEFAULTS.direction;
  return result;
}

export function valid(command: unknown): command is AnimationCommand {
  if (!isObject(command) || own(command, 'kind') !== 'animation.play') return false;
  if (Object.hasOwn(command, 'favorite')) return sameKeys(command, ['kind', 'favorite']) && validName(command.favorite);
  if (Object.hasOwn(command, 'preset')) {
    const preset = command.preset;
    return sameKeys(command, ['kind', 'preset']) && typeof preset === 'string' && Object.hasOwn(PRESETS, preset);
  }
  const keys = Object.keys(command);
  if (!['kind', 'pattern', 'colors'].every(key => keys.includes(key)) || keys.some(key => !FIELDS.has(key))) return false;
  const {pattern, colors, speed, direction, loop} = command;
  if (!isPattern(pattern)) return false;
  if (!Array.isArray(colors) || colors.length < MIN_COLORS || colors.length > MAX_COLORS
      || colors.some(color => typeof color !== 'string' || !COLOR.test(color))) {
    return false;
  }
  if (speed !== undefined && (typeof speed !== 'string' || !Object.hasOwn(SPEEDS, speed))) return false;
  if (direction !== undefined && (!PATTERNS[pattern] || typeof direction !== 'string' || !DIRECTIONS.some(known => known === direction))) return false;
  return loop === undefined || typeof loop === 'boolean';
}

export function rgb(color: string): Rgb {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}

export function scale(color: Rgb, amount: number): Rgb {
  return [pyRound(color[0] * amount), pyRound(color[1] * amount), pyRound(color[2] * amount)];
}

/** A cyclic blend through the colors; position 0 is the first color, 1 wraps back to it. */
export function blend(colors: readonly Rgb[], position: number): [Rgb, number] {
  const point = pyMod(position, 1.0) * colors.length;
  const index = Math.min(Math.trunc(point), colors.length - 1);
  const amount = point - index;
  const start = colors[index] ?? [0, 0, 0];
  const end = colors[(index + 1) % colors.length] ?? start;
  const channel = (i: 0 | 1 | 2): number => pyRound(start[i] + (end[i] - start[i]) * amount);
  return [[channel(0), channel(1), channel(2)], amount];
}

const coordinate = (point: readonly number[], axis: 0 | 1): number => point[axis] ?? Number.NaN;

/** Each Line's phase: a normalized linear span or a fraction of a full turn. */
export function phases(positions: readonly (readonly number[])[], direction: Direction): number[] {
  const center = (): [number, number] =>
    [pySum(positions.map(point => coordinate(point, 0))) / positions.length, pySum(positions.map(point => coordinate(point, 1))) / positions.length];
  let values: number[];
  switch (direction) {
    case 'clockwise':
    case 'counterclockwise': {
      const [cx, cy] = center();
      const sign = direction === 'clockwise' ? -1 : 1;
      // Positive Y is up, like AXES. Preserve the full circle even on sparse walls.
      return positions.map(point => pyMod(sign * Math.atan2(coordinate(point, 1) - cy, coordinate(point, 0) - cx) / TAU, 1.0));
    }
    case 'outward':
    case 'inward': {
      const [cx, cy] = center();
      values = positions.map(point => pyHypot(coordinate(point, 0) - cx, coordinate(point, 1) - cy));
      if (direction === 'inward') values = values.map(value => -value);
      break;
    }
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      const [ax, ay] = AXES[direction];
      values = positions.map(point => coordinate(point, 0) * ax + coordinate(point, 1) * ay);
      break;
    }
  }
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  return values.map(value => (span > 1e-9 ? (value - low) / span : 0.0));
}

export type Renderer = (index: number, colors: readonly Rgb[], step: number, phase: readonly number[] | null, circular?: boolean) => Frame[];
const frame = (color: Rgb, transition: number): Frame => [color[0], color[1], color[2], transition];
const phaseOf = (phase: readonly number[] | null, index: number): number => phase?.[index] ?? Number.NaN;

export const wave: Renderer = (index, colors, step, phase, circular = false) => {
  // Linear sweeps cover three quarters of a cycle; rotations cover the full circle.
  const spread = circular ? 1.0 : 0.75;
  return Array.from({length: KEYFRAMES}, (_, k) => {
    const [color, within] = blend(colors, k / KEYFRAMES - spread * phaseOf(phase, index));
    return frame(scale(color, 0.15 + 0.85 * (0.5 + 0.5 * Math.cos(2 * Math.PI * within))), step);
  });
};

export const gradient: Renderer = (index, colors, step, phase, circular = false) => {
  // The first color starts the direction and the last ends it; the band drifts along it.
  const spread = circular ? 1.0 : (colors.length - 1) / colors.length;
  return Array.from({length: KEYFRAMES}, (_, k) => frame(blend(colors, spread * phaseOf(phase, index) - k / KEYFRAMES)[0], step));
};

export const pulse: Renderer = (_index, colors, step) => colors.flatMap(color => [frame(color, 1), frame(scale(color, 0.1), 2 * step)]);

export const breathe: Renderer = (_index, colors, step) => colors.flatMap(color => [frame(color, 3 * step), frame(scale(color, 0.05), 3 * step)]);

export const sparkle: Renderer = (index, colors, step) => {
  const color = colors[index % colors.length] ?? [0, 0, 0];
  // Deterministic, varied per Line.
  const flash = (5 * index + 3 * index * index + 7) % KEYFRAMES;
  return Array.from({length: KEYFRAMES}, (_, k) => (k === flash ? frame(color, 1) : frame(scale(color, 0.25), step)));
};

export const RENDERERS: Readonly<Record<Pattern, Renderer>> = Object.freeze({wave, gradient, pulse, breathe, sparkle});

/** The looped or one-shot display payload for a valid command on these Lines. */
export function render(command: ExplicitAnimation | {kind: 'animation.play'; preset: PresetName}, groups: readonly (readonly number[])[],
  positions: readonly (readonly number[] | null)[] | null): Display {
  const explicit: Readonly<Recipe> = 'preset' in command ? PRESETS[command.preset] : command;
  const speed = explicit.speed ?? DEFAULTS.speed;
  const direction = explicit.direction ?? DEFAULTS.direction;
  const loop = explicit.loop ?? DEFAULTS.loop;
  const spatial = PATTERNS[explicit.pattern];
  let phase: number[] | null = null;
  if (spatial) {
    if (positions === null || positions.length === 0 || positions.length !== groups.length) throw new Rejected('unsupported-capability');
    const known = positions.filter(point => point !== null);
    if (known.length !== positions.length) throw new Rejected('unsupported-capability');
    phase = phases(known, direction);
  }
  const colors = explicit.colors.map(rgb);
  const circular = spatial && ROTATIONS.includes(direction);
  const zones: Zone[] = [];
  groups.forEach((zoneIds, index) => {
    const frames = RENDERERS[explicit.pattern](index, colors, SPEEDS[speed], phase, circular);
    if (frames.length > MAX_FRAMES) throw new Rejected('capacity');
    // Both zones of a Line share its frames.
    for (const zone of zoneIds) zones.push([zone, frames]);
  });
  const payload = {write: display(zones, true, loop, true)};
  if (size(payload) > MAX_BYTES) throw new Rejected('capacity');
  return payload;
}
