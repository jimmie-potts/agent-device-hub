import assert from 'node:assert/strict';
import test from 'node:test';
import {checkModeParticipants, modeChildRequestId, modeParticipants} from '../src/core/mode-participants.js';

void test('qualified admission fixes targets without depending on observed state or running status', () => {
  assert.deepEqual(modeParticipants([
    {name: 'nanoleaf', admitted: true, devices: ['wall', 'panels']},
    {name: 'pixoo', admitted: true, devices: ['pixoo-1']},
    {name: 'lifx', admitted: true, devices: ['lamp-1']},
    {name: 'pixoo', admitted: false, devices: ['refused']},
  ]), [{id: 'wall', kind: 'nanoleaf'}, {id: 'panels', kind: 'nanoleaf'}, {id: 'pixoo-1', kind: 'pixoo'}]);
  const inputs = [{id: 'wall', kind: 'nanoleaf' as const}];
  const checked = checkModeParticipants(inputs); assert.ok(inputs[0]); inputs[0].id = 'changed';
  assert.equal(checked[0]?.id, 'wall');
  assert.throws(() => checkModeParticipants([{id: 'Wall.Bad', kind: 'nanoleaf'}]), /invalid-mode-participants/);
  assert.throws(() => checkModeParticipants([{id: 'wall', kind: 'nanoleaf'}, {id: 'wall', kind: 'pixoo'}]), /invalid-mode-participants/);
});

void test('child identities survive reload and distinguish parents and targets within the request ID contract', async () => {
  const first = await modeChildRequestId('a'.repeat(128), 'b'.repeat(128));
  assert.equal(first, await modeChildRequestId('a'.repeat(128), 'b'.repeat(128)));
  assert.match(first, /^mode-[0-9a-f]{64}$/);
  assert.notEqual(first, await modeChildRequestId('other', 'b'.repeat(128)));
  assert.notEqual(await modeChildRequestId('a:b', 'c'), await modeChildRequestId('a', 'b:c'));
});
