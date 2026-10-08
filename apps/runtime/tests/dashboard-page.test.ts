// The dashboard's page on the runtime's gateway (Hub #922): `/`, `/dashboard.js` and `/dashboard.css`, the old Hub's
// paths, loaded without a session from this origin's own pages, a bookmark or the launcher, and the page alone from a
// link on another local app's page (Hub #561). Every other context, method and query is refused with the shared error
// body and recorded with the route's template. The dashboard's own browser suites drive the real bundle.
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {request as httpRequest, type IncomingMessage} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {pathToFileURL} from 'node:url';
import type {LogRecord} from '../src/index.js';
import {edgeConfig, it, run} from './support.js';

const PAGE = '<!doctype html><title>B.U.N.N.Y.</title><script type="module" src="/dashboard.js"></script>';

/** A built dashboard's three files in a private folder, or an empty folder for one that is not built. */
async function built(context: TestContext, files = true): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-dashboard-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  if (files) {
    await writeFile(join(dir, 'index.html'), PAGE);
    await writeFile(join(dir, 'dashboard.js'), 'export {};\n');
    await writeFile(join(dir, 'dashboard.css'), 'body{margin:0}\n');
  }
  return pathToFileURL(`${dir}/`);
}

async function gateway(context: TestContext, files = true): Promise<{url: string; logs: () => readonly LogRecord[]; sessions: () => number}> {
  const {config} = await edgeConfig(context, [], {browserAccess: 'trusted-loopback'});
  const {runtime, logs} = await run(context, {modules: [], configFile: config, edge: {schemas: {}, dashboard: await built(context, files)}});
  return {url: runtime.url, logs: () => logs, sessions: () => runtime.gateway()?.access.counts().sessions ?? 0};
}

type Answer = {status: number; headers: Headers; text: string; code?: unknown};
/** One raw request, so the fetch metadata is what a browser would send: fetch would set its own `sec-fetch-mode`. */
function get(url: string, path: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(new URL(path, url), {method, headers}, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const answered = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) answered.set(name, typeof value === 'string' ? value : value.join(', '));
        let code: unknown;
        try {
          code = (JSON.parse(text) as {error?: {code?: unknown}}).error?.code;
        } catch {
          code = undefined;
        }
        resolve({status: response.statusCode ?? 0, headers: answered, text, code});
      });
      response.on('error', reject);
    });
    sent.on('error', reject);
    sent.end(body);
  });
}

it('the page and its assets load without a session from a bookmark, the launcher and this origin\'s own page, with the page\'s policy', async context => {
  const {url} = await gateway(context);
  const page = await get(url, '/');
  assert.equal(page.status, 200, 'a bookmark: no Origin and no fetch metadata');
  assert.equal(page.text, PAGE);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('set-cookie'), null, 'loading the page signs nobody in');
  for (const [name, value] of [
    ['x-frame-options', 'DENY'], ['cross-origin-opener-policy', 'same-origin'], ['x-content-type-options', 'nosniff'], ['cache-control', 'no-store'],
    ['referrer-policy', 'no-referrer'],
  ] as const) assert.equal(page.headers.get(name), value, name);
  const policy = page.headers.get('content-security-policy') ?? '';
  for (const directive of ['default-src \'none\'', 'script-src \'self\'', 'connect-src \'self\'', 'frame-ancestors \'none\'', 'base-uri \'none\'']) {
    assert.ok(policy.includes(directive), directive);
  }
  assert.equal((await get(url, '/', {'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document'})).status, 200, 'the launcher and a typed address');
  const script = await get(url, '/dashboard.js', {'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'script'});
  assert.deepEqual([script.status, script.headers.get('content-type')], [200, 'text/javascript; charset=utf-8']);
  const style = await get(url, '/dashboard.css', {'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'style'});
  assert.deepEqual([style.status, style.headers.get('content-type')], [200, 'text/css; charset=utf-8']);
  // A bookmark on the other loopback name loads the same page (Hub #276).
  const localhost = url.replace('127.0.0.1', 'localhost');
  assert.equal((await get(localhost, '/', {'sec-fetch-site': 'same-origin', origin: localhost})).status, 200);
  // Only the three paths are the dashboard's: nothing else in its built folder, or beside it, is served.
  for (const path of ['/index.html', '/dashboard.js.map', '/../package.json', '/dashboard.css/', '/dashboard']) {
    assert.notEqual((await get(url, path)).status, 200, path);
  }
});

it('the page alone opens from another local app\'s link; other sites, frames, fetches, other methods and queries are refused', async context => {
  const {url, logs} = await gateway(context);
  const linked = {'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document'};
  assert.equal((await get(url, '/', linked)).status, 200, 'a link on the wall\'s page, a same-site top-level navigation');
  const cases: [string, string, Record<string, string>, string, number, string][] = [
    ['an asset from that link', '/dashboard.js', linked, 'GET', 403, 'forbidden'],
    ['a frame on another local app', '/', {...linked, 'sec-fetch-dest': 'iframe'}, 'GET', 403, 'forbidden'],
    ['a fetch from another local app', '/', {'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty'}, 'GET', 403, 'forbidden'],
    ['a link from another site', '/', {...linked, 'sec-fetch-site': 'cross-site'}, 'GET', 403, 'forbidden'],
    ['a page on another site', '/', {origin: 'http://pages.invalid'}, 'GET', 403, 'forbidden'],
    ['a link that names an Origin', '/', {...linked, origin: 'http://127.0.0.1:1'}, 'GET', 403, 'forbidden'],
    ['the other loopback name\'s page', '/', {origin: url.replace('127.0.0.1', 'localhost'), 'sec-fetch-site': 'same-site'}, 'GET', 403, 'forbidden'],
    ['a change', '/', {}, 'POST', 404, 'not-found'],
    ['a query', '/?page=1', {}, 'GET', 400, 'invalid-request'],
  ];
  for (const [what, path, headers, method, status, code] of cases) {
    const answer = await get(url, path, headers, method);
    assert.deepEqual([answer.status, answer.code], [status, code], what);
    assert.equal(answer.headers.get('content-type'), 'application/json', `${what}: the shared error body`);
  }
  const refused = logs().filter(record => record.event_name === 'runtime.edge.refused');
  assert.deepEqual([...new Set(refused.map(record => record.attributes['http.route']))].sort(), ['/', '/dashboard.js']);
  assert.ok(refused.every(record => record.attributes['bunny.route'] === 'other' && record.attributes['bunny.participant'] === undefined));
  assert.ok(refused.some(record => record.attributes['bunny.code'] === 'forbidden' && record.severity_text === 'WARN'));
  assert.equal(JSON.stringify(refused).includes('page=1'), false, 'a record names the route, never the query');
});

it('a runtime whose dashboard is not built answers not-found on its paths, and every other route as before', async context => {
  const {url} = await gateway(context, false);
  for (const path of ['/', '/dashboard.js', '/dashboard.css']) {
    const answer = await get(url, path);
    assert.deepEqual([answer.status, answer.code], [404, 'not-found'], path);
    assert.match(answer.text, /the dashboard is not built/);
  }
});

/** A trusted loopback sign-in from this origin's page, with the browser's cookie if it has one; its new cookie. */
async function signIn(url: string, cookie?: string): Promise<string> {
  const origin = url;
  const answer = await get(url, '/api/v2/browser/session', {
    origin, 'sec-fetch-site': 'same-origin', 'bunny-request': '1', 'content-type': 'application/json', 'content-length': '2',
    ...(cookie === undefined ? {} : {cookie}),
  }, 'POST', '{}');
  assert.equal(answer.status, 200);
  return (answer.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
const authority = async (url: string, cookie: string): Promise<number> => (await get(url, '/api/v2/authority?scope=read', {cookie, 'sec-fetch-site': 'same-origin'})).status;

it('a new sign-in ends the session the browser\'s cookie names, with its streams, so no session outlives every cookie', async context => {
  const {url, sessions} = await gateway(context);
  const first = await signIn(url);
  // The first session holds an SDK stream, as a dashboard tab does.
  const stream = await new Promise<IncomingMessage>((resolve, reject) => {
    const sent = httpRequest(new URL('/api/sdk/v1/stream', url), {headers: {cookie: first, 'sec-fetch-site': 'same-origin', 'bunny-source': 'bunny/parts/dashboard'}}, resolve);
    sent.on('error', reject);
    sent.end();
  });
  assert.equal(stream.statusCode, 200);
  const ended = new Promise<void>(resolve => { stream.on('close', () => { resolve(); }); stream.resume(); });
  // Another tab signs in again with the same cookie: the session the cookie named ends, and its stream with it.
  const second = await signIn(url, first);
  await ended;
  assert.deepEqual([await authority(url, first), await authority(url, second), sessions()], [401, 200, 1]);
  // A cookie that names no live session is no obstacle: the sign-in opens a new one.
  const third = await signIn(url, 'bunny-session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.deepEqual([await authority(url, second), await authority(url, third), sessions()], [200, 200, 2]);
});
