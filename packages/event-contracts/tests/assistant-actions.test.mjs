import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantRoutes, catalogProposal} from '../dist/v2/assistant-actions.js';

const target = 'desk-display';
const owner = 'bunny/modules/pixoo';
const guarded = {
  family: 'catalog-action', target, command: 'brightness-set',
  binding: {kind: 'device', owner, target, configurationRevision: 4, generation: {epoch: 'current', sequence: 3}},
  data: {percent: 30},
};

test('approval routing binds effect, owner and exact target', () => {
  assert.deepEqual(catalogProposal(guarded), guarded);
  for (const patch of [
    {target: 'other-display'},
    {command: 'shell-exec'},
    {binding: {...guarded.binding, owner: 'bunny/modules/wemo'}},
    {binding: {...guarded.binding, generation: undefined}},
    {data: {percent: 30, expectedConfigurationRevision: 9}},
    {data: {percent: 30, requestId: 'replacement'}},
  ]) assert.equal(catalogProposal({...guarded, ...patch}), undefined);
});

test('only the catalog routes can be approved, with distinct physical and core owners', () => {
  const fixed = {family: 'catalog-action', target: 'hub', command: 'art-show',
    binding: {kind: 'fixed', owner: 'bunny/core', target: 'hub'}, data: {artworkId: 'saved', targets: ['browser']}};
  assert.deepEqual(catalogProposal(fixed), fixed);
  assert.equal(catalogProposal({...fixed, command: 'art-auto'}), undefined);
  assert.equal(catalogProposal({...fixed, command: 'music-lighting-work'}), undefined);
  assert.equal(catalogProposal({...fixed, binding: {...fixed.binding, owner: 'bunny/modules/art'}}), undefined);
  assert.ok(Object.values(assistantRoutes).every(route => route.fields.split(' ').every(field => field !== 'requestId')));
});
