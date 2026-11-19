import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {MusicPlaybackField, PlaybackPositionState} from '@jimmie-potts/event-contracts/v2/music-playback';
import {measuredPosition} from '../src/music-show-position.js';

const interval = {earliestAtMs: 1000, latestAtMs: 1200};
const field = <T>(value: T): MusicPlaybackField<T> => ({status: 'observed', value, interval});
function position(state: 'playing' | 'paused'): PlaybackPositionState {
  return {id: 'playback', revision: 2, playbackRevision: 1, presentationGeneration: 'presentation', source: 'music',
    availability: 'available', recordingAssociation: 'unqualified', evidence: {status: 'observed', endpointId: 'producer',
      observation: {status: 'sample', sequence: 1, interval, clockUncertaintyMs: 100, discontinuity: true,
        processEpoch: 'process', libraryScopeId: 'library', item: field('item'), itemAssociation: {status: 'bounded-match', interval},
        state: field(state), position: field(3), metadata: {title: field('Song'), artist: field('Artist'), album: field('Album'),
          durationSeconds: field(180)},
        outputSelection: {status: 'observed', provenance: 'music-declared-selection', interval, selectionInterval: interval,
          airPlayEnabled: field(false), devices: []}}}};
}

void test('show position follows playing time and holds a paused position', () => {
  assert.equal(measuredPosition(position('playing'), 1300)?.positionMs, 3200);
  assert.equal(measuredPosition(position('paused'), 1300)?.positionMs, 3000);
});

void test('show position retires on stale or unsupported presentation evidence', () => {
  assert.equal(measuredPosition(position('playing'), 7000), undefined);
  assert.equal(measuredPosition({...position('playing'), source: 'sonos'}, 1300), undefined);
});
