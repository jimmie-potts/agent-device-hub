import {SHOW_LIMITS, SHOW_VERSION_SCHEMA, validShowId, type ShowSave, type ShowVersion} from '../music-show-data.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, MIN_MUSIC_CUE_MS, type MusicCue, type MusicTimeline} from '../music-timeline-data.js';
import type {Direction, Pattern, Speed} from '../effects.js';

export const PATTERN_CHOICES = ['wave', 'gradient', 'pulse', 'breathe', 'sparkle'] as const satisfies readonly Pattern[];
export const SPEED_CHOICES = ['slow', 'medium', 'fast', 'faster'] as const satisfies readonly Speed[];
export const DIRECTION_CHOICES = ['left', 'right', 'up', 'down', 'outward', 'inward', 'clockwise', 'counterclockwise'] as const satisfies readonly Direction[];
export const spatial = (pattern: Pattern): boolean => pattern === 'wave' || pattern === 'gradient';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: object, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const name = (value: unknown): value is string => typeof value === 'string' && [...value].length >= 1 && [...value].length <= SHOW_LIMITS.name && value.trim() !== '' && !/\p{C}/u.test(value);

/** Content is unknown at the browser boundary. Return only the exact requested canonical version. */
export function showVersion(value: unknown, id: string, version: number): ShowVersion {
  if (!object(value) || !exact(value, ['schema', 'showId', 'version', 'name', 'versionName', 'kind', 'timeline'])
      || value.schema !== SHOW_VERSION_SCHEMA || value.showId !== id || !validShowId(id) || value.version !== version
      || !integer(version, 1, SHOW_LIMITS.versions) || value.kind !== 'decorative' || !name(value.name) || !name(value.versionName)) throw new Error('Invalid show version.');
  return {schema: SHOW_VERSION_SCHEMA, showId: id, version, name: value.name, versionName: value.versionName, kind: 'decorative', timeline: timeline(value.timeline)};
}

function timeline(value: unknown): MusicTimeline {
  if (!object(value) || !exact(value, ['version', 'durationMs', 'cues']) || value.version !== 1
      || !integer(value.durationMs, MIN_MUSIC_CUE_MS, MAX_MUSIC_DURATION_MS) || !Array.isArray(value.cues)
      || value.cues.length < 1 || value.cues.length > MAX_MUSIC_CUES) throw new Error('Invalid show timeline.');
  const cues: MusicCue[] = [], ids = new Set<string>();
  let end = 0;
  for (const cue of value.cues) {
    if (!object(cue) || !exact(cue, ['id', 'offsetMs', 'durationMs', 'intensity', 'recipe']) || typeof cue.id !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(cue.id) || ids.has(cue.id)
        || !integer(cue.offsetMs, end, value.durationMs) || !integer(cue.durationMs, MIN_MUSIC_CUE_MS, value.durationMs - cue.offsetMs)
        || typeof cue.intensity !== 'number' || !Number.isFinite(cue.intensity) || cue.intensity < 0 || cue.intensity > 1 || !object(cue.recipe)) throw new Error('Invalid show cue.');
    const recipe = cue.recipe, pattern = PATTERN_CHOICES.find(item => item === recipe.pattern), speed = SPEED_CHOICES.find(item => item === recipe.speed);
    const direction = DIRECTION_CHOICES.find(item => item === recipe.direction);
    if (pattern === undefined || speed === undefined || typeof recipe.loop !== 'boolean'
        || !exact(recipe, spatial(pattern) ? ['pattern', 'colors', 'speed', 'loop', 'direction'] : ['pattern', 'colors', 'speed', 'loop'])
        || spatial(pattern) && direction === undefined || !Array.isArray(recipe.colors) || recipe.colors.length < 1 || recipe.colors.length > 8) throw new Error('Invalid show recipe.');
    const colors: string[] = [];
    for (const color of recipe.colors) {
      if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid show palette.');
      colors.push(color);
    }
    cues.push({id: cue.id, offsetMs: cue.offsetMs, durationMs: cue.durationMs, intensity: cue.intensity,
      recipe: {pattern, speed, colors, loop: recipe.loop, ...(direction === undefined ? {} : {direction})}});
    ids.add(cue.id); end = cue.offsetMs + cue.durationMs;
  }
  return {version: 1, durationMs: value.durationMs, cues};
}

export const STARTERS = [{id: 'ocean', name: 'Ocean drift'}, {id: 'warm', name: 'Warm rise'}] as const;
/** Each invocation constructs a separate draft. Nothing persists until an explicit save. */
export function starter(id: string, showId: string): ShowSave {
  const warm = id === 'warm';
  return {showId, expectedVersion: 0, name: warm ? 'Warm rise' : 'Ocean drift', versionName: 'First draft', timeline: {version: 1, durationMs: 30000, cues: [
    {id: 'opening', offsetMs: 0, durationMs: 8000, intensity: 0.5, recipe: {pattern: 'breathe', speed: 'slow', loop: true,
      colors: warm ? ['#ff8c1a', '#ff5a00'] : ['#003f8a', '#00b4d8']}},
    {id: 'middle', offsetMs: 10000, durationMs: 10000, intensity: 0.7, recipe: {pattern: 'wave', speed: 'slow', loop: true, direction: 'right',
      colors: warm ? ['#ff4800', '#ff7b00', '#ff006e'] : ['#0077b6', '#48cae4', '#2ec4b6']}},
    {id: 'closing', offsetMs: 20000, durationMs: 8000, intensity: 0.4, recipe: {pattern: 'sparkle', speed: 'medium', loop: true,
      colors: warm ? ['#ffd700', '#ff4fd8'] : ['#1e3a8a', '#93c5fd']}},
  ]}};
}

/** Local input feedback; authoritative preparation and guards remain at the owner. */
export function draftProblem(draft: ShowSave): string | undefined {
  if (!name(draft.name) || !name(draft.versionName)) return 'Use show and version names of 1–80 characters, without control characters.';
  try {timeline(draft.timeline);} catch {return 'Use ordered, non-overlapping cues of at least 100 ms within a show of at most 30 minutes, with 1–8 colors per cue.';}
  return undefined;
}
