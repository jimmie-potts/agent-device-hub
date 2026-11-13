import assert from 'node:assert/strict';
import {connectRemote, REMOTE_SCHEMA, type RemoteOptions} from '../src/index.js';
import {frame} from '../src/remote-protocol.js';
import {deferred, it, manualClock} from './support.js';

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
  const seen: {route: string; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined}[] = [];
  context.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    const route = url.slice(url.lastIndexOf('/') + 1);
    seen.push({route, redirect: init.redirect, signal: init.signal});
    if (route === 'stream') return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame('ready', {connection: 'connection'}))); },
    })));
    return Promise.resolve(Response.json({schema: REMOTE_SCHEMA, status: route === 'subscribe' ? 'subscribed' : 'closed'}));
  });
  const client = await connectRemote({url: 'https://peer.invalid', source: 'bunny/parts/reader', token: 'synthetic',
    scheduler: clock.scheduler, liveness: clock.scheduler, lifetime: {signal: new AbortController().signal, onLost: () => {}}});
  context.after(() => client.close());
  const subscription = await client.subscribe('bunny.state.mode.*', () => {});
  await subscription.close();
  assert.deepEqual(seen.map(call => [call.route, call.redirect, call.signal instanceof AbortSignal]),
    [['stream', 'error', true], ['subscribe', 'error', true], ['close', 'error', true]]);
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
