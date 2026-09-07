import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import * as api from '../dist/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { args, deferred, owner, principal } from './helpers.mjs';
import { httpFixture, rawRequest } from './http-helpers.mjs';

test('authenticated HTTP initialization and bound tool discovery', async t => {
  assert.equal(typeof api.createMcpHandler, 'function', 'embeddable HTTP handler must be exported');
  const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url)));
  const registry = api.createDeviceRegistry([{ controllerId: 'controller', deviceId: 'light',
    service: { readSnapshot: async () => snapshot, submit: async () => assert.fail('no command') } }]);
  const server = createServer((req, res) => handler.handle(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`;
  const handler = api.createMcpHandler({ enabled: true, registry, tools: api.bindDeviceTools(registry, { deviceId: 'light', prefix: 'pixoo' }),
    allowedHosts: [host], allowedOrigins: [], authenticate: async token => token === 'synthetic' ? { id: 'fixture', credential: {
      kind: 'machine', status: 'active', declared: true, devices: ['light'], scopes: ['read', 'control'] } } : null });
  t.after(async () => { await handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await fetch(`http://${host}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer synthetic',
    Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
    method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'codex-profile', version: 'synthetic-1' } } }) });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('mcp-session-id'));
  assert.equal((await response.json()).result.protocolVersion, '2025-11-25');
});

const profiles = JSON.parse(readFileSync(new URL('../fixtures/client-profiles.json', import.meta.url)));
for (const profile of profiles.profiles) for (const version of profiles.protocolVersions) {
  test(`${profile.name} ${version}: initialize/discover/read/write/replay/error`, async t => {
    const backend = owner(), f = await httpFixture(t, { service: backend.service });
    assert.equal((await f.initialize(profile, version)).body.result.protocolVersion, version);
    const listed = await f.rpc('tools/list', {});
    assert.equal(listed.status, 200); assert.equal(listed.body.result.tools.length, 3);
    assert.deepEqual(listed.body.result.tools.map(t => t.name).sort(), ['fixture_brightness_set', 'fixture_power_set', 'fixture_status']);
    const status = await f.rpc('tools/call', { name: 'fixture_status', arguments: {} });
    assert.equal(status.body.result.structuredContent.snapshot.state.observation.status, 'unknown');
    const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() });
    while (!backend.scheduled) await new Promise(resolve => setImmediate(resolve));
    const receipt = backend.finish();
    assert.deepEqual((await pending).body.result.structuredContent.receipt, receipt);
    assert.deepEqual((await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() })).body.result.structuredContent.receipt, receipt);
    assert.equal(backend.scheduled, 1);
    const invalid = await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args({ percent: 101 }) });
    assert.equal(invalid.body.result.isError, true);
    assert.equal((await f.rpc('tools/call', { name: 'not_registered', arguments: {} })).body.error.code, -32602);
    assert.equal((await f.rpc('tools/list', { cursor: 'invented' })).body.error.code, -32602);
  });
}

test('independent SDK client performs initialization, schemas and typed call', async t => {
  const f = await httpFixture(t);
  const transport = new StreamableHTTPClientTransport(new URL(f.url), { requestInit: { headers: { Authorization: 'Bearer synthetic' } } });
  const client = new Client({ name: 'sdk-client-fixture', version: 'synthetic-1' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 3);
  assert.equal((await client.callTool({ name: 'fixture_status', arguments: {} })).structuredContent.kind, 'snapshot');
});

test('disabled, missing session, unknown session, version and methods reject before controller', async t => {
  const f = await httpFixture(t);
  assert.equal((await f.rpc('tools/list', {})).status, 400);
  assert.equal((await f.rpc('tools/list', {}, { headers: { 'Mcp-Session-Id': 'unknown', 'MCP-Protocol-Version': '2025-11-25' } })).status, 404);
  assert.equal((await f.initialize(undefined, '2026-07-28')).status, 400);
  assert.equal((await f.initialize()).status, 200);
  assert.equal((await f.rpc('tools/list', {}, { headers: { 'MCP-Protocol-Version': '2026-07-28' } })).status, 400);
  assert.equal((await fetch(f.url, { headers: { Authorization: 'Bearer synthetic', Accept: 'text/event-stream' } })).status, 405);
  assert.equal(f.calls.length, 0);
  const disabled = await httpFixture(t, { options: { enabled: false } });
  assert.equal((await disabled.initialize()).status, 404);
});

test('authentication and scope rechecked on every request including cached replay', async t => {
  let current = principal();
  const f = await httpFixture(t, { options: { authenticate: async token => token === 'synthetic' ? current : null } });
  assert.equal((await f.rpc('initialize', {}, { headers: { Authorization: undefined } })).status, 401);
  assert.equal((await f.rpc('initialize', {}, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  await f.initialize();
  current = principal({ kind: 'browser' }); assert.equal((await f.rpc('tools/list', {})).status, 401);
  current = principal({ status: 'revoked' }); assert.equal((await f.rpc('tools/list', {})).status, 401);
  current = { ...principal(), id: 'another-principal' }; assert.equal((await f.rpc('tools/list', {})).status, 403);
  current = principal({ scopes: ['read'] });
  assert.equal((await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() })).body.result.structuredContent.code, 'forbidden');
  current = principal({ status: 'overlap' }); assert.equal((await f.rpc('tools/list', {})).status, 200);
  assert.equal(f.calls.length, 0);
});

test('Host, supplied Origin and Fetch-Metadata protections reject spoofed or duplicate headers', async t => {
  const f = await httpFixture(t);
  for (const headers of [{ Host: 'attacker.invalid' }, { Origin: 'null' }, { Origin: 'https://attacker.invalid' },
    { Origin: `http://${f.host}/path` }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'unknown' }]) {
    assert.equal(await rawRequest(f.url, { ...f.base, ...headers }), 403, JSON.stringify(headers));
  }
  assert.equal(await rawRequest(f.url, { ...f.base, Host: 'attacker.invalid', 'X-Forwarded-Host': f.host }), 403);
  for (const key of ['Host', 'Origin', 'Authorization']) {
    const base = ['Host', f.host, 'Authorization', 'Bearer synthetic', 'Content-Type', 'application/json', 'Accept', 'application/json, text/event-stream'];
    if (key === 'Origin') base.push('Origin', `http://${f.host}`);
    base.push(key, key === 'Host' ? f.host : key === 'Origin' ? `http://${f.host}` : 'Bearer synthetic');
    assert.equal(await rawRequest(f.url, base), key === 'Authorization' ? 401 : 403);
  }
  assert.equal((await f.initialize()).status, 200);
  assert.equal((await f.rpc('tools/list', {}, { headers: { Origin: `http://${f.host}` } })).status, 200);
  assert.equal(f.calls.length, 0);
});

test('body limits and slow-body deadline reject before controller work', async t => {
  const f = await httpFixture(t, { options: { limits: { requestTimeoutMs: 80 } } });
  const response = await fetch(f.url, { method: 'POST', headers: f.base, body: ' '.repeat(65537) });
  assert.equal(response.status, 429);
  assert.equal(await rawRequest(f.url, { ...f.base, 'Transfer-Encoding': 'chunked' }, [' '.repeat(40000), ' '.repeat(30000)]), 429);
  assert.equal(await rawRequest(f.url, f.base, ['{'], true), 408);
  assert.equal(f.calls.length, 0);
});

test('invalid UTF-8 rejects rather than changing the supplied initialization identity', async t => {
  const f = await httpFixture(t);
  const prefix = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"';
  const malformed = Buffer.concat([Buffer.from(prefix), Buffer.from([0xff]), Buffer.from('","version":"synthetic"}}}')]);
  assert.equal(await rawRequest(f.url, f.base, [malformed]), 400);
});

test('hung authentication keeps its admission slot until settlement', async t => {
  const wait = deferred(); let verifications = 0;
  const f = await httpFixture(t, { options: { limits: { maxInFlight: 1, authenticationTimeoutMs: 30 },
    authenticate: async () => { verifications++; return wait.promise; } } });
  assert.equal((await f.initialize()).status, 401);
  assert.equal((await f.initialize()).status, 429);
  assert.equal(verifications, 1);
  wait.resolve(principal()); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.initialize()).status, 200);
});

test('session capacity, deletion and expiry release only protocol state', async t => {
  const f = await httpFixture(t, { options: { limits: { maxSessions: 1, sessionIdleMs: 100 } } });
  await f.initialize();
  const another = await fetch(f.url, { method: 'POST', headers: f.base, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'another', version: 'fixture' } } }) });
  assert.equal(another.status, 429);
  assert.equal((await f.removeSession()).status, 200);
  assert.equal((await f.rpc('tools/list', {})).status, 404);
  const expiring = await httpFixture(t, { options: { limits: { sessionIdleMs: 30 } } });
  await expiring.initialize(); await new Promise(resolve => setTimeout(resolve, 55));
  assert.equal((await expiring.rpc('tools/list', {})).status, 404);
});

test('controller deadline reports possible effects, retains capacity and never retries', async t => {
  const wait = deferred(), entered = deferred(); let submissions = 0;
  const f = await httpFixture(t, { options: { limits: { maxInFlight: 1, requestTimeoutMs: 60 } }, service: {
    submit: async () => { submissions++; entered.resolve(); return wait.promise; } } });
  await f.initialize();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }); await entered.promise;
  const result = await pending;
  assert.equal(result.body.result.structuredContent.priorEffects, 'possible');
  assert.deepEqual(result.body.result.structuredContent.requestId, args().requestId);
  assert.equal((await f.rpc('tools/call', { name: 'fixture_status', arguments: {} })).body.result.structuredContent.code, 'capacity');
  wait.resolve({ kind: 'unavailable', code: 'uncertain-result', priorEffects: 'possible' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.rpc('tools/call', { name: 'fixture_status', arguments: {} })).body.result.structuredContent.kind, 'snapshot');
  assert.equal(submissions, 1);
});

test('revoked credential fails before retained command replay', async t => {
  const backend = owner(); let credential = principal();
  const f = await httpFixture(t, { service: backend.service, options: { authenticate: async () => credential } });
  await f.initialize();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() });
  while (!backend.scheduled) await new Promise(resolve => setImmediate(resolve));
  backend.finish(); await pending;
  credential = principal({ status: 'revoked' });
  assert.equal((await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() })).status, 401);
  assert.equal(backend.scheduled, 1);
});

test('offline read and oversized controller results report safe errors', async t => {
  const f = await httpFixture(t, { service: { readSnapshot: async () => { throw new Error('private hostname'); } } });
  await f.initialize();
  const result = await f.rpc('tools/call', { name: 'fixture_status', arguments: {} });
  assert.equal(result.body.result.structuredContent.code, 'transport-failure');
  assert.equal(result.body.result.structuredContent.priorEffects, 'none');
  assert.equal(JSON.stringify(result.body).includes('private hostname'), false);
  const large = await httpFixture(t, { service: { submit: async () => ({ kind: 'receipt', receipt: { extra: 'x'.repeat(1048576) } }) } });
  await large.initialize();
  const write = await large.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() });
  assert.equal(write.body.result.structuredContent.priorEffects, 'possible');
  assert.ok(JSON.stringify(write.body).length < 1024);
});

test('parallel duplicate JSON-RPC ID rejects without a second dispatch', async t => {
  const wait = deferred(), entered = deferred(); let count = 0;
  const f = await httpFixture(t, { service: { submit: async () => { count++; entered.resolve(); await wait.promise;
    return { kind: 'unavailable', code: 'uncertain-result', priorEffects: 'possible' }; } } });
  await f.initialize();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }, { id: 900 });
  await entered.promise;
  assert.equal((await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }, { id: 900 })).status, 400);
  assert.equal(count, 1); wait.resolve(); await pending;
});

for (const action of ['socket-close', 'delete', 'close', 'cancel-notification']) test(`${action} after dispatch leaves backend work alive`, async t => {
  const wait = deferred(), entered = deferred(); let finished = false, submissions = 0;
  const f = await httpFixture(t, { options: { limits: { requestTimeoutMs: 100 } }, service: {
    submit: async () => { submissions++; entered.resolve(); await wait.promise; finished = true;
      return { kind: 'unavailable', code: 'uncertain-result', priorEffects: 'possible' }; } } });
  await f.initialize();
  const abort = new AbortController();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }, { id: 100, signal: abort.signal }).catch(() => null);
  await entered.promise;
  if (action === 'socket-close') abort.abort();
  if (action === 'delete') await f.removeSession();
  if (action === 'close') await f.handler.close();
  if (action === 'cancel-notification') await f.rpc('notifications/cancelled', { requestId: 100, reason: 'fixture cancellation' });
  assert.equal(finished, false); assert.equal(submissions, 1);
  wait.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, true); assert.equal(submissions, 1);
  abort.abort(); await pending;
});
