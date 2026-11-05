import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {InProcessBus, type DeviceLink} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {API} from '../src/cloud.js';
import {tidbytSimulation} from '../src/registration.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedCloud} from '../src/simulated.js';
import {SimulatedTronbyt, TRONBYT_ORIGIN} from '../src/simulated-tronbyt.js';
import {encodeLosslessRgb} from '../src/webp.js';
import {TRONBYT_SIMULATED_SECTION} from '../src/simulated-backend.js';
import {manualClock, until} from './support.js';

const signal = (): AbortSignal => new AbortController().signal;
const headers = {authorization: `Bearer ${SIMULATED_API_KEY}`};
const options = () => {const clock = manualClock(); return {now: clock.now, scheduler: clock.scheduler};};
const imageBody = (image: Uint8Array): string => JSON.stringify({deviceID: SIMULATED_DEVICE, image: Buffer.from(image).toString('base64'), installationID: 'art', background: true});

void test('registered memory simulation preserves cloud state and routes the configured synthetic Tronbyt origin', async () => {
  const clock = options(), device = tidbytSimulation.memory.create(clock), cloud = new SimulatedCloud({now: clock.now});
  const webp = encodeLosslessRgb(64, 32, new Uint8Array(6144));
  const init = {method: 'POST' as const, redirect: 'error' as const, signal: signal(), headers, body: imageBody(webp)};
  assert.equal((await device.fetch(`${API}/devices/${SIMULATED_DEVICE}/push`, init)).status, 200);
  await cloud.fetch(`${API}/devices/${SIMULATED_DEVICE}/push`, init);
  assert.deepEqual(tidbytSimulation.memory.state(device), cloud.state(), 'cloud fixtures retain their original state shape');
  const response = await device.fetch(`${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}`, {method: 'GET', redirect: 'error', signal: signal(), headers});
  assert.equal(response.status, 200, 'the registered route reaches the synthetic Tronbyt backend');
  const state = tidbytSimulation.memory.state(device);
  assert.ok(typeof state === 'object' && state !== null && 'pinnedApp' in state);
  assert.equal(state.pinnedApp, null);
});

void test('registered disposable transport serves Tronbyt pin reads and refuses unknown origins without redirecting them', async context => {
  const realFetch = context.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('a synthetic run must not use global fetch')));
  const held = tidbytSimulation.run.create(options());
  const args = {method: 'GET', url: `${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}`, authorization: headers.authorization};
  const answer = await tidbytSimulation.run.serve(held, {method: 'fetch', args, current: true, signal: signal()});
  assert.ok(typeof answer === 'object' && answer !== null && 'status' in answer);
  assert.equal(answer.status, 200);
  for (const url of ['https://example.invalid/v0/devices/other', `http://tronbyt.local.example.invalid:8000/v0/devices/${SIMULATED_DEVICE}`, `http://user@tronbyt.local:8000/v0/devices/${SIMULATED_DEVICE}`, `${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}?unexpected=1`]) {
    assert.deepEqual(await tidbytSimulation.run.serve(held, {method: 'fetch', args: {...args, url}, current: true, signal: signal()}), {failed: 'refused'});
  }
  assert.equal(realFetch.mock.callCount(), 0);
});

void test('the synthetic Tronbyt reads every animated WebP frame and delay with an independent decoder', async () => {
  const red = Buffer.alloc(6144), blue = Buffer.alloc(6144);
  for (let at = 0; at < red.length; at += 3) {red[at] = 255; blue[at + 2] = 255;}
  const webp = await sharp(Buffer.concat([red, blue]), {raw: {width: 64, height: 64, pageHeight: 32, channels: 3}})
    .webp({lossless: true, delay: [100, 300], loop: 0}).toBuffer();
  const server = new SimulatedTronbyt();
  const response = await server.fetch(`${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}/push`, {method: 'POST', redirect: 'error', signal: signal(), headers, body: imageBody(webp)});
  assert.equal(response.status, 200);
  const installation = server.state().installations.art;
  assert.ok(installation !== undefined && 'animation' in installation);
  assert.deepEqual(installation.picture, Array<string>(32).fill('R'.repeat(64)));
  assert.deepEqual(installation.animation, {frames: [Array<string>(32).fill('R'.repeat(64)), Array<string>(32).fill('B'.repeat(64))], delaysMs: [100, 300], byteLength: webp.length, sha256: createHash('sha256').update(webp).digest('hex')});
  installation.animation.frames[0]?.fill('changed');
  installation.animation.delaysMs[0] = 777;
  assert.deepEqual(server.state().installations.art?.animation?.delaysMs, [100, 300]);
  assert.deepEqual(server.state().installations.art?.picture, Array<string>(32).fill('R'.repeat(64)));
});

async function animationFixture(): Promise<Buffer> {
  const data = Buffer.alloc(12288);
  for (let at = 0; at < 6144; at += 3) {data[at] = 255; data[6144 + at + 2] = 255;}
  return sharp(data, {raw: {width: 64, height: 64, pageHeight: 32, channels: 3}}).webp({lossless: true, delay: [100, 300], loop: 0}).toBuffer();
}
function frameChunks(bytes: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  for (let at = 12; at < bytes.length;) {
    const size = bytes.readUInt32LE(at + 4), end = at + 8 + size + (size & 1);
    if (bytes.toString('ascii', at, at + 4) === 'ANMF') frames.push(bytes.subarray(at, end));
    at = end;
  }
  return frames;
}
function replaceFrames(bytes: Buffer, frames: Buffer[]): Buffer {
  const firstFrame = bytes.indexOf('ANMF', 12, 'ascii');
  assert.ok(firstFrame > 12);
  const result = Buffer.concat([bytes.subarray(0, firstFrame), ...frames]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

void test('animated readback preserves repeated frames and accepts the complete bounded profile', async () => {
  const fixture = await animationFixture(), [first, second] = frameChunks(fixture);
  assert.ok(first !== undefined && second !== undefined);
  const server = new SimulatedTronbyt();
  const push = (bytes: Buffer) => server.fetch(`${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}/push`, {method: 'POST', redirect: 'error', signal: signal(), headers, body: imageBody(bytes)});
  assert.equal((await push(replaceFrames(fixture, [first, first, second]))).status, 200);
  const animation = server.state().installations.art?.animation;
  assert.deepEqual(animation?.delaysMs, [100, 100, 300]);
  assert.deepEqual(animation?.frames[0], animation?.frames[1]);
  assert.notDeepEqual(animation?.frames[0], animation?.frames[2]);
  const maximum = Array.from({length: 20}, (_, index) => {
    const frame = Buffer.from(index % 2 === 0 ? first : second);
    frame.writeUIntLE(800, 20, 3);
    return frame;
  });
  assert.equal((await push(replaceFrames(fixture, maximum))).status, 200);
  assert.deepEqual(server.state().installations.art?.animation?.delaysMs, Array<number>(20).fill(800));
  const still = encodeLosslessRgb(64, 32, new Uint8Array(6144));
  assert.equal((await push(Buffer.from(still))).status, 200);
  assert.equal(server.state().installations.art?.animation, undefined, 'a static replacement clears old animation evidence');
});

void test('malformed and out-of-profile animation cannot replace the synthetic installation', async () => {
  const fixture = await animationFixture(), [first] = frameChunks(fixture);
  assert.ok(first !== undefined);
  const server = new SimulatedTronbyt();
  const push = (bytes: Buffer) => server.fetch(`${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}/push`, {method: 'POST', redirect: 'error', signal: signal(), headers, body: imageBody(bytes)});
  await push(fixture);
  const installed = server.state().installations.art;
  const mutate = (edit: (bytes: Buffer) => void): Buffer => {const bytes = Buffer.from(fixture); edit(bytes); return bytes;};
  const firstAt = fixture.indexOf('ANMF', 12, 'ascii');
  const invalid = [
    fixture.subarray(0, fixture.length - 1), Buffer.concat([fixture, Buffer.from([0, 0])]),
    mutate(bytes => bytes.writeUInt32LE(0xffff_ffff, 4)), mutate(bytes => bytes.writeUIntLE(64, 24, 3)),
    mutate(bytes => bytes.writeUInt32LE(0xffff_ffff, firstAt + 4)), mutate(bytes => bytes.writeUIntLE(99, firstAt + 20, 3)),
    mutate(bytes => bytes.writeUIntLE(801, firstAt + 20, 3)), mutate(bytes => bytes.writeUIntLE(1, firstAt + 8, 3)),
    mutate(bytes => bytes.writeUIntLE(64, firstAt + 14, 3)), mutate(bytes => {bytes[firstAt + 24] = 0;}),
    replaceFrames(fixture, Array<Buffer>(21).fill(first)), Buffer.alloc(163_841),
  ];
  for (const bytes of invalid) {
    assert.equal((await push(bytes)).status, 400);
    assert.deepEqual(server.state().installations.art, installed);
  }
});

void test('registered backends share offline controls and never record a refused destination', async () => {
  for (const origin of [new URL(API).origin, TRONBYT_ORIGIN]) {
    const device = tidbytSimulation.memory.create(options());
    const path = origin === TRONBYT_ORIGIN ? '' : '/installations';
    const url = `${origin}/v0/devices/${SIMULATED_DEVICE}${path}`;
    await device.fetch(url, {method: 'GET', redirect: 'error', signal: signal(), headers});
    const before = tidbytSimulation.memory.state(device);
    await assert.rejects(device.fetch('https://owner-server.invalid/v0/devices/private', {method: 'GET', redirect: 'error', signal: signal(), headers}), TypeError);
    assert.deepEqual(tidbytSimulation.memory.state(device), before);
    tidbytSimulation.memory.act(device, {device: 'tidbyt', action: 'offline'});
    const controller = new AbortController();
    const pending = device.fetch(url, {method: 'GET', redirect: 'error', signal: controller.signal, headers});
    controller.abort();
    await assert.rejects(pending, {name: 'AbortError'});
    tidbytSimulation.memory.act(device, {device: 'tidbyt', action: 'online'});
    assert.equal((await device.fetch(url, {method: 'GET', redirect: 'error', signal: signal(), headers})).status, 200);
  }
});

void test('the registered remote module carries its real moment handler through the synthetic Tronbyt transport', {timeout: 15_000}, async context => {
  const clock = manualClock(), bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const core = bus.connect('bunny/core');
  await core.serveSync(['session', 'playback'], () => ({revision: 1, states: []}));
  const held = tidbytSimulation.run.create({now: clock.now, scheduler: clock.scheduler});
  const link: DeviceLink = {handover: undefined, onPush() {}, call: async (method, args, callSignal) => ({status: 'answered', value: await tidbytSimulation.run.serve(held, {method, args, current: true, signal: callSignal ?? signal()})})};
  const stateDir = await mkdtemp(join(tmpdir(), 'tidbyt-simulation-'));
  const module = new ModuleHarness(tidbytSimulation.run.remote(link), {bus, stateDir, clock: {now: clock.now}, scheduler: clock.scheduler,
    section: {...TRONBYT_SIMULATED_SECTION, secrets: {token: '/synthetic/token'}}, secrets: {token: SIMULATED_API_KEY}});
  context.after(async () => {await module.stop(); await core.close(); await rm(stateDir, {recursive: true, force: true});});
  const outcomes: Message[] = [];
  await core.subscribe('bunny.event.moment-play.tidbyt', message => {outcomes.push(message);});
  await module.start();
  const state = () => {
    const value = held.state();
    assert.ok('pinnedApp' in value);
    return value;
  };
  await until(() => state().calls.some(call => call.method === 'PATCH'), 'initial backend selection');
  const reply = await core.request('bunny.cmd.moment-play.tidbyt', {type: 'org.bunny.moment.play.requested', subject: 'tidbyt', dataschema: 'https://bunny.invalid/events/moment-play/2.0', data: {
    requestId: 'simulated-moment', momentId: 'simulated-moment', mood: 'celebrate', durationMs: 30_000, priorityClass: 'event', coversStatus: true, startAtMs: clock.now(), toleranceMs: 10_000,
  }}, {timeoutMs: 5000, requestId: 'simulated-moment'});
  assert.equal(reply.status, 'accepted');
  await until(() => state().pinnedApp !== null, 'foreground takeover through registered remote transport');
  assert.equal(state().installations.bunnymoment?.immediate, 1);
  clock.advance(30_000);
  await until(() => outcomes.length > 0, 'moment release');
  assert.deepEqual(outcomes.at(-1)?.data, {requestId: 'simulated-moment', result: 'succeeded', evidence: 'transmitted'});
  assert.equal(state().pinnedApp, null);
  assert.equal(state().installations.bunnymoment, undefined);
  assert.deepEqual(module.failures, []);
});
