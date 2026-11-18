import type {LightingShow} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {LayoutEntry} from './devices.js';
import type {Rgb, Zone} from './effects.js';
import {locateMusicCuePhase, MusicTimelineCursor, prepareMusicCueFrames, type CueZonePhase, type MusicCue,
  type MusicTimeline, type PreparedMusicCue, type TimelineSample} from './music-timeline.js';

export type ShowTransport = {action: 'pause-show' | 'resume-show'} | {action: 'seek-show'; positionMs: number};

type TimedSample = Extract<TimelineSample, {positionMs: number}>;
type PreparedStatus = 'waiting' | 'playing' | 'paused' | 'completed' | 'source-lost';

/** Samples the prepared canonical color for each zone. Transport still applies its ordinary short transition. */
function colorAt(phase: CueZonePhase): Rgb {
  if (phase.kind === 'finished') return phase.endpoint;
  if (phase.origin.kind === 'unknown') return phase.target;
  const ratio = phase.elapsedMs / (phase.elapsedMs + phase.remainingMs);
  const [red, green, blue] = phase.origin.color;
  const blend = (a: number, b: number): number => Math.round(a + (b - a) * ratio);
  return [blend(red, phase.target[0]), blend(green, phase.target[1]), blend(blue, phase.target[2])];
}

/** Owns only cursor and sample evidence. The light's Music worker owns all writes and arbitration. */
export class PreparedMusic {
  readonly #cursor: MusicTimelineCursor;
  readonly #missed = new Set<string>();
  #nextUnsettled: number;
  #scheduled = new Set<string>();
  #sample: TimedSample | undefined;
  #lastClock: number;
  #cached: {cue: MusicCue; frames: PreparedMusicCue} | undefined;

  constructor(private readonly show: LightingShow, private readonly timeline: MusicTimeline, private readonly layout: LayoutEntry,
    acceptedAtMs: number, private readonly targetMs: number) {
    this.#cursor = new MusicTimelineCursor(timeline);
    this.#lastClock = acceptedAtMs;
    this.#nextUnsettled = this.#firstUnelapsed(show.positionMs);
  }

  get evidence(): LightingShow {
    return {...this.show, positionMs: Math.floor(this.#sample?.positionMs ?? this.show.positionMs), missedCues: this.#missed.size};
  }

  readClock(now: number): boolean {
    if (!Number.isFinite(now) || now < this.#lastClock || now > Number.MAX_SAFE_INTEGER) return false;
    this.#lastClock = now;
    return true;
  }

  advance(now: number): PreparedStatus {
    if (!this.readClock(now)) return 'source-lost';
    if (now < this.targetMs) return 'waiting';
    const sample = this.#sample === undefined
      ? this.#cursor.startAt({positionMs: this.show.positionMs, monotonicMs: this.targetMs})
      : undefined;
    if (sample?.kind === 'stopped') return 'source-lost';
    return this.#track(this.#cursor.sample({generation: this.#cursor.generation, monotonicMs: now}));
  }

  transport(control: ShowTransport, now: number): boolean {
    const status = this.advance(now);
    const input = {generation: this.#cursor.generation, monotonicMs: now};
    if (status !== 'playing' && status !== 'paused') return false;
    if (control.action === 'pause-show') {
      if (status !== 'playing') return false;
      this.#track(this.#cursor.pause(input));
    } else if (control.action === 'resume-show') {
      if (status !== 'paused') return false;
      this.#track(this.#cursor.resume(input));
    } else if (control.action === 'seek-show') {
      if (control.positionMs >= this.timeline.durationMs) return false;
      this.#nextUnsettled = this.#firstUnelapsed(control.positionMs);
      this.#scheduled.clear();
      this.#track(this.#cursor.seek({...input, positionMs: control.positionMs}));
    }
    return true;
  }

  frame(): readonly Zone[] | null {
    const sample = this.#sample;
    if (sample?.kind !== 'playing' || sample.selection.kind !== 'cue') return null;
    const {cue, elapsedMs} = sample.selection;
    if (this.#cached?.cue !== cue) this.#cached = {cue, frames: prepareMusicCueFrames(cue, this.layout)};
    const selection = locateMusicCuePhase(this.#cached.frames, elapsedMs);
    if (selection.kind !== 'active') return null;
    this.#scheduled.add(cue.id);
    return selection.zones.map(({zone, phase}) => {
      const [red, green, blue] = colorAt(phase);
      return [zone, [[red, green, blue, 1]]];
    });
  }

  #firstUnelapsed(positionMs: number): number {
    const index = this.timeline.cues.findIndex(cue => cue.offsetMs + cue.durationMs > positionMs);
    return index < 0 ? this.timeline.cues.length : index;
  }

  #track(sample: TimelineSample | null): PreparedStatus {
    if (sample === null || !('positionMs' in sample)) return 'source-lost';
    this.#sample = sample;
    let cue = this.timeline.cues[this.#nextUnsettled];
    while (cue !== undefined && cue.offsetMs + cue.durationMs <= sample.positionMs) {
      if (!this.#scheduled.delete(cue.id)) this.#missed.add(cue.id);
      cue = this.timeline.cues[++this.#nextUnsettled];
    }
    if (sample.kind === 'ended' || sample.selection.kind === 'gap') this.#cached = undefined;
    return sample.kind === 'ended' ? 'completed' : sample.kind;
  }
}
