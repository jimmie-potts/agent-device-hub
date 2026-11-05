// Semantic timing only; no renderer, clock, persistence or device dependency.
import type {Recipe} from './effect-data.js';

export const MAX_MUSIC_CUES = 256;
export const MAX_MUSIC_DURATION_MS = 30 * 60 * 1000;
export const MIN_MUSIC_CUE_MS = 100;
type FrozenRecipe = Readonly<Omit<Recipe, 'colors'>> & {readonly colors: readonly string[]};
export type MusicCue = Readonly<{id: string; offsetMs: number; durationMs: number; recipe: FrozenRecipe; intensity: number}>;
export type MusicTimeline = Readonly<{version: 1; durationMs: number; cues: readonly MusicCue[]}>;
export type CueSelection = {kind: 'cue'; cue: MusicCue; elapsedMs: number} | {kind: 'gap'} | {kind: 'ended'};

/** Half-open intervals, with no phase-accurate animation or output claim. */
export function selectMusicCue(timeline: MusicTimeline, positionMs: number): CueSelection {
  if (!Number.isFinite(positionMs) || positionMs < 0 || positionMs > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid music position.');
  if (positionMs >= timeline.durationMs) return {kind: 'ended'};
  const cue = timeline.cues.find(candidate => positionMs >= candidate.offsetMs && positionMs < candidate.offsetMs + candidate.durationMs);
  return cue === undefined ? {kind: 'gap'} : {kind: 'cue', cue, elapsedMs: positionMs - cue.offsetMs};
}
