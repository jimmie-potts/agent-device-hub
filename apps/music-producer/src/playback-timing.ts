import {MUSIC_PLAYBACK_CLOCK_DRIFT_MS, MUSIC_PLAYBACK_CLOCK_SKEW_MS, type MusicPlaybackField, type MusicPlaybackInterval,
  type MusicPlaybackObservation} from '@jimmie-potts/event-contracts/v2/music-playback';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ClockReading} from './timing.js';
import type {NativePlaybackRead, PlaybackField, PlaybackInterval} from './playback-protocol.js';

const validReading = (reading: ClockReading): boolean => Number.isSafeInteger(reading.wallMs) && reading.wallMs >= 0 &&
  Number.isFinite(reading.monotonicMs) && reading.monotonicMs >= 0;

/** Keeps the registration mapping fixed; receiving another sample never renews its qualification. */
export class PlaybackClock {
  readonly #initial: ClockReading;
  #last: number;
  #valid: boolean;
  constructor(initial: ClockReading) {this.#initial = {...initial}; this.#last = initial.monotonicMs; this.#valid = validReading(initial);}
  check(now: ClockReading): boolean {
    if (!this.#valid || !validReading(now) || now.monotonicMs < this.#last ||
      Math.abs(now.wallMs - this.#initial.wallMs - (now.monotonicMs - this.#initial.monotonicMs)) > MUSIC_PLAYBACK_CLOCK_DRIFT_MS) this.#valid = false;
    this.#last = now.monotonicMs; return this.#valid;
  }
  interval(interval: PlaybackInterval): MusicPlaybackInterval {
    const offset = this.#initial.wallMs - this.#initial.monotonicMs;
    return {earliestAtMs: Math.floor(interval.startedMonotonicMs + offset - MUSIC_PLAYBACK_CLOCK_SKEW_MS),
      latestAtMs: Math.ceil(interval.endedMonotonicMs + offset + MUSIC_PLAYBACK_CLOCK_SKEW_MS)};
  }
  field<T>(field: PlaybackField<T>): MusicPlaybackField<T> {
    return field.status === 'observed' ? {status: 'observed', value: field.value, interval: this.interval(field.interval)} :
      {status: 'unavailable', error: errorBody(field.error.code).error, interval: this.interval(field.interval)};
  }
  observation(read: NativePlaybackRead, {sequence, processEpoch, libraryScopeId, discontinuity}:
    {sequence: number; processEpoch: string; libraryScopeId: string; discontinuity: boolean}): MusicPlaybackObservation {
    const base = {sequence, interval: this.interval(read.interval), clockUncertaintyMs: MUSIC_PLAYBACK_CLOCK_SKEW_MS, discontinuity};
    if (read.status === 'unavailable') return {...base, status: 'unavailable', error: errorBody(read.error.code).error};
    const output = read.outputSelection;
    return {...base, status: 'sample', processEpoch, libraryScopeId, state: this.field(read.state), position: this.field(read.position), item: this.field(read.item),
      itemAssociation: read.itemAssociation.status === 'bounded-match' ? {status: 'bounded-match', interval: this.interval(read.itemAssociation.interval)} : {status: 'unavailable'},
      metadata: {title: this.field(read.metadata.title), artist: this.field(read.metadata.artist), album: this.field(read.metadata.album), durationSeconds: this.field(read.metadata.durationSeconds)},
      outputSelection: output.status === 'unavailable' ? {status: 'unavailable', error: errorBody(output.error.code).error, interval: this.interval(output.interval)} :
        {status: 'observed', provenance: output.provenance, interval: this.interval(output.interval), selectionInterval: this.interval(output.selectionInterval),
          airPlayEnabled: this.field(output.airPlayEnabled), devices: output.devices.map(device => ({ordinal: device.ordinal, name: this.field(device.name), kind: this.field(device.kind),
            active: this.field(device.active), available: this.field(device.available), selected: this.field(device.selected)}))}};
  }
}
