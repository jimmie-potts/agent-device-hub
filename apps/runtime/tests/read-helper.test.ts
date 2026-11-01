import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chmod, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {prepareMessage, publishOnce} from '@jimmie-potts/sdk';
import {READ_RECEIPT_SCHEMA} from '@jimmie-potts/event-contracts/v2/read-receipts';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule} from '../src/core/core.js';
import {producerSource, runHook} from '../src/hook/index.js';
import {runReadHelper, type ReadHelperResult} from '../src/read-receipts/helper.js';
import {CLAUDE_RECEIPT_FEED, CLAUDE_TERMINAL_VERSION, receiptSource} from '../src/read-receipts/qualification.js';
import {edgeConfig, it, run, waitFor} from './support.js';

const FEED = {provider: 'claude', client: 'code', hostId: 'test-host', sourceId: 'test-hooks'} as const;
const BIND = {action: 'bind', version: CLAUDE_TERMINAL_VERSION, surface: 'terminal', sessionId: 'test-session', promptId: 'prompt-a'};
const SCRIPT = fileURLToPath(new URL('../../bin/claude-read.mjs', import.meta.url));
const readInput = (target: object) => ({action: 'read', version: CLAUDE_TERMINAL_VERSION, surface: 'terminal', target});

async function setup(context: TestContext, scopes: ('read' | 'ingest')[] = ['read', 'ingest']) {
  const token = randomBytes(32).toString('base64url'), hookToken = randomBytes(32).toString('base64url');
  const source = receiptSource(FEED), hookSource = producerSource(FEED);
  const files = await edgeConfig(context, [
    {source, token, scopes}, {source: hookSource, token: hookToken, scopes: ['ingest']},
    {source: 'bunny/parts/test-reader', token: 'test-reader-token', scopes: ['read']},
  ]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const producer = join(files.dir, 'receipt-producer.json'), hook = join(files.dir, 'hook-producer.json');
  const base = {enabled: true, qualified: true, endpoint: `${runtime.url}/api/monitor/v1/events`};
  await writeFile(producer, JSON.stringify({...base, source: {...FEED, feed: CLAUDE_RECEIPT_FEED}, token}), {mode: 0o600});
  await writeFile(hook, JSON.stringify({...base, source: FEED, token: hookToken}), {mode: 0o600});
  const emit = async (name: string, promptId: string) => {
    const before = logs.filter(row => row.event_name === 'message.received').length;
    const result = await runHook({producer: hook, deadline: performance.now() + 2900,
      input: Readable.from([Buffer.from(JSON.stringify({hook_event_name: name, session_id: BIND.sessionId, prompt_id: promptId}))])});
    assert.equal(result.status, 'published', JSON.stringify(result));
    await waitFor(() => logs.filter(row => row.event_name === 'message.received').length > before);
  };
  const records = async () => {
    const response = await fetch(`${runtime.url}/api/v2/families/session`, {headers: {authorization: 'Bearer test-reader-token'}});
    assert.equal(response.status, 200);
    return (await response.json() as {records: SessionRecord[]}).records;
  };
  await emit('UserPromptSubmit', BIND.promptId);
  await emit('Stop', BIND.promptId);
  return {producer, runtime, records, emit, token, source, hookToken, hookSource};
}

it('the helper binds without reading, confirms the owner commit, and refuses a late pane', async context => {
  const world = await setup(context);
  const bound = await runReadHelper(world.producer, BIND);
  assert.equal(bound.status, 'ready');
  assert.ok(bound.status === 'ready');
  assert.equal((await world.records())[0]?.read, 'unknown');
  assert.deepEqual(await runReadHelper(world.producer, readInput(bound.target)), {status: 'confirmed'});
  const read = (await world.records())[0];
  assert.equal(read?.read, 'read');
  assert.equal(read.readReceipt?.source, world.source);
  assert.deepEqual(await runReadHelper(world.producer, readInput(bound.target)), {status: 'confirmed'}, 'a confirmed replay does not publish again');
  assert.equal((await world.records())[0]?.revision, read.revision);
  await world.emit('UserPromptSubmit', 'prompt-b');
  await world.emit('Stop', 'prompt-b');
  assert.equal((await runReadHelper(world.producer, readInput(bound.target))).status, 'unavailable');
  assert.equal((await world.records())[0]?.read, 'unknown');
  assert.equal((await runReadHelper(world.producer, BIND)).status, 'unavailable');
});

it('the delivered executable binds and confirms through the authenticated gateway', async context => {
  const world = await setup(context);
  const invoke = async (input: object): Promise<ReadHelperResult> => {
    const child = spawn(process.execPath, [SCRIPT, world.producer], {stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', errors = '';
    child.stdout.on('data', (data: Buffer) => {output += data.toString();});
    child.stderr.on('data', (data: Buffer) => {errors += data.toString();});
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
    const killer = setTimeout(() => {child.kill('SIGKILL');}, 5000);
    const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
    clearTimeout(killer);
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal(errors, '');
    return JSON.parse(output) as ReadHelperResult;
  };
  const bound = await invoke(BIND);
  assert.equal(bound.status, 'ready');
  assert.ok(bound.status === 'ready');
  assert.equal((await world.records())[0]?.read, 'unknown');
  assert.deepEqual(await invoke(readInput(bound.target)), {status: 'confirmed'});
  assert.equal((await world.records())[0]?.read, 'read');
});

it('the gateway rejects ordinary-hook receipts, a foreign feed and activity from the dedicated receipt credential', async context => {
  const world = await setup(context), bound = await runReadHelper(world.producer, BIND);
  assert.ok(bound.status === 'ready');
  const send = (source: string, token: string, data: Record<string, unknown>, schema = READ_RECEIPT_SCHEMA) => publishOnce({url: world.runtime.url, token, source, timeoutMs: 1000},
    `bunny.event.lifecycle.${bound.target.subject}`, prepareMessage(source, {kind: 'occurrence', type: bound.target.type, subject: bound.target.subject, dataschema: schema, data}));
  assert.equal((await send(world.hookSource, world.hookToken, bound.target.data)).status, 'rejected');
  assert.equal((await send(world.source, world.token, {...bound.target.data, identity: {...bound.target.data.identity, hostId: 'other-host'}})).status, 'rejected');
  for (const schema of [READ_RECEIPT_SCHEMA, 'https://bunny.invalid/events/lifecycle/2.0']) {
    assert.equal((await send(world.source, world.token, {...bound.target.data, event: {kind: 'turn-started'}}, schema)).status, 'rejected');
  }
  assert.equal((await world.records())[0]?.read, 'unknown');
});

it('unsafe files, unqualified versions, absent metadata and an ingest-only grant never bind', async context => {
  const world = await setup(context);
  for (const input of [{...BIND, version: '2.1.293'}, {...BIND, surface: 'desktop'}, {...BIND, promptId: ''}, {...BIND, text: 'private-content'}]) {
    assert.equal((await runReadHelper(world.producer, input)).status, 'unavailable');
  }
  await chmod(world.producer, 0o644);
  assert.equal((await runReadHelper(world.producer, BIND)).status, 'unavailable');
  const denied = await setup(context, ['ingest']);
  assert.equal((await runReadHelper(denied.producer, BIND, 500)).status, 'unavailable');
  assert.equal((await denied.records())[0]?.read, 'unknown');
});

it('a publication without a matching owner commit remains unconfirmed and is not retried', async context => {
  const world = await setup(context), bound = await runReadHelper(world.producer, BIND);
  assert.ok(bound.status === 'ready');
  const target = structuredClone(bound.target);
  target.data.event.generation += 1;
  const before = (await world.records())[0];
  const result = await runReadHelper(world.producer, readInput(target), 400);
  assert.equal(result.status, 'unconfirmed');
  assert.ok(result.status === 'unconfirmed');
  assert.equal(result.error.code, 'uncertain-result');
  assert.deepEqual((await world.records())[0], before);
  assert.deepEqual(await runReadHelper(world.producer, readInput(bound.target)), {status: 'confirmed'});
  assert.equal((await runReadHelper(world.producer, readInput(target))).status, 'unavailable', 'another generation cannot inherit a confirmed receipt');
});

it('the executable bounds open stdin and rejects oversized input without stderr or a permission decision', async () => {
  for (const input of [undefined, 'x'.repeat(8193)]) {
    const child = spawn(process.execPath, [SCRIPT, '/nonexistent/synthetic-producer.json'], {stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', errors = '';
    child.stdout.on('data', (data: Buffer) => {output += data.toString();});
    child.stderr.on('data', (data: Buffer) => {errors += data.toString();});
    child.stdin.on('error', () => {});
    const began = performance.now();
    const killer = setTimeout(() => {child.kill('SIGKILL');}, 5000);
    if (input !== undefined) child.stdin.end(input);
    const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
    clearTimeout(killer);
    child.stdin.destroy();
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal(errors, '');
    assert.ok(performance.now() - began < 3500);
    const result = JSON.parse(output) as {status: string; error: {retryable: boolean}};
    assert.equal(result.status, input === undefined ? 'unconfirmed' : 'unavailable');
    assert.equal(result.error.retryable, false);
  }
});
