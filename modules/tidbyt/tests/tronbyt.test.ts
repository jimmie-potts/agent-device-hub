// The Tronbyt connection (Hub #23), against the server's answers as a disposable v2.5.1 server gave them, and the module
// on the simulated server beside the simulated cloud: identical frames through both, the backend's differences, the
// write gate, commands, the pin, the handoff between backends, and what never reaches a message.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CloudFetch} from '../src/cloud.js';
import {configureTidbyt} from '../src/configuration.js';
import {NO_CONTROLS, SIMULATED_SECTION} from '../src/module.js';
import {FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH} from '../src/render.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedCloud} from '../src/simulated.js';
import {SimulatedTronbyt, TRONBYT_ORIGIN} from '../src/simulated-tronbyt.js';
import {BRIGHTNESS_CEILING, TronbytConnection, privateServerUrl} from '../src/tronbyt.js';
import {encodeLosslessRgb} from '../src/webp.js';
import {MINUTE, SECOND, asking, finished, host, notice, playback, shown, test, until, withWriteFailure, working, type HostOptions, type Hosted} from './support.js';

const STATUS = 'agentdevicehub';
const NOW_PLAYING = 'nowplaying';
const KEY = 'synthetic-key';
const SERVER_KEY = SIMULATED_API_KEY;
const signal = (): AbortSignal => new AbortController().signal;
/** A session whose label a test can change, so its frame changes. */
const relabel = (record: SessionRecord, value: string): SessionRecord => ({...record, label: {value, origin: 'user'}});
const WEBP = Uint8Array.from([1, 2, 3]);
const TRONBYT = {url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE};
const section = (extra: object = {}): object => ({
  id: 'tidbyt', backend: 'tronbyt', tronbyt: {...TRONBYT, ...extra}, statusInstallation: STATUS,
  nowPlaying: {...SIMULATED_SECTION.nowPlaying}, secrets: {token: '/nowhere/tronbyt-token'},
});
const onServer = (server: SimulatedTronbyt, extra: object = {}): {section: Record<string, unknown>; module: {transport: CloudFetch}} => ({section: section(extra) as Record<string, unknown>, module: {transport: server.fetch}});

type Sent = {url: string; method: string; headers: Record<string, string>; body: string | undefined; redirect: string};
function recording(respond: (init: Parameters<CloudFetch>[1], url: string) => Response | Promise<Response>): {fetch: CloudFetch; calls: Sent[]} {
  const calls: Sent[] = [];
  return {calls, fetch: async (url, init) => {
    calls.push({url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect});
    return await respond(init, url);
  }};
}
const plain = (status: number, body: string): Response => new Response(`${body}\n`, {status, headers: {'content-type': 'text/plain; charset=utf-8'}});
const connect = (fetch: CloudFetch): TronbytConnection =>
  new TronbytConnection({url: 'http://192.168.1.50:8000', deviceId: 'abcd1234', apiKey: KEY, installationId: STATUS, additionalInstallationIds: [NOW_PLAYING], fetch});

// The connection's wire form

const realFrame = (): Uint8Array => encodeLosslessRgb(FRAME_WIDTH, FRAME_HEIGHT, new Uint8Array(FRAME_BYTES));
const onSimulated = (server: SimulatedTronbyt): TronbytConnection =>
  new TronbytConnection({url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE, apiKey: SERVER_KEY, installationId: STATUS, additionalInstallationIds: [NOW_PLAYING], fetch: server.fetch});
const reloads = (server: SimulatedTronbyt): string[] => server.state().calls.filter(call => call.method === 'PATCH').map(call => call.path);
const RELOAD_STATUS = `/v0/devices/${SIMULATED_DEVICE}/installations/${STATUS}`;

test('a background push into an empty list reaches the connected device, by a write that changes nothing', async () => {
  const server = new SimulatedTronbyt();
  const connection = onSimulated(server);
  assert.deepEqual(await connection.push(realFrame(), signal()), {outcome: 'sent'});
  assert.deepEqual(server.state().served, [STATUS]);
  assert.equal(server.state().brightnessWrites, 0);
  assert.equal(server.state().pinnedApp, null);
  assert.deepEqual(reloads(server), [RELOAD_STATUS]);
});

test('every background push reloads, so a tile removed behind the connection or by a lost answer still reaches the device', async () => {
  const server = new SimulatedTronbyt();
  const connection = onSimulated(server);
  await connection.push(realFrame(), signal());
  await onSimulated(server).remove(signal());
  assert.deepEqual(server.state().served, []);
  await connection.push(realFrame(), signal());
  assert.deepEqual(server.state().served, [STATUS]);

  // A delete that took effect with its answer lost.
  const controller = new AbortController();
  server.loseNextAnswer();
  const removing = connection.remove(controller.signal);
  controller.abort();
  assert.equal((await removing).outcome, 'uncertain');
  assert.deepEqual(server.state().served, []);
  await connection.push(realFrame(), signal());
  assert.deepEqual(server.state().served, [STATUS]);
});

test('an interrupting push needs no reload, because it reloads the list itself', async () => {
  const server = new SimulatedTronbyt();
  await onSimulated(server).push(realFrame(), signal(), undefined, true);
  assert.deepEqual(server.state().served, [STATUS]);
  assert.deepEqual(reloads(server), []);
});

test('a reload that fails is the write\'s outcome, so the writer\'s holds and its retry apply', async () => {
  const server = new SimulatedTronbyt();
  const connection = onSimulated(server);
  server.answerNextPatch(500);
  assert.deepEqual(await connection.push(realFrame(), signal()), {outcome: 'uncertain', answered: true});
  assert.deepEqual(server.state().served, []);
  server.answerNextPatch(401);
  assert.deepEqual(await connection.push(realFrame(), signal()), {outcome: 'failed', failure: 'unauthenticated'});
  assert.deepEqual(server.state().served, []);
  assert.deepEqual(await connection.push(realFrame(), signal()), {outcome: 'sent'});
  assert.deepEqual(server.state().served, [STATUS]);
});

test('a reload that goes unanswered or is ended by a stop leaves the write uncertain', async () => {
  const connection = onSimulated(new SimulatedTronbyt());
  const hanging = new TronbytConnection({url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE, apiKey: SERVER_KEY, installationId: STATUS, fetch: async (url, init) => {
    if (init.method !== 'PATCH') return await connection.push(realFrame(), init.signal).then(() => plain(200, 'WebP received.'));
    return await new Promise<Response>((_, reject) => { init.signal.addEventListener('abort', () => { reject(new DOMException('stopped', 'AbortError')); }, {once: true}); });
  }});
  const controller = new AbortController();
  const pushing = hanging.push(realFrame(), controller.signal);
  await new Promise(resolve => { setImmediate(resolve); });
  controller.abort();
  assert.deepEqual(await pushing, {outcome: 'uncertain', answered: false});
});

test('a push that failed asks for no reload', async () => {
  const server = new SimulatedTronbyt();
  server.answerNext(500);
  assert.deepEqual(await onSimulated(server).push(realFrame(), signal()), {outcome: 'uncertain', answered: true});
  assert.deepEqual(reloads(server), []);
});

test('a push names its installation and always says whether it is in the background', async () => {
  const {fetch, calls} = recording(() => plain(200, 'WebP received.'));
  const connection = connect(fetch);
  assert.deepEqual(await connection.push(WEBP, signal()), {outcome: 'sent'});
  assert.deepEqual(await connection.push(WEBP, signal(), NOW_PLAYING, true), {outcome: 'sent'});
  assert.equal(calls[0]?.url, 'http://192.168.1.50:8000/v0/devices/abcd1234/push');
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.redirect, 'error');
  assert.equal(calls[0]?.headers.authorization, `Bearer ${KEY}`);
  // The server's own default is false, which would interrupt the display on every tile's write.
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ''), {image: Buffer.from(WEBP).toString('base64'), installationID: STATUS, background: true});
  assert.equal(calls[1]?.method, 'PATCH');
  assert.equal(calls[1]?.url, `http://192.168.1.50:8000/v0/devices/abcd1234/installations/${STATUS}`);
  assert.equal(calls[1]?.body, '{}');
  assert.deepEqual(JSON.parse(calls[2]?.body ?? ''), {image: Buffer.from(WEBP).toString('base64'), installationID: NOW_PLAYING, background: false});
});

test('presence is read by asking for the installation by name, and a server ID in the list never counts', async () => {
  const {fetch, calls} = recording((_init, url) => url.endsWith(`/${STATUS}`) ? new Response('{"id":"100"}', {status: 200}) : plain(404, 'App not found'));
  const connection = connect(fetch);
  assert.deepEqual(await connection.list(signal()), {ok: true, present: true});
  assert.deepEqual(await connection.list(signal(), NOW_PLAYING), {ok: true, present: false});
  assert.equal(calls[0]?.url, `http://192.168.1.50:8000/v0/devices/abcd1234/installations/${STATUS}`);
  assert.deepEqual(await connection.list(signal(), 'other'), {ok: false, failure: 'invalid-request', answered: false}, 'an installation the connection does not write');
});

test('a missing installation and a missing device are told apart by the server\'s fixed text', async () => {
  const gone = connect(recording(() => plain(404, 'App not found')).fetch);
  assert.deepEqual(await gone.remove(signal()), {outcome: 'sent'}, 'one already gone counts as removed');
  assert.deepEqual(await gone.pin(signal()), {outcome: 'failed', failure: 'invalid-request'}, 'one that is gone cannot be pinned');
  const noDevice = connect(recording(() => plain(404, 'Device not found')).fetch);
  assert.deepEqual(await noDevice.remove(signal()), {outcome: 'failed', failure: 'unknown-device'});
  assert.deepEqual(await noDevice.list(signal()), {ok: false, failure: 'unknown-device', answered: true});
  assert.deepEqual(await noDevice.push(WEBP, signal()), {outcome: 'failed', failure: 'unknown-device'});
});

test('each failure is classified once, and nothing is sent again', async () => {
  const cases: [number, unknown][] = [
    [401, {outcome: 'failed', failure: 'unauthenticated'}], [403, {outcome: 'failed', failure: 'forbidden'}], [400, {outcome: 'failed', failure: 'invalid-request'}],
    [500, {outcome: 'uncertain', answered: true}], [502, {outcome: 'uncertain', answered: true}],
  ];
  for (const [status, expected] of cases) {
    const {fetch, calls} = recording(() => plain(status, 'refused'));
    assert.deepEqual(await connect(fetch).push(WEBP, signal()), expected, String(status));
    assert.equal(calls.length, 1);
  }
  const limited = connect(recording(() => new Response('', {status: 429, headers: {'retry-after': '7'}})).fetch);
  assert.deepEqual(await limited.push(WEBP, signal()), {outcome: 'failed', failure: 'capacity', retryAfterMs: 7000});
  const refused = connect(() => Promise.reject(new TypeError('fetch failed', {cause: Object.assign(new Error('x'), {code: 'ECONNREFUSED'})})));
  assert.deepEqual(await refused.push(WEBP, signal()), {outcome: 'failed', failure: 'transport-failure'}, 'nothing left this host');
  const lost = connect(() => Promise.reject(new DOMException('lost', 'AbortError')));
  assert.deepEqual(await lost.push(WEBP, signal()), {outcome: 'uncertain', answered: false}, 'the write may have taken effect');
  assert.deepEqual(await lost.list(signal()), {ok: false, failure: 'transport-failure', answered: false});
});

test('brightness scales its percent to the Gen 1 ceiling, since the server stores anything it is sent', async () => {
  const {fetch, calls} = recording(() => new Response('{}', {status: 200}));
  const connection = connect(fetch);
  for (const percent of [0, 37, 100]) await connection.setBrightness(percent, signal());
  await connection.unpin(signal());
  assert.deepEqual(calls.map(call => JSON.parse(call.body ?? '') as unknown), [{brightness: 0}, {brightness: Math.round(37 * BRIGHTNESS_CEILING / 100)}, {brightness: BRIGHTNESS_CEILING}, {pinnedApp: ''}]);
  assert.ok(calls.every(call => call.method === 'PATCH' && call.url.endsWith('/v0/devices/abcd1234')));
});

test('a server origin takes no credentials or path, and plain http only on a private host, since each request carries the key', () => {
  for (const good of ['http://192.168.1.50:8000', 'http://10.0.0.2', 'http://172.20.1.1:8000/', 'http://127.0.0.1:8000', 'http://[::1]:8000', 'http://tronbyt:8000', 'http://host.docker.internal:8000',
    'http://tronbyt.local:8000', 'https://tronbyt.example.com']) {
    assert.ok(privateServerUrl(good) !== undefined, good);
  }
  for (const bad of ['http://tronbyt.example.com', 'http://8.8.8.8:8000', 'http://172.32.0.1', 'http://user:pass@192.168.1.5', 'http://192.168.1.5/path', 'http://192.168.1.5/?a=1', 'http://192.168.1.5/#x',
    'ftp://192.168.1.5', 'not a url', 42, undefined]) {
    assert.equal(privateServerUrl(bad), undefined, String(bad));
  }
  assert.equal(privateServerUrl('http://192.168.1.50:8000/'), 'http://192.168.1.50:8000');
});

// Configuration

test('the section selects one backend, and refuses the other\'s settings', () => {
  const secrets = {token: '/secret'};
  const cloud = configureTidbyt({id: 'tidbyt', cloudDeviceId: 'cloud-id', secrets});
  assert.ok('config' in cloud && cloud.config.cloudDeviceId === 'cloud-id' && cloud.config.tronbyt === undefined, 'cloud stays the default');
  const explicit = configureTidbyt({id: 'tidbyt', backend: 'cloud', cloudDeviceId: 'cloud-id', secrets});
  assert.deepEqual('config' in explicit && explicit.config, 'config' in cloud && cloud.config, 'naming the cloud changes nothing');
  const server = configureTidbyt({id: 'tidbyt', backend: 'tronbyt', tronbyt: {url: 'http://192.168.1.50:8000/', deviceId: 'abcd1234', minIntervalMs: 2000}, secrets});
  assert.ok('config' in server);
  assert.deepEqual(server.config.tronbyt, {url: 'http://192.168.1.50:8000', deviceId: 'abcd1234', minIntervalMs: 2000});
  assert.equal(server.config.cloudDeviceId, undefined);
  const refused: object[] = [
    {id: 'tidbyt', backend: 'tronbyt', cloudDeviceId: 'cloud-id', tronbyt: TRONBYT, secrets},
    {id: 'tidbyt', cloudDeviceId: 'cloud-id', tronbyt: TRONBYT, secrets},
    {id: 'tidbyt', backend: 'tronbyt', secrets},
    {id: 'tidbyt', backend: 'other', cloudDeviceId: 'cloud-id', secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: {url: 'http://secret.example.com', deviceId: 'abcd1234'}, secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: {...TRONBYT, minIntervalMs: 999}, secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: {...TRONBYT, refreshMs: 86_400_001}, secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: {...TRONBYT, extra: true}, secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: {...TRONBYT, deviceId: 'bad id'}, secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: TRONBYT, statusInstallation: '100', secrets},
    {id: 'tidbyt', backend: 'tronbyt', tronbyt: TRONBYT, nowPlaying: {playback: 'living-room', installation: '100'}, secrets},
  ];
  for (const body of refused) {
    const answer = configureTidbyt(body);
    assert.ok(!('config' in answer), JSON.stringify(body));
    assert.ok('error' in answer && answer.error.code === 'invalid-request');
    assert.ok(!JSON.stringify(answer).includes('secret.example.com'), 'a refusal repeats no value');
  }
});

// The module on a simulated server

test('identical frames reach the display through the cloud and through a server, and only the server takes them by name in the background', async context => {
  const sessions = [asking(), working(), finished()];
  const now = playback('playing');
  const server = new SimulatedTronbyt();
  const onCloud = await host(context, {sessions, playback: now});
  const onTronbyt = await host(context, {sessions, playback: now, ...onServer(server)});
  await until(() => shown(onCloud, STATUS).pushes === 1 && shown(onCloud, NOW_PLAYING).pushes === 1, 'the cloud\'s tiles');
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().installations[NOW_PLAYING]?.pushes === 1, 'the server\'s tiles');
  const state = server.state();
  assert.deepEqual(state.installations[STATUS]?.picture, shown(onCloud, STATUS).picture, 'the status tile');
  assert.deepEqual(state.installations[NOW_PLAYING]?.picture, shown(onCloud, NOW_PLAYING).picture, 'the now-playing card');
  assert.equal(state.anonymous, 0, 'no anonymous push, which the server would queue for later');
  assert.equal(state.installations[STATUS]?.immediate, 0, 'a tile takes its turn in the rotation by default');
  assert.deepEqual(onCloud.device().capabilities, NO_CONTROLS, 'the cloud stays read-only');
  const device = onTronbyt.device();
  assert.deepEqual(device.capabilities.brightness, {supported: true, minimum: 0, maximum: 100});
  assert.deepEqual(device.capabilities.modes, {supported: true, values: ['rotation', 'interrupt', 'pin-status', 'hide-status', 'pin-now-playing', 'hide-now-playing']});
  assert.deepEqual(device.desired.mode, {status: 'known', value: 'rotation'});
  assert.deepEqual(device.observed, {status: 'unknown'}, 'the server says what it served, never what the panel shows');
  assert.ok(device.lastTransmission.status === 'known' && device.lastTransmission.operationIds[0] === 'push');
  assert.deepEqual(onTronbyt.problems(), []);
});

test('a tile that leaves is removed by name, one already gone is left alone, and each is read by name when its presence is unknown', async context => {
  const server = new SimulatedTronbyt({installations: [STATUS]});
  const h = await host(context, {sessions: [], ...onServer(server)});
  await h.advance(31 * SECOND);
  await until(() => server.state().installations[STATUS] === undefined, 'the leftover tile\'s removal');
  const {calls} = server.state();
  assert.deepEqual(calls.filter(call => call.path.endsWith(`/installations/${STATUS}`)).map(call => `${call.method} ${String(call.answer)}`), ['GET 200', 'DELETE 200']);
  assert.ok(!calls.some(call => call.method === 'DELETE' && call.path.endsWith(`/installations/${NOW_PLAYING}`)), 'a tile the server does not have is not deleted');
  assert.deepEqual(h.problems(), []);
});

test('a backend\'s own gate and refresh apply on a server, and the cloud\'s are the default', async context => {
  const server = new SimulatedTronbyt();
  const options = onServer(server, {minIntervalMs: 2000, refreshMs: 5 * MINUTE});
  const session = working();
  const h = await host(context, {sessions: [session], playback: 'absent', ...options, section: {...options.section, nowPlaying: undefined}});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  await h.core?.set(relabel(session, 'changed'));
  await until(() => h.harness.runningWorkers() === 0, 'its render');
  await h.advance(1999);
  assert.equal(server.state().installations[STATUS]?.pushes, 1, 'the gate holds');
  await h.advance(2);
  await until(() => server.state().installations[STATUS]?.pushes === 2, 'the push after 2 s');
  await h.advance(5 * MINUTE + 1);
  await until(() => server.state().installations[STATUS]?.pushes === 3, 'the refresh after 5 minutes');
});

test('a server that does not answer makes the Tidbyt unavailable, and a push is never sent again', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  server.offline();
  await until(() => h.published.length > 0 && server.state().calls.length >= 1, 'the first call');
  await h.advance(10 * SECOND + 1);
  await until(() => h.device().availability === 'unavailable', 'the unanswered call');
  const sent = server.state().calls.filter(call => call.method === 'POST').length;
  assert.equal(sent, 1);
  await h.advance(14 * SECOND);
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, sent, 'nothing goes out before the gate opens');
  server.online();
  await h.advance(2 * SECOND);
  await until(() => h.device().availability === 'available', 'a fresh write of the current state');
  assert.equal(server.state().installations[STATUS]?.pushes, 1, 'one frame reached the server');
});

// Commands

const operators = new WeakMap<Hosted, ReturnType<Hosted['bus']['connect']>>();
async function send(h: Hosted, family: string, data: {requestId: string} & Record<string, unknown>, options: {timeoutMs?: number} = {}): Promise<{status: string; code?: string}> {
  const client = operators.get(h) ?? h.bus.connect('bunny/parts/operator');
  operators.set(h, client);
  const result = await client.request(`bunny.cmd.${family}.tidbyt`, {
    type: `org.bunny.${family === 'brightness-set' ? 'brightness.set' : 'device-mode.set'}.requested`, subject: 'tidbyt', dataschema: `${SCHEMA_BASE}${family}/2.0`, data,
  }, {timeoutMs: options.timeoutMs ?? 5000, requestId: data.requestId});
  return result.status === 'rejected' ? {status: 'rejected', code: result.error.error.code} : {status: result.status};
}
/** Each outcome once: the outbox publishes an unreported one again after a restart, and the core drops the repeat by its ID. */
const outcomes = (h: Hosted): {result: string; evidence: string; requestId: string; error?: {code: string}}[] =>
  [...new Map(h.published.filter((message: Message) => message.dataschema === `${SCHEMA_BASE}outcome/2.0`).map(message => [message.id, message.data as never])).values()];

test('brightness goes out once, in percent of the ceiling, and its outcome says it was transmitted, never observed', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  const before = h.device().configurationRevision;
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'b1', percent: 100}), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.deepEqual(outcomes(h)[0], {requestId: 'b1', result: 'succeeded', evidence: 'transmitted'});
  assert.equal(server.state().brightness, BRIGHTNESS_CEILING);
  const device = h.device();
  assert.deepEqual(device.desired.brightness, {status: 'known', value: 100});
  assert.deepEqual(device.observed, {status: 'unknown'});
  assert.equal(device.configurationRevision, before + 1);
  assert.equal(device.pending, 0);
  assert.deepEqual(device.lastOutcome, {status: 'known', outcome: outcomes(h)[0]});
  assert.ok(device.lastTransmission.status === 'known' && device.lastTransmission.requestId === 'b1');

  const writes = (): number => server.state().brightnessWrites;
  const sent = writes();
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'b1', percent: 100}), {status: 'accepted'}, 'a repeat changes nothing');
  await h.advance(SECOND);
  assert.equal(writes(), sent);
  assert.equal(outcomes(h).length, 1);
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'b1', percent: 40}), {status: 'rejected', code: 'duplicate-conflict'});
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'b2', percent: 101}), {status: 'rejected', code: 'invalid-message'});
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'b3', percent: 10, expectedConfigurationRevision: 0}), {status: 'rejected', code: 'revision-conflict'});
  assert.deepEqual(h.problems(), []);
});

test('an unanswered command is uncertain and never sent again, and a refused key holds every later write', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  const patched = server.state().calls.filter(call => call.method === 'PATCH' && !call.path.includes('/installations')).length;
  server.loseNextAnswer();
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'lost', percent: 50}), {status: 'accepted'});
  await until(() => server.state().brightnessWrites === 1, 'the write');
  await h.advance(10 * SECOND + 1);
  await until(() => outcomes(h).length === 1, 'its outcome');
  assert.equal(outcomes(h)[0]?.result, 'uncertain');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(outcomes(h)[0]?.error?.code, 'uncertain-result');
  assert.equal(server.state().brightnessWrites, 1, 'it is not sent again');

  server.answerNext(401);
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'refused', percent: 50}), {status: 'accepted'});
  await until(() => outcomes(h).length === 2, 'the refusal');
  assert.equal(outcomes(h)[1]?.error?.code, 'unauthenticated');
  assert.equal(h.device().availability, 'unavailable');
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'held', percent: 50}), {status: 'accepted'});
  await until(() => outcomes(h).length === 3, 'the hold');
  assert.equal(outcomes(h)[2]?.error?.code, 'unauthenticated');
  assert.equal(server.state().calls.filter(call => call.method === 'PATCH' && !call.path.includes('/installations')).length, patched + 2, 'the hold sends nothing');
});

test('a command the database cannot store is refused before anything goes out', async context => {
  const server = new SimulatedTronbyt();
  let failing = false;
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server), wrapDatabase: database => withWriteFailure(database, () => failing ? new Error('disk I/O error') : undefined)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  await until(() => h.device().availability === 'available', 'the record');
  const revision = h.device().configurationRevision;
  failing = true;
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'unstored', percent: 10}), {status: 'rejected', code: 'unavailable'});
  failing = false;
  assert.equal(server.state().brightnessWrites, 0, 'nothing went out');
  assert.equal(h.device().configurationRevision, revision, 'the record stands');
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'stored', percent: 10}), {status: 'accepted'}, 'the same command works once the database does');
  await until(() => outcomes(h).length === 1, 'its outcome');
  assert.equal(h.device().configurationRevision, revision + 1);
  assert.deepEqual(h.device().desired.brightness, {status: 'known', value: 10});
});

test('a command that waited past its deadline never goes out', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  server.answerNext(429);
  await send(h, 'brightness-set', {requestId: 'limited', percent: 10});
  await until(() => outcomes(h).length === 1, 'the rate limit');
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'late', percent: 20}, {timeoutMs: 5000}), {status: 'accepted'});
  await h.advance(61 * SECOND);
  await until(() => outcomes(h).length === 2, 'the expiry');
  assert.equal(outcomes(h)[1]?.error?.code, 'expired');
  assert.equal(server.state().brightnessWrites, 0, 'the late command never reached the server');
});

test('the modes: interrupt sets a tile\'s pushes to interrupt, and a hidden tile leaves and stays out until another mode returns it', async context => {
  const server = new SimulatedTronbyt();
  const session = working();
  const h = await host(context, {sessions: [session], playback: playback('playing'), ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  assert.deepEqual(await send(h, 'device-mode-set', {requestId: 'm1', mode: 'interrupt'}), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the mode');
  assert.deepEqual(outcomes(h)[0], {requestId: 'm1', result: 'succeeded', evidence: 'transmitted'});
  assert.deepEqual(h.device().desired.mode, {status: 'known', value: 'interrupt'});
  await h.core?.set(relabel(session, 'changed'));
  await h.advance(15 * SECOND);
  await until(() => server.state().installations[STATUS]?.pushes === 2, 'the next push');
  assert.equal(server.state().installations[STATUS]?.immediate, 1, 'it interrupts');

  assert.deepEqual(await send(h, 'device-mode-set', {requestId: 'm2', mode: 'hide-now-playing'}), {status: 'accepted'});
  await until(() => outcomes(h).length === 2, 'the second mode');
  await h.advance(16 * SECOND);
  await until(() => server.state().installations[NOW_PLAYING] === undefined, 'the hidden tile\'s removal');
  await h.playback?.set(playback('paused'));
  await h.advance(16 * SECOND);
  assert.equal(server.state().installations[NOW_PLAYING], undefined, 'a change writes it no frame');

  assert.deepEqual(await send(h, 'device-mode-set', {requestId: 'm3', mode: 'rotation'}), {status: 'accepted'});
  await until(() => outcomes(h).length === 3, 'the third mode');
  await h.advance(16 * SECOND);
  await until(() => server.state().installations[NOW_PLAYING]?.pushes === 1, 'its return');
  assert.deepEqual(await send(h, 'device-mode-set', {requestId: 'm4', mode: 'sideways'}), {status: 'rejected', code: 'unsupported-capability'});
  assert.deepEqual(h.problems(), []);
});

test('a pin follows its tile: it is set while the tile stands, cleared when the tile leaves, and set again on the new server ID', async context => {
  const server = new SimulatedTronbyt();
  const done = finished();
  const h = await host(context, {sessions: [done], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  const first = server.state().installations[STATUS]?.serverId;
  assert.deepEqual(await send(h, 'device-mode-set', {requestId: 'pin', mode: 'pin-status'}), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the mode');
  assert.equal(server.state().pinnedApp, first);

  await h.core?.set({...done, notices: [notice(['pixoo'])]});
  await h.advance(16 * SECOND);
  await until(() => server.state().installations[STATUS] === undefined && server.state().pinnedApp === null, 'the tile and its pin both gone');

  await h.core?.set(done);
  await h.advance(16 * SECOND);
  await until(() => server.state().installations[STATUS]?.pushes === 1, 'the tile\'s return');
  const second = server.state().installations[STATUS]?.serverId;
  assert.notEqual(second, first, 'a pushed installation takes a new server ID');
  await h.advance(31 * SECOND);
  await until(() => server.state().pinnedApp === second, 'the pin on the new ID');

  assert.deepEqual(await send(h, 'device-mode-set', {requestId: 'free', mode: 'rotation'}), {status: 'accepted'});
  await until(() => outcomes(h).length === 2, 'back to the rotation');
  assert.equal(server.state().pinnedApp, null);
});

test('a pin write that fails is a fresh one later, and it is reported once', async context => {
  const server = new SimulatedTronbyt();
  const done = finished();
  const h = await host(context, {sessions: [done], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  await send(h, 'device-mode-set', {requestId: 'pin', mode: 'pin-status'});
  await until(() => outcomes(h).length === 1, 'the mode');
  server.answerNextPatch(500);
  await h.core?.set({...done, notices: [notice(['pixoo'])]});
  await h.advance(16 * SECOND);
  await until(() => server.state().calls.some(call => call.method === 'DELETE'), 'the removal');
  await until(() => h.logs().some(entry => entry.event === 'operation.failed' && entry.fields['bunny.operation'] === 'mode'), 'the failed clear');
  await h.advance(61 * SECOND);
  await until(() => h.logs().some(entry => entry.event === 'operation.completed' && entry.fields['bunny.operation'] === 'mode'), 'the later clear');
  assert.equal(server.state().pinnedApp, null);
});

test('a restart keeps the mode and brightness, and a command the runtime stopped during is reported, never run again', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  await send(h, 'device-mode-set', {requestId: 'mode', mode: 'pin-status'});
  await send(h, 'brightness-set', {requestId: 'dim', percent: 30});
  await until(() => outcomes(h).length === 2, 'both');
  server.offline();
  const patches = (): number => server.state().calls.filter(call => call.method === 'PATCH').length;
  const before = patches();
  await send(h, 'brightness-set', {requestId: 'caught', percent: 90});
  await until(() => patches() === before + 1, 'the write under way');
  await h.restart();
  server.online();
  await until(() => outcomes(h).length === 3, 'the report of the unfinished command');
  assert.equal(outcomes(h)[2]?.result, 'uncertain');
  assert.equal(outcomes(h)[2]?.requestId, 'caught');
  assert.equal(server.state().brightnessWrites, 1, 'it is not sent again');
  const device = h.device();
  assert.deepEqual(device.desired.mode, {status: 'known', value: 'pin-status'});
  assert.deepEqual(device.desired.brightness, {status: 'known', value: 90});
  assert.equal(server.state().installations[STATUS]?.pushes, 1, 'a restart pushes nothing while the tile stands');
  assert.deepEqual(h.problems(), []);
});

test('a pin write a stop left unanswered is written again for the current mode at the next start, and the command is not', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  server.loseNextAnswer();
  await send(h, 'device-mode-set', {requestId: 'caught', mode: 'pin-status'});
  await until(() => server.state().pinnedApp !== null, 'the pin taking effect, its answer lost');
  await h.restart();
  await until(() => outcomes(h).some(outcome => outcome.requestId === 'caught'), 'its report');
  assert.equal(outcomes(h).find(outcome => outcome.requestId === 'caught')?.result, 'uncertain');
  assert.deepEqual(h.device().desired.mode, {status: 'known', value: 'rotation'}, 'the mode stays as it was');
  await h.advance(31 * SECOND);
  await until(() => server.state().pinnedApp === null, 'the display back in the rotation the record shows');
  assert.equal(server.state().pinWrites, 1, 'the pin is not sent again');
});

test('a hidden tile returned to the rotation reaches a connected device with nothing else to show', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().served.includes(STATUS), 'the first push');
  await send(h, 'device-mode-set', {requestId: 'hide', mode: 'hide-status'});
  await h.advance(16 * SECOND);
  await until(() => server.state().installations[STATUS] === undefined, 'the removal');
  assert.deepEqual(server.state().served, []);
  await send(h, 'device-mode-set', {requestId: 'back', mode: 'rotation'});
  await h.advance(16 * SECOND);
  await until(() => server.state().installations[STATUS] !== undefined, 'the push');
  await until(() => server.state().served.includes(STATUS), 'the reload', 5 * SECOND);
});

test('a command whose start cannot be stored ends with no effect, and later work goes on', async context => {
  const server = new SimulatedTronbyt();
  let armed = false;
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server), wrapDatabase: database => new Proxy(database, {
    get(target, property) {
      if (property !== 'prepare') {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.startsWith('UPDATE tidbyt_requests SET state')) return statement;
        const run = statement.run.bind(statement);
        return new Proxy(statement, {get(inner, key) {
          if (key !== 'run') return (Reflect.get(inner, key, inner) as (...args: unknown[]) => unknown).bind(inner);
          return (...parameters: Parameters<typeof run>) => {
            if (armed && (parameters as unknown[])[0] === 'started') throw new Error('disk I/O error');
            return run(...parameters);
          };
        }});
      };
    },
  })});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  armed = true;
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'unmarked', percent: 10}), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'its outcome');
  armed = false;
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(outcomes(h)[0]?.error?.code, 'internal');
  assert.equal(server.state().brightnessWrites, 0, 'nothing went out');
  assert.equal(h.device().availability, 'available', 'a local fault says nothing about the server');
  assert.equal(h.device().pending, 0, 'nothing stays pending');
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'next', percent: 10}), {status: 'accepted'});
  await until(() => outcomes(h).length === 2, 'the next command');
  assert.equal(server.state().brightnessWrites, 1);
});

// Handoff

test('a return to a server clears the pin it left, since the record starts at the rotation again', async context => {
  const server = new SimulatedTronbyt();
  const options: HostOptions = {sessions: [working()], playback: 'absent', ...onServer(server)};
  const h = await host(context, options);
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  await send(h, 'device-mode-set', {requestId: 'pin', mode: 'pin-status'});
  await until(() => outcomes(h).length === 1, 'the pin');
  assert.notEqual(server.state().pinnedApp, null);
  await h.stop();
  const cloud = new SimulatedCloud();
  Object.assign(options, {section: undefined, module: {transport: cloud.fetch}});
  await h.start();
  await until(() => cloud.state().installations[STATUS]?.pushes === 1, 'the cloud\'s tile');
  await h.stop();
  Object.assign(options, onServer(server));
  await h.start();
  await h.advance(31 * SECOND);
  await until(() => server.state().pinnedApp === null, 'the old pin cleared');
  assert.deepEqual(h.device().desired.mode, {status: 'known', value: 'rotation'});
});

test('a handoff the database refuses writes nothing in that run, and the next start hands off', async context => {
  const server = new SimulatedTronbyt();
  let failing = false;
  const options: HostOptions = {sessions: [working()], playback: 'absent', wrapDatabase: database => withWriteFailure(database, () => failing ? new Error('disk I/O error') : undefined)};
  const h = await host(context, options);
  await until(() => shown(h, STATUS).pushes === 1, 'the cloud\'s tile');
  await h.stop();
  Object.assign(options, onServer(server));
  failing = true;
  await h.start();
  failing = false;
  await h.advance(16 * SECOND);
  assert.equal(server.state().calls.length, 0, 'no write goes out with the old backend\'s memory');
  assert.ok(h.logs().some(entry => entry.event === 'operation.failed' && entry.fields['bunny.operation'] === 'setup'), 'it says why');
  await h.restart();
  await until(() => server.state().installations[STATUS]?.pushes === 1, 'the fresh write');
});

test('a connection row the database refuses on an upgrade leaves the cloud\'s tiles writing, and the next start stores it', async context => {
  let failing = false;
  const session = working();
  const options: HostOptions = {sessions: [session], playback: 'absent', wrapDatabase: database => withWriteFailure(database, () => failing ? new Error('disk I/O error') : undefined)};
  const h = await host(context, options);
  await until(() => shown(h, STATUS).pushes === 1, 'the tile');
  await h.stop();
  const database = new DatabaseSync(join(h.stateDir, 'tidbyt.sqlite'));
  database.exec('DROP TABLE tidbyt_connection');
  database.close();
  failing = true;
  await h.start();
  failing = false;
  await h.core?.set(relabel(session, 'changed'));
  await h.advance(16 * SECOND);
  await until(() => shown(h, STATUS).pushes === 2, 'the next write on the cloud');
  assert.ok(!h.logs().some(entry => entry.fields['bunny.operation'] === 'setup'), 'nothing handed off');
});

test('every record of a handoff and a command takes values the diagnostic contract registers, which the real log path enforces', async context => {
  const schema = JSON.parse(readFileSync(new URL('../../../../packages/observability/src/record.schema.json', import.meta.url), 'utf8')) as unknown;
  const enumOf = (node: unknown, key: string): string[] | undefined => {
    if (typeof node !== 'object' || node === null) return undefined;
    for (const [name, value] of Object.entries(node)) {
      if (name === key) return (value as {enum?: string[]}).enum;
      const found = enumOf(value, key);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const server = new SimulatedTronbyt();
  const options: HostOptions = {sessions: [working()], playback: 'absent'};
  const h = await host(context, options);
  await until(() => shown(h, STATUS).pushes === 1, 'the cloud\'s tile');
  h.cloud.offline();
  await h.stop();
  Object.assign(options, onServer(server));
  await h.start();
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the fresh write');
  await send(h, 'brightness-set', {requestId: 'b', percent: 10});
  await until(() => outcomes(h).length === 1, 'the outcome');
  for (const key of ['bunny.operation', 'bunny.reason']) {
    const allowed = enumOf(schema, key);
    assert.ok(allowed !== undefined, key);
    for (const entry of h.logs()) {
      const value = entry.fields[key];
      if (value !== undefined) assert.ok(allowed.includes(String(value)), `${entry.event}: ${key} ${String(value)}`);
    }
  }
});

test('a handoff to a server that already holds a pin clears it for the default mode', async context => {
  const server = new SimulatedTronbyt({installations: ['someone']});
  const options: HostOptions = {sessions: [working()], playback: 'absent'};
  const h = await host(context, options);
  await until(() => shown(h, STATUS).pushes === 1, 'the cloud\'s tile');
  await h.stop();
  const preset = await server.fetch(`${TRONBYT_ORIGIN}/v0/devices/${SIMULATED_DEVICE}/installations/someone`, {method: 'PATCH', redirect: 'error', signal: signal(), headers: {authorization: `Bearer ${SIMULATED_API_KEY}`}, body: '{"pinned":true}'});
  assert.equal(preset.status, 200);
  assert.notEqual(server.state().pinnedApp, null);
  Object.assign(options, onServer(server));
  await h.start();
  await until(() => server.state().pinnedApp === null, 'the old pin cleared');
  assert.deepEqual(h.device().desired.mode, {status: 'known', value: 'rotation'});
});

test('renaming the device hands nothing off', async context => {
  const server = new SimulatedTronbyt();
  const options: HostOptions = {sessions: [working()], playback: 'absent', ...onServer(server)};
  const h = await host(context, options);
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');
  await send(h, 'device-mode-set', {requestId: 'pin', mode: 'pin-status'});
  await until(() => outcomes(h).length === 1, 'the pin');
  await h.stop();
  options.section = {...onServer(server).section, id: 'renamed'};
  await h.start();
  await h.advance(16 * SECOND);
  assert.equal(server.state().installations[STATUS]?.pushes, 1, 'the tile stands');
  assert.equal(h.logs().filter(entry => entry.fields['bunny.operation'] === 'setup').length, 1, 'only the first start selected a backend');
  assert.deepEqual(h.device().desired.mode, {status: 'known', value: 'pin-status'}, 'the mode stays, which the pin on the server still matches');
  assert.equal(server.state().pinnedApp, server.state().installations[STATUS]?.serverId);
});

test('selecting a server drops what the cloud\'s tiles remembered, reports an uncertain write once and writes the current frame fresh', async context => {
  const server = new SimulatedTronbyt();
  const session = working();
  const options: HostOptions = {sessions: [session], playback: 'absent', section: {...SIMULATED_SECTION, nowPlaying: undefined, secrets: {token: '/nowhere/tidbyt-token'}}};
  const h = await host(context, options);
  await until(() => shown(h, STATUS).pushes === 1, 'the cloud\'s tile');
  // The old writer stops with a write under way, whose result it never learns.
  h.cloud.offline();
  await h.core?.set(relabel(session, 'changed'));
  await h.advance(15 * SECOND);
  await until(() => h.cloud.state().calls.filter(call => call.method === 'POST').length === 2, 'the write under way');
  await h.stop();
  const cloudPushes = h.cloud.state().calls.filter(call => call.method === 'POST').length;

  Object.assign(options, onServer(server));
  await h.start();
  await until(() => server.state().installations[STATUS]?.pushes === 1, 'the fresh write on the server');
  assert.equal(h.cloud.state().calls.filter(call => call.method === 'POST').length, cloudPushes, 'the cloud hears nothing more: no failover and no second writer');
  const handoff = h.logs().filter(entry => entry.fields['bunny.operation'] === 'setup');
  assert.deepEqual(handoff.map(entry => [entry.event, entry.fields['bunny.code'] ?? entry.fields['bunny.outcome']]),
    [['operation.failed', 'uncertain-result'], ['operation.completed', 'succeeded']]);
  assert.deepEqual(h.device().capabilities.brightness, {supported: true, minimum: 0, maximum: 100});
  assert.deepEqual(h.problems(), []);
});

test('a restart on the same backend hands nothing off, and a database from before the record keeps the cloud\'s tiles', async context => {
  const options: HostOptions = {sessions: [working()], playback: 'absent'};
  const h = await host(context, options);
  await until(() => shown(h, STATUS).pushes === 1, 'the tile');
  await h.stop();
  // A database an older module wrote has no record of its backend.
  const database = new DatabaseSync(join(h.stateDir, 'tidbyt.sqlite'));
  database.exec('DROP TABLE tidbyt_connection');
  database.close();
  await h.start();
  await h.advance(16 * SECOND);
  assert.equal(shown(h, STATUS).pushes, 1, 'the tile stands, so nothing is pushed');
  await h.restart();
  await h.advance(16 * SECOND);
  assert.equal(shown(h, STATUS).pushes, 1);
  assert.ok(!h.logs().some(entry => entry.fields['bunny.operation'] === 'setup'));
});

test('going back to the cloud drops the server\'s state too, and the cloud refuses the controls again', async context => {
  const server = new SimulatedTronbyt();
  const options: HostOptions = {sessions: [working()], playback: 'absent', ...onServer(server)};
  const h = await host(context, options);
  await until(() => server.state().installations[STATUS]?.pushes === 1, 'the server\'s tile');
  await send(h, 'device-mode-set', {requestId: 'mode', mode: 'interrupt'});
  await until(() => outcomes(h).length === 1, 'the mode');
  await h.stop();
  const cloud = new SimulatedCloud();
  Object.assign(options, {section: undefined, module: {transport: cloud.fetch}});
  await h.start();
  await until(() => cloud.state().installations[STATUS]?.pushes === 1, 'the fresh write on the cloud');
  assert.deepEqual(h.device().capabilities, NO_CONTROLS);
  assert.deepEqual(h.device().desired.mode, {status: 'unknown'});
  assert.deepEqual(await send(h, 'brightness-set', {requestId: 'b', percent: 10}), {status: 'rejected', code: 'unsupported-capability'});
});

test('no message, record or log carries the server, its device or its key', async context => {
  const url = 'http://192.168.77.88:8000';
  const server = new SimulatedTronbyt({origin: url, device: 'private-device-id'});
  const options = onServer(server);
  const h = await host(context, {sessions: [working()], playback: 'absent', ...options, section: {...options.section, tronbyt: {url, deviceId: 'private-device-id'}}});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the first push and the first selection\'s pin');
  server.answerNext(500);
  await send(h, 'brightness-set', {requestId: 'b', percent: 10});
  await until(() => outcomes(h).length === 1, 'the outcome');
  const all = JSON.stringify([h.published, h.logs(), h.spans.spans]);
  for (const secret of ['192.168.77.88', 'private-device-id', SERVER_KEY]) assert.ok(!all.includes(secret), secret);
});
