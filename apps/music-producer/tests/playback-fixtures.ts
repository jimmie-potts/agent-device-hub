import type {NativePlaybackSample, PlaybackField, PlaybackInterval} from '../src/playback-protocol.js';

export const sourceInstance = 'a'.repeat(64);
export const interval = (start = 1000, end = start + 1): PlaybackInterval => ({startedMonotonicMs: start, endedMonotonicMs: end});
export const observed = <T>(value: T, start = 1000, end = start + 1): PlaybackField<T> => ({status: 'observed', value, interval: interval(start, end)});
export function playbackSample(start = 1000): NativePlaybackSample {
  return {schema: 'music-playback-read/1.0', status: 'sample', sourceInstance, interval: interval(start, start + 50),
    state: observed('playing', start, start + 1), position: observed(0, start + 3, start + 4),
    item: observed('ABCD', start + 2, start + 12), itemAssociation: {status: 'bounded-match', interval: interval(start + 2, start + 12)},
    metadata: {title: observed('Synthetic title', start + 5, start + 6), artist: observed('Synthetic artist', start + 6, start + 7),
      album: observed('Synthetic album', start + 7, start + 8), durationSeconds: observed(100, start + 8, start + 9)},
    outputSelection: {status: 'observed', provenance: 'music-declared-selection', interval: interval(start + 20, start + 50),
      selectionInterval: interval(start + 20, start + 21), airPlayEnabled: observed(true, start + 21, start + 22), devices: [{ordinal: 0,
        name: observed('Synthetic speaker', start + 22, start + 23), kind: observed('airplay-device', start + 23, start + 24),
        active: observed(true, start + 24, start + 25), available: observed(true, start + 25, start + 26), selected: observed(true, start + 26, start + 27)}]}};
}
