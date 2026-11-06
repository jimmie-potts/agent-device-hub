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

async function ask(world: ModuleWorld, from: Participant, key: string, draft: Parameters<Participant['request']>[1], timeoutMs = 5000): Promise<Answer> {
  let answered: RequestResult | undefined;
  // The SDK sets the payload's `requestId`; a test names it through the request's options.
  const {requestId} = draft.data as {requestId?: unknown};
  void from.request(key, draft, {timeoutMs, ...(typeof requestId === 'string' ? {requestId} : {})}).then(value => { answered = value; });
  await world.until(() => answered !== undefined, timeoutMs + 100, `the answer to ${key}`);
  const result = answered as RequestResult;
  return result.status === 'accepted' ? {status: 'accepted'} : {status: result.status, code: result.error.error.code};
}

function work(session: Pick<Session, 'world' | 'core'>, data: LightingWork, device = 'wall', from = session.core): Promise<Answer> {
  return ask(session.world, from, `bunny.cmd.music-lighting-work.${device}`, {type: 'org.bunny.music-lighting.work.requested', subject: device,
    dataschema: 'https://bunny.invalid/events/music-lighting-work/2.0', data});
}
const start = (session: Session, requestId: string, gen = generation(1), presetId = 'preset-green', device = 'wall'): Promise<Answer> =>
  work(session, {requestId, generation: gen, action: 'start', capture: CAPTURE, presetId}, device);
const stop = (session: Session, requestId: string, gen = generation(1)): Promise<Answer> => work(session, {requestId, generation: gen, action: 'stop'});

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
/** Static frame writes the session made: the module's music paints are static displays. */
const frames = (world: ModuleWorld, sinceMs: number) => world.writes().filter(write => write.atMs >= sinceMs && write.animType === 'static');

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

test('a Free light refuses a missing preset, an unnamed base and an unknown session stop', async context => {
  const session = await lightsInFree(context);
  const {world} = session;
  const before = lines(world)?.writes;
  assert.deepEqual(await start(session, 'missing', generation(1), 'preset-absent'), {status: 'rejected', code: 'not-found'});
  assert.deepEqual(await stop(session, 'stop-nothing'), {status: 'rejected', code: 'invalid-state'});
  assert.equal(lines(world)?.writes, before);
  await world.device.request({ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN}, 'PUT', '/effects', {write: {command: 'display', animType: 'custom', animData: '1 1 1 1 1 1 0 1'}});
  const unnamed = lines(world)?.writes;
  assert.deepEqual(await start(session, 'animation-base'), {status: 'rejected', code: 'invalid-state'});
  assert.equal(lines(world)?.writes, unnamed);
  assert.equal(world.outcomes('animation-base').length, 0);
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

test('Panels refuse a session and a Lines session leaves Panels untouched', async context => {
  const session = await lightsInFree(context, {
    section: {...SECTION, devices: [...SECTION.devices, {id: 'nl22', kind: 'panels', address: PANELS_ADDRESS, secret: 'token'}]},
    devices: {[LINES_ADDRESS]: 'lines', [PANELS_ADDRESS]: 'panels'},
  });
  const {world} = session;
  await mode(world, 'free', 'nl22');
  const panels = (): number | undefined => world.device.state().devices[PANELS_ADDRESS]?.writes;
  const before = panels();
  assert.deepEqual(await start(session, 'panels-start', generation(1), 'preset-green', 'nl22'), {status: 'rejected', code: 'unsupported-capability'});
  assert.equal(deviceState(world, 'nl22')?.session, null);
  assert.deepEqual(await start(session, 'lines-start', generation(2)), {status: 'accepted'});
  await play(session, 1500);
  assert.equal(deviceState(world)?.session?.status, 'playing');
  assert.equal(panels(), before);
  assert.equal(deviceState(world, 'nl22')?.session, null);
  world.verify();
});

test('the first frame completes Start as transmitted and Stop restores the named base', async context => {
  const session = await playing(context);
  const {world} = session;
  assert.deepEqual(outcome(world, 'start-1'), {requestId: 'start-1', result: 'succeeded', evidence: 'transmitted'});
  assert.equal(world.outcomes('start-1')[0]?.type, 'org.bunny.music-lighting.work.completed');
  assert.equal(lines(world)?.select, '*Static*');
  assert.ok(frames(world, session.since).length >= 1);
  assert.deepEqual(await stop(session, 'stop-1'), {status: 'accepted'});
  await play(session, 300);
  await world.until(() => world.outcomes('stop-1').length === 1, 2000, 'the stop outcome');
  assert.deepEqual(outcome(world, 'stop-1'), {requestId: 'stop-1', result: 'succeeded', evidence: 'transmitted'});
  assert.equal(lines(world)?.select, 'Beach Waves');
  assert.equal(lines(world)?.brightness, 50);
  assert.deepEqual(ended(world), {generation: generation(1), reason: 'stopped', restoration: 'restored', atMs: ended(world)?.atMs});
  const after = lines(world)?.writes;
  await play(session, 1000);
  assert.equal(lines(world)?.writes, after, 'nothing renders after the session ended');
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
  const repeat = lines(world)?.writes ?? 0;
  for (let index = 0; index < 3; index += 1) {
    await publish(session, {...frame(session), sequence: last});
    await world.advance(100);
  }
  const restorations = world.writes().filter(write => write.atMs > world.clock.now() - 300 && write.animType === undefined).length;
  assert.equal((lines(world)?.writes ?? 0) - restorations, repeat, 'duplicates add no frames');
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

test('an external scene choice that the once-per-second read sees ends the session as manual without restoration', async context => {
  const session = await playing(context);
  const {world} = session;
  const changed = world.clock.now();
  // The app chooses its scene again after each frame, so the next read finds it before a frame paints over it.
  for (let step = 0; step < 15 && ended(world) === undefined; step += 1) {
    await publish(session, frame(session));
    await world.device.request({ip: LINES_ADDRESS, token: SYNTHETIC_TOKEN}, 'PUT', '/effects', {select: 'Northern Lights'});
    await world.advance(100);
  }
  await world.until(() => ended(world) !== undefined, 500, 'the manual ending');
  assert.equal(ended(world)?.reason, 'manual');
  assert.equal(ended(world)?.restoration, 'none');
  assert.equal(lines(world)?.select, 'Northern Lights');
  assert.equal(world.writes().filter(write => write.atMs > changed && write.select === 'Beach Waves').length, 0, 'no base restoration');
  world.verify();
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
