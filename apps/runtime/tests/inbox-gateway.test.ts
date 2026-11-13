import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {Redactions} from '../src/log.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {Gadget, gadgetSchemas, setGadget} from './fixtures/gadget.js';
import {contextOf, edgeConfig, fixture, flush, it, manualClock, run, waitFor} from './support.js';
const operator = {source: 'bunny/parts/operator', token: 'synthetic-inbox-control', scopes: ['read', 'control'] as const};
const reader = {source: 'bunny/parts/reader', token: 'synthetic-inbox-read', scopes: ['read'] as const};
const ingest = {source: 'bunny/parts/ingest', token: 'synthetic-inbox-ingest', scopes: ['ingest'] as const};

it('gateway and MCP readers see the whole inbox/history; handling needs control and records its actor', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const gadget = new Gadget(), files = await edgeConfig(context, [operator, reader, ingest], {mcp: true});
  const publisher = fixture('synthetic-history-device');
  const clock = manualClock(1_800_000_000_000), redactions = new Redactions();
  let historyAnswer: object | undefined;
  const tools = core.manifest.tools?.map(tool => tool.name === 'history' ? {...tool, read: (args: Parameters<typeof tool.read>[0]) => historyAnswer ?? tool.read(args)} : tool) ?? [];
  const coreWithFixture = {...core, manifest: {...core.manifest, tools}};
  const genericReader: BunnyModule = {...fixture('synthetic-history-reader'), manifest: {name: 'synthetic-history-reader', apiVersion: '1.2', tools: [{
    name: 'history', description: 'Read a synthetic fixture.', input: {type: 'object', additionalProperties: false},
    output: {type: 'object'}, read: () => ({open: []}),
  }]}};
  const {runtime} = await run(context, {modules: [coreWithFixture, gadget.module(), publisher, genericReader],
    configFile: files.config, edge: {schemas: gadgetSchemas}, clock, scheduler: clock.scheduler, redactions});
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
  for (const query of ['?kind=unknown', '?fromAtMs=-1', '?fromAtMs=5&toAtMs=2', '?kind=operation&kind=outcome', '?session=', '?other=value', '?limit=0', '?limit=-1', '?limit=1.5', '?limit=501', '?limit=word', '?limit=', '?limit=1&limit=2'])
    assert.equal((await call(`/api/v2/history${query}`, reader.token)).status, 400, query);
  const history = (await call('/api/v2/history?kind=operation&source=bunny%2Fparts%2Foperator', reader.token)).body.rows as {kind: string; source: string}[];
  assert.equal(history.length, 4); assert.ok(history.every(row => row.kind === 'operation' && row.source === operator.source));
  for (const limit of [1, 200, 500]) {
    const bounded = await call(`/api/v2/history?kind=operation&source=bunny%2Fparts%2Foperator&limit=${limit}`, reader.token);
    assert.equal(bounded.status, 200);
    assert.deepEqual(bounded.body.rows, history.slice(-limit));
  }
  assert.equal((await call('/api/v2/history?limit=1', ingest.token)).status, 403);
  assert.equal((await call('/api/v2/history?limit=1', 'unknown')).status, 401);
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
  const operationPage = (await tool('core_history', {kind: 'operation'})).structuredContent.data.result;
  assert.deepEqual(operationPage, {rows: history});

  const {sdk} = contextOf(publisher);
  const device = deviceRecord('synthetic-lamp', 1, 'wemo', 'available');
  const filter = {kind: 'change', source: sdk.source, limit: 1};
  const historyPath = `/api/v2/history?${new URLSearchParams({...filter, limit: String(filter.limit)})}`;
  const openingAt = clock.now();
  await sdk.publish('bunny.state.device.synthetic-lamp', {kind: 'state', ...deviceState(device)});
  await flush();
  await flush();
  const opening = await call(historyPath, reader.token);
  assert.deepEqual(Object.keys(opening.body), ['schema', 'rows']);
  assert.ok(Array.isArray(opening.body.rows));
  assert.equal(opening.body.rows.length, 1, 'the opening row commits before the clock advances');
  clock.advance(5000);
  await sdk.publish('bunny.state.device.synthetic-lamp', {kind: 'state', ...deviceState({...device, revision: 2})});
  await flush();
  await flush();
  const http = await call(historyPath, reader.token);
  assert.equal(http.status, 200);
  assert.ok(Array.isArray(http.body.rows));
  assert.equal(http.body.rows.length, 1);
  assert.deepEqual(http.body.open, [{source: sdk.source, family: 'device', id: device.id, revision: 1,
    sinceAtMs: openingAt, lastConfirmedAtMs: clock.now(), confirmations: 2}]);
  const mcp = await tool('core_history', filter);
  assert.equal(mcp.isError, false);
  assert.deepEqual(mcp.structuredContent.data.result, {rows: http.body.rows, open: http.body.open});
  const listed = (await call('/mcp', operator.token, {jsonrpc: '2.0', id: 3, method: 'tools/list'}, mcpHeaders)).body.result as
    {tools: {name: string; inputSchema: {properties: Record<string, unknown>}; outputSchema?: {additionalProperties?: unknown; properties?: Record<string, unknown>}}[]};
  assert.deepEqual(listed.tools.find(item => item.name === 'core_history')?.inputSchema.properties.limit, {type: 'integer', minimum: 1, maximum: 500});
  // The MCP package embeds the gateway's closed `{result}|{error}` schema as `data`.
  const published = listed.tools.find(item => item.name === 'core_history')?.outputSchema?.properties?.data as {additionalProperties?: unknown; properties?: Record<string, unknown>} | undefined;
  assert.equal(published?.additionalProperties, false);
  assert.deepEqual(published?.properties?.result, {type: 'object', additionalProperties: false, required: ['rows'], properties: {rows: {type: 'array'}, open: {type: 'array'}}, $id: 'urn:bunny:tool:core:history:output'});
  for (const limit of [1, 200, 500]) assert.deepEqual((await tool('core_history', {kind: 'operation', source: operator.source, limit})).structuredContent.data.result.rows, history.slice(-limit));
  for (const limit of [0, -1, 1.5, 501, '200', null, true]) {
    const refused = await tool('core_history', {limit});
    assert.equal(refused.isError, true, String(limit));
    assert.match(JSON.stringify(refused), /invalid-request/);
  }
  assert.equal(gadget.commands.length, 2, 'bounded HTTP and MCP reads issue no device command');
  assert.equal((await tool('core_handle_inbox', {id: item.id, expectedRevision: item.revision, action: 'dismiss'})).isError, false);
  await waitFor(async () => (await items()).length === 1);
  assert.equal((await call('/api/v2/commands/inbox-handle', operator.token, action)).status, 409);
  assert.ok(handle);
  assert.equal((await tool('core_inbox', {})).structuredContent.data.result.items?.length, 1, 'MCP observes shared handling');

  const internal = async (name: string, args: object, detail: string) => {
    const refused = await tool(name, args);
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused.structuredContent), /"code":"internal"/);
    assert.match(JSON.stringify(refused.structuredContent), new RegExp(detail));
  };
  redactions.add('open');
  const cleanHttp = await call(historyPath, reader.token);
  assert.equal(cleanHttp.status, 200);
  assert.deepEqual(cleanHttp.body, http.body);
  const cleanMcp = await tool('core_history', filter);
  assert.equal(cleanMcp.isError, false, 'the new fixed result key cannot cause a clean history page to be refused');
  assert.deepEqual(cleanMcp.structuredContent.data.result, {rows: http.body.rows, open: http.body.open});
  assert.deepEqual((await tool('core_history', {kind: 'operation'})).structuredContent.data.result, {rows: (await call('/api/v2/history?kind=operation', reader.token)).body.rows});
  await internal('synthetic-history-reader_history', {}, 'holds a secret');

  historyAnswer = {rows: [], open: undefined};
  const nonJson = await tool('core_history', filter);
  assert.equal(nonJson.isError, true);
  assert.deepEqual(nonJson.structuredContent, {kind: 'gateway-error', code: 'transport-failure', priorEffects: 'none', retry: 'never-automatically'},
    'an explicit undefined value remains a non-JSON result and is refused by MCP');
  historyAnswer = {rows: [], open: 'malformed'};
  await internal('core_history', filter, 'holds a secret');
  historyAnswer = errorBody('unavailable', {detail: 'synthetic open refusal'});
  await internal('core_history', filter, 'holds a secret');
  historyAnswer = undefined;

  const spanSecret = String(clock.now());
  assert.ok(!JSON.stringify(http.body.rows).includes(spanSecret));
  redactions.add(spanSecret);
  await internal('core_history', filter, 'holds a secret');
  assert.equal((await call(historyPath, reader.token)).status, 500);
  redactions.add('rows');
  await internal('core_history', {kind: 'operation'}, 'holds a secret');

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

it('HTTP send-again accepts committed handling when the fresh device command refuses', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => { handle = given; return Promise.resolve(); }}]});
  const gadget = new Gadget(), files = await edgeConfig(context, [operator]);
  const {runtime} = await run(context, {modules: [core, gadget.module()], configFile: files.config, edge: {schemas: gadgetSchemas}});
  assert.ok(handle);
  const items = async () => {
    const response = await fetch(new URL('/api/v2/families/inbox-item', runtime.url), {headers: {authorization: `Bearer ${operator.token}`}});
    return (await response.json() as {records: {id: string; revision: number; item: {requestId: string; result: string}}[]}).records;
  };
  gadget.script({reply: 'unavailable'}, {reply: 'unavailable'});
  await core.actions.dispatch({...setGadget(37), requestedBy: operator.source, requestId: 'refused-original'});
  await waitFor(async () => (await items()).length === 1);
  const original = (await items())[0]; assert.ok(original);
  const response = await fetch(new URL('/api/v2/commands/inbox-handle', runtime.url), {
    method: 'POST', headers: {authorization: `Bearer ${operator.token}`, 'content-type': 'application/json'},
    body: JSON.stringify({target: original.id, requestId: 'refused-resend-handle', data: {action: 'send-again', expectedRevision: original.revision}}),
  });
  assert.equal(response.status, 200, 'handling committed even though the new device command refused');
  assert.equal((await response.json() as {status: string}).status, 'accepted');
  assert.equal(gadget.commands.length, 2, 'only one explicit new command was sent');
  const resent = gadget.commands[1]; assert.ok(resent);
  assert.notEqual(resent.data.requestId, 'refused-original');
  assert.equal(resent.data.level, 37, 'resend keeps the saved command data');
  assert.equal(handle.operation(resent.data.requestId)?.result, 'failed', 'device refusal stays on the fresh operation');
  assert.equal(handle.operation(resent.data.requestId)?.error?.code, 'unavailable');
  await waitFor(async () => (await items()).some(item => item.item.requestId === resent.data.requestId));
  const current = await items();
  assert.equal(current.length, 1);
  assert.equal(current[0]?.item.result, 'failed');
  assert.ok(current.every(item => item.id !== original.id), 'the handled original is removed');
});
