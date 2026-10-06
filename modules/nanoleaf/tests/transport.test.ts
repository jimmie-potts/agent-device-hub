// The port's own tests of the Nanoleaf HTTP client (transport.py has no test file of its own). lightRequest is checked
// with a fake transport; nodeTransport against stub HTTP servers on the loopback interface. No light is contacted.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {TestContext} from 'node:test';
import {promisify} from 'node:util';
import {pyJson} from '../src/compat.js';
import {HttpError, LIGHT_TIMEOUT_SECONDS, lightRequest, nodeTransport, type HttpRequest, type HttpResponse} from '../src/transport.js';
import {suite, test} from './support.js';

/** A fake transport that records each request and answers with `reply`. */
function fake(reply: HttpResponse = {status: 200, body: ''}): {sent: HttpRequest[]; transport: (request: HttpRequest) => Promise<HttpResponse>} {
  const sent: HttpRequest[] = [];
  return {sent, transport: request => {
    sent.push(request);
    return Promise.resolve(reply);
  }};
}

suite('lightRequest', () => {
  test('a request reaches the local API with the JSON body Python sent and the light timeout', async () => {
    const {sent, transport} = fake({status: 200, body: '{"select": "Forest", "n": 1}'});
    const payload = {write: {command: 'display', animData: '1 2 1 255 0 0 0 4', loop: false}};
    const reply = await lightRequest({ip: '192.0.2.2', token: 'fakeToken1'}, 'PUT', '/effects', payload, transport);
    assert.deepEqual(reply, {select: 'Forest', n: 1});
    assert.deepEqual(sent, [{url: 'http://192.0.2.2:16021/api/v1/fakeToken1/effects', method: 'PUT',
      headers: {'Content-Type': 'application/json'}, body: pyJson(payload), timeoutSeconds: LIGHT_TIMEOUT_SECONDS}]);
    assert.equal(LIGHT_TIMEOUT_SECONDS, 1.2);
  });

  test('a read sends no body and an empty reply is null', async () => {
    const {sent, transport} = fake();
    assert.equal(await lightRequest({ip: '10.0.0.5', token: 'abc'}, 'GET', '', null, transport), null);
    assert.equal(sent[0]?.body, null);
    assert.equal(sent[0]?.url, 'http://10.0.0.5:16021/api/v1/abc');
  });

  test('public addresses and unsafe credentials are refused before anything is sent', async () => {
    const {sent, transport} = fake();
    for (const ip of ['8.8.8.8', 'fd00::1', '::1', 'not-an-ip', '01.2.3.4']) {
      await assert.rejects(lightRequest({ip, token: 'abc'}, 'GET', '', null, transport), {name: 'ValueError'}, ip);
    }
    for (const token of ['', 'abc/def', 'abc def', 'abc?x=1', 'tökén']) {
      await assert.rejects(lightRequest({ip: '192.0.2.2', token}, 'GET', '', null, transport),
        {name: 'ValueError', message: 'The token must contain only letters and numbers.'}, token);
    }
    assert.deepEqual(sent, []);
  });

  test('a reply outside 2xx is an HttpError with its status', async () => {
    const {transport} = fake({status: 403, body: 'Forbidden'});
    await assert.rejects(lightRequest({ip: '192.0.2.2', token: 'abc'}, 'GET', '', null, transport),
      (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === 'EHTTP');
  });
});

/**
 * A stub device on the loopback interface; `handle` answers each request. It binds 127.0.0.1 on an ephemeral port, so it
 * cannot collide with an installed service, and closes with its connections when the test ends.
 */
async function stub(context: TestContext, handle: (request: IncomingMessage, body: string, response: ServerResponse) => void): Promise<string> {
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    request.on('end', () => handle(request, body, response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

suite('nodeTransport', () => {
  test('the device reply comes back with its status', async context => {
    const seen: [string | undefined, string | undefined, string][] = [];
    const url = await stub(context, (request, body, response) => {
      seen.push([request.method, request.headers['content-type'], body]);
      response.writeHead(200, {'Content-Type': 'application/json'}).end('{"ok": true}');
    });
    const reply = await nodeTransport({url: url + '/api/v1/abc/effects', method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: '{"a": 1}', timeoutSeconds: 2});
    assert.deepEqual(reply, {status: 200, body: '{"ok": true}'});
    assert.deepEqual(seen, [['PUT', 'application/json', '{"a": 1}']]);
  });

  test('a device that never answers fails within the timeout', async context => {
    const url = await stub(context, () => undefined);
    const started = performance.now();
    const outcome = await Promise.race([
      nodeTransport({url, method: 'GET', headers: {}, body: null, timeoutSeconds: 0.2}).then(() => 'answered', (error: unknown) => error),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 3000)),
    ]);
    const elapsed = (performance.now() - started) / 1000;
    assert.ok(outcome instanceof Error && 'code' in outcome && outcome.code === 'ETIMEDOUT', String(outcome));
    assert.ok(elapsed >= 0.19 && elapsed < 1.5, `gave up after ${elapsed} seconds`);
  });

  test('a configured proxy is never used', async context => {
    const seen: string[] = [];
    const url = await stub(context, (request, _body, response) => {
      seen.push(request.url ?? '');
      response.end('{}');
    });
    const proxied: string[] = [];
    const proxy = await stub(context, (request, _body, response) => {
      proxied.push(request.url ?? '');
      response.writeHead(502).end();
    });
    // Node 24 sends requests through HTTP_PROXY when NODE_USE_ENV_PROXY is set; this proxy records any that reach it.
    const transport = new URL('../src/transport.js', import.meta.url).href;
    const script = `const {nodeTransport} = await import(${JSON.stringify(transport)});
const reply = await nodeTransport({url: ${JSON.stringify(url + '/api/v1/new')}, method: 'POST', headers: {}, body: null, timeoutSeconds: 2});
process.stdout.write(JSON.stringify(reply));`;
    const run = promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 10_000,
      env: {...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxy, http_proxy: proxy, NO_PROXY: ''}});
    // The child exits by itself; this stops it if the test fails before it does.
    context.after(() => {
      if (run.child.exitCode === null) run.child.kill();
    });
    const {stdout} = await run;
    assert.deepEqual(JSON.parse(stdout), {status: 200, body: '{}'});
    assert.deepEqual(seen, ['/api/v1/new']);
    assert.deepEqual(proxied, []);
  });
});
