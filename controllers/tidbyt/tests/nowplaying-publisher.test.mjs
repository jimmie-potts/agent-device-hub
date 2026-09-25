import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentState, MemoryStorage } from '@jimmie-potts/agent-state';
import { normalizeHook } from '@jimmie-potts/agent-state/providers';
import { validate } from '@jimmie-potts/device-contracts';
import {
  TidbytController, TidbytNowPlayingPublisher, TidbytStatusPublisher, nowPlayingFrame, nowPlayingView, renderFrame,
} from '../dist/index.js';

const CAPABILITIES = {
  backend: 'tidbyt-cloud', backgroundPush: { supported: true }, foregroundPush: { supported: false },
  installationRead: { supported: true }, installationRemove: { supported: true },
};
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function fakeConnection({ push = () => ({ outcome: 'sent' }), remove = () => ({ outcome: 'sent' }), read = () => ({ ok: true, present: true }) } = {}) {
  const state = { writes: [], reads: [] };
  return {
    state,
    capabilities: CAPABILITIES,
    additionalInstallations: ['nowplaying'],
    async push(webp, _signal, installation) { state.writes.push({ kind: 'push', webp, installation }); return push(state.writes.length); },
    async remove(_signal, installation) { state.writes.push({ kind: 'remove', installation }); return remove(state.writes.length); },
    async readInstallation(_signal, installation) { state.reads.push(installation); return read(state.reads.length, installation); },
  };
}

function fakeTimers(clock) {
  const pending = new Set();
  return {
    pending,
    setTimeout(callback, ms) { const timer = { at: clock.now + ms, callback }; pending.add(timer); return timer; },
    clearTimeout(timer) { pending.delete(timer); },
  };
}

const playing = (title = 'Harvest Moon', extra = {}, playback = {}) => ({
  apiVersion: '1.0', sourceId: 'ht-a9', availability: 'available', observedAtMs: 1_790_000_000_000, ageMs: 500,
  playback: { status: 'playing', title, artist: 'Neil Young', controls: ['pause'], ...playback }, ...extra,
});
const stopped = () => playing('Harvest Moon', {}, { status: 'stopped', controls: [] });
const unavailable = () => ({ apiVersion: '1.0', sourceId: 'ht-a9', availability: 'unavailable', observedAtMs: null, ageMs: null, playback: null });

/** A feed whose next answer the test sets; `fail` makes reads throw. */
function scriptedFeed(initial) {
  const feed = { current: initial, fail: false, reads: 0, hang: false };
  feed.snapshot = () => {
    feed.reads++;
    if (feed.hang) return new Promise(() => {});
    if (feed.fail) throw new Error('feed-unavailable');
    return structuredClone(feed.current);
  };
  return feed;
}

function setup(t, { connection = fakeConnection(), feed = scriptedFeed(playing()), clock = { now: 0 }, controller } = {}) {
  const timers = fakeTimers(clock);
  controller ??= new TidbytController({ controllerId: 'tidbyt-main', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', epoch: 'epoch-1', connection, now: () => clock.now });
  const publisher = new TidbytNowPlayingPublisher({ feed, controller, installation: 'nowplaying', now: () => clock.now, timers });
  t.after(() => publisher.stop());
  const settle = async () => {
    for (let i = 0; i < 10; i++) { await new Promise(resolve => setImmediate(resolve)); await publisher.whenIdle(); }
  };
  const advance = async ms => {
    const end = clock.now + ms;
    for (;;) {
      const due = [...timers.pending].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.pending.delete(due);
      clock.now = Math.max(clock.now, due.at);
      due.callback();
      await settle();
    }
    clock.now = end;
    await settle();
  };
  const card = (snapshot, options = { readOk: true, ageMs: 500 }) => renderFrame(nowPlayingFrame(nowPlayingView(snapshot, options))).webp;
  return { connection, controller, publisher, feed, clock, timers, settle, advance, card };
}

test('a playing track is pushed to the now-playing installation through the controller queue', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  assert.equal(s.connection.state.writes.length, 1);
  const [write] = s.connection.state.writes;
  assert.equal(write.kind, 'push');
  assert.equal(write.installation, 'nowplaying');
  assert.deepEqual(write.webp, s.card(playing()));
  const state = s.publisher.state();
  assert.equal(state.installation, 'present');
  assert.equal(state.view.card, true);
  assert(validate('receipt', state.lastWrite));
  assert.equal(s.controller.snapshot().display.pending.length, 0);
});

test('the snapshot is read every 5 seconds', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  await s.advance(20 * SECOND);
  assert.equal(s.feed.reads, 5);
});

test('track changes within 15 seconds coalesce into one later push of the latest track', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  for (const title of ['Old King', 'Unknown Legend', 'Heart of Gold']) {
    s.feed.current = playing(title);
    await s.advance(4 * SECOND);
  }
  assert.equal(s.connection.state.writes.length, 1, 'nothing within the 15 s gate');
  await s.advance(4 * SECOND);
  assert.equal(s.connection.state.writes.length, 2);
  assert.deepEqual(s.connection.state.writes[1].webp, s.card(playing('Heart of Gold')));
});

test('an unchanged card is pushed again only after 10 minutes', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  await s.advance(10 * MINUTE - SECOND);
  assert.equal(s.connection.state.writes.length, 1);
  await s.advance(5 * SECOND);
  assert.equal(s.connection.state.writes.length, 2);
});

test('pausing redraws the card with the pause marker', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  s.feed.current = playing('Harvest Moon', {}, { status: 'paused', controls: [] });
  await s.advance(15 * SECOND);
  assert.equal(s.connection.state.writes.length, 2);
  assert.deepEqual(s.connection.state.writes[1].webp, s.card(s.feed.current));
});

test('stopped, inactive or unavailable playback removes only the now-playing installation', async t => {
  for (const next of [stopped(), playing('x', {}, { status: 'inactive', controls: [] }), unavailable()]) {
    const s = setup(t);
    s.publisher.start();
    await s.settle();
    s.feed.current = next;
    await s.advance(15 * SECOND);
    assert.deepEqual(s.connection.state.writes.map(w => [w.kind, w.installation]), [['push', 'nowplaying'], ['remove', 'nowplaying']]);
    assert.deepEqual(s.connection.state.reads, [], 'presence was known, so no listing read');
    assert.equal(s.publisher.state().installation, 'absent');
    await s.advance(2 * MINUTE);
    assert.equal(s.connection.state.writes.length, 2, 'removal happens once');
  }
});

test('at start with nothing playing, a leftover tile is found through the listing and removed once', async t => {
  const leftover = setup(t, { feed: scriptedFeed(stopped()) });
  leftover.publisher.start();
  await leftover.settle();
  assert.deepEqual(leftover.connection.state.reads, ['nowplaying']);
  assert.deepEqual(leftover.connection.state.writes.map(w => [w.kind, w.installation]), [['remove', 'nowplaying']]);

  const gone = setup(t, { feed: scriptedFeed(unavailable()), connection: fakeConnection({ read: () => ({ ok: true, present: false }) }) });
  gone.publisher.start();
  await gone.settle();
  await gone.advance(MINUTE);
  assert.deepEqual(gone.connection.state.reads, ['nowplaying']);
  assert.deepEqual(gone.connection.state.writes, []);
});

test('a failed read keeps a dimmed card until the observation is 30 seconds old, then removes it', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  s.feed.fail = true;
  await s.advance(15 * SECOND);
  assert.equal(s.connection.state.writes.length, 2);
  assert.deepEqual(s.connection.state.writes[1].webp, s.card(playing(), { readOk: false, ageMs: 15_500 }));
  assert.equal(s.publisher.state().view.stale, true);
  await s.advance(10 * SECOND);
  assert.equal(s.connection.state.writes.length, 2, 'still stale at 25.5 s');
  await s.advance(5 * SECOND);
  assert.deepEqual(s.connection.state.writes.map(w => w.kind), ['push', 'push', 'remove']);
  s.feed.fail = false;
  await s.advance(15 * SECOND);
  assert.deepEqual(s.connection.state.writes.map(w => w.kind), ['push', 'push', 'remove', 'push'], 'a good read brings the card back');
});

test('a stale snapshot is shown dimmed and never removed', async t => {
  const s = setup(t);
  s.publisher.start();
  await s.settle();
  s.feed.current = playing('Harvest Moon', { availability: 'stale', ageMs: 6000 });
  await s.advance(15 * SECOND);
  assert.deepEqual(s.connection.state.writes.map(w => w.kind), ['push', 'push']);
  assert.deepEqual(s.connection.state.writes[1].webp, s.card(s.feed.current, { readOk: true, ageMs: 6000 }));
});

test('a hung read is not repeated while it is outstanding', async t => {
  const s = setup(t);
  s.feed.hang = true;
  s.publisher.start();
  // The first read times out after 3 s and counts as failed; later evaluations skip reading while it hangs.
  await s.advance(20 * SECOND);
  assert.equal(s.feed.reads, 1);
  assert.equal(s.publisher.state().view.card, false);
});

test('failed and uncertain writes are not replayed, and repeated failures back off', async t => {
  const connection = fakeConnection({ push: () => ({ outcome: 'uncertain' }) });
  const s = setup(t, { connection });
  s.publisher.start();
  await s.settle();
  assert.equal(connection.state.writes.length, 1);
  assert.equal(s.publisher.state().installation, 'unknown');
  await s.advance(15 * SECOND);
  assert.equal(connection.state.writes.length, 2, 'a fresh request after the minimum interval');
  await s.advance(29 * SECOND);
  assert.equal(connection.state.writes.length, 2, 'the second failure doubles the wait');
  await s.advance(SECOND);
  assert.equal(connection.state.writes.length, 3);
  const ids = s.controller.snapshot().controller.nextRequestId.sequence;
  assert.equal(ids, 3, 'every write used a new request identity');
});

test('status and now-playing share one controller, each with its own installation and gate', async t => {
  const clock = { now: 0 };
  const connection = fakeConnection();
  const controller = new TidbytController({ controllerId: 'tidbyt-main', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', epoch: 'epoch-1', connection, now: () => clock.now });
  const ownerClock = { now: 1000 };
  const owner = await createAgentState({ storage: new MemoryStorage(), ownerId: 'owner', clock: () => ownerClock.now, consumers: [{ id: 'tidbyt', clearOnNewTurn: false }] });
  t.after(() => owner.shutdown());
  const source = { provider: 'claude', client: 'code', hostId: 'host', sourceId: 'source', sessionId: 'work' };
  assert.equal((await owner.ingest(normalizeHook({ session_id: 'work', turn_id: 't1', prompt_id: 't1' }, { ...source, hook: 'UserPromptSubmit' }, ++ownerClock.now))).ok, true);
  const s = setup(t, { connection, clock, controller });
  const status = new TidbytStatusPublisher({ feed: { snapshot: () => owner.snapshot() }, controller, now: () => clock.now, timers: s.timers });
  t.after(() => status.stop());
  status.start();
  s.publisher.start();
  await s.settle();
  await status.whenIdle();
  assert.deepEqual(connection.state.writes.map(w => [w.kind, w.installation ?? 'default']).sort(), [['push', 'default'], ['push', 'nowplaying']]);
  s.feed.current = playing('Heart of Gold');
  await s.advance(15 * SECOND);
  await status.whenIdle();
  assert.deepEqual(connection.state.writes.map(w => w.installation).filter(Boolean), ['nowplaying', 'nowplaying']);
  assert.equal(connection.state.writes.filter(w => w.installation === undefined).length, 1, 'the unchanged status tile was not pushed again');
  assert.equal(controller.snapshot().controller.nextRequestId.sequence, 3);
});

test('invalid options are rejected', () => {
  const controller = new TidbytController({ controllerId: 'tidbyt-main', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', connection: fakeConnection() });
  const feed = scriptedFeed(playing());
  for (const options of [{ feed, controller }, { feed, controller, installation: 'has-dash' }, { feed: {}, controller, installation: 'nowplaying' },
    { feed, controller, installation: 'nowplaying', pollMs: 0 }]) {
    assert.throws(() => new TidbytNowPlayingPublisher(options), /invalid-now-playing-publisher-options/);
  }
});
