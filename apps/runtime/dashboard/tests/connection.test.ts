// The dashboard's link to the runtime (Hub #922) with a scripted participant and a manual scheduler: a refused or
// failed sync is tried again after 1 s, doubling to 30 s, while the page keeps its last records marked stale, and an
// answer that says the runtime no longer takes this browser's session ends the link with no retry.
import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Diagnostic, RemoteParticipant, Scheduler, SyncChange, SyncResult, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {startSync, type SyncAnswer, type SyncHandler, type SyncOptions, type SyncTransport} from '../../../../packages/sdk/dist/src/sync.js';
import {DashboardConnection} from '../src/connection.ts';

/** One already authenticated shell with a module that owns a feature family. No listener or second connection. */
async function moduleConnection(context: TestContext, control = true) {
  const requests: {path: string; init: RequestInit}[] = [];
  context.mock.method(globalThis, 'fetch', (path: string, init: RequestInit = {}) => {
    requests.push({path, init});
    if (path === '/api/v2/modules') return Promise.resolve(Response.json({schema: 'module-list/2.0', modules: [
      {name: 'pixoo', state: 'running', serves: ['pixoo-library'], pages: []},
    ]}));
    if (path.includes('/authority')) return Promise.resolve(Response.json({}, {status: control ? 200 : 403}));
    return Promise.resolve(Response.json({schema: 'module-settings/2.0', settings: {}}));
  });
  const script = scripted(['synced'], () => 0);
  let connects = 0;
  const connection = new DashboardConnection({url: 'http://127.0.0.1:1', connect: () => { connects += 1; return Promise.resolve(script.participant); }});
  context.after(() => connection.close());
  await connection.start();
  await new Promise(resolve => { setImmediate(resolve); });
  assert.equal(connection.getState().runtime.modules?.[0]?.name, 'pixoo');
  return {connection, script, requests, connects: () => connects};
}

void test('a module page shares the shell participant and closes both active and late sync copies on unmount', async context => {
  const {connection, script, connects} = await moduleConnection(context);
  let closed = 0;
  const copy = {states: () => [], get: () => undefined, close: () => { closed += 1; return Promise.resolve(); }};
  const answer = {status: 'synced', copy, message: {data: {requestId: 'module-sync', revision: 1, members: []}}} as unknown as SyncResult<unknown>;
  const calls: {families: readonly string[]; owner?: string}[] = [];
  context.mock.method(script.participant, 'sync', (families: readonly string[], _handler: unknown, options: {owner?: string}) => {
    calls.push({families, ...options.owner === undefined ? {} : {owner: options.owner}});
    return Promise.resolve(answer);
  });
  const page = connection.openModule('pixoo');
  assert.equal((await page.api.sync(['pixoo-library'], () => {})).status, 'synced');
  await page.close();
  assert.equal(closed, 1);
  assert.deepEqual(calls, [{families: ['pixoo-library'], owner: 'bunny/modules/pixoo'}]);
  assert.equal(connects(), 1, 'opening a page never creates another remote participant');

  const next = connection.openModule('pixoo');
  let finish: (result: SyncResult<unknown>) => void = () => { throw new Error('sync has not begun'); };
  context.mock.method(script.participant, 'sync', () => new Promise(resolve => { finish = resolve; }));
  const pending = next.api.sync(['pixoo-library'], () => {});
  await next.close();
  finish(answer);
  assert.equal((await pending).status, 'rejected', 'a late copy cannot outlive its page');
  assert.equal(closed, 2);
});

void test('module reads use browser authentication, refuse outside routes and release with the session; read-only commands send nothing', async context => {
  const {connection, requests} = await moduleConnection(context, false);
  const page = connection.openModule('pixoo');
  requests.length = 0;
  assert.deepEqual(await page.api.read('/api/v2/modules/pixoo/settings'), {schema: 'module-settings/2.0', settings: {}});
  assert.equal(requests[0]?.init.credentials, 'same-origin');
  assert.equal(requests[0]?.init.redirect, 'error');
  assert.equal(requests[0]?.init.cache, 'no-store');
  for (const path of ['https://example.invalid/private', '//example.invalid/private', '/dashboard.js']) {
    await assert.rejects(page.api.read(path));
  }
  const result = await page.api.command({family: 'pixoo-playlist-change', target: 'pixoo', requestId: 'edit-1', data: {}});
  assert.ok('error' in result && result.error.code === 'forbidden');
  assert.equal(requests.length, 1, 'invalid reads and a read-only command sent no request');
  const signal = requests[0]?.init.signal;
  await connection.close();
  assert.equal(signal?.aborted, true);
  await assert.rejects(page.api.read('/api/v2/modules/pixoo/settings'));
  assert.equal(requests.length, 1, 'the ended session cannot keep reading');
});

void test('module image reads share scoped authentication and reject executable responses', async context => {
  const {connection} = await moduleConnection(context);
  const page = connection.openModule('pixoo');
  let signal: AbortSignal | null | undefined;
  context.mock.method(globalThis, 'fetch', (_path: string, init: RequestInit) => {
    assert.equal(init.credentials, 'same-origin');
    signal = init.signal;
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'image/png'}}));
  });
  const blob = await page.api.image('/modules/pixoo/content/thumbnail.abc');
  assert.equal(blob.type, 'image/png'); assert.equal(blob.size, 3);
  await assert.rejects(page.api.image('/modules/other/content/thumbnail.abc'));
  await assert.rejects(page.api.image('/api/v2/modules'));
  context.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('<script>bad()</script>', {headers: {'content-type': 'text/html'}})));
  await assert.rejects(page.api.image('/modules/pixoo/content/thumbnail.abc'));
  await page.close(); assert.equal(signal?.aborted, true);
  await assert.rejects(page.api.image('/modules/pixoo/content/thumbnail.abc'));
});

/** Timers that run only when the test moves the clock. */
function manual(): {scheduler: Scheduler; advance: (ms: number) => Promise<void>; now: () => number} {
  let now = 0;
  const timers = new Set<{at: number; run: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, run) => {
      const timer = {at: now + delayMs, run};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: async ms => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) break;
        timers.delete(timer);
        timer.run();
      }
      for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
    },
  };
}

const record = {id: 'b'.repeat(64), revision: 3} as SessionRecord;
const state = {kind: 'state', data: record} as Message<SessionRecord>;

/** A participant whose syncs follow `answers` in turn, `synced` or a refusal's code; it records when each sync came. */
function scripted(answers: readonly ('synced' | ErrorCode)[], at: () => number): {participant: RemoteParticipant; syncs: number[]; closed: () => boolean; fail: (code: ErrorCode) => void} {
  const syncs: number[] = [];
  let handler: ((change: SyncChange<SessionRecord>) => void) | undefined;
  let closed = false;
  const participant = {
    sync: (_families: readonly string[], handle: (change: SyncChange<SessionRecord>) => void): Promise<SyncResult<SessionRecord>> => {
      syncs.push(at());
      handler = handle;
      const answer = answers[syncs.length - 1] ?? 'unavailable';
      if (answer !== 'synced') return Promise.resolve({status: 'rejected', requestId: 'r', error: errorBody(answer, {detail: 'refused'})});
      const copy = {states: () => [state], get: () => state, close: () => Promise.resolve()};
      return Promise.resolve({status: 'synced', copy, message: {data: {requestId: 'r', revision: 3, members: []}, id: `done-${syncs.length}`}} as unknown as SyncResult<SessionRecord>);
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  } as unknown as RemoteParticipant;
  return {participant, syncs, closed: () => closed, fail: code => { handler?.({type: 'failed', error: errorBody(code, {detail: 'gone'})}); }};
}

void test('a sync the core refuses is tried again after 1 s, doubling to 30 s, and the last records stay, marked stale', async () => {
  const clock = manual();
  const script = scripted(['synced', 'unavailable', 'capacity', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'synced'], clock.now);
  const connection = new DashboardConnection({url: 'http://127.0.0.1:1', scheduler: clock.scheduler, now: clock.now, connect: () => Promise.resolve(script.participant)});
  await connection.start();
  assert.deepEqual([connection.getState().feed, connection.getState().sessions.synced, connection.getState().sessions.records], ['connected', true, [record]]);
  // A later sync fails: the copy stops, and the page keeps its records, no longer synced.
  script.fail('unavailable');
  await clock.advance(0);
  assert.deepEqual([connection.getState().sessions.synced, connection.getState().sessions.records, connection.getState().sessions.refused], [false, [record], 'unavailable']);
  for (const wait of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    const before = script.syncs.length;
    await clock.advance(wait - 1);
    assert.equal(script.syncs.length, before, `not before ${wait} ms`);
    await clock.advance(1);
    assert.equal(script.syncs.length, before + 1, `after ${wait} ms`);
    if (script.syncs.length < 8) assert.deepEqual([connection.getState().sessions.synced, connection.getState().sessions.records], [false, [record]], 'kept and stale');
  }
  assert.deepEqual(script.syncs, [0, 1000, 3000, 7000, 15_000, 31_000, 61_000, 91_000], 'one retry loop, capped at 30 s');
  assert.deepEqual([connection.getState().feed, connection.getState().sessions.synced], ['connected', true], 'synced again');
  await connection.close();
});

void test('a sync refused as unauthenticated ends the link at once, with no retry and the last records kept', async () => {
  for (const code of ['unauthenticated', 'forbidden'] as const) {
    const clock = manual();
    const script = scripted(['synced', code], clock.now);
    const connection = new DashboardConnection({url: 'http://127.0.0.1:1', scheduler: clock.scheduler, now: clock.now, connect: () => Promise.resolve(script.participant)});
    await connection.start();
    script.fail('unavailable');
    await clock.advance(1000);
    assert.deepEqual([connection.getState().feed, connection.getState().sessions.records, script.closed()], ['ended', [record], true], code);
    await clock.advance(60_000);
    assert.equal(script.syncs.length, 2, `${code}: never tried again`);
  }
});

void test('retained records stay stale until the SDK replacement snapshot completes, with or without a stream reconnect', async () => {
  for (const reconnect of [true, false]) {
    let diagnose: (value: Diagnostic) => void = () => {};
    let overflow: () => void = () => {};
    let finish: () => void = () => {};
    let requests = 0;
    let copy: SyncedCopy<SessionRecord> | undefined;
    const answer = (requestId: string): SyncAnswer => ({
      status: 'served', requestId,
      states: [{...state, source: 'bunny/core', dataschema: 'https://bunny.invalid/events/session/2.0'}],
      completed: {...state, source: 'bunny/core', id: `done-${requests}`, kind: 'sync-completed',
        data: {requestId, revision: 3, members: [{family: 'session', id: record.id}]}},
    });
    const transport: SyncTransport = {
      now: Date.now,
      subscribe: (_pattern, _handler, options) => {
        overflow = () => { void options.onOverflow?.({}); };
        return Promise.resolve({close: () => Promise.resolve()});
      },
      request: request => {
        requests += 1;
        if (requests === 1) return Promise.resolve(answer(request.requestId));
        return new Promise(resolve => { finish = () => { resolve(answer(request.requestId)); }; });
      },
      report: error => { throw error; },
      restarted: () => { diagnose({event: 'sync.restarted', source: 'bunny/parts/dashboard', level: 'debug'}); },
    };
    const participant = {
      sync: async (families: readonly string[], handler: SyncHandler<SessionRecord>, options: SyncOptions) => {
        const result = await startSync<SessionRecord>(transport, families, handler, options);
        if (result.status === 'synced') copy = result.copy;
        return result;
      },
      close: async () => { await copy?.close(); },
    } as unknown as RemoteParticipant;
    const connection = new DashboardConnection({url: 'http://synthetic.invalid', connect: options => {
      diagnose = options.onDiagnostic ?? (() => {});
      return Promise.resolve(participant);
    }});
    try {
      await connection.start();
      assert.equal(connection.getState().sessions.synced, true);
      if (reconnect) diagnose({event: 'remote.disconnected', source: 'bunny/parts/dashboard', level: 'warn'});
      overflow();
      if (reconnect) diagnose({event: 'remote.reconnected', source: 'bunny/parts/dashboard', level: 'info', attempts: 0});
      await new Promise(resolve => { setImmediate(resolve); });
      assert.equal(requests, 2, 'the real SDK copy requested a replacement snapshot');
      const pending = connection.getState();
      assert.deepEqual([pending.feed, pending.sessions.synced, pending.sessions.records, pending.sessions.syncs],
        ['connected', false, [record], 1], 'stream recovery cannot make retained rows current');
      finish();
      await new Promise(resolve => { setImmediate(resolve); });
      assert.deepEqual([connection.getState().sessions.synced, connection.getState().sessions.syncs], [true, 2], 'only the completed snapshot restores current evidence');
    } finally {
      finish();
      await connection.close();
    }
  }
});
