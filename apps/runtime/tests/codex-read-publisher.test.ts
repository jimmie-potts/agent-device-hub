import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {Identity, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {readSession} from '@jimmie-potts/event-contracts/v2/session';
import {loadSessionCases} from '@jimmie-potts/event-contracts/v2/session-cases';
import {prepareMessage, publishOnce} from '@jimmie-potts/sdk';
import {createCoreModule} from '../src/core/core.js';
import {producerSource} from '../src/hook/producer.js';
import {openCodexReadPublisher} from '../src/read-receipts/codex-publisher.js';
import {CODEX_RECEIPT_FEED, codexReceiptSource} from '../src/read-receipts/qualification.js';
import {observation, turnEnded, turnStarted} from './fixtures/agents.js';
import {asSession30, current, servedSessions} from './fixtures/session-owner.js';
import {edgeConfig, flush, it, run, waitFor} from './support.js';

const FEED = {provider: 'codex', client: 'local', hostId: 'test-host', sourceId: 'codex-hooks'} as const;
const IDENTITY: Identity = {...FEED, sessionId: 'thread-a'};

async function setup(context: TestContext, scopes: ('read' | 'ingest')[] = ['read', 'ingest']) {
  const token = randomBytes(32).toString('base64url'), hookToken = randomBytes(32).toString('base64url');
  const source = codexReceiptSource(FEED), hookSource = producerSource(FEED);
  const files = await edgeConfig(context, [{source, token, scopes}, {source: hookSource, token: hookToken, scopes: ['ingest']},
    {source: 'bunny/parts/test-reader', token: 'test-reader-token', scopes: ['read']}]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const path = join(files.dir, 'codex-receipt-producer.json');
  const config = {enabled: true, qualified: true, endpoint: `${runtime.url}/api/monitor/v1/events`, token, source: {...FEED, feed: CODEX_RECEIPT_FEED}};
  await writeFile(path, JSON.stringify(config), {mode: 0o600});
  const records = async () => {
    const response = await fetch(`${runtime.url}/api/v2/families/session`, {headers: {authorization: 'Bearer test-reader-token'}});
    assert.equal(response.status, 200);
    return (await response.json() as {records: SessionRecord[]}).records;
  };
  const emit = async (turn: string, identity = IDENTITY) => {
    for (const event of [turnStarted, turnEnded]) {
      const before = logs.filter(row => row.event_name === 'message.received').length;
      const {key, draft} = observation(event, Date.now(), {identity, turn});
      const result = await publishOnce({url: runtime.url, source: hookSource, token: hookToken, timeoutMs: 1000}, key, prepareMessage(hookSource, draft));
      assert.equal(result.status, 'published');
      await waitFor(() => logs.filter(row => row.event_name === 'message.received').length > before);
    }
  };
  await emit('turn-a');
  return {runtime, path, config, source, records, emit};
}

it('the synced Codex publisher binds exact existing targets and commits through authenticated intake', async context => {
  const world = await setup(context), publisher = await openCodexReadPublisher(world.path, () => {});
  assert.ok(publisher); context.after(() => publisher.close());
  assert.equal(publisher.bind('missing', 'turn-a'), undefined);
  assert.equal(publisher.bind('thread-a', 'missing'), undefined);
  const target = publisher.bind('thread-a', 'turn-a'); assert.ok(target);
  const before = (await world.records())[0]; assert.ok(before);
  assert.equal(before.read, 'unknown');
  assert.equal(target.noticeId, before.notices[0]?.id);
  const receipt = {target, seenRevision: 'native-before', acceptedRevision: 'native-after', observedAtMs: Date.now()};
  publisher.accept(receipt);
  await waitFor(async () => (await world.records())[0]?.read === 'read');
  const after = (await world.records())[0]; assert.ok(after);
  assert.equal(after.readReceipt?.source, world.source);
  assert.equal(after.readReceipt?.receipt.kind, 'provider-client');
  assert.deepEqual(after.notices, before.notices);
  assert.deepEqual(after.attention, before.attention);
  publisher.accept(receipt);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await world.records())[0]?.revision, after.revision);
  await world.emit('turn-b');
  await waitFor(() => publisher.bind('thread-a', 'turn-b') !== undefined);
  publisher.accept(receipt);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await world.records())[0]?.read, 'unknown');
});

it('missing read scope, unsafe configuration and a different enrollment cannot enable a Codex publisher', async context => {
  const world = await setup(context);
  await chmod(world.path, 0o644);
  assert.equal(await openCodexReadPublisher(world.path, () => {}), undefined);
  await chmod(world.path, 0o600);
  await writeFile(world.path, JSON.stringify({...world.config, source: {...world.config.source, feed: 'unqualified-enrollment'}}));
  assert.equal(await openCodexReadPublisher(world.path, () => {}), undefined);
  const denied = await setup(context, ['ingest']);
  assert.equal(await openCodexReadPublisher(denied.path, () => {}, 500), undefined);
  assert.equal((await denied.records())[0]?.read, 'unknown');
});

it('a lost owner connection immediately invalidates bindings and tells native observation to discard pending reads', async context => {
  const world = await setup(context); let gaps = 0;
  const publisher = await openCodexReadPublisher(world.path, () => {gaps += 1;});
  assert.ok(publisher); context.after(() => publisher.close());
  assert.ok(publisher.bind('thread-a', 'turn-a'));
  await world.runtime.stop();
  await waitFor(() => publisher.bind('thread-a', 'turn-a') === undefined);
  assert.ok(gaps > 0);
});

it('a refused publication leaves read unchanged and discards pending native evidence without retry', async context => {
  const world = await setup(context, ['read']); let gaps = 0;
  const publisher = await openCodexReadPublisher(world.path, () => {gaps += 1;});
  assert.ok(publisher); context.after(() => publisher.close());
  const target = publisher.bind('thread-a', 'turn-a'); assert.ok(target);
  publisher.accept({target, seenRevision: 'before-refusal', acceptedRevision: 'after-refusal', observedAtMs: Date.now()});
  await waitFor(() => gaps > 0);
  assert.equal(publisher.bind('thread-a', 'turn-a'), undefined);
  assert.equal((await world.records())[0]?.read, 'unknown');
});

it('the Codex publisher binds only a record readSession accepts, and sends nothing for another version (Hub #1865)', async context => {
  // A finished Codex root from the shared cases, served as session/2.0 and as session/3.0 by a stand-in core.
  const found = loadSessionCases().cases.find(item => item.id === 'out-of-order')?.checks[0]?.messages
    .find(message => message.data.identity.client === 'local' && message.data.parent.status !== 'known');
  assert.ok(found);
  const state = current(found);
  const {identity, turn, generation, notices} = state.data;
  assert.ok(turn.status === 'known');
  const feed = {provider: identity.provider, client: identity.client, hostId: identity.hostId, sourceId: identity.sourceId};
  const runs = [];
  for (const message of [state, asSession30(state)]) {
    const world = await servedSessions(context, codexReceiptSource(feed), {...feed, feed: CODEX_RECEIPT_FEED}, [message]);
    let gaps = 0;
    const publisher = await openCodexReadPublisher(world.producer, () => {gaps += 1;});
    assert.ok(publisher); context.after(() => publisher.close());
    runs.push({accepted: readSession(message) !== undefined, world, publisher, gaps: () => gaps, target: publisher.bind(identity.sessionId, turn.id)});
  }
  const ready = runs.filter(item => item.accepted);
  assert.equal(ready.length, 1, 'readSession reads exactly one of the two versions');
  const target = ready[0]?.target;
  assert.deepEqual(target, {identity, turnId: turn.id, generation, noticeId: notices[0]?.id});
  for (const {world, publisher, gaps, target: refused} of runs.filter(item => !item.accepted)) {
    assert.equal(refused, undefined);
    // `accept` rebinds before it sends: a record the publisher does not read stops it before any publication.
    publisher.accept({target, seenRevision: 'native-before', acceptedRevision: 'native-after', observedAtMs: Date.now()});
    await flush();
    assert.deepEqual(world.received, [], 'no receipt reaches the core');
    assert.equal(gaps(), 0, 'nothing failed, so native observation keeps going');
  }
});
