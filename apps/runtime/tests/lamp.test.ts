// The fixture module (Hub #882): the simulated lamp passes the module test kit, and runs under the real runtime with a
// stand-in core that takes its outcomes.
import assert from 'node:assert/strict';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {core} from './fixtures/core.js';
import {lamp, lampSpec, switchLamp} from './fixtures/lamp.js';
import {contextOf, fixture, it, run, waitFor} from './support.js';

moduleConformance(lampSpec());

it('under the runtime, the lamp switches on command and the core takes its outcome once', async context => {
  const requester = fixture('requester');
  const {logs} = await run(context, {modules: [core(), lamp(), requester]});
  const {key, draft} = switchLamp('lamp-1', 'on');
  const result = await contextOf(requester).sdk.request(key, draft, {timeoutMs: 5000});
  assert.equal(result.status, 'accepted');
  const taken = () => logs.filter(record => record.event_name === 'core.message.taken' && record.attributes.kind === 'outcome');
  await waitFor(() => taken().length === 1, 5000, 'the core to take the outcome');
  assert.equal(taken()[0]?.attributes.requestId, result.requestId);
});

it('under the runtime, the lamp copies the core\'s mode and stays off in quiet mode', async context => {
  const requester = fixture('requester');
  await run(context, {modules: [core('quiet'), lamp(), requester]});
  const {key, draft} = switchLamp('lamp-1', 'on');
  const result = await contextOf(requester).sdk.request(key, draft, {timeoutMs: 5000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'invalid-state');
});
