// Publication on meaning changes and the aging table (Hub #1865 group 9, tasks.md 9.1, design decisions 4 and 5): a
// work observation that changes no public member advances only the session's private progress time and its deadline,
// writing the session row, publishing nothing and adding no history row. Every change of public meaning publishes at a
// new revision, a confirmation change included: running work becomes unconfirmed five minutes after its last qualifying
// evidence on the core's clock, and the core's timer publishes that. Attention, outcomes and idle work never change
// through silence. Everything runs on the runtime's manual clock, with no real wait.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, it, manualClock} from './support.js';

const identity = (sessionId: string, parent?: Identity): {identity: Identity; parent: LifecycleObservation['parent']} => ({
  identity: {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId},
  parent: parent === undefined ? {status: 'unknown'} : {status: 'known', identity: parent},
});
const ROOT = identity('progress-root'), WAITING = identity('progress-waiting');
const DEADLINE_MS = 300_000;
const started: LifecycleEvent = {kind: 'turn-started'}, ended: LifecycleEvent = {kind: 'turn-ended'}, progress: LifecycleEvent = {kind: 'activity-observed'};
const question = (id: string): LifecycleEvent => ({kind: 'question-continuing', attention: {status: 'known', id}});

async function open(context: TestContext): Promise<World> {
  const wrap = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
  return World.open(context, {clock: manualClock(START), wrap});
}

let native = 0;
/** Takes one observation of `who` on `turn` through the store's intake and gives its outcome word. */
async function take(w: World, who: typeof ROOT, event: LifecycleEvent, turn: string | null = 'turn-1'): Promise<string> {
  const data: LifecycleObservation = {
    identity: who.identity, parent: who.parent, turn: turn === null ? {status: 'unknown'} : {status: 'known', id: turn}, event,
    observedAtMs: w.clock.now(), ordering: {status: 'unknown'}, nativeEventId: `native-${++native}`,
  };
  const result = await w.take(lifecycleMessage(data, w.clock.now()));
  return result.ok ? result.outcome : result.code;
}

const record = (w: World, who: typeof ROOT): Session30Record => {
  const found = w.store.records().find(item => item.id === sessionEntityId(who.identity));
  assert.ok(found, `${who.identity.sessionId} is held`);
  return found;
};
const status = (item: Session30Record): string => `${item.status.class}/${item.status.detail}`;
/** The session states published since `from`, by session. */
const states = (w: World, from: number): string[] =>
  w.since(from).filter(message => message.type === 'org.bunny.session.updated').map(message => (message.data as Session30Record).identity.sessionId);
const historyRows = (w: World): number => (w.rows('SELECT seq FROM core_history WHERE family = \'session\'') as unknown[]).length;
/** Moves the manual clock and runs what fell due, as the core's timer does. */
async function advance(w: World, ms: number): Promise<void> {
  w.clock.advance(ms);
  await w.store.refresh();
  await w.store.drain();
}

it('a burst of progress publishes once: the rest advance only the private progress time, with no revision and no history row', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  await w.store.drain();
  const first = record(w, ROOT);
  assert.equal(status(first), 'working/confirmed');
  const from = w.published.length, rows = historyRows(w);
  let lastAt = 0;
  for (let i = 0; i < 10; i++) {
    w.clock.advance(5000);
    assert.equal(await take(w, ROOT, progress), 'applied');
    lastAt = w.clock.now();
  }
  await w.store.drain();
  assert.deepEqual(states(w, from), [], 'ten qualifying observations within a minute publish nothing');
  assert.equal(historyRows(w), rows, 'and add no history row');
  assert.deepEqual(record(w, ROOT), first, 'the record keeps its revision and the instants of its last published change');
  const stored = w.store.sessions().find(session => session.id === first.id);
  assert.equal(stored?.progressAtMs, lastAt, 'the private progress time is the last qualifying evidence');
  assert.equal(stored?.lastEvidenceAtMs, lastAt);
  assert.equal(w.store.nextDue(), lastAt + DEADLINE_MS, 'the work deadline moved to five minutes after the last');

  // A millisecond before the deadline nothing is published; at it the core's timer publishes the confirmation change.
  await advance(w, lastAt + DEADLINE_MS - 1 - w.clock.now());
  assert.deepEqual(states(w, from), []);
  await advance(w, 1);
  assert.deepEqual(states(w, from), [ROOT.identity.sessionId], 'the deadline is a change of meaning');
  const unconfirmed = record(w, ROOT);
  assert.equal(status(unconfirmed), 'working/unconfirmed');
  assert.deepEqual(unconfirmed.work.reasons, ['deadline']);
  assert.ok(unconfirmed.revision > first.revision);
  assert.equal(unconfirmed.lastEvidenceAtMs, lastAt, 'a published change shows the evidence time it rests on');
  assert.equal(historyRows(w), rows + 1, 'history keeps it');

  // Qualifying evidence on the current turn confirms the work again, which publishes too.
  const before = w.published.length;
  w.clock.advance(1000);
  assert.equal(await take(w, ROOT, progress), 'applied');
  await w.store.drain();
  assert.deepEqual(states(w, before), [ROOT.identity.sessionId]);
  assert.equal(status(record(w, ROOT)), 'working/confirmed');
  assert.ok(record(w, ROOT).revision > unconfirmed.revision);
  assert.equal(historyRows(w), rows + 2);
});

it('a question after its turn ended is not republished by silence, and one under a running turn changes only its work claim', async context => {
  const w = await open(context);
  // The waiting session's turn ended on its question: its work is idle, so silence has nothing to age.
  assert.equal(await take(w, WAITING, started), 'applied');
  assert.equal(await take(w, WAITING, question('q1')), 'applied');
  assert.equal(await take(w, WAITING, ended), 'applied');
  // The root's turn still runs under its question.
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, ROOT, question('q2')), 'applied');
  await w.store.drain();
  const waiting = record(w, WAITING), running = record(w, ROOT);
  assert.deepEqual([status(waiting), status(running)], ['needs-owner/question', 'needs-owner/question']);
  const from = w.published.length;
  await advance(w, 10 * 60_000);
  assert.deepEqual(states(w, from), [ROOT.identity.sessionId], 'ten minutes of silence publish only the running work\'s deadline');
  assert.deepEqual(record(w, WAITING), waiting, 'the waiting session is not republished');
  const aged = record(w, ROOT);
  assert.equal(status(aged), 'needs-owner/question', 'both still need the owner');
  assert.deepEqual([aged.work.confidence, aged.work.reasons, aged.attention.confidence], ['unconfirmed', ['deadline'], 'confirmed']);
  // Nothing more falls due but expiry.
  assert.equal(w.store.nextDue(), Math.min(waiting.lastEvidenceAtMs, running.lastEvidenceAtMs) + 86_400_000);
  await advance(w, 60 * 60_000);
  assert.deepEqual(states(w, from), [ROOT.identity.sessionId]);
});

it('late evidence for another turn, and evidence that is not work, leave unconfirmed work unconfirmed', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started, 'turn-1'), 'applied');
  assert.equal(await take(w, ROOT, ended, 'turn-1'), 'applied');
  assert.equal(await take(w, ROOT, started, 'turn-2'), 'applied');
  await advance(w, DEADLINE_MS);
  assert.equal(status(record(w, ROOT)), 'working/unconfirmed');
  const from = w.published.length, revision = record(w, ROOT).revision;
  // A tool result for the ended turn is stale: nothing changes and nothing is published.
  assert.equal(await take(w, ROOT, progress, 'turn-1'), 'stale');
  await w.store.drain();
  assert.deepEqual(states(w, from), []);
  assert.equal(record(w, ROOT).revision, revision);
  // A question on the current turn is evidence, but not of work: it publishes for its attention, and work stays unconfirmed.
  assert.equal(await take(w, ROOT, question('q1'), 'turn-2'), 'applied');
  assert.deepEqual([status(record(w, ROOT)), record(w, ROOT).work.reasons], ['needs-owner/question', ['deadline']]);
});

it('a root with one confirmed and one unconfirmed child is working through its subagent', async context => {
  const w = await open(context);
  const first = identity('progress-child-a', ROOT.identity), second = identity('progress-child-b', ROOT.identity);
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, ROOT, ended), 'applied');
  assert.equal(await take(w, second, {kind: 'session-started'}, 'child-turn'), 'applied');
  w.clock.advance(DEADLINE_MS - 1000);
  assert.equal(await take(w, first, {kind: 'session-started'}, 'child-turn'), 'applied');
  await advance(w, 1000);
  const root = record(w, ROOT);
  assert.deepEqual(root.relationships.children, {working: 1, unconfirmed: 1});
  assert.equal(status(root), 'working/subagent');
  assert.deepEqual([status(record(w, first)), status(record(w, second))], ['working/confirmed', 'working/unconfirmed']);
});

it('records a release before the switch published are published again as session/3.0 at the first start, against their last history row', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, WAITING, started), 'applied');
  assert.equal(await take(w, WAITING, ended), 'applied');
  await w.store.drain();
  // What a step-8 release left: each session's published record in the session/2.0 shape.
  for (const item of w.store.records()) {
    const {status: _status, work, attention, outcome, relationships, ...rest} = item;
    const old = {...rest, activity: work.state, attention: attention.items, notices: outcome.notices, read: outcome.read, freshness: 'current',
      restartUncertain: false, children: {active: relationships.children.working, uncertain: relationships.children.unconfirmed}};
    w.db.prepare('UPDATE core_records SET record = ? WHERE family = \'session\' AND id = ?').run(JSON.stringify(old), item.id);
  }
  const from = w.published.length, revision = w.store.revision, rows = historyRows(w);
  w.clock.advance(1000);
  await w.crashAndRestart();
  await w.store.drain();
  const sent = w.since(from).filter(message => message.type === 'org.bunny.session.updated');
  assert.deepEqual(sent.map(message => message.dataschema), ['https://bunny.invalid/events/session/3.0', 'https://bunny.invalid/events/session/3.0']);
  assert.equal(new Set(sent.map(message => (message.data as Session30Record).revision)).size, 1, 'at one new revision');
  assert.ok(w.store.revision > revision);
  assert.deepEqual(w.store.records().map(status).sort(), ['finished/turn-ended', 'working/unconfirmed']);
  assert.equal(historyRows(w), rows + 2, 'history keeps each as a change against its last row');
  assert.deepEqual(w.since(from).filter(message => message.kind === 'occurrence'), [], 'and no occurrence');
});
