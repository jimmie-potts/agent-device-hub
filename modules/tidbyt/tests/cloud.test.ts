// The cloud connection against a fake fetch (Hub #930). Copied from controllers/tidbyt/tests/connection.test.mjs at main
// 627e3fe3 and converted to the strict profile. Changes: a failed write no longer repeats `priorEffects: 'none'`, an
// uncertain one says whether the cloud answered, a listing is `list`, the declared capabilities went with the 1.x
// snapshot, and the credentials file's tests moved to the conversion's (`configuration.test.ts`), since the module reads
// its key from its own secret file.
import assert from 'node:assert/strict';
import test from 'node:test';
import {CloudConfigurationError, TidbytCloudConnection, type CloudConfig, type CloudFetch} from '../src/cloud.js';

const DEVICE = 'synthetic-device-id';
const KEY = 'synthetic-secret-key.abc';
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

type Call = {url: string; method: string; headers: Record<string, string>; body: string | undefined; redirect: string};
function fakeFetch(respond: (call: number, init: Parameters<CloudFetch>[1]) => Response | Promise<Response>): {fetch: CloudFetch; calls: Call[]} {
  const calls: Call[] = [];
  const fetch: CloudFetch = async (url, init) => {
    calls.push({url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect});
    return await respond(calls.length, init);
  };
  return {fetch, calls};
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}});
const connect = (fetch: CloudFetch, extra: Partial<CloudConfig> = {}): TidbytCloudConnection =>
  new TidbytCloudConnection({deviceId: DEVICE, apiKey: KEY, installationId: 'agentstatus', fetch, timeoutMs: 50, ...extra});
const signal = (): AbortSignal => new AbortController().signal;
const noSecrets = (value: unknown): void => {
  const text = JSON.stringify(value);
  assert.ok(!text.includes(KEY) && !text.includes(DEVICE), `leaked secret in ${text}`);
};

void test('a push is exactly one background POST with a bearer key and the configured installation', async () => {
  const {fetch, calls} = fakeFetch(() => json(200, {}));
  assert.deepEqual(await connect(fetch).push(WEBP, signal()), {outcome: 'sent'});
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call?.url, `https://api.tidbyt.com/v0/devices/${DEVICE}/push`);
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body ?? ''), {deviceID: DEVICE, image: Buffer.from(WEBP).toString('base64'), installationID: 'agentstatus', background: true});
});

void test('cloud responses map to typed outcomes without leaking credentials or bodies', async () => {
  const cases: [Response, unknown][] = [
    [json(401, {code: 16, message: `auth error for ${KEY}`}), {outcome: 'failed', failure: 'unauthenticated'}],
    [json(500, {code: 2, message: 'context doesn\'t have a UID', details: []}), {outcome: 'failed', failure: 'unauthenticated'}],
    [json(403, {}), {outcome: 'failed', failure: 'forbidden'}],
    [json(404, {message: DEVICE}), {outcome: 'failed', failure: 'unknown-device'}],
    [json(400, {}), {outcome: 'failed', failure: 'invalid-request'}],
    [json(413, {}), {outcome: 'failed', failure: 'invalid-request'}],
    [json(500, {code: 13, message: 'internal'}), {outcome: 'uncertain', answered: true}],
    [json(502, {}), {outcome: 'uncertain', answered: true}],
    [new Response('not json', {status: 503}), {outcome: 'uncertain', answered: true}],
  ];
  for (const [response, expected] of cases) {
    const {fetch} = fakeFetch(() => response);
    const result = await connect(fetch).push(WEBP, signal());
    assert.deepEqual(result, expected, `status ${response.status}`);
    noSecrets(result);
  }
});

void test('429 holds for Retry-After seconds or date, or a bounded default', async () => {
  const now = (): number => Date.parse('2026-09-23T05:00:00Z');
  const cases: [Record<string, string>, number][] = [
    [{'retry-after': '7'}, 7000],
    [{'retry-after': 'Wed, 23 Sep 2026 05:02:00 GMT'}, 120000],
    [{'retry-after': 'Wed, 23 Sep 2026 04:00:00 GMT'}, 1000],
    [{'retry-after': '999999'}, 900000],
    [{'retry-after': 'soon'}, 60000],
    [{}, 60000],
  ];
  for (const [headers, retryAfterMs] of cases) {
    const {fetch} = fakeFetch(() => json(429, {}, headers));
    assert.deepEqual(await connect(fetch, {now}).push(WEBP, signal()), {outcome: 'failed', failure: 'capacity', retryAfterMs});
  }
});

void test('a timeout or caller abort after dispatch is uncertain, with no answer', async () => {
  const hang = (_call: number, init: Parameters<CloudFetch>[1]): Promise<Response> =>
    new Promise((_, reject) => { init.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); }); });
  const {fetch} = fakeFetch(hang);
  assert.deepEqual(await connect(fetch).push(WEBP, signal()), {outcome: 'uncertain', answered: false});
  const controller = new AbortController();
  const pending = connect(fetch, {timeoutMs: 10000}).push(WEBP, controller.signal);
  controller.abort();
  assert.deepEqual(await pending, {outcome: 'uncertain', answered: false});
  // Without a backstop, only the caller's signal ends the wait, as the module's deadline on the runtime's scheduler does.
  const later = new AbortController();
  const waiting = new TidbytCloudConnection({deviceId: DEVICE, apiKey: KEY, installationId: 'agentstatus', fetch}).push(WEBP, later.signal);
  later.abort();
  assert.deepEqual(await waiting, {outcome: 'uncertain', answered: false});
});

void test('definite pre-send failures are transport failures; ambiguous network errors are uncertain', async () => {
  const failing = (code: string | undefined): CloudFetch => () => Promise.reject(new TypeError('fetch failed', {cause: Object.assign(new Error(`connect ${code ?? ''} ${DEVICE}`), {code})}));
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.deepEqual(await connect(failing(code)).push(WEBP, signal()), {outcome: 'failed', failure: 'transport-failure'}, code);
  }
  for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', undefined]) {
    assert.deepEqual(await connect(failing(code)).push(WEBP, signal()), {outcome: 'uncertain', answered: false}, String(code));
  }
});

void test('installation listings report presence only for the configured installation', async () => {
  const list = (ids: string[]): Response => json(200, {installations: ids.map(id => ({id, appID: id === 'agentstatus' ? '' : 'clock'}))});
  let faked = fakeFetch(() => list(['other', 'agentstatus']));
  assert.deepEqual(await connect(faked.fetch).list(signal()), {ok: true, present: true});
  assert.equal(faked.calls[0]?.method, 'GET');
  assert.equal(faked.calls[0]?.url, `https://api.tidbyt.com/v0/devices/${DEVICE}/installations`);
  assert.equal(faked.calls[0]?.body, undefined);
  faked = fakeFetch(() => list(['other']));
  assert.deepEqual(await connect(faked.fetch).list(signal()), {ok: true, present: false});
  faked = fakeFetch(() => json(401, {}));
  assert.deepEqual(await connect(faked.fetch).list(signal()), {ok: false, failure: 'unauthenticated', answered: true});
  faked = fakeFetch(() => json(200, {installations: 'nope'}));
  assert.deepEqual(await connect(faked.fetch).list(signal()), {ok: false, failure: 'transport-failure', answered: true});
  faked = fakeFetch(() => new Response('x'.repeat(70000), {status: 200}));
  assert.deepEqual(await connect(faked.fetch).list(signal()), {ok: false, failure: 'transport-failure', answered: true});
  faked = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
  assert.deepEqual(await connect(faked.fetch).list(signal()), {ok: false, failure: 'transport-failure', answered: false});
});

void test('invalid connection configuration is refused without echoing values', () => {
  const {fetch} = fakeFetch(() => json(200, {}));
  const bad: Partial<CloudConfig>[] = [
    {deviceId: ''}, {deviceId: 'a/b'}, {apiKey: ''}, {apiKey: `${KEY}\n`}, {installationId: 'has-dash'}, {installationId: ''}, {timeoutMs: 0},
  ];
  for (const config of bad) {
    assert.throws(() => connect(fetch, config), error => {
      assert.ok(error instanceof CloudConfigurationError);
      noSecrets({message: error.message, code: error.code});
      return true;
    });
  }
});

void test('a removal is exactly one DELETE of the configured installation', async () => {
  const {fetch, calls} = fakeFetch(() => json(200, {}));
  assert.deepEqual(await connect(fetch).remove(signal()), {outcome: 'sent'});
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call?.url, `https://api.tidbyt.com/v0/devices/${DEVICE}/installations/agentstatus`);
  assert.equal(call.method, 'DELETE');
  assert.equal(call.redirect, 'error');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.body, undefined);
});

void test('removal responses are classified like pushes and never retried', async () => {
  const cases: [Response, unknown][] = [
    [json(401, {message: KEY}), {outcome: 'failed', failure: 'unauthenticated'}],
    [json(429, {}, {'retry-after': '30'}), {outcome: 'failed', failure: 'capacity', retryAfterMs: 30_000}],
    [json(502, {}), {outcome: 'uncertain', answered: true}],
  ];
  for (const [response, expected] of cases) {
    const {fetch, calls} = fakeFetch(() => response);
    const result = await connect(fetch).remove(signal());
    assert.deepEqual(result, expected, `status ${response.status}`);
    assert.equal(calls.length, 1);
    noSecrets(result);
  }
  const timedOut = fakeFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
  assert.deepEqual(await connect(timedOut.fetch).remove(signal()), {outcome: 'uncertain', answered: false});
  assert.equal(timedOut.calls.length, 1);
});

void test('writes and listings can target a configured additional installation', async () => {
  const {fetch, calls} = fakeFetch(call => call === 3 ? json(200, {installations: [{id: 'agentstatus'}]}) : json(200, {}));
  const connection = connect(fetch, {additionalInstallationIds: ['nowplaying']});
  assert.deepEqual(connection.additionalInstallations, ['nowplaying']);
  assert.deepEqual(await connection.push(WEBP, signal(), 'nowplaying'), {outcome: 'sent'});
  assert.equal((JSON.parse(calls[0]?.body ?? '') as {installationID: string}).installationID, 'nowplaying');
  assert.deepEqual(await connection.remove(signal(), 'nowplaying'), {outcome: 'sent'});
  assert.equal(calls[1]?.url, `https://api.tidbyt.com/v0/devices/${DEVICE}/installations/nowplaying`);
  assert.deepEqual(await connection.list(signal(), 'nowplaying'), {ok: true, present: false});
  // Omitting the installation keeps the default target.
  assert.deepEqual(await connection.push(WEBP, signal()), {outcome: 'sent'});
  assert.equal((JSON.parse(calls[3]?.body ?? '') as {installationID: string}).installationID, 'agentstatus');
});

void test('an unlisted installation is refused without a request', async () => {
  const {fetch, calls} = fakeFetch(() => json(200, {installations: []}));
  const connection = connect(fetch, {additionalInstallationIds: ['nowplaying']});
  const refused = {outcome: 'failed', failure: 'invalid-request'};
  assert.deepEqual(await connection.push(WEBP, signal(), 'other'), refused);
  assert.deepEqual(await connection.remove(signal(), 'other'), refused);
  assert.deepEqual(await connection.list(signal(), 'other'), {ok: false, failure: 'invalid-request', answered: false});
  // The default installation is not an additional one, so it cannot be named explicitly.
  assert.deepEqual(await connection.push(WEBP, signal(), 'agentstatus'), refused);
  assert.deepEqual(await connect(fetch).push(WEBP, signal(), 'nowplaying'), refused);
  assert.equal(calls.length, 0);
});

void test('invalid additional installation IDs are refused', () => {
  const {fetch} = fakeFetch(() => json(200, {}));
  const cases: unknown[] = [['has-dash'], [''], ['agentstatus'], ['a', 'a'], ['a', 'b', 'c', 'd', 'e'], 'nowplaying', [1]];
  for (const additionalInstallationIds of cases) {
    assert.throws(() => connect(fetch, {additionalInstallationIds: additionalInstallationIds as string[]}), CloudConfigurationError);
  }
});
