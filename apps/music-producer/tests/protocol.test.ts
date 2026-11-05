import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeLines, parseNativeRecord} from '../src/protocol.js';

export const nativeFrame = (sequence = 1, endMonotonicMs = 1100) => ({schema: 'music-native-frame/1.0', sequence, sampleRateHz: 48000,
  channels: 2, frameCount: 4800, startMonotonicMs: endMonotonicMs - 100, endMonotonicMs, emittedMonotonicMs: endMonotonicMs + 1,
  rms: 0.25, peak: 0.5, clippedFraction: 0, bands: {bass: 0.1, mid: 0.2, treble: 0.1}, onset: {strength: 0.2, confidence: 0.1}, discontinuity: sequence === 1});
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

void test('closed native records refuse private fields, invalid numbers, fabricated timing and unknown errors', () => {
  assert.ok(parseNativeRecord(encode(nativeFrame())));
  for (const change of [{pcm: [1, 2]}, {rms: 17}, {peak: 0.1}, {channels: 3}, {sequence: 0}, {frameCount: 4799},
    {sampleRateHz: 48001}, {endMonotonicMs: 1101}, {emittedMonotonicMs: 1099}, {rms: Infinity}, {bands: {bass: 0, mid: 33, treble: 0}}]) {
    assert.equal(parseNativeRecord(encode({...nativeFrame(), ...change})), undefined);
  }
  assert.equal(parseNativeRecord(encode({schema: 'music-native-terminal/1.0', error: {code: 'unavailable', retryable: true, detail: 'private song title'}})), undefined);
  assert.equal(parseNativeRecord(Buffer.from([0xff])), undefined);
});

void test('split lines are reconstructed without retaining oversized or malformed output', () => {
  const records: unknown[] = []; let invalid = 0;
  const lines = new NativeLines(value => records.push(value), () => {invalid += 1;});
  const bytes = Buffer.from(JSON.stringify(nativeFrame()) + '\n');
  lines.push(bytes.subarray(0, 50)); lines.push(bytes.subarray(50));
  assert.equal(records.length, 1);
  lines.push(Buffer.alloc(2049, 32));
  lines.push(bytes);
  assert.equal(invalid, 1); assert.equal(records.length, 1);
  const unfinished = new NativeLines(() => assert.fail('partial record'), () => {invalid += 1;});
  unfinished.push(bytes.subarray(0, 10)); unfinished.finish();
  assert.equal(invalid, 2);
});
