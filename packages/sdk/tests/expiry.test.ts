// Deadlines: a request past its deadline is uncertain and never retried, a command that never reached its handler
// expires instead, and a responder ignores expired requests.
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Command, Reply} from '../src/index.js';
import {START, bus, deferred, flush, it, manualClock, peek, setMode, trace, type Mode} from './support.js';

const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};

it('a request past its deadline resolves as uncertain-result and is never retried', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const {core, wall, errors} = bus();
  const commands: Command<Mode>[] = [];
  const answer = deferred<Reply>();
  await wall.respond<Mode>('bunny.cmd.mode.*', command => { commands.push(command); return answer.promise; });
  const pending = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 1000});
  await flush();
  assert.equal(commands.length, 1);

  context.mock.timers.tick(999);
  assert.equal(await peek(pending), undefined, 'still waiting before the deadline');
  context.mock.timers.tick(1);
  const result = await peek(pending);
  assert.ok(result, 'settled at the deadline');
  assert.equal(result.status, 'uncertain');
  const [command] = commands;
  assert.ok(command);
  const {traceId} = trace(command.traceparent);
  assert.deepEqual(result.error, errorBody('uncertain-result', {requestId: command.data.requestId, traceId, detail: 'no reply within 1000 ms'}));
  assert.equal(result.error.error.retryable, false);

  // Nothing sends the command again, and the late reply is dropped without disturbing the responder.
  answer.resolve({status: 'accepted'});
  context.mock.timers.tick(60_000);
  await flush();
  assert.equal(commands.length, 1);
  assert.deepEqual(errors, []);
  const next = core.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 1000});
  assert.equal((await peek(next))?.status, 'accepted', 'the responder serves the next request');
  assert.equal(commands.length, 2);
});

it('at the deadline, a command still queued is removed as expired, and one being handled is uncertain', async () => {
  const clock = manualClock();
  const {core, wall} = bus({now: clock.now, scheduler: clock.scheduler, maxQueued: 1});
  const handled: string[] = [];
  const busy = deferred<Reply>();
  await wall.respond<Mode>('bunny.cmd.mode.*', command => {
    handled.push(command.data.mode);
    return command.data.mode === 'work' ? busy.promise : {status: 'accepted'};
  });
  const first = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 100});
  await flush();
  const queued = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 100, requestId: 'req-queued', parent: PARENT});
  await flush();
  assert.deepEqual(handled, ['work'], 'the second request waits behind the first');

  clock.advance(100);
  assert.equal((await peek(first))?.status, 'uncertain', 'the handler had the first command, so it may have taken effect');
  assert.deepEqual(await peek(queued), {
    status: 'rejected', requestId: 'req-queued',
    error: errorBody('expired', {requestId: 'req-queued', traceId: PARENT_TRACE, detail: 'the responder did not start it within 100 ms'}),
  });
  // The expired command left the queue: with room for one waiting command, the next request queues instead of
  // being refused with capacity.
  const next = core.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 100});
  busy.resolve({status: 'accepted'});
  assert.equal((await peek(next))?.status, 'accepted');
  assert.deepEqual(handled, ['work', 'free'], 'the expired command never reached the handler');
});

it('a command that reaches the responder at its expiry is ignored, and its requester gets expired at once', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  let skew = 0;
  const {core, wall} = bus({now: () => Date.now() + skew});
  let calls = 0;
  await wall.respond('bunny.cmd.mode.wall', () => { calls += 1; return {status: 'accepted'}; });
  const pending = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 1000});
  skew = 1000;
  await flush();
  assert.equal(calls, 0);
  const result = await peek(pending);
  assert.equal(result?.status, 'rejected', 'settled when the responder skipped it, before the deadline timer');
  assert.equal(result.error.error.code, 'expired');
});

it('request deadlines run on the injected clock and scheduler', async () => {
  const clock = manualClock();
  const {core, wall} = bus({now: clock.now, scheduler: clock.scheduler});
  const commands: Command<Mode>[] = [];
  const answer = deferred<Reply>();
  await wall.respond<Mode>('bunny.cmd.mode.*', command => { commands.push(command); return answer.promise; });
  const pending = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 1000});
  await flush();
  assert.equal(clock.pending(), 1, 'the deadline waits on the injected scheduler');
  assert.equal(Date.parse(commands[0]?.expiresat ?? ''), START + 1000, 'expiresat comes from the injected clock');

  clock.advance(999);
  assert.equal(await peek(pending), undefined, 'still waiting before the deadline');
  clock.advance(1);
  assert.equal((await peek(pending))?.status, 'uncertain');

  answer.resolve({status: 'accepted'});
  const replied = core.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 1000});
  assert.equal((await peek(replied))?.status, 'accepted');
  assert.equal(clock.pending(), 0, 'a reply cancels its deadline on the same scheduler');
});
