import assert from 'node:assert/strict';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {Gadget, gadgetSchemas, setGadget} from './fixtures/gadget.js';
import {edgeConfig, it, run, waitFor} from './support.js';
const operator = {source: 'bunny/parts/operator', token: 'synthetic-inbox-control', scopes: ['read', 'control'] as const};
const reader = {source: 'bunny/parts/reader', token: 'synthetic-inbox-read', scopes: ['read'] as const};
const ingest = {source: 'bunny/parts/ingest', token: 'synthetic-inbox-ingest', scopes: ['ingest'] as const};

it('gateway and MCP readers see the whole inbox/history; handling needs control and records its actor', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const gadget = new Gadget(), files = await edgeConfig(context, [operator, reader, ingest], {mcp: true});
  const {runtime} = await run(context, {modules: [core, gadget.module()], configFile: files.config, edge: {schemas: gadgetSchemas}});
  const call = async (path: string, token: string, body?: object, headers: Record<string, string> = {}) => {
    const response = await fetch(new URL(path, runtime.url), {method: body === undefined ? 'GET' : 'POST',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const text = await response.text(); return {status: response.status, headers: response.headers, body: text === '' ? {} : JSON.parse(text) as Record<string, unknown>};
  };
  gadget.script({reply: 'unavailable'}, {reply: 'expired'});
  for (const id of ['first', 'second']) await core.actions.dispatch({...setGadget(21, id), requestedBy: operator.source, requestId: id});
  const items = async () => ((await call('/api/v2/families/inbox-item', reader.token)).body.records as {id: string; revision: number}[]);
  assert.equal((await items()).length, 2);
  assert.equal((await call('/api/v2/history', ingest.token)).status, 403);
  assert.equal((await call('/api/v2/history', 'unknown')).status, 401);
  for (const query of ['?kind=unknown', '?fromAtMs=-1', '?fromAtMs=5&toAtMs=2', '?kind=operation&kind=outcome', '?session=', '?other=value'])
    assert.equal((await call(`/api/v2/history${query}`, reader.token)).status, 400, query);
  const history = (await call('/api/v2/history?kind=operation&source=bunny%2Fparts%2Foperator', reader.token)).body.rows as {kind: string; source: string}[];
  assert.equal(history.length, 4); assert.ok(history.every(row => row.kind === 'operation' && row.source === operator.source));
  assert.equal(gadget.commands.length, 2, 'reads issue no device command');
  const item = (await items())[0]; assert.ok(item);
  const action = {target: item.id, data: {action: 'dismiss', expectedRevision: item.revision}, requestId: 'http-handle'};
  assert.equal((await call('/api/v2/commands/inbox-handle', reader.token, action)).status, 403);
  assert.equal((await call('/api/v2/commands/inbox-handle', operator.token, {...action, data: {...action.data, actor: 'forged'}})).status, 400);
  const accept = {accept: 'application/json, text/event-stream'};
  const init = await call('/mcp', operator.token, {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'inbox-test', version: '1.0.0'},
  }}, accept);
  assert.equal(init.status, 200);
  const mcpHeaders = {...accept, 'mcp-session-id': init.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-11-25'};
  await call('/mcp', operator.token, {jsonrpc: '2.0', method: 'notifications/initialized'}, mcpHeaders);
  const tool = async (name: string, args: object) => (await call('/mcp', operator.token, {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name, arguments: args}}, mcpHeaders)).body.result as {isError: boolean; structuredContent: {data: {result: {items?: unknown[]; rows?: unknown[]}}}};
  assert.equal((await tool('core_inbox', {})).structuredContent.data.result.items?.length, 2);
  assert.equal((await tool('core_history', {kind: 'operation'})).structuredContent.data.result.rows?.length, 4);
  assert.equal((await tool('core_handle_inbox', {id: item.id, expectedRevision: item.revision, action: 'dismiss'})).isError, false);
  await waitFor(async () => (await items()).length === 1);
  assert.equal((await call('/api/v2/commands/inbox-handle', operator.token, action)).status, 409);
  assert.ok(handle);
  assert.equal((await tool('core_inbox', {})).structuredContent.data.result.items?.length, 1, 'MCP observes shared handling');
});
