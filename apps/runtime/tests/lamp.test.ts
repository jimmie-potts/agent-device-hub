// The fixture modules (Hub #882, #846): the lamp and the chime pass the module test kit, and the lamp runs under the
// real runtime with a stand-in core that takes its outcomes.
import assert from 'node:assert/strict';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {chimeSpec} from './fixtures/chime.js';
import {createCoreModule} from './fixtures/core.js';
import {SimulatedLamps, createLampModule, lampSpec, switchLamp} from './fixtures/lamp.js';
import {REGISTRY_REASONS} from '../src/runtime.js';
import {contextOf, fixture, it, run, turnEnded, waitFor} from './support.js';

moduleConformance(lampSpec());
moduleConformance(chimeSpec());

it('under the runtime, the lamp switches on command and the core takes its outcome once', async context => {
  const requester = fixture('requester');
  const {logs} = await run(context, {modules: [createCoreModule(), createLampModule({transport: new SimulatedLamps()}), requester]});
  const {key, draft} = switchLamp('lamp-1', 'on');
  const result = await contextOf(requester).sdk.request(key, draft, {timeoutMs: 5000});
  assert.equal(result.status, 'accepted');
  const taken = () => logs.filter(record => record.attributes['bunny.module'] === 'core' && record.event_name === 'message.received'
    && record.attributes['bunny.message.kind'] === 'outcome' && record.attributes['bunny.outcome'] === 'accepted');
  await waitFor(() => taken().length === 1, 5000, 'the core to take the outcome');
  assert.equal(taken()[0]?.attributes['bunny.request.id'], result.requestId);
});

it('under the runtime, the lamp copies the core\'s mode and stays off in quiet mode', async context => {
  const requester = fixture('requester');
  await run(context, {modules: [createCoreModule({mode: 'quiet'}), createLampModule({transport: new SimulatedLamps()}), requester]});
  const {key, draft} = switchLamp('lamp-1', 'on');
  const result = await contextOf(requester).sdk.request(key, draft, {timeoutMs: 5000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'invalid-state');
});

it('the stand-in core refuses a message that reuses (source, id) with other content, with the registry\'s reason for that conflict', async context => {
  const sender = fixture('sender');
  const {logs} = await run(context, {modules: [createCoreModule(), sender]});
  const {sdk} = contextOf(sender);
  const first = await sdk.publish('bunny.event.session.s1', turnEnded);
  await sdk.publishMessage('bunny.event.session.s1', {...first, data: {sessionId: 's2'}});
  const received = (): typeof logs => logs.filter(record => record.attributes['bunny.module'] === 'core' && record.event_name === 'message.received');
  await waitFor(() => received().length === 2, 5000, 'both messages');
  assert.deepEqual(received().map(record => [record.attributes['bunny.outcome'], record.attributes['bunny.reason']]), [['accepted', undefined], ['rejected', 'duplicate']]);
  assert.equal(received()[1]?.attributes['bunny.reason'], REGISTRY_REASONS['duplicate-conflict'], 'as the edge logs duplicate-conflict');
});
