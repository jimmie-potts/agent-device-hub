import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { schema as contractSchema, validate } from '@jimmie-potts/device-contracts';
import { loadHostConfig, startLocalControllers } from '@jimmie-potts/local-controllers';
// The hub is a sibling workspace in this repository; its tests cannot import this host, so the joined checks live here.
import { startHub } from '../../hub/dist/server.js';
import { validateLightingRequest, validateLightingSnapshot } from '../../hub/dist/lifx-lighting.js';
import { LifxController } from '@jimmie-potts/lifx-controller';
import { TOKENS, fakeHub, fakeLifx, fakeTidbyt, privateFiles } from './helpers.mjs';

const operator = 'o'.repeat(43);
const profile = { profileId: 'lifx-light', profileVersion: '1.0.0' };

test('the hub reaches Tidbyt and LIFX through the local host, over HTTP and MCP', async t => {
  const s = privateFiles(t, await fakeHub(t));
  const lifx = fakeLifx(), tidbyt = fakeTidbyt();
  const local = await startLocalControllers(loadHostConfig(s.write('host.json', s.host)), {
    tidbyt: { connection: tidbyt.connection, leaseRoot: s.locks }, lifx: { transportFactory: lifx.transportFactory, leaseRoot: s.locks } });
  t.after(() => local.close());
  const directory = await mkdtemp(join(tmpdir(), 'hub-local-controllers-'));
  const endpoint = local.url + '/controller/v1';
  const hub = await startHub({ directory, ownerId: 'owner', consumers: [], mcp: true,
    credentials: [{ id: 'operator', digest: createHash('sha256').update(operator).digest('hex'), scopes: ['read', 'control'], devices: ['tidbyt', 'desk'] }],
    controllers: [
      { id: 'tidbyt', kind: 'tidbyt', controllerId: 'tidbyt-status', deviceId: 'tidbyt', endpoint, token: TOKENS.hub },
      { id: 'desk', kind: 'lifx', controllerId: 'lifx', deviceId: 'desk', endpoint, token: TOKENS.hub },
    ] });
  t.after(async () => { await hub.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (path, body) => {
    const response = await fetch(hub.url + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${operator}`, 'x-pixoo-request': '1', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const guards = (s, deviceId) => ({ apiVersion: '1.0', controllerId: s.identity.controllerId, deviceId, requestId: s.nextRequestId, expectedConfigurationRevision: s.configurationRevision, expectedGeneration: s.generation });

  const context = await call('/api/dashboard/v1/context');
  assert.deepEqual(context.body.components.map(c => [c.id, c.kind]), [['tidbyt', 'tidbyt'], ['desk', 'lifx']]);
  const status = await call('/api/controllers/v1/tidbyt/snapshot');
  assert.equal(validate('snapshot', status.body), true);
  const refused = await call('/api/controllers/v1/tidbyt/commands', { ...guards(status.body, 'tidbyt'), command: { kind: 'power.set', on: false } });
  assert.deepEqual([refused.status, refused.body.failure.code], [422, 'unsupported-capability']);

  const desk = await call('/api/controllers/v1/desk/snapshot');
  const brightness = await call('/api/controllers/v1/desk/commands', { ...guards(desk.body, 'desk'), command: { kind: 'brightness.set', percent: 25 } });
  assert.deepEqual([brightness.status, brightness.body.outcome], [200, 'sent']);
  const light = await call('/api/controllers/v1/desk/lighting/snapshot');
  assert.equal(light.body.lighting.observation.status, 'known');
  const color = await call('/api/controllers/v1/desk/lighting/commands', { ...guards(light.body.controller, 'desk'), profile, command: { kind: 'lifx.color.set', hue: 280, saturation: 90 } });
  assert.deepEqual([color.status, color.body.outcome], [200, 'sent']);
  // One on-demand read from the first snapshot, then two read-modify-writes.
  assert.deepEqual(lifx.log, [['desk', 101], ['desk', 101], ['desk', 102], ['desk', 101], ['desk', 102]]);
  assert.ok(!tidbyt.calls.includes('push'));

  // MCP discovery and the LIFX lighting tool reach the same owner.
  let session, id = 0;
  const rpc = async (method, params) => {
    const response = await fetch(hub.url + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${operator}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: ++id }), method, params }) });
    if (!session) session = response.headers.get('mcp-session-id');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-controllers-check', version: '1' } });
  await rpc('notifications/initialized');
  const devices = (await rpc('tools/call', { name: 'hub_devices', arguments: {} })).result.structuredContent.data.result.devices;
  assert.deepEqual(devices.map(d => [d.alias, d.kind, d.controllerId, d.deviceId]), [['tidbyt', 'tidbyt', 'tidbyt-status', 'tidbyt'], ['desk', 'lifx', 'lifx', 'desk']]);
  const prefix = devices.find(d => d.alias === 'desk').toolPrefix;
  const latest = (await rpc('tools/call', { name: prefix + '_status', arguments: {} })).result.structuredContent.data.result;
  const warm = await rpc('tools/call', { name: prefix + '_temperature_set', arguments: { requestId: latest.nextRequestId, expectedConfigurationRevision: latest.configurationRevision, expectedGeneration: latest.generation, kelvin: 2700 } });
  assert.deepEqual([warm.result.isError, warm.result.structuredContent.data.result.outcome], [false, 'sent']);
  assert.equal(lifx.log.length, 7);
});

test('the hub lighting validator accepts exactly what the LIFX profile schema accepts', async () => {
  const ajv = new Ajv2020({ strict: true });
  ajv.addSchema(contractSchema);
  const owner = ajv.compile(JSON.parse(await readFile(new URL('../../../controllers/lifx/schemas/lifx-light-1.0.0.schema.json', import.meta.url), 'utf8')));
  const base = { apiVersion: '1.0', controllerId: 'lifx', deviceId: 'desk', requestId: { epoch: 'e', sequence: 3 }, expectedConfigurationRevision: 2, expectedGeneration: { epoch: 'e', sequence: 0 }, profile };
  const color = (hue, saturation, extra = {}) => ({ ...base, command: { kind: 'lifx.color.set', hue, saturation, ...extra } });
  const kelvin = value => ({ ...base, command: { kind: 'lifx.temperature.set', kelvin: value } });
  const { profile: _, ...noProfile } = color(1, 1);
  const cases = [
    color(0, 0), color(360, 100), color(180, 50), kelvin(1500), kelvin(9000), kelvin(2700),
    color(-1, 0), color(361, 0), color(1.5, 0), color('1', 0), color(1, 101), color(1, -1), color(1, 1, { brightness: 1 }),
    kelvin(1499), kelvin(9001), kelvin(2700.5), { ...kelvin(2700), command: { kind: 'lifx.temperature.set' } },
    { ...color(1, 1), address: '192.0.2.1' }, noProfile, { ...color(1, 1), profile: { ...profile, profileVersion: '1.0.1' } },
    { ...color(1, 1), profile: { ...profile, profileId: 'other' } }, { ...color(1, 1), profile: { ...profile, extra: true } },
    { ...base, command: { kind: 'brightness.set', percent: 5 } }, { ...base, command: { kind: 'power.set', on: true } },
    { ...color(1, 1), apiVersion: '1.1' }, { ...color(1, 1), requestId: { epoch: 'e', sequence: -1 } }, { ...color(1, 1), deviceId: 'bad/id' },
    (({ expectedGeneration: _g, ...rest }) => rest)(color(1, 1)), { ...color(1, 1), expectedConfigurationRevision: 2 ** 53 },
    null, [], 'text',
  ];
  for (const value of cases) assert.equal(validateLightingRequest(value), owner(value) === true, JSON.stringify(value));
  assert.equal(cases.filter(value => owner(value)).length, 6);
});

test('a lighting snapshot read while status paints are queued or in flight stays valid lifx-light 1.0.0 for the hub (#450)', async () => {
  const bulb = { deviceId: 'desk', address: '192.0.2.10', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90 };
  const c = new LifxController({ controllerId: 'lifx', sourceId: 'test', bulbs: [bulb], timeoutMs: 10, retries: 0,
    transportFactory: () => ({ exchange: () => new Promise(() => {}), close() {} }) });
  const first = c.paintStatus('desk', { hue: 1, saturation: 2, brightness: 3, kelvin: 3500 });
  const second = c.paintStatus('desk', { hue: 4, saturation: 5, brightness: 6, kelvin: 2700 });
  assert.equal(first.decision, 'queued');
  assert.equal(second.decision, 'queued');
  const snapshot = c.snapshot('desk');
  assert.equal(validateLightingSnapshot(snapshot), true, 'the hub accepts the lighting snapshot mid-paint');
  assert.deepEqual(snapshot.lighting.pending, [], 'status paints are not listed as lighting commands');
  assert.deepEqual(snapshot.controller.state.pending, []);
  await Promise.all([first.done, second.done]);
  c.close();
});
