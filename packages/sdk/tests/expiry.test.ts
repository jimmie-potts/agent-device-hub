// Deadlines: a request past its deadline is uncertain and never retried, and a responder ignores expired requests.
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Command, Reply} from '../src/index.js';
import {START, bus, deferred, flush, it, peek, setMode, trace, type Mode} from './support.js';

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

it('a responder ignores a request that expired while it waited, then serves fresh ones', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const {core, wall} = bus();
  const handled: string[] = [];
  const busy = deferred<Reply>();
  await wall.respond<Mode>('bunny.cmd.mode.*', command => {
    handled.push(command.data.mode);
    return command.data.mode === 'work' ? busy.promise : {status: 'accepted'};
  });
  const first = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
  const late = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 100});
  await flush();
  assert.deepEqual(handled, ['work'], 'the second request waits behind the first');

  context.mock.timers.tick(100);
  assert.equal((await peek(late))?.status, 'uncertain');
  busy.resolve({status: 'accepted'});
  assert.equal((await peek(first))?.status, 'accepted');
  await flush();
  assert.deepEqual(handled, ['work'], 'the expired request never reached the handler');

  assert.equal((await peek(core.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 100})))?.status, 'accepted');
  assert.deepEqual(handled, ['work', 'free']);
});

it('a request that reaches the responder exactly at its expiry is ignored, as the validator would refuse it', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  let skew = 0;
  const {core, wall} = bus({now: () => Date.now() + skew});
  let calls = 0;
  await wall.respond('bunny.cmd.mode.wall', () => { calls += 1; return {status: 'accepted'}; });
  const pending = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 1000});
  skew = 1000;
  await flush();
  assert.equal(calls, 0);
  context.mock.timers.tick(1000);
  assert.equal((await peek(pending))?.status, 'uncertain');
});
