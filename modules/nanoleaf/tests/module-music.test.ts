// The live Music → Lines session through the hosted module (#1272, design D4): admission from the core only, the first
// frame through the work command's journaled write, paced rendering of the newest fresh feature, every ending and its
// restoration, and no replay after a restart. Synthetic features and the simulated controllers only.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {LightingDeviceState, LightingWork} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';
import type {Participant, RequestResult} from '@jimmie-potts/sdk';
import {LINES_ADDRESS, PANELS_ADDRESS, SYNTHETIC_TOKEN} from '../src/index.js';
import {deviceCommand, ModuleWorld, SECTION, type WorldOptions} from './module-support.js';
import {test} from './support.js';

const CAPTURE = {endpointId: 'music-mac', generation: '9df02246-518e-44f2-9412-a942735e63cd'};
const OTHER_CAPTURE = '2b1f6a0e-4c3d-4e5f-8a9b-0c1d2e3f4a5b';
const generation = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RECIPE = {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0};

type Session = {world: ModuleWorld; core: Participant; producer: Participant; sequence: number};
type Answer = {status: string; code?: string};

/** The last refusal's detail, which a test reads when the refusal must name what the light showed. */
let lastDetail: string | undefined;
async function ask(world: ModuleWorld, from: Participant, key: string, draft: Parameters<Participant['request']>[1], timeoutMs = 5000): Promise<Answer> {
  let answered: RequestResult | undefined;
  // The SDK sets the payload's `requestId`; a test names it through the request's options.
  const {requestId} = draft.data as {requestId?: unknown};
  void from.request(key, draft, {timeoutMs, ...(typeof requestId === 'string' ? {requestId} : {})}).then(value => { answered = value; });
  await world.until(() => answered !== undefined, timeoutMs + 100, `the answer to ${key}`);
  const result = answered as RequestResult;
  lastDetail = result.status === 'accepted' ? undefined : result.error.error.detail;
  return result.status === 'accepted' ? {status: 'accepted'} : {status: result.status, code: result.error.error.code};
}

function work(session: Pick<Session, 'world' | 'core'>, data: LightingWork, device = 'wall', from = session.core): Promise<Answer> {
  return ask(session.world, from, `bunny.cmd.music-lighting-work.${device}`, {type: 'org.bunny.music-lighting.work.requested', subject: device,
    dataschema: 'https://bunny.invalid/events/music-lighting-work/2.0', data});
}
const start = (session: Session, requestId: string, gen = generation(1), presetId = 'preset-green', device = 'wall'): Promise<Answer> =>
  work(session, {requestId, generation: gen, action: 'start', capture: CAPTURE, presetId}, device);
const stop = (session: Session, requestId: string, gen = generation(1), device = 'wall'): Promise<Answer> =>
  work(session, {requestId, generation: gen, action: 'stop'}, device);

type MusicFeatures = Extract<CaptureFeatures, {input: 'music'}>;
function frame(session: Session, patch: Partial<MusicFeatures> = {}): MusicFeatures {
  session.sequence += 1;
  const n = session.sequence, now = session.world.clock.now();
  return {generation: CAPTURE.generation, input: 'music', sequence: n, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: 900000 + n * 100, endMonotonicMs: 900100 + n * 100, emittedMonotonicMs: 900102 + n * 100,
    observedAtMs: now, validUntilMs: now + 400, rms: 0.5, peak: 1, clippedFraction: 0,
    bands: {bass: 0.4, mid: 0.2, treble: 0.1}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...patch};
}
const publish = (session: Session, data: CaptureFeatures, endpoint = CAPTURE.endpointId): Promise<unknown> =>
  session.producer.publish(`bunny.event.music-capture-features.${endpoint}`, {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed',
    subject: endpoint, dataschema: 'https://bunny.invalid/events/music-capture-features/2.0', data});

/** Feeds one fresh feature every `everyMs` for `ms` of virtual time. */
async function play(session: Session, ms: number, everyMs = 100, patch: Partial<MusicFeatures> = {}): Promise<void> {
  for (let passed = 0; passed < ms; passed += everyMs) {
    await publish(session, frame(session, patch));
    await session.world.advance(everyMs);
  }
}

const deviceState = (world: ModuleWorld, device = 'wall'): LightingDeviceState | undefined =>
  world.state<LightingDeviceState>('music-lighting-device', device);
const lines = (world: ModuleWorld) => world.device.state().devices[LINES_ADDRESS];
/** Frame datagrams the session sent since `sinceMs` (#1598): the light applies them only while streaming. */
const frames = (world: ModuleWorld, sinceMs: number) => (lines(world)?.streams ?? []).filter(entry => entry.atMs >= sinceMs);

async function mode(world: ModuleWorld, value: 'work' | 'quiet' | 'free', device = 'wall'): Promise<void> {
  const command = deviceCommand('device-mode-set', {requestId: `${device}-${value}-${world.clock.now()}`, mode: value}, device);
  assert.equal((await world.request(command.key, command.draft)).status, 'accepted');
  await world.advance(2000);
}

async function savePreset(world: ModuleWorld, presetId = 'preset-green'): Promise<void> {
  const answer = await world.request('bunny.cmd.nanoleaf-reactive-preset-save.reactive-presets', {
    type: 'org.bunny.nanoleaf-reactive-preset.save.requested', subject: 'reactive-presets',
    dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-preset-save/2.0',
    data: {requestId: `save-${presetId}`, presetId, expectedRevision: 0, name: 'Synthetic green', recipe: RECIPE},
  });
  assert.equal(answer.status, 'accepted');
}

async function lightsInFree(context: TestContext, options: WorldOptions & {free?: boolean} = {}): Promise<Session> {
  const world = await ModuleWorld.open(context, options);
  await world.start();
  await world.until(() => world.device_()?.availability === 'available' && world.wall()?.layout === 'saved', 10000, 'the Lines answer');
  if (options.free !== false) await mode(world, 'free');
  await savePreset(world);
  await world.advance(100);
  return {world, core: world.bus.connect('bunny/core'), producer: world.bus.connect('bunny/parts/music-producer'), sequence: 0};
}

async function playing(context: TestContext, options: WorldOptions = {}): Promise<Session & {since: number}> {
  const session = await lightsInFree(context, options);
  const since = session.world.clock.now();
  assert.deepEqual(await start(session, 'start-1'), {status: 'accepted'});
  await play(session, 300);
  await session.world.until(() => deviceState(session.world)?.session?.status === 'playing', 2000, 'playing');
  return {...session, since};
}

const outcome = (world: ModuleWorld, id: string) => world.outcomes(id)[0]?.data;
const ended = (world: ModuleWorld) => {
  const session = deviceState(world)?.session;
  return session?.status === 'ended' ? session.ended : undefined;
};

test('only the core may start a session, and a refused Start writes nothing and changes no mode', async context => {
  const session = await lightsInFree(context, {free: false});
  const {world} = session;
  const operator = world.operator;
  const forbidden = await work(session, {requestId: 'not-core', generation: generation(1), action: 'start', capture: CAPTURE, presetId: 'preset-green'}, 'wall', operator);
  assert.deepEqual(forbidden, {status: 'rejected', code: 'forbidden'});
  for (const value of ['work', 'quiet'] as const) {
    if (value === 'quiet') await mode(world, 'quiet');
    const before = {writes: lines(world)?.writes, brightness: lines(world)?.brightness, mode: world.wall()?.mode};
    assert.deepEqual(await start(session, `in-${value}`), {status: 'rejected', code: 'invalid-state'});
    await world.advance(1000);
    assert.deepEqual({writes: lines(world)?.writes, brightness: lines(world)?.brightness, mode: world.wall()?.mode}, before, `${value} stays as it was`);
  }
  assert.equal(deviceState(world)?.session, null);
  world.verify();
});

test('a Free light refuses a missing preset and an unknown session stop', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  const before = lines(world)?.writes;
  assert.deepEqual(await start(session, 'missing', generation(1), 'preset-absent'), {status: 'rejected', code: 'not-found'});
  assert.deepEqual(await stop(session, 'stop-nothing'), {status: 'rejected', code: 'invalid-state'});
  assert.equal(lines(world)?.writes, before);
  world.verify();
});

// #1614: a Start over whatever the Lines show. A saved scene and a plain colour are put back; anything else is left on
// the last frame, reported `none`, and no scene is guessed.
const LIGHT = {ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN};
/** Plays for a while, then Stops, and returns once the session ended. */
async function playThenStop(session: Session, requestId: string, gen = generation(1)): Promise<void> {
  await play(session, 300);
  await session.world.until(() => deviceState(session.world)?.session?.status === 'playing', 2000, 'playing');
  await play(session, 500);
  assert.deepEqual(await stop(session, requestId, gen), {status: 'accepted'});
  await play(session, 300);
  await session.world.until(() => session.world.outcomes(requestId).length === 1, 2000, 'the stop outcome');
}

test('a Start over a plain colour plays, and Stop puts the colour back', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  await world.device.request(LIGHT, 'PUT', '/state', {hue: {value: 200}, sat: {value: 60}});
  assert.equal(lines(world)?.select, '*Solid*');
  assert.deepEqual(await start(session, 'over-colour'), {status: 'accepted'});
  await playThenStop(session, 'stop-colour');
  assert.deepEqual(outcome(world, 'over-colour'), {requestId: 'over-colour', result: 'succeeded', evidence: 'transmitted'});
  assert.deepEqual(outcome(world, 'stop-colour'), {requestId: 'stop-colour', result: 'succeeded', evidence: 'transmitted'});
  assert.deepEqual({reason: ended(world)?.reason, restoration: ended(world)?.restoration}, {reason: 'stopped', restoration: 'restored'});
  const light = lines(world);
  assert.deepEqual({select: light?.select, hue: light?.hue, sat: light?.sat, colorMode: light?.colorMode, brightness: light?.brightness},
    {select: '*Solid*', hue: 200, sat: 60, colorMode: 'hs', brightness: 50});
  assert.equal(world.wall()?.musicBase?.restores, 'color');
  world.verify();
});

test('a Start over a colour temperature plays, and an alert puts it back', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  await world.device.request(LIGHT, 'PUT', '/state', {ct: {value: 2700}});
  assert.deepEqual(await start(session, 'over-warm'), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => deviceState(world)?.session?.status === 'playing', 2000, 'playing');
  await world.core.set('alpha', {attention: [{kind: 'approval', id: {status: 'known', id: 'approval-1'}, turn: {status: 'known', id: 't1'}}]});
  await play(session, 500);
  await world.until(() => ended(world) !== undefined, 2000, 'the alert ending');
  assert.deepEqual({reason: ended(world)?.reason, restoration: ended(world)?.restoration}, {reason: 'alert', restoration: 'restored'});
  assert.deepEqual({select: lines(world)?.select, ct: lines(world)?.ct, colorMode: lines(world)?.colorMode}, {select: '*Solid*', ct: 2700, colorMode: 'ct'});
  world.verify();
});

for (const shown of ['effect', 'earlier frames'] as const) {
  test(`a Start over ${shown === 'effect' ? 'an unsaved effect' : 'the frames an earlier session left'} plays, and Stop leaves the last frame with restoration none`, async context => {
    const session = await lightsInFree(context);
    const {world} = session;
    if (shown === 'effect') {
      await world.device.request(LIGHT, 'PUT', '/effects', {write: {command: 'display', animType: 'custom', animData: '1 1 1 1 1 1 0 1'}});
    } else {
      // An earlier session ended without restoring, as a module restart ends one: the light still streams its last frame.
      assert.deepEqual(await start(session, 'earlier'), {status: 'accepted'});
      await play(session, 300);
      await world.until(() => deviceState(world)?.session?.status === 'playing', 2000, 'playing');
      await world.stopModule();
      await world.restart();
      await world.advance(3000);
      assert.equal(ended(world)?.reason, 'restart');
    }
    const shownAs = lines(world)?.select;
    assert.ok(shownAs === '*Dynamic*' || shownAs === '*ExtControl*', shownAs);
    const gen = shown === 'effect' ? generation(1) : generation(2);
    assert.deepEqual(await start(session, 'over-unnamed', gen), {status: 'accepted'});
    const startedAt = world.clock.now();
    await playThenStop(session, 'stop-unnamed', gen);
    assert.deepEqual(outcome(world, 'over-unnamed'), {requestId: 'over-unnamed', result: 'succeeded', evidence: 'transmitted'});
    assert.deepEqual(outcome(world, 'stop-unnamed'), {requestId: 'stop-unnamed', result: 'succeeded', evidence: 'observed'});
    assert.deepEqual({reason: ended(world)?.reason, restoration: ended(world)?.restoration}, {reason: 'stopped', restoration: 'none'});
    assert.equal(lines(world)?.select, '*ExtControl*', 'the light keeps the last frame');
    assert.equal(world.writes().filter(write => write.atMs >= startedAt && (write.select !== undefined || write.brightness !== undefined)).length, 0,
      'nothing is restored and no scene is guessed');
    assert.deepEqual(world.wall()?.musicBase, {generation: gen, restores: 'nothing'});
    if (shown === 'effect') world.verify();
    else world.verifyMessages();
  });
}

test('the wall record shows the last read selection, whether it is saved and when, and a refused Start names it', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  assert.equal(world.wall()?.selection, null, 'nothing is read before a Start');
  // A Start over the saved scene, then a playing check that finds the streaming selection.
  assert.deepEqual(await start(session, 'over-scene'), {status: 'accepted'});
  const readAt = world.clock.now();
  await play(session, 300);
  await world.until(() => deviceState(world)?.session?.status === 'playing', 2000, 'playing');
  await play(session, 1500);
  assert.deepEqual(await stop(session, 'stop-scene'), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => world.outcomes('stop-scene').length === 1, 2000, 'the stop outcome');
  const scenes = world.device_()?.capabilities.scenes;
  const sceneId = scenes?.supported === true ? scenes.sceneIds[0] : undefined;
  assert.ok(sceneId !== undefined);
  await world.advance(100);
  const selection = world.wall()?.selection;
  assert.ok(selection !== undefined && selection !== null);
  // The playing check kept the streaming selection once a session played; the Start kept the scene.
  assert.deepEqual({saved: selection.saved, placeholder: selection.placeholder, restores: selection.restores}, {saved: false, placeholder: '*ExtControl*', restores: 'nothing'});
  assert.ok(selection.readAtMs >= readAt && selection.readAtMs <= world.clock.now());
  assert.ok(JSON.stringify(world.wall()).includes('Beach Waves') === false, 'no scene name is published');
  // A light that is off refuses, naming what it showed.
  await world.device.request(LIGHT, 'PUT', '/state', {hue: {value: 10}, sat: {value: 90}});
  world.device.setPower(LINES_ADDRESS, false);
  const before = lines(world)?.writes;
  assert.deepEqual(await start(session, 'off-colour', generation(2)), {status: 'rejected', code: 'invalid-state'});
  assert.equal(lastDetail, 'live Music starts only on a light that is on; the light is off, showing *Solid*');
  assert.equal(lines(world)?.writes, before, 'a refused Start writes nothing');
  await world.advance(100);
  assert.deepEqual(world.wall()?.selection, {saved: false, sceneId: null, placeholder: '*Solid*', restores: 'color', readAtMs: world.wall()?.selection?.readAtMs});
  // A saved scene shows as its opaque ID.
  world.device.setPower(LINES_ADDRESS, true);
  world.device.chooseScene(LINES_ADDRESS, 'Beach Waves');
  world.device.setPower(LINES_ADDRESS, false);
  assert.deepEqual(await start(session, 'off-scene', generation(3)), {status: 'rejected', code: 'invalid-state'});
  assert.equal(lastDetail, `live Music starts only on a light that is on; the light is off, showing saved scene ${sceneId}`);
  await world.advance(100);
  assert.deepEqual(world.wall()?.selection, {saved: true, sceneId, placeholder: null, restores: 'scene', readAtMs: world.wall()?.selection?.readAtMs});
  world.verify();
});

test('a held light refuses a Start as unavailable', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  world.device.loseNextAnswer('/state');
  const brightness = deviceCommand('brightness-set', {requestId: 'lost-brightness', percent: 30});
  assert.equal((await world.request(brightness.key, brightness.draft)).status, 'accepted');
  await world.until(() => world.device_()?.held?.requestId === 'lost-brightness', 15000, 'the hold');
  const before = lines(world)?.writes;
  assert.deepEqual(await start(session, 'held-start'), {status: 'rejected', code: 'unavailable'});
  assert.equal(lines(world)?.writes, before);
  world.verifyMessages();
});

// #1272: the NL22 Light Panels take live sessions through their own version 1 stream, as an independent target beside
// the Lines: each light has its own session, worker, journal and writes, and one light's ending never touches the other.
const WITH_PANELS: WorldOptions = {
  section: {...SECTION, devices: [...SECTION.devices, {id: 'nl22', kind: 'panels', address: PANELS_ADDRESS, secret: 'token'}]},
  devices: {[LINES_ADDRESS]: 'lines', [PANELS_ADDRESS]: 'panels'},
};
const panelsOf = (world: ModuleWorld) => world.device.state().devices[PANELS_ADDRESS];
async function bothInFree(context: TestContext): Promise<Session> {
  const session = await lightsInFree(context, WITH_PANELS);
  const {world} = session;
  await world.until(() => world.state<{layout?: string}>('nanoleaf-wall', 'nl22')?.layout === 'saved', 10000, 'the Panels answer');
  await mode(world, 'free', 'nl22');
  return session;
}

test('an NL22 session streams version 1 to the Panels only, and a Lines session beside it stays independent', async context => {
  const session = await bothInFree(context);
  const {world} = session;
  const linesBefore = {writes: lines(world)?.writes, streamed: lines(world)?.streamed, ignored: lines(world)?.ignored};
  assert.deepEqual(await start(session, 'panels-start', generation(1), 'preset-green', 'nl22'), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => deviceState(world, 'nl22')?.session?.status === 'playing', 2000, 'the Panels playing');
  await play(session, 1000);
  assert.deepEqual(outcome(world, 'panels-start'), {requestId: 'panels-start', result: 'succeeded', evidence: 'transmitted'});
  const panels = panelsOf(world);
  assert.deepEqual({select: panels?.select, streaming: panels?.streaming}, {select: '*ExtControl*', streaming: {version: 'v1', port: 60221}});
  assert.ok((panels?.streamed ?? 0) >= 5 && panels?.ignored === 0, `${panels?.streamed} applied, ${panels?.ignored} ignored`);
  assert.deepEqual(Object.keys(panels?.frame ?? {}).sort(), ['200', '201', '202', '203'], 'every triangle by its panel ID');
  assert.equal(panels?.tooSoon, 0, 'no datagram less than 100 ms after the last, on the module\'s clock');
  assert.deepEqual({writes: lines(world)?.writes, streamed: lines(world)?.streamed, ignored: lines(world)?.ignored}, linesBefore, 'the Lines are untouched');
  assert.equal(deviceState(world)?.session, null);

  // A Lines session beside it: each light streams its own version, and the Lines' manual takeover ends only its own.
  assert.deepEqual(await start(session, 'lines-start', generation(2)), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => deviceState(world)?.session?.status === 'playing', 2000, 'the Lines playing');
  assert.equal(lines(world)?.streaming?.version, 'v2');
  world.device.chooseScene(LINES_ADDRESS, 'Northern Lights');
  const pickedAt = world.clock.now();
  await play(session, 1500);
  assert.deepEqual({reason: ended(world)?.reason, restoration: ended(world)?.restoration}, {reason: 'manual', restoration: 'none'});
  assert.equal(lines(world)?.select, 'Northern Lights', 'the app\'s scene stays');
  assert.equal(world.writes().filter(write => write.atMs > pickedAt).length, 0, 'nothing is written over the newer manual choice');
  assert.equal(lines(world)?.streams.filter(entry => entry.applied && entry.atMs > pickedAt).length, 0);
  assert.equal(deviceState(world, 'nl22')?.session?.status, 'playing', 'the Panels play on');

  // Stopping the Panels restores their own scene and writes nothing to the Lines.
  const linesWrites = lines(world)?.writes;
  assert.deepEqual(await stop(session, 'panels-stop', generation(1), 'nl22'), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => world.outcomes('panels-stop').length === 1, 2000, 'the Panels stop outcome');
  assert.deepEqual(outcome(world, 'panels-stop'), {requestId: 'panels-stop', result: 'succeeded', evidence: 'transmitted'});
  const endedPanels = deviceState(world, 'nl22')?.session;
  assert.ok(endedPanels?.status === 'ended');
  assert.deepEqual({reason: endedPanels.ended.reason, restoration: endedPanels.ended.restoration}, {reason: 'stopped', restoration: 'restored'});
  assert.deepEqual({select: panelsOf(world)?.select, brightness: panelsOf(world)?.brightness}, {select: 'Beach Waves', brightness: 50});
  assert.equal(lines(world)?.writes, linesWrites, 'no Panels write reached the Lines');
  assert.equal(lines(world)?.select, 'Northern Lights');
  world.verify();
});

test('the NL22 refuses a Start outside Free and the Lines\' own Start is unaffected', async context => {
  const session = await bothInFree(context);
  const {world} = session;
  await mode(world, 'work', 'nl22');
  const before = panelsOf(world)?.writes;
  assert.deepEqual(await start(session, 'panels-work', generation(1), 'preset-green', 'nl22'), {status: 'rejected', code: 'invalid-state'});
  assert.equal(panelsOf(world)?.writes, before, 'a refused Start writes nothing');
  assert.equal(deviceState(world, 'nl22')?.session, null);
  assert.deepEqual(await start(session, 'lines-free', generation(2)), {status: 'accepted'});
  await play(session, 500);
  await world.until(() => deviceState(world)?.session?.status === 'playing', 2000, 'the Lines playing');
  assert.equal(panelsOf(world)?.streamed, 0);
  world.verify();
});

test('an alert ends both lights\' sessions, and each puts back its own scene', async context => {
  const session = await bothInFree(context);
  const {world} = session;
  assert.deepEqual(await start(session, 'panels-start', generation(1), 'preset-green', 'nl22'), {status: 'accepted'});
  assert.deepEqual(await start(session, 'lines-start', generation(2)), {status: 'accepted'});
  await play(session, 500);
  await world.until(() => deviceState(world)?.session?.status === 'playing' && deviceState(world, 'nl22')?.session?.status === 'playing', 2000, 'both playing');
  await world.core.set('alpha', {attention: [{kind: 'approval', id: {status: 'known', id: 'approval-1'}, turn: {status: 'known', id: 't1'}}]});
  await play(session, 1000);
  await world.until(() => ended(world) !== undefined && deviceState(world, 'nl22')?.session?.status === 'ended', 3000, 'both endings');
  for (const device of ['wall', 'nl22']) {
    const record = deviceState(world, device)?.session;
    assert.ok(record?.status === 'ended');
    assert.deepEqual({reason: record.ended.reason, restoration: record.ended.restoration}, {reason: 'alert', restoration: 'restored'}, device);
  }
  assert.deepEqual([lines(world)?.select, panelsOf(world)?.select], ['Beach Waves', 'Beach Waves']);
  world.verify();
});

test('the first frame completes Start as transmitted and Stop restores the named base', async context => {
  const session = await playing(context);
  const {world} = session;
  assert.deepEqual(outcome(world, 'start-1'), {requestId: 'start-1', result: 'succeeded', evidence: 'transmitted'});
  assert.equal(world.outcomes('start-1')[0]?.type, 'org.bunny.music-lighting.work.completed');
  assert.equal(lines(world)?.select, '*ExtControl*');
  assert.ok(frames(world, session.since).length >= 1 && frames(world, session.since).every(entry => entry.applied));
  assert.deepEqual(world.writes().filter(write => write.atMs >= session.since && write.animType !== undefined).map(write => write.animType), ['extControl'],
    'one streaming entry and no display frame');
  assert.deepEqual(await stop(session, 'stop-1'), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => world.outcomes('stop-1').length === 1, 2000, 'the stop outcome');
  assert.deepEqual(outcome(world, 'stop-1'), {requestId: 'stop-1', result: 'succeeded', evidence: 'transmitted'});
  assert.equal(lines(world)?.select, 'Beach Waves');
  assert.equal(lines(world)?.brightness, 50);
  assert.deepEqual(ended(world), {generation: generation(1), reason: 'stopped', restoration: 'restored', atMs: ended(world)?.atMs});
  const after = {writes: lines(world)?.writes, streamed: lines(world)?.streamed, ignored: lines(world)?.ignored};
  await play(session, 1000);
  assert.deepEqual({writes: lines(world)?.writes, streamed: lines(world)?.streamed, ignored: lines(world)?.ignored}, after, 'nothing renders after the session ended');
  assert.deepEqual(await stop(session, 'stop-again'), {status: 'rejected', code: 'invalid-state'});
  world.verify();
});

test('no fresh feature within two seconds ends the Start as source lost without a write', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  const before = lines(world)?.writes;
  assert.deepEqual(await start(session, 'silent-source'), {status: 'accepted'});
  assert.equal(deviceState(world)?.session?.status, 'starting');
  await world.until(() => world.outcomes('silent-source').length === 1, 3000, 'the failed start');
  assert.equal(outcome(world, 'silent-source')?.result, 'failed');
  assert.equal(world.outcomes('silent-source')[0]?.data.error?.code, 'unavailable');
  await world.until(() => ended(world) !== undefined, 100, 'the published ending');
  assert.equal(ended(world)?.reason, 'source-lost');
  assert.equal(ended(world)?.restoration, 'none');
  assert.equal(lines(world)?.writes, before);
  world.verify();
});

test('50 Hz features give at most ten writes a second from the newest sample, and duplicates write nothing', async context => {
  const session = await playing(context);
  const {world} = session;
  const from = world.clock.now();
  await play(session, 2000, 20);
  const written = frames(world, from);
  assert.ok(written.length >= 15 && written.length <= 21, `${written.length} paced writes`);
  for (let index = 1; index < written.length; index += 1) {
    assert.ok((written[index]?.atMs ?? 0) - (written[index - 1]?.atMs ?? 0) >= 100, 'at least 100 ms between writes');
  }
  // A repeated sequence renews nothing: nothing is written for it, and the input lapses.
  const last = session.sequence;
  // The newest real sample's paced frame goes out first; only what follows the repeats counts.
  await world.advance(100);
  const repeat = world.clock.now();
  for (let index = 0; index < 3; index += 1) {
    await publish(session, {...frame(session), sequence: last});
    await world.advance(100);
  }
  assert.equal(frames(world, repeat + 1).length, 0, 'duplicates add no frames');
  world.verify();
});

test('another capture generation is rejected and silence keeps playing', async context => {
  const session = await playing(context);
  const {world} = session;
  await play(session, 1000, 100, {rms: 0, peak: 0, bands: {bass: 0, mid: 0, treble: 0}});
  assert.equal(deviceState(world)?.session?.status, 'playing', 'silent valid frames keep the session');
  const from = world.clock.now();
  for (let index = 0; index < 8; index += 1) {
    await publish(session, frame(session, {generation: OTHER_CAPTURE}));
    await world.advance(100);
  }
  assert.equal(frames(world, from + 1).length, 0, 'old-generation features render nothing');
  await world.until(() => ended(world) !== undefined, 1000, 'source loss');
  assert.equal(ended(world)?.reason, 'source-lost');
  assert.equal(ended(world)?.restoration, 'restored');
  assert.equal(lines(world)?.select, 'Beach Waves');
  world.verify();
});

for (const change of ['scene', 'brightness', 'power', 'mode'] as const) {
  test(`a newer ${change} command ends the session as manual with no write after it`, async context => {
    const session = await playing(context);
    const {world} = session;
    const scene = world.device_()?.capabilities.scenes;
    const sceneId = scene?.supported === true ? scene.sceneIds[1] : undefined;
    const command = change === 'scene' ? deviceCommand('scene-activate', {requestId: 'manual', sceneId})
      : change === 'brightness' ? deviceCommand('brightness-set', {requestId: 'manual', percent: 20})
        : change === 'power' ? deviceCommand('power-set', {requestId: 'manual', on: false})
          : deviceCommand('device-mode-set', {requestId: 'manual', mode: 'work'});
    assert.equal((await world.request(command.key, command.draft)).status, 'accepted');
    const taken = world.clock.now();
    await play(session, 1500);
    assert.equal(ended(world)?.reason, 'manual');
    assert.equal(ended(world)?.restoration, 'none');
    assert.equal(frames(world, taken + 1).length, 0, 'no music frame after the newer command');
    // Work presents its own remembered scene around the indicators; that is the mode's paint, not a restoration.
    if (change !== 'mode') assert.equal(world.writes().filter(write => write.atMs > taken && write.select === 'Beach Waves').length, 0, 'no base restoration');
    if (change !== 'mode') assert.equal(outcome(world, 'manual')?.result, 'succeeded');
    world.verify();
  });
}

test('a scene chosen in the app leaves streaming and ends the session as manual, and a later Stop restores nothing', async context => {
  const session = await playing(context);
  const {world} = session;
  await world.device.request({ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN}, 'PUT', '/effects', {select: 'Northern Lights'});
  const changed = world.clock.now();
  await play(session, 1500);
  assert.equal(ended(world)?.reason, 'manual');
  assert.equal(ended(world)?.restoration, 'none');
  // Datagrams sent before the next once-per-second check reach a light that is no longer streaming, which ignores them.
  assert.equal(frames(world, changed).filter(entry => entry.applied).length, 0, 'no music frame paints over the app\'s choice');
  assert.ok(frames(world, changed).length <= 11, 'the next check ends the session');
  assert.deepEqual(await stop(session, 'stop-after-manual'), {status: 'rejected', code: 'invalid-state'});
  await play(session, 500);
  assert.equal(lines(world)?.select, 'Northern Lights');
  assert.equal(world.writes().filter(write => write.atMs > changed && (write.select !== undefined || write.brightness !== undefined)).length, 0, 'nothing restores the old base');
  world.verify();
});

test('a Start is refused while the hub power override or the light itself is off', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  world.device.setPower(LINES_ADDRESS, false);
  assert.deepEqual(await start(session, 'device-off'), {status: 'rejected', code: 'invalid-state'});
  world.device.setPower(LINES_ADDRESS, true);
  const off = deviceCommand('power-set', {requestId: 'hub-off', on: false});
  assert.equal((await world.request(off.key, off.draft)).status, 'accepted');
  await world.until(() => world.outcomes('hub-off').length === 1, 5000, 'the power command');
  // The light answers on again, as after the app turned it on: the hub's own choice is still off.
  world.device.setPower(LINES_ADDRESS, true);
  const before = lines(world)?.writes;
  assert.deepEqual(await start(session, 'override-off', generation(2)), {status: 'rejected', code: 'invalid-state'});
  assert.equal(lines(world)?.writes, before);
  assert.equal(deviceState(world)?.session, null);
  world.verify();
});

test('a scene chosen and shown during the Start\'s base read refuses the Start', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  const scene = world.device_()?.capabilities.scenes;
  const sceneId = scene?.supported === true ? scene.sceneIds[1] : undefined;
  world.device.hold();
  let answer: Answer | undefined;
  void start(session, 'raced-start').then(value => { answer = value; });
  await world.until(() => world.device.state().held === 1, 1000, 'the held base read');
  const choice = deviceCommand('scene-activate', {requestId: 'raced-scene', sceneId});
  let admitted: string | undefined;
  void world.operator.request(choice.key, choice.draft, {timeoutMs: 5000, requestId: 'raced-scene'}).then(value => { admitted = value.status; });
  await world.until(() => admitted !== undefined && world.device.state().held === 2, 3000, 'the scene write behind the read');
  world.device.release();
  await world.until(() => answer !== undefined, 3000, 'the Start answer');
  assert.deepEqual(answer, {status: 'rejected', code: 'revision-conflict'});
  assert.equal(lines(world)?.select, 'Northern Lights');
  assert.equal(deviceState(world)?.session, null);
  world.verify();
});

test('a Stop that waits while the light is slow to answer the playing check still ends the session', async context => {
  const session = await playing(context);
  const {world} = session;
  world.device.hold();
  await play(session, 1200);
  assert.equal(world.device.state().held, 1, 'the once-per-second check waits for its answer');
  let answered: RequestResult | undefined;
  void session.core.request('bunny.cmd.music-lighting-work.wall', {type: 'org.bunny.music-lighting.work.requested', subject: 'wall',
    dataschema: 'https://bunny.invalid/events/music-lighting-work/2.0', data: {requestId: 'slow-stop', generation: generation(1), action: 'stop'}},
  {timeoutMs: 300, requestId: 'slow-stop'}).then(value => { answered = value; });
  await world.until(() => answered !== undefined, 1000, 'the Stop answer');
  assert.equal(answered?.status, 'accepted');
  // Past the Stop's expiry and the expiry sweep after it, and still within the light's request deadline.
  await world.advance(400);
  assert.equal(world.outcomes('slow-stop').length, 0, 'the sweep leaves the Stop for the session\'s loop');
  world.device.release();
  await play(session, 600);
  await world.until(() => world.outcomes('slow-stop').length === 1, 2000, 'the Stop outcome');
  assert.equal(outcome(world, 'slow-stop')?.result, 'succeeded');
  assert.equal(ended(world)?.reason, 'stopped');
  assert.equal(lines(world)?.select, 'Beach Waves');
  world.verifyMessages();
});

test('a second Stop for a session still playing is accepted and both complete', async context => {
  const session = await playing(context);
  const {world} = session;
  world.device.hold();
  await play(session, 200);
  assert.deepEqual(await stop(session, 'stop-a'), {status: 'accepted'});
  assert.deepEqual(await stop(session, 'stop-b'), {status: 'accepted'});
  world.device.release();
  await play(session, 600);
  await world.until(() => world.outcomes('stop-a').length === 1 && world.outcomes('stop-b').length === 1, 2000, 'both outcomes');
  assert.equal(outcome(world, 'stop-a')?.result, 'succeeded');
  assert.equal(outcome(world, 'stop-b')?.result, 'succeeded');
  assert.deepEqual({reason: ended(world)?.reason, restoration: ended(world)?.restoration}, {reason: 'stopped', restoration: 'restored'});
  world.verifyMessages();
});

test('an external brightness or power change ends the session as manual without restoration', async context => {
  for (const change of ['brightness', 'power'] as const) {
    const session = await playing(context);
    const {world} = session;
    await world.device.request({ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN}, 'PUT', '/state',
      change === 'brightness' ? {brightness: {value: 23, duration: 0}} : {on: {value: false}});
    const changed = world.clock.now();
    await play(session, 1500);
    assert.equal(ended(world)?.reason, 'manual', change);
    assert.equal(ended(world)?.restoration, 'none');
    assert.equal(frames(world, changed + 1100).length, 0, 'no frame after the read found the change');
    assert.equal(world.writes().filter(write => write.atMs > changed && (write.select !== undefined || write.brightness !== undefined)).length, 0);
    world.verify();
  }
});

test('an alert ends the session and restores the base', async context => {
  const session = await playing(context);
  const {world} = session;
  await world.core.set('alpha', {attention: [{kind: 'approval', id: {status: 'known', id: 'approval-1'}, turn: {status: 'known', id: 't1'}}]});
  await play(session, 1000);
  await world.until(() => ended(world) !== undefined, 2000, 'the alert ending');
  assert.equal(ended(world)?.reason, 'alert');
  assert.equal(ended(world)?.restoration, 'restored');
  assert.equal(lines(world)?.select, 'Beach Waves');
  world.verify();
});

test('repeated missed capture windows keep the session playing, and only expired input ends it as source lost', async context => {
  const session = await playing(context);
  const {world} = session;
  await play(session, 500);
  // The installed trial's failure (#1588): one window never arrives and the next carries the native discontinuity marker.
  session.sequence += 1;
  await publish(session, frame(session, {discontinuity: true}));
  await world.advance(100);
  const after = world.clock.now();
  await play(session, 500);
  // It keeps happening, as on real capture: two more missed windows, each followed by a marked window.
  for (let gap = 0; gap < 2; gap += 1) {
    session.sequence += 1;
    await publish(session, frame(session, {discontinuity: true}));
    await world.advance(100);
    await play(session, 300);
  }
  assert.equal(deviceState(world)?.session?.status, 'playing', 'missed windows are not source loss');
  assert.ok(frames(world, after).length >= 5, 'frames keep painting after the missed window');
  // With no fresh feature at all, the input expires and the session ends with the guarded restoration.
  await world.advance(1500);
  assert.equal(ended(world)?.reason, 'source-lost');
  assert.equal(ended(world)?.restoration, 'restored');
  assert.equal(lines(world)?.select, 'Beach Waves');
  world.verify();
});
test('a feature overflow retires the input as source lost', async context => {
  const session = await playing(context, {maxQueued: 2});
  const {world} = session;
  await Promise.all(Array.from({length: 12}, () => publish(session, frame(session))));
  await world.advance(600);
  assert.equal(ended(world)?.reason, 'source-lost');
  world.verifyMessages();
});

test('a module restart ends a playing session without a write or replay', async context => {
  const session = await playing(context);
  const {world} = session;
  await world.stopModule();
  const before = lines(world)?.writes;
  await world.restart();
  await world.advance(3000);
  assert.deepEqual({reason: ended(world)?.reason, restoration: ended(world)?.restoration}, {reason: 'restart', restoration: 'none'});
  assert.equal(lines(world)?.writes, before, 'no device write and no replay');
  world.verifyMessages();
});

test('the session keeps one request in flight to the light', async context => {
  const session = await playing(context);
  const {world} = session;
  world.device.hold();
  await play(session, 1000, 20);
  assert.equal(world.device.state().held, 1, 'one request waits; nothing overlaps it');
  world.device.release();
  await world.advance(500);
  world.verifyMessages();
});
