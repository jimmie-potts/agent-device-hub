import assert from 'node:assert/strict';
import test from 'node:test';
import {PlaybackClock} from '../src/playback-timing.js';
import {playbackSample} from './playback-fixtures.js';

void test('playback maps original intervals conservatively without refreshing delayed observations', () => {
  const clock = new PlaybackClock({wallMs: 1_001_000, monotonicMs: 1000});
  assert.equal(clock.check({wallMs: 1_005_000, monotonicMs: 5000}), true);
  const sample = clock.observation(playbackSample(), {sequence: 1, processEpoch: 'epoch', libraryScopeId: 'synthetic-library', discontinuity: true});
  assert.deepEqual(sample.interval, {earliestAtMs: 1_000_900, latestAtMs: 1_001_150});
  assert.equal(sample.clockUncertaintyMs, 100);
  assert.equal(JSON.stringify(sample).includes('sourceInstance'), false);
  assert.equal(JSON.stringify(sample).includes('Monotonic'), false);
});
void test('clock jumps and monotonic reversal permanently invalidate the original registration', () => {
  for (const shift of [-26, 26]) {
    const clock = new PlaybackClock({wallMs: 1_001_000, monotonicMs: 1000});
    assert.equal(clock.check({wallMs: 1_001_100 + shift, monotonicMs: 1100}), false);
    assert.equal(clock.check({wallMs: 1_001_200, monotonicMs: 1200}), false);
  }
  const backwards = new PlaybackClock({wallMs: 1_001_000, monotonicMs: 1000});
  assert.equal(backwards.check({wallMs: 1_000_999, monotonicMs: 999}), false);
});
