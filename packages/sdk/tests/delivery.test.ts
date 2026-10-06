// Per-subscriber delivery queues: a slow consumer lags only itself and cannot block the bus (ADR 0012).
import assert from 'node:assert/strict';
import {InProcessBus, SdkError} from '../src/index.js';
import {bus, checked, deferred, flush, it, peek, session, setMode, settled} from './support.js';

it('a slow subscriber delays only itself, and catches up in order', async () => {
  const {core, wall} = bus();
  const gate = deferred<undefined>();
  const slow: number[] = [];
  const fast: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.*', async message => { slow.push(message.data.revision); await gate.promise; });
  await core.subscribe<{revision: number}>('bunny.state.session.*', message => { fast.push(message.data.revision); });
  await wall.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));

  const sent = Promise.all([1, 2, 3, 4, 5].map(revision => core.publish('bunny.state.session.s1', session('s1', revision))));
  assert.equal(slow.length + fast.length, 0, 'publish never runs a handler inside the sender\'s call');
  assert.ok(await peek(sent), 'publishing does not wait for any subscriber');
  await flush();
  assert.deepEqual(fast, [1, 2, 3, 4, 5]);
  assert.deepEqual(slow, [1]);
  const reply = await peek(core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000}));
  assert.equal(reply?.status, 'accepted', 'requests still flow while a subscriber is stuck');

  gate.resolve(undefined);
  await flush();
  assert.deepEqual(slow, [1, 2, 3, 4, 5]);
});

it('a slow responder delays only its own commands', async () => {
  const {core, wall} = bus();
  const gate = deferred<{status: 'accepted'}>();
  const received: number[] = [];
  await wall.respond('bunny.cmd.mode.*', () => gate.promise);
  await wall.subscribe<{revision: number}>('bunny.state.session.*', message => { received.push(message.data.revision); });
  const pending = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await flush();
  assert.deepEqual(received, [1]);
  assert.equal(await peek(pending), undefined);
  gate.resolve({status: 'accepted'});
  assert.equal((await peek(pending))?.status, 'accepted');
});

it('a full queue drops messages for that subscriber only and reports capacity', async () => {
  const {core, wall, errors} = bus({maxQueued: 2});
  const gate = deferred<undefined>();
  const slow: number[] = [];
  const fast: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.*', async message => { slow.push(message.data.revision); await gate.promise; });
  await core.subscribe<{revision: number}>('bunny.state.session.*', message => { fast.push(message.data.revision); });
  for (const revision of [1, 2, 3, 4, 5]) {
    await core.publish('bunny.state.session.s1', session('s1', revision));
    await flush();
  }
  // Revision 1 is being handled, 2 and 3 wait, and 4 and 5 find the queue full.
  assert.deepEqual(fast, [1, 2, 3, 4, 5]);
  assert.equal(errors.length, 2);
  for (const {error, scope} of errors) {
    assert.ok(error instanceof SdkError);
    assert.equal(error.body.error.code, 'capacity');
    assert.deepEqual(scope, {source: 'bunny/wall', pattern: 'bunny.state.session.*'});
  }
  gate.resolve(undefined);
  await flush();
  assert.deepEqual(slow, [1, 2, 3]);
});

it('a subscriber that throws is reported and keeps receiving', async () => {
  const {core, wall, errors} = bus();
  const received: number[] = [];
  await wall.subscribe<{revision: number}>('bunny.state.session.*', message => {
    received.push(message.data.revision);
    if (message.data.revision === 1) throw new Error('bad revision');
  });
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await core.publish('bunny.state.session.s1', session('s1', 2));
  await flush();
  assert.deepEqual(received, [1, 2]);
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0]?.scope, {source: 'bunny/wall', pattern: 'bunny.state.session.*'});
});

it('closing a subscription waits for its running handler and drops what is queued', async () => {
  const {core, wall} = bus();
  const gate = deferred<undefined>();
  const handled: number[] = [];
  const subscription = await wall.subscribe<{revision: number}>('bunny.state.session.*', async message => {
    await gate.promise;
    handled.push(message.data.revision);
  });
  await core.publish('bunny.state.session.s1', session('s1', 1));
  await core.publish('bunny.state.session.s1', session('s1', 2));
  await flush();
  const closed = subscription.close();
  assert.equal(await settled(closed), false, 'revision 1 is still being handled');
  gate.resolve(undefined);
  await closed;
  await flush();
  assert.deepEqual(handled, [1]);
});

it('without an error handler, a handler error becomes a process warning naming its source and pattern', async () => {
  const created = new InProcessBus();
  const core = checked(created.connect('bunny/core'));
  const failure = new Error('bad handler');
  const warned = new Promise<Error>(resolve => { process.once('warning', resolve); });
  await core.subscribe('bunny.state.session.*', () => { throw failure; });
  await core.publish('bunny.state.session.s1', session('s1', 1));
  const warning = await warned;
  assert.equal(warning.name, 'BunnySdkWarning');
  assert.equal(warning.message, 'bunny/core on bunny.state.session.*: bad handler');
  assert.equal(warning.cause, failure);
});

it('a handler that closes its own subscription finishes, and nothing more reaches it', async () => {
  const {core, wall} = bus();
  const started: number[] = [];
  const finished: number[] = [];
  const subscription = await wall.subscribe<{revision: number}>('bunny.state.session.*', async message => {
    started.push(message.data.revision);
    await subscription.close();
    finished.push(message.data.revision);
  });
  await Promise.all([1, 2].map(revision => core.publish('bunny.state.session.s1', session('s1', revision))));
  await flush();
  assert.deepEqual(started, [1]);
  assert.deepEqual(finished, [1], 'close resolves inside the handler that called it');
  await core.publish('bunny.state.session.s1', session('s1', 3));
  await flush();
  assert.deepEqual(started, [1]);
});
