// Failure isolation (ADR 0012): a module's thrown error, rejected promise or device timeout stops only that module,
// through its participant's close, and health shows it unhealthy. The other modules keep working, and a module's stop
// never waits on another module's handler.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {Worker} from 'node:worker_threads';
import {SdkError, type Reply} from '@jimmie-potts/sdk';
import {contain, type LogRecord, type Runtime} from '../src/index.js';
import {contextOf, deferred, entry, fixture, flush, it, manualClock, run, session, setMode, turnEnded, waitFor, type Fixture} from './support.js';

const WORKERS = new URL('./fixtures/', import.meta.url);
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const stateOf = (runtime: Runtime, name: string): string => entry(runtime.health(), name).state;
const failed = (runtime: Runtime, name: string): Promise<void> => waitFor(() => stateOf(runtime, name) === 'failed', 5000, `${name} to fail`);
const failure = (logs: LogRecord[], name: string): LogRecord | undefined =>
  logs.find(record => record.event_name === 'runtime.module.failed' && record.attributes['bunny.module'] === name);

/** A module that answers its own command key, to show it keeps working. */
const steady = (name = 'steady'): Fixture => fixture(name, async ({sdk}) => { await sdk.respond(`bunny.cmd.mode.${name}`, () => ({status: 'accepted'})); });

async function stillWorks(caller: Fixture, name = 'steady'): Promise<void> {
  const result = await contextOf(caller).sdk.request(`bunny.cmd.mode.${name}`, setMode, {timeoutMs: 1000});
  assert.equal(result.status, 'accepted', `${name} still answers`);
}

it('a module whose handler throws is stopped and shown unhealthy, while another keeps working', async context => {
  const received: number[] = [];
  const failing = fixture('failing', async ({sdk}) => {
    await sdk.subscribe<{revision: number}>('bunny.state.session.*', message => {
      received.push(message.data.revision);
      if (message.data.revision === 1) throw new Error('the device driver crashed');
    });
    await sdk.respond('bunny.cmd.mode.failing', () => ({status: 'accepted'}));
  });
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {modules: [failing, steady(), probe]});
  const {sdk} = contextOf(probe);
  await sdk.publish('bunny.state.session.s1', session(1));
  await failed(runtime, 'failing');

  assert.deepEqual(entry(runtime.health(), 'failing'), {
    name: 'failing', apiVersion: '1.0', state: 'failed', healthy: false, reason: {code: 'internal', detail: 'a handler threw'},
  });
  assert.equal(runtime.health().status, 'degraded');
  await waitFor(() => failing.stops === 1, 5000, 'the failed module\'s stop');
  assert.deepEqual(failure(logs, 'failing')?.attributes, {
    'bunny.module': 'failing', 'bunny.reason': 'a handler threw', 'error.type': 'Error', 'error.message': 'the device driver crashed',
  });

  await sdk.publish('bunny.state.session.s1', session(2));
  await flush();
  assert.deepEqual(received, [1], 'its subscription is closed');
  const orphaned = await sdk.request('bunny.cmd.mode.failing', setMode, {timeoutMs: 1000});
  assert.equal(orphaned.status, 'rejected');
  assert.equal(orphaned.error.error.code, 'unavailable', 'its responder is closed');
  assert.equal(stateOf(runtime, 'steady'), 'running');
  await stillWorks(probe);
});

it('a module whose responder throws refuses that request with internal and is stopped', async context => {
  const failing = fixture('failing', async ({sdk}) => { await sdk.respond('bunny.cmd.mode.failing', () => { throw new Error('bad command'); }); });
  const probe = fixture('probe');
  const {runtime} = await run(context, {modules: [failing, steady(), probe]});
  const result = await contextOf(probe).sdk.request('bunny.cmd.mode.failing', setMode, {timeoutMs: 1000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'internal');
  await failed(runtime, 'failing');
  await stillWorks(probe);
});

it('a module whose start rejects or throws is stopped and shown unhealthy, while the others start', async context => {
  const rejecting = fixture('rejecting', () => Promise.reject(new Error('the bridge refused the token')));
  const throwing = fixture('throwing', () => { throw new TypeError('bad configuration'); });
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {modules: [rejecting, throwing, steady(), probe]});
  for (const name of ['rejecting', 'throwing']) {
    assert.deepEqual(entry(runtime.health(), name).reason, {code: 'internal', detail: 'start failed'}, name);
  }
  assert.equal(failure(logs, 'throwing')?.attributes['error.type'], 'TypeError');
  await waitFor(() => rejecting.stops === 1 && throwing.stops === 1, 5000, 'stop after a failed start');
  await stillWorks(probe);
});

it('a module whose start outlasts the start deadline, as when its device never answers, is stopped', async context => {
  const silent = fixture('silent', () => deferred<undefined>().promise);
  const probe = fixture('probe');
  const {runtime} = await run(context, {modules: [silent, steady(), probe], startTimeoutMs: 50});
  assert.deepEqual(entry(runtime.health(), 'silent'), {
    name: 'silent', apiVersion: '1.0', state: 'failed', healthy: false, reason: {code: 'unavailable', detail: 'start did not finish within 50 ms'},
  });
  await waitFor(() => silent.stops === 1, 5000, 'stop after a start timeout');
  await stillWorks(probe);
});

it('a module whose scheduled device call times out is stopped', async context => {
  const polling = fixture('polling', ({scheduler}) => {
    scheduler.after(1, async () => {
      await Promise.resolve();
      throw new DOMException('the device did not answer', 'TimeoutError');
    });
  });
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {modules: [polling, steady(), probe]});
  await failed(runtime, 'polling');
  assert.deepEqual(entry(runtime.health(), 'polling').reason, {code: 'internal', detail: 'a scheduled callback failed'});
  assert.equal(failure(logs, 'polling')?.attributes['error.type'], 'TimeoutError');
  await stillWorks(probe);
});

it('a module whose worker thread throws is stopped', async context => {
  const crunching = fixture('crunching', ({workers}) => { workers.start(new URL('throwing-worker.js', WORKERS)); });
  const probe = fixture('probe');
  const {runtime} = await run(context, {modules: [crunching, steady(), probe]});
  await failed(runtime, 'crunching');
  assert.deepEqual(entry(runtime.health(), 'crunching').reason, {code: 'internal', detail: 'a worker failed'});
  await stillWorks(probe);
});

it('an error that escapes a module\'s own async flow stops only that module', async context => {
  const trigger = deferred<undefined>();
  let contained: boolean | undefined;
  const leaking = fixture('leaking', () => {
    // A continuation the module started, such as a callback of its own client library, as the process would see it.
    void trigger.promise.then(() => { contained = contain(new Error('escaped')); });
  });
  const probe = fixture('probe');
  const {runtime} = await run(context, {modules: [leaking, steady(), probe]});
  assert.equal(contain(new Error('not from a module')), false, 'an error from outside every module is not contained');
  trigger.resolve(undefined);
  await failed(runtime, 'leaking');
  assert.equal(contained, true);
  assert.deepEqual(entry(runtime.health(), 'leaking').reason, {code: 'internal', detail: 'an error escaped the module'});
  await stillWorks(probe);
});

it('a module\'s stop never waits on another module\'s handler', async context => {
  const stuck = deferred<Reply>();
  // Registered before the runtime's stop, so a failed assertion cannot leave the stop waiting on this handler.
  context.after(() => { stuck.resolve({status: 'accepted'}); });
  const slow = fixture('slow', async ({sdk}) => { await sdk.respond('bunny.cmd.mode.slow', () => stuck.promise); });
  const results: string[] = [];
  const caller = fixture('caller', async ({sdk}) => {
    await sdk.subscribe('bunny.state.session.*', async message => {
      const result = await sdk.request('bunny.cmd.mode.slow', setMode, {timeoutMs: 60_000, parent: message});
      results.push(result.status);
    });
    await sdk.subscribe('bunny.event.session.*', () => { throw new Error('the caller fails'); });
  });
  const probe = fixture('probe');
  const {runtime} = await run(context, {modules: [slow, caller, probe], stopTimeoutMs: 60_000});
  const {sdk} = contextOf(probe);
  await sdk.publish('bunny.state.session.s1', session(1));
  await flush();
  await sdk.publish('bunny.event.session.s1', turnEnded);
  await waitFor(() => caller.stops === 1, 2000, 'the caller\'s stop while the slow handler still runs');
  assert.deepEqual(results, ['uncertain'], 'closing the caller settled its own request, so its handler finished');
  assert.equal(stateOf(runtime, 'slow'), 'running');
});

it('stopping the runtime is bounded when a module\'s own handler never finishes', async context => {
  const hung = fixture('hung', async ({sdk}) => { await sdk.subscribe('bunny.state.session.*', () => deferred<undefined>().promise); });
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {modules: [hung, steady(), probe], stopTimeoutMs: 100});
  await contextOf(probe).sdk.publish('bunny.state.session.s1', session(1));
  await flush();
  const began = performance.now();
  await runtime.stop();
  assert.ok(performance.now() - began < 2000, 'the stop deadline bounds the wait');
  assert.equal(stateOf(runtime, 'hung'), 'stopped');
  assert.equal(stateOf(runtime, 'steady'), 'stopped');
  assert.equal(hung.stops, 1);
  assert.ok(logs.some(record => record.event_name === 'runtime.module.stop-timed-out' && record.attributes['bunny.module'] === 'hung'));
});

it('a stopped module leaves nothing behind', async context => {
  const clock = manualClock();
  let late = 0;
  let database: DatabaseSync | undefined;
  let worker: Worker | undefined;
  const exited = deferred<undefined>();
  const leaky = fixture('leaky', async ({sdk, scheduler, workers, database: open}) => {
    scheduler.after(60_000, () => { late += 1; });
    database = open();
    database.exec('CREATE TABLE notes (text TEXT)');
    worker = workers.start(new URL('idle-worker.js', WORKERS));
    worker.once('exit', () => { exited.resolve(undefined); });
    await sdk.subscribe('bunny.event.session.*', () => { throw new Error('fail'); });
  });
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {modules: [leaky, probe], clock: {now: clock.now}, scheduler: clock.scheduler});
  assert.equal(clock.pending(), 1, 'only the module\'s own timer waits');

  await contextOf(probe).sdk.publish('bunny.event.session.s1', turnEnded);
  await failed(runtime, 'leaky');
  // The runtime writes this record when it has released everything the module had.
  await waitFor(() => logs.some(record => record.event_name === 'runtime.module.stopped' && record.attributes['bunny.module'] === 'leaky'));
  assert.equal(leaky.stops, 1);
  await exited.promise;
  const {sdk, signal, scheduler, workers, database: open} = contextOf(leaky);
  assert.equal(signal.aborted, true);
  assert.equal(clock.pending(), 0, 'its timer and the runtime\'s stop deadline are cancelled');
  clock.advance(60_000);
  assert.equal(late, 0);
  assert.equal(database?.isOpen, false);
  await assert.rejects(sdk.publish('bunny.state.session.s1', session(1)), refused('invalid-state'));
  assert.throws(() => scheduler.after(1, () => {}), refused('invalid-state'));
  assert.throws(() => workers.start(new URL('idle-worker.js', WORKERS)), refused('invalid-state'));
  assert.throws(() => open(), refused('invalid-state'));
});
