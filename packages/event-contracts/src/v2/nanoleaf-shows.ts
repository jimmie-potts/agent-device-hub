// Shared show contracts and pure authoring helpers for the Nanoleaf editor and Conversation.

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

// Semantic timing only; no renderer, clock, persistence or device dependency.

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

// Browser-safe show data. Compilation, storage and device rendering stay with the server owner.

export const SHOW_TARGET = 'shows';
export const SHOW_CATALOG_SCHEMA = 'https://bunny.invalid/events/nanoleaf-shows/2.1';
export const SHOW_VERSION_SCHEMA = 'nanoleaf-show-version/2.0';
export const SHOW_ID_PATTERN = '^show-[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SHOW_LIMITS = Object.freeze({shows: 32, versions: 256, versionBytes: 128 * 1024, name: 80, id: 64});
export type ShowVersion = Readonly<{
  schema: typeof SHOW_VERSION_SCHEMA; showId: string; version: number; name: string; versionName: string;
  timeline: MusicTimeline;
}> & ({kind: 'decorative'} | {kind: 'measured'; measurement: ShowMeasurement});
export type ShowSummary = Readonly<{id: string; name: string; version: number; versions: readonly {version: number; versionName: string; kind?: 'measured'; savedByRequest?: string}[]}>;
export type ShowCatalog = Readonly<{id: typeof SHOW_TARGET; revision: number; shows: readonly ShowSummary[]}>;
export type ShowSave = Readonly<{showId: string; expectedVersion: number; name: string; versionName: string; timeline: MusicTimeline; measurement?: ShowMeasurement; measurementProof?: string}>;

export const validShowId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= SHOW_LIMITS.id && new RegExp(SHOW_ID_PATTERN).test(value);

export type MeasuredItem = Readonly<{libraryScopeId: string; itemId: string}>;

export type ShowMeasurement = Readonly<{
  item: MeasuredItem; analysis: {method: 'energy-onset-v1'; sampleCount: number};
}>;

const object = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input);

export function showMeasurement(input: unknown): ShowMeasurement | undefined {
  if (!object(input) || Object.keys(input).length !== 2) return undefined;
  const {item, analysis} = input;
  if (!object(item) || Object.keys(item).length !== 2 || !object(analysis) || Object.keys(analysis).length !== 2
      || typeof item.libraryScopeId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.libraryScopeId)
      || item.libraryScopeId.length > 128 || typeof item.itemId !== 'string' || !/^[0-9a-fA-F]{1,128}$/.test(item.itemId)
      || analysis.method !== 'energy-onset-v1' || typeof analysis.sampleCount !== 'number'
      || !Number.isSafeInteger(analysis.sampleCount) || analysis.sampleCount < 1 || analysis.sampleCount > 18000) return undefined;
  return {item: {libraryScopeId: item.libraryScopeId, itemId: item.itemId}, analysis: {method: analysis.method, sampleCount: analysis.sampleCount}};
}

export const PATTERN_CHOICES = ['wave', 'gradient', 'pulse', 'breathe', 'sparkle'] as const satisfies readonly Pattern[];
export const SPEED_CHOICES = ['slow', 'medium', 'fast', 'faster'] as const satisfies readonly Speed[];
export const DIRECTION_CHOICES = ['left', 'right', 'up', 'down', 'outward', 'inward', 'clockwise', 'counterclockwise'] as const satisfies readonly Direction[];
export const spatial = (pattern: Pattern): boolean => pattern === 'wave' || pattern === 'gradient';
const exact = (value: object, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const name = (value: unknown): value is string => typeof value === 'string' && [...value].length >= 1 && [...value].length <= SHOW_LIMITS.name && value.trim() !== '' && !/\p{C}/u.test(value);

/** Content is unknown at the browser boundary. Return only the exact requested canonical version. */
export function showVersion(value: unknown, id: string, version: number): ShowVersion {
  if (!object(value) || (value.kind !== 'decorative' && value.kind !== 'measured')
      || !exact(value, ['schema', 'showId', 'version', 'name', 'versionName', 'kind', 'timeline', ...(value.kind === 'measured' ? ['measurement'] : [])])
      || value.schema !== SHOW_VERSION_SCHEMA || value.showId !== id || !validShowId(id) || value.version !== version
      || !integer(version, 1, SHOW_LIMITS.versions) || !name(value.name) || !name(value.versionName)) throw new Error('Invalid show version.');
  const base = {schema: SHOW_VERSION_SCHEMA, showId: id, version, name: value.name, versionName: value.versionName, timeline: timeline(value.timeline)} satisfies Omit<ShowVersion, 'kind'>;
  if (value.kind === 'decorative') return {...base, kind: 'decorative'};
  const measurement = showMeasurement(value.measurement);
  if (measurement === undefined) throw new Error('Invalid show measurement.');
  return {...base, kind: 'measured', measurement};
}

export function measuredDraft(value: unknown, showId: string): ShowSave {
  if (!object(value) || !exact(value, ['item', 'analysis', 'timeline', 'measurementProof']) || !validShowId(showId)
      || typeof value.measurementProof !== 'string' || !/^[0-9a-f]{64}$/.test(value.measurementProof)) throw new Error('Invalid measured draft.');
  const measurement = showMeasurement({item: value.item, analysis: value.analysis});
  if (measurement === undefined) throw new Error('Invalid show measurement.');
  return {showId, expectedVersion: 0, name: 'Measured excerpt', versionName: 'First draft', timeline: timeline(value.timeline), measurement, measurementProof: value.measurementProof};
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
