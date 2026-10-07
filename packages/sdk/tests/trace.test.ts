// W3C trace context on every message: a message sent while handling another joins its trace (ADR 0012, Observability).
// Only `traceparent` travels: profile 2.0 defines no `tracestate`, so the SDK never forwards one (2026-10-07 amendment).
import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {childOf, type TraceContext} from '../src/index.js';
import {START, assertValid, bus, deferred, flush, it, peek, session, setMode, trace, turnEnded, validator, type Mode} from './support.js';

/** A parent as a foreign sender might pass it, with a `tracestate` that profile 2.0 does not define. */
const withState = (traceparent: string): TraceContext => {
  const parent = {traceparent, tracestate: 'bunny=1,other=x'};
  return parent;
};

it('a message sent without a parent starts a new sampled trace, delivered unchanged', async () => {
  const {core, wall} = bus();
  const received: Message[] = [];
  await wall.subscribe('bunny.*.session.*', message => { received.push(message); });
  const first = await core.publish('bunny.state.session.s1', session('s1', 1));
  const second = await core.publish('bunny.state.session.s1', session('s1', 2));
  await flush();
  assert.equal(trace(first.traceparent).flags, '01');
  assert.notEqual(trace(first.traceparent).traceId, trace(second.traceparent).traceId);
  assert.equal('tracestate' in first, false);
  assert.deepEqual(received.map(message => message.traceparent), [first.traceparent, second.traceparent]);
});

it('a handler that sends with the received message as parent continues its trace in a new span, without tracestate', async () => {
  const {core, wall} = bus();
  const forwarded = deferred<Message>();
  await wall.subscribe('bunny.state.session.*', async message => {
    forwarded.resolve(await wall.publish('bunny.event.session.s1', turnEnded('s1'), {parent: message}));
  });
  const parent = withState('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00');
  const root = await core.publish('bunny.state.session.s1', session('s1', 1), {parent});
  const child = await forwarded.promise;
  assertValid(root);
  assertValid(child);
  for (const message of [root, child]) {
    assert.equal(trace(message.traceparent).traceId, '0af7651916cd43dd8448eb211c80319c');
    assert.equal(trace(message.traceparent).flags, '00', 'the sampled flag is kept');
    assert.equal('tracestate' in message, false, 'the parent\'s tracestate is never forwarded');
  }
  const spans = new Set([parent, root, child].map(message => trace(message.traceparent).spanId));
  assert.equal(spans.size, 3, 'each message is its own span');
});

it('a command joins the caller\'s trace, its reply continues it, and an uncertain result names it', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: START});
  const {core, wall} = bus();
  const commands: Message<Mode>[] = [];
  const hold = deferred<{status: 'accepted'}>();
  await wall.respond<Mode>('bunny.cmd.mode.*', command => {
    commands.push(command);
    return command.data.mode === 'work' ? {status: 'accepted'} : hold.promise;
  });
  const parent = await core.publish('bunny.state.session.s1', session('s1', 1));
  const {traceId} = trace(parent.traceparent);

  const accepted = await core.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 1000, parent});
  assert.equal(accepted.status, 'accepted');
  if (accepted.status !== 'accepted') return;
  const [command] = commands;
  assert.ok(command);
  assert.equal(trace(command.traceparent).traceId, traceId);
  assert.equal(trace(accepted.reply.traceparent).traceId, traceId);
  assert.notEqual(trace(accepted.reply.traceparent).spanId, trace(command.traceparent).spanId);

  const pending = core.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 1000, parent});
  await flush();
  context.mock.timers.tick(1000);
  const uncertain = await peek(pending);
  assert.equal(uncertain?.status, 'uncertain');
  assert.equal(uncertain.error.error.traceId, traceId);
});

it('a malformed or all-zero parent is never adopted; the message starts a new trace', async () => {
  const {core} = bus();
  const parents = [
    withState('00-00000000000000000000000000000000-b7ad6b7169203331-01'),
    {traceparent: '00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01'},
    {traceparent: '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'},
    {traceparent: '00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01'},
    {traceparent: 'not a traceparent'},
  ];
  for (const parent of parents) {
    const message = await core.publish('bunny.state.session.s1', session('s1', 1), {parent});
    assertValid(message);
    assert.notEqual(trace(message.traceparent).traceId, '0af7651916cd43dd8448eb211c80319c', parent.traceparent);
    assert.equal('tracestate' in message, false, 'no tracestate, whatever the parent carried');
  }
});

it('childOf passes on only traceparent, and a message that carries tracestate fails validation', async () => {
  const child = childOf(withState('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'));
  assert.deepEqual(Object.keys(child), ['traceparent']);
  assert.equal(trace(child.traceparent).traceId, '0af7651916cd43dd8448eb211c80319c');
  assert.deepEqual(Object.keys(childOf(undefined)), ['traceparent']);
  const {core} = bus();
  const message = await core.publish('bunny.state.session.s1', session('s1', 1), {parent: child});
  assertValid(message);
  const refused = validator.validate({...message, tracestate: 'bunny=1'});
  assert.deepEqual(refused.ok ? 'accepted' : refused.error, {code: 'invalid-message', retryable: false, detail: 'envelope / additionalProperties tracestate'});
});
