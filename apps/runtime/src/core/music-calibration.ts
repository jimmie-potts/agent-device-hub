import {CAPTURE_CLOCK_DRIFT_MS, CAPTURE_MAX_CLOCK_SKEW_MS, CAPTURE_VALIDITY_MS, CAPTURE_WINDOW_MS, type CaptureCalibrationEvidence, type CaptureCalibrationReason,
  type CaptureFeatures, type CaptureResponseBinding, type CaptureResponseState} from '@jimmie-potts/event-contracts/v2/music-capture-data';

export const calibrationDurationMs = 10_000;
const wallElapsedToleranceMs = 2 * CAPTURE_CLOCK_DRIFT_MS + 1;
const receiptElapsedToleranceMs = CAPTURE_VALIDITY_MS + CAPTURE_MAX_CLOCK_SKEW_MS + 2 * CAPTURE_CLOCK_DRIFT_MS + wallElapsedToleranceMs;

/** Response qualification only; callers have already validated each frame's source, format and freshness. */
export class ResponseClock {
  readonly #sourceEnd: number;
  readonly #observedAt: number;
  readonly #receivedMono: number;
  #lastReceiptMono: number;
  #valid = true;
  constructor(frame: CaptureFeatures, mono: number) {
    this.#sourceEnd = frame.endMonotonicMs;this.#observedAt = frame.observedAtMs;this.#receivedMono = mono;this.#lastReceiptMono = mono;
  }
  accept(frame: CaptureFeatures, mono: number): boolean {
    const sourceElapsed = frame.endMonotonicMs - this.#sourceEnd;
    this.#valid &&= Number.isFinite(mono) && mono >= this.#lastReceiptMono &&
      Math.abs(frame.observedAtMs - this.#observedAt - sourceElapsed) <= wallElapsedToleranceMs &&
      Math.abs(mono - this.#receivedMono - sourceElapsed) <= receiptElapsedToleranceMs;
    this.#lastReceiptMono = mono;return this.#valid;
  }
}
export function responseDefaults(): CaptureResponseState {
  return {settingsRevision: 0, settings: {sensitivity: 1, smoothingMs: 100, emphasis: {bass: 1, mid: 1, treble: 1}, gate: {mode: 'off'}},
    appliedTo: null, calibration: {status: 'idle'}, evidence: null};
}
export const sameResponseBinding = (a: CaptureResponseBinding | null, b: CaptureResponseBinding): boolean => a !== null &&
  a.endpointId === b.endpointId && a.generation === b.generation && a.microphoneId === b.microphoneId && a.sampleRateHz === b.sampleRateHz && a.channels === b.channels;
export function retireResponse(response: CaptureResponseState, reason: CaptureCalibrationReason): CaptureResponseState {
  const attempt = response.calibration;
  return {...response, appliedTo: null, calibration: attempt.status === 'measuring' || attempt.status === 'ready'
    ? {status: 'ended', operationId: attempt.operationId, reason} : attempt};
}
export type CalibrationResult = {status: 'pending' | 'ignored'} | {status: 'failed'; reason: CaptureCalibrationReason} |
  {status: 'complete'; evidence: CaptureCalibrationEvidence; timing: ResponseClock};

/** One deliberate measurement. Only core-validated fresh features enter; samples never survive restart. */
export class QuietCalibration {
  readonly #id: string;
  readonly #binding: CaptureResponseBinding;
  readonly #admittedWall: number;
  readonly #deadlineMono: number;
  readonly #levels: number[] = [];
  #previous: CaptureFeatures | undefined;
  #timing: ResponseClock | undefined;
  #lastReceiptMono: number;
  #startedAt = 0;
  #finished = false;
  constructor(id: string, binding: CaptureResponseBinding, clock: {wall: number; mono: number}) {
    this.#id = id; this.#binding = {...binding}; this.#admittedWall = clock.wall; this.#deadlineMono = clock.mono + calibrationDurationMs;this.#lastReceiptMono = clock.mono;
  }
  expired(mono: number): boolean {return !Number.isFinite(mono) || mono >= this.#deadlineMono;}
  accept(frame: CaptureFeatures, mono: number): CalibrationResult {
    if (this.#finished) return {status: 'ignored'};
    const fail = (reason: CaptureCalibrationReason): CalibrationResult => {this.#finished = true;return {status: 'failed', reason};};
    if (this.expired(mono)) return fail('deadline');
    if (mono < this.#lastReceiptMono) return fail('clock');
    this.#lastReceiptMono = mono;
    if (frame.observedAtMs - CAPTURE_WINDOW_MS - CAPTURE_MAX_CLOCK_SKEW_MS < this.#admittedWall) return {status: 'ignored'};
    if (frame.input !== 'microphone' || frame.generation !== this.#binding.generation || frame.microphoneId !== this.#binding.microphoneId) return fail('source-lost');
    if (frame.sampleRateHz !== this.#binding.sampleRateHz || frame.channels !== this.#binding.channels) return fail('format');
    const previous = this.#previous;
    if (previous !== undefined && frame.sequence <= previous.sequence) return {status: 'ignored'};
    if (frame.discontinuity || (previous !== undefined && (frame.sequence !== previous.sequence + 1 || Math.abs(frame.startMonotonicMs - previous.endMonotonicMs) > 0.01))) return fail('discontinuity');
    if (frame.clippedFraction > 0) return fail('clipping');
    const timing = this.#timing ??= new ResponseClock(frame, mono);
    if (!timing.accept(frame, mono)) return fail('clock');
    if (previous === undefined) this.#startedAt = frame.observedAtMs - CAPTURE_WINDOW_MS;
    this.#previous = frame; this.#levels.push(frame.rms);
    if (this.#levels.length < 50) return {status: 'pending'};
    this.#finished = true;
    const sorted = [...this.#levels].sort((a, b) => a - b);
    const percentileRms = sorted[47], maximumRms = sorted[49];
    if (percentileRms === undefined || maximumRms === undefined) throw new Error('calibration-window-count');
    return {status: 'complete', timing, evidence: {id: this.#id, binding: {...this.#binding}, windowCount: 50,
      startedAtMs: this.#startedAt, endedAtMs: frame.observedAtMs, sourceDurationMs: 5000, percentileRms, maximumRms,
      suggestedThreshold: Math.min(16, 2 * percentileRms)}};
  }
}
