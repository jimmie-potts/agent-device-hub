import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {tokenDigest} from '../src/credentials.js';
import {parseArguments} from '../src/process.js';
import {checkEdgeSection} from '../src/state.js';
import {createUpgradeHttpObserver, observeInstalledUpgradeHttp, type UpgradeHttpReader} from '../src/upgrade-http.js';
import type {UpgradeOwner} from '../src/upgrade-owner.js';

const revision = 'a'.repeat(40);
const token = 'synthetic-read-token';
const credentialsPath = '/synthetic/credentials.json';
const configPath = '/synthetic/runtime.json';
const tokenPath = '/synthetic/token';
const owner: UpgradeOwner = {
  service: 'bunny-runtime.service', pid: 12345, startMonotonic: '100', startTicks: '100',
  units: ['/synthetic/service'], controlGroup: '/synthetic/group', executable: '/synthetic/node', cwd: '/synthetic',
  entry: '/synthetic/main.js', argv: ['/synthetic/node', '/synthetic/main.js'],
  options: parseArguments(['--port', '8788', '--edge', '--environment', 'production', '--config', configPath]),
};
const build = {schema: 'runtime-build/2.0', revision, version: '0.1.0', dirty: false, builtAt: '2026-10-10T00:00:00.000Z'};
const health = {schema: 'runtime-health/1.0', status: 'degraded', moduleApiVersion: MODULE_API_VERSION,
  startedAtMs: 1, uptimeMs: 123, memory: {rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 1},
  lagCheck: {status: 'active', limitMs: 10000}, modules: [
    {name: 'core', apiVersion: MODULE_API_VERSION, state: 'running', healthy: true, syncRestarts: 0},
    {name: 'wispr', apiVersion: MODULE_API_VERSION, state: 'refused', healthy: false, syncRestarts: 0,
      reason: {code: 'unconfigured', detail: 'synthetic-private-detail'}},
  ]};
const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

function fixture(): {reader: UpgradeHttpReader; files: Map<string, Buffer>; gets: string[]} {
  const files = new Map<string, Buffer>([
    [configPath, bytes({schema: 'runtime-config/1.0', modules: {}, edge: {credentials: credentialsPath}})],
    [credentialsPath, bytes({schema: 'edge-credentials/1.0', credentials: [{id: 'read', source: 'bunny/parts/upgrade',
      digest: tokenDigest(token), scopes: ['read']} ]})],
    [tokenPath, Buffer.from(token + '\n')],
  ]);
  const gets: string[] = [];
  return {files, gets, reader: {
    privateFile: path => Promise.resolve(files.get(path) ?? Buffer.alloc(0)),
    config: () => Promise.resolve({modules: {}, edge: checkEdgeSection({credentials: credentialsPath})}),
    get: (port, path, presented) => {
      assert.equal(port, 8788);
      assert.equal(presented, path === '/api/v2/build' ? token : undefined);
      gets.push(path);
      return Promise.resolve(bytes(path === '/api/v2/build' ? build : health));
    },
  }};
}

void test('upgrade HTTP observation binds authenticated build and reports sanitized health without accepting it', async t => {
  const initial = fixture();
  let rechecks = 0;
  const observe = createUpgradeHttpObserver(initial.reader);
  const result = await observe(owner, tokenPath, {revision, version: '0.1.0'}, () => { rechecks++; return Promise.resolve(); });
  assert.deepEqual(initial.gets, ['/api/v2/build', '/api/runtime/v1/health']);
  assert.equal(rechecks, 4);
  assert.equal(result.build.revision, revision);
  assert.equal(result.health.status, 'degraded');
  assert.equal(result.health.modules.find(row => row.name === 'wispr')?.reasonCode, 'unconfigured');
  const serialized = JSON.stringify(result);
  for (const excluded of [token, 'synthetic-private-detail', 'uptimeMs', 'syncRestarts', 'rssBytes', 'digest']) assert.equal(serialized.includes(excluded), false);

  await t.test('listener or process drift refuses before the next GET', async () => {
    for (const failAt of [1, 2]) {
      const current = fixture();
      let count = 0;
      await assert.rejects(createUpgradeHttpObserver(current.reader)(owner, tokenPath, {revision, version: '0.1.0'}, () => {
        if (++count === failAt) return Promise.reject(new Error('synthetic-owner-drift'));
        return Promise.resolve();
      }), /^Error: runtime-upgrade-http-refused$/);
      assert.equal(current.gets.length, failAt - 1);
    }
  });
  await t.test('configuration, credential and token drift refuses after build and before health', async () => {
    for (const path of [configPath, credentialsPath, tokenPath]) {
      const current = fixture();
      let count = 0;
      await assert.rejects(createUpgradeHttpObserver(current.reader)(owner, tokenPath, {revision, version: '0.1.0'}, () => {
        if (++count === 2) current.files.set(path, Buffer.from('changed-synthetic-private-bytes'));
        return Promise.resolve();
      }), /^Error: runtime-upgrade-http-refused$/);
      assert.deepEqual(current.gets, ['/api/v2/build']);
    }
  });
  await t.test('wrong revision, dirty build and invalid response bytes refuse', async () => {
    for (const payload of [bytes({...build, revision: 'b'.repeat(40)}), bytes({...build, dirty: true}),
      Buffer.from([0xff]), Buffer.alloc(256 * 1024 + 1), Buffer.from('{')]) {
      const current = fixture();
      current.reader.get = () => Promise.resolve(payload);
      await assert.rejects(createUpgradeHttpObserver(current.reader)(owner, tokenPath, {revision, version: '0.1.0'}, () => Promise.resolve()),
        /^Error: runtime-upgrade-http-refused$/);
    }
  });
  await t.test('legacy or inconsistent health refuses', async () => {
    for (const payload of [bytes({...health, schema: 'legacy-health'}), bytes({...health, status: 'ok'}),
      bytes({...health, modules: [health.modules[0], health.modules[0]]})]) {
      const current = fixture();
      current.reader.get = (_port, path) => Promise.resolve(path === '/api/v2/build' ? bytes(build) : payload);
      await assert.rejects(createUpgradeHttpObserver(current.reader)(owner, tokenPath, {revision, version: '0.1.0'}, () => Promise.resolve()),
        /^Error: runtime-upgrade-http-refused$/);
    }
  });
  await t.test('a token without a current read grant refuses before any GET', async () => {
    const current = fixture();
    current.files.set(tokenPath, Buffer.from('different-synthetic-token'));
    await assert.rejects(createUpgradeHttpObserver(current.reader)(owner, tokenPath, {revision, version: '0.1.0'}, () => Promise.resolve()),
      /^Error: runtime-upgrade-http-refused$/);
    assert.equal(current.gets.length, 0);
  });
});

void test('production HTTP reader uses fixed loopback GETs and refuses redirects and oversized responses', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-http-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const configFile = join(root, 'runtime.json');
  const credentialFile = join(root, 'credentials.json');
  const tokenFile = join(root, 'token');
  const synthetic = fixture();
  await writeFile(configFile, bytes({schema: 'runtime-config/1.0', modules: {}, edge: {credentials: credentialFile}}), {mode: 0o600});
  await writeFile(credentialFile, synthetic.files.get(credentialsPath) ?? '', {mode: 0o600});
  await writeFile(tokenFile, token, {mode: 0o600});
  let mode: 'success' | 'redirect' | 'oversized' = 'success';
  let redirected = 0;
  const requestTraces: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === '/sentinel') redirected++;
    assert.equal(request.method, 'GET');
    assert.equal(typeof request.headers.traceparent, 'string');
    const trace = request.headers.traceparent as string;
    assert.match(trace, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.notEqual(trace.slice(3, 35), '0'.repeat(32));
    assert.notEqual(trace.slice(36, 52), '0'.repeat(16));
    requestTraces.push(trace);
    if (request.url === '/api/v2/build') {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      if (mode === 'redirect') { response.writeHead(302, {Location: '/sentinel'}); response.end(); return; }
      if (mode === 'oversized') {
        response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': 256 * 1024 + 1});
        response.end(Buffer.alloc(256 * 1024 + 1));
        return;
      }
    } else {
      assert.equal(request.url, '/api/runtime/v1/health');
      assert.equal(request.headers.authorization, undefined);
    }
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(bytes(request.url === '/api/v2/build' ? build : health));
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error !== undefined) reject(error); else resolve(); });
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const disposableOwner = {...owner, options: {...owner.options, port: address.port, config: configFile}};
  const parent = {traceparent: `00-${'b'.repeat(32)}-${'c'.repeat(16)}-01`};
  const result = await observeInstalledUpgradeHttp(disposableOwner, tokenFile, {revision, version: '0.1.0'}, () => Promise.resolve(),
    parent);
  assert.equal(result.build.revision, revision);
  assert.equal(requestTraces.length, 2);
  assert.equal(requestTraces[0]?.slice(3, 35), 'b'.repeat(32), 'HTTP observations continue the operation trace');
  assert.equal(requestTraces[0]?.slice(3, 35), requestTraces[1]?.slice(3, 35));
  assert.notEqual(requestTraces[0], requestTraces[1], 'each HTTP call has its own span');
  for (const failure of ['redirect', 'oversized'] as const) {
    mode = failure;
    await assert.rejects(observeInstalledUpgradeHttp(disposableOwner, tokenFile, {revision, version: '0.1.0'}, () => Promise.resolve()),
      /^Error: runtime-upgrade-http-refused$/);
  }
  assert.equal(redirected, 0, 'the bearer must not be forwarded through a redirect');
});
