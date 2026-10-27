import assert from 'node:assert/strict';
import type {SpeechDispatch} from '@jimmie-potts/event-contracts/v2/companions';
import type {Command} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {contextOf, fixture, it, run, waitFor} from './support.js';

it('only companions can dispatch one tracked speech attempt, with no replay of its request identity', async context => {
  const received: Command<SpeechDispatch>[] = [];
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const companions = fixture('companions', async ({sdk}) => {
    await sdk.respond<SpeechDispatch>('bunny.cmd.companion-speech-play.reachy', command => {
      received.push(command); return {status: 'accepted'};
    });
  });
  const other = fixture('speech-other');
  await run(context, {modules: [core, companions, other]});
  const requestId = 'speech-operation-test';
  const data: SpeechDispatch = {requestId, candidateId: 'candidate-test', endpointId: 'endpoint-test'};
  const draft = {type: 'org.bunny.companion-speech.dispatch.requested', subject: 'reachy',
    dataschema: 'https://bunny.invalid/events/companion-speech-dispatch/2.0', data};
  const refused = await contextOf(other).sdk.request('bunny.cmd.companion-speech-dispatch.reachy', draft, {timeoutMs: 2000, requestId});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'forbidden');
  assert.equal(received.length, 0);
  const send = () => contextOf(companions).sdk.request('bunny.cmd.companion-speech-dispatch.reachy', draft, {timeoutMs: 2000, requestId});
  assert.equal((await send()).status, 'accepted');
  assert.equal((await send()).status, 'accepted');
  assert.equal(received.length, 1);
  const command = received[0]; assert.ok(command);
  assert.equal(command.source, 'bunny/core');
  assert.equal(handle?.operation(requestId)?.requestedBy, 'bunny/modules/companions');
  assert.equal(handle?.operation(requestId)?.status, 'accepted');
  await contextOf(companions).sdk.publish('bunny.event.companion-speech-play.reachy', {
    kind: 'outcome', type: 'org.bunny.companion-speech.play.completed', subject: 'reachy',
    dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId, result: 'succeeded', evidence: 'observed'},
  }, {parent: command});
  await waitFor(() => handle?.operation(requestId)?.status === 'completed');
  assert.equal(handle?.operation(requestId)?.result, 'succeeded');
  assert.equal(handle?.operation(requestId)?.traceparent.split('-')[1], command.traceparent.split('-')[1]);
  const bypass = await core.actions.dispatch({key: 'bunny.cmd.companion-speech-play.reachy', requestId: 'bypass-test',
    requestedBy: 'bunny/parts/dashboard', draft: {...draft, type: 'org.bunny.companion-speech.play.requested',
      dataschema: 'https://bunny.invalid/events/companion-speech-play/2.0'}});
  assert.equal('error' in bypass && bypass.error.code, 'forbidden');
  assert.equal(received.length, 1);
});
