// Operator admission through real HTTP/MCP and the socket SDK edge, on synthetic port-0 runtimes.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import type {TestContext} from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {connectRemote} from '@jimmie-potts/sdk';
import {CREDENTIALS_SCHEMA, createCoreModule, type CoreHandle} from '../src/index.js';
import {SESSION_ID, observation, sessionStarted} from './fixtures/agents.js';
import {contextOf, edgeConfig, fixture, it, run} from './support.js';

const operator = {id: 'operator', source: 'bunny/parts/operator', token: 'synthetic-label-control', scopes: ['read', 'control'] as const};
const reader = {id: 'reader', source: 'bunny/parts/reader', token: 'synthetic-label-read', scopes: ['read'] as const};
const ingest = {id: 'ingest', source: 'bunny/parts/ingest', token: 'synthetic-label-ingest', scopes: ['ingest'] as const};
const path = '/api/v2/commands/session-label-set';
const action = (label: string | null, expectedRevision: number, requestId: string): object => ({target: SESSION_ID, data: {label, expectedRevision}, requestId});

async function gateway(context: TestContext) {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: current => { handle = current; return Promise.resolve(); }}]});
  const hook = fixture('hook');
  const files = await edgeConfig(context, [operator, reader, ingest], {mcp: true});
  const {runtime} = await run(context, {modules: [core, hook], configFile: files.config, edge: {schemas: {}}});
  const sdk = contextOf(hook).sdk;
  const event = observation(sessionStarted, Date.now());
  await sdk.publish(event.key, event.draft);
  const record = async (): Promise<SessionRecord> => {
    const synced = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
    assert.equal(synced.status, 'synced');
    const held = synced.copy.states().find(state => state.subject === SESSION_ID)?.data;
    await synced.copy.close();
    assert.ok(held);
    return held;
  };
  await record();
  assert.ok(handle);
  const call = async (route: string, token: string, body: object, headers: Record<string, string> = {}) => {
    const response = await fetch(new URL(route, runtime.url), {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
    const text = await response.text();
    return {status: response.status, headers: response.headers, body: text === '' ? {} : JSON.parse(text) as Record<string, unknown>};
  };
  return {runtime, files, handle, record, call};
}

it('HTTP admits an attributed control label and refuses read/ingest grants and JSON authority claims', async context => {
  const world = await gateway(context), before = await world.record();
  for (const caller of [reader, ingest]) {
    const refused = await world.call(path, caller.token, action('Denied', before.revision, `req-${caller.id}`));
    assert.equal(refused.status, 403);
    assert.equal((refused.body.error as {code: string}).code, 'forbidden');
    assert.equal(world.handle.operation(`req-${caller.id}`), undefined);
  }
  for (const claim of [{operator: true}, {scopes: ['control']}, {requestedBy: 'bunny/core'}]) {
    const refused = await world.call(path, operator.token, {...action('Claimed', before.revision, 'req-claim'), ...claim});
    assert.equal(refused.status, 400);
    assert.equal(world.handle.operation('req-claim'), undefined);
  }
  const accepted = await world.call(path, operator.token, action('HTTP label', before.revision, 'req-http'));
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, {schema: 'command-reply/2.0', status: 'accepted', requestId: 'req-http'});
  assert.equal((await world.record()).label?.value, 'HTTP label');
  assert.equal(world.handle.operation('req-http')?.requestedBy, operator.source);
  assert.equal(world.handle.operation('req-http')?.status, 'completed');
});

it('a control credential cannot send labels directly through the socket SDK edge', async context => {
  const world = await gateway(context), before = await world.record();
  const remote = await connectRemote({url: world.runtime.url, source: operator.source, token: operator.token});
  context.after(() => remote.close());
  const answer = await remote.request(`bunny.cmd.session-label-set.${SESSION_ID}`, {
    type: 'org.bunny.session-label.set.requested', subject: SESSION_ID, dataschema: 'https://bunny.invalid/events/session-label-set/2.0',
    data: {label: 'Raw SDK', expectedRevision: before.revision},
  }, {requestId: 'req-raw', timeoutMs: 5000});
  assert.equal(answer.status, 'rejected');
  assert.equal(answer.error.error.code, 'forbidden');
  assert.equal(world.handle.operation('req-raw'), undefined);
  assert.deepEqual(await world.record(), before);
});

it('MCP routes a control label through the tracker and revocation ends later HTTP/MCP admission', async context => {
  const world = await gateway(context), before = await world.record();
  const accept = {accept: 'application/json, text/event-stream'};
  const init = await world.call('/mcp', operator.token, {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'synthetic-label', version: '1.0.0'},
  }}, accept);
  assert.equal(init.status, 200);
  const headers = {...accept, 'mcp-session-id': init.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-11-25'};
  await world.call('/mcp', operator.token, {jsonrpc: '2.0', method: 'notifications/initialized'}, headers);
  const answered = await world.call('/mcp', operator.token, {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'core_send_command', arguments: {family: 'session-label-set', ...action('MCP label', before.revision, 'req-mcp')},
  }}, headers);
  assert.equal(answered.status, 200);
  assert.equal((answered.body.result as {isError?: boolean}).isError, false);
  assert.equal((await world.record()).label?.value, 'MCP label');
  assert.equal(world.handle.operation('req-mcp')?.requestedBy, operator.source);
  assert.equal(world.handle.operation('req-mcp')?.status, 'completed');
  await writeFile(world.files.credentials, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: []}), {mode: 0o600});
  await world.runtime.reload();
  assert.equal((await world.call(path, operator.token, action('Revoked', (await world.record()).revision, 'req-revoked'))).status, 401);
  assert.equal((await world.call('/mcp', operator.token, {jsonrpc: '2.0', id: 3, method: 'tools/list'}, headers)).status, 401);
  assert.equal(world.handle.operation('req-revoked'), undefined);
});
