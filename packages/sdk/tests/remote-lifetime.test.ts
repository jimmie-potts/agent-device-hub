import assert from 'node:assert/strict';
import {childOf, connectRemote, REMOTE_PATH, REMOTE_SCHEMA, traceFields, type RemoteOptions, type SpanOptions} from '../src/index.js';
import {frame} from '../src/remote-protocol.js';
import {deferred, flush, it, manualClock, peek} from './support.js';
import {startEdge} from './transports.js';

it('the caller-owned subscription lifetime aborts an unfinished registration on loss', async context => {
  const clock = manualClock();
  const opened = deferred<ReadableStreamDefaultController<Uint8Array>>();
  const registering = deferred<AbortSignal | null | undefined>();
  const lost = deferred<void>();
  const calls: string[] = [];
  context.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    calls.push(url.slice(url.lastIndexOf('/') + 1));
    if (url.endsWith('/stream')) return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        opened.resolve(controller);
        controller.enqueue(new TextEncoder().encode(frame('ready', {connection: 'connection'})));
      },
    })));
    registering.resolve(init.signal);
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once: true});
    });
  });
  // The intersection lets this behavioral regression execute before the option exists.
  const options: RemoteOptions & {lifetime: {signal: AbortSignal; onLost: () => void}} = {
    url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
    scheduler: clock.scheduler, liveness: clock.scheduler,
    lifetime: {signal: new AbortController().signal, onLost: () => lost.resolve()},
  };
  const client = await connectRemote(options);
  context.after(() => client.close());
  const registration = client.subscribe('bunny.state.mode.*', () => {});
  const outcome = assert.rejects(registration);
  const signal = await registering.promise;
  assert.ok(signal, 'registration is bound to an abortable fetch');
  (await opened.promise).close();
  await lost.promise;
  await outcome;
  assert.equal(signal.aborted, true);
  assert.deepEqual(calls, ['stream', 'subscribe']);
});

it('the caller-owned lifetime refuses to follow stream redirects', async context => {
  let redirect: RequestRedirect | undefined;
  context.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    redirect = init.redirect;
    return Promise.resolve(new Response(JSON.stringify({schema: REMOTE_SCHEMA}), {status: 302}));
  });
  const options: RemoteOptions & {lifetime: {signal: AbortSignal; onLost: () => void}} = {
    url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
    lifetime: {signal: new AbortController().signal, onLost: () => {}},
  };
  await assert.rejects(connectRemote(options));
  assert.equal(redirect, 'error');
});

it('registration and live cleanup carry strict redirects and the bound call signal', async context => {
  const clock = manualClock();
  const parent = childOf(undefined);
  const seen: {route: string; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined; traceparent: string | null}[] = [];
  context.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    const route = url.slice(url.lastIndexOf('/') + 1);
    seen.push({route, redirect: init.redirect, signal: init.signal, traceparent: new Headers(init.headers).get('traceparent')});
    if (route === 'stream') return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame('ready', {connection: 'connection'}))); },
    })));
    return Promise.resolve(Response.json({schema: REMOTE_SCHEMA, status: route === 'subscribe' ? 'subscribed' : 'closed'}));
  });
  const client = await connectRemote({url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
    scheduler: clock.scheduler, liveness: clock.scheduler, lifetime: {signal: new AbortController().signal, onLost: () => {}, parent}});
  context.after(() => client.close());
  const subscription = await client.subscribe('bunny.state.mode.*', () => {});
  await subscription.close();
  assert.deepEqual(seen.map(call => [call.route, call.redirect, call.signal instanceof AbortSignal]),
    [['stream', 'error', true], ['subscribe', 'error', true], ['close', 'error', true]]);
  const contexts = seen.map(({traceparent}) => traceFields({traceparent: traceparent ?? ''}));
  assert.ok(contexts.every(trace => trace?.traceId === traceFields(parent)?.traceId));
  assert.equal(new Set(contexts.map(trace => trace?.spanId)).size, 3);
});

it('the caller-owned lifetime aborts an initial fetch and has no reconnect timer', async context => {
  const clock = manualClock(), cancel = new AbortController();
  const opened = deferred<AbortSignal>();
  let attempts = 0;
  context.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    attempts += 1;
    const signal = init.signal;
    assert.ok(signal);
    opened.resolve(signal);
    return new Promise<Response>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once: true});
    });
  });
  const result = assert.rejects(connectRemote({url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
    scheduler: clock.scheduler, liveness: clock.scheduler, lifetime: {signal: cancel.signal, onLost: () => { assert.fail('no initial stream was live'); }}}));
  const signal = await opened.promise;
  cancel.abort();
  await result;
  clock.advance(120_000);
  assert.equal(signal.aborted, true);
  assert.equal(attempts, 1);
  assert.equal(clock.pending(), 0);
});

for (const kind of ['ready schema', 'duplicate ready', 'oversize', 'registration acknowledgment']) {
  it(`the caller-owned client retires an invalid ${kind}`, async context => {
    const clock = manualClock(), lost = deferred<void>(), text = new TextEncoder();
    const ready = frame('ready', {connection: 'connection'});
    const opened = deferred<ReadableStreamDefaultController<Uint8Array>>();
    let calls = 0;
    context.mock.method(globalThis, 'fetch', (url: string) => {
      calls += 1;
      if (!url.endsWith('/stream')) return Promise.resolve(Response.json({status: 'subscribed'}));
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          opened.resolve(controller);
          controller.enqueue(text.encode(kind === 'ready schema' ? ready.replace(REMOTE_SCHEMA, 'wrong') : ready));
        },
      })));
    });
    const connecting = connectRemote({url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
      scheduler: clock.scheduler, liveness: clock.scheduler, lifetime: {signal: new AbortController().signal, onLost: () => lost.resolve()}});
    if (kind === 'ready schema') await assert.rejects(connecting, /invalid remote stream frame/);
    else {
      const client = await connecting;
      context.after(() => client.close());
      if (kind === 'registration acknowledgment') await assert.rejects(client.subscribe('bunny.state.mode.*', () => {}), /invalid subscription acknowledgment/);
      else (await opened.promise).enqueue(text.encode(kind === 'duplicate ready' ? ready : 'x'.repeat(320 * 1024 + 1)));
      await lost.promise;
    }
    clock.advance(120_000);
    assert.equal(calls, kind === 'registration acknowledgment' ? 2 : 1);
  });
}

it('the authenticated edge correlates stream, subscribe and close without tracing invalid callers', async t => {
  const clock = manualClock(), parent = childOf(undefined);
  const spans: {options: SpanOptions; ended: boolean}[] = [];
  const edge = await startEdge({liveness: clock.scheduler, scheduler: clock.scheduler, edgeSpans: {
    start: (_name, options = {}) => {
      const item = {options, ended: false};
      spans.push(item);
      return {context: childOf(options.parent), end: () => { item.ended = true; }};
    },
  }});
  t.after(() => edge.close());
  const source = 'bunny/wall', token = edge.tokens.get(source);
  assert.notEqual(token, undefined);
  if (token === undefined) throw new Error('missing synthetic credential');
  const client = await connectRemote({url: edge.url, source, token, scheduler: clock.scheduler, liveness: clock.scheduler,
    lifetime: {signal: new AbortController().signal, parent, onLost: () => {}}});
  t.after(() => client.close());
  const subscription = await client.subscribe('bunny.state.mode.*', () => {});
  await subscription.close();
  const traceId = traceFields(parent)?.traceId;
  assert.deepEqual(spans.map(span => [span.options.attributes?.['http.route'], span.ended]),
    [['/api/sdk/v1/stream', true], ['/api/sdk/v1/subscribe', true], ['/api/sdk/v1/close', true]]);
  for (const span of spans) assert.equal(traceFields(span.options.parent ?? {traceparent: ''})?.traceId, traceId);
  const connected = edge.diagnostics.find(record => record.event === 'edge.connected');
  assert.equal(traceFields(connected?.trace ?? {traceparent: ''})?.traceId, traceId);
  const wrong = await fetch(edge.url + REMOTE_PATH + '/stream', {headers: {traceparent: parent.traceparent}});
  assert.equal(wrong.status, 401);
  await wrong.body?.cancel();
  const malformed = await fetch(edge.url + REMOTE_PATH + '/subscribe', {method: 'POST',
    headers: {authorization: `Bearer ${token}`, traceparent: 'malformed'},
    body: JSON.stringify({schema: REMOTE_SCHEMA, connection: 'unknown', id: 'synthetic', pattern: 'bunny.state.mode.*'})});
  assert.equal(malformed.status, 404);
  await malformed.body?.cancel();
  assert.equal(spans.length, 3);
  assert.ok(edge.diagnostics.filter(record => record.event === 'edge.refused').every(record => record.trace === undefined));
  const ordinary = await connectRemote({url: edge.url, source, token, scheduler: clock.scheduler, liveness: clock.scheduler});
  const defaultSubscription = await ordinary.subscribe('bunny.state.mode.*', () => {});
  await defaultSubscription.close();
  await ordinary.close();
  assert.equal(spans.length, 3);
});

it('a rejected registration retires transport and participant close waits for the pre-ack handler', async t => {
  const clock = manualClock(), ready = deferred<ReadableStreamDefaultController<Uint8Array>>();
  const acknowledgment = deferred<Response>(), entered = deferred<void>(), finish = deferred<void>();
  const encoder = new TextEncoder();
  let streamSignal: AbortSignal | null | undefined, lost = 0;
  let closing: Promise<string> | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/stream')) {
      streamSignal = init.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          ready.resolve(controller);
          controller.enqueue(encoder.encode(frame('ready', {connection: 'connection'})));
        },
      }));
    }
    if (typeof init.body !== 'string') throw new Error('expected a JSON subscription call');
    const sent: unknown = JSON.parse(init.body);
    assert.ok(typeof sent === 'object' && sent !== null && 'id' in sent && typeof sent.id === 'string');
    (await ready.promise).enqueue(encoder.encode(frame('message', {subscription: sent.id, message: {id: 'synthetic'}})));
    return acknowledgment.promise;
  });
  const client = await connectRemote({url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
    scheduler: clock.scheduler, liveness: clock.scheduler,
    lifetime: {signal: new AbortController().signal, onLost: () => {
      lost += 1;
      closing = client.close().then(() => 'closed');
    }}});
  t.after(async () => { finish.resolve(); await client.close(); });
  const result = assert.rejects(client.subscribe('bunny.state.mode.*', async () => {
    entered.resolve();
    await finish.promise;
  }), /invalid subscription acknowledgment/);
  await entered.promise;
  acknowledgment.resolve(Response.json({schema: REMOTE_SCHEMA, status: 'wrong'}));
  await flush();
  const abortedWhileEntered = streamSignal?.aborted, lossWhileEntered = lost;
  const closedWhileEntered = closing === undefined ? undefined : await peek(closing);
  const refusedWhileEntered = await peek(result.then(() => 'refused'));
  finish.resolve();
  await result;
  assert.equal(abortedWhileEntered, true);
  assert.equal(lossWhileEntered, 1);
  assert.equal(closedWhileEntered, undefined);
  assert.equal(refusedWhileEntered, undefined);
  assert.equal(await closing, 'closed');
  assert.equal(lost, 1);
});
