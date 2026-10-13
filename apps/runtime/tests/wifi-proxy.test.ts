// Home-Wi-Fi entry admission uses the real runtime listener with synthetic proxy proof.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {request, type IncomingMessage} from 'node:http';
import type {TestContext} from 'node:test';
import {tokenDigest} from '../src/index.js';
import {checkEdgeSection} from '../src/state.js';
import {edgeConfig, it, manualClock, run, waitFor} from './support.js';

const ORIGIN = 'https://192.168.50.10:8443';
const PROOF = 'wifi_SYNTHETIC1111_abcdefghijklmnopqrstuvwxyz0123456789';
const HEADERS = {host: new URL(ORIGIN).host, origin: ORIGIN, 'bunny-wifi-proxy': PROOF, 'bunny-request': '1'};

// Native HTTP preserves an explicit Host, as the forwarder does; Node fetch replaces it.
function call(url: string, init: {method?: string; headers?: Record<string, string>; body?: string} = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const sent = request(url, {...init, headers: {...(init.body === undefined ? {} : {'content-type': 'application/json'}), ...init.headers}}, response => {
      let text = '';
      response.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) for (const part of Array.isArray(value) ? value : [value]) headers.append(key, part);
        }
        resolve(new Response(text, {status: response.statusCode ?? 500, headers}));
      });
      response.once('error', reject);
    });
    sent.once('error', reject);
    sent.end(init.body);
  });
}

async function start(context: TestContext, wifi = true) {
  const files = await edgeConfig(context, [{source: 'bunny/parts/reader', token: 'reader_SYNTHETIC1111', scopes: ['read']}], {browserAccess: 'trusted-loopback'});
  const document = JSON.parse(await readFile(files.config, 'utf8')) as {edge: Record<string, unknown>};
  if (wifi) document.edge.wifiProxy = {origin: ORIGIN, tokenDigest: tokenDigest(PROOF)};
  document.edge.launcher = false;
  await writeFile(files.config, JSON.stringify(document));
  const clock = manualClock(Date.now());
  const result = await run(context, {modules: [], configFile: files.config, edge: {schemas: {}}, clock, scheduler: clock.scheduler});
  return {...result, clock};
}

it('Wi-Fi proxy opens an HTTPS owner session while preserving local clients', async context => {
  const {runtime, logs} = await start(context);
  const signIn = await call(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers: HEADERS, body: '{}'});
  assert.equal(signIn.status, 200, await signIn.text());
  const cookie = signIn.headers.get('set-cookie');
  assert.ok(cookie !== null);
  assert.match(cookie, /; Secure(?:;|$)/);
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=28800/);
  const session = cookie.split(';')[0] ?? '';
  const read = await call(`${runtime.url}/api/v2/build`, {headers: {...HEADERS, cookie: session}});
  assert.equal(read.status, 200, await read.text());
  const local = await call(`${runtime.url}/api/v2/build`, {headers: {authorization: 'Bearer reader_SYNTHETIC1111'}});
  assert.equal(local.status, 200, await local.text());
  const localSignIn = await call(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers: {origin: runtime.url, 'bunny-request': '1'}, body: '{}'});
  assert.equal(localSignIn.status, 200);
  assert.doesNotMatch(localSignIn.headers.get('set-cookie') ?? '', /; Secure(?:;|$)/);
  const logout = await call(`${runtime.url}/api/v2/browser/logout`, {method: 'POST', headers: {...HEADERS, cookie: session}, body: '{}'});
  assert.equal(logout.status, 200, await logout.text());
  assert.match(logout.headers.get('set-cookie') ?? '', /; Secure(?:;|$)/);
  const ended = await call(`${runtime.url}/api/v2/build`, {headers: {...HEADERS, cookie: session}});
  assert.equal(ended.status, 401, await ended.text());
  assert.equal(JSON.stringify(logs).includes(PROOF), false);
});

it('Wi-Fi admission rejects missing proof, wrong hosts and foreign browser contexts', async context => {
  const {runtime, logs} = await start(context);
  const cases: Record<string, string>[] = [
    {host: HEADERS.host, origin: ORIGIN, 'bunny-request': '1'},
    {...HEADERS, 'bunny-wifi-proxy': 'forged'},
    {...HEADERS, 'bunny-wifi-proxy': 'x'.repeat(PROOF.length)},
    {...HEADERS, host: 'other.invalid:8443'},
    {...HEADERS, host: new URL(runtime.url).host},
    {...HEADERS, origin: 'https://other.invalid'},
    {...HEADERS, 'sec-fetch-site': 'cross-site'},
    {...HEADERS, 'bunny-request': '0'},
    {host: HEADERS.host, origin: ORIGIN, 'bunny-request': '1', 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'https'},
    {...HEADERS, authorization: 'Bearer reader_SYNTHETIC1111'},
  ];
  for (const headers of cases) {
    const answer = await call(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers, body: '{}'});
    assert.equal(answer.status, 403, await answer.text());
    assert.equal(answer.headers.get('set-cookie'), null);
  }
  assert.equal((await call(`${runtime.url}/api/v2/modules`, {headers: HEADERS})).status, 401);
  const signed = await call(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers: HEADERS, body: '{}'});
  const cookie = signed.headers.get('set-cookie')?.split(';')[0] ?? '';
  const foreign = await call(`${runtime.url}/api/v2/modules`, {headers: {...HEADERS, cookie, origin: 'https://other.invalid'}});
  assert.equal(foreign.status, 403);
  for (const [path, method] of [['/api/runtime/v1/health', 'GET'], ['/mcp', 'POST'], ['/api/v2/browser/launch', 'POST']] as const) {
    const answer = await call(`${runtime.url}${path}`, {method, headers: {...HEADERS, cookie}, ...(method === 'POST' ? {body: '{}'} : {})});
    assert.ok([403, 404].includes(answer.status), `${path}: ${await answer.text()}`);
  }
  assert.equal(JSON.stringify(logs).includes(PROOF), false);
});

it('removing Wi-Fi configuration refuses that entry and leaves local access intact', async context => {
  const {runtime} = await start(context, false);
  assert.equal((await call(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers: HEADERS, body: '{}'})).status, 403);
  assert.equal((await call(`${runtime.url}/api/runtime/v1/health`)).status, 200);
  assert.equal((await call(`${runtime.url}/api/v2/build`, {headers: {authorization: 'Bearer reader_SYNTHETIC1111'}})).status, 200);
});

it('Wi-Fi logout and eight-hour expiry end existing SDK streams', async context => {
  const {runtime, clock} = await start(context);
  for (const end of ['logout', 'expire'] as const) {
    const signed = await call(`${runtime.url}/api/v2/browser/session`, {method: 'POST', headers: HEADERS, body: '{}'});
    const cookie = signed.headers.get('set-cookie')?.split(';')[0] ?? '';
    let closed = false;
    const stream = await new Promise<IncomingMessage>((resolve, reject) => {
      const sent = request(`${runtime.url}/api/sdk/v1/stream`, {headers: {...HEADERS, cookie}}, response => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`stream status ${response.statusCode}`)); return; }
        let text = '';
        response.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; if (text.includes('event: ready')) resolve(response); });
        response.on('close', () => { closed = true; });
      });
      sent.once('error', reject);
      sent.end();
    });
    context.after(() => { stream.destroy(); });
    if (end === 'logout') {
      assert.equal((await call(`${runtime.url}/api/v2/browser/logout`, {method: 'POST', headers: {...HEADERS, cookie}, body: '{}'})).status, 200);
    } else clock.advance(8 * 60 * 60 * 1000);
    await waitFor(() => closed);
    assert.equal((await call(`${runtime.url}/api/v2/modules`, {headers: {...HEADERS, cookie}})).status, 401);
  }
});

it('Wi-Fi configuration requires one canonical HTTPS origin and a secret digest', () => {
  const base = {credentials: '/private/credentials.json', wifiProxy: {origin: ORIGIN, tokenDigest: tokenDigest(PROOF)}};
  assert.equal(checkEdgeSection(base).wifiProxy?.origin, ORIGIN);
  for (const wifiProxy of [null, {}, {...base.wifiProxy, tokenDigest: PROOF}, {...base.wifiProxy, other: true},
    ...['http://192.168.50.10:8443', `${ORIGIN}/`, `${ORIGIN}/path`, `${ORIGIN}?q=1`, `${ORIGIN}#fragment`, 'https://user:pass@192.168.50.10:8443']
      .map(origin => ({...base.wifiProxy, origin}))]) {
    assert.throws(() => checkEdgeSection({...base, wifiProxy}), {code: 'config-invalid'});
  }
});
