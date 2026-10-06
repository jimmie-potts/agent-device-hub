// Participant close: one call closes everything a participant opened, so a stopped module leaves nothing behind.
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Reply} from '../src/index.js';
import {bus, checked, deferred, flush, it, manualClock, peek, session, setMode, settled, turnEnded, type Mode} from './support.js';

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
