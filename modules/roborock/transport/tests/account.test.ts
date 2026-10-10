import assert from 'node:assert/strict';
import {deferred} from './helpers.js';
import {createHash, createHmac} from 'node:crypto';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import {setupSession} from '../src/transport/account.js';
import type {Config} from '../src/transport/private.js';
const config: Config = {schemaVersion: 1, deviceId: 'synthetic-robot', address: '192.168.10.20', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us'};
const rriot = {u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key', h: 'sentinel-hawk-key', r: {a: 'https://api-us.roborock.com', m: config.broker}};
const replies: unknown[] = [
  {code: 200}, {code: 200, data: {k: 'sentinel-sign-key'}}, {code: 200, data: {token: 'sentinel-token', rriot}},
  {code: 200, data: {rrHomeId: 42}},
  {success: true, result: {products: [{id: 'product-1', model: 'roborock.vacuum.a97'}], devices: [{duid: config.deviceId, localKey: '0123456789abcdef', productId: 'product-1', pv: '1.0'}]}},
];
void test('explicit v4 email-code setup uses signed exact-device lookup and returns only routine session fields', async () => {
  const calls: {url: URL; init: RequestInit}[] = []; let prompted = false;
  const fetch: typeof globalThis.fetch = (input, init = {}) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input); calls.push({url, init});
    if (calls.length === 2) assert.equal(prompted, true);
    return Promise.resolve(new Response(JSON.stringify(replies[calls.length - 1]), {status: 200}));
  };
  const result = await setupSession(config, {email: 'synthetic@example.invalid', readCode: () => {prompted = true; return Promise.resolve('123456');}}, {fetch, now: () => 1700000000000});
  assert.deepEqual(calls.map(call => call.url.pathname), ['/api/v4/email/code/send', '/api/v3/key/sign', '/api/v4/auth/email/login/code', '/api/v1/getHomeDetail', '/v3/user/homes/42']);
  assert.deepEqual(calls.map(call => call.init.method), ['POST', 'POST', 'POST', 'GET', 'GET']);
  assert.ok(calls.every(call => call.init.redirect === 'error' && call.init.signal instanceof AbortSignal));
  const login = calls[2]; assert.ok(login !== undefined);
  assert.equal(typeof login.init.body, 'string'); assert.ok(typeof login.init.body === 'string'); const form = new URLSearchParams(login.init.body); assert.equal(form.get('country'), 'US'); assert.equal(form.get('countryCode'), '1'); assert.equal(form.get('email'), 'synthetic@example.invalid'); assert.equal(form.get('code'), '123456');
  assert.equal(new Headers(login.init.headers).get('x-mercy-ks'), calls[1]?.url.searchParams.get('s'));
  assert.equal(new Headers(login.init.headers).get('x-mercy-k'), 'sentinel-sign-key');
  const home = calls[4]; assert.ok(home !== undefined);
  const auth = new Headers(home.init.headers).get('authorization'); assert.ok(auth !== null);
  const nonce = /nonce="([A-Za-z0-9]+)"/.exec(auth)?.[1]; assert.ok(nonce !== undefined);
  const md5 = createHash('md5').update('/v3/user/homes/42').digest('hex');
  const expected = createHmac('sha256', rriot.h).update([rriot.u, rriot.s, nonce, 1700000000, md5, '', ''].join(':')).digest('base64');
  assert.ok(auth.endsWith(`mac="${expected}"`));
  assert.deepEqual(result, {schemaVersion: 1, deviceId: config.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: {u: rriot.u, s: rriot.s, k: rriot.k}, broker: config.broker});
  assert.equal(JSON.stringify(result).includes('sentinel-token'), false); assert.equal(JSON.stringify(result).includes('sentinel-hawk-key'), false);
});
void test('authentication refusal stops before the code prompt or another request and returns fixed safe text', async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = () => {calls++; return Promise.resolve(new Response(JSON.stringify({code: 401, msg: 'sentinel-private-response'})));};
  await assert.rejects(setupSession(config, {email: 'synthetic@example.invalid', readCode: () => {assert.fail('must not prompt');}}, {fetch}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unauthenticated' && !JSON.stringify(error.body).includes('sentinel'));
  assert.equal(calls, 1);
});
void test('oversized advertised account response is refused before consuming its stream', async () => {
  let consumed = false;
  const body = new ReadableStream<Uint8Array>({pull: () => {consumed = true;}});
  const fetch: typeof globalThis.fetch = () => Promise.resolve(new Response(body, {headers: {'content-length': '2097153'}}));
  await assert.rejects(setupSession(config, {email: 'synthetic@example.invalid', readCode: () => Promise.resolve('123456')}, {fetch}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unsupported-capability');
  // ReadableStream may eagerly pull once on construction; cancellation must leave no pending reader.
  assert.equal(body.locked, false); void consumed;
});

void test('unsafe returned endpoints, broker mismatch and unsupported models stop without another setup request', async () => {
  const scenarios = [
    {index: 2, value: {code: 200, data: {token: 'sentinel-token', rriot: {...rriot, r: {...rriot.r, a: 'https://roborock.com.attacker.invalid'}}}}, code: 'invalid-request', calls: 3},
    {index: 2, value: {code: 200, data: {token: 'sentinel-token', rriot: {...rriot, r: {...rriot.r, m: 'mqtts://another.roborock.com:8883'}}}}, code: 'invalid-request', calls: 3},
    {index: 4, value: {success: true, result: {products: [{id: 'product-1', model: 'roborock.vacuum.unsupported'}], devices: [{duid: config.deviceId, localKey: '0123456789abcdef', productId: 'product-1', pv: '1.0'}]}}, code: 'unsupported-capability', calls: 5},
  ];
  for (const scenario of scenarios) {
    let count = 0;
    const fetch: typeof globalThis.fetch = () => {const index = count++; return Promise.resolve(new Response(JSON.stringify(index === scenario.index ? scenario.value : replies[index])));};
    await assert.rejects(setupSession(config, {email: 'synthetic@example.invalid', readCode: () => Promise.resolve('123456')}, {fetch}), (error: unknown) => error instanceof SdkError && error.body.error.code === scenario.code && !JSON.stringify(error.body).includes('sentinel'));
    assert.equal(count, scenario.calls);
  }
});
void test('cancellation fences a late ignored fetch and never advances to the prompt', async () => {
  const abort = new AbortController(); const pending = deferred<Response>(); let calls = 0;
  const fetch: typeof globalThis.fetch = () => {calls++; return pending.promise;};
  const setup = setupSession(config, {email: 'synthetic@example.invalid', readCode: () => {assert.fail('late fetch must not prompt');}}, {fetch}, abort.signal);
  abort.abort(); await assert.rejects(setup, (error: unknown) => error instanceof SdkError && error.body.error.code === 'cancelled');
  pending.resolve(new Response(JSON.stringify({code: 200}))); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(calls, 1);
});
void test('streamed account bytes are bounded even when no content length is supplied', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({start: controller => {controller.enqueue(new Uint8Array(2097152)); controller.enqueue(new Uint8Array(1));}, cancel: () => {cancelled = true;}});
  const fetch: typeof globalThis.fetch = () => Promise.resolve(new Response(stream));
  await assert.rejects(setupSession(config, {email: 'synthetic@example.invalid', readCode: () => Promise.resolve('123456')}, {fetch}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unsupported-capability');
  assert.equal(cancelled, true); assert.equal(stream.locked, false);
});
