// Participant close: one call closes everything a participant opened, so a stopped module leaves nothing behind.
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Reply, type Snapshot, type SyncResult} from '../src/index.js';
import {
  SESSION_FAMILY, bus, checked, deferred, flush, it, manualClock, peek, session, setMode, settled, turnEnded, type Mode, type Session,
} from './support.js';

const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};
const timers = (): number => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;

it('closing a participant closes its subscriptions and responders', async () => {
  const {bus: created, core, wall} = bus();
  const seen: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.*', message => { seen.push(message.data.revision); });
  await wall.subscribe('bunny.event.session.*', () => { seen.push(0); });
  await wall.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await flush();

  await wall.close();
  await core.publish('bunny.state.session.s1', session('s1', 2));
  await core.publish('bunny.event.session.s1', turnEnded('s1'));
  await flush();
  assert.deepEqual(seen, [1], 'no subscription of the closed participant receives anything');
  const orphaned = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
  assert.equal(orphaned.status, 'rejected');
  assert.equal(orphaned.error.error.code, 'unavailable', 'its responder is gone');

  const next = checked(created.connect('bunny/wall'));
  await next.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
  assert.equal((await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000})).status, 'accepted', 'its keys are free again');
});

it('closing a participant settles its pending requests and clears their deadlines', async () => {
  const clock = manualClock();
  const {core, wall} = bus({now: clock.now, scheduler: clock.scheduler});
  const handled: string[] = [];
  const busy = deferred<Reply>();
  await wall.respond<Mode>('bunny.cmd.mode.*', command => { handled.push(command.data.mode); return busy.promise; });
  const handling = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 1000, requestId: 'req-handling', parent: PARENT});
  const queued = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 1000, requestId: 'req-queued', parent: PARENT});
  await flush();
  assert.equal(clock.pending(), 2);

  await core.close();
  assert.deepEqual(await peek(queued), {
    status: 'rejected', requestId: 'req-queued',
    error: errorBody('cancelled', {requestId: 'req-queued', traceId: PARENT_TRACE, detail: 'the requester closed'}),
  });
  assert.deepEqual(await peek(handling), {
    status: 'uncertain', requestId: 'req-handling',
    error: errorBody('uncertain-result', {requestId: 'req-handling', traceId: PARENT_TRACE, detail: 'the requester closed before the reply'}),
  });
  assert.equal(clock.pending(), 0, 'no deadline is left behind');
  busy.resolve({status: 'accepted'});
  await flush();
  assert.deepEqual(handled, ['work'], 'the cancelled command was removed before it reached the responder');
});

it('closing a participant leaves no timer that keeps the process alive', async () => {
  const {core, wall} = bus();
  await wall.respond('bunny.cmd.mode.*', () => deferred<Reply>().promise);
  const before = timers();
  const pending = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
  await flush();
  assert.equal(timers(), before + 1);
  await core.close();
  assert.equal(timers(), before);
  assert.equal((await peek(pending))?.status, 'uncertain');
});

it('a closed participant refuses later calls with invalid-state, and closing again is harmless', async () => {
  const {core} = bus();
  await core.close();
  await assert.rejects(core.publish('bunny.state.session.s1', session('s1', 1)), refused('invalid-state'), 'publish');
  await assert.rejects(core.subscribe('bunny.state.session.*', () => {}), refused('invalid-state'), 'subscribe');
  await assert.rejects(core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000}), refused('invalid-state'), 'request');
  await assert.rejects(core.respond('bunny.cmd.mode.*', () => ({status: 'accepted'})), refused('invalid-state'), 'respond');
  await core.close();
});

it('closing a participant waits for its own running handler', async () => {
  const {core, wall} = bus();
  const gate = deferred<undefined>();
  const handled: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.*', async message => { await gate.promise; handled.push(message.data.revision); });
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await core.publish('bunny.state.session.s1', session('s1', 2));
  await flush();
  const closing = wall.close();
  assert.equal(await settled(closing), false, 'revision 1 is still being handled');
  gate.resolve(undefined);
  await closing;
  await flush();
  assert.deepEqual(handled, [1], 'the queued revision is dropped');
});

it('closing a participant never waits for another participant\'s handler', async () => {
  const {core, wall} = bus();
  const stuck = deferred<Reply>();
  await wall.respond('bunny.cmd.mode.*', () => stuck.promise);
  const results: string[] = [];
  await core.subscribe('bunny.state.session.*', async message => {
    const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000, parent: message});
    results.push(result.status);
  });
  await wall.publish('bunny.state.session.s1', session('s1', 1));
  await flush();
  const closing = core.close();
  assert.equal(await settled(closing), true, 'the close resolves while the wall\'s responder is still stuck');
  assert.deepEqual(results, ['uncertain'], 'the core\'s handler finished with its abandoned request');
  stuck.resolve({status: 'accepted'});
});

it('a handler that closes its own participant finishes, and nothing more reaches it', async () => {
  const {core, wall} = bus();
  const started: number[] = [];
  const finished: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.*', async message => {
    started.push(message.data.revision);
    await wall.close();
    finished.push(message.data.revision);
  });
  await Promise.all([1, 2].map(revision => core.publish('bunny.state.session.s1', session('s1', revision))));
  await flush();
  assert.deepEqual(started, [1]);
  assert.deepEqual(finished, [1], 'the close resolves inside the handler that called it');
});

const outcome = (result: SyncResult<object> | undefined): string | undefined => result?.status === 'rejected' ? result.error.error.code : result?.status;

it('closing a participant closes its sync copies and withdraws its sync requests, leaving no deadline behind', async () => {
  const clock = manualClock();
  const {core, wall} = bus({now: clock.now, scheduler: clock.scheduler});
  const gate = deferred<Snapshot>();
  const served: string[] = [];
  await core.serveSync([SESSION_FAMILY], request => {
    served.push(request.data.requestId);
    return served.length === 1 ? {revision: 1, states: [session('s1', 1)]} : gate.promise;
  });
  const changes: string[] = [];
  const first = await wall.sync<Session>([SESSION_FAMILY], change => { changes.push(change.type); }, {timeoutMs: 1000});
  assert.equal(first.status, 'synced');
  const serving = wall.sync([SESSION_FAMILY], () => {}, {timeoutMs: 1000});
  await flush();
  const waiting = wall.sync([SESSION_FAMILY], () => {}, {timeoutMs: 1000});
  await flush();
  assert.equal(clock.pending(), 2, 'both sync deadlines wait on the injected scheduler');

  await wall.close();
  assert.equal(clock.pending(), 0, 'no sync deadline is left behind');
  assert.equal(outcome(await peek(serving)), 'cancelled');
  assert.equal(outcome(await peek(waiting)), 'cancelled');
  await core.publish(`bunny.state.${SESSION_FAMILY}.s1`, session('s1', 2));
  await flush();
  assert.deepEqual(changes, ['updated', 'synced'], 'the closed copy follows nothing more');
  gate.resolve({revision: 2, states: []});
  await flush();
  assert.equal(served.length, 2, 'the withdrawn waiting request never reached the owner');
});

it('closing a participant closes the sync owners it serves, refusing their waiting requests, and frees their families', async () => {
  const {bus: created, core, wall} = bus({maxQueued: 1});
  const gate = deferred<Snapshot>();
  await core.serveSync([SESSION_FAMILY], () => gate.promise);
  const busy = wall.sync([SESSION_FAMILY], () => {}, {timeoutMs: 5000});
  await flush();
  const waiting = wall.sync([SESSION_FAMILY], () => {}, {timeoutMs: 5000});
  await flush();
  const closing = core.close();
  const refusedOnClose = await peek(waiting);
  assert.equal(outcome(refusedOnClose), 'unavailable');
  assert.equal(refusedOnClose?.status === 'rejected' ? refusedOnClose.error.error.detail : undefined, 'the owner closed');
  gate.resolve({revision: 0, states: []});
  await closing;
  assert.equal((await busy).status, 'synced', 'the request being served still gets its answer');
  const next = checked(created.connect('bunny/next'));
  await next.serveSync([SESSION_FAMILY], () => ({revision: 0, states: []}));
  await assert.rejects(core.serveSync([SESSION_FAMILY], () => ({revision: 0, states: []})), refused('invalid-state'));
  await assert.rejects(core.sync([SESSION_FAMILY], () => {}, {timeoutMs: 1000}), refused('invalid-state'));
});

it('closing a participant while its sync still subscribes leaves no subscription behind', async () => {
  const {bus: created, wall, errors} = bus({maxQueued: 1});
  const raw = created.connect('bunny/raw');
  const families = ['fam-a', 'fam-b', 'fam-c', 'fam-d'];
  const pending = wall.sync(families, () => {}, {timeoutMs: 1000});
  await wall.close();
  assert.equal(outcome(await peek(pending)), 'cancelled');
  // A burst on every family: a subscription that outlived the close would queue one message and drop the rest.
  for (const family of families) {
    for (const revision of [1, 2, 3]) {
      void raw.publish(`bunny.state.${family}.x`, {
        kind: 'state', type: 'org.bunny.thing.updated', subject: 'x', dataschema: `https://bunny.invalid/events/${family}/2.0`, data: {id: 'x', revision},
      });
    }
  }
  await flush();
  assert.deepEqual(errors.filter(({scope}) => scope.source === 'bunny/wall').map(({scope}) => scope.pattern), [], 'nothing queues to the closed participant');
});
