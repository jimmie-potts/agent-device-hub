// Browser-safe semantic recipe types; encoding and device payloads remain in effects.ts.
export type Pattern = 'wave' | 'gradient' | 'pulse' | 'breathe' | 'sparkle';
export type Speed = 'slow' | 'medium' | 'fast' | 'faster';
export type Direction = 'left' | 'right' | 'up' | 'down' | 'outward' | 'inward' | 'clockwise' | 'counterclockwise';

/** An explicit animation; preparation supplies the optional defaults. */
export interface Recipe {
  pattern: Pattern;
  colors: string[];
  speed?: Speed;
  direction?: Direction;
  loop?: boolean;
}
