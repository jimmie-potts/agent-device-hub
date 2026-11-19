import {CAPTURE_WINDOW_MS} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {MusicBinding, MusicSample} from './music-input.js';
import type {MeasuredItem} from './music-show-data.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, MIN_MUSIC_CUE_MS, prepareMusicTimeline, type MusicTimeline} from './music-timeline.js';

const MAX_CUE_SPAN_MS = 2000;
const POSITION_JITTER_MS = 20;

type CueWindow = {
  offsetMs: number;
  endMs: number;
  samples: number;
  energy: number;
  onset: number;
};

type MeasuredPlan = Readonly<{
  item: MeasuredItem;
  analysis: Readonly<{method: 'energy-onset-v1'; sampleCount: number}>;
  timeline: MusicTimeline;
}>;

/** Fold qualified Music features into bounded cue summaries. The caller owns freshness and transport continuity. */
export class MusicShowAnalysis {
  readonly #item: MeasuredItem;
  readonly #capture: MusicBinding;
  readonly #windows: CueWindow[] = [];
  #lastSequence = 0;
  #lastSourceEndMs = -1;
  #sampleCount = 0;

  constructor(item: MeasuredItem, capture: MusicBinding) {
    this.#item = Object.freeze({...item});
    this.#capture = Object.freeze({...capture});
  }

  /** positionMs is the scoped playback position at the end of the feature window. */
  add(sample: MusicSample, positionMs: number): void {
    const {feature} = sample;
    if (sample.endpointId !== this.#capture.endpointId || feature.generation !== this.#capture.generation
        || feature.input !== 'music' || feature.discontinuity || feature.sequence <= this.#lastSequence
        || !Number.isFinite(positionMs)) return;

    const previous = this.#windows.at(-1);
    const projectedEndMs = Math.floor(positionMs);
    const adjacent = feature.sequence === this.#lastSequence + 1
      && Math.abs(feature.startMonotonicMs - this.#lastSourceEndMs) <= 0.01;
    const expectedEndMs = previous === undefined || !adjacent ? projectedEndMs : previous.endMs + CAPTURE_WINDOW_MS;
    // Anchor to contiguous source windows within the position tolerance, so projection jitter cannot shrink a cue below 100 ms.
    const endMs = Math.abs(projectedEndMs - expectedEndMs) <= POSITION_JITTER_MS ? expectedEndMs : projectedEndMs;
    if (endMs > MAX_MUSIC_DURATION_MS) return;
    const measuredStart = endMs - CAPTURE_WINDOW_MS;
    const offsetMs = Math.max(previous?.endMs ?? 0, measuredStart);
    if (endMs - offsetMs < MIN_MUSIC_CUE_MS) return;

    const energy = Math.min(1, feature.rms);
    const onset = feature.onset.strength * feature.onset.confidence;
    if (previous !== undefined && previous.endMs === offsetMs && adjacent
        && endMs - previous.offsetMs <= MAX_CUE_SPAN_MS) {
      previous.endMs = endMs;
      previous.samples++;
      previous.energy += energy;
      previous.onset = Math.max(previous.onset, onset);
    } else {
      if (this.#windows.length === MAX_MUSIC_CUES) return;
      this.#windows.push({offsetMs, endMs, samples: 1, energy, onset});
    }
    this.#lastSequence = feature.sequence;
    this.#lastSourceEndMs = feature.endMonotonicMs;
    this.#sampleCount++;
  }

  /** The result covers only admitted cue spans and may be an excerpt of the track. */
  result(): MeasuredPlan | undefined {
    const last = this.#windows.at(-1);
    if (last === undefined) return undefined;
    const cues = this.#windows.map((window, index) => ({
      id: `measured-${index + 1}`,
      offsetMs: window.offsetMs,
      durationMs: window.endMs - window.offsetMs,
      recipe: {pattern: 'pulse', colors: ['#4f85ff']},
      intensity: Math.min(1, window.energy / window.samples + window.onset * 0.25),
    }));
    return Object.freeze({
      item: this.#item,
      analysis: Object.freeze({method: 'energy-onset-v1', sampleCount: this.#sampleCount}),
      timeline: prepareMusicTimeline({version: 1, durationMs: last.endMs, cues}),
    });
  }
}
