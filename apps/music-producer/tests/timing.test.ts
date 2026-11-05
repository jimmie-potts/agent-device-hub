import assert from 'node:assert/strict';
import test from 'node:test';
import {CaptureClock, coreClockQualified, nativeClockQualified} from '../src/timing.js';

const initial = {wallMs: 1_000_000, monotonicMs: 10_000};

test('source timestamps describe the window end, including stdout and publication delay', () => {
  const clock = new CaptureClock(initial);
  assert.deepEqual(clock.timestamps(10_100, {wallMs: 1_000_150, monotonicMs: 10_150}),
    {observedAtMs: 1_000_100, validUntilMs: 1_000_500});
  assert.equal(clock.timestamps(10_100, {wallMs: 1_000_351, monotonicMs: 10_351}), undefined);
  assert.deepEqual(clock.timestamps(10_400, {wallMs: 1_000_410, monotonicMs: 10_410}),
    {observedAtMs: 1_000_400, validUntilMs: 1_000_800});
});

test('future samples and clock jumps never gain fresh timestamps', () => {
  const clock = new CaptureClock(initial);
  assert.equal(clock.timestamps(10_151, {wallMs: 1_000_150, monotonicMs: 10_150}), undefined);
  assert.equal(clock.timestamps(10_200, {wallMs: 1_000_400, monotonicMs: 10_250}), undefined);
  assert.equal(clock.valid, false);
  assert.equal(clock.timestamps(10_300, {wallMs: 1_000_310, monotonicMs: 10_310}), undefined, 'clock failure is latched');
  assert.equal(new CaptureClock(initial).timestamps(9_999, {wallMs: 999_999, monotonicMs: 9_999}), undefined);
});

test('same-domain native clock is bracketed without inspecting or capturing audio', () => {
  assert.equal(nativeClockQualified({beforeMs: 1000, nativeMs: 1001, afterMs: 1002}), true);
  assert.equal(nativeClockQualified({beforeMs: 1000, nativeMs: 999, afterMs: 1002}), false);
  assert.equal(nativeClockQualified({beforeMs: 1000, nativeMs: 1003, afterMs: 1002}), false);
  assert.equal(nativeClockQualified({beforeMs: 1000, nativeMs: NaN, afterMs: 1002}), false);
});

test('core clock qualification bounds every possible offset and refuses a clock step during the request', () => {
  const sample = {sent: initial, received: {wallMs: 1_000_020, monotonicMs: 10_020}, replyAtMs: 1_000_010};
  assert.equal(coreClockQualified(sample), true);
  assert.equal(coreClockQualified({...sample, replyAtMs: 1_000_051}), false);
  assert.equal(coreClockQualified({...sample, replyAtMs: 999_969}), false);
  assert.equal(coreClockQualified({...sample, received: {wallMs: 1_000_250, monotonicMs: 10_020}}), false);
  assert.equal(coreClockQualified({...sample, received: {wallMs: 1_000_250, monotonicMs: 10_250}}), false, 'wide round trip cannot prove the skew bound');
});
