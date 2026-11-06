// #1272: the real core and the real Nanoleaf module on a simulated Lines controller, with a remote fake Music producer.
// No device, network or capture is used, and this proves no physical cadence or appearance.
import assert from 'node:assert/strict';
import {chmod, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PRODUCER_SOURCE, type CaptureFeatures, type CaptureState, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture';
import type {LightingCapture, LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, SIMULATED_SECTION, SimulatedNanoleaf, SYNTHETIC_TOKEN, createNanoleafModule} from '@jimmie-potts/nanoleaf';
import {connectRemote, type Command} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {lightingWorkRequestId} from '../src/core/music-lighting.js';
import {CREDENTIALS_SCHEMA, tokenDigest} from '../src/credentials.js';
import {contextOf, edgeConfig, fixture, it, run, waitFor} from './support.js';

const schema = (family: string, version = '2.0') => `https://bunny.invalid/events/${family}/${version}`;
const PRODUCER_TOKEN = 'tok_SYNTHETIC1272_integration_producer';
const RECIPE = {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0};
const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });
type Outcome = {requestId: string; result: string; evidence: string; error?: {code: string}};

async function setup(t: TestContext) {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const outcomes: Message<Outcome>[] = [];
  const operator = fixture('lighting-operator', async ({sdk}) => {
    await sdk.subscribe<Outcome>('bunny.event.*.*', message => { if (message.kind === 'outcome') outcomes.push(message); });
  });
  const wall = new SimulatedNanoleaf();
  const secrets = await realpath(await mkdtemp(join(tmpdir(), 'bunny-lighting-')));
  await chmod(secrets, 0o700);
  t.after(() => rm(secrets, {recursive: true, force: true}));
  const tokenFile = join(secrets, 'nanoleaf-token');
  await writeFile(tokenFile, `${SYNTHETIC_TOKEN}\n`, {mode: 0o600});
  const files = await edgeConfig(t, [], {modules: {nanoleaf: {...SIMULATED_SECTION, secrets: {token: tokenFile}}}, credentials: JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [
    {id: 'music-producer', source: MUSIC_PRODUCER_SOURCE, digest: tokenDigest(PRODUCER_TOKEN), scopes: [], role: 'music-producer'},
  ]})});
  const {runtime} = await run(t, {modules: [core, createNanoleafModule({transport: wall.request}), operator], configFile: files.config, edge: {schemas: {}}});
  const producer = await connectRemote({url: runtime.url, source: MUSIC_PRODUCER_SOURCE, token: PRODUCER_TOKEN});
  const pumping = {stopped: false};
  t.after(async () => {pumping.stopped = true;await producer.close();});
  const captureWork: Command<CaptureWork>[] = [];
  const endpoint = await producer.openEndpoint<CaptureWork>({family: 'music-capture-work', respond: command => {captureWork.push(command);return {status: 'accepted'};}});
  const sdk = () => contextOf(operator).sdk;
  const states = async <T extends object>(family: string, owner: string): Promise<T[]> => {
    const result = await sdk().sync<T>([family], () => {}, {owner, timeoutMs: 2000});
    if (result.status !== 'synced') throw new Error(`sync ${family}`);
    const found = result.copy.states().map(message => message.data);await result.copy.close();return found;
  };
  const captureState = async () => {const [state] = await states<CaptureState>('music-capture-state', 'bunny/core');assert.ok(state);return state;};
  const light = async () => {const found = (await states<LightingState>('music-lighting-state', 'bunny/core')).find(record => record.id === 'wall');assert.ok(found);return found;};
  const lines = () => wall.state().devices[LINES_ADDRESS];
  const request = (key: string, draft: object, requestId: string) => sdk().request(key, draft as never, {timeoutMs: 5000, requestId});
  const outcome = (requestId: string) => outcomes.find(message => message.data.requestId === requestId);

  // The Lines answer with a saved layout, in Free, with a saved reactive preset.
  await waitFor(async () => {
    try {return (await states<{layout?: string}>(NANOLEAF_FAMILIES.wall.family, 'bunny/modules/nanoleaf'))[0]?.layout === 'saved';} catch {return false;}
  }, 15_000, 'the saved layout');
  assert.equal((await request('bunny.cmd.device-mode-set.wall', {type: 'org.bunny.device-mode.set.requested', subject: 'wall', dataschema: schema('device-mode-set'),
    data: {mode: 'free'}}, 'free-mode')).status, 'accepted');
  await waitFor(() => outcome('free-mode') !== undefined, 5000, 'the Free outcome');
  await waitFor(async () => {
    const [record] = await states<{mode?: string; modePending?: boolean}>(NANOLEAF_FAMILIES.wall.family, 'bunny/modules/nanoleaf');
    return record?.mode === 'free' && record.modePending === false && lines()?.select !== undefined;
  }, 8000, 'Free applied over a named scene');
  const preset = await request('bunny.cmd.nanoleaf-reactive-preset-save.reactive-presets', {type: 'org.bunny.nanoleaf-reactive-preset.save.requested', subject: 'reactive-presets',
    dataschema: schema('nanoleaf-reactive-preset-save'), data: {presetId: 'preset-green', expectedRevision: 0, name: 'Synthetic green', recipe: RECIPE}}, 'save-preset');
  assert.equal(preset.status, 'accepted');

  // An active Music capture session, kept fresh by the fake producer.
  assert.equal((await endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested', dataschema: schema('music-capture-endpoint'),
    data: {action: 'enable', input: 'music'}}, {requestId: 'enable-music', timeoutMs: 2000})).status, 'accepted');
  assert.deepEqual(await core.operatorActions.dispatch({key: 'bunny.cmd.music-capture-control.music', requestedBy: 'bunny/parts/operator', requestId: 'capture-start',
    draft: {type: 'org.bunny.music-capture.control.requested', subject: 'music', dataschema: schema('music-capture-control'),
      data: {action: 'start', expectedRevision: (await captureState()).revision, endpointId: endpoint.id, input: 'music'}}}), {status: 'accepted', requestId: 'capture-start'});
  await waitFor(() => captureWork.length === 1);
  const startCapture = captureWork[0];assert.ok(startCapture !== undefined);
  await endpoint.publish('music-capture-progress', {kind: 'occurrence', type: 'org.bunny.music-capture.progress.observed', dataschema: schema('music-capture-progress'),
    data: {operationId: startCapture.data.operationId, generation: startCapture.data.generation, status: 'started'}});
  void (async () => {
    for (let sequence = 1; !pumping.stopped; sequence += 1) {
      const at = Date.now();
      const data: CaptureFeatures = {generation: startCapture.data.generation, input: 'music', sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
        startMonotonicMs: (sequence - 1) * 100, endMonotonicMs: sequence * 100, emittedMonotonicMs: sequence * 100 + 1, observedAtMs: at, validUntilMs: at + 400,
        rms: 0.3 + (sequence % 5) / 10, peak: 1, clippedFraction: 0, bands: {bass: (sequence % 7) / 7, mid: 0.2, treble: 0.1}, onset: {strength: 0, confidence: 0}, discontinuity: false};
      await endpoint.publish('music-capture-features', {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed', dataschema: schema('music-capture-features'), data}).catch(() => {});
      await sleep(50);
    }
  })();
  await waitFor(async () => (await captureState()).session.status === 'active', 5000, 'active capture');
  const capture: LightingCapture = {endpointId: endpoint.id, generation: startCapture.data.generation};
  const control = async (requestId: string, data: object) => core.operatorActions.dispatch({key: 'bunny.cmd.music-lighting-control.wall', requestedBy: 'bunny/parts/operator', requestId,
    draft: {type: 'org.bunny.music-lighting.control.requested', subject: 'wall', dataschema: schema('music-lighting-control'), data: {expectedRevision: (await light()).revision, ...data}}});
  return {lines, light, request, outcome, operation: (id: string) => handle?.operation(id),
    start: (requestId: string) => control(requestId, {action: 'start', capture, presetId: 'preset-green'}),
    stop: (requestId: string) => control(requestId, {action: 'stop'}),
    status: (expected: string, what: string) => waitFor(async () => (await light()).session.status === expected, 8000, what),
    frames: () => (lines()?.recent ?? []).filter(write => write.animType === 'static')};
}

it('the real core and Nanoleaf module play Music frames, restore on Stop and end manual on a newer brightness change', async t => {
  const h = await setup(t);
  const base = {select: h.lines()?.select, brightness: h.lines()?.brightness};
  assert.ok(base.select !== undefined && base.brightness !== undefined);

  assert.deepEqual(await h.start('start-one'), {status: 'accepted', requestId: 'start-one'});
  await h.status('active', 'the first session playing');
  await waitFor(() => h.frames().length >= 3, 3000, 'rendered frames');
  assert.deepEqual(await h.stop('stop-one'), {status: 'accepted', requestId: 'stop-one'});
  await h.status('idle', 'the stopped session');
  const stopped = (await h.light()).last;
  assert.deepEqual([stopped?.reason, stopped?.restoration], ['stopped', 'restored']);
  assert.deepEqual({select: h.lines()?.select, brightness: h.lines()?.brightness}, base, 'Stop restores the Free base');
  const writes = h.lines()?.writes;
  await sleep(500);
  assert.equal(h.lines()?.writes, writes, 'nothing is written after the restoration');

  assert.deepEqual(await h.start('start-two'), {status: 'accepted', requestId: 'start-two'});
  await h.status('active', 'the second session playing');
  assert.equal((await h.request('bunny.cmd.brightness-set.wall', {type: 'org.bunny.brightness.set.requested', subject: 'wall', dataschema: schema('brightness-set'),
    data: {percent: 20}}, 'manual-brightness')).status, 'accepted');
  await h.status('idle', 'the manual ending');
  const manual = (await h.light()).last, endedAt = Date.now();
  assert.deepEqual([manual?.reason, manual?.restoration], ['manual', 'none']);
  await sleep(500);
  assert.equal((h.lines()?.recent ?? []).filter(write => write.atMs > endedAt && (write.animType === 'static' || write.select === base.select)).length, 0,
    'no frame or restoration follows the manual change');
  assert.equal(h.lines()?.brightness, 20);

  // Each operator command produced one work command and at most one outcome: nothing was resent.
  for (const id of ['start-one', 'stop-one', 'start-two']) {
    const work = lightingWorkRequestId(id, 'wall');
    assert.ok(h.operation(work), `work for ${id}`);
  }
}, 40_000);
