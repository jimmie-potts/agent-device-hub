import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentState, MemoryStorage } from '@jimmie-potts/agent-state';
import { normalizeHook } from '@jimmie-potts/agent-state/providers';
import { TidbytController, TidbytStatusPublisher, renderFrame, statusFrame, statusView } from '../dist/index.js';

const CAPABILITIES = {
  backend: 'tidbyt-cloud', backgroundPush: { supported: true }, foregroundPush: { supported: false },
  installationRead: { supported: true }, installationRemove: { supported: true },
};
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function fakeConnection({ push = () => ({ outcome: 'sent' }), remove = () => ({ outcome: 'sent' }), read = () => ({ ok: true, present: true }) } = {}) {
  const state = { pushes: [], removals: 0, reads: 0 };
  return {
    state,
    capabilities: CAPABILITIES,
    async push(webp) { state.pushes.push(webp); return push(state.pushes.length); },
    async remove() { state.removals++; return remove(state.removals); },
    async readInstallation() { state.reads++; return read(state.reads); },
  };
}

/** Deterministic timers on a fake monotonic clock. */
function fakeTimers(clock) {
  const pending = new Set();
  return {
    pending,
    setTimeout(callback, ms) { const timer = { at: clock.now + ms, callback }; pending.add(timer); return timer; },
    clearTimeout(timer) { pending.delete(timer); },
  };
}

const ownerClock = { now: 1000 };
const source = session => ({ provider: 'claude', client: 'code', hostId: 'host', sourceId: 'source', sessionId: session });
const hook = (name, session, turn) => normalizeHook({ session_id: session, turn_id: turn, prompt_id: turn }, { ...source(session), hook: name }, ++ownerClock.now);
const approval = (session, turn) => ({ ...hook('PermissionRequest', session, turn), event: { kind: 'attention.approval', attention: { status: 'known', id: `ask-${session}` } } });

async function setup(t, { connection = fakeConnection(), feed, publisher: extra = {} } = {}) {
  const clock = { now: 0 };
  const timers = fakeTimers(clock);
  const owner = await createAgentState({
    storage: new MemoryStorage(), ownerId: 'owner', clock: () => ownerClock.now,
    consumers: [{ id: 'tidbyt', clearOnNewTurn: false }, { id: 'pixoo', clearOnNewTurn: true }],
  });
  t.after(() => owner.shutdown());
  const controller = new TidbytController({ controllerId: 'tidbyt-main', deviceId: 'tidbyt', sourceId: 'tidbyt-cloud', epoch: 'epoch-1', connection, now: () => clock.now });
  const publisher = new TidbytStatusPublisher({
    feed: feed?.(owner) ?? { snapshot: () => owner.snapshot(), subscribe: () => owner.subscribe('tidbyt') },
    controller, now: () => clock.now, timers, ...extra,
  });
  t.after(() => publisher.stop());
  const settle = async () => {
    for (let i = 0; i < 10; i++) { await new Promise(resolve => setImmediate(resolve)); await publisher.whenIdle(); }
  };
  /** Advance the clock, firing due timers in order. */
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
  const ingest = async envelope => { assert.equal((await owner.ingest(envelope)).ok, true); await settle(); };
  const expected = options => renderFrame(statusFrame(statusView(owner.snapshot(), options))).webp;
  return { owner, controller, publisher, connection, clock, settle, advance, ingest, expected };
}

test('multiple sessions from a real agent-state owner are pushed as one status frame', async t => {
  const s = await setup(t);
  await s.ingest(hook('UserPromptSubmit', 'work', 'w1'));
  await s.ingest(hook('UserPromptSubmit', 'done', 'd1'));
  await s.ingest(hook('Stop', 'done', 'd1'));
  await s.ingest(approval('asks', 'a1'));
  await s.owner.setLabel(source('asks'), 'review-bot');
  s.publisher.start();
  await s.settle();
  assert.equal(s.connection.state.pushes.length, 1);
  assert.deepEqual(s.connection.state.pushes[0], s.expected());
  const rows = s.publisher.state().view.rows;
  assert.deepEqual(rows.map(row => row.state), ['ASK', 'RUN', 'DONE']);
  assert.equal(rows[0].label, 'REVIEW-BOT');
  assert.equal(s.publisher.state().installation, 'present');
  assert.equal(s.connection.state.removals, 0);
});

test('changes within 15 s coalesce into one later push of the latest state', async t => {
  const s = await setup(t);
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.settle();
  assert.equal(s.connection.state.pushes.length, 1);
  for (const name of ['two', 'three', 'four']) {
    await s.advance(SECOND);
    await s.ingest(hook('UserPromptSubmit', name, 't1'));
  }
  assert.equal(s.connection.state.pushes.length, 1, 'no push inside the minimum interval');
  await s.advance(15 * SECOND - 3 * SECOND - 1);
  assert.equal(s.connection.state.pushes.length, 1);
  await s.advance(1);
  assert.equal(s.connection.state.pushes.length, 2);
  assert.deepEqual(s.connection.state.pushes[1], s.expected(), 'the push shows the latest state');
  assert.equal(s.publisher.state().view.rows.length, 4);
  await s.advance(MINUTE);
  assert.equal(s.connection.state.pushes.length, 2, 'no further push without a change');
});

test('an unchanged frame is pushed again only after 10 minutes', async t => {
  const s = await setup(t);
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.settle();
  await s.advance(10 * MINUTE - 1);
  assert.equal(s.connection.state.pushes.length, 1);
  await s.advance(1);
  assert.equal(s.connection.state.pushes.length, 2);
  assert.deepEqual(s.connection.state.pushes[1], s.connection.state.pushes[0]);
});

test('the installation is removed once when nothing is working, waiting or unacknowledged', async t => {
  const s = await setup(t);
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.settle();
  await s.advance(20 * SECOND);
  await s.ingest(hook('Stop', 'one', 't1'));
  assert.equal(s.connection.state.pushes.length, 2, 'the completed turn shows DONE');
  assert.deepEqual(s.publisher.state().view.rows.map(row => row.state), ['DONE']);
  const [session] = s.owner.snapshot().sessions;
  await s.advance(20 * SECOND);
  await s.owner.acknowledge(session.identity, session.notices[0].id, 'pixoo');
  await s.settle();
  assert.equal(s.connection.state.removals, 1);
  assert.equal(s.publisher.state().installation, 'absent');
  await s.advance(5 * MINUTE);
  assert.equal(s.connection.state.removals, 1, 'no repeated removal while idle');
  assert.equal(s.connection.state.pushes.length, 2);
});

test('an idle start removes any leftover installation once', async t => {
  const s = await setup(t);
  s.publisher.start();
  await s.settle();
  assert.equal(s.connection.state.removals, 1);
  assert.equal(s.connection.state.pushes.length, 0);
});

test('an unavailable feed dims the last rows and never removes the installation', async t => {
  let fail = false;
  const s = await setup(t, { feed: owner => ({ snapshot: () => { if (fail) throw new Error('feed down'); return owner.snapshot(); } }) });
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.settle();
  fail = true;
  await s.advance(30 * SECOND);
  assert.equal(s.connection.state.pushes.length, 2);
  assert.deepEqual(s.connection.state.pushes[1], s.expected({ feedAvailable: false }));
  assert.equal(s.publisher.state().view.feed, 'unavailable');
  assert.deepEqual(s.publisher.state().view.rows.map(row => row.uncertain), [true]);
  await s.advance(5 * MINUTE);
  assert.equal(s.connection.state.removals, 0);
});

test('a feed with no good snapshot shows FEED ? and a slow feed counts as unavailable', async t => {
  const s = await setup(t, { feed: () => ({ snapshot: () => new Promise(() => {}) }) });
  s.publisher.start();
  await s.advance(3 * SECOND);
  assert.equal(s.connection.state.pushes.length, 1);
  assert.deepEqual(s.publisher.state().view.rows, [{ kind: 'feed' }]);
  assert.equal(s.connection.state.removals, 0);
});

test('a failed push is not replayed; a new request follows no sooner than 15 s later', async t => {
  const connection = fakeConnection({ push: n => n === 1 ? { outcome: 'failed', failure: 'transport-failure', priorEffects: 'none' } : { outcome: 'sent' } });
  const s = await setup(t, { connection });
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.settle();
  const first = s.publisher.state().lastWrite;
  assert.equal(first.outcome, 'failed');
  await s.advance(15 * SECOND - 1);
  assert.equal(connection.state.pushes.length, 1);
  await s.advance(1);
  assert.equal(connection.state.pushes.length, 2);
  const second = s.publisher.state().lastWrite;
  assert.equal(second.outcome, 'sent');
  assert.equal(first.requestId.sequence, 0);
  assert.equal(second.requestId.sequence, 1, 'a fresh request, not a replay');
  assert.deepEqual(connection.state.pushes[1], connection.state.pushes[0]);
});

test('an uncertain push makes installation presence unknown, so a later idle state removes it again', async t => {
  const connection = fakeConnection({ push: () => ({ outcome: 'uncertain' }) });
  const s = await setup(t, { connection });
  s.publisher.start();
  await s.settle();
  assert.equal(connection.state.removals, 1);
  assert.equal(s.publisher.state().installation, 'absent');
  await s.advance(20 * SECOND);
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  assert.equal(connection.state.pushes.length, 1);
  assert.equal(s.publisher.state().installation, 'unknown');
  await s.advance(20 * SECOND);
  await s.ingest(hook('Stop', 'one', 't1'));
  const [session] = s.owner.snapshot().sessions;
  await s.owner.acknowledge(session.identity, session.notices[0].id, 'pixoo');
  await s.advance(MINUTE);
  assert.equal(connection.state.removals, 2);
});

test('stop ends scheduling and the subscription', async t => {
  const s = await setup(t);
  s.publisher.start();
  await s.settle();
  s.publisher.stop();
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  await s.advance(MINUTE);
  assert.equal(s.connection.state.pushes.length, 0);
});

test('an idle start whose installation listing shows it absent sends no removal', async t => {
  const connection = fakeConnection({ read: () => ({ ok: true, present: false }) });
  const s = await setup(t, { connection });
  s.publisher.start();
  await s.settle();
  assert.equal(connection.state.reads, 1);
  assert.equal(connection.state.removals, 0);
  assert.equal(s.publisher.state().installation, 'absent');
  await s.advance(10 * MINUTE);
  assert.equal(connection.state.reads, 1, 'no further reads once absent');
});

test('a failed removal is checked against the listing instead of being resent every 15 s', async t => {
  const connection = fakeConnection({
    remove: () => ({ outcome: 'failed', failure: 'unknown-device', priorEffects: 'none' }),
    read: n => ({ ok: true, present: n === 1 }),
  });
  const s = await setup(t, { connection });
  s.publisher.start();
  await s.settle();
  assert.equal(connection.state.removals, 1);
  assert.equal(s.publisher.state().lastWrite.outcome, 'failed');
  await s.advance(15 * SECOND);
  assert.equal(connection.state.reads, 2);
  assert.equal(connection.state.removals, 1, 'the listing shows the installation gone');
  assert.equal(s.publisher.state().installation, 'absent');
});

test('repeated failed writes back off exponentially up to the refresh period', async t => {
  const connection = fakeConnection({ remove: () => ({ outcome: 'failed', failure: 'invalid-request', priorEffects: 'none' }) });
  const s = await setup(t, { connection });
  s.publisher.start();
  await s.settle();
  const at = [];
  let seen = connection.state.removals;
  for (let second = 1; second <= 60 * 60; second++) {
    await s.advance(SECOND);
    if (connection.state.removals !== seen) { seen = connection.state.removals; at.push(second); }
  }
  assert.deepEqual(at.slice(0, 5), [15, 45, 105, 225, 465]);
  assert(at.slice(6).every((second, i) => second - at[i + 5] === 600), 'capped at the 10 minute refresh period');
  assert(connection.state.removals < 12, `${connection.state.removals} removals in an hour`);
});

test('a faulted collector or an invalid snapshot is an unavailable feed and never removes the installation', async t => {
  for (const bad of [owner => ({ ...owner.snapshot(), collector: 'faulted' }), () => ({})]) {
    const s = await setup(t, { feed: owner => ({ snapshot: () => bad(owner) }) });
    s.publisher.start();
    await s.settle();
    assert.deepEqual(s.publisher.state().view.rows, [{ kind: 'feed' }]);
    assert.equal(s.connection.state.pushes.length, 1);
    await s.advance(5 * MINUTE);
    assert.equal(s.connection.state.removals, 0);
    s.publisher.stop();
  }
});

test('a hung feed read is not started again until it settles', async t => {
  let calls = 0;
  let release;
  const s = await setup(t, { feed: owner => ({ snapshot: () => { calls++; return calls === 1 ? new Promise(resolve => { release = () => resolve(owner.snapshot()); }) : owner.snapshot(); } }) });
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.advance(3 * MINUTE);
  assert.equal(calls, 1);
  assert.equal(s.publisher.state().view.feed, 'unavailable');
  release();
  await s.settle();
  await s.advance(30 * SECOND);
  assert.equal(calls, 2);
  assert.equal(s.publisher.state().view.feed, 'available');
});

test('a failed removal after a sent push reads the listing before deleting again', async t => {
  const connection = fakeConnection({
    remove: () => ({ outcome: 'failed', failure: 'unknown-device', priorEffects: 'none' }),
    read: () => ({ ok: true, present: false }),
  });
  const s = await setup(t, { connection });
  await s.ingest(hook('UserPromptSubmit', 'one', 't1'));
  s.publisher.start();
  await s.settle();
  assert.equal(s.publisher.state().installation, 'present');
  await s.advance(20 * SECOND);
  await s.ingest(hook('Stop', 'one', 't1'));
  const [session] = s.owner.snapshot().sessions;
  await s.advance(20 * SECOND);
  await s.owner.acknowledge(session.identity, session.notices[0].id, 'pixoo');
  await s.advance(20 * SECOND);
  assert.equal(connection.state.removals, 1, 'a present installation is deleted without a listing');
  assert.equal(connection.state.reads, 0);
  await s.advance(MINUTE);
  assert.equal(connection.state.reads, 1);
  assert.equal(connection.state.removals, 1);
  assert.equal(s.publisher.state().installation, 'absent');
  await s.advance(60 * MINUTE);
  assert.equal(connection.state.removals, 1);
});

test('no installation listing is read while the controller holds writes', async t => {
  const connection = fakeConnection({ remove: () => ({ outcome: 'failed', failure: 'unauthenticated', priorEffects: 'none' }) });
  const s = await setup(t, { connection });
  s.publisher.start();
  await s.settle();
  assert.equal(connection.state.reads, 1);
  assert.equal(connection.state.removals, 1);
  assert.equal(s.controller.snapshot().display.holds.authentication, true);
  await s.advance(60 * MINUTE);
  assert.equal(connection.state.reads, 1, 'no listing under the authentication hold');
  assert.equal(connection.state.removals, 1, 'the hold fails removals locally');
});

test('an idle root with an active child session keeps the installation', async t => {
  const s = await setup(t);
  await s.ingest(hook('UserPromptSubmit', 'root', 't1'));
  await s.ingest(normalizeHook({ session_id: 'root', agent_id: 'child1' }, { ...source('root'), hook: 'SubagentStart' }, ++ownerClock.now));
  await s.ingest(hook('Stop', 'root', 't1'));
  const root = s.owner.snapshot().sessions.find(session => session.identity.sessionId === 'root');
  assert.equal(root.activity, 'idle');
  assert.equal(root.children.active, 1);
  await s.owner.acknowledge(root.identity, root.notices[0].id, 'pixoo');
  s.publisher.start();
  await s.advance(5 * MINUTE);
  assert.deepEqual(s.publisher.state().view.rows.map(row => row.state), ['RUN'], 'one row: the root, not the child');
  assert.equal(s.connection.state.removals, 0);
});
