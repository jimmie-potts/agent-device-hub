// The real Art owner and core tracker preserve both sides of a child staging conflict (Hub #297).
// Only the image provider and display responder are synthetic; no provider or device is contacted.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createArtModule, type ArtProvider} from '@jimmie-potts/art';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ArtStageRequest} from '@jimmie-potts/event-contracts/v2/art';
import type {ArtState21} from '@jimmie-potts/event-contracts/v2/art-state';
import {InProcessBus, type Command} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {flush, waitFor} from './support.js';

for (const first of ['succeeded', 'failed', 'conflict'] as const) void test(`Art preparation preserves a child conflict first observed as ${first}, through duplicates and restart`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-art-conflict-')), bus = new InProcessBus();
  const pixoo = bus.connect('bunny/modules/pixoo'), reader = bus.connect('bunny/test/art-conflict');
  const stages: Command<ArtStageRequest>[] = [];
  let moments = 0, images = 0, state: ArtState21 | undefined, handle: CoreHandle | undefined;
  const imageProvider: ArtProvider = {name: 'openai', model: 'gpt-image-2', capabilities: {image: true, text: false}, image: () => {
    images += 1;
    // Invalid synthetic output exercises the owner's existing free procedural fallback.
    return Promise.resolve({bytes: Buffer.from('synthetic-invalid-gif'), usage: {inputTokens: 1, outputTokens: 1}});
  }};
  const device = deviceRecord('desk', 1, 'pixoo', 'available');
  device.capabilities.moments = {supported: true, moods: [], maxDurationMs: 10_000, coversStatus: true, art: {formats: ['gif'], maxBytes: 163_840}};
  await pixoo.serveSync(['device'], () => ({revision: 1, states: [{...deviceState(device), dataschema: 'https://bunny.invalid/events/device/2.2'}]}));
  await pixoo.respond<ArtStageRequest>('bunny.cmd.art-stage.desk', command => {stages.push(command); return {status: 'accepted'};});
  await pixoo.respond('bunny.cmd.moment-play.desk', () => {moments += 1; return {status: 'accepted'};});
  await reader.subscribe<ArtState21>('bunny.state.art.art', message => {state = message.data;});
  const startCore = async () => {
    const core = createCoreModule({parts: [{start: value => {handle = value; return Promise.resolve();}}]}), sdk = bus.connect('bunny/core');
    const host = new ModuleHarness({...core, start: context => core.start({...context, sdk})}, {bus, stateDir: directory});
    await host.start();
    return {core, sdk, host};
  };
  const startArt = async () => {
    const host = new ModuleHarness(createArtModule({providers: {openai: imageProvider}}), {bus, stateDir: directory, section: {}});
    await host.start();
    return host;
  };
  let current = await startCore(), artHost = await startArt();
  t.after(async () => {await artHost.stop(); await current.host.stop(); await current.sdk.close(); await reader.close(); await pixoo.close(); await rm(directory, {recursive: true, force: true});});
  const generated = await current.core.actions.dispatch({key: 'bunny.cmd.art-request.art', requestId: 'source', requestedBy: 'bunny/parts/dashboard',
    draft: {type: 'org.bunny.art.request.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-request/2.0',
      data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['pixoo']}}});
  assert.equal('status' in generated && generated.status, 'accepted');
  await waitFor(() => state?.jobs.find(job => job.requestId === 'source')?.status === 'finished' && stages.length === 1);
  const artwork = state?.artworks[0], compositionId = artwork?.compositions[0]?.compositionId;
  assert.ok(artwork !== undefined && compositionId !== undefined && compositionId !== null);
  const draft = {type: 'org.bunny.art.auto.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-auto/2.1',
    data: {action: 'prepare', artworkId: artwork.artworkId, compositionId, target: 'desk'}};
  const action = {key: 'bunny.cmd.art-auto.art', requestedBy: 'bunny/core', requestId: 'prepare', draft};
  assert.deepEqual(await current.core.actions.dispatch(action), {status: 'accepted', requestId: 'prepare'});
  await waitFor(() => stages.length === 2);
  const child = stages[1] ?? assert.fail('no stage command');
  const finish = (result: 'succeeded' | 'failed') => pixoo.publish('bunny.event.art-stage.desk', {
    kind: 'outcome', type: 'org.bunny.art.stage.completed', subject: 'desk', dataschema: 'https://bunny.invalid/events/outcome/2.0',
    data: {requestId: child.data.requestId, result, evidence: result === 'succeeded' ? 'observed' : 'none',
      ...(result === 'failed' ? {error: errorBody('unavailable', {detail: 'synthetic conflicting staging evidence'}).error} : {})},
  }, {parent: child});
  if (first === 'conflict') {
    await artHost.stop();
    await finish('succeeded'); await finish('failed');
    await waitFor(() => handle?.operation(child.data.requestId)?.result === 'conflict');
    artHost = await startArt();
  } else {
    await finish(first);
    await waitFor(() => handle?.operation('prepare')?.result === first);
    await finish(first === 'succeeded' ? 'failed' : 'succeeded');
  }
  await waitFor(() => handle?.operation('prepare')?.result === 'conflict', 5000, 'the parent operation preserves both child outcomes');
  assert.equal(handle?.operation('prepare')?.status, 'conflict');
  assert.equal(state?.candidates.some(candidate => candidate.compositionId === compositionId), false);
  await current.core.actions.dispatch(action);
  assert.equal(handle?.operation('prepare')?.result, 'conflict');
  await artHost.stop(); await current.host.stop(); await current.sdk.close();
  current = await startCore(); artHost = await startArt();
  await waitFor(() => handle?.operation('prepare')?.result === 'conflict');
  assert.equal((await current.sdk.request(action.key, draft, {requestId: 'prepare', timeoutMs: 2000})).status, 'accepted');
  await finish('succeeded'); await flush();
  assert.equal(handle?.operation('prepare')?.result, 'conflict', 'later partial evidence cannot restore success');
  assert.equal(state?.candidates.some(candidate => candidate.compositionId === compositionId), false);
  assert.equal(stages.length, 2, 'duplicates and restart never stage again');
  assert.equal(images, 1, 'nothing regenerates');
  assert.equal(moments, 0, 'preparation never displays a moment');
  assert.deepEqual(artHost.failures, []); assert.deepEqual(current.host.failures, []);
});
