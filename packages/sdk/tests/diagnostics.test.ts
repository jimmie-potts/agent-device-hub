// Records at decision points (ADR 0012, "Observability"; Hub #949): the bus and the edge report each decision once, at
// its level, with the command's trace, the same in process and through the edge. A late reply, a second deadline or a
// throwing callback adds nothing and changes nothing.
import assert from 'node:assert/strict';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type Command, type Diagnostic, type Reply, type RequestResult} from '../src/index.js';
import {START, SESSION_FAMILY, deferred, flush, it, manualClock, peek, session, setMode, until, type Mode} from './support.js';
import {inProcess, remote, using, type Transport, type World} from './transports.js';

const FAMILY = SESSION_FAMILY;
const KEY = 'bunny.cmd.mode.wall';
const PARENT = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const OTHER = {traceparent: '00-11111111111111111111111111111111-2222222222222222-01'};

/** The bus's records about one request: the event, level, outcome and code of each, in order. */
const about = (world: {diagnostics: Diagnostic[]}, requestId: string): string[] => world.diagnostics
  .filter(record => record.requestId === requestId && record.event.startsWith('command.'))
  .map(record => [record.event, record.level, record.outcome, record.code].filter(part => part !== undefined).join(' '));

/** Every record about one request names the requester, the key and the command's own message and trace. */
function correlated(world: World, requestId: string, command: Message | undefined, source = 'bunny/core'): void {
  const records = world.diagnostics.filter(record => record.requestId === requestId);
  assert.ok(records.length > 0, `records for ${requestId}`);
  for (const record of records) {
    assert.equal(record.source, source);
    assert.equal(record.key, KEY);
    if (command !== undefined) {
      assert.equal(record.messageId, command.id, 'the command\'s own id');
      assert.deepEqual(record.trace, {traceparent: command.traceparent}, 'the command\'s own trace');
    }
  }
}

function suite(transport: Transport): void {
  const name = (text: string): string => `${transport.name}: ${text}`;

  it(name('an accepted command makes one admission and one reply record, with its trace'), () => using(transport, {}, async world => {
    const commands: Command<Mode>[] = [];
    await world.local('bunny/wall').respond<Mode>(KEY, command => {
      commands.push(command);
      return {status: 'accepted'};
    });
    const core = await world.connect('bunny/core');
    const result = await core.request(KEY, setMode('work'), {timeoutMs: 5000, parent: PARENT, requestId: 'req-accepted'});
    assert.equal(result.status, 'accepted');
    await flush();
    assert.deepEqual(about(world, 'req-accepted'), ['command.admitted info queued', 'command.replied info accepted']);
    correlated(world, 'req-accepted', commands[0]);
  }));

  it(name('an owner\'s typed refusal is one reply record at INFO, with its code'), () => using(transport, {}, async world => {
    const commands: Command<Mode>[] = [];
    await world.local('bunny/wall').respond<Mode>(KEY, command => {
      commands.push(command);
      return errorBody('invalid-state', {detail: 'quiet mode keeps the lamps off'});
    });
    const core = await world.connect('bunny/core');
    const result = await core.request(KEY, setMode('quiet'), {timeoutMs: 5000, requestId: 'req-refused'});
    assert.equal(result.status, 'rejected');
    await flush();
    assert.deepEqual(about(world, 'req-refused'), ['command.admitted info queued', 'command.replied info rejected invalid-state']);
    correlated(world, 'req-refused', commands[0]);
  }));

  it(name('a command with no responder is one refusal at WARN'), () => using(transport, {}, async world => {
    const core = await world.connect('bunny/core');
    const result = await core.request(KEY, setMode('work'), {timeoutMs: 5000, requestId: 'req-none'});
    assert.equal(result.status === 'rejected' && result.error.error.code, 'unavailable');
    await flush();
    assert.deepEqual(about(world, 'req-none'), ['command.refused warn rejected unavailable']);
    correlated(world, 'req-none', undefined);
    assert.ok(world.diagnostics.find(record => record.requestId === 'req-none')?.trace, 'the refusal carries the command\'s trace');
  }));

  it(name('a full queue, an expiry in the queue and a held deadline each end with one record at WARN'), () => using(transport, {maxQueued: 1}, async world => {
    const held = deferred<Reply>();
    await world.local('bunny/wall').respond<Mode>(KEY, () => held.promise);
    const core = await world.connect('bunny/core');
    const handled = core.request(KEY, setMode('work'), {timeoutMs: 600, requestId: 'req-held'});
    await world.arrived('request', 1);
    await flush();
    const queued = core.request(KEY, setMode('work'), {timeoutMs: 300, requestId: 'req-queued'});
    await world.arrived('request', 2);
    await flush();
    const full = await core.request(KEY, setMode('work'), {timeoutMs: 5000, requestId: 'req-full'});
    assert.equal(full.status === 'rejected' && full.error.error.code, 'capacity');
    assert.equal(codeOf(await queued), 'expired');
    assert.equal(codeOf(await handled), 'uncertain-result');
    held.resolve({status: 'accepted'});
    await flush();
    await until(() => world.diagnostics.filter(record => record.requestId === 'req-held').length >= 2, 'the held request\'s records');
    assert.deepEqual(about(world, 'req-full'), ['command.refused warn rejected capacity']);
    assert.deepEqual(about(world, 'req-queued'), ['command.admitted info queued', 'command.refused warn rejected expired']);
    assert.deepEqual(about(world, 'req-held'), ['command.admitted info queued', 'command.uncertain warn uncertain uncertain-result'],
      'the late reply makes no record');
  }));

  it(name('a handler that throws ends its request with one uncertain record, and no exception reaches it'), () => using(transport, {}, async world => {
    await world.local('bunny/wall').respond<Mode>(KEY, () => { throw new Error('tok_SYNTHETIC123'); });
    const core = await world.connect('bunny/core');
    const result = await core.request(KEY, setMode('work'), {timeoutMs: 5000, requestId: 'req-throws'});
    assert.equal(codeOf(result), 'uncertain-result');
    await flush();
    assert.deepEqual(about(world, 'req-throws'), ['command.admitted info queued', 'command.uncertain warn uncertain uncertain-result']);
    assert.equal(JSON.stringify(world.diagnostics).includes('tok_SYNTHETIC123'), false);
  }));

  it(name('a command cancelled while it waits is one cancellation at INFO at the bus'), () => using(transport, {}, async world => {
    const held = deferred<Reply>();
    await world.local('bunny/wall').respond<Mode>(KEY, () => held.promise);
    const core = await world.connect('bunny/core');
    const panel = await world.connect('bunny/second');
    void core.request(KEY, setMode('work'), {timeoutMs: 5000, requestId: 'req-first'});
    await world.arrived('request', 1);
    await flush();
    const closing = panel.request(KEY, setMode('work'), {timeoutMs: 5000, requestId: 'req-closing'});
    await world.arrived('request', 2);
    await flush();
    await panel.close();
    assert.equal(codeOf(await closing), transport.closedWhileQueued);
    await world.dropped('request', 1);
    await until(() => about(world, 'req-closing').length === 2, 'the cancellation');
    assert.deepEqual(about(world, 'req-closing'), ['command.admitted info queued', 'command.cancelled info cancelled cancelled']);
    held.resolve({status: 'accepted'});
  }));

  it(name('concurrent requests from two traces keep their own trace in every record'), () => using(transport, {}, async world => {
    const held = deferred<Reply>();
    const commands = new Map<string, Command<Mode>>();
    await world.local('bunny/wall').respond<Mode>(KEY, async command => {
      commands.set(command.data.requestId, command);
      return held.promise;
    });
    const core = await world.connect('bunny/core');
    const first = core.request(KEY, setMode('work'), {timeoutMs: 5000, parent: PARENT, requestId: 'req-a'});
    const second = core.request(KEY, setMode('free'), {timeoutMs: 5000, parent: OTHER, requestId: 'req-b'});
    await world.arrived('request', 2);
    held.resolve({status: 'accepted'});
    assert.deepEqual([(await first).status, (await second).status], ['accepted', 'accepted']);
    await flush();
    for (const [requestId, parent] of [['req-a', PARENT], ['req-b', OTHER]] as const) {
      const traceId = parent.traceparent.slice(3, 35);
      const records = world.diagnostics.filter(record => record.requestId === requestId);
      assert.equal(records.length, 2);
      for (const record of records) assert.equal(record.trace?.traceparent.slice(3, 35), traceId, `${requestId} stays in its own trace`);
      correlated(world, requestId, commands.get(requestId));
    }
  }));

  it(name('sync decisions: served and refused, each once, at their levels'), () => using(transport, {}, async world => {
    const consumer = await world.connect('bunny/wall');
    const none = await consumer.sync([FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(none.status, 'rejected');
    const owner = world.local('bunny/core');
    let refuse = true;
    const served = await owner.serveSync([FAMILY], () => refuse ? errorBody('invalid-state', {detail: 'not yet'}) : {revision: 1, states: [session('s1', 1)]});
    const refused = await consumer.sync([FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(refused.status, 'rejected');
    refuse = false;
    const synced = await consumer.sync([FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(synced.status, 'synced');
    if (synced.status === 'synced') await synced.copy.close();
    await served.close();
    await flush();
    const syncs = world.diagnostics.filter(record => record.event.startsWith('sync.')).map(record =>
      [record.event, record.level, record.outcome, record.code, record.source, record.pattern].filter(part => part !== undefined).join(' '));
    assert.deepEqual(syncs, [
      `sync.refused warn rejected unavailable bunny/wall sync ${FAMILY}`,
      `sync.refused info rejected invalid-state bunny/wall sync ${FAMILY}`,
      `sync.served info succeeded bunny/wall sync ${FAMILY}`,
    ]);
  }));
}

suite(inProcess);
suite(remote);

const codeOf = (result: RequestResult): string => result.status === 'accepted' ? 'accepted' : result.error.error.code;

it('an overflow that restarts a copy\'s sync makes one record at DEBUG', async () => {
  const diagnostics: Diagnostic[] = [];
  const bus = new InProcessBus({onDiagnostic: diagnostic => { diagnostics.push(diagnostic); }});
  const owner = bus.connect('bunny/core');
  await owner.serveSync([FAMILY], () => ({revision: 1, states: [session('s1', 1)]}));
  const gate = deferred<undefined>();
  // The handler holds the first live change, so the next two overflow the one-message buffer.
  const copy = await bus.connect('bunny/wall').sync<{id: string; revision: number}>([FAMILY], async change => {
    if (change.type === 'updated' && change.message.data.revision >= 2) await gate.promise;
  }, {timeoutMs: 5000, maxBuffered: 1});
  assert.equal(copy.status, 'synced');
  for (let revision = 2; revision <= 4; revision += 1) await owner.publish(`bunny.state.${FAMILY}.s1`, session('s1', revision));
  await flush();
  gate.resolve(undefined);
  await until(() => diagnostics.some(record => record.event === 'sync.restarted'), 'the restart');
  if (copy.status === 'synced') await copy.copy.close();
  const restarts = diagnostics.filter(record => record.event === 'sync.restarted');
  assert.deepEqual(restarts.map(record => [record.level, record.source, record.pattern]), [['debug', 'bunny/wall', `sync ${FAMILY}`]]);
});

it('a callback that throws on every record changes no result and is never told of its own failure', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const calls: Diagnostic[] = [];
  const errors: unknown[] = [];
  const run = async (onDiagnostic?: (diagnostic: Diagnostic) => void): Promise<string[]> => {
    const bus = new InProcessBus({onError: error => { errors.push(error); }, ...(onDiagnostic === undefined ? {} : {onDiagnostic})});
    const held = deferred<Reply>();
    await bus.connect('bunny/wall').respond<Mode>(KEY, command => command.data.mode === 'quiet' ? held.promise : {status: 'accepted'});
    const core = bus.connect('bunny/core');
    const results = [
      core.request(KEY, setMode('work'), {timeoutMs: 1000}),
      core.request('bunny.cmd.mode.none', setMode('work'), {timeoutMs: 1000}),
      core.request(KEY, setMode('quiet'), {timeoutMs: 1000}),
    ];
    await flush();
    context.mock.timers.tick(1000);
    const settled = await Promise.all(results.map(result => peek(result)));
    held.resolve({status: 'accepted'});
    return settled.map(result => result === undefined ? 'pending' : codeOf(result));
  };
  const expected = await run();
  const failing = await run(diagnostic => {
    calls.push(diagnostic);
    throw new Error('the journal is gone');
  });
  assert.deepEqual(failing, expected);
  assert.ok(calls.length >= 5, 'the callback was called for each decision');
  assert.deepEqual(errors, [], 'nothing reported the callback\'s failure');
});

it('a call the SDK refuses is the caller\'s error: the bus records nothing for it', async () => {
  const diagnostics: Diagnostic[] = [];
  const bus = new InProcessBus({onDiagnostic: diagnostic => { diagnostics.push(diagnostic); }});
  const core = bus.connect('bunny/core');
  await assert.rejects(core.request('bunny.state.mode.wall', setMode('work'), {timeoutMs: 1000}));
  await assert.rejects(core.request(KEY, setMode('work'), {timeoutMs: 0}));
  assert.deepEqual(diagnostics, []);
});

it('without a callback the bus records nothing and every result is unchanged', async () => {
  const {now, scheduler, advance} = manualClock();
  const bus = new InProcessBus({now, scheduler});
  await bus.connect('bunny/wall').respond<Mode>(KEY, () => ({status: 'accepted'}));
  const result = await bus.connect('bunny/core').request(KEY, setMode('work'), {timeoutMs: 1000});
  advance(1000);
  assert.equal(result.status, 'accepted');
});
