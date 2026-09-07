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
  test(`${profile.name} ${version}: initialize/discover/read/write/replay/error/authorization/cancellation`, async t => {
    let current = principal();
    const backend = owner(), f = await httpFixture(t, { service: backend.service, options: {
      authenticate: async token => token === 'synthetic' ? current : null } });
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

    current = principal({ scopes: ['read'] });
    const forbidden = await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() });
    assert.equal(forbidden.body.result.structuredContent.code, 'forbidden');
    assert.equal(forbidden.body.result.structuredContent.priorEffects, 'none');
    current = null;
    assert.equal((await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() })).status, 401);
    assert.equal(backend.scheduled, 1);
    current = principal();

    const next = (await f.rpc('tools/call', { name: 'fixture_status', arguments: {} })).body.result.structuredContent.snapshot;
    const nextArgs = args({ requestId: next.nextRequestId, expectedConfigurationRevision: next.configurationRevision, expectedGeneration: next.generation });
    const cancelled = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: nextArgs }, { id: 700, signal: AbortSignal.timeout(2000) });
    while (backend.scheduled < 2) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.rpc('notifications/cancelled', { requestId: 700 })).status, 202);
    const ended = await cancelled;
    assert.equal(ended.status, 204); assert.equal(ended.body, null);
    assert.equal(backend.state.pending.length, 1, 'cancellation ends delivery while the owner retains admitted work');
    const completed = backend.finish(next.nextRequestId.sequence);
    assert.equal(backend.state.pending.length, 0);
    assert.deepEqual((await f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: nextArgs })).body.result.structuredContent.receipt, completed);
    assert.equal(backend.scheduled, 2, 'cancellation and exact replay cannot schedule another command');
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

for (const action of ['cancel-notification', 'delete', 'idle-expiry', 'socket-close']) test(`review lifecycle ${action} releases HTTP capacity after owner settlement`, async t => {
  const entered = deferred(), release = deferred(); let submissions = 0;
  const f = await httpFixture(t, { options: { limits: { maxInFlight: action === 'idle-expiry' ? 1 : 2, sessionIdleMs: 100, requestTimeoutMs: 500 } },
    service: { submit: async () => { submissions++; entered.resolve(); await release.promise;
      return { kind: 'unavailable', code: 'uncertain-result', priorEffects: 'possible' }; } } });
  let completed = 0;
  f.server.removeAllListeners('request');
  f.server.on('request', (req, res) => { void f.handler.handle(req, res).finally(() => { completed++; }); });
  await f.initialize();
  const before = completed, abort = new AbortController();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }, { id: 700, signal: abort.signal }).catch(() => null);
  await entered.promise;
  if (action === 'cancel-notification') await f.rpc('notifications/cancelled', { requestId: 700 });
  if (action === 'delete') await f.removeSession();
  if (action === 'idle-expiry') await new Promise(resolve => setTimeout(resolve, 150));
  if (action === 'socket-close') abort.abort();
  release.resolve();
  await new Promise(resolve => setTimeout(resolve, 30));
  abort.abort(); await pending;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(completed > before + (['delete', 'cancel-notification'].includes(action) ? 1 : 0), 'original HTTP handler must settle');
  const fresh = await f.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'recovery', version: '1' } },
    { headers: { 'Mcp-Session-Id': undefined, 'MCP-Protocol-Version': undefined } });
  assert.equal(fresh.status, 200); assert.equal(submissions, 1);
});

test('review successful JSON calls retain no SDK streams', async t => {
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const original = StreamableHTTPServerTransport.prototype.handleRequest;
  let transport;
  StreamableHTTPServerTransport.prototype.handleRequest = function (...args) { transport = this; return original.apply(this, args); };
  t.after(() => { StreamableHTTPServerTransport.prototype.handleRequest = original; });
  const f = await httpFixture(t); await f.initialize();
  for (let i = 0; i < 100; i++) assert.equal((await f.rpc('tools/list')).status, 200);
  assert.equal(transport._webStandardTransport._requestToStreamMapping.size, 0);
  assert.equal(transport._webStandardTransport._streamMapping.size, 0);
});

test('review discovery uses current devices and scopes for generic and bound tools', async t => {
  const service = { readSnapshot: async () => assert.fail('discovery cannot dispatch'), submit: async () => assert.fail('discovery cannot dispatch') };
  const extension = { inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: { type: 'object', additionalProperties: false, properties: {} }, scope: 'read', description: 'Read catalog.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, invoke: async () => assert.fail('discovery cannot dispatch') };
  const registry = api.createDeviceRegistry(['allowed-light', 'restricted-light'].map(deviceId => ({ deviceId, controllerId: 'controller', service, extensions: { catalog: extension } })));
  const tools = [...api.createDeviceTools(registry), ...api.bindDeviceTools(registry, { deviceId: 'restricted-light', prefix: 'restricted' }),
    ...api.bindServiceTools(registry, { deviceId: 'restricted-light', bindings: [{ extension: 'catalog', name: 'restricted_catalog' }] })];
  let current = principal({ devices: ['allowed-light'], scopes: ['read'] });
  const f = await httpFixture(t, { options: { registry, tools, authenticate: async () => current } }); await f.initialize();
  let catalog = (await f.rpc('tools/list')).body.result.tools;
  assert.deepEqual(catalog.map(tool => tool.name), ['device_list', 'device_status']);
  assert.deepEqual(catalog.find(tool => tool.name === 'device_status').inputSchema.properties.deviceId.enum, ['allowed-light']);
  assert.equal(JSON.stringify(catalog).includes('restricted-light'), false);
  current = principal({ devices: [], scopes: [] });
  assert.deepEqual((await f.rpc('tools/list')).body.result.tools, []);
  current = principal({ devices: ['restricted-light'], scopes: ['control'] });
  catalog = (await f.rpc('tools/list')).body.result.tools;
  assert.deepEqual(catalog.map(tool => tool.name), ['device_brightness_set', 'device_power_set', 'restricted_brightness_set', 'restricted_power_set']);
});

test('review complete response including escaped RPC identity respects byte limit', async t => {
  const { fixture } = await import('./helpers.mjs');
  const setup = fixture();
  const maxResponseBytes = Buffer.byteLength(JSON.stringify({ tools: setup.tools })) + 100;
  const f = await httpFixture(t, { options: { limits: { maxResponseBytes } } }); await f.initialize();
  const result = await f.rpc('tools/list', undefined, { id: '\u0000💡'.repeat(1000) });
  assert.ok(Buffer.byteLength(JSON.stringify(result.body)) <= maxResponseBytes, 'complete JSON-RPC envelope must fit');
  assert.ok(result.body.error || result.body.result?.isError, 'oversized catalog must return a bounded failure');
});

test('review malformed cancellation does not end another request', async t => {
  const release = deferred(), entered = deferred();
  const f = await httpFixture(t, { service: { submit: async () => { entered.resolve(); await release.promise;
    return { kind: 'unavailable', code: 'uncertain-result', priorEffects: 'possible' }; } } });
  await f.initialize();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }, { id: 712 });
  await entered.promise;
  await f.rpc('notifications/cancelled', { requestId: 712, reason: { invalid: true } });
  release.resolve();
  assert.equal((await pending).body.result.structuredContent.priorEffects, 'possible');
});

test('review socket delivery releases HTTP capacity while owner retains its operation slot', async t => {
  const release = deferred(), entered = deferred(); let submissions = 0;
  const f = await httpFixture(t, { options: { limits: { maxInFlight: 1, requestTimeoutMs: 500 } }, service: {
    submit: async () => { submissions++; entered.resolve(); await release.promise;
      return { kind: 'unavailable', code: 'uncertain-result', priorEffects: 'possible' }; } } });
  await f.initialize();
  const abort = new AbortController();
  const pending = f.rpc('tools/call', { name: 'fixture_brightness_set', arguments: args() }, { id: 713, signal: abort.signal }).catch(() => null);
  await entered.promise; abort.abort(); await pending;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await f.rpc('tools/call', { name: 'fixture_status', arguments: {} }, { id: 713 })).status, 400, 'live SDK handler identity cannot be reused');
  const blocked = await f.rpc('tools/call', { name: 'fixture_status', arguments: {} });
  assert.equal(blocked.status, 200); assert.equal(blocked.body.result.structuredContent.code, 'capacity');
  release.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await f.rpc('tools/call', { name: 'fixture_status', arguments: {} }, { id: 713 })).body.result.structuredContent.kind, 'snapshot');
  assert.equal(submissions, 1);
});

test('review response bounds include initialization errors and reject unrepresentable IDs before dispatch', async t => {
  const f = await httpFixture(t, { options: { tools: [], limits: { maxResponseBytes: 1024 } } });
  const oversizedId = await f.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bounded', version: '1' } },
    { id: '\u0000💡'.repeat(1000) });
  assert.equal(oversizedId.status, 429);
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedId.body)) <= 1024);
  assert.equal((await f.initialize()).status, 200);
  for (const [method, params] of [['ping', {}], ['unknown', {}], ['tools/call', { name: 'x'.repeat(2000) }], ['tools/list', { cursor: 'x'.repeat(2000) }]]) {
    const response = await f.rpc(method, params, { id: '💡'.repeat(40) });
    assert.ok(Buffer.byteLength(JSON.stringify(response.body)) <= 1024, method);
  }
});

test('review oversized write envelope preserves possible effects and native request identity', async t => {
  let submissions = 0;
  const registry = api.createDeviceRegistry([{ controllerId: 'controller', deviceId: 'light', extensions: { write: {
    inputSchema: { type: 'object', additionalProperties: false, properties: { request_id: { type: 'string', maxLength: 128 } }, required: ['request_id'] },
    outputSchema: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', maxLength: 2000 } }, required: ['message'] },
    scope: 'control', description: 'Synthetic app write.', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    invoke: async () => { submissions++; return { data: { message: 'x'.repeat(1000) } }; },
  } } }]);
  const tools = api.bindServiceTools(registry, { deviceId: 'light', bindings: [{ extension: 'write', name: 'write' }] });
  const maxResponseBytes = Buffer.byteLength(JSON.stringify({ tools })) + 100;
  const f = await httpFixture(t, { options: { registry, tools, limits: { maxResponseBytes } } }); await f.initialize();
  const response = await f.rpc('tools/call', { name: 'write', arguments: { request_id: 'native-1' } }, { id: 'x'.repeat(maxResponseBytes - 1000) });
  assert.equal(response.status, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(response.body)) <= maxResponseBytes);
  assert.deepEqual(response.body.result.structuredContent, { kind: 'gateway-error', code: 'capacity', priorEffects: 'possible',
    requestId: 'native-1', retry: 'never-automatically' });
  assert.equal(submissions, 1);
});

for (const [label, identity] of [['control', '\u0000'.repeat(128)], ['unicode', '界'.repeat(128)],
  ['ticket', { epoch: 'x'.repeat(128), sequence: Number.MAX_SAFE_INTEGER }]]) {
  test(`review failure reservation uses actual serialized identity ${label}`, async t => {
    const { gatewayFailure } = await import('../dist/tools.js');
    const { validate } = await import('@jimmie-potts/device-contracts');
    let submissions = 0;
    const ticket = typeof identity === 'object';
    if (ticket) assert.equal(validate('ticket', identity), true);
    const registry = api.createDeviceRegistry([{ controllerId: 'controller', deviceId: 'light', extensions: { write: {
      inputSchema: { type: 'object', additionalProperties: false, properties: ticket
        ? { requestId: { type: 'object', additionalProperties: false, properties: { epoch: { type: 'string' }, sequence: { type: 'integer' } }, required: ['epoch', 'sequence'] } }
        : { request_id: { type: 'string', maxLength: 128 } }, required: [ticket ? 'requestId' : 'request_id'] },
      outputSchema: { type: 'object', additionalProperties: false, properties: {} },
      scope: 'control', description: 'Synthetic app write.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      invoke: async () => { submissions++; throw new Error('Synthetic uncertain write'); },
    } } }]);
    const tools = api.bindServiceTools(registry, { deviceId: 'light', bindings: [{ extension: 'write', name: 'write' }] });
    const maxResponseBytes = Buffer.byteLength(JSON.stringify({ tools })) + 100;
    const envelopeBytes = requestId => Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: '', result: gatewayFailure('uncertain-result', 'possible', requestId) }));
    const oldBytes = envelopeBytes('x'.repeat(128)), actualBytes = envelopeBytes(identity);
    assert.ok(actualBytes > oldBytes, 'fixture exceeds the previous reservation');
    const f = await httpFixture(t, { options: { registry, tools, limits: { maxResponseBytes } } });
    await f.initialize();
    const arguments_ = ticket ? { requestId: identity } : { request_id: identity };
    const response = await f.rpc('tools/call', { name: 'write', arguments: arguments_ }, { id: 'x'.repeat(maxResponseBytes - oldBytes) });
    assert.equal(submissions, 0, `failure metadata must fit before dispatch; response was ${JSON.stringify(response.body?.error)}`);
    assert.equal(response.status, 429);
    assert.ok(Buffer.byteLength(JSON.stringify(response.body)) <= maxResponseBytes);
    const admitted = await f.rpc('tools/call', { name: 'write', arguments: arguments_ }, { id: 'x'.repeat(maxResponseBytes - actualBytes - 10) });
    assert.equal(admitted.status, 200); assert.equal(submissions, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(admitted.body)) <= maxResponseBytes);
    assert.deepEqual(admitted.body.result.structuredContent, { kind: 'gateway-error', code: 'uncertain-result', priorEffects: 'possible',
      requestId: identity, retry: 'never-automatically' });
  });
}
