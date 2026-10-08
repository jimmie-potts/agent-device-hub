// Operator admission through real HTTP/MCP and the socket SDK edge, on synthetic port-0 runtimes.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/index.js';
import {SESSION_ID, observation, sessionStarted} from './fixtures/agents.js';
import {contextOf, edgeConfig, fixture, it, run} from './support.js';

const operator = {id: 'operator', source: 'bunny/parts/operator', token: 'synthetic-notice-control', scopes: ['read', 'control'] as const};
const reader = {id: 'reader', source: 'bunny/parts/reader', token: 'synthetic-notice-read', scopes: ['read'] as const};
const ingest = {id: 'ingest', source: 'bunny/parts/ingest', token: 'synthetic-notice-ingest', scopes: ['ingest'] as const};
const path = '/api/v2/commands/notice-clear';
const action = (noticeId: string | null, expectedRevision: number, requestId: string): object => ({target: SESSION_ID, data: {noticeId, expectedRevision}, requestId});

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

it('only an authenticated control grant admits an attributed notice override through HTTP', async context => {
  const world = await gateway(context), before = await world.record();
  for (const caller of [reader, ingest]) {
    const refused = await world.call(path, caller.token, action(null, before.revision, `req-${caller.id}`));
    assert.equal(refused.status, 403); assert.equal((refused.body.error as {code: string}).code, 'forbidden');
    assert.equal(world.handle.operation(`req-${caller.id}`), undefined);
  }
  const accepted = await world.call(path, operator.token, action(null, before.revision, 'req-http'));
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, {schema: 'command-reply/2.0', status: 'accepted', requestId: 'req-http'});
  assert.deepEqual(await world.record(), before);
  assert.equal(world.handle.operation('req-http')?.requestedBy, operator.source);
  assert.equal(world.handle.operation('req-http')?.status, 'completed');
});
