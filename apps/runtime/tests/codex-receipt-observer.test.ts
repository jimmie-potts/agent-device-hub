import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CodexReadObserver, type AcceptedCodexRead, type CodexReadTarget} from '../src/read-receipts/codex-observer.js';
import {CODEX_DESKTOP_VERSION} from '../src/read-receipts/qualification.js';

const TARGET: CodexReadTarget = {identity: {provider: 'codex', client: 'local', hostId: 'test-host', sourceId: 'test-hooks', sessionId: 'thread-a'},
  turnId: 'turn-a', generation: 3, noticeId: 'a'.repeat(64)};

function setup(name = 'Codex Desktop') {
  const receipts: AcceptedCodexRead[] = [], bindings: string[][] = [];
  let now = 1000, target: CodexReadTarget | undefined = structuredClone(TARGET), next = 1;
  const observer = new CodexReadObserver({now: () => now,
    bind: (threadId, turnId) => {bindings.push([threadId, turnId]); return target;},
    accept: receipt => {receipts.push(receipt);},
  });
  const send = (direction: 'client' | 'server', message: object, fragment = false) => {
    const bytes = Buffer.from(JSON.stringify(message) + '\n');
    if (fragment) for (const byte of bytes) observer.observe(direction, Buffer.from([byte]));
    else observer.observe(direction, bytes);
  };
  const request = (method: string, params: object, id: string | number = next++) => {send('client', {id, method, params}); return id;};
  const reply = (id: string | number, result: object) => {send('server', {id, result}, true);};
  const initialized = request('initialize', {clientInfo: {name, version: CODEX_DESKTOP_VERSION}});
  reply(initialized, {userAgent: 'synthetic'});
  const snapshot = (threadId = 'thread-a', revision = 'revision-a') => {
    const id = request('thread/read', {threadId, includeTurns: false});
    reply(id, {thread: {id: threadId, preview: 'DO NOT RETAIN'}, readState: {revision, firstUnread: {type: 'turn', turnId: 'turn-a'}}});
  };
  const select = (params: object = {}, turnId = 'turn-a', status = 'completed') => {
    const id = request('thread/turns/list', {threadId: 'thread-a', cursor: null, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded', ...params});
    reply(id, {data: [{id: turnId, status, items: [{text: 'DO NOT RETAIN'}]}], nextCursor: null});
  };
  const read = (params: object = {}, id?: string | number) => request('thread/readState/update', {
    threadId: 'thread-a', expectedRevision: 'revision-a', operation: {type: 'read'}, ...params,
  }, id);
  const accept = (id: string | number, revision = 'revision-b') => reply(id, {readState: {revision, firstUnread: null}});
  return {observer, receipts, bindings, send, request, reply, snapshot, select, read, accept,
    setTarget: (value: CodexReadTarget | undefined) => {target = value;}, advance: () => {now += 30_001;}};
}

void test('Desktop read acceptance freezes the target at its request and retains only allowlisted metadata', () => {
  const world = setup(); world.snapshot(); world.select();
  assert.deepEqual(world.receipts, []);
  const id = world.read();
  assert.deepEqual(world.bindings, [['thread-a', 'turn-a']]);
  world.setTarget({...TARGET, generation: 9, turnId: 'new-turn'});
  world.accept(id);
  assert.deepEqual(world.receipts, [{target: TARGET, seenRevision: 'revision-a', acceptedRevision: 'revision-b', observedAtMs: 1000}]);
  world.accept(id);
  assert.equal(world.receipts.length, 1);
  assert.ok(!JSON.stringify(world.receipts).includes('DO NOT RETAIN'));
});

void test('snapshots, rendering, completion, shared read notifications and absent owner targets cannot assert reading', () => {
  const world = setup(); world.snapshot(); world.select();
  world.send('server', {method: 'thread/readState/changed', params: {threadId: 'thread-a', readState: {revision: 'revision-b', firstUnread: null}}});
  world.send('server', {method: 'turn/completed', params: {threadId: 'thread-a', turn: {id: 'turn-a', status: 'completed'}}});
  world.setTarget(undefined);
  world.accept(world.read());
  world.setTarget(TARGET);
  world.accept(99);
  assert.deepEqual(world.receipts, []);
});

void test('only the qualified Desktop initialization and latest completed turn after the unread snapshot qualify', () => {
  for (const arrange of [
    (w: ReturnType<typeof setup>) => {w.select(); w.snapshot();},
    (w: ReturnType<typeof setup>) => {w.snapshot(); w.select({cursor: 'older'});},
    (w: ReturnType<typeof setup>) => {w.snapshot(); w.select({sortDirection: 'asc'});},
    (w: ReturnType<typeof setup>) => {w.snapshot(); w.select({}, 'turn-a', 'inProgress');},
    (w: ReturnType<typeof setup>) => {w.snapshot(); w.select(); w.advance();},
  ]) {
    const world = setup(); arrange(world); world.accept(world.read()); assert.deepEqual(world.receipts, []);
  }
  const foreign = setup('codex-cli'); foreign.snapshot(); foreign.select(); foreign.accept(foreign.read());
  assert.deepEqual(foreign.receipts, []);
});

void test('failed, unchanged, stale and unmatched responses never produce receipts', () => {
  for (const reply of [
    (w: ReturnType<typeof setup>, id: string | number) => {w.accept(id, 'revision-a');},
    (w: ReturnType<typeof setup>, id: string | number) => {w.send('server', {id, error: {code: -1, message: 'synthetic'}});},
    (w: ReturnType<typeof setup>, id: string | number) => {w.reply(id, {readState: {revision: 'revision-b', firstUnread: {type: 'turn', turnId: 'turn-a'}}});},
    (w: ReturnType<typeof setup>, id: string | number) => {w.advance(); w.accept(id);},
    (w: ReturnType<typeof setup>) => {w.accept('different-id');},
  ]) {
    const world = setup(); world.snapshot(); world.select(); reply(world, world.read()); assert.deepEqual(world.receipts, []);
  }
  const mismatch = setup(); mismatch.snapshot(); mismatch.select(); mismatch.accept(mismatch.read({expectedRevision: 'different'}));
  assert.deepEqual(mismatch.receipts, []);
});

void test('a newer turn, unread action, lost freshness or connection end cancels pending evidence', () => {
  for (const cancel of [
    (w: ReturnType<typeof setup>) => {w.request('turn/start', {threadId: 'thread-a'});},
    (w: ReturnType<typeof setup>) => {w.send('server', {method: 'turn/started', params: {threadId: 'thread-a', turn: {id: 'turn-b'}}});},
    (w: ReturnType<typeof setup>) => {w.send('server', {method: 'thread/readState/changed', params: {threadId: 'thread-a', readState: {revision: 'revision-c', firstUnread: {type: 'turn', turnId: 'turn-a'}}}});},
    (w: ReturnType<typeof setup>) => {w.read({operation: {type: 'unread'}});},
    (w: ReturnType<typeof setup>) => {w.observer.reset();},
    (w: ReturnType<typeof setup>) => {w.observer.close();},
  ]) {
    const world = setup(); world.snapshot(); world.select(); const id = world.read(); cancel(world); world.accept(id);
    assert.deepEqual(world.receipts, []);
  }
});

void test('ambiguous IDs, malformed or oversized frames disable collection and faults do not escape', () => {
  for (const damage of [
    (w: ReturnType<typeof setup>) => {w.request('anything', {}, 1);},
    (w: ReturnType<typeof setup>) => {w.observer.observe('client', Buffer.from('{bad}\n'));},
    (w: ReturnType<typeof setup>) => {w.observer.observe('client', Buffer.alloc(1024 * 1024 + 1, 32));},
  ]) {
    const world = setup(); world.snapshot(); world.select(); const id = world.read(); damage(world); world.accept(id);
    assert.deepEqual(world.receipts, []);
  }
  const observer = new CodexReadObserver({bind: () => {throw new Error('synthetic failure');}, accept: () => {throw new Error('synthetic failure');}});
  assert.doesNotThrow(() => observer.observe('client', Buffer.from('{}\n')));
});
