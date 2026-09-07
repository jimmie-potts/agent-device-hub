import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as api from '../dist/index.js';
import { args, fixture, owner, principal, snapshot } from './helpers.mjs';

test('default-bound status delegates to the configured owner without target arguments', async () => {
  const api = await import('../dist/index.js');
  assert.equal(typeof api.createDeviceRegistry, 'function', 'device registry must be exported');
  const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url)));
  let reads = 0;
  const registry = api.createDeviceRegistry([{
    controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
    service: { readSnapshot: async () => { reads++; return snapshot; }, submit: async () => assert.fail('status cannot command') },
  }]);
  const tools = api.bindDeviceTools(registry, { deviceId: snapshot.identity.deviceId, prefix: 'pixoo' });
  const tool = tools.find(t => t.name === 'pixoo_status');
  assert.ok(tool);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.properties, {});
  const principal = { id: 'fixture', credential: { kind: 'machine', status: 'active', declared: true,
    devices: [snapshot.identity.deviceId], scopes: ['read', 'control'] } };
  const result = await api.invokeDeviceTool(registry, tool, {}, principal);
  assert.equal(reads, 1);
  assert.deepEqual(result.structuredContent, { kind: 'snapshot', snapshot });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.isError, false);
});

test('strict registry rejects duplicate identities and missing service/binding', () => {
  const f = fixture();
  const entry = { deviceId: 'light', controllerId: 'controller', service: f.service };
  assert.throws(() => api.createDeviceRegistry([entry, entry]));
  assert.throws(() => api.createDeviceRegistry([{ deviceId: 'light', controllerId: 'controller' }]));
  assert.throws(() => api.bindDeviceTools(f.registry, { deviceId: 'other', prefix: 'bad' }));
  assert.throws(() => api.bindDeviceTools(f.registry, { deviceId: 'light', prefix: 'not valid' }));
  assert.throws(() => { f.registry.get('light').deviceId = 'other'; });
});

test('generic discovery filters device/read scopes and uses explicit registered IDs', async () => {
  const f = fixture(), tools = api.createDeviceTools(f.registry);
  const list = identity => api.invokeDeviceTool(f.registry, tools[0], {}, identity);
  assert.deepEqual((await list(principal())).structuredContent.devices, [{ deviceId: 'light', controllerId: 'controller' }]);
  assert.deepEqual((await list(principal({ devices: ['other'] }))).structuredContent.devices, []);
  assert.deepEqual((await list(principal({ scopes: ['control'] }))).structuredContent.devices, []);
  assert.equal((await api.invokeDeviceTool(f.registry, tools[1], { deviceId: 'light' }, principal())).structuredContent.kind, 'snapshot');
  assert.equal((await api.invokeDeviceTool(f.registry, tools[1], { deviceId: 'http://unconfigured' }, principal())).structuredContent.code, 'invalid-request');
});

for (const [name, change] of [
  ['fractional brightness', { percent: 1.5 }], ['negative brightness', { percent: -1 }], ['high brightness', { percent: 101 }],
  ['unsafe revision', { expectedConfigurationRevision: Number.MAX_SAFE_INTEGER + 1 }], ['raw url', { url: 'http://device' }],
  ['target override', { deviceId: 'other' }], ['raw command', { command: { kind: 'reset' } }], ['extra ticket field', { requestId: { epoch: 'requests-1', sequence: 1, secret: true } }],
]) test(`strict setter rejects ${name} before dispatch`, async () => {
  const f = fixture();
  assert.equal((await f.invoke('brightness_set', args(change))).structuredContent.code, 'invalid-request');
  assert.equal(f.calls.length, 0);
});

test('read scope, machine credential and device scope are mandatory before status or replay', async () => {
  const f = fixture();
  for (const credential of [{ scopes: ['read'] }, { devices: ['other'] }]) {
    assert.equal((await f.invoke('brightness_set', args(), principal(credential))).structuredContent.code, 'forbidden');
  }
  for (const credential of [{ kind: 'browser' }, { status: 'revoked' }, { declared: false }, { status: 'invalid' }, { secret: 'private' }]) {
    assert.equal((await f.invoke('status', {}, principal(credential))).structuredContent.code, 'unauthenticated');
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.invoke('status', {}, principal({ status: 'overlap' }))).structuredContent.kind, 'snapshot');
});

test('submitted request retains exact controller ticket, revisions and command', async () => {
  const f = fixture();
  const result = await f.invoke('brightness_set', args());
  assert.deepEqual(f.calls[0].request, { apiVersion: '1.0', controllerId: 'controller', deviceId: 'light', requestId: args().requestId,
    expectedConfigurationRevision: 4, expectedGeneration: args().expectedGeneration, command: { kind: 'brightness.set', percent: 40 } });
  assert.equal(Object.hasOwn(f.calls[0].context, 'signal'), false);
  assert.equal(result.structuredContent.receipt.outcome, 'queued');
  assert.equal(result.isError, false);
});

test('UI and MCP share atomic owner admission, in-flight join and immutable replay', async () => {
  const backend = owner(), f = fixture(backend.service);
  const first = f.invoke('brightness_set', args());
  const context = { principalId: 'fixture', authorization: { credential: principal().credential, deviceId: 'light', scope: 'control',
    hostAllowed: true, originPresent: false, originAllowed: true, fetchMetadataAllowed: true } };
  const request = { apiVersion: '1.0', controllerId: 'controller', deviceId: 'light', requestId: args().requestId,
    expectedConfigurationRevision: 4, expectedGeneration: args().expectedGeneration, command: { kind: 'brightness.set', percent: 40 } };
  const directUi = backend.service.submit(request, context);
  const conflict = await f.invoke('brightness_set', args({ percent: 41 }));
  assert.equal(conflict.structuredContent.code, 'request-conflict');
  assert.equal(backend.scheduled, 1);
  const receipt = backend.finish();
  assert.deepEqual((await first).structuredContent.receipt, receipt);
  assert.deepEqual((await directUi).receipt, receipt);
  const replay = await f.invoke('brightness_set', { percent: 40, expectedGeneration: args().expectedGeneration,
    expectedConfigurationRevision: 4, requestId: { sequence: 1, epoch: 'requests-1' } });
  assert.deepEqual(replay.structuredContent.receipt, receipt);
  assert.equal(backend.scheduled, 1);
  backend.state.cache = [];
  assert.equal((await f.invoke('brightness_set', args())).structuredContent.code, 'request-expired');
  assert.equal((await f.invoke('brightness_set', args({ requestId: { epoch: 'old-epoch', sequence: 1 } }))).structuredContent.code, 'request-expired');
});

for (const [name, alter] of [
  ['revision-conflict', b => { b.state.configurationRevision++; }],
  ['stale-generation', b => { b.state.generation = { epoch: 'new-generation', sequence: 0 }; }],
  ['unsupported-capability', b => { b.state.capabilities.brightness = { supported: false }; }],
]) test(`owning ${name} receipt is preserved without scheduling`, async () => {
  const backend = owner(); alter(backend);
  const result = await fixture(backend.service).invoke('brightness_set', args());
  assert.equal(result.structuredContent.receipt.failure.code, name);
  assert.equal(result.structuredContent.receipt.priorEffects, 'none');
  assert.equal(backend.scheduled, 0);
});

for (const [outcome, priorEffects] of [['sent', 'confirmed-transmission'], ['partially-applied', 'confirmed-transmission'],
  ['uncertain', 'possible'], ['cancelled', 'none'], ['cancelled', 'confirmed-transmission']]) {
  test(`${outcome}/${priorEffects} retains owner evidence`, async () => {
    const backend = owner(), f = fixture(backend.service), pending = f.invoke('brightness_set', args());
    const receipt = backend.finish(1, outcome, priorEffects);
    const result = await pending;
    assert.deepEqual(result.structuredContent.receipt, receipt);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(result.isError, outcome !== 'sent');
  });
}

test('explicit cancellation before dispatch causes no owner call', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  const result = await f.invoke('brightness_set', args(), principal(), { signal: controller.signal });
  assert.equal(result.structuredContent.code, 'cancelled'); assert.equal(f.calls.length, 0);
});

test('post-dispatch invalid and thrown results are uncertain and never leak or retry', async () => {
  for (const response of [async () => { throw new Error('private credential/database path'); }, async () => ({ kind: 'receipt', receipt: {} })]) {
    let calls = 0;
    const f = fixture({ submit: async (...args) => { calls++; return response(...args); } });
    const result = await f.invoke('brightness_set', args());
    assert.equal(result.structuredContent.priorEffects, 'possible');
    assert.deepEqual(result.structuredContent.requestId, args().requestId);
    assert.equal(result.structuredContent.retry, 'never-automatically');
    assert.equal(JSON.stringify(result).includes('private'), false); assert.equal(calls, 1);
  }
});

test('ready status preserves unknown observation, pending intent and old evidence', async () => {
  const f = fixture(), before = structuredClone(f.state);
  const result = await f.invoke('status');
  assert.deepEqual(result.structuredContent.snapshot, before);
  assert.equal(result.structuredContent.snapshot.state.observation.status, 'unknown');
  assert.deepEqual(f.state, before);
});

test('read/write tool hints and published schemas match operation intent', () => {
  const f = fixture();
  for (const tool of f.tools) {
    const write = !tool.name.endsWith('_status');
    assert.deepEqual(tool.annotations, { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write, openWorldHint: true });
    assert.ok(tool.outputSchema); assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('extension-only registration supports legacy request identity and catalog results', async () => {
  const requests = [];
  const inputSchema = { type: 'object', properties: { on: { type: 'boolean' }, request_id: { type: 'string', maxLength: 128 } },
    required: ['on', 'request_id'], additionalProperties: false };
  const catalog = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false };
  const registry = api.createDeviceRegistry([{ deviceId: 'light', controllerId: 'controller', extensions: {
    screen: { inputSchema, outputSchema: { type: 'object', properties: { queued: { type: 'boolean' } }, required: ['queued'], additionalProperties: false },
      scope: 'control', description: 'Set screen through the existing player request owner.', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      invoke: async (input, context) => { requests.push({ input, context }); return { data: { queued: true } }; } },
    catalog: { inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: catalog,
      scope: 'read', description: 'Read existing media identifiers.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      invoke: async () => ({ data: { items: ['existing-rendition'] } }) },
    failing: { inputSchema, outputSchema: catalog, scope: 'control', description: 'Synthetic failed player command.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, invoke: async () => { throw new Error('private-path'); } },
  } }]);
  assert.throws(() => api.createDeviceTools(registry));
  const tools = api.bindServiceTools(registry, { deviceId: 'light', bindings: [
    { extension: 'screen', name: 'set_screen' }, { extension: 'catalog', name: 'list_media' }, { extension: 'failing', name: 'show_media' }] });
  const result = await api.invokeDeviceTool(registry, tools[0], { on: true, request_id: 'existing-app-id' }, principal());
  assert.deepEqual(result.structuredContent, { kind: 'extension', data: { queued: true } });
  assert.deepEqual(requests[0].input, { on: true, request_id: 'existing-app-id' });
  assert.equal(requests[0].context.authorization.deviceId, 'light');
  assert.equal((await api.invokeDeviceTool(registry, tools[0], { on: true, request_id: 'x' }, principal({ scopes: ['read'] }))).structuredContent.code, 'forbidden');
  assert.deepEqual((await api.invokeDeviceTool(registry, tools[1], {}, principal())).structuredContent, { kind: 'extension', data: { items: ['existing-rendition'] } });
  const failure = await api.invokeDeviceTool(registry, tools[2], { on: true, request_id: 'legacy-uncertain' }, principal());
  assert.equal(failure.structuredContent.priorEffects, 'possible'); assert.equal(failure.structuredContent.requestId, 'legacy-uncertain');
  assert.equal(JSON.stringify(failure).includes('private-path'), false);
});
