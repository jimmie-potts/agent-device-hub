// The core forwards the companions module's approved assistant commands through its tracked dispatcher (Hub #46):
// one operation requested by the module, only the allowlisted family and target, and only from that module.
import assert from 'node:assert/strict';
import type {AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {contextOf, fixture, it, run, waitFor} from './support.js';

const draft = (data: AssistantDispatch) => ({type: 'org.bunny.assistant.dispatch.requested', subject: 'assistant',
  dataschema: 'https://bunny.invalid/events/assistant-dispatch/2.0', data});

it('only companions can dispatch an allowlisted mode-set, tracked as its own operation, and nothing else', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const companions = fixture('companions');
  const other = fixture('assistant-other');
  await run(context, {modules: [core, companions, other]});
  const modes: ModeState[] = [];
  const copy = await contextOf(companions).sdk.sync<ModeState>(['mode'], change => {
    if (change.type === 'updated') modes.push(change.message.data);
  }, {owner: 'bunny/core', timeoutMs: 5000});
  assert.equal(copy.status, 'synced');
  context.after(() => copy.status === 'synced' ? copy.copy.close() : Promise.resolve());
  const current = copy.status === 'synced' ? copy.copy.states().find(message => message.data.id === 'hub')?.data : undefined;
  assert.ok(current, 'the core serves its Hub mode');
  const requestId = 'assistant-mode-test';
  const data: AssistantDispatch = {requestId, family: 'mode-set', target: 'hub', data: {mode: current.mode === 'work' ? 'quiet' : 'work', expectedRevision: current.revision}};

  const refused = await contextOf(other).sdk.request('bunny.cmd.assistant-dispatch.assistant', draft(data), {timeoutMs: 2000, requestId: 'assistant-other-test'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'forbidden');
  assert.equal(handle?.operation('assistant-other-test'), undefined);

  const send = (payload: AssistantDispatch, id = payload.requestId) => contextOf(companions).sdk.request('bunny.cmd.assistant-dispatch.assistant', draft(payload), {timeoutMs: 2000, requestId: id});
  const wrongFamily = await send({...data, family: 'power-set' as 'mode-set', requestId: 'assistant-family-test'});
  assert.equal(wrongFamily.status === 'rejected' && wrongFamily.error.error.code, 'invalid-message');
  const wrongTarget = await send({...data, target: 'wall' as 'hub', requestId: 'assistant-target-test'});
  assert.equal(wrongTarget.status === 'rejected' && wrongTarget.error.error.code, 'invalid-message');
  assert.equal(handle?.operation('assistant-family-test'), undefined);
  assert.equal(handle?.operation('assistant-target-test'), undefined);

  assert.equal((await send(data)).status, 'accepted');
  await waitFor(() => handle?.operation(requestId)?.status === 'completed');
  const operation = handle?.operation(requestId);
  assert.equal(operation?.requestedBy, 'bunny/modules/companions');
  assert.equal(operation?.family, 'mode-set');
  assert.equal(operation?.result, 'succeeded');
  await waitFor(() => modes.some(mode => mode.id === 'hub' && mode.mode === data.data.mode));

  // The same request identity is answered again without a second operation; a stale revision is refused by the owner.
  assert.equal((await send(data)).status, 'accepted');
  assert.equal(handle?.operation(requestId)?.result, 'succeeded');
  const stale = await send({...data, requestId: 'assistant-stale-test'});
  assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
  assert.equal(handle?.operation('assistant-stale-test')?.status, 'rejected');
});
