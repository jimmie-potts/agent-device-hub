// The simulated Tidbyt cloud and the text picture it shows (Hub #930): it answers the module's three calls as the cloud
// does, takes only its key and device, shows each installation's last frame, and can stop answering or refuse.
import assert from 'node:assert/strict';
import test from 'node:test';
import {TidbytCloudConnection} from '../src/cloud.js';
import {decodeLossless, picture} from '../src/picture.js';
import {renderFrame} from '../src/render.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedCloud} from '../src/simulated.js';
import {HEIGHT, WIDTH, goldenFrames} from './frames.js';

const connect = (cloud: SimulatedCloud, key = SIMULATED_API_KEY, device = SIMULATED_DEVICE): TidbytCloudConnection =>
  new TidbytCloudConnection({deviceId: device, apiKey: key, installationId: 'status', additionalInstallationIds: ['card'], fetch: cloud.fetch});
const signal = (): AbortSignal => new AbortController().signal;
const webpOf = (id: string): Uint8Array => {
  const build = goldenFrames[id];
  if (build === undefined) throw new Error(`no frame ${id}`);
  const result = renderFrame({width: WIDTH, height: HEIGHT, rgb: build()});
  if (!result.ok) throw new Error('no image');
  return result.webp;
};

void test('the decoder reads back every frame the encoder writes, and refuses anything else', () => {
  for (const [id, build] of Object.entries(goldenFrames)) {
    const decoded = decodeLossless(webpOf(id));
    assert.deepEqual(decoded, {width: 64, height: 32, rgb: build()}, id);
  }
  assert.equal(decodeLossless(Uint8Array.from([1, 2, 3])), undefined);
  assert.equal(decodeLossless(webpOf('noise').subarray(0, 100)), undefined);
});

void test('a picture shows each pixel as a letter for its color family, upper case when bright', () => {
  const rgb = new Uint8Array(4 * 3);
  rgb.set([255, 160, 0, 40, 120, 255, 13, 66, 26, 0, 0, 0]);
  assert.deepEqual(picture(rgb, 4, 1), ['ABg.']);
  assert.deepEqual(picture(Uint8Array.from([220, 220, 220, 73, 73, 73, 255, 0, 12]), 3, 1), ['WwR']);
});

void test('the simulated cloud shows what each installation was sent, lists and removes it, and takes only its key and device', async () => {
  const cloud = new SimulatedCloud({installations: ['leftover']});
  const connection = connect(cloud);
  assert.deepEqual(await connection.push(webpOf('status-titles'), signal()), {outcome: 'sent'});
  assert.deepEqual(await connection.push(webpOf('now-playing'), signal(), 'card'), {outcome: 'sent'});
  const build = goldenFrames['status-titles'];
  assert.ok(build !== undefined);
  assert.deepEqual(cloud.state().installations.status?.picture, picture(build()));
  assert.equal(cloud.state().installations.card?.pushes, 1);
  assert.deepEqual(await connection.list(signal()), {ok: true, present: true});
  assert.deepEqual(await connection.remove(signal(), 'card'), {outcome: 'sent'});
  assert.deepEqual(await connection.list(signal(), 'card'), {ok: true, present: false});
  assert.deepEqual(Object.keys(cloud.state().installations).sort(), ['leftover', 'status']);
  assert.deepEqual(await connect(cloud, 'another-key').push(webpOf('black'), signal()), {outcome: 'failed', failure: 'unauthenticated'});
  assert.equal(cloud.state().refusedKeys, 1);
  assert.deepEqual(await connect(cloud, SIMULATED_API_KEY, 'other-device').push(webpOf('black'), signal()), {outcome: 'failed', failure: 'unknown-device'});
  assert.deepEqual(cloud.state().calls.map(call => `${call.method} ${String(call.answer)}`), ['POST 200', 'POST 200', 'GET 200', 'DELETE 200', 'GET 200', 'POST 401', 'POST 404']);
});

void test('the simulated cloud can stop answering, refuse connections, and answer with a status of a test\'s choice', async () => {
  const cloud = new SimulatedCloud({online: false});
  const controller = new AbortController();
  const hanging = connect(cloud).push(webpOf('black'), controller.signal);
  controller.abort();
  assert.deepEqual(await hanging, {outcome: 'uncertain', answered: false});
  cloud.refuseConnections();
  assert.deepEqual(await connect(cloud).push(webpOf('black'), signal()), {outcome: 'failed', failure: 'transport-failure'});
  cloud.online();
  cloud.answerNext(429, '5');
  cloud.answerNext(502);
  assert.deepEqual(await connect(cloud).push(webpOf('black'), signal()), {outcome: 'failed', failure: 'capacity', retryAfterMs: 5000});
  assert.deepEqual(await connect(cloud).push(webpOf('black'), signal()), {outcome: 'uncertain', answered: true});
  assert.deepEqual(await connect(cloud).push(webpOf('black'), signal()), {outcome: 'sent'});
  cloud.answerAlways(400);
  assert.deepEqual(await connect(cloud).remove(signal()), {outcome: 'failed', failure: 'invalid-request'});
  cloud.answerAlways(undefined);
  assert.deepEqual(await connect(cloud).remove(signal()), {outcome: 'sent'});
});
