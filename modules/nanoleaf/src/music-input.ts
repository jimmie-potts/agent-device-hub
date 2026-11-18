import {MessageValidator, SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {CAPTURE_CLOCK_DRIFT_MS, CAPTURE_MAX_CLOCK_SKEW_MS, CAPTURE_VALIDITY_MS, MUSIC_PRODUCER_SOURCE,
  registerMusicCaptureFamilies, type CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';

export type MusicBinding = Readonly<{endpointId: string; generation: string}>;
/** Samples from one receiver clock; source monotonic timestamps have a different origin. */
export type MusicClock = Readonly<{wallMs: number; monotonicMs: number}>;
export type MusicFeature = Readonly<Omit<CaptureFeatures, 'bands' | 'onset'>> & {
  readonly bands: Readonly<CaptureFeatures['bands']>; readonly onset: Readonly<CaptureFeatures['onset']>;
};
export type MusicSample = Readonly<{endpointId: string; feature: MusicFeature; elapsedMs: number}>;
export type MusicInputLossReason = 'sample-expired' | 'incoming-expired' | 'receiver-clock-invalid'
  | 'source-clock-reversed' | 'binding-replaced' | 'subscription-overflow' | 'retired';
export type MusicInputLoss = Readonly<{reason: MusicInputLossReason; sequence?: number; acceptedIdleMs?: number}>;
export type MusicAdmission = 'accepted' | 'duplicate' | 'wrong-binding' | 'invalid' | 'stale' | 'discontinuity' | 'retired';

let shared: MessageValidator | undefined;
// Compiled on first use, not at import (Hub #1686).
function validator(): MessageValidator {
  if (shared === undefined) {
    const created = new MessageValidator();
    registerMusicCaptureFamilies(created);
    shared = created;
  }
  return shared;
}
const FEATURES_SCHEMA = `${SCHEMA_BASE}music-capture-features/2.0`;
const clockValid = (clock: MusicClock): boolean => Number.isFinite(clock.wallMs) && clock.wallMs >= 0
  && Number.isFinite(clock.monotonicMs) && clock.monotonicMs >= 0;

/** Only a future authority owner can establish/re-establish this binding; this helper grants no device permission. */
export function musicBinding(binding: MusicBinding): MusicBinding {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(binding.endpointId) || binding.endpointId.length > 128
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(binding.generation)) {
    throw new TypeError('Invalid music binding.');
  }
  return Object.freeze({...binding});
}

/** One replaceable, immutable feature; retirement is permanent and never resumes on an incoming frame. */
export class MusicInput {
  readonly #binding: MusicBinding;
  readonly #anchor: MusicClock;
  #lastClock: number;
  #latest: MusicSample | null = null;
  #deadline = 0;
  #origin: number | null = null;
  #loss: MusicInputLoss | undefined;
  #lastAcceptedAt: number | undefined;

  constructor(binding: MusicBinding, anchor: MusicClock) {
    this.#binding = musicBinding(binding);
    if (!clockValid(anchor)) throw new TypeError('Invalid music clock.');
    this.#anchor = {...anchor};
    this.#lastClock = anchor.monotonicMs;
  }

  get loss(): MusicInputLoss | undefined {return this.#loss;}

  lossAt(clock: MusicClock): MusicInputLoss | undefined {
    if (this.#loss === undefined || this.#lastAcceptedAt === undefined) return this.#loss;
    const idle = clock.monotonicMs - this.#lastAcceptedAt;
    return Number.isFinite(idle) && idle >= 0 ? {...this.#loss, acceptedIdleMs: Math.min(86_400_000, Math.floor(idle))} : this.#loss;
  }

  retire(reason: MusicInputLossReason = 'retired'): void {
    if (this.#loss !== undefined) return;
    const sequence = this.#latest?.feature.sequence;
    this.#loss = Object.freeze({reason, ...(sequence === undefined ? {} : {sequence})});
    this.#latest = null;
  }

  #checkClock(clock: MusicClock): boolean {
    if (this.#loss !== undefined) return false;
    if (!clockValid(clock) || clock.monotonicMs < this.#lastClock
        || Math.abs((clock.wallMs - this.#anchor.wallMs) - (clock.monotonicMs - this.#anchor.monotonicMs)) > CAPTURE_CLOCK_DRIFT_MS) {
      this.retire('receiver-clock-invalid');
      return false;
    }
    this.#lastClock = clock.monotonicMs;
    return true;
  }

  /** Read immediately before using a sample; a later physical writer must recheck after any await. */
  current(clock: MusicClock): MusicSample | null {
    if (!this.#checkClock(clock)) return null;
    if (this.#latest !== null && (clock.wallMs >= this.#latest.feature.validUntilMs || clock.monotonicMs >= this.#deadline)) this.retire('sample-expired');
    return this.#latest;
  }

  accept(input: unknown, clock: MusicClock): MusicAdmission {
    this.current(clock);
    if (this.#loss !== undefined) return 'retired';
    const checked = validator().validate<CaptureFeatures>(input);
    if (!checked.ok || checked.value.dataschema !== FEATURES_SCHEMA) return 'invalid';
    const message = checked.value;
    const frame = message.data;
    if (message.source !== MUSIC_PRODUCER_SOURCE || message.subject !== this.#binding.endpointId
        || frame.generation !== this.#binding.generation) return 'wrong-binding';
    const previous = this.#latest?.feature;
    if (previous !== undefined && frame.sequence <= previous.sequence) return 'duplicate';
    // A discontinuity marker after a missed window still moves forward in source time, so it is the latest feature (#1588).
    // Source time that runs backwards cannot be ordered, and retires the input.
    if (previous !== undefined && (frame.startMonotonicMs < previous.endMonotonicMs - 0.01
        || frame.emittedMonotonicMs < previous.emittedMonotonicMs)) {
      this.retire('source-clock-reversed');
      return 'discontinuity';
    }
    if (frame.observedAtMs > clock.wallMs + CAPTURE_MAX_CLOCK_SKEW_MS) return 'invalid';
    if (clock.wallMs >= frame.validUntilMs) {this.retire('incoming-expired'); return 'stale';}
    const origin = this.#origin ?? frame.endMonotonicMs;
    this.#origin = origin;
    const feature: MusicFeature = Object.freeze({...frame, bands: Object.freeze({...frame.bands}), onset: Object.freeze({...frame.onset})});
    this.#latest = Object.freeze({endpointId: message.subject, feature, elapsedMs: frame.endMonotonicMs - origin});
    this.#lastAcceptedAt = clock.monotonicMs;
    this.#deadline = clock.monotonicMs + Math.min(CAPTURE_VALIDITY_MS, frame.validUntilMs - clock.wallMs);
    return 'accepted';
  }
}
