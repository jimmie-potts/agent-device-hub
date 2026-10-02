import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDockerBackend } from '../docker-backend.mjs';

async function fixture(t, handler, apiVersion = { ApiVersion: '1.47', MinAPIVersion: '1.24', Os: 'linux', Arch: 'amd64' }) {
  const directory = await mkdtemp(join(tmpdir(), 'dk-'));
  const socket = join(directory, 's');
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method, path: req.url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/version') res.end(JSON.stringify(apiVersion));
    else handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true }); });
  const backend = await createDockerBackend({ endpoint: 'unix://' + socket });
  t.after(() => backend.close());
  return { backend, calls };
}
const id = 'a'.repeat(64), options = { timeoutMs: 1000 };

test('explicit Unix adapter negotiates supported API then inspects and removes without force or retries', async t => {
  const { backend, calls } = await fixture(t, (req, res) => {
    if (req.method === 'GET') res.end(JSON.stringify({ Id: id }));
    else { res.statusCode = 204; res.end(); }
  });
  assert.deepEqual(await backend.inspect('container', id, options), { Id: id });
  await backend.stop(id, options);
  await backend.remove('container', id, options);
  await backend.remove('network', id, options);
  await backend.remove('volume', 'bunny-o704-test-data', options);
  assert.deepEqual(calls.map(x => [x.method, x.path]), [['GET', '/version'],
    ['GET', '/v1.47/containers/' + id + '/json'], ['POST', '/v1.47/containers/' + id + '/stop?t=20'],
    ['DELETE', '/v1.47/containers/' + id + '?force=false&v=false&link=false'],
    ['DELETE', '/v1.47/networks/' + id], ['DELETE', '/v1.47/volumes/bunny-o704-test-data?force=false']]);
  assert.ok(calls.every(x => !x.headers.authorization && !x.headers.traceparent));
});

test('only inspect 404 means absence; redirects, server failures and malformed success remain errors', async t => {
  let response = [404, '{"message":"SYNTHETIC_SECRET"}'];
  const { backend, calls } = await fixture(t, (_req, res) => { res.statusCode = response[0]; res.end(response[1]); });
  assert.equal(await backend.inspect('network', id, options), null);
  await assert.rejects(backend.remove('network', id, options), /docker-http-status/);
  for (const value of [[500, '{"message":"SYNTHETIC_SECRET"}'], [302, '{}'], [200, 'SYNTHETIC_SECRET'], [200, '[]']]) {
    response = value;
    await assert.rejects(backend.inspect('network', id, options), error => !error.message.includes('SYNTHETIC_SECRET'));
  }
  assert.equal(calls.length, 7);
});

test('timeouts, abort and output bounds close requests without retry', async t => {
  let mode = 'hang';
  const { backend, calls } = await fixture(t, (_req, res) => {
    if (mode === 'large') res.end('x'.repeat(1024 * 1024 + 1));
  });
  await assert.rejects(backend.inspect('container', id, { timeoutMs: 20 }), /docker-timeout/);
  const controller = new AbortController();
  const pending = backend.inspect('container', id, { ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /docker-aborted/);
  mode = 'large';
  await assert.rejects(backend.inspect('container', id, options), /docker-response-limit/);
  assert.ok(calls.length <= 4);
});

test('remote endpoints, unsafe identifiers and pre-aborted calls cannot reach the engine', async t => {
  for (const endpoint of ['tcp://127.0.0.1:2375', 'ssh://host', 'unix:///a/../s', 'unix://relative']) {
    await assert.rejects(createDockerBackend({ endpoint }), /docker-endpoint/);
  }
  const { backend, calls } = await fixture(t, (_req, res) => res.end('{}'));
  await assert.rejects(backend.remove('image', id, options), /docker-resource/);
  await assert.rejects(backend.remove('container', '--all', options), /docker-resource/);
  await assert.rejects(backend.remove('volume', '../other', options), /docker-resource/);
  await assert.rejects(backend.inspect('container', id, { ...options, signal: AbortSignal.abort() }), /docker-aborted/);
  assert.equal(calls.length, 1);
});

test('unsupported engine API or platform is refused before any resource request', async t => {
  for (const patch of [{ ApiVersion: '1.46' }, { MinAPIVersion: '1.48' }, { MinAPIVersion: undefined },
    { Os: 'windows' }, { Arch: 'arm64' }]) {
    await assert.rejects(fixture(t, () => assert.fail('resource access before compatibility check'),
      { ApiVersion: '1.47', MinAPIVersion: '1.24', Os: 'linux', Arch: 'amd64', ...patch }), /docker-api-incompatible/);
  }
});

test('concurrent calls are refused instead of queued; close cancels active requests', async t => {
  const { backend, calls } = await fixture(t, () => {});
  const pending = backend.inspect('container', id, options);
  await assert.rejects(backend.inspect('network', id, options), /docker-concurrent-request/);
  backend.close();
  await assert.rejects(pending, /docker-aborted/);
  await assert.rejects(backend.inspect('container', id, options), /docker-closed/);
  assert.ok(calls.length <= 2);
});
