import {CAPTURE_CLOCK_DRIFT_MS, CAPTURE_MAX_SOURCE_AGE_MS, CAPTURE_REGISTRATION_SKEW_MS, CAPTURE_VALIDITY_MS} from '@jimmie-potts/event-contracts/v2/music-capture';

export type ClockReading = {wallMs: number; monotonicMs: number};
const finiteTime = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const readingValid = (value: ClockReading): boolean => Number.isSafeInteger(value.wallMs) && finiteTime(value.wallMs) && finiteTime(value.monotonicMs);

/** One capture's paired host clocks. A discontinuity requires a new explicitly started capture. */
export class CaptureClock {
  readonly #initial: ClockReading;
  #lastMonotonicMs: number;
  #valid: boolean;
  constructor(initial: ClockReading) {
    this.#initial = {...initial};
    this.#lastMonotonicMs = initial.monotonicMs;
    this.#valid = readingValid(initial);
  }
  get valid(): boolean {return this.#valid;}
  timestamps(endMs: number, now: ClockReading): {observedAtMs: number; validUntilMs: number} | undefined {
    if (!this.#valid) return undefined;
    const wallElapsed = now.wallMs - this.#initial.wallMs;
    const monotonicElapsed = now.monotonicMs - this.#initial.monotonicMs;
    if (!readingValid(now) || now.monotonicMs < this.#lastMonotonicMs || Math.abs(wallElapsed - monotonicElapsed) > CAPTURE_CLOCK_DRIFT_MS) {
      this.#valid = false;
      return undefined;
    }
    this.#lastMonotonicMs = now.monotonicMs;
    const age = now.monotonicMs - endMs;
    if (!finiteTime(endMs) || age < 0 || age > CAPTURE_MAX_SOURCE_AGE_MS) return undefined;
    const observedAtMs = Math.floor(now.wallMs - age);
    const validUntilMs = observedAtMs + CAPTURE_VALIDITY_MS;
    if (!finiteTime(observedAtMs) || !Number.isSafeInteger(validUntilMs)) return undefined;
    return {observedAtMs, validUntilMs};
  }
}

/** The harmless native clock reading must fall inside the actual parent request interval. */
export function nativeClockQualified({beforeMs, nativeMs, afterMs}: {beforeMs: number; nativeMs: number; afterMs: number}): boolean {
  return [beforeMs, nativeMs, afterMs].every(finiteTime) && beforeMs <= nativeMs && nativeMs <= afterMs;
}

/** The core reply was created after send and before receipt, bounding every possible clock offset. */
export function coreClockQualified({sent, received, replyAtMs}: {sent: ClockReading; received: ClockReading; replyAtMs: number}): boolean {
  if (!readingValid(sent) || !readingValid(received) || !Number.isSafeInteger(replyAtMs) || !finiteTime(replyAtMs)) return false;
  const elapsed = received.monotonicMs - sent.monotonicMs;
  const wallElapsed = received.wallMs - sent.wallMs;
  return elapsed >= 0 && wallElapsed >= 0 && Math.abs(wallElapsed - elapsed) <= CAPTURE_CLOCK_DRIFT_MS &&
    replyAtMs - received.wallMs >= -CAPTURE_REGISTRATION_SKEW_MS && replyAtMs - sent.wallMs <= CAPTURE_REGISTRATION_SKEW_MS;
}
