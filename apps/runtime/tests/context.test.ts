// The module context: a logger, tracing, the runtime's clock and scheduler (which also drive the module's SDK deadlines),
// worker threads, its own SQLite file and its own participant on the shared bus.
import assert from 'node:assert/strict';
import {access, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Worker} from 'node:worker_threads';
import type {Command, Reply, TraceContext} from '@jimmie-potts/sdk';
import {startRuntime} from '../src/index.js';
import {RUNTIME_PACKAGE_VERSION, START, UUID, contextOf, deferred, entry, fixture, flush, it, manualClock, peek, run, session, setMode, stateDir} from './support.js';

const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};

it('a module\'s logger writes contract records under the module scope, naming the module, with the trace and span of the work it handles', async context => {
  let span: TraceContext | undefined;
  const lights = fixture('lights', ({log, trace}) => {
    span = trace.span(PARENT);
    log.info('operation.completed', {'bunny.operation': 'mode', 'bunny.outcome': 'succeeded', 'bunny.device.id': 'pendant-1'}, span);
    log.debug('feed.changed');
    log.warn('command.queued', {'bunny.queue.depth': 3});
    log.error('operation.failed', {'bunny.device.id': 'pendant-1', 'bunny.reason': 'unavailable'});
  });
  const {logs} = await run(context, {modules: [lights]});
  assert.ok(span);
  const ids = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(span.traceparent);
  assert.equal(ids?.[1], PARENT_TRACE, 'the span joins the parent\'s trace');
  assert.notEqual(ids?.[2], 'b7ad6b7169203331', 'in a new span');

  const records = logs.filter(record => record.scope.name === 'bunny.module');
  assert.deepEqual(records.map(record => [record.event_name, record.body, record.severity_text, record.severity_number]), [
    ['operation.completed', 'Operation completed', 'INFO', 9], ['command.queued', 'Command queued', 'WARN', 13], ['operation.failed', 'Operation failed', 'ERROR', 17],
  ], 'debug is below the default level');
  const [applied, slow] = records;
  assert.ok(applied && slow);
  assert.equal(applied.schema_version, '1.4');
  assert.deepEqual(applied.scope, {name: 'bunny.module', version: '1.0.0'});
  assert.deepEqual(applied.resource, {
    'service.namespace': 'bunny', 'service.name': 'runtime', 'service.version': RUNTIME_PACKAGE_VERSION,
    'service.instance.id': applied.resource['service.instance.id'], 'deployment.environment.name': 'development',
  });
  assert.match(applied.resource['service.instance.id'] ?? '', UUID);
  assert.deepEqual(applied.attributes, {
    'bunny.module': 'lights', 'bunny.provenance': 'source', 'bunny.operation': 'mode', 'bunny.outcome': 'succeeded', 'bunny.device.id': 'pendant-1',
  });
  assert.equal(applied.trace_id, PARENT_TRACE);
  assert.equal(applied.span_id, ids?.[2]);
  assert.equal(applied.trace_flags, '01');
  assert.match(applied.timestamp ?? '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(slow.trace_id, undefined, 'a record without a trace has no trace fields');
  assert.equal(slow.span_id, undefined);
  assert.equal(new Set(logs.map(record => record.resource['service.instance.id'])).size, 1, 'one instance ID for the runtime\'s and the module\'s records');
});

it('a module\'s own fields never replace the module name or the provenance, and a lower level shows debug records', async context => {
  const chatty = fixture('chatty', ({log, trace}) => {
    log.debug('feed.changed', {'bunny.module': 'someone-else', 'bunny.provenance': 'observation'});
    const fresh = trace.span();
    log.info('operation.completed', {}, fresh);
  });
  const {logs} = await run(context, {modules: [chatty], logLevel: 'debug'});
  const records = logs.filter(record => record.scope.name === 'bunny.module');
  assert.equal(records[0]?.event_name, 'feed.changed');
  assert.deepEqual(records[0]?.attributes, {'bunny.module': 'chatty', 'bunny.provenance': 'source'});
  assert.match(records[1]?.trace_id ?? '', /^[0-9a-f]{32}$/, 'a span without a parent starts a new trace');
  assert.ok(logs.some(record => record.scope.name === 'bunny.runtime' && record.severity_text === 'DEBUG'));
});

it('a module\'s record with an unregistered event or an invalid value is not written, and fields the catalog does not register are left out', async context => {
  const leak = 'GET http://192.0.2.7/api?token=secret-token refused';
  const careless = fixture('careless', ({log}) => {
    log.info('lamp.switched', {'bunny.device.id': 'lamp-1'});
    log.info('runtime.module.started', {'bunny.module': 'careless'});
    log.warn('operation.failed', {'bunny.device.id': 'lamp-1', 'bunny.reason': 'unavailable', 'error.message': leak, detail: leak, stack: leak});
    log.error('operation.failed', {'bunny.device.id': leak});
  });
  // The unregistered event, the runtime's own event and the URL: three records the writer drops and counts.
  const {logs} = await run(context, {modules: [careless]}, {dropped: 3});
  const records = logs.filter(record => record.scope.name === 'bunny.module');
  assert.deepEqual(records.map(record => record.event_name), ['operation.failed'], 'only the record with a registered event and valid values');
  assert.deepEqual(records[0]?.attributes, {'bunny.module': 'careless', 'bunny.provenance': 'source', 'bunny.device.id': 'lamp-1', 'bunny.reason': 'unavailable'});
  assert.equal(logs.some(record => record.event_name === 'lamp.switched'), false);
  assert.equal(logs.filter(record => record.event_name === 'runtime.module.started').length, 1, 'a module cannot write the runtime\'s own events');
  assert.equal(JSON.stringify(logs).includes('secret-token'), false, 'no raw message reaches a record');
});

it('a module\'s clock, timers and request deadlines all follow the runtime\'s clock and scheduler', async context => {
  const clock = manualClock();
  const stuck = deferred<Reply>();
  // Registered before the runtime's stop, so a failed assertion cannot leave the stop waiting on this handler.
  context.after(() => { stuck.resolve({status: 'accepted'}); });
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

it('a module publishes a prepared message unchanged through its own participant', async context => {
  const received: unknown[] = [];
  const listener = fixture('listener', async ({sdk}) => {
    await sdk.subscribe('bunny.state.session.*', message => { received.push(message); });
  });
  const speaker = fixture('speaker');
  await run(context, {modules: [listener, speaker]});
  const {sdk} = contextOf(speaker);
  const prepared = await sdk.publish('bunny.state.session.s1', session(1));
  await flush();
  const again = await sdk.publishMessage('bunny.state.session.s1', prepared);
  await flush();
  assert.equal(again, prepared, 'the same message, with its id and time');
  assert.deepEqual(received, [prepared, prepared]);
});

it('health counts each module\'s sync restarts, so a restart loop shows', async context => {
  const gate = deferred<undefined>();
  context.after(() => { gate.resolve(undefined); });
  let revision = 0;
  const state = (at: number) => ({
    kind: 'state' as const, type: 'org.bunny.session.updated', subject: 's1', dataschema: 'https://bunny.invalid/events/test-session/2.0',
    data: {id: 's1', revision: at},
  });
  const owner = fixture('owner', async ({sdk}) => {
    await sdk.serveSync(['test-session'], () => ({revision, states: revision === 0 ? [] : [state(revision)]}));
  });
  const consumer = fixture('consumer', async ({sdk}) => {
    // The handler stalls on the first update, so later updates overflow a buffer of one and restart the sync.
    const result = await sdk.sync(['test-session'], async change => { if (change.type === 'updated') await gate.promise; }, {timeoutMs: 1000, maxBuffered: 1});
    assert.equal(result.status, 'synced');
  });
  const {runtime} = await run(context, {modules: [owner, consumer]});
  assert.equal(entry(runtime.health(), 'consumer').syncRestarts, 0);
  for (const at of [1, 2, 3]) {
    revision = at;
    await contextOf(owner).sdk.publish('bunny.state.test-session.s1', state(at));
  }
  await flush();
  assert.equal(entry(runtime.health(), 'consumer').syncRestarts, 1);
  assert.equal(entry(runtime.health(), 'owner').syncRestarts, 0);
  assert.equal(entry(runtime.health(), 'consumer').state, 'running', 'a restart is not a failure');
});
