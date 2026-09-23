import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TidbytCloudConnection, loadTidbytCredentials, TidbytConfigurationError } from '../dist/index.js';

const DEVICE = 'synthetic-device-id';
const KEY = 'synthetic-secret-key.abc';
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
    return respond(calls.length, init);
  };
  return { fetch, calls };
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const connect = (fetch, extra = {}) => new TidbytCloudConnection({ deviceId: DEVICE, apiKey: KEY, installationId: 'agentstatus', fetch, timeoutMs: 50, ...extra });
const signal = () => new AbortController().signal;
const noSecrets = value => {
  const text = JSON.stringify(value);
  assert(!text.includes(KEY) && !text.includes(DEVICE), `leaked secret in ${text}`);
};

test('a push is exactly one background POST with a bearer key and the configured installation', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, {}));
  const result = await connect(fetch).push(WEBP, signal());
  assert.deepEqual(result, { outcome: 'sent' });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, `https://api.tidbyt.com/v0/devices/${DEVICE}/push`);
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body), {
    deviceID: DEVICE, image: Buffer.from(WEBP).toString('base64'), installationID: 'agentstatus', background: true,
  });
});

test('declared capabilities are backend facts, with foreground pushes unsupported', () => {
  const { fetch } = fakeFetch(() => json(200, {}));
  assert.deepEqual(connect(fetch).capabilities, {
    backend: 'tidbyt-cloud',
    backgroundPush: { supported: true },
    foregroundPush: { supported: false },
    installationRead: { supported: true },
    installationRemove: { supported: true },
  });
});

test('cloud responses map to typed outcomes without leaking credentials or bodies', async () => {
  const cases = [
    [json(401, { code: 16, message: `auth error for ${KEY}` }), { outcome: 'failed', failure: 'unauthenticated', priorEffects: 'none' }],
    [json(500, { code: 2, message: "context doesn't have a UID", details: [] }), { outcome: 'failed', failure: 'unauthenticated', priorEffects: 'none' }],
    [json(403, {}), { outcome: 'failed', failure: 'forbidden', priorEffects: 'none' }],
    [json(404, { message: DEVICE }), { outcome: 'failed', failure: 'unknown-device', priorEffects: 'none' }],
    [json(400, {}), { outcome: 'failed', failure: 'invalid-request', priorEffects: 'none' }],
    [json(413, {}), { outcome: 'failed', failure: 'invalid-request', priorEffects: 'none' }],
    [json(500, { code: 13, message: 'internal' }), { outcome: 'uncertain' }],
    [json(502, {}), { outcome: 'uncertain' }],
    [new Response('not json', { status: 503 }), { outcome: 'uncertain' }],
  ];
  for (const [response, expected] of cases) {
    const { fetch } = fakeFetch(() => response);
    const result = await connect(fetch).push(WEBP, signal());
    assert.deepEqual(result, expected, `status ${response.status}`);
    noSecrets(result);
  }
});

test('429 holds for Retry-After seconds or date, or a bounded default', async () => {
  const now = () => Date.parse('2026-09-23T05:00:00Z');
  const cases = [
    [{ 'retry-after': '7' }, 7000],
    [{ 'retry-after': 'Wed, 23 Sep 2026 05:02:00 GMT' }, 120000],
    [{ 'retry-after': 'Wed, 23 Sep 2026 04:00:00 GMT' }, 1000],
    [{ 'retry-after': '999999' }, 900000],
    [{ 'retry-after': 'soon' }, 60000],
    [{}, 60000],
  ];
  for (const [headers, retryAfterMs] of cases) {
    const { fetch } = fakeFetch(() => json(429, {}, headers));
    assert.deepEqual(await connect(fetch, { now }).push(WEBP, signal()),
      { outcome: 'failed', failure: 'capacity', priorEffects: 'none', retryAfterMs });
  }
});

test('a timeout or caller abort after dispatch is uncertain', async () => {
  const hang = (_n, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const { fetch } = fakeFetch(hang);
  assert.deepEqual(await connect(fetch).push(WEBP, signal()), { outcome: 'uncertain' });
  const controller = new AbortController();
  const pending = connect(fetch, { timeoutMs: 10000 }).push(WEBP, controller.signal);
  controller.abort();
  assert.deepEqual(await pending, { outcome: 'uncertain' });
});

test('definite pre-send failures are transport failures; ambiguous network errors are uncertain', async () => {
  const failing = code => async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code} ${DEVICE}`), { code }) }); };
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
    const result = await connect(failing(code)).push(WEBP, signal());
    assert.deepEqual(result, { outcome: 'failed', failure: 'transport-failure', priorEffects: 'none' }, code);
  }
  for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', undefined]) {
    assert.deepEqual(await connect(failing(code)).push(WEBP, signal()), { outcome: 'uncertain' }, String(code));
  }
});

test('installation reads report presence only for the configured installation', async () => {
  const list = ids => json(200, { installations: ids.map(id => ({ id, appID: id === 'agentstatus' ? '' : 'clock' })) });
  let { fetch, calls } = fakeFetch(() => list(['other', 'agentstatus']));
  assert.deepEqual(await connect(fetch).readInstallation(signal()), { ok: true, present: true });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, `https://api.tidbyt.com/v0/devices/${DEVICE}/installations`);
  assert.equal(calls[0].body, undefined);
  ({ fetch } = fakeFetch(() => list(['other'])));
  assert.deepEqual(await connect(fetch).readInstallation(signal()), { ok: true, present: false });
  ({ fetch } = fakeFetch(() => json(401, {})));
  assert.deepEqual(await connect(fetch).readInstallation(signal()), { ok: false, failure: 'unauthenticated' });
  ({ fetch } = fakeFetch(() => json(200, { installations: 'nope' })));
  assert.deepEqual(await connect(fetch).readInstallation(signal()), { ok: false, failure: 'transport-failure' });
  ({ fetch } = fakeFetch(() => new Response('x'.repeat(70000), { status: 200 })));
  assert.deepEqual(await connect(fetch).readInstallation(signal()), { ok: false, failure: 'transport-failure' });
});

test('invalid connection configuration is rejected without echoing values', () => {
  const { fetch } = fakeFetch(() => json(200, {}));
  const bad = [
    { deviceId: '', apiKey: KEY, installationId: 'agentstatus' },
    { deviceId: 'a/b', apiKey: KEY, installationId: 'agentstatus' },
    { deviceId: DEVICE, apiKey: '', installationId: 'agentstatus' },
    { deviceId: DEVICE, apiKey: `${KEY}\n`, installationId: 'agentstatus' },
    { deviceId: DEVICE, apiKey: KEY, installationId: 'has-dash' },
    { deviceId: DEVICE, apiKey: KEY, installationId: '' },
    { deviceId: DEVICE, apiKey: KEY, installationId: 'agentstatus', timeoutMs: 0 },
  ];
  for (const config of bad) {
    assert.throws(() => new TidbytCloudConnection({ fetch, ...config }), error => {
      assert(error instanceof TidbytConfigurationError);
      noSecrets({ message: error.message, code: error.code });
      return true;
    });
  }
});

test('credentials load only from a private file and never echo its contents', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tidbyt-credentials-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'tidbyt.env');
  const write = (text, mode = 0o600) => { writeFileSync(file, text); chmodSync(file, mode); };
  write(`# comment\nTIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY="${KEY}"\n`);
  assert.deepEqual(loadTidbytCredentials(file), { deviceId: DEVICE, apiKey: KEY, installationId: 'agentdevicehub' });
  write(`TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nTIDBYT_INSTALLATION_ID=agentstatus\n`);
  assert.equal(loadTidbytCredentials(file).installationId, 'agentstatus');
  const expectCode = (code) => assert.throws(() => loadTidbytCredentials(file), error => {
    assert(error instanceof TidbytConfigurationError);
    assert.equal(error.code, code);
    noSecrets({ message: error.message, code: error.code, stack: error.stack });
    return true;
  });
  if (process.platform !== 'win32') {
    write(`TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\n`, 0o640);
    expectCode('credentials-permissions');
  }
  write(`TIDBYT_DEVICE_ID=${DEVICE}\n`);
  expectCode('credentials-invalid');
  write(`TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nTIDBYT_API_KEY=${KEY}\n`);
  expectCode('credentials-invalid');
  write(`TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nTIDBYT_INSTALLATION_ID=bad-id\n`);
  expectCode('credentials-invalid');
  write(`TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nOTHER=${KEY}\n`);
  expectCode('credentials-invalid');
  rmSync(file);
  expectCode('credentials-unreadable');
});

test('a removal is exactly one DELETE of the configured installation', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, {}));
  const result = await connect(fetch).remove(signal());
  assert.deepEqual(result, { outcome: 'sent' });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, `https://api.tidbyt.com/v0/devices/${DEVICE}/installations/agentstatus`);
  assert.equal(call.method, 'DELETE');
  assert.equal(call.redirect, 'error');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.body, undefined);
});

test('removal responses are classified like pushes and never retried', async () => {
  const cases = [
    [json(401, { message: KEY }), { outcome: 'failed', failure: 'unauthenticated', priorEffects: 'none' }],
    [json(429, {}, { 'retry-after': '30' }), { outcome: 'failed', failure: 'capacity', priorEffects: 'none', retryAfterMs: 30_000 }],
    [json(502, {}), { outcome: 'uncertain' }],
  ];
  for (const [response, expected] of cases) {
    const { fetch, calls } = fakeFetch(() => response);
    const result = await connect(fetch).remove(signal());
    assert.deepEqual(result, expected, `status ${response.status}`);
    assert.equal(calls.length, 1);
    noSecrets(result);
  }
  const timedOut = fakeFetch(() => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
  assert.deepEqual(await connect(timedOut.fetch).remove(signal()), { outcome: 'uncertain' });
  assert.equal(timedOut.calls.length, 1);
});
