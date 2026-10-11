import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {createOnnModule, onnSchemas, ONN_SIMULATED_SECTION, SimulatedOnn} from '@jimmie-potts/onn';
import {createCoreModule} from '../src/index.js';
import {edgeConfig, it, run, stateDir, waitFor} from './support.js';
const operator = {source: 'bunny/parts/operator', token: 'synthetic-onn-operator', scopes: ['read', 'control'] as const};
const reader = {source: 'bunny/parts/reader', token: 'synthetic-onn-reader', scopes: ['read'] as const};

it('a real MCP protocol client discovers ONN state and sends the same authenticated typed actions without retaining text', async context => {
  const files = await edgeConfig(context, [operator, reader], {mcp: true, modules: {onn: ONN_SIMULATED_SECTION}}), device = new SimulatedOnn();
  const privateState = await stateDir(context);
  const {runtime, logs} = await run(context, {stateDir: privateState, configFile: files.config, modules: [createCoreModule(), createOnnModule({transport: device})], edge: {schemas: onnSchemas}});
  const clients: Client[] = [];
  const client = async (token: string): Promise<Client> => {
    const connected = new Client({name: 'onn-synthetic-protocol-client', version: '1'});
    // The SDK's concrete transport declares sessionId as possibly undefined while its interface declares an optional string.
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', runtime.url), {requestInit: {headers: {Authorization: `Bearer ${token}`}}});
    clients.push(connected); await connected.connect(transport as unknown as Transport);
    return connected;
  };
  context.after(async () => {for (const connected of clients) await connected.close();});
  const control = await client(operator.token), read = await client(reader.token);
  const names = (await control.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('onn_status')); assert.ok(names.includes('core_send_command'));
  const readNames = (await read.listTools()).tools.map(tool => tool.name);
  assert.ok(readNames.includes('onn_status')); assert.ok(!readNames.includes('core_send_command'));
  assert.equal((await read.callTool({name: 'onn_status', arguments: {}})).isError, false);
  assert.equal(device.effects, 0, 'discovery and status read send no controls');
  const readonly = await read.callTool({name: 'core_send_command', arguments: {family: 'onn-key-press', target: 'onn', data: {key: 'right'}}});
  assert.equal(readonly.isError, true); assert.equal(device.effects, 0);
  let index = 0;
  for (const [family, data] of [
    ...['up', 'down', 'left', 'right', 'select', 'back', 'home', 'play-pause'].map(key => ['onn-key-press', {key}] as const),
    ['onn-app-open', {app: 'youtube'}], ['onn-app-open', {app: 'stremio'}], ['onn-text', {text: 'SYNTHETIC_PRIVATE_1039'}],
  ] as const) {
    const args = {family, target: 'onn', data, requestId: `mcp-onn-${index}`};
    assert.equal((await control.callTool({name: 'core_send_command', arguments: args})).isError, false);
    index += 1; await waitFor(() => device.effects === index);
    assert.equal((await control.callTool({name: 'core_send_command', arguments: args})).isError, false);
    assert.equal(device.effects, index, 'matching retry sends nothing');
  }
  const invalid = await control.callTool({name: 'core_send_command', arguments: {family: 'onn-text', target: 'onn', data: {text: 'bad', package: 'arbitrary'}, requestId: 'invalid-onn'}});
  assert.equal(invalid.isError, true); assert.equal(device.effects, 11);
  const marker = 'SYNTHETIC_PRIVATE_1039';
  for (const module of ['core', 'onn']) for (const suffix of ['', '-wal']) {
    assert.equal(readFileSync(join(privateState, 'modules', module + '.sqlite' + suffix)).includes(Buffer.from(marker)), false);
  }
  assert.equal(JSON.stringify(logs).includes(marker), false);
  assert.equal(JSON.stringify(logs).includes(operator.token), false); assert.equal(JSON.stringify(logs).includes(reader.token), false);
});
