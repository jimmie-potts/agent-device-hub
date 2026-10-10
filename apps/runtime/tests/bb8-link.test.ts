import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, writeFile} from 'node:fs/promises';
import {connectRemote, SdkError} from '@jimmie-potts/sdk';
import {createBb8Module, bb8Schemas, type RobotState} from '@jimmie-potts/bb8';
import {HELPER_SOURCE} from '@jimmie-potts/bb8/link';
import {HelperOwner} from '@jimmie-potts/bb8-windows';
import {FakeGatt, scheduler} from '@jimmie-potts/bb8-windows/testing';
import {createCoreModule} from '../src/index.js';
import {tokenDigest} from '../src/index.js';
import {edgeConfig, it, run, stateDir, waitFor} from './support.js';
it('authenticated gateway routes BB-8 LED to its Windows writer while the helper and ordinary credentials retain narrow grants', async t => {
  const token = 'tok_SYNTHETICBB8_helper', readerToken = 'tok_SYNTHETICBB8_reader', operatorToken = 'tok_SYNTHETICBB8_operator';
  const credentials = {schema: 'edge-credentials/1.0', credentials: [
    {id: 'bb8-helper', source: HELPER_SOURCE, digest: tokenDigest(token), scopes: [], role: 'bb8-link', robotId: 'bb8'},
    {id: 'reader', source: 'bunny/parts/reader', digest: tokenDigest(readerToken), scopes: ['read']},
    {id: 'operator', source: 'bunny/parts/operator', digest: tokenDigest(operatorToken), scopes: ['read', 'control']},
  ]};
  const files = await edgeConfig(t, [], {modules: {bb8: {id: 'bb8', configurationRevision: 0}}, credentials: JSON.stringify(credentials), mcp: true});
  const {runtime, logs} = await run(t, {modules: [createCoreModule(), createBb8Module()], stateDir: await stateDir(t), configFile: files.config, edge: {schemas: bb8Schemas}});
  const sdk = await connectRemote({url: runtime.url, source: HELPER_SOURCE, token});
  const reader = await connectRemote({url: runtime.url, source: 'bunny/parts/reader', token: readerToken});
  const db = new DatabaseSync(':memory:'), gatt = new FakeGatt(); let opens = 0;
  const errors: unknown[] = [];
  const helper = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => ({open: () => {opens++; return Promise.resolve(gatt);}}), onError: error => {errors.push(error);}});
  t.after(async () => {await helper.stop(); await reader.close(); await sdk.close(); db.close();});
  await helper.start(); assert.equal(opens, 0);
  await assert.rejects(() => sdk.sync(['session'], () => {}, {timeoutMs: 1000}), e => e instanceof SdkError && e.body.error.code === 'forbidden');
  await assert.rejects(() => reader.respond('bunny.cmd.bb8-link-execute.bb8', () => ({status: 'accepted'})), e => e instanceof SdkError && e.body.error.code === 'forbidden');
  const copy = await reader.sync<RobotState>(['bb8-robot'], () => {}, {owner: 'bunny/modules/bb8', timeoutMs: 5000});
  assert.equal(copy.status, 'synced'); if (copy.status !== 'synced') throw Error('missing robot');
  t.after(() => copy.copy.close());
  const state = () => copy.copy.states()[0]?.data;
  await waitFor(() => state()?.linkLive === true, 5000, 'live helper');
  const send = async (family: string, extra: object = {}, auth = operatorToken, target = 'bb8') => {
    const robot = state(); assert.ok(robot?.link.status === 'known');
    const result = await fetch(`${runtime.url}/api/v2/commands/${family}`, {method: 'POST', headers: {authorization: `Bearer ${auth}`, 'content-type': 'application/json'}, body: JSON.stringify({target, requestId: crypto.randomUUID(), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: robot.link.value.helperEpoch, expectedConnectionGeneration: robot.link.value.connectionGeneration, ...extra}})});
    await result.arrayBuffer(); return result.status;
  };
  assert.equal(await send('bb8-connect', {}, 'invalid'), 401);
  assert.equal(await send('bb8-connect', {}, readerToken), 403);
  assert.equal(await send('bb8-link-execute'), 403);
  assert.notEqual(await send('bb8-connect', {}, operatorToken, 'other'), 200);
  assert.equal(opens, 0);
  const headers: Record<string, string> = {authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream'};
  const rpc = async (body: object) => fetch(`${runtime.url}/mcp`, {method: 'POST', headers, body: JSON.stringify(body)});
  const init = await rpc({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'bb8-source-test', version: '1.0.0'}}});
  headers['mcp-session-id'] = init.headers.get('mcp-session-id') ?? ''; headers['mcp-protocol-version'] = '2025-11-25';
  await init.arrayBuffer(); await (await rpc({jsonrpc: '2.0', method: 'notifications/initialized'})).arrayBuffer();
  const denied = await (await rpc({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'core_send_command', arguments: {family: 'bb8-connect', target: 'bb8', data: {}}}})).json() as {result: {isError: boolean; structuredContent: {data: {error: {code: string}}}}};
  assert.equal(denied.result.isError, true); assert.equal(denied.result.structuredContent.data.error.code, 'unsupported-capability'); assert.equal(opens, 0);
  await (await fetch(`${runtime.url}/mcp`, {method: 'DELETE', headers})).arrayBuffer();
  assert.equal(await send('bb8-connect'), 200);
  await waitFor(() => (() => {const link = state()?.link; return link?.status === 'known' && link.value.connection === 'connected' && link.value.connectionGeneration === helper.state.connectionGeneration;})(), 5000, 'connect');
  await waitFor(() => state()?.lastResult.status === 'known', 5000, 'connect completion');
  assert.equal(await send('bb8-led-set', {led: {target: 'main', rgb: [10, 20, 30]}}), 200, JSON.stringify({logs, errors, helper: helper.state, robot: state()}));
  await helper.drain();
  await waitFor(() => gatt.writes.length === 5 && helper.results.length === 0, 5000, 'LED persisted and helper receipt retired');
  assert.deepEqual(gatt.writes.at(-1)?.bytes.slice(2, -1), [2, 32, 2, 4, 10, 20, 30]);
  assert.equal(opens, 1); assert.deepEqual(errors, []);
  const bytes = gatt.writes.length;
  const changed = JSON.parse(await readFile(files.credentials, 'utf8')) as typeof credentials;
  changed.credentials = changed.credentials.filter(item => item.id !== 'bb8-helper');
  await writeFile(files.credentials, JSON.stringify(changed), {mode: 0o600});
  // Credential reload revokes the active writer's edge stream; it cannot restore its resources.
  await runtime.reload();
  await assert.rejects(() => sdk.respond('bunny.cmd.bb8-link-execute.bb8', () => ({status: 'accepted'})), e => e instanceof SdkError);
  assert.equal(gatt.writes.length, bytes);
  assert.equal(JSON.stringify(logs).includes(token), false);
});
