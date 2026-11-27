import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ObservationBasis} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {BrightnessSetRequest, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {lifxSchemas} from '@jimmie-potts/lifx';
import {Outcome, type BunnyModule, type LifxDeviceFacts, type ModuleContext} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {contextOf, edgeConfig, fixture, flush, it, manualClock, run, waitFor} from './support.js';

const operator = {source: 'bunny/parts/operator', token: 'synthetic-2193-control', scopes: ['read', 'control'] as const};
const reader = {source: 'bunny/parts/reader', token: 'synthetic-2193-read', scopes: ['read'] as const};

async function client(context: TestContext, url: string, token: string): Promise<Client> {
  const connected = new Client({name: 'shared-device-fixture', version: '1.0.0'});
  const stream = new StreamableHTTPClientTransport(new URL('/mcp', url), {
    requestInit: {headers: {authorization: `Bearer ${token}`}},
  });
  await connected.connect(stream as Transport);
  context.after(() => connected.close());
  return connected;
}

it('MCP and Conversation dispatch through the same registered device admission', async context => {
  const clock = manualClock(1_700_000_000_000);
  let record = deviceRecord('fixture-light', 1, 'lifx', 'available');
  record.label = 'Fixture light';
  record.capabilities.brightness = {supported: true, minimum: 0, maximum: 100};
  record.observed = {status: 'known', observedAtMs: clock.now(), power: {status: 'known', value: true},
    brightness: {status: 'known', value: 35}};
  const other: DeviceRecord = {...record, id: 'fixture-other', label: 'Other light'};
  let device: ModuleContext | undefined;
  const writes: string[] = [];
  let lightFacts: LifxDeviceFacts & {revision: number} = {id: record.id, revision: 1,
    capabilities: {color: {supported: false}, temperature: {supported: true, minimum: 2700, maximum: 6500}},
    observed: {status: 'known', observedAtMs: clock.now(), hue: 0, saturation: 0, brightness: 35, kelvin: 3600}};
  const temperatures: {requestId: string; kelvin: number}[] = [];
  const snapshot = () => ({...deviceState(record), dataschema: 'https://bunny.invalid/events/device/2.1'});
  const light: BunnyModule = {
    manifest: {name: 'lifx', apiVersion: '1.2', configure: config => ({config, devices: [record.id, other.id]})},
    async start(given) {
      device = given;
      await given.sdk.serveSync(['device'], () => ({revision: record.revision, states: [snapshot(), deviceState(other)]}));
      await given.sdk.serveSync(['lifx-light'], () => ({revision: lightFacts.revision, states: [{
        type: 'org.bunny.lifx-light.updated', subject: lightFacts.id, dataschema: 'https://bunny.invalid/events/lifx-light/2.1', data: lightFacts,
      }]}));
      await given.sdk.respond<BrightnessSetRequest>('bunny.cmd.brightness-set.*', command => {
        writes.push(command.data.requestId);
        return {status: 'accepted'};
      });
      await given.sdk.respond<{requestId: string; kelvin: number}>('bunny.cmd.lifx-temperature-set.fixture-light', command => {
        const {requestId, kelvin} = command.data;
        temperatures.push({requestId, kelvin});
        return {status: 'accepted'};
      });
    },
    stop() {},
  };
  const companions = fixture('companions');
  let core: CoreHandle | undefined;
  const files = await edgeConfig(context, [operator, reader], {mcp: true, modules: {lifx: {}}});
  const {runtime} = await run(context, {modules: [
    createCoreModule({parts: [{start: handle => {core = handle; return Promise.resolve();}}]}), light, companions,
  ], configFile: files.config, clock, scheduler: clock.scheduler, edge: {schemas: lifxSchemas}});
  const control = await client(context, runtime.url, operator.token), readOnly = await client(context, runtime.url, reader.token);
  const lookup = async (caller: Client) => {
    const answer = await caller.callTool({name: 'core_device_lookup', arguments: {target: 'id:fixture-light'}});
    assert.equal(answer.isError, false, JSON.stringify(answer.structuredContent));
    return (answer.structuredContent as {data: {result: {devices: {
      id: string; name: string; actions: string[]; observationBases: ObservationBasis[]; lastReportedAvailability: string; choices: {brightness: object};
      observation: {freshness: string; value: DeviceRecord['observed']};
      lightCapabilities: {color: {supported: boolean}; temperature: {minimum: number; maximum: number; unit: string}};
    }[]}}}).data.result.devices[0];
  };
  const found = await lookup(control);
  assert.equal(found?.id, record.id);
  assert.equal(found?.name, record.label);
  assert.equal(found?.lastReportedAvailability, 'available');
  assert.deepEqual(found?.choices.brightness, {supported: true, minimum: 0, maximum: 100, unit: 'percent', step: 1});
  assert.deepEqual(found?.observation, {freshness: 'current', value: record.observed});
  assert.deepEqual(found?.actions, ['brightness-set', 'lifx-temperature-set']);
  assert.deepEqual(found?.lightCapabilities, {color: {supported: false},
    temperature: {supported: true, minimum: 2700, maximum: 6500, unit: 'kelvin', step: 1}});
  assert.deepEqual(await lookup(readOnly), {...found, actions: [], observationBases: []});
  assert.equal((await readOnly.listTools()).tools.some(tool => tool.name === 'core_send_command'), false);

  const guard = {expectedConfigurationRevision: record.configurationRevision, expectedGeneration: record.generation};
  const mcp = async (requestId: string, data: object, target = 'fixture-light', family = 'brightness-set', basis?: ObservationBasis) => {
    const answer = await control.callTool({name: 'core_send_command', arguments: {family, target, requestId, data, ...(basis === undefined ? {} : {observationBasis: basis})}});
    const body = (answer.structuredContent as {data: {result?: object; error?: {code: string}}}).data;
    return body.error?.code ?? body.result;
  };
  const conversationSend = async (payload: AssistantDispatch) => {
    const answer = await contextOf(companions).sdk.request('bunny.cmd.assistant-dispatch.assistant', {
      type: 'org.bunny.assistant.dispatch.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-dispatch/${payload.observationBasis !== undefined ? '2.4' : payload.family === 'catalog-action' ? '2.3' : '2.1'}`, data: payload,
    }, {timeoutMs: 2000, requestId: payload.requestId});
    return answer.status === 'accepted' ? answer.status : answer.error.error.code;
  };
  const conversation = (requestId: string, percent: number, target = 'fixture-light', basis?: ObservationBasis) =>
    conversationSend({requestId, family: 'brightness-set', target, data: {...guard, percent},
      ...(basis === undefined ? {} : {observationBasis: basis})});
  const temperature = (requestId: string, kelvin: number, basis?: ObservationBasis) =>
    conversationSend({requestId, family: 'catalog-action', command: 'lifx-temperature-set', target: record.id,
      ...(basis === undefined ? {} : {observationBasis: basis}),
      binding: {kind: 'device', owner: 'bunny/modules/lifx', target: record.id, configurationRevision: guard.expectedConfigurationRevision,
        generation: guard.expectedGeneration}, data: {kelvin}});
  const publish = async (patch: Partial<DeviceRecord>) => {
    assert.ok(device);
    record = {...record, revision: record.revision + 1, ...patch};
    await device.sdk.publish('bunny.state.device.fixture-light', {kind: 'state', ...snapshot()});
    await flush();
  };
  const completed = async (requestId: string, family = 'brightness-set', target = record.id) => {
    assert.ok(device);
    await device.sdk.publish(`bunny.event.${family}.${target}`, {
      kind: 'outcome', type: family === 'brightness-set' ? 'org.bunny.brightness.set.completed' : 'org.bunny.lifx-temperature.set.completed',
      subject: target, dataschema: 'https://bunny.invalid/events/outcome/2.0',
      data: {requestId, result: Outcome.succeeded, evidence: Outcome.transmitted},
    });
    await waitFor(() => core?.operation(requestId)?.status === 'completed', 1500, 'disposable writer outcome');
  };
  const base = found.observationBases.find(basis => basis.kind === 'brightness');
  const color = found.observationBases.find(basis => basis.kind === 'temperature');
  assert.deepEqual(base, {kind: 'brightness', observedAtMs: clock.now(), value: 35});
  assert.deepEqual(color, {kind: 'temperature', observedAtMs: clock.now(), value: 3600});
  const relative = (requestId: string, basis: ObservationBasis) =>
    mcp(requestId, {...guard, percent: 45}, record.id, 'brightness-set', basis);
  assert.equal(await relative('mcp-wrong-base', {...base, value: 34}), 'revision-conflict');
  assert.equal(await conversation('conversation-wrong-base', 45, record.id, {...base, value: 34}), 'revision-conflict');
  assert.deepEqual(await relative('mcp-relative', base), {status: 'accepted', requestId: 'mcp-relative'});
  assert.equal(await conversation('conversation-in-flight', 45, record.id, base), 'revision-conflict');
  assert.equal(await conversation('conversation-other-target', 45, other.id, base), 'accepted');
  await completed('conversation-other-target', 'brightness-set', other.id);
  await completed('mcp-relative');
  assert.equal(await conversation('conversation-after-newer-send', 45, record.id, base), 'revision-conflict');
  assert.equal(await relative('mcp-relative', {...base, value: 34}), 'duplicate-conflict');
  assert.deepEqual(await relative('mcp-relative', base), {status: 'accepted', requestId: 'mcp-relative'});

  assert.ok(record.observed.status === 'known');
  clock.advance(1);
  await publish({observed: {...record.observed, observedAtMs: clock.now(), brightness: {status: 'known', value: 45}}});
  const next = (await lookup(control))?.observationBases.find(basis => basis.kind === 'brightness');
  assert.deepEqual(next, {kind: 'brightness', observedAtMs: clock.now(), value: 45});
  assert.equal(await conversation('conversation-relative', 55, record.id, next), 'accepted');
  assert.equal(await relative('mcp-in-flight', next), 'revision-conflict');
  await completed('conversation-relative');

  assert.ok(lightFacts.observed.status === 'known');
  clock.advance(1);
  lightFacts = {...lightFacts, revision: 2, observed: {...lightFacts.observed, observedAtMs: clock.now()}};
  const temperatureBase = (await lookup(control))?.observationBases.find(basis => basis.kind === 'temperature');
  assert.deepEqual(temperatureBase, {kind: 'temperature', observedAtMs: clock.now(), value: 3600});
  assert.equal(await temperature('conversation-stale-temperature', 3400, color), 'revision-conflict');
  assert.equal(await temperature('conversation-relative-temperature', 3400, temperatureBase), 'accepted');
  assert.equal(await mcp('mcp-temperature-in-flight', {...guard, kelvin: 3400}, record.id, 'lifx-temperature-set', temperatureBase), 'revision-conflict');
  await completed('conversation-relative-temperature', 'lifx-temperature-set');

  assert.ok(lightFacts.observed.status === 'known');
  clock.advance(1);
  lightFacts = {...lightFacts, revision: 3, observed: {...lightFacts.observed, observedAtMs: clock.now(), kelvin: 3400}};
  const currentTemperature = (await lookup(control))?.observationBases.find(basis => basis.kind === 'temperature');
  assert.deepEqual(currentTemperature, {kind: 'temperature', observedAtMs: clock.now(), value: 3400});
  assert.deepEqual(await mcp('mcp-relative-temperature', {...guard, kelvin: 3300}, record.id, 'lifx-temperature-set', currentTemperature),
    {status: 'accepted', requestId: 'mcp-relative-temperature'});
  await completed('mcp-relative-temperature', 'lifx-temperature-set');
  assert.deepEqual(temperatures.splice(0), [
    {requestId: 'conversation-relative-temperature', kelvin: 3400}, {requestId: 'mcp-relative-temperature', kelvin: 3300},
  ]);
  assert.deepEqual(writes.splice(0), ['mcp-relative', 'conversation-other-target', 'conversation-relative']);

  const command = {...guard, percent: 60};
  assert.deepEqual(await mcp('mcp-valid', command), {status: 'accepted', requestId: 'mcp-valid'});
  assert.equal(await conversation('conversation-valid', 60), 'accepted');
  assert.equal(core?.operation('mcp-valid')?.requestedBy, operator.source);
  assert.equal(core?.operation('conversation-valid')?.requestedBy, 'bunny/modules/companions');
  assert.deepEqual(await mcp('mcp-legacy', {percent: 59}), {status: 'accepted', requestId: 'mcp-legacy'});
  assert.deepEqual(writes, ['mcp-valid', 'conversation-valid', 'mcp-legacy']);

  const warmest = found.lightCapabilities.temperature.minimum;
  assert.deepEqual(await mcp('mcp-warmest', {...guard, kelvin: warmest}, record.id, 'lifx-temperature-set'),
    {status: 'accepted', requestId: 'mcp-warmest'});
  assert.equal(await temperature('conversation-warmest', warmest), 'accepted');
  assert.equal(await mcp('mcp-too-warm', {...guard, kelvin: warmest - 1}, record.id, 'lifx-temperature-set'), 'invalid-request');
  assert.equal(await temperature('conversation-too-warm', warmest - 1), 'invalid-request');
  assert.equal(await mcp('mcp-color', {...guard, hue: 10, saturation: 50}, record.id, 'lifx-color-set'), 'unsupported-capability');
  assert.deepEqual(temperatures, [{requestId: 'mcp-warmest', kelvin: 2700}, {requestId: 'conversation-warmest', kelvin: 2700}]);

  assert.equal(await mcp('mcp-invalid', {...guard, percent: 101}), 'invalid-request');
  assert.equal(await conversation('conversation-invalid', 101), 'invalid-message');
  assert.equal(await mcp('mcp-missing', command, 'missing-light'), 'not-found');
  assert.equal(await conversation('conversation-missing', 60, 'missing-light'), 'not-found');
  await publish({configurationRevision: record.configurationRevision + 1});
  assert.equal(await mcp('mcp-stale', command), 'revision-conflict');
  assert.equal(await conversation('conversation-stale', 60), 'revision-conflict');
  await publish({configurationRevision: guard.expectedConfigurationRevision, held: {requestId: 'fixture-hold', heldAtMs: clock.now()}});
  assert.equal(await mcp('mcp-held', command), 'unavailable');
  assert.equal(await conversation('conversation-held', 60), 'unavailable');
  assert.deepEqual(await mcp('mcp-valid', command), {status: 'accepted', requestId: 'mcp-valid'});
  assert.equal(await conversation('conversation-valid', 60), 'accepted');
  assert.equal(await mcp('mcp-valid', {...command, percent: 61}), 'duplicate-conflict');
  assert.equal(await mcp('conversation-valid', command), 'duplicate-conflict');
  assert.deepEqual(await mcp('mcp-legacy', {percent: 59}), {status: 'accepted', requestId: 'mcp-legacy'});
  assert.deepEqual(writes, ['mcp-valid', 'conversation-valid', 'mcp-legacy']);
});

it('MCP resolves an exact Pixoo playlist outside its capability preview through the writer', async context => {
  const preview = '11111111-1111-4111-8111-111111111111', full = '22222222-2222-4222-8222-222222222222';
  const missing = '33333333-3333-4333-8333-333333333333';
  const record = deviceRecord('fixture-pixoo', 1, 'pixoo', 'available');
  record.capabilities.media = {supported: true, actions: ['pause'], playlistIds: [preview], renditionIds: []};
  const written: string[] = [];
  const pixoo: BunnyModule = {
    manifest: {name: 'pixoo', apiVersion: '1.2', configure: config => ({config, devices: [record.id]})},
    async start({sdk}) {
      await sdk.serveSync(['device'], () => ({revision: 1, states: [deviceState(record)]}));
      await sdk.respond<{playlistId: string}>('bunny.cmd.media-start.fixture-pixoo', command => {
        if (command.data.playlistId !== full) return errorBody('unsupported-capability');
        written.push(command.data.playlistId);
        return {status: 'accepted'};
      });
    },
    stop() {},
  };
  const files = await edgeConfig(context, [operator], {mcp: true, modules: {pixoo: {}}});
  const {runtime} = await run(context, {modules: [createCoreModule(), pixoo], configFile: files.config, edge: {schemas: {}}});
  const mcp = await client(context, runtime.url, operator.token);
  const answer = await mcp.callTool({name: 'core_device_lookup', arguments: {target: 'id:fixture-pixoo'}});
  const lookup = answer.structuredContent as {data: {result: {devices: {choices: {media: {playlistIds: string[]; playlistIdsComplete: boolean}}}[]}}};
  assert.deepEqual(lookup.data.result.devices[0]?.choices.media.playlistIds, [preview]);
  assert.equal(lookup.data.result.devices[0]?.choices.media.playlistIdsComplete, false);
  const start = (requestId: string, playlistId: string) => mcp.callTool({name: 'core_send_command',
    arguments: {family: 'media-start', target: record.id, data: {playlistId}, requestId}});
  assert.equal((await start('outside-preview', full)).isError, false);
  const refused = await start('missing-playlist', missing);
  assert.equal(refused.isError, true);
  assert.equal((refused.structuredContent as {data: {error: {code: string}}}).data.error.code, 'unsupported-capability');
  assert.deepEqual(written, [full]);
});
