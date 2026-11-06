import assert from 'node:assert/strict';
import test from 'node:test';
import {parsePlaybackRecord} from '../src/playback-protocol.js';
import {playbackSample, interval, sourceInstance} from './playback-fixtures.js';

const parse = (value: unknown) => parsePlaybackRecord(Buffer.from(JSON.stringify(value)));
void test('native playback accepts bounded independent fields and real zero position', () => {
  const value = playbackSample(); assert.deepEqual(parse(value), value);
});
void test('native playback accepts definitive late control evidence and explicit empty selection', () => {
  const value = {schema: 'music-playback-control/1.0', action: 'pause', expectedSourceInstance: sourceInstance,
    interval: interval(1000, 5000), sendInterval: interval(1100, 4900), status: 'sent'};
  assert.deepEqual(parse(value), value);
  const sample = playbackSample(); if (sample.outputSelection.status === 'observed') sample.outputSelection.devices = [];
  assert.deepEqual(parse(sample), sample);
});
void test('native playback refuses unknown fields, UTF-8 limits, escaped NUL and invalid temporal claims', () => {
  assert.equal(parse({...playbackSample(), extra: true}), undefined);
  const oversized = playbackSample(); oversized.metadata.title = {...oversized.metadata.title, status: 'observed', value: 'é'.repeat(129)};
  assert.equal(parse(oversized), undefined);
  const nul = playbackSample(); nul.item = {...nul.item, status: 'observed', value: 'A\u0000B'}; assert.equal(parse(nul), undefined);
  const outside = playbackSample(); outside.position.interval.endedMonotonicMs = 9000; assert.equal(parse(outside), undefined);
  const mismatch = playbackSample(); mismatch.item = {status: 'unavailable', interval: interval(1002, 1012),
    error: {code: 'unavailable', retryable: true, detail: 'The selected Music process or requested field is unavailable.'}};
  assert.equal(parse(mismatch), undefined);
  assert.equal(parsePlaybackRecord(Buffer.from([0xff])), undefined);
});
