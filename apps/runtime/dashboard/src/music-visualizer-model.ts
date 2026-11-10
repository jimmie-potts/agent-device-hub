/**
 * The music visualizer's pure model (#1619). It reads only the derived capture features that the Audio page already
 * projects (ADR 0012's existing capture feed) and turns them into scenes an effect draws. It sends no command, starts no
 * capture and controls no lights. Rendering is deterministic for a given feature stream and display clock.
 */
import {CAPTURE_WINDOW_MS} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {MusicCaptureView} from './music-capture-feed.ts';

/** Shared response values in 0..1: the overall level and the bass, mid and treble bands. */
export type VisualizerLevels = Readonly<{level: number; bass: number; mid: number; treble: number}>;
export type VisualizerSignal = Readonly<{kind: 'live'; key: string; sequence: number; levels: VisualizerLevels}> | Readonly<{kind: 'resting'; reason: string}>;
export type Size = Readonly<{width: number; height: number}>;
/** A drawing primitive. `role` names its purpose so tests and later effects can find it. */
export type Shape =
  | Readonly<{kind: 'rect'; role: string; x: number; y: number; width: number; height: number; fill: string; alpha: number}>
  | Readonly<{kind: 'circle'; role: string; x: number; y: number; radius: number; fill: string; alpha: number}>
  | Readonly<{kind: 'ring'; role: string; x: number; y: number; radius: number; lineWidth: number; stroke: string; alpha: number}>;
/** One running effect: it advances by display time and describes what to draw. */
export type EffectInstance = {step(levels: VisualizerLevels, elapsedMs: number): void; scene(size: Size): Shape[]};
/** An effect is a self-contained entry; adding one changes neither the engine nor the other effects. */
export type VisualizerEffect = Readonly<{id: string; name: string; create(): EffectInstance; resting(size: Size): Shape[]}>;
export type VisualizerFrame = Readonly<{state: 'live'; sequence: number; levels: VisualizerLevels; scene: Shape[]} | {state: 'resting'; reason: string; scene: Shape[]}>;

const unit = (value: number): number => Math.max(0, Math.min(1, value));
const sourceKey = (view: MusicCaptureView): string => {
  const session = view.state?.session;
  return session === undefined || session.status === 'idle' ? '' :
    `${view.state?.endpointId ?? ''}/${session.generation}/${session.input}/${session.input === 'microphone' ? session.microphoneId : ''}`;
};

/** Why the visualizer rests, or undefined while fresh measurements are present. */
export function restingReason(view: MusicCaptureView, live: boolean): string | undefined {
  const state = view.state;
  if (!live || !view.synced || state === undefined) return 'Measurement status is unavailable.';
  if (state.availability === 'off') return 'Music producer is off.';
  if (state.availability === 'unavailable') return 'Music input is unavailable.';
  switch (state.session.status) {
    case 'idle': return 'Measurement is not running.';
    case 'starting': return 'Measurement is starting.';
    case 'stale': return 'Measurements are stale.';
    case 'stopping': return 'Measurement is stopping.';
    case 'uncertain': return 'Measurement state is uncertain.';
    case 'unavailable': return 'Measurement is unavailable.';
    case 'active': return view.features !== undefined ? undefined : view.clockQualified ? 'Waiting for fresh measurements.' : 'Measurement timing is unavailable.';
  }
}

/** The applied response values when the projection has them; otherwise the measured features, clamped to 0..1. */
export function visualizerSignal(view: MusicCaptureView, live: boolean): VisualizerSignal {
  const reason = restingReason(view, live), features = view.features;
  if (reason !== undefined || features === undefined) return {kind: 'resting', reason: reason ?? 'Measurement status is unavailable.'};
  const response = view.response;
  const levels = response !== undefined ? {level: response.level, bass: response.bass, mid: response.mid, treble: response.treble}
    : {level: unit(features.rms), bass: unit(features.bands.bass), mid: unit(features.bands.mid), treble: unit(features.bands.treble)};
  return {kind: 'live', key: sourceKey(view), sequence: features.sequence, levels};
}

const mix = (from: number, to: number, t: number): number => t >= 1 ? to : from + (to - from) * t;
const mixLevels = (from: VisualizerLevels, to: VisualizerLevels, t: number): VisualizerLevels =>
  ({level: mix(from.level, to.level, t), bass: mix(from.bass, to.bass, t), mid: mix(from.mid, to.mid, t), treble: mix(from.treble, to.treble, t)});

/**
 * Eases from what is shown toward the newest feature window over one window interval, then holds it. Skipped windows
 * are never replayed, and a new source identity or a rest starts fresh.
 */
export class FeatureInterpolator {
  #segment: {key: string; sequence: number; from: VisualizerLevels; to: VisualizerLevels; startMs: number} | undefined;
  sample(signal: VisualizerSignal, nowMs: number): VisualizerLevels | undefined {
    if (signal.kind === 'resting') {this.#segment = undefined; return undefined;}
    const segment = this.#segment;
    if (segment?.key !== signal.key) {
      this.#segment = {key: signal.key, sequence: signal.sequence, from: signal.levels, to: signal.levels, startMs: nowMs};
      return signal.levels;
    }
    if (segment.sequence !== signal.sequence) {
      this.#segment = {key: signal.key, sequence: signal.sequence, from: this.#at(segment, nowMs), to: signal.levels, startMs: nowMs};
    }
    return this.#at(this.#segment ?? segment, nowMs);
  }
  #at(segment: {from: VisualizerLevels; to: VisualizerLevels; startMs: number}, nowMs: number): VisualizerLevels {
    return mixLevels(segment.from, segment.to, Math.max(0, (nowMs - segment.startMs) / CAPTURE_WINDOW_MS));
  }
}

/** Drives one effect from the signal at the display's frame times; resting shows the effect's static resting scene. */
export class VisualizerEngine {
  #effect: VisualizerEffect;
  #instance: EffectInstance | undefined;
  #key: string | undefined;
  #lastMs = 0;
  readonly #interpolator = new FeatureInterpolator();
  constructor(effect: VisualizerEffect) {this.#effect = effect;}
  get effect(): VisualizerEffect {return this.#effect;}
  /** A different effect starts from its own first frame; the shared interpolation continues. */
  use(effect: VisualizerEffect): void {
    if (effect.id === this.#effect.id) return;
    this.#effect = effect; this.#instance = undefined;
  }
  frame(signal: VisualizerSignal, nowMs: number, size: Size): VisualizerFrame {
    const levels = this.#interpolator.sample(signal, nowMs);
    if (signal.kind === 'resting' || levels === undefined) {
      this.#instance = undefined; this.#key = undefined;
      return {state: 'resting', reason: signal.kind === 'resting' ? signal.reason : 'Measurement status is unavailable.', scene: this.#effect.resting(size)};
    }
    if (this.#instance === undefined || this.#key !== signal.key) {this.#instance = this.#effect.create(); this.#key = signal.key; this.#lastMs = nowMs;}
    const elapsed = Math.max(0, nowMs - this.#lastMs); this.#lastMs = nowMs;
    this.#instance.step(levels, elapsed);
    return {state: 'live', sequence: signal.sequence, levels, scene: this.#instance.scene(size)};
  }
}
