// Custom display effects: the shared frame encoder and requested animation patterns (effects.py).
// Frames are keyframes: the device fades into each frame's color over its transition time, in deciseconds, and loops the
// whole list when asked.
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

const notPorted = (): never => {
  throw new Error('Not ported yet (Hub #26, slice 2b).');
};

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
export function size(_payload: unknown): number {
  return notPorted();
}

export function validName(_value: unknown): _value is string {
  return notPorted();
}

/** Copy caller-supplied fields or a preset into a complete, stable explicit recipe. */
export function freeze(_recipe: RecipeInput): Recipe {
  return notPorted();
}

export function valid(_command: unknown): _command is AnimationCommand {
  return notPorted();
}

export function rgb(_color: string): Rgb {
  return notPorted();
}

export function scale(_color: Rgb, _amount: number): Rgb {
  return notPorted();
}

/** A cyclic blend through the colors; position 0 is the first color, 1 wraps back to it. */
export function blend(_colors: readonly Rgb[], _position: number): [Rgb, number] {
  return notPorted();
}

/** Each Line's phase: a normalized linear span or a fraction of a full turn. */
export function phases(_positions: readonly (readonly number[])[], _direction: Direction): number[] {
  return notPorted();
}

export type Renderer = (index: number, colors: readonly Rgb[], step: number, phase: readonly number[] | null, circular?: boolean) => Frame[];
export const wave: Renderer = () => notPorted();
export const gradient: Renderer = () => notPorted();
export const pulse: Renderer = () => notPorted();
export const breathe: Renderer = () => notPorted();
export const sparkle: Renderer = () => notPorted();
export const RENDERERS: Readonly<Record<Pattern, Renderer>> = Object.freeze({wave, gradient, pulse, breathe, sparkle});

/** The looped or one-shot display payload for a valid command on these Lines. */
export function render(_command: ExplicitAnimation | {kind: 'animation.play'; preset: PresetName}, _groups: readonly (readonly number[])[],
  _positions: readonly (readonly number[] | null)[] | null): Display {
  return notPorted();
}
