import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {modeChildRequestId} from '../src/core/mode-participants.js';
import {ModeDevice} from './fixtures/mode-devices.js';
import {edgeConfig, it, run, stateDir, waitFor} from './support.js';

const operator = {source: 'bunny/parts/operator', token: 'synthetic-695-control', scopes: ['read', 'control'] as const};
const reader = {source: 'bunny/parts/reader', token: 'synthetic-695-read', scopes: ['read'] as const};

it('individual HTTP/MCP selections share persistence, identity, busy admission and restart without replay', async context => {
  let handle: CoreHandle | undefined;
  const makeCore = () => createCoreModule({parts: [{start: value => {handle = value; return Promise.resolve();}}]});
  const nano = new ModeDevice('nanoleaf', 'wall'), pixoo = new ModeDevice('pixoo', 'pixoo-1');
  const files = await edgeConfig(context, [operator, reader], {mcp: true, modules: {nanoleaf: {}, pixoo: {}}});
  const dir = await stateDir(context);
  const first = await run(context, {modules: [makeCore(), nano.module(), pixoo.module()], configFile: files.config, stateDir: dir, edge: {schemas: {}}});
  let url = first.runtime.url;
  const read = async (): Promise<ModeState> => {
    const response = await fetch(new URL('/api/v2/families/mode', url), {headers: {authorization: `Bearer ${reader.token}`}});
    assert.equal(response.status, 200);
    const record = (await response.json() as {records: ModeState[]}).records[0]; assert.ok(record); return record;
  };
  const submit = async (target: string, mode: string, requestId: string, expectedRevision?: number, token: string = operator.token) => {
    const response = await fetch(new URL('/api/v2/commands/mode-override-set', url), {method: 'POST',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({target, requestId, data: {mode, ...(expectedRevision === undefined ? {} : {expectedRevision})}})});
    return await response.json() as {status?: string; error?: {code: string}};
  };
  const settled = async (parent: string, targets: string[]) => {
    const ids = await Promise.all(targets.map(target => modeChildRequestId(parent, target)));
    await waitFor(() => ids.every(id => handle?.operation(id)?.result !== undefined), 5000, 'independent native outcomes');
  };
  const client = new Client({name: 'mode-override-test', version: '1.0.0'});
  context.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', url), {requestInit: {headers: {authorization: `Bearer ${operator.token}`}}}) as Transport);
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'core_set_device_mode'));
  assert.equal((await client.callTool({name: 'core_set_mode', arguments: {mode: 'work', requestId: 'global-work', expectedRevision: (await read()).revision}})).isError, false);
  await settled('global-work', ['wall', 'pixoo-1']);
  const before = await read();
  assert.equal((await submit('wall', 'free', 'read-only', before.revision, reader.token)).error?.code, 'forbidden');
  assert.equal((await submit('wall', 'monitor', 'invalid', before.revision)).error?.code, 'invalid-request');
  assert.equal((await submit('missing', 'free', 'missing', before.revision)).error?.code, 'unavailable');
  assert.equal((await submit('wall', 'free', 'stale', 0)).error?.code, 'revision-conflict');
  assert.deepEqual(await read(), before); assert.equal(nano.commands.length, 1); assert.equal(pixoo.commands.length, 1);
  nano.result = 'failed';
  const request = ['wall', 'free', 'individual-free', before.revision] as const;
  assert.equal((await submit(...request)).status, 'accepted');
  await settled('individual-free', ['wall']);
  const saved = await read(); assert.equal(saved.mode, 'work'); assert.equal(saved.overrides?.[0]?.mode, 'free');
  assert.equal(nano.commands.length, 2); assert.equal(pixoo.commands.length, 1);
  assert.equal((await submit(...request)).status, 'accepted'); assert.deepEqual(await read(), saved);
  assert.equal((await submit('wall', 'quiet', 'individual-free', before.revision)).error?.code, 'duplicate-conflict');
  pixoo.result = 'none';
  assert.equal((await client.callTool({name: 'core_set_device_mode', arguments: {target: 'pixoo-1', mode: 'quiet', requestId: 'pixoo-quiet', expectedRevision: saved.revision}})).isError, false);
  const pixooId = await modeChildRequestId('pixoo-quiet', 'pixoo-1');
  await waitFor(() => handle?.operation(pixooId)?.status === 'accepted');
  const pending = await read();
  assert.equal((await submit('wall', 'quiet', 'overlap', pending.revision)).error?.code, 'capacity');
  assert.deepEqual(await read(), pending);
  await pixoo.finish('succeeded'); await settled('pixoo-quiet', ['pixoo-1']);
  nano.result = 'succeeded';
  assert.equal((await submit('wall', 'work', 'clear-wall', pending.revision)).status, 'accepted');
  await settled('clear-wall', ['wall']);
  assert.deepEqual((await read()).overrides?.map(choice => choice.target), ['pixoo-1']);
  // A late contradictory older device outcome changes evidence, never the saved newer choice.
  const current = await read(); await pixoo.finish('failed');
  await waitFor(() => handle?.operation(pixooId)?.status === 'conflict'); assert.deepEqual(await read(), current);
  await client.close(); await first.runtime.stop();
  const count = Number(nano.commands.length) + Number(pixoo.commands.length);
  const second = await run(context, {modules: [makeCore(), nano.module(), pixoo.module()], configFile: files.config, stateDir: dir, edge: {schemas: {}}});
  url = second.runtime.url;
  assert.deepEqual(await read(), current); assert.equal(Number(nano.commands.length) + Number(pixoo.commands.length), count);
  pixoo.result = 'succeeded';
  const reset = await fetch(new URL('/api/v2/commands/mode-set', url), {method: 'POST', headers: {authorization: `Bearer ${operator.token}`, 'content-type': 'application/json'},
    body: JSON.stringify({target: 'hub', requestId: 'reset-work', data: {mode: 'work', expectedRevision: current.revision}})});
  assert.equal(reset.status, 200); await settled('reset-work', ['wall', 'pixoo-1']);
  assert.deepEqual((await read()).overrides, []);
  const operations = await fetch(new URL('/api/v2/families/operation', url), {headers: {authorization: `Bearer ${reader.token}`}});
  const records = (await operations.json() as {records: OperationRecord[]}).records;
  assert.ok(records.some(record => record.family === 'mode-override-set' && record.kind === 'mode'));
});
