import assert from 'node:assert/strict';
import test from 'node:test';
import {frontendCommandView, type FrontendCommand, type FrontendCommandPhase} from '@jimmie-potts/sdk/frontend';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {contentBlocked, deviceAction, operationView, deviceBlocked} from '../src/devices.ts';

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
void test('the Pixoo gates content by the advertised Hub mode: off in Work, on in Free and Quiet, with no Monitor/Media mapping (ADR 0014)', () => {
  const pixoo = (value: string | undefined, pendingKinds: string[] = []): DeviceRecord => ({...device, id: 'pixoo-1', kind: 'pixoo', pendingKinds,
    capabilities: {...device.capabilities, scenes: no, modes: {supported: true, values: ['work', 'free', 'quiet']},
      media: {supported: true, actions: ['pause', 'resume'], playlistIds: ['list-1'], renditionIds: []}},
    desired: {...device.desired, mode: value === undefined ? unknown : {status: 'known', value}}});
  assert.match(contentBlocked(pixoo('work')) ?? '', /off in Work/);
  for (const value of ['free', 'quiet']) {
    assert.equal(contentBlocked(pixoo(value)), undefined, value);
    assert.equal(typeof deviceAction(pixoo(value), {family: 'media-start', data: {playlistId: 'list-1'}}, 'attempt-1'), 'object', value);
  }
  assert.equal(typeof deviceAction(pixoo('work'), {family: 'media-start', data: {playlistId: 'list-1'}}, 'attempt-1'), 'string');
  for (const blocked of [pixoo(undefined), pixoo('free', ['device-mode-set']), pixoo('media'), pixoo('monitor')]) assert.notEqual(contentBlocked(blocked), undefined);
  // The Nanoleaf still shows content only in Free.
  assert.match(contentBlocked(device) ?? '', /need Free/);
  assert.equal(contentBlocked({...device, desired: {...device.desired, mode: {status: 'known', value: 'free'}}}), undefined);
});
void test('every operation status and result derives the phase, text and lock', () => {
  const cases: readonly (readonly [OperationRecord, FrontendCommandPhase, boolean, string])[] = [
    [operation('sent'), {kind: 'requested'}, true, 'Requested. Waiting for acceptance.'],
    [operation('accepted'), {kind: 'accepted'}, true, 'Accepted. Waiting for completion.'],
    [operation('rejected'), {kind: 'refused', code: undefined}, false, 'Refused without changing state.'],
    [operation('rejected', {error: {code: 'revision-conflict', retryable: false}}),
      {kind: 'refused', code: 'revision-conflict'}, false, 'Refused (revision-conflict) without changing state.'],
    [operation('expired'), {kind: 'expired'}, false, 'Expired before the command reached its owner. Nothing was sent to the device.'],
    [operation('conflict', {result: 'conflict'}), {kind: 'conflict'}, true, 'Conflicting outcomes. Controls are locked until the operation is resolved.'],
    ...[operation('uncertain', {result: 'uncertain'}), operation('completed', {result: 'uncertain'}), operation('completed', {result: 'conflict'})].map(
      (record): [OperationRecord, FrontendCommandPhase, boolean, string] => [
        record, {kind: 'uncertain'}, true, 'Uncertain result. The command may have taken effect; it was not sent again.',
      ]),
    [operation('completed', {result: 'succeeded', evidence: 'transmitted'}),
      {kind: 'completed', result: 'succeeded', evidence: 'transmitted', family: 'power-set', code: undefined},
      false, 'Completed: succeeded. Transmitted; physical effect was not observed.'],
    [operation('completed', {result: 'failed', evidence: 'none', error: {code: 'internal', retryable: false}}),
      {kind: 'completed', result: 'failed', evidence: 'none', family: 'power-set', code: 'internal'},
      false, 'Completed: failed (internal). No evidence of a device effect.'],
    [operation('completed'), {kind: 'completed', result: undefined, evidence: undefined, family: 'power-set', code: undefined},
      false, 'Completed: unknown. No evidence of a device effect.'],
    [operation('completed', {result: 'succeeded', evidence: 'observed'}),
      {kind: 'completed', result: 'succeeded', evidence: 'observed', family: 'power-set', code: undefined},
      false, 'Completed: succeeded. The module observed the result.'],
  ];
  for (const [record, phase, locked, text] of cases) assert.deepEqual(operationView(record), {phase, text, locked}, record.status);
});

void test('local and restored command phases retain their wording and lock without an operation record', () => {
  const cases: readonly (readonly [FrontendCommandPhase, boolean, string])[] = [
    [{kind: 'none'}, false, 'No command sent from this page.'],
    [{kind: 'not-sent', reason: 'operation records are stale'}, false, 'Not sent: operation records are stale. Nothing was sent.'],
    [{kind: 'restored'}, true, 'Previous request has no confirmed result yet. It was not sent again.'],
  ];
  for (const [phase, locked, text] of cases) assert.deepEqual(frontendCommandView(phase), {phase, text, locked});

  const legacy: FrontendCommand = {text: 'Receipt', locked: false, requestId: undefined, run: async () => {}};
  assert.equal(legacy.phase, undefined);
});

void test('saved mode and show handoff completion never claim a device effect', () => {
  for (const family of ['mode-set', 'mode-override-set']) {
    const view = operationView(operation('completed', {family, result: 'succeeded', evidence: 'observed'}));
    assert.equal(view.phase.kind, 'completed');
    assert.equal(view.text, 'Choice saved. Device results are separate.');
    assert.equal(view.locked, false);
  }
  const show = operationView(operation('completed', {family: 'art-show', result: 'succeeded', evidence: 'observed'}));
  assert.equal(show.phase.kind, 'completed');
  assert.equal(show.text, 'Show handed off. Each surface has its own result below.');
  assert.equal(show.locked, false);
});
