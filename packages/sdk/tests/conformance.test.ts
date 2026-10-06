// One conformance suite for every transport (Hub #883, ADR 0012 "Portability"): the same SDK calls behave the same
// in process and over SSE and HTTP. Where a transport must answer differently, the transport names its expectation.
import assert from 'node:assert/strict';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {MAX_TIMEOUT_MS, SdkError, type Command, type Overflow, type Reply, type Snapshot, type SyncChange, type SyncRequest} from '../src/index.js';
import {SESSION_FAMILY, blob, deferred, flush, it, session, setMode, trace, turnEnded, until, type Mode, type Session} from './support.js';
import {inProcess, remote, using, type Transport} from './transports.js';

const FAMILY = SESSION_FAMILY;
const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const codeOf = (result: {status: string; error?: {error: {code: string}}}): string => result.error?.error.code ?? result.status;

function show(change: SyncChange<Session>): string {
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

function suite(transport: Transport): void {
  const name = (text: string): string => `${transport.name}: ${text}`;

  it(name('a subscriber receives the messages its pattern matches, exactly as they were published'), () => using(transport, {}, async world => {
    const sender = await world.connect('bunny/core');
    const receiver = await world.connect('bunny/wall');
    const sessions: Message[] = [];
    const s1: Message[] = [];
    await receiver.subscribe(`bunny.state.${FAMILY}.*`, message => { sessions.push(message); });
    await receiver.subscribe(`bunny.*.${FAMILY}.s1`, message => { s1.push(message); });
    const first = await sender.publish(`bunny.state.${FAMILY}.s1`, session('s1', 1));
    const second = await sender.publish(`bunny.state.${FAMILY}.s2`, session('s2', 1));
    const ended = await sender.publish(`bunny.event.${FAMILY}.s1`, turnEnded('s1'));
    await until(() => sessions.length === 2 && s1.length === 2, 'both subscriptions');
    assert.deepEqual(sessions, [first, second], 'the same id, time and trace as the sender built');
    assert.deepEqual(s1, [first, ended]);
    assert.equal(first.source, 'bunny/core');
  }));

  it(name('a prepared message is published unchanged, and only by its own source'), () => using(transport, {}, async world => {
    const sender = await world.connect('bunny/core');
    const seen: Message[] = [];
    await world.local('bunny/wall').subscribe(`bunny.state.${FAMILY}.*`, message => { seen.push(message); });
    const stored = await sender.publish(`bunny.state.${FAMILY}.s1`, session('s1', 1));
    // An outbox sends the message it stored again, after a restart.
    const again = await sender.publishMessage(`bunny.state.${FAMILY}.s1`, stored);
    await until(() => seen.length === 2, 'both copies');
    assert.deepEqual(again, stored);
    assert.deepEqual(seen[1], stored, 'the same id and time');
    const other = await world.connect('bunny/wall');
    await assert.rejects(other.publishMessage(`bunny.state.${FAMILY}.s1`, stored), refused('forbidden'));
  }));

  it(name('subscribe resolves once the subscription is live, so a message published right after it arrives'), () => using(transport, {}, async world => {
    const receiver = await world.connect('bunny/wall');
    const sender = world.local('bunny/core');
    for (let round = 0; round < 5; round += 1) {
      const seen: Message[] = [];
      const subscription = await receiver.subscribe(`bunny.state.${FAMILY}.s${round}`, message => { seen.push(message); });
      await sender.publish(`bunny.state.${FAMILY}.s${round}`, session(`s${round}`, 1));
      await until(() => seen.length === 1, `round ${round}`);
      await subscription.close();
    }
  }));

  it(name('a request reaches its responder once and is accepted, or refused in the error body on the caller\'s trace'), () => using(transport, {}, async world => {
    const requester = await world.connect('bunny/core');
    const responder = await world.connect('bunny/wall');
    const commands: Command<Mode>[] = [];
    await responder.respond<Mode>('bunny.cmd.mode.*', command => {
      commands.push(command);
      return command.data.mode === 'free' ? errorBody('invalid-state', {detail: 'the wall is off'}) : {status: 'accepted'};
    });
    const accepted = await requester.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 5000, requestId: 'req-1'});
    assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') return;
    assert.equal(accepted.reply.source, 'bunny/wall');
    assert.deepEqual(accepted.reply.data, {requestId: 'req-1', status: 'accepted'});
    const [command] = commands;
    assert.ok(command);
    assert.equal(command.source, 'bunny/core');
    assert.equal(command.data.requestId, 'req-1');
    assert.equal(Date.parse(command.expiresat ?? '') - Date.parse(command.time), 5000);

    const rejected = await requester.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 5000, requestId: 'req-2', parent: PARENT});
    assert.equal(rejected.status, 'rejected');
    if (rejected.status !== 'rejected' || rejected.reply === undefined) return assert.fail('a refusal comes in a reply');
    assert.equal(trace(rejected.reply.traceparent).traceId, PARENT_TRACE);
    assert.deepEqual(rejected.error, errorBody('invalid-state', {detail: 'the wall is off', requestId: 'req-2', traceId: PARENT_TRACE}));
    assert.equal(trace(commands[1]?.traceparent ?? '').traceId, PARENT_TRACE);
    assert.equal(commands.length, 2, 'each command reached the responder once');
  }));

  it(name('a request nobody responds to is refused as unavailable'), () => using(transport, {}, async world => {
    const requester = await world.connect('bunny/core');
    const result = await requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
    assert.equal(codeOf(result), 'unavailable');
    assert.equal(result.status === 'rejected' && result.error.error.retryable, true);
  }));

  it(name('a command its handler holds at the deadline is uncertain-result'), () => using(transport, {}, async world => {
    const requester = await world.connect('bunny/core');
    const responder = await world.connect('bunny/wall');
    const answer = deferred<Reply>();
    await responder.respond('bunny.cmd.mode.*', () => answer.promise);
    const result = await requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 300, requestId: 'req-held'});
    // The handler finishes before the checks, so a failed check cannot leave it waiting at close.
    answer.resolve({status: 'accepted'});
    assert.equal(result.status, 'uncertain');
    assert.equal(codeOf(result), 'uncertain-result');
    assert.equal(result.error?.error.requestId, 'req-held');
  }));

  it(name('a command still waiting at its deadline is expired, and never reaches the handler'), () => using(transport, {}, async world => {
    const requester = await world.connect('bunny/core');
    const responder = await world.connect('bunny/wall');
    const busy = deferred<Reply>();
    const handled: string[] = [];
    await responder.respond<Mode>('bunny.cmd.mode.*', command => {
      handled.push(command.data.mode);
      return command.data.mode === 'work' ? busy.promise : {status: 'accepted'};
    });
    const first = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 10_000});
    let late;
    try {
      await until(() => handled.length === 1, 'the first command');
      late = await requester.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 300});
    } finally {
      // Released before any check, so a failed check cannot leave the handler waiting at close.
      busy.resolve({status: 'accepted'});
    }
    // The command never reached the handler, so it is expired on every transport, as ADR 0012 says.
    assert.equal(codeOf(late), 'expired');
    assert.equal((await first).status, 'accepted');
    assert.equal((await requester.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 5000})).status, 'accepted');
    assert.deepEqual(handled, ['work', 'free'], 'the expired command was ignored');
  }));

  it(name('a consumer syncs the owner\'s current state at a revision, then follows live messages'), () => using(transport, {}, async world => {
    const owner = await world.connect('bunny/core');
    const consumer = await world.connect('bunny/wall');
    await owner.serveSync([FAMILY], () => ({revision: 2, states: [session('s1', 1), session('s2', 2)]}));
    const changes: string[] = [];
    const result = await consumer.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000, parent: PARENT});
    assert.equal(result.status, 'synced');
    if (result.status !== 'synced') return;
    assert.deepEqual(changes, ['updated s1@1', 'updated s2@2', 'synced @2']);
    assert.equal(result.message.source, 'bunny/core');
    assert.equal(trace(result.message.traceparent).traceId, PARENT_TRACE);
    await owner.publish(`bunny.state.${FAMILY}.s1`, session('s1', 3));
    await until(() => changes.length === 4, 'the live update');
    assert.equal(changes[3], 'updated s1@3');
    await result.copy.close();
  }));

  it(name('an owner\'s refusal comes back in the error body, and a sync nobody answers is unavailable at its deadline'), () => using(transport, {}, async world => {
    const owner = await world.connect('bunny/core');
    const consumer = await world.connect('bunny/wall');
    const changes: string[] = [];
    const record = (change: SyncChange<Session>): void => { changes.push(show(change)); };
    const refusing = await owner.serveSync([FAMILY], () => errorBody('invalid-state', {detail: 'the store is loading'}));
    const refusal = await consumer.sync<Session>([FAMILY], record, {timeoutMs: 5000, parent: PARENT});
    assert.equal(refusal.status, 'rejected');
    if (refusal.status !== 'rejected') return;
    assert.deepEqual(refusal.error, errorBody('invalid-state', {detail: 'the store is loading', requestId: refusal.requestId, traceId: PARENT_TRACE}));
    await refusing.close();

    const never = deferred<Snapshot>();
    await owner.serveSync([FAMILY], () => never.promise);
    const late = await consumer.sync<Session>([FAMILY], record, {timeoutMs: 300});
    never.resolve({revision: 0, states: []});
    assert.equal(late.status, 'rejected');
    if (late.status !== 'rejected') return;
    assert.equal(late.error.error.code, 'unavailable');
    assert.equal(late.error.error.retryable, true);
    assert.equal(late.error.error.detail, 'no sync answer within 300 ms');
    await flush();
    assert.deepEqual(changes, [], 'no sync.completed follows a refusal, and a late answer is ignored');
  }));

  it(name('a stalled subscriber is told how many messages were dropped, before its next message'), () => using(transport, {maxQueued: 2}, async world => {
    const receiver = await world.connect('bunny/wall');
    const sender = world.local('bunny/core');
    const gate = deferred<undefined>();
    const seen: string[] = [];
    await receiver.subscribe<Session>(`bunny.state.${FAMILY}.*`, async message => {
      seen.push(`s1@${message.data.revision}`);
      if (message.data.revision === 1) await gate.promise;
    }, {onOverflow: ({dropped}: Overflow) => { seen.push(`dropped ${String(dropped)}`); }});
    try {
      await sender.publish(`bunny.state.${FAMILY}.s1`, session('s1', 1));
      await until(() => seen.length === 1, 'the first message');
      for (const revision of [2, 3, 4, 5, 6]) {
        await sender.publish(`bunny.state.${FAMILY}.s1`, session('s1', revision));
        await flush();
      }
      // Revision 1 is being handled, 2 and 3 wait, and 4, 5 and 6 find the queue full.
      await until(() => world.errors.length === 3, 'three capacity reports');
    } finally {
      gate.resolve(undefined);
    }
    for (const {error} of world.errors) assert.ok(refused('capacity')(error));
    await until(() => seen.length === 4, 'the rest');
    assert.deepEqual(seen, ['s1@1', 'dropped 3', 's1@2', 's1@3']);
  }));

  it(name('a closed participant refuses every call with invalid-state'), () => using(transport, {}, async world => {
    const participant = await world.connect('bunny/wall');
    await participant.close();
    const closed = refused('invalid-state');
    await assert.rejects(participant.subscribe(`bunny.state.${FAMILY}.*`, () => {}), closed, 'subscribe');
    await assert.rejects(participant.publish(`bunny.state.${FAMILY}.s1`, session('s1', 1)), closed, 'publish');
    await assert.rejects(participant.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000}), closed, 'request');
    await assert.rejects(participant.respond('bunny.cmd.mode.*', () => ({status: 'accepted'})), closed, 'respond');
    await assert.rejects(participant.sync([FAMILY], () => {}, {timeoutMs: 5000}), closed, 'sync');
    await assert.rejects(participant.serveSync([FAMILY], () => ({revision: 0, states: []})), closed, 'serveSync');
  }));

  it(name('closing a participant cancels its first sync and withdraws the request waiting at the owner'), () => using(transport, {}, async world => {
    const owner = await world.connect('bunny/core');
    const other = await world.connect('bunny/second');
    const consumer = await world.connect('bunny/wall');
    const gate = deferred<Snapshot>();
    const served: string[] = [];
    await owner.serveSync([FAMILY], request => {
      served.push(request.source);
      return served.length === 1 ? gate.promise : {revision: 0, states: []};
    });
    let waiting;
    try {
      const busy = other.sync([FAMILY], () => {}, {timeoutMs: 10_000});
      await until(() => served.length === 1, 'the first request');
      // The consumer's request waits behind it in the owner's queue.
      waiting = consumer.sync([FAMILY], () => {}, {timeoutMs: 10_000});
      await world.arrived('sync', 2);
      await consumer.close();
      const cancelled = await waiting;
      assert.equal(cancelled.status === 'rejected' ? cancelled.error.error.code : cancelled.status, 'cancelled');
      gate.resolve({revision: 0, states: []});
      assert.equal((await busy).status, 'synced');
    } finally {
      gate.resolve({revision: 0, states: []});
    }
    // A later request from another participant shows what the owner served in between.
    assert.equal((await other.sync([FAMILY], () => {}, {timeoutMs: 10_000})).status, 'synced');
    assert.deepEqual(served, ['bunny/second', 'bunny/second'], 'the withdrawn request never reached the owner');
  }));

  it(name('malformed calls are refused with invalid-request'), () => using(transport, {}, async world => {
    const participant = await world.connect('bunny/core');
    await assert.rejects(participant.publish('bunny.state.session', session('s1', 1)), refused('invalid-request'), 'a short key');
    await assert.rejects(participant.publish(`bunny.event.${FAMILY}.s1`, session('s1', 1)), refused('invalid-request'), 'a state on an event key');
    await assert.rejects(participant.subscribe('bunny.state.ses*.s1', () => {}), refused('invalid-request'), 'a partial wildcard');
    await assert.rejects(participant.request('bunny.state.mode.wall', setMode('work'), {timeoutMs: 5000}), refused('invalid-request'), 'a state key');
    await assert.rejects(participant.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 0}), refused('invalid-request'), 'no time');
    await assert.rejects(participant.sync([], () => {}, {timeoutMs: 5000}), refused('invalid-request'), 'no family');
    // One maximum on every transport, so no deadline timer outgrows setTimeout.
    await assert.rejects(participant.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: MAX_TIMEOUT_MS + 1}), refused('invalid-request'), 'a request over the maximum');
    await assert.rejects(participant.sync([FAMILY], () => {}, {timeoutMs: MAX_TIMEOUT_MS + 1}), refused('invalid-request'), 'a sync over the maximum');
  }));

  it(name(`closing a participant settles its waiting request as ${transport.closedWhileQueued}, and the command never runs`), () => using(transport, {}, async world => {
    const requester = await world.connect('bunny/core');
    const blocker = world.local('bunny/second');
    const busy = deferred<Reply>();
    const handled: string[] = [];
    await world.local('bunny/wall').respond<Mode>('bunny.cmd.mode.*', command => {
      handled.push(command.data.mode);
      return command.data.mode === 'work' ? busy.promise : {status: 'accepted'};
    });
    const first = blocker.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 10_000});
    try {
      await until(() => handled.length === 1, 'the first command');
      const waiting = requester.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 10_000});
      // The requester's command now waits in the responder's queue.
      await world.arrived('request', 1);
      const closing = requester.close();
      assert.equal(requester.close(), closing, 'closing again returns the same promise');
      await closing;
      const result = await waiting;
      assert.equal(codeOf(result), transport.closedWhileQueued);
    } finally {
      busy.resolve({status: 'accepted'});
    }
    assert.equal((await first).status, 'accepted');
    assert.equal((await blocker.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 5000})).status, 'accepted');
    assert.deepEqual(handled, ['work', 'free'], 'the withdrawn command never ran');
  }));

  it(name('a sync request and its sync.completed name the requested families, joined by commas'), () => using(transport, {}, async world => {
    const owner = await world.connect('bunny/core');
    const consumer = await world.connect('bunny/wall');
    const requests: Message<SyncRequest>[] = [];
    await owner.serveSync([FAMILY, 'test-blob'], request => {
      requests.push(request);
      return {revision: 1, states: [session('s1', 1), blob('b1', 1, 10)]};
    });
    const result = await consumer.sync([FAMILY, 'test-blob'], () => {}, {timeoutMs: 5000});
    assert.equal(result.status, 'synced');
    if (result.status !== 'synced') return;
    assert.equal(requests[0]?.subject, `${FAMILY},test-blob`);
    assert.equal(result.message.subject, `${FAMILY},test-blob`);
  }));
}

suite(inProcess);
suite(remote);
