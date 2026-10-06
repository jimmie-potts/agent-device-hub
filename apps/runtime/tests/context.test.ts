// The module context: a logger, tracing, the runtime's clock and scheduler (which also drive the module's SDK deadlines),
// worker threads, its own SQLite file and its own participant on the shared bus.
import assert from 'node:assert/strict';
import {access, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Worker} from 'node:worker_threads';
import type {Command, Reply, TraceContext} from '@jimmie-potts/sdk';
import {startRuntime} from '../src/index.js';
import {START, contextOf, deferred, fixture, flush, it, manualClock, peek, run, session, setMode, stateDir} from './support.js';

const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};

it('a module\'s logger writes records naming the module, with the trace and span of the work it handles', async context => {
  let span: TraceContext | undefined;
  const lights = fixture('lights', ({log, trace}) => {
    span = trace.span(PARENT);
    log.info('scene.applied', {scene: 'quiet', bulbs: 2, fade: true}, span);
    log.debug('poll.skipped');
    log.warn('bulb.slow');
    log.error('bulb.lost', {bulb: 'pendant-1'});
  });
  const {logs} = await run(context, {modules: [lights]});
  assert.ok(span);
  const ids = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(span.traceparent);
  assert.equal(ids?.[1], PARENT_TRACE, 'the span joins the parent\'s trace');
  assert.notEqual(ids?.[2], 'b7ad6b7169203331', 'in a new span');

  const records = logs.filter(record => record.scope.name === 'bunny.modules.lights');
  assert.deepEqual(records.map(record => [record.event_name, record.severity_text, record.severity_number]), [
    ['scene.applied', 'INFO', 9], ['bulb.slow', 'WARN', 13], ['bulb.lost', 'ERROR', 17],
  ], 'debug is below the default level');
  const [applied, slow] = records;
  assert.ok(applied && slow);
  assert.deepEqual(applied.resource, {'service.namespace': 'bunny', 'service.name': 'runtime'});
  assert.deepEqual(applied.attributes, {'bunny.module': 'lights', scene: 'quiet', bulbs: 2, fade: true});
  assert.equal(applied.trace_id, PARENT_TRACE);
  assert.equal(applied.span_id, ids?.[2]);
  assert.equal(applied.trace_flags, '01');
  assert.match(applied.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(slow.trace_id, undefined, 'a record without a trace has no trace fields');
  assert.equal(slow.span_id, undefined);
});

it('a module\'s own fields never replace the module name, and a lower level shows debug records', async context => {
  const chatty = fixture('chatty', ({log, trace}) => {
    log.debug('poll.skipped', {'bunny.module': 'someone-else'});
    const fresh = trace.span();
    log.info('started', {}, fresh);
  });
  const {logs} = await run(context, {modules: [chatty], logLevel: 'debug'});
  const records = logs.filter(record => record.scope.name === 'bunny.modules.chatty');
  assert.equal(records[0]?.event_name, 'poll.skipped');
  assert.equal(records[0]?.attributes['bunny.module'], 'chatty');
  assert.match(records[1]?.trace_id ?? '', /^[0-9a-f]{32}$/, 'a span without a parent starts a new trace');
  assert.ok(logs.some(record => record.scope.name === 'bunny.runtime' && record.severity_text === 'DEBUG'));
});

it('a module\'s clock, timers and request deadlines all follow the runtime\'s clock and scheduler', async context => {
  const clock = manualClock();
  const stuck = deferred<Reply>();
  const commands: Command<object>[] = [];
  const owner = fixture('owner', async ({sdk}) => {
    await sdk.respond('bunny.cmd.mode.owner', command => { commands.push(command); return stuck.promise; });
  });
  const caller = fixture('caller');
  await run(context, {modules: [owner, caller], clock: {now: clock.now}, scheduler: clock.scheduler});
  const {sdk, clock: moduleClock, scheduler} = contextOf(caller);
  assert.equal(moduleClock.now(), START);

  const pending = sdk.request('bunny.cmd.mode.owner', setMode, {timeoutMs: 1000});
  await flush();
  assert.equal(commands[0]?.time, new Date(START).toISOString());
  assert.equal(commands[0]?.expiresat, new Date(START + 1000).toISOString());
  await new Promise(resolve => { setTimeout(resolve, 20); });
  clock.advance(999);
  assert.equal(await peek(pending), undefined, 'real time passing does not end the request');
  clock.advance(1);
  assert.equal((await peek(pending))?.status, 'uncertain');

  let fired = 0;
  scheduler.after(500, () => { fired += 1; });
  clock.advance(499);
  assert.equal(fired, 0);
  clock.advance(1);
  await flush();
  assert.equal(fired, 1);
  const cancel = scheduler.after(10, () => { fired += 1; });
  cancel();
  clock.advance(10);
  await flush();
  assert.equal(fired, 1, 'a cancelled timer never runs');
  stuck.resolve({status: 'accepted'});
});

it('a module timer needs a whole delay that a timer can wait', async context => {
  const timed = fixture('timed');
  await run(context, {modules: [timed]});
  const {scheduler} = contextOf(timed);
  for (const delay of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
    assert.throws(() => scheduler.after(delay, () => {}), RangeError, String(delay));
  }
});

it('a module gets its own SQLite file in the runtime\'s private state directory, kept across restarts', async context => {
  const dir = await stateDir(context);
  const writer = fixture('notes', ({database}) => {
    const db = database();
    assert.equal(database(), db, 'one connection per module');
    db.exec('CREATE TABLE notes (text TEXT)');
    db.prepare('INSERT INTO notes VALUES (?)').run('kept');
  });
  const quiet = fixture('quiet');
  const first = await startRuntime({modules: [writer, quiet], port: 0, stateDir: dir, log: () => {}});
  const file = join(dir, 'modules', 'notes.sqlite');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'modules'))).mode & 0o777, 0o700);
  await assert.rejects(access(join(dir, 'modules', 'quiet.sqlite')), 'a module that never asks gets no file');
  await first.stop();

  let rows: unknown[] = [];
  const reader = fixture('notes', ({database}) => { rows = database().prepare('SELECT text FROM notes').all().map(row => ({...row})); });
  const second = await startRuntime({modules: [reader], port: 0, stateDir: dir, log: () => {}});
  await second.stop();
  assert.deepEqual(rows, [{text: 'kept'}]);
});

it('a module can run a worker thread', async context => {
  let worker: Worker | undefined;
  const echo = fixture('echo', ({workers}) => { worker = workers.start(new URL('./fixtures/echo-worker.js', import.meta.url), {workerData: 'hello'}); });
  await run(context, {modules: [echo]});
  assert.ok(worker);
  const reply = new Promise(resolve => { worker?.once('message', resolve); });
  worker.postMessage('ping');
  assert.equal(await reply, 'hello ping');
});

it('each module has its own participant, named for the module, on one shared bus', async context => {
  const received: string[] = [];
  const listener = fixture('listener', async ({sdk}) => {
    await sdk.subscribe('bunny.state.session.*', message => { received.push(message.source); });
  });
  const speaker = fixture('speaker');
  await run(context, {modules: [listener, speaker]});
  assert.equal(contextOf(listener).sdk.source, 'bunny/modules/listener');
  const sent = await contextOf(speaker).sdk.publish('bunny.state.session.s1', session(1));
  await flush();
  assert.equal(sent.source, 'bunny/modules/speaker');
  assert.deepEqual(received, ['bunny/modules/speaker']);
});
