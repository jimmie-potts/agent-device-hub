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
export type MusicAdmission = 'accepted' | 'duplicate' | 'wrong-binding' | 'invalid' | 'stale' | 'discontinuity' | 'retired';

const validator = new MessageValidator();
registerMusicCaptureFamilies(validator);
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
  #retired = false;

  constructor(binding: MusicBinding, anchor: MusicClock) {
    this.#binding = musicBinding(binding);
    if (!clockValid(anchor)) throw new TypeError('Invalid music clock.');
    this.#anchor = {...anchor};
    this.#lastClock = anchor.monotonicMs;
  }

  retire(): void {this.#retired = true; this.#latest = null;}

  #checkClock(clock: MusicClock): boolean {
    if (this.#retired) return false;
    if (!clockValid(clock) || clock.monotonicMs < this.#lastClock
        || Math.abs((clock.wallMs - this.#anchor.wallMs) - (clock.monotonicMs - this.#anchor.monotonicMs)) > CAPTURE_CLOCK_DRIFT_MS) {
      this.retire();
      return false;
    }
    this.#lastClock = clock.monotonicMs;
    return true;
  }

  /** Read immediately before using a sample; a later physical writer must recheck after any await. */
  current(clock: MusicClock): MusicSample | null {
    if (!this.#checkClock(clock)) return null;
    if (this.#latest !== null && (clock.wallMs >= this.#latest.feature.validUntilMs || clock.monotonicMs >= this.#deadline)) this.retire();
    return this.#latest;
  }

  accept(input: unknown, clock: MusicClock): MusicAdmission {
    this.current(clock);
    if (this.#retired) return 'retired';
    const checked = validator.validate<CaptureFeatures>(input);
    if (!checked.ok || checked.value.dataschema !== FEATURES_SCHEMA) return 'invalid';
    const message = checked.value;
    const frame = message.data;
    if (message.source !== MUSIC_PRODUCER_SOURCE || message.subject !== this.#binding.endpointId
        || frame.generation !== this.#binding.generation) return 'wrong-binding';
    const previous = this.#latest?.feature;
    if (previous !== undefined && frame.sequence <= previous.sequence) return 'duplicate';
    if (previous !== undefined && (frame.discontinuity
        || frame.startMonotonicMs < previous.endMonotonicMs - 0.01 || frame.emittedMonotonicMs < previous.emittedMonotonicMs)) {
      this.retire();
      return 'discontinuity';
    }
    if (frame.observedAtMs > clock.wallMs + CAPTURE_MAX_CLOCK_SKEW_MS) return 'invalid';
    if (clock.wallMs >= frame.validUntilMs) {this.retire(); return 'stale';}
    const origin = this.#origin ?? frame.endMonotonicMs;
    this.#origin = origin;
    const feature: MusicFeature = Object.freeze({...frame, bands: Object.freeze({...frame.bands}), onset: Object.freeze({...frame.onset})});
    this.#latest = Object.freeze({endpointId: message.subject, feature, elapsedMs: frame.endMonotonicMs - origin});
    this.#deadline = clock.monotonicMs + Math.min(CAPTURE_VALIDITY_MS, frame.validUntilMs - clock.wallMs);
    return 'accepted';
  }
}
