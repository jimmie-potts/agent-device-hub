// Which request a control may treat as newer than a device's last report (#1931 review): only a completed power or
// brightness request of that kind, after the reading. A write of another kind, or an older request, leaves the
// observation in charge.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {newerRequest} from '../src/requested.ts';

const record = (observedAtMs: number | undefined): DeviceRecord => ({id: 'wall', observed: observedAtMs === undefined ? {status: 'unknown'} : {status: 'known', observedAtMs}} as unknown as DeviceRecord);
const operation = (family: string, updatedAtMs: number, outcome: Partial<OperationRecord> = {}): OperationRecord => ({id: `${family}-${String(updatedAtMs)}`, revision: 1, requestId: `r-${String(updatedAtMs)}`,
  kind: 'device', family, command: family, target: 'wall', requestedBy: 'bunny/dashboard', status: 'completed', result: 'succeeded', sentAtMs: updatedAtMs - 5, updatedAtMs, deadlineAtMs: updatedAtMs + 1000, ...outcome});

void test('a completed power request after the last reading is newer', () => {
  assert.equal(newerRequest(record(100), [operation('power-set', 200)], 'power-set'), true);
  assert.equal(newerRequest(record(undefined), [operation('power-set', 200)], 'power-set'), true, 'no reading yet');
});
void test('a reading after the request, a write of another kind, or an unfinished request leaves the observation in charge', () => {
  assert.equal(newerRequest(record(300), [operation('power-set', 200)], 'power-set'), false, 'the light reported after the request');
  assert.equal(newerRequest(record(150), [operation('power-set', 100), operation('brightness-set', 200)], 'power-set'), false, 'a brightness write is not a power request');
  assert.equal(newerRequest(record(150), [operation('power-set', 100), operation('brightness-set', 200)], 'brightness-set'), true);
  assert.equal(newerRequest(record(100), [operation('power-set', 200, {result: 'failed'})], 'power-set'), false, 'a failed request changed nothing');
  assert.equal(newerRequest(record(100), [(({result: _result, ...rest}) => ({...rest, status: 'accepted' as const}))(operation('power-set', 200))], 'power-set'), false, 'one still in flight is not a request yet');
  assert.equal(newerRequest(record(100), [operation('power-set', 200, {target: 'other'})], 'power-set'), false, 'another device\'s request');
  assert.equal(newerRequest(record(150), [operation('power-set', 200, {result: 'failed'}), operation('power-set', 100)], 'power-set'), false, 'the latest request failed');
});
void test('a later request that failed, or is still in flight, leaves the observation in charge (#1966 review)', () => {
  // The device's desired value is set when a request is accepted and stays when it fails, so it belongs to the latest
  // request, not to an earlier one that succeeded.
  for (const family of ['power-set', 'brightness-set'] as const) {
    assert.equal(newerRequest(record(100), [operation(family, 200), operation(family, 300, {result: 'failed'})], family), false, `${family}: failed after a success`);
    assert.equal(newerRequest(record(100), [operation(family, 200), operation(family, 300, {status: 'expired', result: undefined} as never)], family), false, `${family}: expired after a success`);
    assert.equal(newerRequest(record(100), [operation(family, 200), operation(family, 300, {status: 'rejected', result: undefined} as never)], family), false, `${family}: refused after a success`);
    assert.equal(newerRequest(record(100), [operation(family, 200), operation(family, 300, {result: 'uncertain'})], family), false, `${family}: uncertain after a success`);
    assert.equal(newerRequest(record(100), [operation(family, 200), operation(family, 300, {status: 'accepted', result: undefined} as never)], family), false, `${family}: in flight after a success`);
    assert.equal(newerRequest(record(100), [operation(family, 300, {result: 'failed'}), operation(family, 400)], family), true, `${family}: a success after a failure counts`);
    assert.equal(newerRequest(record(100), [operation(family, 200), operation(family === 'power-set' ? 'brightness-set' : 'power-set', 300, {result: 'failed'})], family), true, `${family}: a failure of the other kind does not count`);
  }
});
