// Sync (ADR 0012, "Consumers and recovery"): the owner's current state at a revision, buffered live messages above
// it, overflow restarts, membership replacement and the refusal path. The ordering cases reuse Hub #842's reference
// consumer scenarios and agent-state's stalled-consumer resync.
import assert from 'node:assert/strict';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Draft, type Removal, type Sdk, type Snapshot, type SyncChange, type SyncedCopy, type SyncRequest} from '../src/index.js';
import {MODE_SCHEMA, START, assertValid, bus, deferred, flush, it, peek, removed, session, trace, turnEnded, type Session} from './support.js';

const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

/** A session owner: each change takes the revision given and is published at once. */
function sessionOwner(sdk: Sdk) {
  const sessions = new Map<string, number>();
  let revision = 0;
  return {
    update(id: string, at: number): Promise<Message<Session>> {
      revision = at;
      sessions.set(id, at);
      return sdk.publish(`bunny.state.session.${id}`, session(id, at));
    },
    remove(id: string, at: number): Promise<Message<Removal>> {
      revision = at;
      sessions.delete(id);
      return sdk.publish(`bunny.state.session.${id}`, removed(id, at));
    },
    snapshot(): Snapshot {
      return {revision, states: [...sessions].map(([id, at]) => session(id, at))};
    },
  };
}

function show(change: SyncChange<Session>): string {
  switch (change.type) {
    case 'updated':
      return `updated ${change.entity.id}@${change.message.data.revision}`;
    case 'removed':
      return change.message === undefined ? `dropped ${change.entity.id}` : `removed ${change.entity.id}@${change.message.data.revision}`;
    case 'synced':
      return `synced @${change.message.data.revision}`;
    case 'failed':
      return `failed ${change.error.error.code}`;
  }
}

const held = (copy: SyncedCopy<Session>): string[] => copy.states().map(message => `${message.data.id}@${message.data.revision}`).sort();

/** Syncs `session` for `sdk`, recording each change, and returns the copy. */
async function synced(sdk: Sdk, changes: string[]): Promise<SyncedCopy<Session>> {
  const result = await sdk.sync<Session>(['session'], change => { changes.push(show(change)); }, {timeoutMs: 5000});
  if (result.status !== 'synced') assert.fail(`sync ${result.error.error.code}`);
  return result.copy;
}

it('a consumer gets the owner\'s current state at a revision, then follows live messages', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 3);
  await owner.update('s2', 4);
  const requests: Message<SyncRequest>[] = [];
  await core.serveSync(['session'], request => { requests.push(request); return owner.snapshot(); });
  const changes: string[] = [];
  const result = await wall.sync<Session>(['session'], change => { changes.push(show(change)); }, {timeoutMs: 5000, parent: PARENT});
  assert.equal(result.status, 'synced');
  if (result.status !== 'synced') return;
  assert.deepEqual(changes, ['updated s1@3', 'updated s2@4', 'synced @4']);
  assert.deepEqual(held(result.copy), ['s1@3', 's2@4']);

  const [request] = requests;
  assert.ok(request);
  assertValid(request);
  assert.equal(request.kind, 'sync-request');
  assert.equal(request.type, 'org.bunny.sync.requested');
  assert.equal(request.source, 'bunny/wall');
  assert.deepEqual(request.data.families, ['session']);
  assert.equal(Date.parse(request.expiresat ?? '') - Date.parse(request.time), 5000);
  assert.equal(trace(request.traceparent).traceId, PARENT_TRACE);
  assertValid(result.message);
  assert.equal(result.message.kind, 'sync-completed');
  assert.equal(result.message.type, 'org.bunny.sync.completed');
  assert.equal(result.message.source, 'bunny/core');
  assert.deepEqual(result.message.data, {requestId: request.data.requestId, revision: 4, members: [{family: 'session', id: 's1'}, {family: 'session', id: 's2'}]});
  const s1 = result.copy.get({family: 'session', id: 's1'});
  assert.ok(s1);
  assertValid(s1);
  assert.equal(s1.kind, 'state');
  assert.equal(s1.source, 'bunny/core');
  assert.equal(trace(s1.traceparent).traceId, PARENT_TRACE, 'the answer continues the request\'s trace');
  assert.equal(result.copy.get({family: 'session', id: 's9'}), undefined);

  await owner.update('s1', 5);
  await flush();
  assert.deepEqual(changes.slice(3), ['updated s1@5']);
  assert.deepEqual(held(result.copy), ['s1@5', 's2@4']);
  await result.copy.close();
  await owner.update('s2', 6);
  await flush();
  assert.deepEqual(changes.slice(4), [], 'a closed copy follows nothing');
});

it('live messages that arrive during a sync wait in the buffer, and those above the sync revision apply in order afterwards', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 10);
  const gate = deferred<undefined>();
  await core.serveSync(['session'], async () => {
    // Published after the consumer subscribed but before the snapshot: at or below its revision.
    await owner.update('s1', 12);
    await owner.update('s2', 14);
    const snapshot = owner.snapshot();
    // Published after the snapshot was taken: above its revision.
    await owner.update('s1', 15);
    await owner.update('s3', 16);
    await owner.remove('s2', 17);
    await owner.update('s1', 18);
    await gate.promise;
    return snapshot;
  });
  const changes: string[] = [];
  const pending = wall.sync<Session>(['session'], change => { changes.push(show(change)); }, {timeoutMs: 5000});
  await flush();
  assert.deepEqual(changes, [], 'live messages wait for the snapshot');
  gate.resolve(undefined);
  const result = await pending;
  assert.deepEqual(changes, ['updated s1@12', 'updated s2@14', 'synced @14', 'updated s1@15', 'updated s3@16', 'removed s2@17', 'updated s1@18']);
  assert.equal(result.status, 'synced');
  if (result.status === 'synced') assert.deepEqual(held(result.copy), ['s1@18', 's3@16']);
});

it('an entity that arrives live above the sync revision survives the sync (#842: hold a@5, y@15, revision 14 with members [a])', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('a', 5);
  let served = 0;
  await core.serveSync(['session'], async () => {
    served += 1;
    const snapshot = owner.snapshot();
    if (served === 2) await owner.update('y', 15);
    return snapshot;
  });
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  assert.deepEqual(held(copy), ['a@5']);
  // x appears and is removed at revision 14 in one burst. The queue holds x@6 and drops the removal, so the copy
  // syncs again; y@15 arrives live while that sync is on its way.
  void owner.update('x', 6);
  void owner.remove('x', 14);
  await flush();
  assert.equal(served, 2);
  assert.deepEqual(changes, ['updated a@5', 'synced @5', 'synced @14', 'updated y@15']);
  assert.deepEqual(held(copy), ['a@5', 'y@15']);
});

it('a removal that arrives during a sync stays removed after it (#842: removal at 16, sync at 14 listing y, late y@15)', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('y', 10);
  let served = 0;
  await core.serveSync(['session'], async () => {
    served += 1;
    const snapshot = owner.snapshot();
    if (served === 2) await owner.remove('y', 16);
    return snapshot;
  });
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  // x appears and is removed at revision 14 in one burst; the dropped removal makes the copy sync again.
  void owner.update('x', 13);
  void owner.remove('x', 14);
  await flush();
  assert.equal(served, 2);
  // A late state at 15, below y's removal at 16, arrives after the sync.
  await core.publish('bunny.state.session.y', session('y', 15));
  await flush();
  assert.deepEqual(changes, ['updated y@10', 'synced @10', 'synced @14', 'removed y@16']);
  assert.deepEqual(held(copy), []);
});

it('a buffer overflow restarts the sync instead of combining partial state', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 3);
  await owner.update('z', 4);
  const requests: string[] = [];
  const first = deferred<undefined>();
  await core.serveSync(['session'], async request => {
    requests.push(request.data.requestId);
    if (requests.length > 1) return owner.snapshot();
    const snapshot = owner.snapshot();
    // Three live messages arrive while the first snapshot is on its way. The buffer holds two, so z's removal
    // overflows it: applying the first snapshot would keep z.
    await owner.update('s1', 5);
    await owner.update('s1', 6);
    await owner.remove('z', 7);
    await first.promise;
    return snapshot;
  });
  const changes: string[] = [];
  const pending = wall.sync<Session>(['session'], change => { changes.push(show(change)); }, {timeoutMs: 5000, maxBuffered: 2});
  await flush();
  first.resolve(undefined);
  const result = await pending;
  assert.equal(requests.length, 2, 'the overflow sent a new sync request');
  assert.notEqual(requests[0], requests[1]);
  assert.equal(result.status, 'synced');
  if (result.status !== 'synced') return;
  assert.equal(result.message.data.requestId, requests[1]);
  assert.deepEqual(changes, ['updated s1@6', 'synced @7'], 'nothing from the first, partial sync is applied');
  assert.deepEqual(held(result.copy), ['s1@6']);
});

it('a sync replaces the consumer\'s full membership, so an entity the owner removed disappears', async () => {
  const {core, wall, errors} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('a', 1);
  await owner.update('b', 2);
  await core.serveSync(['session'], () => owner.snapshot());
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  // In one burst: the queue holds a's update and drops b's removal, so the copy never sees the removal.
  void owner.update('a', 3);
  void owner.remove('b', 4);
  await flush();
  assert.equal(errors.length, 1, 'the dropped removal is reported to onError');
  assert.deepEqual(changes, ['updated a@1', 'updated b@2', 'synced @2', 'updated a@3', 'dropped b', 'synced @4']);
  assert.deepEqual(held(copy), ['a@3']);
});

it('a copy whose delivery queue overflowed is told and syncs again instead of keeping a gap', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  let served = 0;
  await core.serveSync(['session'], () => { served += 1; return owner.snapshot(); });
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  // The queue holds s1@2 and drops s1@3; without the overflow signal the copy would stop at s1@2.
  void owner.update('s1', 2);
  void owner.update('s1', 3);
  await flush();
  assert.equal(served, 2, 'the overflow sent a new sync request');
  assert.deepEqual(changes, ['updated s1@1', 'synced @1', 'updated s1@3', 'synced @3']);
  assert.deepEqual(held(copy), ['s1@3']);
});

it('an owner that cannot serve a sync refuses it with the shared error body, and no sync.completed follows', async () => {
  const {core, wall} = bus();
  const requests: Message<SyncRequest>[] = [];
  await core.serveSync(['session'], request => {
    requests.push(request);
    return errorBody('invalid-state', {detail: 'the store is still loading'});
  });
  const changes: string[] = [];
  const result = await wall.sync<Session>(['session'], change => { changes.push(show(change)); }, {timeoutMs: 5000, parent: PARENT});
  const [request] = requests;
  assert.ok(request);
  const {requestId} = request.data;
  assert.deepEqual(result, {
    status: 'rejected', requestId,
    error: errorBody('invalid-state', {detail: 'the store is still loading', requestId, traceId: PARENT_TRACE}),
  });
  assert.deepEqual(changes, [], 'neither a state nor sync.completed reaches the consumer');
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await flush();
  assert.deepEqual(changes, [], 'a refused sync follows nothing');
});

it('a sync nobody can serve is refused: no owner, a provider that throws or a snapshot that does not fit the request', async () => {
  const {core, wall, errors} = bus();
  const sync = (): ReturnType<Sdk['sync']> => wall.sync(['session'], () => {}, {timeoutMs: 5000});
  const none = await sync();
  assert.equal(none.status, 'rejected');
  if (none.status !== 'rejected') return;
  assert.equal(none.error.error.code, 'unavailable');
  assert.equal(none.error.error.retryable, true);
  assert.equal(none.error.error.requestId, none.requestId);

  const failure = new Error('the store is unreadable');
  const throwing = await core.serveSync(['session'], () => { throw failure; });
  const thrown = await sync();
  assert.equal(thrown.status === 'rejected' ? thrown.error.error.code : thrown.status, 'internal');
  assert.deepEqual(errors, [{error: failure, scope: {source: 'bunny/core', pattern: 'sync session'}}]);
  await throwing.close();

  const misfits: Snapshot[] = [
    {revision: 3, states: [session('s1', 4)]},
    {revision: 3, states: [{...session('s1', 1), dataschema: MODE_SCHEMA}]},
    {revision: -1, states: []},
  ];
  for (const snapshot of misfits) {
    const owner = await core.serveSync(['session'], () => snapshot);
    const result = await sync();
    assert.equal(result.status === 'rejected' ? result.error.error.code : result.status, 'internal', JSON.stringify(snapshot));
    await owner.close();
  }
  assert.equal(errors.length, 4, 'each misfit snapshot is reported');
});

it('an owner that closes refuses the sync requests still waiting, and a full owner queue refuses with capacity', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const gate = deferred<Snapshot>();
  const owner = await core.serveSync(['session'], () => gate.promise);
  const busy = wall.sync(['session'], () => {}, {timeoutMs: 5000});
  await flush();
  const waiting = wall.sync(['session'], () => {}, {timeoutMs: 5000});
  await flush();
  const full = await peek(wall.sync(['session'], () => {}, {timeoutMs: 5000}));
  assert.equal(full?.status === 'rejected' ? full.error.error.code : full?.status, 'capacity');
  const closed = owner.close();
  const refusedOnClose = await peek(waiting);
  assert.equal(refusedOnClose?.status === 'rejected' ? refusedOnClose.error.error.detail : refusedOnClose?.status, 'the owner closed');
  gate.resolve({revision: 0, states: []});
  await closed;
  assert.equal((await busy).status, 'synced', 'the request being served still gets its answer');
});

it('a sync request past its deadline is unavailable, and an owner ignores one that expired while it waited', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const {core, wall} = bus();
  const gate = deferred<Snapshot>();
  const served: number[] = [];
  await core.serveSync(['session'], request => {
    served.push(Date.parse(request.expiresat ?? '') - Date.parse(request.time));
    return gate.promise;
  });
  const changes: string[] = [];
  const slow = wall.sync<Session>(['session'], change => { changes.push(show(change)); }, {timeoutMs: 1000, parent: PARENT});
  await flush();
  const late = wall.sync(['session'], () => {}, {timeoutMs: 100});
  await flush();
  context.mock.timers.tick(100);
  const expired = await peek(late);
  assert.equal(expired?.status === 'rejected' ? expired.error.error.detail : expired?.status, 'no sync answer within 100 ms');
  context.mock.timers.tick(899);
  assert.equal(await peek(slow), undefined, 'still waiting before the deadline');
  context.mock.timers.tick(1);
  const timedOut = await peek(slow);
  assert.equal(timedOut?.status, 'rejected');
  if (timedOut?.status !== 'rejected') return;
  assert.deepEqual(timedOut.error, errorBody('unavailable', {requestId: timedOut.requestId, traceId: PARENT_TRACE, detail: 'no sync answer within 1000 ms'}));
  gate.resolve({revision: 1, states: [session('s1', 1)]});
  await flush();
  assert.deepEqual(changes, [], 'a late answer is ignored');
  assert.deepEqual(served, [1000], 'the expired request never reached the provider');
});

it('a later sync that cannot be served ends the copy with a failed change', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  const serving = await core.serveSync(['session'], () => owner.snapshot());
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  await serving.close();
  void owner.update('s1', 2);
  void owner.update('s1', 3);
  await flush();
  assert.deepEqual(changes, ['updated s1@1', 'synced @1', 'failed unavailable']);
  await owner.update('s1', 4);
  await flush();
  assert.equal(changes.length, 3, 'the copy no longer follows the owner');
  assert.deepEqual(held(copy), ['s1@1'], 'it keeps its last records');
});

it('sync sends current state, never past occurrences or removals', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  await owner.update('s2', 2);
  await core.publish('bunny.event.session.s1', turnEnded('s1'));
  await owner.remove('s2', 3);
  await core.serveSync(['session'], async () => {
    await core.publish('bunny.event.session.s1', turnEnded('s1'));
    return owner.snapshot();
  });
  const changes: string[] = [];
  const kinds: string[] = [];
  const result = await wall.sync<Session>(['session'], change => {
    changes.push(show(change));
    if (change.type !== 'failed' && change.message !== undefined) kinds.push(change.message.kind);
  }, {timeoutMs: 5000});
  assert.equal(result.status, 'synced');
  assert.deepEqual(changes, ['updated s1@1', 'synced @3'], 'no occurrence, and no removal of s2, which the copy never held');
  assert.deepEqual(kinds, ['state', 'sync-completed']);
});

it('duplicates and stale revisions are dropped, and a late state does not bring a removed entity back', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 5);
  await core.serveSync(['session'], () => owner.snapshot());
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  // Repeated and out-of-order deliveries, as a reconnecting remote transport may produce them.
  const deliveries: Draft<object>[] = [
    session('s1', 5), // a duplicate of what the copy holds
    session('s1', 4), // older than the held record
    session('s2', 3), // at or below the sync revision, so already part of the snapshot
    session('s1', 7),
    session('s1', 6), // older than the held record
    removed('s1', 8),
    session('s1', 7), // older than the removal
    removed('s1', 8), // a duplicate removal
  ];
  for (const draft of deliveries) await core.publish(`bunny.state.session.${draft.subject}`, draft);
  await flush();
  assert.deepEqual(changes, ['updated s1@5', 'synced @5', 'updated s1@7', 'removed s1@8']);
  assert.deepEqual(held(copy), []);
});

it('one owner serves each family, and malformed sync calls are refused with invalid-request', async () => {
  const {core, wall} = bus();
  const empty = (): Snapshot => ({revision: 0, states: []});
  await core.serveSync(['session', 'inbox-item'], empty);
  await assert.rejects(wall.serveSync(['session'], empty), refused('invalid-state'));
  await assert.rejects(wall.serveSync(['mode', 'inbox-item'], empty), refused('invalid-state'));
  const malformed = [[], ['Session'], ['session', 'session'], ['bunny.session'], ['a'.repeat(65)], Array.from({length: 33}, (_, index) => `f${index}`)];
  for (const families of malformed) {
    await assert.rejects(wall.sync(families, () => {}, {timeoutMs: 5000}), refused('invalid-request'), JSON.stringify(families));
    await assert.rejects(wall.serveSync(families, empty), refused('invalid-request'), JSON.stringify(families));
  }
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
    await assert.rejects(wall.sync(['session'], () => {}, {timeoutMs}), refused('invalid-request'), String(timeoutMs));
  }
  for (const maxBuffered of [0, -1, 1.5]) {
    await assert.rejects(wall.sync(['session'], () => {}, {timeoutMs: 5000, maxBuffered}), refused('invalid-request'), String(maxBuffered));
  }
  await wall.serveSync(['mode'], empty);
  const split = await core.sync(['session', 'mode'], () => {}, {timeoutMs: 5000});
  assert.equal(split.status === 'rejected' ? split.error.error.code : split.status, 'invalid-request', 'one sync covers one owner\'s families');
  assert.equal((await core.sync(['session', 'inbox-item'], () => {}, {timeoutMs: 5000})).status, 'synced');
});
