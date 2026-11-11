import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
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

it('an unconfirmed speech line stays in history with no inbox item; one that failed after acceptance still opens one', async context => {
  // #1657 (owner decision D3): a line whose playback the browser never confirmed holds no device and can only be dismissed.
  let handle: CoreHandle | undefined, database: DatabaseSync | undefined;
  const core = createCoreModule({parts: [{open: db => {database = db;}, start: given => {handle = given; return Promise.resolve();}}]});
  const received: Command<SpeechDispatch>[] = [];
  const companions = fixture('companions', async ({sdk}) => {
    await sdk.respond<SpeechDispatch>('bunny.cmd.companion-speech-play.reachy', command => {received.push(command); return {status: 'accepted'};});
  });
  await run(context, {modules: [core, companions]});
  const items = (): string[] => (database?.prepare('SELECT record FROM inbox_records WHERE handled_by IS NULL').all() as {record: string}[] | undefined ?? [])
    .map(row => (JSON.parse(row.record) as {item: {requestId: string}}).item.requestId);
  const speak = async (requestId: string, result: 'uncertain' | 'failed'): Promise<void> => {
    const answer = await contextOf(companions).sdk.request('bunny.cmd.companion-speech-dispatch.reachy', {type: 'org.bunny.companion-speech.dispatch.requested', subject: 'reachy',
      dataschema: 'https://bunny.invalid/events/companion-speech-dispatch/2.0', data: {requestId, candidateId: `candidate-${requestId}`, endpointId: 'endpoint-test'}}, {timeoutMs: 2000, requestId});
    assert.equal(answer.status, 'accepted');
    const command = received.find(each => each.data.requestId === requestId); assert.ok(command);
    await contextOf(companions).sdk.publish('bunny.event.companion-speech-play.reachy', {kind: 'outcome', type: 'org.bunny.companion-speech.play.completed', subject: 'reachy',
      dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId, result, evidence: result === 'uncertain' ? 'transmitted' : 'none',
        error: {code: result === 'uncertain' ? 'uncertain-result' : 'unavailable', retryable: false, detail: 'synthetic: the browser endpoint gave no playback receipt'}}}, {parent: command});
    await waitFor(() => handle?.operation(requestId)?.status === 'completed');
  };
  await speak('speech-unconfirmed', 'uncertain');
  await speak('speech-failed', 'failed');
  await waitFor(() => items().length === 1);
  assert.deepEqual(items(), ['speech-failed']);
  assert.deepEqual([handle?.operation('speech-unconfirmed')?.result, handle?.operation('speech-unconfirmed')?.error?.code], ['uncertain', 'uncertain-result'], 'history keeps the outcome');
});
