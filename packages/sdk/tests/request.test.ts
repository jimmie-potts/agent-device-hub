// Request and respond: one command to its owner, one reply, accepted or refused in the shared error body (ADR 0012).
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Command, type Reply} from '../src/index.js';
import {START, assertValid, bus, deferred, flush, it, peek, session, setMode, trace, type Mode} from './support.js';

const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};

it('a request reaches its responder once and comes back accepted', async () => {
  const {core, wall} = bus();
  const commands: Command<Mode>[] = [];
  await wall.respond<Mode>('bunny.cmd.mode.*', command => { commands.push(command); return {status: 'accepted'}; });
  const timers = (): number => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;
  const before = timers();
  const result = await core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 5000});
  assert.equal(timers(), before, 'the reply clears the deadline timer');

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

it('a responder that throws once its handler started leaves the request uncertain, sends it once, and reports the error', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const {core, wall, errors} = bus();
  const failure = new Error('device driver crashed');
  const handled: string[] = [];
  const effects: string[] = [];
  let nested: unknown;
  await wall.respond<Mode>('bunny.cmd.mode.wall', async command => {
    const {requestId} = command.data;
    handled.push(requestId);
    switch (requestId) {
      case 'req-before':
        throw failure;
      case 'req-after':
        effects.push(requestId);
        throw failure;
      case 'req-nested':
        // A nested SDK call that refuses with SdkError, after the effect: still an exception after the handler started.
        effects.push(requestId);
        try {
          await wall.publish('not-a-key', session('s1', 1));
        } catch (error) {
          nested = error;
          throw error;
        }
        return {status: 'accepted'};
      case 'req-garbage':
        effects.push(requestId);
        return 'done' as unknown as Reply;
      default:
        // A typed refusal before acting is a rejection: it proves no effect.
        return errorBody('invalid-state', {detail: 'the wall is off'});
    }
  });
  const uncertain = ['req-before', 'req-after', 'req-nested', 'req-garbage'];
  for (const requestId of uncertain) {
    const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000, requestId, parent: PARENT});
    assert.deepEqual(result, {
      status: 'uncertain', requestId,
      error: errorBody('uncertain-result', {requestId, traceId: PARENT_TRACE, detail: 'the responder failed after it started'}),
    }, `${requestId}: no reply, and never a refusal`);
  }
  const refusal = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000, requestId: 'req-refused', parent: PARENT});
  assert.equal(refusal.status, 'rejected', 'a typed refusal stays a rejection');
  assert.ok(refusal.status === 'rejected' && refusal.reply !== undefined, 'the refusal comes in a reply');
  assertValid(refusal.reply);
  assert.deepEqual(effects, ['req-after', 'req-nested', 'req-garbage']);
  assert.ok(nested instanceof SdkError && nested.body.error.code === 'invalid-request', 'the nested call refused with SdkError');
  assert.deepEqual(errors.map(({error, scope}) => [error instanceof TypeError ? 'TypeError' : error, scope.pattern]), [
    [failure, 'bunny.cmd.mode.wall'], [failure, 'bunny.cmd.mode.wall'], [nested, 'bunny.cmd.mode.wall'], ['TypeError', 'bunny.cmd.mode.wall'],
  ], 'each exception is reported once');
  // Past every deadline, nothing sent any command again.
  context.mock.timers.tick(60_000);
  await flush();
  assert.deepEqual(handled, [...uncertain, 'req-refused'], 'each command reached the handler exactly once');
});

it('a refusal is rebuilt from the registry in process too: its detail cut to the limit and anything else dropped', async () => {
  const {core, wall} = bus();
  const wild = {error: {code: 'invalid-state', retryable: false, detail: 'x'.repeat(5000), note: 'not in the error block'}} as unknown as Reply;
  await wall.respond('bunny.cmd.mode.wall', () => wild);
  const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000, requestId: 'req-wild', parent: PARENT});
  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected' || result.reply === undefined) return assert.fail('a refusal in a reply');
  assertValid(result.reply);
  assert.deepEqual(result.error, errorBody('invalid-state', {detail: 'x'.repeat(1024), requestId: 'req-wild', traceId: PARENT_TRACE}));
});

it('a request nobody responds to is refused as unavailable at once', async () => {
  const {core} = bus();
  const result = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'unavailable');
  assert.equal(result.error.error.retryable, true, 'nothing reached an owner, so sending again is safe');
  assert.equal(result.error.error.requestId, result.requestId);
  const target = 'x'.repeat(2000);
  const long = await core.request(`bunny.cmd.mode.${target}`, setMode('work', target), {timeoutMs: 60_000});
  assert.equal(long.status, 'rejected');
  assert.equal(long.error.error.detail?.includes(target), false, 'a detail never quotes the key');
});

it('closing a responder refuses the requests still waiting for it as unavailable', async () => {
  const {core, wall} = bus();
  const gate = deferred<Reply>();
  const owner = await wall.respond('bunny.cmd.mode.wall', () => gate.promise);
  const first = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
  const waiting = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 60_000, requestId: 'req-wait', parent: PARENT});
  await flush();
  const closed = owner.close();
  const refused = await peek(waiting);
  assert.deepEqual(refused, {
    status: 'rejected', requestId: 'req-wait',
    error: errorBody('unavailable', {requestId: 'req-wait', traceId: PARENT_TRACE, detail: 'the responder closed'}),
  });
  gate.resolve({status: 'accepted'});
  await closed;
  assert.equal((await peek(first))?.status, 'accepted', 'the command already being handled still gets its reply');
});

it('a full responder queue refuses the request with capacity, naming it and its trace', async () => {
  const {core, wall} = bus({maxQueued: 1});
  const gate = deferred<Reply>();
  await wall.respond('bunny.cmd.mode.wall', () => gate.promise);
  const busy = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
  await flush();
  const waiting = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 5000});
  const full = await core.request('bunny.cmd.mode.wall', setMode('free'), {timeoutMs: 5000, requestId: 'req-full', parent: PARENT});
  assert.deepEqual(full, {
    status: 'rejected', requestId: 'req-full',
    error: errorBody('capacity', {requestId: 'req-full', traceId: PARENT_TRACE, detail: 'the responder\'s queue is full'}),
  });
  assert.equal(full.error.error.retryable, true, 'nothing reached the owner, so sending again later is safe');
  gate.resolve({status: 'accepted'});
  assert.equal((await busy).status, 'accepted');
  assert.equal((await waiting).status, 'accepted');
});

it('a responder that closes itself still answers the command it is handling', async () => {
  const {core, wall} = bus();
  const owner = await wall.respond('bunny.cmd.mode.wall', async () => {
    await owner.close();
    return {status: 'accepted'};
  });
  const first = core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000});
  const waiting = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 5000});
  assert.equal((await peek(first))?.status, 'accepted', 'close resolves inside the responder that called it');
  const refused = await peek(waiting);
  assert.equal(refused?.status, 'rejected');
  assert.equal(refused.error.error.code, 'unavailable');
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
  const unnamed = {...setMode('work'), type: 'org.bunny.mode.set'};
  await assert.rejects(core.request('bunny.cmd.mode.wall', unnamed, {timeoutMs: 5000}), refused('invalid-request'), 'a command type ends in .requested');
});
