// The configured fixture module (Hub #919): the sign passes the module test kit, policy A's check included, and under
// the runtime it starts while its sign is offline, reports the sign unavailable and reaches it once it is online.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {SIGN_SECTION, SYNTHETIC_TOKEN, SimulatedSigns, createSignModule, signSpec, type Sign} from './fixtures/sign.js';
import {writeConfiguration} from './scenarios/parts.js';
import {entry, fixture, it, run, stateDir, waitFor} from './support.js';

moduleConformance(signSpec());

it('under the runtime, the sign starts while its sign is offline, reports it unavailable, and shows its greeting once it is online', async context => {
  const signs = new SimulatedSigns();
  const seen: Message<Sign>[] = [];
  const reader = fixture('reader', async ({sdk}) => {
    await sdk.subscribe<Sign>('bunny.state.sign.*', message => { seen.push(message); });
  });
  const dir = await stateDir(context);
  const configFile = await writeConfiguration(join(await stateDir(context), 'config'), {sign: SIGN_SECTION});
  const {runtime, logs} = await run(context, {modules: [reader, createSignModule({transport: signs})], stateDir: dir, configFile});
  // The start returned before any sign answered: policy A.
  assert.equal(entry(runtime.health(), 'sign').state, 'running');
  assert.equal(runtime.health().status, 'ok');
  await waitFor(() => seen.some(message => message.data.availability === 'unavailable'), 5000, 'sign-1 reported unavailable');
  assert.equal(entry(runtime.health(), 'sign').state, 'running', 'a sign that never answers is device state, never a module failure');
  signs.online();
  await waitFor(() => seen.some(message => message.data.availability === 'available'), 10_000, 'sign-1 reported available');
  assert.deepEqual(signs.state().shown, {[SIGN_SECTION.signs[0].address]: 'HELLO'}, 'the greeting from its section, rendered in a worker thread');
  assert.equal(signs.state().refused, 0, 'sent with the token from its secret file');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'modules', 'sign', 'layout.json'), 'utf8')), {greeting: 'hello', signs: ['sign-1']});
  assert.equal(JSON.stringify([logs, seen, runtime.health()]).includes(SYNTHETIC_TOKEN), false, 'the token appears in no record, message or health');
  assert.deepEqual(logs.filter(record => record.attributes['bunny.module'] === 'sign' && record.event_name.startsWith('operation.'))
    .map(record => [record.event_name, record.attributes['bunny.reason'] ?? record.attributes['bunny.outcome']]),
  [['operation.failed', 'unavailable'], ['operation.completed', 'succeeded']], 'one record per change, not per attempt');
});

it('a render that fails, even past its deadline, is reported against the sign and tried again, never a module failure', async context => {
  const signs = new SimulatedSigns({online: true});
  const seen: Message<Sign>[] = [];
  const reader = fixture('reader', async ({sdk}) => {
    await sdk.subscribe<Sign>('bunny.state.sign.*', message => { seen.push(message); });
  });
  // This worker ends without a reply, so every render the sign asks for is uncertain.
  const renderWorker = new URL('./fixtures/call-worker.js', import.meta.url);
  const configFile = await writeConfiguration(join(await stateDir(context), 'config'), {sign: SIGN_SECTION});
  const {runtime, logs} = await run(context, {modules: [reader, createSignModule({transport: signs, renderWorker})], configFile});
  const failed = (): typeof logs => logs.filter(record => record.attributes['bunny.module'] === 'sign' && record.event_name === 'operation.failed');
  await waitFor(() => failed().length > 0, 5000, 'the failed render reported');
  await new Promise(resolve => { setTimeout(resolve, 1600); });
  assert.deepEqual(failed().map(record => [record.attributes['bunny.device.id'], record.attributes['bunny.code']]), [['sign-1', 'uncertain-result']],
    'once per run of failures, with the call\'s code');
  assert.equal(entry(runtime.health(), 'sign').state, 'running');
  assert.deepEqual(seen, [], 'no evidence about the sign, so its availability stays as it was');
  assert.equal(signs.state().attempts, 0, 'nothing reached the sign');
});
