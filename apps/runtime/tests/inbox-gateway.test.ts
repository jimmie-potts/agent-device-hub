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


it('authenticated HTTP inbox handling continues its trace through removal and explicit resend', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const gadget = new Gadget(), files = await edgeConfig(context, [operator]);
  const lines: string[] = [];
  const {runtime} = await run(context, {modules: [core, gadget.module()], configFile: files.config, edge: {schemas: gadgetSchemas}, spans: line => { lines.push(line); }});
  assert.ok(handle);
  const removals: {subject: string; traceparent: string}[] = [];
  const subscription = await handle.sdk.subscribe('bunny.state.inbox-item.*', message => {
    if (message.kind === 'removal') removals.push(message);
  });
  context.after(() => subscription.close());
  const items = async () => {
    const response = await fetch(new URL('/api/v2/families/inbox-item', runtime.url), {headers: {authorization: `Bearer ${operator.token}`}});
    return (await response.json() as {records: {id: string; revision: number}[]}).records;
  };
  for (const [index, action] of ['dismiss', 'send-again'].entries()) {
    gadget.script({reply: 'unavailable'});
    await core.actions.dispatch({...setGadget(42), requestedBy: operator.source, requestId: `trace-original-${index}`});
    await waitFor(async () => (await items()).length === 1);
    const item = (await items())[0]; assert.ok(item);
    const traceId = index === 0 ? '0af7651916cd43dd8448eb211c80319c' : '11111111111111111111111111111111';
    const parentSpanId = 'b7ad6b7169203331';
    const response = await fetch(new URL('/api/v2/commands/inbox-handle', runtime.url), {
      method: 'POST', headers: {authorization: `Bearer ${operator.token}`, 'content-type': 'application/json', traceparent: `00-${traceId}-${parentSpanId}-01`},
      body: JSON.stringify({target: item.id, requestId: `trace-handle-${index}`, data: {action, expectedRevision: item.revision}}),
    });
    assert.equal(response.status, 200); await response.json();
    await waitFor(() => removals.some(message => message.subject === item.id));
    assert.equal(removals.find(message => message.subject === item.id)?.traceparent.slice(3, 35), traceId, 'shared removal continues the authenticated HTTP trace');
    if (action === 'send-again') {
      await waitFor(() => gadget.commands.length === 3);
      const resent = gadget.commands[2]; assert.ok(resent);
      assert.equal(resent.traceparent.slice(3, 35), traceId, 'fresh device command remains in the handling trace');
      assert.equal(handle.operation(resent.data.requestId)?.traceparent.slice(3, 35), traceId, 'new tracked operation retains that context');
    }
  }
  await runtime.stop();
  for (const traceId of ['0af7651916cd43dd8448eb211c80319c', '11111111111111111111111111111111']) {
    const spans = lines.flatMap(line => (JSON.parse(line) as {resourceSpans: {scopeSpans: {spans: {name: string; traceId: string; spanId: string; parentSpanId?: string; kind: number}[]}[]}[]}).resourceSpans.flatMap(group => group.scopeSpans.flatMap(scope => scope.spans)));
    const server = spans.find(span => span.traceId === traceId && span.kind === 2 && span.name === 'bunny.command.request' && span.parentSpanId === 'b7ad6b7169203331');
    assert.ok(server, 'the authenticated handling HTTP server span is recorded');
    assert.equal(server.parentSpanId, 'b7ad6b7169203331');
    assert.ok(spans.some(span => span.traceId === traceId && span.kind === 3 && span.name === 'bunny.command.request' && span.parentSpanId === server.spanId), 'the SDK request is a child of the HTTP server span');
  }
});
