// Recorded spans (ADR 0012, "Observability"; Hub #949): with a recorder, the bus records each command's request, queue
// and execute spans, parented to the request span, with real durations and status. A command carries its request span's
// context in process, and a reply its execute span's. Concurrent requests never share a parent.
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, startSpan, type Command, type Reply, type SpanRecorder} from '../src/index.js';
import {RecordedSpans, lostParents, type RecordedSpan} from '../src/testing/index.js';
import {deferred, flush, it, setMode, trace, until, type Mode} from './support.js';
import {inProcess, remote, using, type Transport} from './transports.js';

const KEY = 'bunny.cmd.mode.wall';
const PARENT = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const OTHER = {traceparent: '00-11111111111111111111111111111111-2222222222222222-01'};

/** The request, queue and execute spans of the command whose request span is `request`. */
function family(spans: RecordedSpans, request: RecordedSpan): {queue: RecordedSpan[]; execute: RecordedSpan[]} {
  const children = (name: RecordedSpan['name']): RecordedSpan[] =>
    spans.named(name).filter(span => span.traceId === request.traceId && span.parentSpanId === request.spanId);
  return {queue: children('bunny.command.queue'), execute: children('bunny.command.execute')};
}

const ended = (span: RecordedSpan | undefined): boolean => span?.endedAtMs !== undefined && span.endedAtMs >= span.startedAtMs;

function suite(transport: Transport): void {
  const name = (text: string): string => `${transport.name}: ${text}`;

  it(name('an accepted command has a request span with its queue and execute spans as children'), async () => {
    const spans = new RecordedSpans();
    await using(transport, {spans}, async world => {
      const commands: Command<Mode>[] = [];
      await world.local('bunny/wall').respond<Mode>(KEY, command => {
        commands.push(command);
        return {status: 'accepted'};
      });
      const core = await world.connect('bunny/core');
      const result = await core.request(KEY, setMode('work'), {timeoutMs: 5000, parent: PARENT});
      assert.equal(result.status, 'accepted');
      if (result.status !== 'accepted') return;
      await flush();
      const [command] = commands;
      assert.ok(command);
      const [request] = spans.named('bunny.command.request');
      assert.ok(request, 'the bus recorded the request');
      assert.equal(request.traceId, trace(PARENT.traceparent).traceId);
      if (transport.name === 'in-process') {
        assert.equal(request.kind, 'client');
        assert.equal(request.parentSpanId, trace(PARENT.traceparent).spanId, 'the caller\'s parent');
        assert.equal(trace(command.traceparent).spanId, request.spanId, 'the command carries its request span\'s context');
      } else {
        assert.equal(request.kind, 'server');
        assert.equal(request.parentSpanId, trace(command.traceparent).spanId, 'the remote command\'s own context, authenticated and validated');
      }
      const {queue, execute} = family(spans, request);
      assert.equal(queue.length, 1);
      assert.equal(execute.length, 1);
      assert.equal(trace(result.reply.traceparent).spanId, execute[0]?.spanId, 'the reply carries the execute span\'s context');
      for (const span of [request, ...queue, ...execute]) {
        assert.ok(ended(span), `${span.name} ended`);
        assert.equal(span.status, 'unset');
      }
      assert.deepEqual(lostParents(spans.spans, [PARENT, command]), [], 'no span lost its parent');
    });
  });

  it(name('a handler that throws, an expiry in the queue and a typed refusal end their spans as they ended'), async () => {
    const spans = new RecordedSpans();
    await using(transport, {spans, maxQueued: 4}, async world => {
      const held = deferred<Reply>();
      await world.local('bunny/wall').respond<Mode>(KEY, command => {
        if (command.data.mode === 'quiet') throw new Error('tok_SYNTHETIC123');
        if (command.data.mode === 'free') return errorBody('invalid-state', {detail: 'not now'});
        return held.promise;
      });
      const core = await world.connect('bunny/core');
      const threw = await core.request(KEY, setMode('quiet'), {timeoutMs: 5000, requestId: 'req-threw'});
      const refused = await core.request(KEY, setMode('free'), {timeoutMs: 5000, requestId: 'req-refused'});
      const holding = core.request(KEY, setMode('work'), {timeoutMs: 5000, requestId: 'req-holding'});
      await world.arrived('request', 3);
      await flush();
      const expired = await core.request(KEY, setMode('work'), {timeoutMs: 200, requestId: 'req-expired'});
      held.resolve({status: 'accepted'});
      assert.deepEqual([threw.status, refused.status, expired.status, (await holding).status], ['uncertain', 'rejected', 'rejected', 'accepted']);
      await flush();
      const requests = spans.named('bunny.command.request');
      assert.equal(requests.length, 4);
      const [first, second, , fourth] = requests;
      assert.ok(first && second && fourth);
      assert.equal(first.status, 'error', 'an uncertain request');
      assert.equal(family(spans, first).execute[0]?.status, 'error', 'the handler threw');
      assert.equal(second.status, 'unset', 'a typed refusal is no execution failure');
      assert.equal(family(spans, second).execute[0]?.status, 'unset');
      assert.equal(fourth.status, 'error', 'an expiry');
      assert.equal(family(spans, fourth).queue[0]?.status, 'error');
      assert.deepEqual(family(spans, fourth).execute, [], 'an expired command never ran');
      assert.ok(spans.spans.every(span => ended(span)), 'every span ended');
      assert.equal(JSON.stringify(spans.spans).includes('tok_SYNTHETIC123'), false);
    });
  });

  it(name('concurrent requests from two traces have their own request, queue and execute spans'), async () => {
    const spans = new RecordedSpans();
    await using(transport, {spans}, async world => {
      const held = deferred<Reply>();
      await world.local('bunny/wall').respond<Mode>(KEY, () => held.promise);
      const core = await world.connect('bunny/core');
      const both = [core.request(KEY, setMode('work'), {timeoutMs: 5000, parent: PARENT}), core.request(KEY, setMode('free'), {timeoutMs: 5000, parent: OTHER})];
      await world.arrived('request', 2);
      await flush();
      held.resolve({status: 'accepted'});
      await Promise.all(both);
      await flush();
      const requests = spans.named('bunny.command.request');
      assert.deepEqual(requests.map(span => span.traceId).sort(), [PARENT, OTHER].map(parent => trace(parent.traceparent).traceId).sort());
      for (const request of requests) {
        const {queue, execute} = family(spans, request);
        assert.equal(queue.length, 1, `one queue span in trace ${request.traceId}`);
        assert.equal(execute.length, 1, `one execute span in trace ${request.traceId}`);
      }
      assert.equal(spans.named('bunny.command.queue').length, 2, 'no span joined the other trace');
    });
  });
}

suite(inProcess);
suite(remote);

it('a recorder that throws or answers with a malformed context never reaches the work', async () => {
  const broken: SpanRecorder = {start: () => { throw new Error('the tracer is gone'); }};
  const malformed: SpanRecorder = {start: () => ({context: {traceparent: 'not a traceparent'}, end: () => { throw new Error('gone'); }})};
  for (const spans of [broken, malformed]) {
    const bus = new InProcessBus({spans});
    await bus.connect('bunny/wall').respond<Mode>(KEY, () => ({status: 'accepted'}));
    const result = await bus.connect('bunny/core').request(KEY, setMode('work'), {timeoutMs: 1000, parent: PARENT});
    assert.equal(result.status, 'accepted');
    if (result.status === 'accepted') assert.equal(trace(result.reply.traceparent).traceId, trace(PARENT.traceparent).traceId, 'the trace goes on');
  }
  const span = startSpan(malformed, 'bunny.device.call', {parent: PARENT});
  assert.equal(trace(span.context.traceparent).traceId, trace(PARENT.traceparent).traceId);
  assert.doesNotThrow(() => { span.end('error'); });
});

it('a lost parent is found: a span whose parent no recorded span or message has', async () => {
  const spans = new RecordedSpans();
  const request = spans.start('bunny.command.request', {parent: PARENT});
  spans.start('bunny.command.execute', {parent: request.context}).end();
  spans.start('bunny.device.call', {parent: {traceparent: '00-0af7651916cd43dd8448eb211c80319c-00000000000000aa-01'}}).end();
  request.end();
  await until(() => true);
  assert.deepEqual(lostParents(spans.spans, [PARENT]).map(span => span.name), ['bunny.device.call']);
});
