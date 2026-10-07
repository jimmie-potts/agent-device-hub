// Several owners of one family (Hub #967, ADR 0012 "Ownership and publication"): every device module serves `device`
// for its own devices, so sync ownership is keyed by source and family. A consumer names the owner it syncs from and
// gets only that owner's records; a sync that names no owner goes to the family's only owner, and is refused with
// `invalid-request` when there are several, never spread across them. Both transports behave the same.
import assert from 'node:assert/strict';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {buildMessage} from '../src/envelope.js';
import {REMOTE_PATH, REMOTE_SCHEMA, SdkError, type ErrorScope, type Snapshot, type SyncChange, type SyncedCopy} from '../src/index.js';
import {SHARED_FAMILIES, startSync, type OutgoingSync, type SyncAnswer, type SyncTransport} from '../src/sync.js';
import {DEVICE_FAMILY, SESSION_FAMILY, bus, checked, deferred, device, deviceRemoved, flush, it, session, until} from './support.js';
import {inProcess, remote, startEdge, using, type Transport, type World} from './transports.js';

const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const empty = (): Snapshot => ({revision: 0, states: []});

it('device is the one family that several owners may serve', () => {
  assert.deepEqual([...SHARED_FAMILIES], [DEVICE_FAMILY]);
});

function show(change: SyncChange<DeviceRecord>): string {
  switch (change.type) {
    case 'updated':
      return `updated ${change.entity.id}@${change.message.data.revision}`;
    case 'removed':
      return `removed ${change.entity.id}`;
    case 'synced':
      return `synced @${change.message.data.revision}`;
    case 'failed':
      return `failed ${change.error.error.code}`;
  }
}

const held = (copy: SyncedCopy<DeviceRecord>): string[] => copy.states().map(message => `${message.data.id}@${message.data.revision}`).sort();
/** The bus's records of one sync request, as `<event> <level> [<code>]`. */
const decisions = (world: World, requestId: string): string[] =>
  world.diagnostics.filter(record => record.requestId === requestId).map(record => [record.event, record.level, record.code].filter(part => part !== undefined).join(' '));

function suite(transport: Transport): void {
  const name = (text: string): string => `${transport.name}: ${text}`;

  it(name('two owners serve device, and a consumer syncs each by name and gets only that owner\'s records, live ones included'), () => using(transport, {}, async world => {
    // One owner over the transport under test and one on the bus, as a remote part and a module would be.
    const first = await world.connect('bunny/core');
    const second = world.local('bunny/second');
    const consumer = await world.connect('bunny/wall');
    await first.serveSync([DEVICE_FAMILY], () => ({revision: 1, states: [device('lamp-1', 1)]}));
    await second.serveSync([DEVICE_FAMILY], () => ({revision: 2, states: [device('sign-1', 2)]}));
    const changes: Record<'first' | 'second', string[]> = {first: [], second: []};
    const fromFirst = await consumer.sync<DeviceRecord>([DEVICE_FAMILY], change => { changes.first.push(show(change)); }, {timeoutMs: 5000, owner: 'bunny/core'});
    const fromSecond = await consumer.sync<DeviceRecord>([DEVICE_FAMILY], change => { changes.second.push(show(change)); }, {timeoutMs: 5000, owner: 'bunny/second'});
    assert.equal(fromFirst.status, 'synced');
    assert.equal(fromSecond.status, 'synced');
    if (fromFirst.status !== 'synced' || fromSecond.status !== 'synced') return;
    assert.deepEqual([fromFirst.message.source, fromFirst.message.data.members], ['bunny/core', [{family: DEVICE_FAMILY, id: 'lamp-1'}]]);
    assert.deepEqual([fromSecond.message.source, fromSecond.message.data.members], ['bunny/second', [{family: DEVICE_FAMILY, id: 'sign-1'}]]);

    // Both copies hear every device message on the bus. Each applies only its owner's, so the second owner's removal of
    // lamp-1, which only lamp-1's own module may publish, changes neither copy.
    await first.publish('bunny.state.device.lamp-1', device('lamp-1', 3, 'available'));
    await second.publish('bunny.state.device.sign-1', device('sign-1', 4, 'unavailable'));
    await second.publish('bunny.state.device.lamp-1', deviceRemoved('lamp-1', 9));
    await first.publish('bunny.state.device.lamp-1', device('lamp-1', 5, 'available'));
    await until(() => changes.first.includes('updated lamp-1@5') && changes.second.includes('updated sign-1@4'), 'each owner\'s live updates');
    await flush();
    assert.deepEqual(changes.first, ['updated lamp-1@1', 'synced @1', 'updated lamp-1@3', 'updated lamp-1@5']);
    assert.deepEqual(changes.second, ['updated sign-1@2', 'synced @2', 'updated sign-1@4']);
    assert.deepEqual(held(fromFirst.copy), ['lamp-1@5']);
    assert.deepEqual(held(fromSecond.copy), ['sign-1@4']);
    assert.deepEqual(world.errors, [], 'another owner\'s messages are no error');
    await fromFirst.copy.close();
    await fromSecond.copy.close();
  }));

  it(name('a sync that names no owner goes to the family\'s only owner, and is refused with invalid-request while several serve it, never spread across them'), () => using(transport, {}, async world => {
    const first = await world.connect('bunny/core');
    const second = world.local('bunny/second');
    const consumer = await world.connect('bunny/wall');
    const served: string[] = [];
    const firstOwner = await first.serveSync([DEVICE_FAMILY], () => {
      served.push('first');
      return {revision: 1, states: [device('lamp-1', 1)]};
    });
    const only = await consumer.sync<DeviceRecord>([DEVICE_FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(only.status, 'synced', 'one owner serves it, as before');
    if (only.status !== 'synced') return;
    assert.deepEqual(held(only.copy), ['lamp-1@1']);
    await only.copy.close();

    await second.serveSync([DEVICE_FAMILY], () => {
      served.push('second');
      return {revision: 2, states: [device('sign-1', 2)]};
    });
    const changes: string[] = [];
    const shared = await consumer.sync<DeviceRecord>([DEVICE_FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, parent: PARENT});
    assert.equal(shared.status, 'rejected');
    if (shared.status !== 'rejected') return;
    assert.deepEqual(shared.error, errorBody('invalid-request', {
      requestId: shared.requestId, traceId: PARENT_TRACE, detail: 'several owners serve device; name the owner to sync from',
    }));
    await flush();
    assert.deepEqual(served, ['first'], 'neither owner received the refused request');
    assert.deepEqual(changes, [], 'no sync.completed follows the refusal');
    assert.deepEqual(decisions(world, shared.requestId), ['sync.refused info invalid-request'], 'the bus recorded the refusal once');

    await firstOwner.close();
    const remaining = await consumer.sync<DeviceRecord>([DEVICE_FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(remaining.status, 'synced', 'once one owner is left, a sync that names none goes to it');
    if (remaining.status !== 'synced') return;
    assert.deepEqual(held(remaining.copy), ['sign-1@2']);
    await remaining.copy.close();
  }));

  it(name('a sync naming an owner that does not serve the family is refused as unavailable'), () => using(transport, {}, async world => {
    const first = await world.connect('bunny/core');
    const second = world.local('bunny/second');
    const consumer = await world.connect('bunny/wall');
    let served = 0;
    await first.serveSync([DEVICE_FAMILY], () => {
      served += 1;
      return {revision: 1, states: [device('lamp-1', 1)]};
    });
    await second.serveSync([SESSION_FAMILY], () => {
      served += 1;
      return {revision: 1, states: [session('s1', 1)]};
    });
    // bunny/second serves another family; bunny/rogue is not connected at all.
    const cases: [string, readonly string[], string][] = [
      ['bunny/second', [DEVICE_FAMILY], 'no owner serves device as bunny/second'],
      ['bunny/rogue', [DEVICE_FAMILY], 'no owner serves device as bunny/rogue'],
      ['bunny/core', [DEVICE_FAMILY, SESSION_FAMILY], 'no owner serves test-session as bunny/core'],
    ];
    for (const [owner, families, detail] of cases) {
      const result = await consumer.sync(families, () => {}, {timeoutMs: 5000, owner, parent: PARENT});
      assert.equal(result.status, 'rejected', owner);
      if (result.status !== 'rejected') return;
      assert.deepEqual(result.error, errorBody('unavailable', {requestId: result.requestId, traceId: PARENT_TRACE, detail}), owner);
      assert.deepEqual(decisions(world, result.requestId), ['sync.refused warn unavailable'], owner);
    }
    assert.equal(served, 0, 'no owner received a request it was not named for');
  }));

  it(name('an owner serves each family once, and another owner may serve a shared family'), () => using(transport, {}, async world => {
    const first = await world.connect('bunny/core');
    await first.serveSync([DEVICE_FAMILY, SESSION_FAMILY], empty);
    await assert.rejects(first.serveSync([DEVICE_FAMILY], empty), (error: unknown) =>
      refused('invalid-state')(error) && (error as SdkError).body.error.detail === 'bunny/core already serves device');
    await assert.rejects(world.local('bunny/core').serveSync(['mode', SESSION_FAMILY], empty), refused('invalid-state'), 'the same source, on another participant');
    const second = await world.connect('bunny/second');
    await second.serveSync([DEVICE_FAMILY], empty);
    await world.local('bunny/rogue').serveSync([DEVICE_FAMILY], empty);
    const consumer = await world.connect('bunny/wall');
    for (const owner of ['bunny/core', 'bunny/second', 'bunny/rogue']) {
      const result = await consumer.sync([DEVICE_FAMILY], () => {}, {timeoutMs: 5000, owner});
      assert.equal(result.status, 'synced', owner);
      if (result.status === 'synced') await result.copy.close();
    }
    // One answer has one revision, so one sync still covers the families of one serveSync.
    await first.serveSync(['mode'], empty);
    const split = await consumer.sync([DEVICE_FAMILY, 'mode'], () => {}, {timeoutMs: 5000, owner: 'bunny/core'});
    assert.deepEqual(split.status === 'rejected' && [split.error.error.code, split.error.error.detail], ['invalid-request', 'one sync covers one owner\'s families']);
  }));

  it(name('a family that is not shared keeps one owner: another source that serves it is refused with invalid-state, as before'), () => using(transport, {}, async world => {
    const core = await world.connect('bunny/core');
    await core.serveSync([SESSION_FAMILY, DEVICE_FAMILY], () => ({revision: 1, states: [session('s1', 1)]}));
    // A faulty or misconfigured participant that serves the core's family beside it is refused itself, so every consumer
    // that syncs the family without naming an owner still reaches the core.
    const faulty = await world.connect('bunny/second');
    for (const families of [[SESSION_FAMILY], ['mode', SESSION_FAMILY]]) {
      await assert.rejects(faulty.serveSync(families, empty), (error: unknown) =>
        refused('invalid-state')(error) && (error as SdkError).body.error.detail === 'bunny/core already serves test-session', JSON.stringify(families));
    }
    await faulty.serveSync(['mode', DEVICE_FAMILY], empty);
    const consumer = await world.connect('bunny/wall');
    const sessions = await consumer.sync([SESSION_FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(sessions.status, 'synced', 'a sync of the core\'s family that names no owner still reaches the core');
    if (sessions.status === 'synced') {
      assert.equal(sessions.message.source, 'bunny/core');
      await sessions.copy.close();
    }
  }));

  it(name('a copy that names no owner follows only the owner that served it, after a second owner starts serving the family'), () => using(transport, {}, async world => {
    const first = await world.connect('bunny/core');
    const second = world.local('bunny/second');
    const consumer = await world.connect('bunny/wall');
    await first.serveSync([DEVICE_FAMILY], () => ({revision: 5, states: [device('lamp-1', 5)]}));
    const changes: string[] = [];
    const result = await consumer.sync<DeviceRecord>([DEVICE_FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000});
    assert.equal(result.status, 'synced');
    if (result.status !== 'synced') return;
    // A second owner starts serving device and publishes its own devices, one below the first owner's sync revision and
    // one above it, and a removal of the first owner's lamp-1. None of it is the first owner's.
    await second.serveSync([DEVICE_FAMILY], () => ({revision: 7, states: [device('sign-2', 7)]}));
    await second.publish('bunny.state.device.sign-2', device('sign-2', 3));
    await second.publish('bunny.state.device.sign-2', device('sign-2', 7));
    await second.publish('bunny.state.device.lamp-1', deviceRemoved('lamp-1', 9));
    await first.publish('bunny.state.device.lamp-1', device('lamp-1', 6, 'available'));
    await until(() => changes.includes('updated lamp-1@6'), 'the first owner\'s update');
    await flush();
    assert.deepEqual(changes, ['updated lamp-1@5', 'synced @5', 'updated lamp-1@6']);
    assert.deepEqual(held(result.copy), ['lamp-1@6']);
    assert.deepEqual(world.errors, [], 'another owner\'s messages are no error');
    await result.copy.close();
  }));

  it(name('a malformed owner is refused with invalid-request before any request is sent'), () => using(transport, {}, async world => {
    let served = 0;
    await world.local('bunny/core').serveSync([DEVICE_FAMILY], () => {
      served += 1;
      return empty();
    });
    const consumer = await world.connect('bunny/wall');
    const malformed: unknown[] = ['', 'bunny', 'bunny/', 'Bunny/core', 'bunny/core/', 'bunny/a b', `bunny/${'a'.repeat(256)}`, 42, null];
    for (const owner of malformed) {
      await assert.rejects(consumer.sync([DEVICE_FAMILY], () => {}, {timeoutMs: 5000, owner: owner as string}), refused('invalid-request'), JSON.stringify(owner));
    }
    assert.equal(served, 0);
  }));
}

suite(inProcess);
suite(remote);

it('a copy that names its owner asks that owner on every request, and a copy that names none sends no owner', async () => {
  const outgoing: OutgoingSync[] = [];
  const overflows: (() => void)[] = [];
  // The fake answers as the owner the request names, or as the core.
  const answer = (request: OutgoingSync, revision: number): SyncAnswer => {
    const completed = buildMessage(request.owner ?? 'bunny/core', 'sync-completed', {
      type: 'org.bunny.sync.completed', subject: DEVICE_FAMILY, dataschema: 'https://bunny.invalid/events/sync-completed/2.0',
      data: {requestId: request.requestId, revision, members: []},
    }, PARENT, Date.now());
    return {status: 'served', requestId: request.requestId, states: [], completed};
  };
  const transport: SyncTransport = {
    now: () => Date.now(),
    subscribe: (_pattern, _handler, {onOverflow}) => {
      overflows.push(() => { void onOverflow?.({dropped: 1}); });
      return Promise.resolve({close: () => Promise.resolve()});
    },
    request: request => {
      outgoing.push(request);
      return Promise.resolve(answer(request, outgoing.length));
    },
    report: () => {},
  };
  const named = await startSync(transport, [DEVICE_FAMILY], () => {}, {timeoutMs: 5000, owner: 'bunny/modules/lifx'});
  assert.equal(named.status, 'synced');
  // An overflow restarts the sync; the next request goes to the same owner.
  overflows[0]?.();
  await until(() => outgoing.length === 2, 'the second request');
  assert.deepEqual(outgoing.map(request => request.owner), ['bunny/modules/lifx', 'bunny/modules/lifx']);
  if (named.status === 'synced') await named.copy.close();

  const unnamed = await startSync(transport, [DEVICE_FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(unnamed.status, 'synced');
  assert.equal(Object.hasOwn(outgoing[2] ?? {}, 'owner'), false, 'a request for the only owner carries no owner, as before');
  if (unnamed.status === 'synced') await unnamed.copy.close();
});

it('the bus names the families each source serves, for as long as it serves them', async () => {
  const {bus: created, core, wall} = bus();
  assert.deepEqual(created.served('bunny/core'), []);
  const sessions = await core.serveSync([SESSION_FAMILY], empty);
  await core.serveSync([DEVICE_FAMILY, 'mode'], empty);
  await wall.serveSync([DEVICE_FAMILY], empty);
  assert.deepEqual([created.served('bunny/core'), created.served('bunny/wall'), created.served('bunny/rogue')], [[SESSION_FAMILY, DEVICE_FAMILY, 'mode'], [DEVICE_FAMILY], []]);
  await sessions.close();
  assert.deepEqual(created.served('bunny/core'), [DEVICE_FAMILY, 'mode']);
  await core.close();
  assert.deepEqual(created.served('bunny/core'), []);
});

it('a copy that names no owner drops another owner\'s messages that waited in its buffer during its first sync', async () => {
  const {bus: created, core, wall} = bus();
  const second = checked(created.connect('bunny/second'));
  const gate = deferred<Snapshot>();
  await core.serveSync([DEVICE_FAMILY], () => gate.promise);
  const changes: string[] = [];
  const pending = wall.sync<DeviceRecord>([DEVICE_FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000});
  await flush();
  // The request has reached its only owner; a second owner starts serving and publishing while the answer is on its way.
  await second.serveSync([DEVICE_FAMILY], () => ({revision: 9, states: [device('sign-1', 9)]}));
  await second.publish('bunny.state.device.sign-1', device('sign-1', 9));
  await core.publish('bunny.state.device.lamp-1', device('lamp-1', 8));
  gate.resolve({revision: 7, states: [device('lamp-1', 7)]});
  const result = await pending;
  assert.equal(result.status, 'synced');
  if (result.status !== 'synced') return;
  assert.deepEqual(changes, ['updated lamp-1@7', 'synced @7', 'updated lamp-1@8']);
  assert.deepEqual(held(result.copy), ['lamp-1@8']);
  await result.copy.close();
});

it('a named copy takes no answer from another owner: a first sync is refused as unavailable, and a later one fails the copy', async () => {
  const outgoing: OutgoingSync[] = [];
  const overflows: (() => void)[] = [];
  // The owner that answers each request, as a transport that ignored the owner would let another owner answer.
  const answering: string[] = [];
  const answer = (request: OutgoingSync, source: string, revision: number): SyncAnswer => {
    const completed = buildMessage(source, 'sync-completed', {
      type: 'org.bunny.sync.completed', subject: DEVICE_FAMILY, dataschema: 'https://bunny.invalid/events/sync-completed/2.0',
      data: {requestId: request.requestId, revision, members: []},
    }, request.trace, Date.now());
    return {status: 'served', requestId: request.requestId, states: [], completed};
  };
  const transport: SyncTransport = {
    now: () => Date.now(),
    subscribe: (_pattern, _handler, {onOverflow}) => {
      overflows.push(() => { void onOverflow?.({dropped: 1}); });
      return Promise.resolve({close: () => Promise.resolve()});
    },
    request: request => {
      outgoing.push(request);
      return Promise.resolve(answer(request, answering.shift() ?? 'bunny/modules/lifx', outgoing.length));
    },
    report: () => {},
  };
  const changes: string[] = [];
  answering.push('bunny/modules/nanoleaf');
  const skewed = await startSync<DeviceRecord>(transport, [DEVICE_FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, owner: 'bunny/modules/lifx', parent: PARENT});
  assert.equal(skewed.status, 'rejected');
  if (skewed.status !== 'rejected') return;
  assert.deepEqual(skewed.error, errorBody('unavailable', {
    requestId: skewed.requestId, traceId: PARENT_TRACE, detail: 'the answer came from bunny/modules/nanoleaf, not the named owner bunny/modules/lifx',
  }));
  assert.equal(changes.length, 0, 'the handler heard nothing');

  const later = await startSync<DeviceRecord>(transport, [DEVICE_FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, owner: 'bunny/modules/lifx'});
  assert.equal(later.status, 'synced');
  answering.push('bunny/modules/nanoleaf');
  overflows.at(-1)?.();
  await until(() => changes.includes('failed unavailable'), 'the failed copy');
  assert.deepEqual(changes, ['synced @2', 'failed unavailable']);
});

it('another owner\'s messages on a shared family never enter a named copy\'s buffer, so they cannot overflow it', async () => {
  const restarts: ErrorScope[] = [];
  const {bus: created, core, wall} = bus({onSyncRestart: scope => { restarts.push(scope); }});
  const second = checked(created.connect('bunny/second'));
  const gate = deferred<Snapshot>();
  let served = 0;
  await core.serveSync([DEVICE_FAMILY], () => {
    served += 1;
    return gate.promise;
  });
  await second.serveSync([DEVICE_FAMILY], () => ({revision: 1, states: [device('sign-1', 1)]}));
  const changes: string[] = [];
  const pending = wall.sync<DeviceRecord>([DEVICE_FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, owner: 'bunny/core', maxBuffered: 2});
  await flush();
  // While the first owner's answer is on its way, the second owner publishes more messages than the buffer holds.
  for (let revision = 2; revision <= 6; revision += 1) await second.publish('bunny.state.device.sign-1', device('sign-1', revision));
  await core.publish('bunny.state.device.lamp-1', device('lamp-1', 3));
  await flush();
  gate.resolve({revision: 2, states: [device('lamp-1', 2)]});
  const result = await pending;
  assert.equal(result.status, 'synced');
  assert.deepEqual(changes, ['updated lamp-1@2', 'synced @2', 'updated lamp-1@3']);
  assert.deepEqual(restarts, [], 'the copy never restarted its sync');
  assert.equal(served, 1, 'the owner received one request');
  if (result.status === 'synced') await result.copy.close();
});

it('the edge refuses a sync call whose owner is not a participant source, and passes a named owner to its bus', async () => {
  const edge = await startEdge();
  try {
    await edge.bus.connect('bunny/core').serveSync([DEVICE_FAMILY], () => ({revision: 1, states: [device('lamp-1', 1)]}));
    await edge.bus.connect('bunny/second').serveSync([DEVICE_FAMILY], () => ({revision: 2, states: [device('sign-1', 2)]}));
    const token = edge.tokens.get('bunny/wall') ?? '';
    const post = async (body: Record<string, unknown>): Promise<{status: number; body: unknown}> => {
      const sentAtMs = Date.now();
      const request: Message = buildMessage('bunny/wall', 'sync-request', {
        type: 'org.bunny.sync.requested', subject: DEVICE_FAMILY, dataschema: 'https://bunny.invalid/events/sync-request/2.0',
        data: {requestId: `raw-${String(sentAtMs)}`, families: [DEVICE_FAMILY]},
      }, PARENT, sentAtMs, sentAtMs + 5000);
      const response = await fetch(`${edge.url}${REMOTE_PATH}/sync`, {
        method: 'POST', body: JSON.stringify({schema: REMOTE_SCHEMA, request, ...body}),
        headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
      });
      return {status: response.status, body: await response.json() as unknown};
    };
    for (const owner of ['Bunny!', 42, null, '']) {
      const raw = await post({owner});
      assert.deepEqual(raw, {status: 400, body: errorBody('invalid-request', {detail: 'owner is not a participant source'})}, JSON.stringify(owner));
    }
    const refusals = edge.diagnostics.filter(record => record.event === 'edge.refused');
    assert.deepEqual(refusals[0], {event: 'edge.refused', level: 'info', route: 'sync', code: 'invalid-request', source: 'bunny/wall'});
    const named = await post({owner: 'bunny/second'});
    assert.equal(named.status, 200);
    const answer = (named.body as {answer: {status: string; states: Message<DeviceRecord>[]}}).answer;
    assert.deepEqual([answer.status, answer.states.map(state => `${state.source} ${state.data.id}`)], ['served', ['bunny/second sign-1']]);
    const unnamed = await post({});
    assert.equal((unnamed.body as {answer: {status: string; error: {error: {code: string}}}}).answer.error.error.code, 'invalid-request');
  } finally {
    await edge.close();
  }
});
