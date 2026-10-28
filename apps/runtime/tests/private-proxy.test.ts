import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {request, type IncomingMessage} from 'node:http';
import type {TestContext} from 'node:test';
import {tokenDigest} from '../src/index.js';
import {checkEdgeSection} from '../src/state.js';
import {edgeConfig, it, manualClock, run, waitFor} from './support.js';

const ORIGIN = 'https://hub.synthetic-tailnet.ts.net';
const PROOF = 'private_SYNTHETIC1117_abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN = 'reader_SYNTHETIC1117';
const ENTRY = {host: new URL(ORIGIN).host, 'bunny-private-proxy': PROOF};
const BROWSER = {...ENTRY, origin: ORIGIN, 'bunny-request': '1'};
const MACHINE = {...ENTRY, authorization: 'Bearer ' + TOKEN};

function call(url: string, init: {method?: string; headers?: Record<string, string>; body?: string} = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const sent = request(url, {...init, headers: {...(init.body === undefined ? {} : {'content-type': 'application/json'}), ...init.headers}}, response => {
      let text = '';
      response.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) for (const part of Array.isArray(value) ? value : [value]) headers.append(name, part);
        }
        resolve(new Response(text, {status: response.statusCode ?? 500, headers}));
      });
      response.once('error', reject);
    });
    sent.once('error', reject);
    sent.end(init.body);
  });
}

async function start(context: TestContext, enabled = true) {
  const files = await edgeConfig(context, [{source: 'bunny/parts/reader', token: TOKEN, scopes: ['read']}]);
  await writeFile(files.config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}, edge: {
    credentials: files.credentials, browserAccess: 'trusted-loopback', launcher: false, mcp: true,
    ...(enabled ? {privateProxy: {origin: ORIGIN, tokenDigest: tokenDigest(PROOF)}} : {}),
  }}));
  const clock = manualClock(Date.now());
  const result = await run(context, {modules: [], configFile: files.config, edge: {schemas: {}}, clock, scheduler: clock.scheduler});
  return {...result, clock, credentials: files.credentials};
}

it('a private browser checks its session without challenging or extending its password login', async context => {
  const {runtime, clock} = await start(context);
  const check = (headers: Record<string, string> = BROWSER) => call(runtime.url + '/api/v2/browser/check', {method: 'POST', headers, body: '{}'});
  const absent = await check();
  assert.equal(absent.status, 200, 'an absent application session must not invalidate HTTP Basic credentials');
  assert.deepEqual(await absent.json(), {schema: 'browser-session/2.0', active: false});
  assert.equal(absent.headers.get('set-cookie'), null);
  const signed = await call(runtime.url + '/api/v2/browser/session', {method: 'POST', headers: BROWSER, body: '{}'});
  const cookie = signed.headers.get('set-cookie')?.split(';')[0] ?? '';
  const headers = {...BROWSER, cookie};
  clock.advance(8 * 60 * 60 * 1000 - 1);
  const live = await check(headers);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), {schema: 'browser-session/2.0', active: true});
  assert.equal(live.headers.get('set-cookie'), null, 'checking preserves the existing session and its expiry');
  clock.advance(1);
  const expired = await check(headers);
  assert.equal(expired.status, 200);
  assert.deepEqual(await expired.json(), {schema: 'browser-session/2.0', active: false});
  assert.equal((await call(runtime.url + '/api/v2/build', {headers})).status, 401, 'protected reads still refuse expired sessions');
  for (const refused of [{...BROWSER, origin: 'https://other.invalid'}, {...BROWSER, 'bunny-private-proxy': 'forged'}, {...BROWSER, ...MACHINE}]) {
    assert.equal((await check(refused)).status, 403);
  }
});

it('private HTTPS admits owner sessions and scoped clients while preserving local access', async context => {
  const {runtime, logs} = await start(context);
  const signed = await call(runtime.url + '/api/v2/browser/session', {method: 'POST', headers: BROWSER, body: '{}'});
  assert.equal(signed.status, 200, await signed.text());
  const cookie = signed.headers.get('set-cookie');
  assert.ok(cookie !== null);
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: {...BROWSER, cookie: cookie.split(';')[0] ?? ''}})).status, 200);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: MACHINE})).status, 200);
  assert.equal((await call(runtime.url + '/api/v2/authority?scope=control', {headers: MACHINE})).status, 403);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: {authorization: 'Bearer ' + TOKEN}})).status, 200);
  const local = await call(runtime.url + '/api/v2/browser/session', {method: 'POST', headers: {origin: runtime.url, 'bunny-request': '1'}, body: '{}'});
  assert.equal(local.status, 200);
  assert.doesNotMatch(local.headers.get('set-cookie') ?? '', /Secure/);
  for (const secret of [PROOF, TOKEN, ORIGIN]) assert.equal(JSON.stringify(logs).includes(secret), false);
});

it('private admission refuses forged proof, alternate hosts and browser bearer use', async context => {
  const {runtime} = await start(context);
  const cases: Record<string, string>[] = [
    {host: ENTRY.host}, {...ENTRY, 'bunny-private-proxy': 'forged'},
    {...ENTRY, 'bunny-private-proxy': 'x'.repeat(PROOF.length)}, {...ENTRY, host: 'other.invalid'},
    {...ENTRY, host: new URL(runtime.url).host}, {...ENTRY, 'bunny-wifi-proxy': PROOF},
    {host: ENTRY.host, 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'https', 'tailscale-user-login': 'owner@example.invalid'},
    {...MACHINE, origin: ORIGIN}, {...MACHINE, 'sec-fetch-site': 'same-origin'},
  ];
  for (const headers of cases) assert.equal((await call(runtime.url + '/api/v2/build', {headers})).status, 403);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: ENTRY})).status, 401);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: {...MACHINE, authorization: 'Bearer invalid'}})).status, 401);
  for (const headers of [{...BROWSER, origin: 'https://other.invalid'}, {...BROWSER, 'sec-fetch-site': 'cross-site'},
    {...BROWSER, authorization: 'Bearer ' + TOKEN}]) {
    const response = await call(runtime.url + '/api/v2/browser/session', {method: 'POST', headers, body: '{}'});
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  for (const path of ['/api/runtime/v1/health', '/mcp', '/api/v2/browser/launch']) {
    assert.equal((await call(runtime.url + path, {method: 'POST', headers: MACHINE, body: '{}'})).status, 403);
  }
});

it('removing private access refuses its entry while local clients remain usable', async context => {
  const {runtime} = await start(context, false);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: MACHINE})).status, 403);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: {authorization: 'Bearer ' + TOKEN}})).status, 200);
});

async function stream(context: TestContext, url: string, headers: Record<string, string>) {
  let closed = false;
  const incoming = await new Promise<IncomingMessage>((resolve, reject) => {
    const sent = request(url + '/api/sdk/v1/stream', {headers}, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('stream status ' + response.statusCode)); return; }
      let text = '';
      response.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; if (text.includes('event: ready')) resolve(response); });
      response.on('close', () => { closed = true; });
    });
    sent.once('error', reject).end();
  });
  context.after(() => { incoming.destroy(); });
  return () => closed;
}

it('private browser logout and expiry end SDK streams and further access', async context => {
  const {runtime, clock} = await start(context);
  for (const end of ['logout', 'expire']) {
    const signed = await call(runtime.url + '/api/v2/browser/session', {method: 'POST', headers: BROWSER, body: '{}'});
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get('set-cookie')?.split(';')[0] ?? '';
    const headers = {...BROWSER, cookie};
    const closed = await stream(context, runtime.url, headers);
    if (end === 'logout') assert.equal((await call(runtime.url + '/api/v2/browser/logout', {method: 'POST', headers, body: '{}'})).status, 200);
    else clock.advance(8 * 60 * 60 * 1000);
    await waitFor(closed);
    assert.equal((await call(runtime.url + '/api/v2/build', {headers})).status, 401);
  }
});

it('private machine revocation ends its SDK stream and rejects later calls', async context => {
  const {runtime, credentials} = await start(context);
  const closed = await stream(context, runtime.url, MACHINE);
  await writeFile(credentials, JSON.stringify({schema: 'edge-credentials/1.0', credentials: []}));
  await runtime.reload();
  await waitFor(closed);
  assert.equal((await call(runtime.url + '/api/v2/build', {headers: MACHINE})).status, 401);
});

it('private entry refuses administrative and device-role credentials even after reload', async context => {
  const {runtime, credentials} = await start(context);
  for (const grant of [
    {id: 'administrator', source: 'bunny/parts/administrator', scopes: ['read', 'admin']},
    {id: 'device-link', source: 'bunny/parts/bb8-windows', scopes: [], role: 'bb8-link', robotId: 'synthetic'},
  ]) {
    await writeFile(credentials, JSON.stringify({schema: 'edge-credentials/1.0', credentials: [{...grant, digest: tokenDigest(TOKEN)}]}));
    await runtime.reload();
    assert.equal((await call(runtime.url + '/api/v2/build', {headers: MACHINE})).status, 403);
    await assert.rejects(stream(context, runtime.url, MACHINE), {message: 'stream status 403'});
    for (const route of ['sync', 'publish', 'request']) {
      assert.equal((await call(runtime.url + '/api/sdk/v1/' + route, {method: 'POST', headers: MACHINE, body: '{}'})).status, 403);
    }
  }
});

it('private entry configuration requires canonical HTTPS and a digest', () => {
  const base = {credentials: '/private/credentials.json', privateProxy: {origin: ORIGIN, tokenDigest: tokenDigest(PROOF)}};
  assert.doesNotThrow(() => checkEdgeSection(base));
  for (const privateProxy of [null, {}, {...base.privateProxy, tokenDigest: PROOF}, {...base.privateProxy, extra: true},
    ...['http://hub.invalid', ORIGIN + '/', ORIGIN + '/path', ORIGIN + '?q=1', ORIGIN + '#fragment', 'https://user:pass@hub.invalid']
      .map(origin => ({...base.privateProxy, origin}))]) {
    assert.throws(() => checkEdgeSection({...base, privateProxy}), {code: 'config-invalid'});
  }
});
