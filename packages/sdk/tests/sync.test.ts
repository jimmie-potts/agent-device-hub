// Sync (ADR 0012, "Consumers and recovery"): the owner's current state at a revision, buffered live messages above
// it, overflow restarts, membership replacement and the refusal path. The ordering cases reuse Hub #842's reference
// consumer scenarios and agent-state's stalled-consumer resync.
import assert from 'node:assert/strict';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Draft, type ErrorScope, type Removal, type Sdk, type Snapshot, type SyncChange, type SyncedCopy, type SyncRequest} from '../src/index.js';
import {startSync, type SyncAnswer, type SyncCompleted, type SyncTransport} from '../src/sync.js';
import {
  MODE_SCHEMA, SESSION_FAMILY, START, assertValid, bus, checked, deferred, flush, it, manualClock, peek, removed, session, trace, turnEnded,
  type Session,
} from './support.js';

const FAMILY = SESSION_FAMILY;
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
      return sdk.publish(`bunny.state.${FAMILY}.${id}`, session(id, at));
    },
    remove(id: string, at: number): Promise<Message<Removal>> {
      revision = at;
      sessions.delete(id);
      return sdk.publish(`bunny.state.${FAMILY}.${id}`, removed(id, at));
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
  const result = await sdk.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000});
  if (result.status !== 'synced') assert.fail(`sync ${result.error.error.code}`);
  return result.copy;
}

it('a consumer gets the owner\'s current state at a revision, then follows live messages', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 3);
  await owner.update('s2', 4);
  const requests: Message<SyncRequest>[] = [];
  await core.serveSync([FAMILY], request => { requests.push(request); return owner.snapshot(); });
  const changes: string[] = [];
  const result = await wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, parent: PARENT});
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
  assert.deepEqual(request.data.families, [FAMILY]);
  assert.equal(Date.parse(request.expiresat ?? '') - Date.parse(request.time), 5000);
  assert.equal(trace(request.traceparent).traceId, PARENT_TRACE);
  assertValid(result.message);
  assert.equal(result.message.kind, 'sync-completed');
  assert.equal(result.message.type, 'org.bunny.sync.completed');
  assert.equal(result.message.source, 'bunny/core');
  assert.equal(trace(result.message.traceparent).traceId, PARENT_TRACE);
  assert.deepEqual(result.message.data, {requestId: request.data.requestId, revision: 4, members: [{family: FAMILY, id: 's1'}, {family: FAMILY, id: 's2'}]});
  const s1 = result.copy.get({family: FAMILY, id: 's1'});
  assert.ok(s1);
  assertValid(s1);
  assert.equal(s1.kind, 'state');
  assert.equal(s1.source, 'bunny/core');
  assert.equal(trace(s1.traceparent).traceId, PARENT_TRACE, 'the answer continues the request\'s trace');
  assert.equal(result.copy.get({family: FAMILY, id: 's9'}), undefined);

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
  await core.serveSync([FAMILY], async () => {
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
  const pending = wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000});
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
  await core.serveSync([FAMILY], async () => {
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
  await core.serveSync([FAMILY], async () => {
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
  await core.publish(`bunny.state.${FAMILY}.y`, session('y', 15));
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
  await core.serveSync([FAMILY], async request => {
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
  const pending = wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, maxBuffered: 2});
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
  await core.serveSync([FAMILY], () => owner.snapshot());
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
  await core.serveSync([FAMILY], () => { served += 1; return owner.snapshot(); });
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
  await core.serveSync([FAMILY], request => {
    requests.push(request);
    return errorBody('invalid-state', {detail: 'the store is still loading'});
  });
  const changes: string[] = [];
  const result = await wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, parent: PARENT});
  const [request] = requests;
  assert.ok(request);
  const {requestId} = request.data;
  assert.deepEqual(result, {
    status: 'rejected', requestId,
    error: errorBody('invalid-state', {detail: 'the store is still loading', requestId, traceId: PARENT_TRACE}),
  });
  assert.deepEqual(changes, [], 'neither a state nor sync.completed reaches the consumer');
  await core.publish(`bunny.state.${FAMILY}.s1`, session('s1', 1));
  await flush();
  assert.deepEqual(changes, [], 'a refused sync follows nothing');
});

it('a sync nobody can serve is refused: no owner, a provider that throws or a snapshot that does not fit the request', async () => {
  const {core, wall, errors} = bus();
  const sync = (): ReturnType<Sdk['sync']> => wall.sync([FAMILY], () => {}, {timeoutMs: 5000});
  const none = await sync();
  assert.equal(none.status, 'rejected');
  if (none.status !== 'rejected') return;
  assert.equal(none.error.error.code, 'unavailable');
  assert.equal(none.error.error.retryable, true);
  assert.equal(none.error.error.requestId, none.requestId);

  const failure = new Error('the store is unreadable');
  const throwing = await core.serveSync([FAMILY], () => { throw failure; });
  const thrown = await sync();
  assert.equal(thrown.status === 'rejected' ? thrown.error.error.code : thrown.status, 'internal');
  assert.deepEqual(errors, [{error: failure, scope: {source: 'bunny/core', pattern: `sync ${FAMILY}`}}]);
  await throwing.close();

  const misfits: Snapshot[] = [
    {revision: 3, states: [session('s1', 4)]},
    {revision: 3, states: [{...session('s1', 1), dataschema: MODE_SCHEMA}]},
    {revision: -1, states: []},
    {revision: 3, states: [session('not an id', 1)]},
    {revision: 4097, states: Array.from({length: 4097}, (_, index) => session(`s${index}`, index + 1))},
  ];
  for (const snapshot of misfits) {
    const owner = await core.serveSync([FAMILY], () => snapshot);
    const result = await sync();
    assert.equal(result.status === 'rejected' ? result.error.error.code : result.status, 'internal', JSON.stringify(snapshot));
    await owner.close();
  }
  assert.equal(errors.length, 6, 'each misfit snapshot is reported');
});

it('an owner that closes refuses the sync requests still waiting, and a full owner queue refuses with capacity', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const gate = deferred<Snapshot>();
  const owner = await core.serveSync([FAMILY], () => gate.promise);
  const busy = wall.sync([FAMILY], () => {}, {timeoutMs: 5000});
  await flush();
  const waiting = wall.sync([FAMILY], () => {}, {timeoutMs: 5000});
  await flush();
  const full = await peek(wall.sync([FAMILY], () => {}, {timeoutMs: 5000}));
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
  await core.serveSync([FAMILY], request => {
    served.push(Date.parse(request.expiresat ?? '') - Date.parse(request.time));
    return gate.promise;
  });
  const changes: string[] = [];
  const slow = wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 1000, parent: PARENT});
  await flush();
  const late = wall.sync([FAMILY], () => {}, {timeoutMs: 100});
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
  const serving = await core.serveSync([FAMILY], () => owner.snapshot());
  const changes: string[] = [];
  const result = await wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, maxBuffered: 2});
  if (result.status !== 'synced') assert.fail('the first sync is served');
  await serving.close();
  void owner.update('s1', 2);
  void owner.update('s1', 3);
  await flush();
  assert.deepEqual(changes, ['updated s1@1', 'synced @1', 'failed unavailable']);
  // An owner serves again, and more messages arrive than the buffer holds.
  await core.serveSync([FAMILY], () => owner.snapshot());
  for (const revision of [4, 5, 6, 7]) {
    await owner.update('s1', revision);
    await flush();
  }
  assert.equal(changes.length, 3, 'the copy no longer follows the owner');
  assert.deepEqual(held(result.copy), ['s1@1'], 'it keeps its last records');
});

it('sync sends current state, never past occurrences or removals', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  await owner.update('s2', 2);
  await core.publish('bunny.event.session.s1', turnEnded('s1'));
  await owner.remove('s2', 3);
  await core.serveSync([FAMILY], async () => {
    await core.publish('bunny.event.session.s1', turnEnded('s1'));
    return owner.snapshot();
  });
  const changes: string[] = [];
  const kinds: string[] = [];
  const result = await wall.sync<Session>([FAMILY], change => {
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
  await core.serveSync([FAMILY], () => owner.snapshot());
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
    removed('s1', 6), // a late removal below the one applied: the tombstone stays at 8
    session('s1', 7), // still older than the removal
  ];
  for (const draft of deliveries) await core.publish(`bunny.state.${FAMILY}.${draft.subject}`, draft);
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
  const malformed = [[], ['Session'], ['session', 'session'], ['bunny.session'], ['a'.repeat(65)]];
  for (const families of malformed) {
    await assert.rejects(wall.sync(families, () => {}, {timeoutMs: 5000}), refused('invalid-request'), JSON.stringify(families));
    await assert.rejects(wall.serveSync(families, empty), refused('invalid-request'), JSON.stringify(families));
  }
  // A request names at most 32 families, in a subject of at most 256 characters; an owner may serve more.
  const many = Array.from({length: 33}, (_, index) => `f${index}`);
  const long = Array.from({length: 5}, (_, index) => `${'f'.repeat(59)}${index}`);
  for (const families of [many, long]) {
    await assert.rejects(wall.sync(families, () => {}, {timeoutMs: 5000}), refused('invalid-request'), `${families.length} families`);
  }
  await wall.serveSync([...many, ...long], empty);
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

// Review round (PR #894): one outstanding request per copy, a bounded first sync and a bounded live buffer.

it('a stalled handler keeps a bounded buffer and asks for one sync when it catches up, however many messages overflow', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  let served = 0;
  await core.serveSync([FAMILY], () => { served += 1; return owner.snapshot(); });
  const gate = deferred<undefined>();
  const changes: string[] = [];
  const result = await wall.sync<Session>([FAMILY], async change => {
    changes.push(show(change));
    if (change.type === 'updated' && change.message.data.revision === 2) await gate.promise;
  }, {timeoutMs: 5000, maxBuffered: 3});
  assert.equal(result.status, 'synced');
  // The handler stalls on s1@2 while 49 more messages arrive: the buffer of 3 overflows again and again.
  for (let revision = 2; revision <= 51; revision += 1) {
    await owner.update('s1', revision);
    await flush();
  }
  gate.resolve(undefined);
  await flush();
  assert.ok(served <= 2, `${served} provider calls`);
  assert.deepEqual(changes, ['updated s1@1', 'synced @1', 'updated s1@2', 'updated s1@51', 'synced @51'], 'the handler hears the resync, not each buffered message');
});

it('a second consumer is served promptly while another copy keeps overflowing', async () => {
  const {bus: created, core, wall} = bus();
  const second = checked(created.connect('bunny/second'));
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  const gate = deferred<undefined>();
  const callers: string[] = [];
  await core.serveSync([FAMILY], async request => {
    callers.push(request.source);
    await gate.promise;
    return owner.snapshot();
  });
  const first = wall.sync<Session>([FAMILY], () => {}, {timeoutMs: 60_000, maxBuffered: 2});
  await flush();
  // While the owner serves the first copy's request, its buffer of 2 overflows again and again.
  for (let revision = 2; revision <= 30; revision += 1) {
    await owner.update('s1', revision);
    await flush();
  }
  const other = second.sync<Session>([FAMILY], () => {}, {timeoutMs: 60_000});
  await flush();
  gate.resolve(undefined);
  assert.equal((await other).status, 'synced');
  assert.equal((await first).status, 'synced');
  assert.deepEqual(callers.slice(0, 2), ['bunny/wall', 'bunny/second'], 'the second consumer waits behind one request at most');
  assert.equal(callers.length, 3, 'the first copy replaces its request once');
});

it('a copy\'s own replaced requests never fill the owner\'s queue', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  const gate = deferred<undefined>();
  let served = 0;
  await core.serveSync([FAMILY], async () => {
    served += 1;
    await gate.promise;
    return owner.snapshot();
  });
  const pending = wall.sync<Session>([FAMILY], () => {}, {timeoutMs: 60_000, maxBuffered: 1});
  await flush();
  for (const revision of [2, 3, 4, 5, 6]) {
    await owner.update('s1', revision);
    await flush();
  }
  gate.resolve(undefined);
  const result = await pending;
  assert.equal(result.status === 'rejected' ? result.error.error.code : result.status, 'synced', 'the copy never refuses itself with capacity');
  assert.equal(served, 2);
  if (result.status === 'synced') assert.deepEqual(held(result.copy), ['s1@6']);
});

it('a first sync that keeps overflowing is refused as unavailable at its deadline', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  let served = 0;
  let revision = 0;
  const never = deferred<Snapshot>();
  await core.serveSync([FAMILY], async () => {
    served += 1;
    // The first two answers take 400 ms each and see more live messages than the buffer holds; the third never comes.
    if (served > 2) return never.promise;
    const snapshot = owner.snapshot();
    for (let count = 0; count < 3; count += 1) await owner.update('s1', ++revision);
    await flush();
    context.mock.timers.tick(400);
    return snapshot;
  });
  const pending = wall.sync<Session>([FAMILY], () => {}, {timeoutMs: 1000, maxBuffered: 2});
  for (let round = 0; round < 10 && served < 3; round += 1) await flush();
  assert.equal(served, 3);
  assert.equal(Date.now() - START, 800);
  // The third request, sent at 800 ms, gets only the 200 ms left.
  context.mock.timers.tick(199);
  assert.equal(await peek(pending), undefined);
  context.mock.timers.tick(1);
  const result = await peek(pending);
  assert.equal(result?.status, 'rejected');
  if (result?.status !== 'rejected') return;
  assert.equal(result.error.error.code, 'unavailable');
  assert.equal(result.error.error.retryable, true);
});

it('a first sync out of time names the last request it sent', async () => {
  let now = START;
  const sent: {requestId: string; answer: (answer: SyncAnswer) => void}[] = [];
  let overflow = (): void => {};
  const transport: SyncTransport = {
    now: () => now,
    subscribe: (_pattern, _handler, {onOverflow}) => {
      overflow = () => { void onOverflow?.({dropped: 1}); };
      return Promise.resolve({close: () => Promise.resolve()});
    },
    request: ({requestId}) => new Promise<SyncAnswer>(answer => { sent.push({requestId, answer}); }),
    report: () => {},
  };
  const pending = startSync(transport, [FAMILY], () => {}, {timeoutMs: 1000});
  await flush();
  const [first] = sent;
  assert.ok(first);
  // The answer on its way now has a gap, and it arrives at the deadline, too late for another request.
  overflow();
  now = START + 1000;
  const completed: Message<SyncCompleted> = {
    specversion: '1.0', bunnyprofile: '2.0', id: 'done-1', source: 'bunny/core', type: 'org.bunny.sync.completed', subject: FAMILY,
    time: new Date(now).toISOString(), kind: 'sync-completed', datacontenttype: 'application/json',
    dataschema: 'https://bunny.invalid/events/sync-completed/2.0', traceparent: PARENT.traceparent,
    data: {requestId: first.requestId, revision: 0, members: []},
  };
  first.answer({status: 'served', requestId: first.requestId, states: [], completed});
  const result = await pending;
  assert.equal(sent.length, 1);
  assert.equal(result.status === 'rejected' ? result.error.error.code : result.status, 'unavailable');
  assert.equal(result.status === 'rejected' ? result.requestId : '', first.requestId);
});

it('only the first sync request joins the caller\'s trace; a later one starts its own', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  const requests: Message<SyncRequest>[] = [];
  await core.serveSync([FAMILY], request => { requests.push(request); return owner.snapshot(); });
  const result = await wall.sync<Session>([FAMILY], () => {}, {timeoutMs: 5000, parent: PARENT});
  assert.equal(result.status, 'synced');
  // A burst: the queue holds s1@1 and drops s1@2, so the copy syncs again.
  void owner.update('s1', 1);
  void owner.update('s1', 2);
  await flush();
  const traces = requests.map(request => trace(request.traceparent).traceId);
  assert.equal(traces.length, 2);
  assert.equal(traces[0], PARENT_TRACE);
  assert.notEqual(traces[1], PARENT_TRACE);
});

it('a refused first sync stays stopped however many messages follow', async () => {
  const {core, wall} = bus();
  const owner = sessionOwner(core);
  let served = 0;
  await core.serveSync([FAMILY], () => {
    served += 1;
    return served === 1 ? errorBody('invalid-state', {detail: 'the store is still loading'}) : owner.snapshot();
  });
  const changes: string[] = [];
  const result = await wall.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, maxBuffered: 2});
  assert.equal(result.status, 'rejected');
  for (const revision of [1, 2, 3, 4, 5]) {
    await owner.update('s1', revision);
    await flush();
  }
  assert.equal(served, 1, 'no sync request follows the refusal');
  assert.deepEqual(changes, []);
});

it('a snapshot older than a state the copy already holds keeps that state', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const owner = sessionOwner(core);
  await owner.update('b', 2);
  let served = 0;
  await core.serveSync([FAMILY], () => {
    served += 1;
    // The second answer comes from a cache taken at revision 3, before a@5.
    return served === 1 ? owner.snapshot() : {revision: 3, states: [session('b', 2)]};
  });
  const changes: string[] = [];
  const copy = await synced(wall, changes);
  await owner.update('a', 5);
  await flush();
  // A burst: the queue holds c@6 and drops c@7, so the copy syncs again.
  void owner.update('c', 6);
  void owner.update('c', 7);
  await flush();
  assert.equal(served, 2);
  assert.equal(copy.get({family: FAMILY, id: 'a'})?.data.revision, 5, 'a changed above the snapshot\'s revision, so it stays');
  assert.ok(!changes.includes('dropped a'));
});

it('a copy closed while its handler runs hears no more changes', async () => {
  const {core, wall} = bus({maxQueued: 1});
  let served = 0;
  await core.serveSync([FAMILY], () => {
    served += 1;
    return served === 1 ? {revision: 1, states: [session('a', 1)]} : {revision: 9, states: [session('a', 7), session('b', 8), session('c', 9)]};
  });
  const gate = deferred<undefined>();
  const changes: string[] = [];
  const result = await wall.sync<Session>([FAMILY], async change => {
    changes.push(show(change));
    if (change.type === 'updated' && change.message.data.revision === 7) await gate.promise;
  }, {timeoutMs: 5000});
  if (result.status !== 'synced') assert.fail('the first sync is served');
  // A burst makes the copy sync again, and that answer brings four changes.
  void core.publish(`bunny.state.${FAMILY}.z`, session('z', 2));
  void core.publish(`bunny.state.${FAMILY}.z`, session('z', 3));
  await flush();
  assert.deepEqual(changes, ['updated a@1', 'synced @1', 'updated a@7']);
  const closed = result.copy.close();
  gate.resolve(undefined);
  await closed;
  await flush();
  assert.deepEqual(changes, ['updated a@1', 'synced @1', 'updated a@7'], 'nothing after the close is told');
});

it('a message without an entity is reported and ignored, and the copy goes on', async () => {
  const {bus: created, core, wall, errors} = bus();
  // Not checked: this participant sends a message the profile refuses.
  const rogue = created.connect('bunny/rogue');
  const owner = sessionOwner(core);
  await core.serveSync([FAMILY], () => owner.snapshot());
  const changes: string[] = [];
  await synced(wall, changes);
  const broken = {...session('s1', 1), dataschema: undefined} as unknown as Draft<Session>;
  await rogue.publish(`bunny.state.${FAMILY}.s1`, broken);
  await owner.update('s1', 2);
  await flush();
  assert.deepEqual(changes, ['synced @0', 'updated s1@2']);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.error instanceof TypeError);
  assert.deepEqual(errors[0].scope, {source: 'bunny/wall', pattern: `sync ${FAMILY}`});
});

it('a sync request whose transport rejects or throws is reported and refused as unavailable', async () => {
  const failure = new Error('the connection dropped');
  const failures: Record<string, () => Promise<SyncAnswer>> = {rejects: () => Promise.reject(failure), throws: () => { throw failure; }};
  for (const [how, request] of Object.entries(failures)) {
    const reported: unknown[] = [];
    const transport: SyncTransport = {
      now: () => Date.now(),
      subscribe: () => Promise.resolve({close: () => Promise.resolve()}),
      request,
      report: error => { reported.push(error); },
    };
    const result = await startSync(transport, [FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(result.status, 'rejected', how);
    if (result.status !== 'rejected') return;
    assert.equal(result.error.error.code, 'unavailable', how);
    assert.equal(result.error.error.requestId, result.requestId, how);
    assert.deepEqual(reported, [failure], how);
  }
});

it('a copy sends no sync request until every family is subscribed, even after an overflow', async () => {
  const sent: number[] = [];
  const slow = deferred<undefined>();
  const overflows: (() => void)[] = [];
  let subscribed = 0;
  const transport: SyncTransport = {
    now: () => Date.now(),
    subscribe: async (pattern, _handler, {onOverflow}) => {
      overflows.push(() => { void onOverflow?.({dropped: 1}); });
      // The second family subscribes slowly, as a remote transport may.
      if (pattern === 'bunny.state.mode.*') await slow.promise;
      subscribed += 1;
      return {close: () => Promise.resolve()};
    },
    request: () => {
      sent.push(subscribed);
      return new Promise<SyncAnswer>(() => {});
    },
    report: () => {},
  };
  void startSync(transport, [FAMILY, 'mode'], () => {}, {timeoutMs: 5000});
  await flush();
  // The first family's queue overflows while the second is still subscribing.
  overflows[0]?.();
  await flush();
  assert.deepEqual(sent, [], 'no request before the last subscription');
  slow.resolve(undefined);
  await flush();
  assert.deepEqual(sent, [2], 'one request, once both families are subscribed');
});

it('a sync request still queued at its deadline leaves the owner\'s queue and stays unavailable, so asking again is safe', async () => {
  const clock = manualClock();
  const {core, wall} = bus({now: clock.now, scheduler: clock.scheduler, maxQueued: 1});
  const gate = deferred<Snapshot>();
  let served = 0;
  await core.serveSync([FAMILY], () => { served += 1; return gate.promise; });
  const busy = wall.sync([FAMILY], () => {}, {timeoutMs: 5000});
  await flush();
  const queued = wall.sync([FAMILY], () => {}, {timeoutMs: 100, parent: PARENT});
  await flush();
  clock.advance(100);
  const expired = await peek(queued);
  assert.equal(expired?.status, 'rejected');
  if (expired?.status !== 'rejected') return;
  assert.deepEqual(expired.error, errorBody('unavailable', {requestId: expired.requestId, traceId: PARENT_TRACE, detail: 'no sync answer within 100 ms'}));
  assert.equal(expired.error.error.retryable, true, 'a sync changes nothing, so it is never expired');
  const next = wall.sync([FAMILY], () => {}, {timeoutMs: 5000});
  await flush();
  assert.equal(await peek(next), undefined, 'the next request waits in the room the expired one left, instead of capacity');
  gate.resolve({revision: 0, states: []});
  assert.equal((await busy).status, 'synced');
  assert.equal((await next).status, 'synced');
  assert.equal(served, 2, 'the expired request never reached the provider');
});

it('each overflow that restarts a copy\'s sync is reported to onSyncRestart with its source and families', async () => {
  const restarts: ErrorScope[] = [];
  const {core, wall} = bus({maxQueued: 1, onSyncRestart: scope => { restarts.push(scope); }});
  const owner = sessionOwner(core);
  await owner.update('s1', 1);
  await core.serveSync([FAMILY], () => owner.snapshot());
  const changes: string[] = [];
  await synced(wall, changes);
  assert.deepEqual(restarts, [], 'a first sync is not a restart');
  void owner.update('s1', 2);
  void owner.update('s1', 3);
  await flush();
  assert.deepEqual(restarts, [{source: 'bunny/wall', pattern: `sync ${FAMILY}`}]);
});
