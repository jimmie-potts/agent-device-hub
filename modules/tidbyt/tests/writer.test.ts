// The Tidbyt's one writer (Hub #930): the queue's order, one call in flight, its holds and its close, and the tile
// writer's listing check, copied in substance from controllers/tidbyt/tests/controller.test.mjs and publisher.test.mjs at
// main 627e3fe3. The controller v1 envelope's admission, tickets and replays are not copied: no message carries a frame.
import assert from 'node:assert/strict';
import test from 'node:test';
import {TidbytCloudConnection, type CloudFetch} from '../src/cloud.js';
import {CloudQueue, TileWriter, type TileCall, type TileMemory, type TileTarget, type TileWriterOptions} from '../src/writer.js';
import {flush, manualClock} from './support.js';

type Pending = {url: string; method: string; resolve: (response: Response) => void; signal: AbortSignal};
/** A cloud whose every answer the test gives, so calls can be held in flight. */
function heldCloud(): {fetch: CloudFetch; pending: Pending[]; answer: (status: number, body?: unknown, headers?: Record<string, string>) => void} {
  const pending: Pending[] = [];
  const fetch: CloudFetch = (url, init) => new Promise((resolve, reject) => {
    pending.push({url, method: init.method, resolve, signal: init.signal});
    init.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); }, {once: true});
  });
  const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}): void => {
    const next = pending.shift();
    if (next === undefined) throw new Error('no call waits for an answer');
    next.resolve(new Response(JSON.stringify(body), {status, headers}));
  };
  return {fetch, pending, answer};
}

function queueOn(fetch: CloudFetch, clock = manualClock()): {queue: CloudQueue; clock: ReturnType<typeof manualClock>} {
  const connection = new TidbytCloudConnection({deviceId: 'device', apiKey: 'key', installationId: 'status', additionalInstallationIds: ['card'], fetch});
  return {queue: new CloudQueue({connection, scheduler: clock.scheduler, now: clock.now, timeoutMs: 10_000}), clock};
}
const WEBP = Uint8Array.from([1, 2, 3]);

void test('calls go out one at a time, in the order they were made', async () => {
  const cloud = heldCloud();
  const {queue} = queueOn(cloud.fetch);
  const first = queue.push(WEBP, undefined);
  const second = queue.remove('card');
  const third = queue.list(undefined);
  await flush();
  assert.deepEqual(cloud.pending.map(call => call.method), ['POST'], 'one call in flight');
  cloud.answer(200);
  assert.deepEqual(await first, {outcome: 'sent'});
  await flush();
  assert.deepEqual(cloud.pending.map(call => `${call.method} ${call.url.split('/').at(-1) ?? ''}`), ['DELETE card']);
  cloud.answer(200);
  assert.deepEqual(await second, {outcome: 'sent'});
  await flush();
  cloud.answer(200, {installations: [{id: 'status'}]});
  assert.deepEqual(await third, {ok: true, present: true});
});

void test('a call that outlives its deadline is uncertain, and the deadline runs on the runtime\'s scheduler', async () => {
  const cloud = heldCloud();
  const {queue, clock} = queueOn(cloud.fetch);
  const push = queue.push(WEBP, undefined);
  await flush();
  clock.advance(9999);
  await flush();
  assert.equal(cloud.pending.length, 1);
  clock.advance(1);
  assert.deepEqual(await push, {outcome: 'uncertain', answered: false});
});

void test('closing ends the call in flight, which is uncertain, and every waiting call, which sends nothing', async () => {
  const cloud = heldCloud();
  const {queue} = queueOn(cloud.fetch);
  const inFlight = queue.push(WEBP, undefined);
  const waiting = queue.remove(undefined);
  await flush();
  queue.close();
  assert.deepEqual(await inFlight, {outcome: 'uncertain', answered: false});
  assert.deepEqual(await waiting, {outcome: 'cancelled'});
  assert.equal(cloud.pending.length, 1, 'the waiting call never went out');
  assert.deepEqual(await queue.list(undefined), {outcome: 'cancelled'});
});

void test('a refused key holds every later call without a request; a 429 holds them for its Retry-After', async () => {
  const cloud = heldCloud();
  const {queue} = queueOn(cloud.fetch);
  const refused = queue.push(WEBP, undefined);
  await flush();
  cloud.answer(401);
  assert.deepEqual(await refused, {outcome: 'failed', failure: 'unauthenticated'});
  assert.equal(queue.held(), true);
  assert.deepEqual(await queue.remove('card'), {outcome: 'held', failure: 'unauthenticated'});
  assert.deepEqual(await queue.list(undefined), {outcome: 'held', failure: 'unauthenticated'});
  assert.equal(cloud.pending.length, 0);

  const limited = heldCloud();
  const {queue: second, clock} = queueOn(limited.fetch);
  const first = second.push(WEBP, undefined);
  await flush();
  limited.answer(429, {}, {'retry-after': '30'});
  assert.deepEqual(await first, {outcome: 'failed', failure: 'capacity', retryAfterMs: 30_000});
  assert.equal(second.held(), true);
  const next = second.push(WEBP, 'card');
  await flush();
  clock.advance(29_999);
  await flush();
  assert.equal(limited.pending.length, 0, 'held for Retry-After');
  clock.advance(1);
  await flush();
  assert.equal(limited.pending.length, 1);
  limited.answer(200);
  assert.deepEqual(await next, {outcome: 'sent'});
});

type Harness = {writer: TileWriter; reported: TileCall[]; remembered: TileMemory[]; stopped: {value: boolean}};
function writerOn(queue: CloudQueue, clock: ReturnType<typeof manualClock>, restored?: TileMemory): Harness {
  const reported: TileCall[] = [], remembered: TileMemory[] = [];
  const stopped = {value: false};
  const writer = new TileWriter({
    queue, installation: undefined, render: () => Promise.resolve(WEBP), report: call => { reported.push(call); }, begin: () => () => {},
    remember: memory => { remembered.push(memory); }, stopped: () => stopped.value, minIntervalMs: 15_000, refreshMs: 600_000, pollMs: 30_000,
    now: clock.now, ...(restored === undefined ? {} : {restored}),
  });
  return {writer, reported, remembered, stopped};
}

void test('a removal of an installation whose presence is unknown reads the list first, and a stop meanwhile sends nothing', async () => {
  const cloud = heldCloud();
  const {queue, clock} = queueOn(cloud.fetch);
  const tile = writerOn(queue, clock);
  const writing = tile.writer.write({kind: 'remove'});
  await flush();
  assert.deepEqual(cloud.pending.map(call => call.method), ['GET']);
  tile.stopped.value = true;
  cloud.answer(200, {installations: [{id: 'status'}]});
  assert.equal(await writing, 30_000);
  await flush();
  assert.equal(cloud.pending.length, 0, 'no removal after the stop');

  const absent = queueOn(heldCloud().fetch);
  const gone = heldCloud();
  const listed = queueOn(gone.fetch, absent.clock);
  const writer = writerOn(listed.queue, listed.clock);
  const removal = writer.writer.write({kind: 'remove'});
  await flush();
  gone.answer(200, {installations: []});
  await removal;
  assert.equal(writer.writer.presence, 'absent');
  assert.deepEqual(await writer.writer.write({kind: 'remove'}), 30_000, 'an absent installation is left alone');
  assert.equal(gone.pending.length, 0);
});

void test('a restored tile pushes nothing for its frame until the refresh, and keeps the gate it had', async () => {
  const cloud = heldCloud();
  const {queue, clock} = queueOn(cloud.fetch);
  const now = clock.now();
  const tile = writerOn(queue, clock, {key: 'frame-a', sentAtMs: now - 60_000, lastWriteAtMs: now - 5000, presence: 'present'});
  assert.equal(await tile.writer.write({kind: 'show', key: 'frame-a', request: {tile: 'status', view: {feed: 'available', rows: [], idle: true}}}), 30_000);
  assert.equal(await tile.writer.write({kind: 'show', key: 'frame-b', request: {tile: 'status', view: {feed: 'available', rows: [], idle: true}}}), 10_000,
    'a new frame waits out the gate that began before the restart');
  assert.equal(cloud.pending.length, 0);
  assert.equal(await tile.writer.write({kind: 'hold'}), 30_000, 'a held tile writes nothing');
});

const cardTarget = (key: string): TileTarget => ({kind: 'show', key,
  request: {tile: 'now-playing', view: {card: true, status: 'playing', title: 'SAME', artist: 'TEXT', stale: false}}});
function guardedWriter(queue: CloudQueue, clock: ReturnType<typeof manualClock>,
  overrides: Pick<TileWriterOptions, 'current'> & Partial<Pick<TileWriterOptions, 'render' | 'restored'>> = {}) {
  const remembered: TileMemory[] = [], reported: TileCall[] = [], begun: string[] = [], ended: boolean[] = [];
  const writer = new TileWriter({queue, installation: 'card', render: () => Promise.resolve(WEBP),
    current: overrides.current ?? (() => true),
    report: call => { reported.push(call); }, remember: memory => { remembered.push(memory); },
    begin: call => { begun.push(call); return succeeded => { ended.push(succeeded); }; }, stopped: () => false,
    minIntervalMs: 15_000, refreshMs: 600_000, pollMs: 30_000, now: clock.now, ...overrides});
  return {writer, remembered, reported, begun, ended};
}

for (const operation of ['push', 'remove'] as const) {
  void test(`an obsolete queued ${operation} is discarded after another tile, before sending`, async () => {
    const cloud = heldCloud(); const {queue} = queueOn(cloud.fetch);
    let eligible = true; let begins = 0;
    const blocker = queue.push(WEBP, undefined);
    await flush();
    const sending = (): void => { begins += 1; };
    const waiting = operation === 'push' ? queue.push(WEBP, 'card', sending, () => eligible)
      : queue.remove('card', sending, () => eligible);
    try {
      await flush(); eligible = false; cloud.answer(200); await blocker; await flush();
      assert.equal(cloud.pending.length, 0, 'obsolete work makes no connection call');
      assert.equal(begins, 0, 'discard starts no span/persistence');
      assert.deepEqual(await waiting, {outcome: 'cancelled'});
    } finally { queue.close(); await Promise.all([blocker, waiting]); }
  });
  void test(`an obsolete ${operation} is cancelled before an authentication hold is reported`, async () => {
    const cloud = heldCloud(); const {queue} = queueOn(cloud.fetch);
    const refused = queue.push(WEBP, undefined); await flush(); cloud.answer(401); await refused;
    try {
      const result = operation === 'push' ? await queue.push(WEBP, 'card', undefined, () => false)
        : await queue.remove('card', undefined, () => false);
      assert.deepEqual(result, {outcome: 'cancelled'});
      assert.equal(queue.held(), true, 'discard never clears the real auth hold');
      assert.equal(cloud.pending.length, 0);
    } finally { queue.close(); }
  });
  void test(`an obsolete ${operation} is rechecked after Retry-After, without a request or deadline`, async () => {
    const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
    const limited = queue.push(WEBP, undefined); await flush(); cloud.answer(429, {}, {'retry-after': '30'}); await limited;
    let eligible = true; let begins = 0;
    const sending = (): void => { begins += 1; };
    const waiting = operation === 'push' ? queue.push(WEBP, 'card', sending, () => eligible)
      : queue.remove('card', sending, () => eligible);
    try {
      await flush(); clock.advance(1000); eligible = false; clock.advance(29_000); await flush();
      assert.equal(cloud.pending.length, 0); assert.equal(begins, 0);
      assert.deepEqual(await waiting, {outcome: 'cancelled'});
      assert.equal(clock.pending(), 0, 'no cloud deadline survives the discard');
    } finally { queue.close(); await waiting; }
  });
}

for (const rejected of [false, true]) {
  void test(`superseded ${rejected ? 'rejected' : 'completed'} render preserves the open gate and all memory`, async () => {
    const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
    let resolve: (value: Uint8Array) => void = () => { throw new Error('no render'); };
    let reject: (reason: Error) => void = () => { throw new Error('no render'); };
    let eligible = true;
    const tile = guardedWriter(queue, clock, {current: () => eligible,
      restored: {key: 'old', sentAtMs: clock.now() - 60_000, lastWriteAtMs: clock.now() - 15_000, presence: 'present'},
      render: () => new Promise<Uint8Array>((yes, no) => { resolve = yes; reject = no; })});
    const writing = tile.writer.write(cardTarget('a'));
    try {
      await flush(); clock.advance(2000); eligible = false;
      if (rejected) reject(new Error('synthetic render refusal')); else resolve(WEBP);
      await flush();
      assert.equal(cloud.pending.length, 0);
      assert.equal(await writing, 1, 'discard asks for current target without a failure wait');
      assert.deepEqual(tile.begun, []); assert.deepEqual(tile.reported, []); assert.equal(tile.remembered.length, 0);
      // Re-enable a distinct current observation. Its gate was already open, despite the two-second render wait.
      eligible = true;
      const b = tile.writer.write(cardTarget('b')); await flush(); resolve(WEBP); await flush();
      assert.equal(cloud.pending.length, 1, 'discard did not create another 15-second gate');
      assert.equal(tile.remembered.at(-1)?.presence, 'unknown', 'current write retains crash boundary');
      cloud.answer(200); await b;
      assert.equal(tile.remembered.at(-1)?.key, 'b'); assert.deepEqual(tile.ended, [true]);
    } finally { queue.close(); await writing; }
  });
}

void test('a superseded TileWriter push already queued behind another tile changes no memory or backoff', async () => {
  const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
  const blocker = queue.push(WEBP, undefined); await flush();
  let eligible = true; const tile = guardedWriter(queue, clock, {current: () => eligible});
  const writing = tile.writer.write(cardTarget('a'));
  try {
    await flush(); eligible = false; cloud.answer(200); await blocker; await flush();
    assert.equal(cloud.pending.length, 0); assert.equal(await writing, 1);
    assert.deepEqual(tile.begun, []); assert.deepEqual(tile.reported, []); assert.equal(tile.remembered.length, 0);
    eligible = true; const current = tile.writer.write(cardTarget('b')); await flush();
    assert.equal(cloud.pending.length, 1); cloud.answer(200); await current;
    assert.equal(tile.remembered.at(-1)?.key, 'b');
  } finally { queue.close(); await Promise.all([blocker, writing]); }
});

void test('a real listing keeps its completion gate when its removal target becomes obsolete', async () => {
  const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
  let eligible = true; const tile = guardedWriter(queue, clock, {current: () => eligible});
  const removing = tile.writer.write({kind: 'remove'});
  try {
    await flush(); assert.deepEqual(cloud.pending.map(call => call.method), ['GET']);
    clock.advance(2000); eligible = false; cloud.answer(200, {installations: [{id: 'card'}]});
    await flush();
    assert.equal(cloud.pending.length, 0, 'listing does not authorize an obsolete DELETE');
    assert.equal(await removing, 1);
    assert.deepEqual(tile.begun, ['list']); assert.deepEqual(tile.ended, [true]);
    assert.equal(tile.reported.length, 1); assert.equal(tile.reported[0]?.call, 'list');
    assert.equal(tile.remembered.at(-1)?.lastWriteAtMs, clock.now(), 'persist actual completion time');
    eligible = true;
    assert.equal(await tile.writer.write(cardTarget('b')), 15_000, 'actual list consumed the gate');
    clock.advance(15_000); const current = tile.writer.write(cardTarget('b')); await flush();
    assert.equal(cloud.pending.length, 1); cloud.answer(200); await current;
  } finally { queue.close(); await removing; }
});

void test('a mutation already begun keeps its real outcome and end-based gate after supersession', async () => {
  const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
  let eligible = true; const tile = guardedWriter(queue, clock, {current: () => eligible});
  const writing = tile.writer.write(cardTarget('a'));
  try {
    await flush(); assert.equal(cloud.pending.length, 1);
    assert.equal(tile.remembered.at(-1)?.presence, 'unknown');
    eligible = false; clock.advance(2000); cloud.answer(200); await writing;
    assert.equal(tile.reported.length, 1); assert.deepEqual(tile.ended, [true]);
    assert.deepEqual(tile.remembered.at(-1), {key: 'a', sentAtMs: clock.now(), lastWriteAtMs: clock.now(), presence: 'present'});
    eligible = true; assert.equal(await tile.writer.write(cardTarget('b')), 15_000);
  } finally { queue.close(); await writing; }
});

void test('a queued obsolete TileWriter removal never persists an uncertain deletion or consumes a gate', async () => {
  const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
  const blocker = queue.push(WEBP, undefined); await flush();
  let eligible = true; const tile = guardedWriter(queue, clock, {current: () => eligible,
    restored: {key: 'old', sentAtMs: clock.now() - 60_000, lastWriteAtMs: clock.now() - 15_000, presence: 'present'}});
  const removing = tile.writer.write({kind: 'remove'});
  try {
    await flush(); eligible = false; cloud.answer(200); await blocker; await flush();
    assert.equal(cloud.pending.length, 0); assert.equal(await removing, 1);
    assert.deepEqual(tile.begun, []); assert.equal(tile.remembered.length, 0); assert.deepEqual(tile.reported, []);
    assert.equal(tile.writer.presence, 'present', 'discard did not pretend the installation was removed');
    eligible = true; const current = tile.writer.write(cardTarget('new')); await flush();
    assert.equal(cloud.pending.length, 1); cloud.answer(200); await current;
  } finally { queue.close(); await Promise.all([blocker, removing]); }
});

void test('a superseded mutation that actually began still reports its refused outcome and real gate', async () => {
  const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
  let eligible = true; const tile = guardedWriter(queue, clock, {current: () => eligible});
  const writing = tile.writer.write(cardTarget('a'));
  try {
    await flush(); eligible = false; clock.advance(2000); cloud.answer(401); await writing;
    assert.equal(tile.reported.length, 1); const call = tile.reported[0];
    assert.ok(call?.call === 'push'); assert.equal(call.result.outcome, 'failed');
    assert.deepEqual(tile.ended, [false]); assert.equal(tile.remembered.at(-1)?.lastWriteAtMs, clock.now());
    eligible = true; assert.equal(await tile.writer.write(cardTarget('b')), 15_000);
  } finally { queue.close(); await writing; }
});

void test('a superseded mutation that actually began still reports its uncertain outcome and real gate', async () => {
  const cloud = heldCloud(); const {queue, clock} = queueOn(cloud.fetch);
  let eligible = true; const tile = guardedWriter(queue, clock, {current: () => eligible});
  const writing = tile.writer.write(cardTarget('a'));
  try {
    await flush(); eligible = false; clock.advance(2000); cloud.answer(503); await writing;
    assert.equal(tile.reported.length, 1); const call = tile.reported[0];
    assert.ok(call?.call === 'push'); assert.equal(call.result.outcome, 'uncertain');
    assert.deepEqual(tile.ended, [false]); assert.equal(tile.remembered.at(-1)?.lastWriteAtMs, clock.now());
    eligible = true; assert.equal(await tile.writer.write(cardTarget('b')), 15_000);
  } finally { queue.close(); await writing; }
});
