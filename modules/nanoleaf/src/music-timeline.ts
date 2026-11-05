import {isObject} from './compat.js';
import {projection, validateElements, type LayoutEntry} from './devices.js';
import {freeze, render, rgb, scale, valid, type Display, type Recipe} from './effects.js';

export const MAX_MUSIC_CUES = 256;
export const MAX_MUSIC_DURATION_MS = 30 * 60 * 1000;
export const MIN_MUSIC_CUE_MS = 100;
type FrozenRecipe = Readonly<Omit<Recipe, 'colors'>> & {readonly colors: readonly string[]};
export type MusicCue = Readonly<{id: string; offsetMs: number; durationMs: number; recipe: FrozenRecipe; intensity: number}>;
export type MusicTimeline = Readonly<{version: 1; durationMs: number; cues: readonly MusicCue[]}>;
export type CueSelection = {kind: 'cue'; cue: MusicCue; elapsedMs: number} | {kind: 'gap'} | {kind: 'ended'};

const fields = (value: object, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

/** Frozen values only: callers resolve favorites through their owner before preparing a timeline. */
export function prepareMusicTimeline(input: unknown): MusicTimeline {
  if (!isObject(input) || !fields(input, ['version', 'durationMs', 'cues']) || input.version !== 1
      || !integer(input.durationMs, MIN_MUSIC_CUE_MS, MAX_MUSIC_DURATION_MS)
      || !Array.isArray(input.cues) || input.cues.length === 0 || input.cues.length > MAX_MUSIC_CUES) {
    throw new TypeError('Invalid music timeline.');
  }
  const ids = new Set<string>();
  const cues: MusicCue[] = [];
  let previousEnd = 0;
  for (const value of input.cues) {
    if (!isObject(value) || !fields(value, ['id', 'offsetMs', 'durationMs', 'recipe', 'intensity'])
        || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value.id) || ids.has(value.id)
        || !integer(value.offsetMs, previousEnd, input.durationMs)
        || !integer(value.durationMs, MIN_MUSIC_CUE_MS, input.durationMs - value.offsetMs)
        || !isObject(value.recipe) || Object.hasOwn(value.recipe, 'kind')) throw new TypeError('Invalid music cue.');
    const command = {kind: 'animation.play', ...value.recipe};
    if (!valid(command) || 'favorite' in command) throw new TypeError('Unsupported music cue recipe.');
    const intensity = value.intensity === undefined ? 1 : value.intensity;
    if (typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      throw new TypeError('Invalid music cue intensity.');
    }
    const {kind: _kind, ...recipeInput} = command;
    const recipe = freeze(recipeInput);
    cues.push(Object.freeze({id: value.id, offsetMs: value.offsetMs, durationMs: value.durationMs, intensity,
      recipe: Object.freeze({...recipe, colors: Object.freeze([...recipe.colors])})}));
    ids.add(value.id);
    previousEnd = value.offsetMs + value.durationMs;
  }
  return Object.freeze({version: 1, durationMs: input.durationMs, cues: Object.freeze(cues)});
}

function position(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid music position.');
}

/** Half-open semantic intervals; elapsed time is not a phase-accurate physical animation seek. */
export function selectMusicCue(timeline: MusicTimeline, positionMs: number): CueSelection {
  position(positionMs);
  if (positionMs >= timeline.durationMs) return {kind: 'ended'};
  const cue = timeline.cues.find(candidate => positionMs >= candidate.offsetMs && positionMs < candidate.offsetMs + candidate.durationMs);
  return cue === undefined ? {kind: 'gap'} : {kind: 'cue', cue, elapsedMs: positionMs - cue.offsetMs};
}

/** The ordinary animation from its beginning, with cue intensity; no queue, clock or device operation. */
export function renderMusicCue(cue: MusicCue, layout: LayoutEntry): Display {
  const saved = projection({kind: layout.kind, elements: validateElements(layout.kind, layout.elements)});
  const colors = cue.recipe.colors.map(color => '#' + scale(rgb(color), cue.intensity).map(channel => channel.toString(16).padStart(2, '0')).join(''));
  return render({kind: 'animation.play', ...cue.recipe, colors}, saved.line_groups, saved.line_positions ?? null, layout.kind);
}

type ClockInput = {generation: number; monotonicMs: number};
type CursorState = {kind: 'ready'} | {kind: 'ended'} | {kind: 'playing'; positionMs: number; monotonicMs: number}
  | {kind: 'paused'; positionMs: number} | {kind: 'stopped'; reason: 'explicit' | 'clock-discontinuity'};
export type TimelineSample = {kind: 'ready'; generation: number}
  | {kind: 'playing' | 'paused'; generation: number; positionMs: number; selection: Exclude<CueSelection, {kind: 'ended'}>;
      activate: boolean; missedCueIds: readonly string[]}
  | {kind: 'ended'; generation: number; positionMs: number; missedCueIds: readonly string[]}
  | {kind: 'stopped'; generation: number; reason: 'explicit' | 'clock-discontinuity'};

/** Internal callback fencing only. Constructing or advancing this cursor grants no device authority. */
export class MusicTimelineCursor {
  readonly #timeline: MusicTimeline;
  #state: CursorState = {kind: 'ready'};
  #generation = 0;
  #lastClock: number | null = null;
  #previousPosition = -1;
  #previousCue: string | null = null;

  constructor(timeline: unknown) {this.#timeline = prepareMusicTimeline(timeline);}
  get generation(): number {return this.#generation;}

  startAt(input: {positionMs: number; monotonicMs: number}): TimelineSample {
    if (this.#state.kind !== 'ready') throw new TypeError('Music cursor has already started.');
    this.#checkPosition(input.positionMs);
    this.#clock(input.monotonicMs);
    if (this.#state.kind !== 'ready') return this.#read(input.monotonicMs);
    this.#generation++;
    this.#state = {kind: 'playing', ...input};
    return this.#read(input.monotonicMs);
  }

  sample(input: ClockInput): TimelineSample | null {
    if (input.generation !== this.#generation) return null;
    this.#clock(input.monotonicMs);
    return this.#read(input.monotonicMs);
  }

  pause(input: ClockInput): TimelineSample | null {
    if (input.generation !== this.#generation) return null;
    this.#clock(input.monotonicMs);
    const current = this.#read(input.monotonicMs);
    if (current.kind !== 'playing') return current;
    this.#generation++;
    this.#state = {kind: 'paused', positionMs: current.positionMs};
    return {...current, kind: 'paused', generation: this.#generation, activate: false};
  }

  resume(input: ClockInput): TimelineSample | null {
    if (input.generation !== this.#generation) return null;
    this.#clock(input.monotonicMs);
    if (this.#state.kind !== 'paused') return this.#read(input.monotonicMs);
    this.#generation++;
    this.#state = {kind: 'playing', positionMs: this.#state.positionMs, monotonicMs: input.monotonicMs};
    this.#previousCue = null;
    return this.#read(input.monotonicMs);
  }

  seek(input: ClockInput & {positionMs: number}): TimelineSample | null {
    if (input.generation !== this.#generation) return null;
    this.#checkPosition(input.positionMs);
    this.#clock(input.monotonicMs);
    if (this.#state.kind !== 'playing' && this.#state.kind !== 'paused') return this.#read(input.monotonicMs);
    this.#generation++;
    this.#state = this.#state.kind === 'playing'
      ? {kind: 'playing', positionMs: input.positionMs, monotonicMs: input.monotonicMs}
      : {kind: 'paused', positionMs: input.positionMs};
    this.#previousPosition = input.positionMs;
    this.#previousCue = null;
    return this.#read(input.monotonicMs);
  }

  stop(input: {generation: number}): TimelineSample | null {
    if (input.generation !== this.#generation) return null;
    if (this.#state.kind !== 'stopped') this.#retire('explicit');
    return this.#read(this.#lastClock ?? 0);
  }

  #checkPosition(value: number): void {
    position(value);
    if (value > this.#timeline.durationMs) throw new TypeError('Music position exceeds the timeline.');
  }

  #clock(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid music clock.');
    if (this.#state.kind === 'stopped') return;
    if (this.#lastClock !== null && value < this.#lastClock) this.#retire('clock-discontinuity');
    else this.#lastClock = value;
  }

  #retire(reason: 'explicit' | 'clock-discontinuity'): void {
    this.#generation++;
    this.#state = {kind: 'stopped', reason};
    this.#previousCue = null;
  }

  #read(monotonicMs: number): TimelineSample {
    const state = this.#state;
    const generation = this.#generation;
    if (state.kind === 'ready') return {kind: 'ready', generation};
    if (state.kind === 'stopped') return {...state, generation};
    if (state.kind === 'ended') return {kind: 'ended', generation, positionMs: this.#timeline.durationMs, missedCueIds: []};
    const positionMs = Math.min(this.#timeline.durationMs, state.positionMs + (state.kind === 'playing' ? monotonicMs - state.monotonicMs : 0));
    const selection = selectMusicCue(this.#timeline, positionMs);
    const missedCueIds = this.#timeline.cues.filter(cue => cue.offsetMs > this.#previousPosition && cue.offsetMs + cue.durationMs <= positionMs).map(cue => cue.id);
    const cueId = selection.kind === 'cue' ? selection.cue.id : null;
    const activate = state.kind === 'playing' && cueId !== null && cueId !== this.#previousCue;
    this.#previousPosition = positionMs;
    this.#previousCue = cueId;
    if (selection.kind === 'ended') {
      this.#state = {kind: 'ended'};
      return {kind: 'ended', generation, positionMs, missedCueIds};
    }
    return {kind: state.kind, generation, positionMs, selection, activate, missedCueIds};
  }
}
