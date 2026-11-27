import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {BrightnessSetRequest, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {lifxSchemas} from '@jimmie-potts/lifx';
import type {BunnyModule, LifxDeviceFacts, ModuleContext} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {contextOf, edgeConfig, fixture, flush, it, manualClock, run} from './support.js';

it('MCP and Conversation dispatch through the same registered device admission', async context => {
  const operator = {source: 'bunny/parts/operator', token: 'synthetic-2193-control', scopes: ['read', 'control'] as const};
  const reader = {source: 'bunny/parts/reader', token: 'synthetic-2193-read', scopes: ['read'] as const};
  const clock = manualClock(1_700_000_000_000);
  let record = deviceRecord('fixture-light', 1, 'lifx', 'available');
  record.label = 'Fixture light';
  record.capabilities.brightness = {supported: true, minimum: 0, maximum: 100};
  record.observed = {status: 'known', observedAtMs: clock.now(), power: {status: 'known', value: true},
    brightness: {status: 'known', value: 35}};
  let device: ModuleContext | undefined;
  const writes: string[] = [];
  const lightFacts: LifxDeviceFacts & {revision: number} = {id: record.id, revision: 1,
    capabilities: {color: {supported: false}, temperature: {supported: true, minimum: 1500, maximum: 9000}},
    observed: {status: 'unknown'}};
  const temperatures: {requestId: string; kelvin: number}[] = [];
  const snapshot = () => ({...deviceState(record), dataschema: 'https://bunny.invalid/events/device/2.1'});
  const light: BunnyModule = {
    manifest: {name: 'lifx', apiVersion: '1.2', configure: config => ({config, devices: [record.id]})},
    async start(given) {
      device = given;
      await given.sdk.serveSync(['device'], () => ({revision: record.revision, states: [snapshot()]}));
      await given.sdk.serveSync(['lifx-light'], () => ({revision: 1, states: [{
        type: 'org.bunny.lifx-light.updated', subject: lightFacts.id, dataschema: 'https://bunny.invalid/events/lifx-light/2.0', data: lightFacts,
      }]}));
      await given.sdk.respond<BrightnessSetRequest>('bunny.cmd.brightness-set.fixture-light', command => {
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
  const client = async (token: string) => {
    const connected = new Client({name: 'shared-device-fixture', version: '1.0.0'});
    const stream = new StreamableHTTPClientTransport(new URL('/mcp', runtime.url), {
      requestInit: {headers: {authorization: `Bearer ${token}`}},
    });
    await connected.connect(stream as Transport);
    context.after(() => connected.close());
    return connected;
  };
  const control = await client(operator.token), readOnly = await client(reader.token);
  const lookup = async (caller: Client) => {
    const answer = await caller.callTool({name: 'core_device_lookup', arguments: {target: 'id:fixture-light'}});
    assert.equal(answer.isError, false, JSON.stringify(answer.structuredContent));
    return (answer.structuredContent as {data: {result: {devices: {
      id: string; name: string; actions: string[]; lastReportedAvailability: string; choices: {brightness: object};
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
    temperature: {supported: true, minimum: 1500, maximum: 9000, unit: 'kelvin', step: 1}});
  assert.deepEqual(await lookup(readOnly), {...found, actions: []});
  assert.equal((await readOnly.listTools()).tools.some(tool => tool.name === 'core_send_command'), false);

  const guard = {expectedConfigurationRevision: record.configurationRevision, expectedGeneration: record.generation};
  const mcp = async (requestId: string, data: object, target = 'fixture-light', family = 'brightness-set') => {
    const answer = await control.callTool({name: 'core_send_command', arguments: {family, target, requestId, data}});
    const body = (answer.structuredContent as {data: {result?: object; error?: {code: string}}}).data;
    return body.error?.code ?? body.result;
  };
  const conversationSend = async (payload: AssistantDispatch) => {
    const answer = await contextOf(companions).sdk.request('bunny.cmd.assistant-dispatch.assistant', {
      type: 'org.bunny.assistant.dispatch.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-dispatch/${payload.family === 'catalog-action' ? '2.3' : '2.1'}`, data: payload,
    }, {timeoutMs: 2000, requestId: payload.requestId});
    return answer.status === 'accepted' ? answer.status : answer.error.error.code;
  };
  const conversation = (requestId: string, percent: number, target = 'fixture-light') =>
    conversationSend({requestId, family: 'brightness-set', target, data: {...guard, percent}});
  const temperature = (requestId: string, kelvin: number) =>
    conversationSend({requestId, family: 'catalog-action', command: 'lifx-temperature-set', target: record.id,
      binding: {kind: 'device', owner: 'bunny/modules/lifx', target: record.id, configurationRevision: guard.expectedConfigurationRevision,
        generation: guard.expectedGeneration}, data: {kelvin}});
  const publish = async (patch: Partial<DeviceRecord>) => {
    assert.ok(device);
    record = {...record, revision: record.revision + 1, ...patch};
    await device.sdk.publish('bunny.state.device.fixture-light', {kind: 'state', ...snapshot()});
    await flush();
  };
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
  assert.deepEqual(temperatures, [{requestId: 'mcp-warmest', kelvin: 1500}, {requestId: 'conversation-warmest', kelvin: 1500}]);

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
