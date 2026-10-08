import assert from 'node:assert/strict';
import test from 'node:test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {modeAction, modeApplication, modeDeviceResults} from '../src/hub-mode.ts';
import {modeChildRequestId} from '../../src/core/mode-participants.ts';

const parent = {requestId: 'req-work', family: 'mode-set', target: 'hub', status: 'completed', result: 'succeeded', sentAtMs: 100, revision: 4} as OperationRecord;
void test('a saved choice, selection reply and independently matched device results stay distinct', async () => {
  const saved: ModeState = {id: 'hub', mode: 'work', revision: 3, selectedAtMs: 102};
  assert.deepEqual(modeAction(saved, 'work', 'req-again'), {family: 'mode-set', target: 'hub', requestId: 'req-again', data: {mode: 'work', expectedRevision: 3}});
  const nano = {requestId: await modeChildRequestId(parent.requestId, 'wall'), family: 'device-mode-set', target: 'wall', requestedBy: 'bunny/core', status: 'completed', result: 'failed', evidence: 'none', error: {code: 'unavailable'}} as OperationRecord;
  const pixoo = {requestId: await modeChildRequestId(parent.requestId, 'pixoo-1'), family: 'device-mode-set', target: 'pixoo-1', requestedBy: 'bunny/core', status: 'completed', result: 'succeeded', evidence: 'observed'} as OperationRecord;
  const unrelated = {...pixoo, requestId: 'req-native', target: 'other'};
  const records = [parent, nano, pixoo, unrelated];
  assert.deepEqual(await modeDeviceResults(parent, records, [], true), [
    {target: 'pixoo-1', status: 'completed', result: 'succeeded', evidence: 'observed'},
    {target: 'wall', status: 'completed', result: 'failed', evidence: 'none', code: 'unavailable'},
  ]);
  assert.deepEqual(await modeDeviceResults(parent, records, [], false), [{target: 'pixoo-1', status: 'not synced'}, {target: 'wall', status: 'not synced'}]);
  assert.deepEqual(await modeDeviceResults(parent, [], [{id: 'wall', kind: 'nanoleaf'} as DeviceRecord], true), [{target: 'wall', status: 'not observed'}]);
  assert.equal(modeApplication([parent, {...parent, requestId: 'req-stale', sentAtMs: 200, status: 'rejected', result: 'failed'}])?.requestId, 'req-work');
  assert.equal(modeApplication([]), undefined);
});
