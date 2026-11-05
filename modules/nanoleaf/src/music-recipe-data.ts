import type {Direction} from './effect-data.js';

export type MusicRecipeBase = Readonly<{rendererVersion: 1; palette: readonly string[]; intensity: number; sensitivity: number; smoothingMs: number}>;
export type MusicRecipeV1 = MusicRecipeBase & (
  {readonly effect: 'level-glow' | 'ambient'}
  | {readonly effect: 'bass-pulse'; readonly halfLifeMs: number}
  | {readonly effect: 'spectrum'; readonly direction: Direction}
  | {readonly effect: 'traveling-wave'; readonly direction: Direction; readonly periodMs: number}
);
