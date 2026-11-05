import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePositionRecord} from '../src/position-protocol.js';

export const positionSample = (instance = 'a'.repeat(64)) => ({schema: 'music-position-read/1.0', status: 'sample', sourceInstance: instance,
  interval: {startedMonotonicMs: 1001, endedMonotonicMs: 1040},
  state: {value: 'playing', interval: {startedMonotonicMs: 1010, endedMonotonicMs: 1020}},
  position: {status: 'observed', seconds: 12.5, interval: {startedMonotonicMs: 1021, endedMonotonicMs: 1030}}});
const parse = (value: unknown) => parsePositionRecord(Buffer.from(JSON.stringify(value)));
void test('position protocol preserves independent intervals and a partial state observation', () => {
  const sample = positionSample(); assert.deepEqual(parse(sample), sample);
  const partial = {...sample, position: {status: 'unavailable', interval: sample.position.interval,
    error: {code: 'unavailable', retryable: true, detail: 'The selected Music process or read is unavailable.'}}};
  assert.deepEqual(parse(partial), partial);
});
void test('position protocol refuses extra data, invalid numbers, intervals and error text', () => {
  const sample = positionSample();
  for (const value of [
    {...sample, title: 'not allowed'}, {...sample, sourceInstance: 'pid:123'},
    {...sample, state: {...sample.state, value: 'unknown'}},
    {...sample, position: {...sample.position, seconds: -1}},
    {...sample, position: {...sample.position, seconds: 1e15}},
    {...sample, position: {...sample.position, seconds: '12.5'}},
    {...sample, interval: {startedMonotonicMs: 1050, endedMonotonicMs: 1040}},
    {...sample, state: {...sample.state, interval: {startedMonotonicMs: 1000, endedMonotonicMs: 1020}}},
    {...sample, position: {...sample.position, interval: {startedMonotonicMs: 1019, endedMonotonicMs: 1030}}},
    {...sample, position: {status: 'unavailable', interval: sample.position.interval,
      error: {code: 'unavailable', retryable: true, detail: 'raw error'}}},
  ]) assert.equal(parse(value), undefined);
  assert.equal(parsePositionRecord(Buffer.from('{"seconds":NaN}')), undefined);
  assert.equal(parsePositionRecord(Buffer.alloc(4097)), undefined);
  assert.equal(parsePositionRecord(Buffer.from([255])), undefined);
});
