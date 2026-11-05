// Real art -> core -> Pixoo staging, followed by a core-owned exact moment. All provider/device IO is simulated.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import {registration as artRegistration} from '@jimmie-potts/art';
import {createPixooModule, SIMULATED_SECTION, SimulatedPixoo, frameDigest} from '@jimmie-potts/pixoo';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {edgeConfig, fixture, it, run, waitFor} from './support.js';

it('the real producer stages exact frames through the core and its moment transmits those same decoded pixels', async context => {
  let handle: CoreHandle | undefined, state: ArtState | undefined;
  const core = createCoreModule({parts: [{start: value => {handle = value; return Promise.resolve();}}]});
  const device = new SimulatedPixoo({mode: 'online'}), pixoo = createPixooModule({transport: device});
  const observer = fixture('observer', async ({sdk}) => {await sdk.subscribe<ArtState>('bunny.state.art.art', message => {state = message.data;});});
  const playback = fixture('playback', async ({sdk}) => {await sdk.serveSync(['playback'], () => ({revision: 1, states: []}));});
  const files = await edgeConfig(context, [], {modules: {art: {}, pixoo: {device: {...SIMULATED_SECTION.config.device, id: 'pixoo'}}}});
  await run(context, {modules: [core, observer, playback, pixoo, artRegistration.simulate()], configFile: files.config});
  assert.ok(handle !== undefined);
  const coreHandle = handle;
  const request = await coreHandle.dispatch({key: 'bunny.cmd.art-request.art', requestId: 'exact-art-create', requestedBy: 'bunny/parts/dashboard',
    draft: {type: 'org.bunny.art.request.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-request/2.0',
      data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['pixoo'], text: 'SYNTHETIC_PIXOO_EXACT'}}});
  assert.deepEqual(request, {status: 'accepted', requestId: 'exact-art-create'});
  await waitFor(() => state?.candidates.some(candidate => candidate.target === 'pixoo') === true, 10_000, 'real staging outcome');
  const composition = state?.candidates.find(candidate => candidate.target === 'pixoo');
  assert.ok(composition !== undefined);
  const preview = await pixoo.manifest.content?.(`art-preview.${composition.compositionId}`);
  assert.ok(preview !== undefined && !('error' in preview));
  const manifest = JSON.parse(Buffer.from(preview.bytes).toString('utf8')) as {frameCount: number; durationMs: number; frames: {delayMs: number; sha256: string; ref: string}[]};
  assert.equal(manifest.frameCount, 8); assert.equal(manifest.durationMs, 1600);
  const digests: string[] = [];
  for (const frame of manifest.frames) {
    const image = await pixoo.manifest.content?.(frame.ref);
    assert.ok(image !== undefined && !('error' in image));
    assert.equal(createHash('sha256').update(image.bytes).digest('hex'), frame.sha256);
    digests.push(frameDigest(await sharp(image.bytes).removeAlpha().raw().toBuffer()));
  }
  assert.equal(device.state().uploads, 0, 'real staging alone never plays');
  const mode = await coreHandle.dispatch({key: 'bunny.cmd.device-mode-set.pixoo', requestId: 'art-monitor', requestedBy: 'bunny/parts/operator',
    draft: {type: 'org.bunny.device-mode.set.requested', subject: 'pixoo', dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'monitor'}}});
  assert.deepEqual(mode, {status: 'accepted', requestId: 'art-monitor'});
  await waitFor(() => coreHandle.operation('art-monitor')?.result === 'succeeded');
  const moment = await coreHandle.dispatch({key: 'bunny.cmd.moment-play.pixoo', requestId: 'exact-art-play', requestedBy: 'bunny/core',
    draft: {type: 'org.bunny.moment.play.requested', subject: 'pixoo', dataschema: 'https://bunny.invalid/events/moment-play/2.1',
      data: {momentId: 'exact-art', mood: 'celebrate', durationMs: 1000, priorityClass: 'event', coversStatus: true,
        startAtMs: Date.now(), toleranceMs: 5000, art: {compositionId: composition.compositionId}}}});
  assert.deepEqual(moment, {status: 'accepted', requestId: 'exact-art-play'});
  await waitFor(() => device.state().shown?.frames === 8);
  assert.deepEqual(device.state().shown?.digests, digests);
  assert.deepEqual(device.state().shown?.delaysMs, manifest.frames.map(frame => frame.delayMs));
  await waitFor(() => coreHandle.operation('exact-art-play')?.result === 'succeeded');
  assert.equal(coreHandle.operation('exact-art-play')?.evidence, 'transmitted');
});
