// Request and respond: one command to its owner, one reply, accepted or refused in the shared error body (ADR 0012).
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Command, type Reply} from '../src/index.js';
import {assertValid, bus, deferred, flush, it, peek, setMode, trace, type Mode} from './support.js';

const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

it('a request reaches its responder once and comes back accepted', async () => {
  const {core, wall} = bus();
  const commands: Command<Mode>[] = [];
  await wall.respond<Mode>('bunny.cmd.mode.*', command => { commands.push(command); return {status: 'accepted'}; });
  const result = await core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 5000});

  assert.equal(commands.length, 1);
  const [command] = commands;
  assert.ok(command);
  assertValid(command);
  assert.equal(command.kind, 'command');
  assert.equal(command.source, 'bunny/core');
  assert.equal(command.data.mode, 'quiet');
  assert.equal(Date.parse(command.expiresat ?? '') - Date.parse(command.time), 5000);
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.requestId, command.data.requestId);
  assertValid(result.reply);
  assert.equal(result.reply.kind, 'reply');
  assert.equal(result.reply.type, 'org.bunny.mode.set.replied');
  assert.equal(result.reply.source, 'bunny/wall');
  assert.equal(result.reply.subject, 'wall');
  assert.deepEqual(result.reply.data, {requestId: command.data.requestId, status: 'accepted'});
});

it('a refusal comes back in the shared error body, naming the request and its trace', async () => {
  const {core, wall} = bus();
  await wall.respond('bunny.cmd.mode.wall', () => errorBody('invalid-state', {detail: 'the wall is off'}));
  const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000, requestId: 'req-1'});

  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.equal(result.requestId, 'req-1');
  assert.ok(result.reply);
  assertValid(result.reply);
  const {traceId} = trace(result.reply.traceparent);
  const expected = errorBody('invalid-state', {detail: 'the wall is off', requestId: 'req-1', traceId});
  assert.deepEqual(result.error, expected);
  assert.deepEqual(result.reply.data, {requestId: 'req-1', error: expected.error});
});

it('a responder that throws refuses with internal, and the error is reported', async () => {
  const {core, wall, errors} = bus();
  const failure = new Error('device driver crashed');
  await wall.respond('bunny.cmd.mode.wall', () => { throw failure; });
  const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'internal');
  if (result.status === 'rejected' && result.reply !== undefined) assertValid(result.reply);
  assert.deepEqual(errors, [{error: failure, scope: {source: 'bunny/wall', pattern: 'bunny.cmd.mode.wall'}}]);
});

it('a request nobody responds to is refused as unavailable at once', async () => {
  const {core} = bus();
  const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'unavailable');
  assert.equal(result.error.error.retryable, true, 'nothing reached an owner, so sending again is safe');
  assert.equal(result.error.error.requestId, result.requestId);
  const long = await core.request(`bunny.cmd.mode.${'x'.repeat(2000)}`, setMode('work'), {timeoutMs: 60_000});
  assert.equal(long.status, 'rejected');
  assert.equal(long.error.error.detail?.length, 1024, 'a detail quoting a long key is cut to the error block\'s limit');
});

it('closing a responder refuses the requests still waiting for it as unavailable', async () => {
  const {core, wall} = bus();
  const gate = deferred<Reply>();
  const owner = await wall.respond('bunny.cmd.mode.wall', () => gate.promise);
  const first = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
  const waiting = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 60_000});
  await flush();
  const closed = owner.close();
  const refused = await peek(waiting);
  assert.equal(refused?.status, 'rejected');
  assert.equal(refused.error.error.code, 'unavailable');
  gate.resolve({status: 'accepted'});
  await closed;
  assert.equal((await peek(first))?.status, 'accepted', 'the command already being handled still gets its reply');
});

it('one responder owns each command key', async () => {
  const {core, wall} = bus();
  const owner = await wall.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
  await assert.rejects(core.respond('bunny.cmd.mode.wall', () => ({status: 'accepted'})), refused('invalid-state'));
  await assert.rejects(core.respond('bunny.cmd.*.wall', () => ({status: 'accepted'})), refused('invalid-state'));
  await core.respond('bunny.cmd.scene.*', () => ({status: 'accepted'}));
  await owner.close();
  await core.respond('bunny.cmd.mode.wall', () => ({status: 'accepted'}));
  assert.equal((await core.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 5000})).status, 'accepted');
});

it('a request needs a command key, a positive whole timeout and a valid requestId', async () => {
  const {core} = bus();
  await assert.rejects(core.request('bunny.state.mode.wall', setMode('work'), {timeoutMs: 5000}), refused('invalid-request'));
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
    await assert.rejects(core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs}), refused('invalid-request'), String(timeoutMs));
  }
  await assert.rejects(core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000, requestId: 'not an id'}), refused('invalid-request'));
});
