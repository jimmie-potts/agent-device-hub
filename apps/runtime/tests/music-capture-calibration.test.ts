import assert from 'node:assert/strict';
import test from 'node:test';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import {QuietCalibration, responseDefaults, retireResponse} from '../src/core/music-calibration.js';
const binding = {endpointId: 'endpoint-one', generation: '9df02246-518e-44f2-9412-a942735e63cd', microphoneId: 'studio-mic', sampleRateHz: 48000, channels: 2} as const;
const clock = {wall: 100000, mono: 500};
const frame = (sequence: number, patch: Partial<CaptureFeatures> = {}): CaptureFeatures => ({input: 'microphone', microphoneId: binding.microphoneId,
  generation: binding.generation, sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
  startMonotonicMs: 9000000 + (sequence - 1) * 100, endMonotonicMs: 9000000 + sequence * 100, emittedMonotonicMs: 9000000 + sequence * 100,
  observedAtMs: clock.wall + 200 + sequence * 100, validUntilMs: clock.wall + 600 + sequence * 100,
  rms: sequence / 1000, peak: 0.1, clippedFraction: 0, bands: {bass: 0, mid: 0, treble: 0}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...patch});
void test('quiet measurement ignores queued windows and requires fifty consecutive post-admission windows', () => {
  const trial = new QuietCalibration('quiet-one', binding, clock);
  assert.equal(trial.accept(frame(1, {observedAtMs: clock.wall + 199}), clock.mono + 1).status, 'ignored');
  for (let index = 1; index < 50; index++) assert.equal(trial.accept(frame(index), clock.mono + 200 + index * 100).status, 'pending');
  const result = trial.accept(frame(50), clock.mono + 5200);assert.ok(result.status === 'complete');
  assert.deepEqual(result.evidence, {id: 'quiet-one', binding, windowCount: 50, startedAtMs: 100200, endedAtMs: 105200,
    sourceDurationMs: 5000, percentileRms: 0.048, maximumRms: 0.05, suggestedThreshold: 0.096});
  assert.equal(trial.accept(frame(51), clock.mono + 5300).status, 'ignored');
});
void test('calibration treats measured silence as valid and caps the heuristic threshold', () => {
  for (const rms of [0, 16]) {
    const trial = new QuietCalibration('quiet-level', binding, clock);
    let result = trial.accept(frame(1, {rms, peak: rms}), 800);
    for (let index = 2; index <= 50; index++) result = trial.accept(frame(index, {rms, peak: rms}), clock.mono + 200 + index * 100);
    assert.ok(result.status === 'complete');assert.equal(result.evidence.suggestedThreshold, rms === 0 ? 0 : 16);
  }
});
void test('interrupted coverage, format and clipping fail without completing later', () => {
  for (const [patch, reason] of [[{sequence: 3}, 'discontinuity'], [{startMonotonicMs: 9000110}, 'discontinuity'],
    [{discontinuity: true}, 'discontinuity'], [{sampleRateHz: 44100}, 'format'], [{channels: 1}, 'format'],
    [{clippedFraction: 0.001}, 'clipping'], [{microphoneId: 'other'}, 'source-lost']] as const) {
    const trial = new QuietCalibration('quiet-fail', binding, clock);trial.accept(frame(1), 800);
    assert.deepEqual(trial.accept(frame(2, patch), 900), {status: 'failed', reason});
    assert.equal(trial.accept(frame(3), 1000).status, 'ignored');
  }
});
void test('duplicate input cannot fill coverage and the deadline applies even when dispatch is delayed', () => {
  const trial = new QuietCalibration('quiet-deadline', binding, clock);trial.accept(frame(1), 800);
  assert.equal(trial.accept(frame(1), 900).status, 'ignored');
  assert.equal(trial.expired(10499), false);assert.equal(trial.expired(10500), true);
  assert.deepEqual(trial.accept(frame(2), 10500), {status: 'failed', reason: 'deadline'});
});

void test('a burst cannot substitute repeated observed timestamps or compressed receipt time for five source seconds', () => {
  for (const repeatedWall of [true, false]) {
    const trial = new QuietCalibration('quiet-burst', binding, clock);
    let result = trial.accept(frame(1), 800);
    for (let sequence = 2; sequence <= 50 && result.status === 'pending'; sequence++) {
      const observedAtMs = repeatedWall ? 100300 : 100200 + sequence * 100;
      result = trial.accept(frame(sequence, {observedAtMs, validUntilMs: observedAtMs + 400}), 800);
    }
    assert.deepEqual(result, {status: 'failed', reason: 'clock'});
    assert.equal(trial.accept(frame(51), 5800).status, 'ignored');
  }
});

void test('source versus observed wall elapsed permits only two drift allowances and timestamp rounding', () => {
  // Two producer anchor errors of 25 ms plus one millisecond of integer timestamp rounding = 51 ms.
  for (const drift of [-52, -51, -50, 50, 51, 52]) {
    const trial = new QuietCalibration('quiet-wall-bound', binding, clock);
    let result = trial.accept(frame(1), 800);
    for (let sequence = 2; sequence <= 50 && result.status === 'pending'; sequence++) {
      const observedAtMs = 100200 + sequence * 100 + drift;
      result = trial.accept(frame(sequence, {observedAtMs, validUntilMs: observedAtMs + 400}), 700 + sequence * 100);
    }
    assert.equal(result.status, Math.abs(drift) <= 51 ? 'complete' : 'failed', String(drift));
    if (result.status === 'failed') assert.equal(result.reason, 'clock');
  }
});

void test('receipt versus source elapsed has an explicit freshness, skew, drift and rounding bound', () => {
  // 400 ms freshness + 100 ms future skew + two 25 ms core errors + two 25 ms producer errors + 1 ms rounding = 601 ms.
  for (const drift of [-602, -601, -600, 600, 601, 602]) {
    const trial = new QuietCalibration('quiet-receipt-bound', binding, clock);
    let result = trial.accept(frame(1), 800);
    for (let sequence = 2; sequence <= 50 && result.status === 'pending'; sequence++)
      result = trial.accept(frame(sequence), 700 + sequence * 100 + drift * (sequence - 1) / 49);
    assert.equal(result.status, Math.abs(drift) <= 601 ? 'complete' : 'failed', String(drift));
    if (result.status === 'failed') assert.equal(result.reason, 'clock');
  }
});

void test('bounded delayed delivery preserves source duration while backwards receipt time fails', () => {
  const trial = new QuietCalibration('quiet-delayed', binding, clock);
  let result = trial.accept(frame(1), 1000);
  for (let sequence = 2; sequence <= 50; sequence++) {
    const delay = (3 - ((sequence - 1) % 3) - 1) * 100;
    result = trial.accept(frame(sequence), 700 + sequence * 100 + delay);
  }
  assert.ok(result.status === 'complete');assert.equal(result.evidence.sourceDurationMs, 5000);
  assert.equal(result.evidence.endedAtMs - result.evidence.startedAtMs, 5000);
  const reversed = new QuietCalibration('quiet-reversed', binding, clock);reversed.accept(frame(1), 800);
  assert.deepEqual(reversed.accept(frame(2), 799), {status: 'failed', reason: 'clock'});
});
void test('retirement preserves settings and prior evidence but clears gate application and candidate eligibility', () => {
  const previous = {...responseDefaults(), appliedTo: binding, calibration: {status: 'ready' as const, operationId: 'quiet-one'},
    settings: {...responseDefaults().settings, gate: {mode: 'manual' as const, threshold: 0.02}}};
  const retired = retireResponse(previous, 'restart');
  assert.equal(retired.appliedTo, null);assert.deepEqual(retired.settings, previous.settings);
  assert.deepEqual(retired.calibration, {status: 'ended', operationId: 'quiet-one', reason: 'restart'});
  assert.deepEqual(previous.appliedTo, binding);
});
