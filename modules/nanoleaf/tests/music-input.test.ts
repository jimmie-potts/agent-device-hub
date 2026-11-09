import assert from 'node:assert/strict';
import {test} from './support.js';
import {MusicInput, type MusicClock} from '../src/music-input.js';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';

const binding = {endpointId: 'music-mac', generation: '9df02246-518e-44f2-9412-a942735e63cd'};
const at = 1793836800000;
const clock = (delta = 0): MusicClock => ({wallMs: at + delta, monotonicMs: 30 + delta});
const feature = (sequence = 1, delta = (sequence - 1) * 100): CaptureFeatures => ({
  generation: binding.generation, input: 'music', sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
  startMonotonicMs: 900000 + delta, endMonotonicMs: 900100 + delta, emittedMonotonicMs: 900102 + delta,
  observedAtMs: at + delta, validUntilMs: at + delta + 400, rms: 0.5, peak: 1, clippedFraction: 0,
  bands: {bass: 0.4, mid: 0.2, treble: 0.1}, onset: {strength: 0, confidence: 0}, discontinuity: false,
});
const message = (data: unknown = feature()) => ({
  specversion: '1.0', bunnyprofile: '2.0', id: 'synthetic-frame', source: 'bunny/parts/music-producer',
  type: 'org.bunny.music-capture.features.observed', subject: binding.endpointId,
  time: '2026-11-05T00:00:00.000Z', kind: 'occurrence', datacontenttype: 'application/json',
  dataschema: 'https://bunny.invalid/events/music-capture-features/2.0',
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
});

test('the first native discontinuity initializes a binding; a later one after a missed window keeps the input fresh', () => {
  const input = new MusicInput(binding, clock());
  assert.equal(input.accept(message({...feature(), discontinuity: true}), clock()), 'accepted');
  assert.equal(input.current(clock())?.elapsedMs, 0);
  assert.equal(input.accept(message(feature(2)), clock(100)), 'accepted');
  // Window 3 never arrives: the producer marks window 4 as a discontinuity, and the input carries on (#1588).
  assert.equal(input.accept(message({...feature(4), discontinuity: true}), clock(300)), 'accepted');
  assert.equal(input.current(clock(300))?.feature.sequence, 4);
  assert.equal(input.current(clock(300))?.elapsedMs, 300);
  assert.equal(input.accept(message(feature(5)), clock(400)), 'accepted');
  // Only freshness ends it: with nothing newer, the latest window expires and the input is retired for good.
  assert.equal(input.current(clock(800)), null);
  assert.equal(input.accept(message(feature(6)), clock(800)), 'retired');
});

test('input bursts retain one immutable latest feature with source-relative elapsed time', () => {
  const input = new MusicInput(binding, clock());
  const original = feature();
  assert.equal(input.accept(message(original), clock()), 'accepted');
  original.bands.bass = 0;
  original.rms = 0;
  assert.equal(input.current(clock())?.feature.bands.bass, 0.4);
  for (let sequence = 2; sequence <= 20; sequence++) assert.equal(input.accept(message(feature(sequence)), clock((sequence - 1) * 100)), 'accepted');
  const current = input.current(clock(1900));
  assert.equal(current?.feature.sequence, 20);
  assert.equal(current?.elapsedMs, 1900);
  assert.equal(Object.isFrozen(current?.feature.bands), true);
  assert.equal(input.accept(message(feature(23)), clock(2200)), 'accepted');
  assert.equal(input.current(clock(2200))?.feature.sequence, 23);
});

test('duplicate and reverse sequence in fresh envelopes never renew original freshness', () => {
  const input = new MusicInput(binding, clock());
  assert.equal(input.accept(message(feature(2)), clock(100)), 'accepted');
  assert.equal(input.accept({...message(feature(2, 300)), id: 'different-envelope'}, clock(300)), 'duplicate');
  assert.equal(input.accept(message(feature(1, 350)), clock(350)), 'duplicate');
  assert.equal(input.current(clock(499))?.feature.sequence, 2);
  assert.equal(input.current(clock(500)), null);
  assert.equal(input.accept(message(feature(5, 500)), clock(500)), 'retired');
});

test('closed family and binding reject malformed, foreign and nonfinite data without replacing the slot', () => {
  const input = new MusicInput(binding, clock());
  assert.equal(input.accept(message(), clock()), 'accepted');
  for (const data of [{...feature(2), pcm: [0]}, {...feature(2), rms: NaN}, {...feature(2), peak: Infinity},
    {...feature(2), rms: 2}, {...feature(2), sampleRateHz: 48001}, {...feature(2), endMonotonicMs: 10}]) {
    assert.equal(input.accept(message(data), clock(100)), 'invalid');
  }
  for (const patch of [{source: 'bunny/parts/other'}, {subject: 'other-mac'},
    {data: {...feature(2), generation: '9df02246-518e-44f2-9412-a942735e63ce'}}]) {
    assert.equal(input.accept({...message(feature(2)), ...patch}, clock(100)), 'wrong-binding');
  }
  assert.equal(input.accept({...message(feature(2)), expiresat: '2026-11-05T00:00:00.400Z'}, clock(100)), 'invalid');
  assert.equal(input.current(clock(100))?.feature.sequence, 1);
  assert.equal(input.current(clock(400)), null);
});

test('stale data cannot be refreshed by a new envelope and future observations are bounded', () => {
  const stale = new MusicInput(binding, clock(400));
  assert.equal(stale.accept({...message(), id: 'new-envelope', time: '2026-11-05T00:00:00.400Z'}, clock(400)), 'stale');
  assert.equal(stale.accept(message(feature(6)), clock(500)), 'retired');
  const future = new MusicInput(binding, clock());
  assert.equal(future.accept(message(feature(1, 101)), clock()), 'invalid');
  assert.equal(future.accept(message(feature(1, 100)), clock()), 'accepted');
  assert.notEqual(future.current(clock(399)), null);
  assert.equal(future.current(clock(400)), null, 'receiver deadline caps a future-dated frame at 400 ms');
});

test('the original wall deadline and receipt monotonic deadline both expire at the boundary', () => {
  const delayed = new MusicInput(binding, clock(250));
  assert.equal(delayed.accept(message(), clock(250)), 'accepted');
  assert.notEqual(delayed.current(clock(399)), null);
  assert.equal(delayed.current(clock(400)), null);
  const backward = new MusicInput(binding, clock());
  assert.equal(backward.accept(message(), clock()), 'accepted');
  assert.equal(backward.current({wallMs: at + 380, monotonicMs: 430}), null, 'a tolerated wall rollback does not extend the monotonic deadline');
});

test('clock loss, source reversal and explicit retirement never reactivate on a later frame', () => {
  for (const badClock of [{wallMs: at + 50, monotonicMs: 131}, {wallMs: at - 26, monotonicMs: 30},
    {wallMs: at, monotonicMs: 29}, {wallMs: NaN, monotonicMs: 30}]) {
    const input = new MusicInput(binding, clock());
    assert.equal(input.accept(message(), clock()), 'accepted');
    assert.equal(input.current(badClock), null);
    assert.equal(input.accept(message(feature(2)), clock(100)), 'retired');
  }
  const reversed = new MusicInput(binding, clock());
  assert.equal(reversed.accept(message(), clock()), 'accepted');
  assert.equal(reversed.accept(message({...feature(2), startMonotonicMs: 899900, endMonotonicMs: 900000, emittedMonotonicMs: 900002}), clock(100)), 'discontinuity');
  const stopped = new MusicInput(binding, clock());
  stopped.retire();
  assert.equal(stopped.accept(message(), clock()), 'retired');
  assert.throws(() => new MusicInput({...binding, endpointId: 'invalid/endpoint'}, clock()));
  assert.throws(() => new MusicInput(binding, {wallMs: at, monotonicMs: Infinity}));
});
