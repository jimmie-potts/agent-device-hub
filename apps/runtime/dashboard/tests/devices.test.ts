import assert from 'node:assert/strict';
import test from 'node:test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {deviceAction, operationView, deviceBlocked} from '../src/devices.ts';

const no = {supported: false} as const;
const unknown = {status: 'unknown'} as const;
export const device: DeviceRecord = {
  id: 'wall', kind: 'nanoleaf', revision: 4, configurationRevision: 3, generation: {epoch: 'wall-1', sequence: 2}, availability: 'available',
  capabilities: {power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: ['work', 'free']},
    scenes: {supported: true, sceneIds: ['rain']}, media: no, zones: no, moments: no, preview: no},
  desired: {power: {status: 'known', value: true}, brightness: unknown, mode: {status: 'known', value: 'work'}},
  observed: unknown, pending: 0, pendingKinds: [], lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown,
};
const operation = (status: OperationRecord['status'], rest: Partial<OperationRecord> = {}): OperationRecord => ({
  id: '1'.repeat(64), revision: 1, requestId: 'attempt-1', kind: 'device', family: 'power-set', command: 'power-set', target: 'wall',
  requestedBy: 'bunny/parts/dashboard', status, sentAtMs: 1, updatedAtMs: 2, deadlineAtMs: 50, ...rest,
});
void test('a supported device action carries both current guards through the existing action route', () => {
  assert.deepEqual(deviceAction(device, {family: 'power-set', data: {on: false}}, 'attempt-1'), {
    family: 'power-set', target: 'wall', requestId: 'attempt-1', data: {on: false, expectedConfigurationRevision: 3, expectedGeneration: device.generation},
  });
});
void test('unsupported values, invalid brightness and status-owned content refuse locally', () => {
  for (const intent of [
    {family: 'brightness-set', data: {percent: 101}}, {family: 'brightness-set', data: {percent: Number.NaN}},
    {family: 'device-mode-set', data: {mode: 'invented'}}, {family: 'scene-activate', data: {sceneId: 'rain'}},
  ] as const) assert.equal(typeof deviceAction(device, intent, 'attempt-1'), 'string');
  assert.equal(typeof deviceAction({...device, desired: {...device.desired, mode: {status: 'known', value: 'free'}}},
    {family: 'scene-activate', data: {sceneId: 'rain'}}, 'attempt-1'), 'object');
  assert.equal(deviceBlocked(device, false, true), 'Device records are stale');
  assert.equal(deviceBlocked(device, true, false), 'Your session is read-only');
});
void test('accepted is not completed; uncertainty and conflict keep controls locked until definitive evidence', () => {
  assert.deepEqual(operationView(operation('accepted')), {text: 'Accepted. Waiting for completion.', locked: true});
  assert.equal(operationView(operation('uncertain', {result: 'uncertain', evidence: 'none'})).locked, true);
  assert.equal(operationView(operation('conflict', {result: 'conflict'})).locked, true);
  assert.deepEqual(operationView(operation('completed', {result: 'succeeded', evidence: 'transmitted'})),
    {text: 'Completed: succeeded. Transmitted; physical effect was not observed.', locked: false});
  assert.match(operationView(operation('rejected', {error: {code: 'revision-conflict', retryable: false}})).text, /Refused.*revision-conflict.*without changing state/);
});
