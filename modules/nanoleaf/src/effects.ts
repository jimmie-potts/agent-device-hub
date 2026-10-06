// Custom display effects: the shared frame encoder (effects.py). Requested animation patterns move with slice 2b.
// Frames are keyframes: the device fades into each frame's color over its transition time, in deciseconds, and loops the
// whole list when asked.

export type Rgb = readonly [number, number, number];
/** One keyframe: red, green, blue and the transition into it in deciseconds. */
export type Frame = readonly [number, number, number, number];
export type Zone = readonly [number, readonly Frame[]];

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

/** The `display` write for [[panel, [[r, g, b, transition], ...]], ...] in zone order. */
export function display(_zones: readonly Zone[], _animated: boolean, _loop: boolean, _lines: boolean): DisplayWrite {
  throw new Error('Not ported yet (Hub #26, slice 2).');
}
