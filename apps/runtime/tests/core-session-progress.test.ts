// Publication on meaning changes and the aging table (Hub #1865 group 9, design decisions 4 and 5, as Hub #1947 amends
// them): silence changes no claim, and only a core restart leaves running work unconfirmed. A record's evidence time is
// part of its meaning at `SESSION_LIMITS.evidenceResolutionMs`: a work observation that changes no other public member
// writes the session row and publishes nothing until the evidence time is that far past the published one, which then
// publishes at a new revision that history keeps. A busy session therefore publishes for its evidence at most once per
// resolution and an idle one never; the last test measures that. Everything runs on the runtime's manual clock, with no
// real wait.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {SESSION_LIMITS} from '../src/core/session/model.js';
import {CoreStore} from '../src/core/store.js';
import {World, commandMessage, lifecycleMessage} from './fixtures/store-world.js';
import {START, it, manualClock} from './support.js';

const identity = (sessionId: string, parent?: Identity): {identity: Identity; parent: LifecycleObservation['parent']} => ({
  identity: {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId},
  parent: parent === undefined ? {status: 'unknown'} : {status: 'known', identity: parent},
});
const ROOT = identity('progress-root'), WAITING = identity('progress-waiting');
const RESOLUTION_MS = SESSION_LIMITS.evidenceResolutionMs;
const HOUR_MS = 3_600_000;
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
const historyRows = (w: World): number => (w.rows('SELECT seq FROM core_history WHERE type = \'org.bunny.session.updated\'') as unknown[]).length;
/** Moves the manual clock and runs what fell due, as the core's timer does. */
async function advance(w: World, ms: number): Promise<void> {
  w.clock.advance(ms);
  await w.store.refresh();
  await w.store.drain();
}

it('progress within the evidence resolution publishes nothing; evidence a resolution past the published time publishes its time', async context => {
  const w = await open(context);
  assert.equal(RESOLUTION_MS, 60_000, 'the owner\'s candidate resolution: one minute');
  assert.equal(await take(w, ROOT, started), 'applied');
  await w.store.drain();
  const first = record(w, ROOT);
  assert.equal(status(first), 'working/confirmed');
  const from = w.published.length, rows = historyRows(w);
  let lastAt = 0;
  for (let i = 0; i < 11; i++) {
    w.clock.advance(5000);
    assert.equal(await take(w, ROOT, progress), 'applied');
    lastAt = w.clock.now();
  }
  await w.store.drain();
  assert.equal(lastAt - first.lastEvidenceAtMs, RESOLUTION_MS - 5000);
  assert.deepEqual(states(w, from), [], 'eleven qualifying observations within the resolution publish nothing');
  assert.equal(historyRows(w), rows, 'and add no history row');
  assert.deepEqual(record(w, ROOT), first, 'the record keeps its revision and the instants of its last publication');
  const stored = w.store.sessions().find(session => session.id === first.id);
  assert.equal(stored?.lastEvidenceAtMs, lastAt, 'the stored session holds the latest evidence time');
  assert.equal(w.store.nextDue(), lastAt + 86_400_000, 'nothing falls due before the session\'s expiry');

  // Evidence a full resolution after the published evidence time publishes that time, with no other change.
  w.clock.advance(5000);
  assert.equal(await take(w, ROOT, progress), 'applied');
  await w.store.drain();
  assert.deepEqual(states(w, from), [ROOT.identity.sessionId], 'the evidence time is part of the record\'s meaning at the resolution');
  const heard = record(w, ROOT);
  assert.equal(heard.lastEvidenceAtMs, first.lastEvidenceAtMs + RESOLUTION_MS);
  assert.ok(heard.revision > first.revision);
  assert.equal(status(heard), 'working/confirmed');
  assert.equal(historyRows(w), rows + 1, 'history keeps it');

  // An hour of silence publishes nothing and leaves the work confirmed.
  await advance(w, HOUR_MS);
  assert.deepEqual(states(w, from), [ROOT.identity.sessionId]);
  assert.deepEqual(record(w, ROOT), heard);
});

it('a question is not republished by silence, whether its turn ended or still runs under it', async context => {
  const w = await open(context);
  // The waiting session's turn ended on its question.
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
  assert.equal(w.store.nextDue(), Math.min(waiting.lastEvidenceAtMs, running.lastEvidenceAtMs) + 86_400_000, 'only expiry falls due');
  await advance(w, 10 * 60_000);
  await advance(w, HOUR_MS);
  assert.deepEqual(states(w, from), [], 'an hour of silence publishes nothing');
  assert.deepEqual([record(w, WAITING), record(w, ROOT)], [waiting, running]);
  assert.deepEqual([running.work.confidence, running.attention.confidence], ['confirmed', 'confirmed']);
});

it('late evidence for another turn, and evidence that is not work, leave work a restart left unconfirmed unconfirmed', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started, 'turn-1'), 'applied');
  assert.equal(await take(w, ROOT, ended, 'turn-1'), 'applied');
  assert.equal(await take(w, ROOT, started, 'turn-2'), 'applied');
  await w.store.drain();
  w.clock.advance(1000);
  await w.crashAndRestart();
  await w.store.refresh();
  await w.store.drain();
  assert.deepEqual([status(record(w, ROOT)), record(w, ROOT).work.reasons], ['working/unconfirmed', ['restart']]);
  const from = w.published.length, revision = record(w, ROOT).revision;
  // A tool result for the ended turn is stale: nothing changes and nothing is published.
  assert.equal(await take(w, ROOT, progress, 'turn-1'), 'stale');
  await w.store.drain();
  assert.deepEqual(states(w, from), []);
  assert.equal(record(w, ROOT).revision, revision);
  // A question on the current turn is evidence, but not of work: it publishes for its attention, and work stays unconfirmed.
  assert.equal(await take(w, ROOT, question('q1'), 'turn-2'), 'applied');
  assert.deepEqual([status(record(w, ROOT)), record(w, ROOT).work.reasons], ['needs-owner/question', ['restart']]);
});

it('a root with one confirmed and one unconfirmed child is working through its subagent', async context => {
  const w = await open(context);
  const first = identity('progress-child-a', ROOT.identity), second = identity('progress-child-b', ROOT.identity);
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, ROOT, ended), 'applied');
  assert.equal(await take(w, second, {kind: 'session-started'}, 'child-turn'), 'applied');
  await w.store.drain();
  // A restart leaves the second child's running work unconfirmed; the first child starts after it.
  w.clock.advance(1000);
  await w.crashAndRestart();
  await w.store.refresh();
  assert.equal(await take(w, first, {kind: 'session-started'}, 'child-turn'), 'applied');
  await w.store.drain();
  const root = record(w, ROOT);
  assert.deepEqual(root.relationships.children, {working: 1, unconfirmed: 1});
  assert.equal(status(root), 'working/subagent');
  assert.deepEqual([status(record(w, first)), status(record(w, second))], ['working/confirmed', 'working/unconfirmed']);
});

// Hub #1947's open design point: how many revisions and history rows the evidence time adds. One session works for an
// hour at each evidence cadence, on the manual clock; the counts are the publications of evidence alone, since nothing
// else changes. Each is at most one per resolution, and a silent session adds none.
it('a busy session publishes its evidence time at most once a minute: revisions and history rows per hour by cadence', async context => {
  const measured: string[] = [];
  for (const everyMs of [1000, 5000, 30_000, 59_000, 61_000, 90_000, 300_000]) {
    const w = await open(context);
    assert.equal(await take(w, ROOT, started), 'applied');
    await w.store.drain();
    const revision = w.store.revision, rows = historyRows(w), from = w.published.length;
    const end = w.clock.now() + HOUR_MS;
    let observations = 0;
    while (w.clock.now() + everyMs <= end) {
      w.clock.advance(everyMs);
      assert.equal(await take(w, ROOT, progress), 'applied');
      observations++;
    }
    await w.store.drain();
    const published = states(w, from).length, added = historyRows(w) - rows;
    // The published evidence time steps whenever it falls a resolution behind: every ceil(resolution / cadence) observations.
    const expected = Math.floor(observations / Math.ceil(RESOLUTION_MS / everyMs));
    assert.equal(published, expected, `every ${String(everyMs)} ms`);
    assert.equal(added, published, 'each publication adds one history row');
    assert.equal(w.store.revision - revision, published, 'and one revision');
    assert.ok(published <= HOUR_MS / RESOLUTION_MS, 'at most one per resolution');
    assert.ok(w.clock.now() - record(w, ROOT).lastEvidenceAtMs < RESOLUTION_MS, 'the published evidence time lags the last evidence by less than the resolution');
    measured.push(`every ${String(everyMs / 1000)} s: ${String(observations)} observations, ${String(published)} revisions, ${String(added)} history rows`);
  }
  // A silent session: an hour publishes nothing.
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  await w.store.drain();
  const rows = historyRows(w), from = w.published.length;
  await advance(w, HOUR_MS);
  assert.deepEqual([states(w, from).length, historyRows(w) - rows], [0, 0]);
  measured.push('silent: 0 revisions, 0 history rows');
  context.diagnostic(`per session-hour at a ${String(RESOLUTION_MS / 1000)} s resolution: ${measured.join('; ')}`);
});

/** Rewrites each published record and its latest history row in the session/2.0 shape, as a step-8 release left them. */
function asReleasedBefore(w: World): void {
  for (const item of w.store.records()) {
    const {status: _status, work, attention, outcome, relationships, ...rest} = item;
    const old = {...rest, activity: work.state, attention: attention.items, notices: outcome.notices, read: outcome.read, freshness: 'current',
      restartUncertain: false, children: {active: relationships.children.working, uncertain: relationships.children.unconfirmed}};
    w.db.prepare('UPDATE core_records SET record = ? WHERE family = \'session\' AND id = ?').run(JSON.stringify(old), item.id);
    w.db.prepare('UPDATE core_history_latest SET record = ? WHERE family = \'session\' AND id = ?').run(JSON.stringify(old), item.id);
  }
}

it('records a release before the switch published are published again as session/3.0 at the first start, against their last history row', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, WAITING, started), 'applied');
  assert.equal(await take(w, WAITING, ended), 'applied');
  await w.store.drain();
  asReleasedBefore(w);
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

it('a session that expires before the first session/3.0 publication is removed, with its record and a removal in history', async context => {
  const w = await open(context);
  assert.equal(await take(w, WAITING, started), 'applied');
  assert.equal(await take(w, WAITING, ended), 'applied');
  await w.store.drain();
  asReleasedBefore(w);
  const id = sessionEntityId(WAITING.identity), from = w.published.length;
  const removals = (): number => (w.rows('SELECT seq FROM core_history WHERE type = \'org.bunny.session.removed\'') as unknown[]).length;
  const before = removals();
  // The runtime stays down past the session's day without evidence; its start transaction has no running work to mark.
  w.clock.advance(86_400_000 + 1000);
  await w.crashAndRestart();
  await w.store.drain();
  const removed = w.since(from).filter(message => message.type === 'org.bunny.session.removed');
  assert.deepEqual(removed.map(message => [message.subject, (message.data as {reason: string}).reason]), [[id, 'expired']]);
  assert.deepEqual(w.rows(`SELECT id FROM core_records WHERE family = 'session' AND id = '${id}'`), [], 'no session/2.x row stays behind');
  assert.equal(removals(), before + 1, 'history keeps the removal, which closes the session\'s span');
  assert.deepEqual(w.store.records(), []);
});

it('before the first session/3.0 publication the store serves each legacy session as its session/3.0 record', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, WAITING, started), 'applied');
  assert.equal(await take(w, WAITING, ended), 'applied');
  await w.store.drain();
  asReleasedBefore(w);
  const revisions = new Map(w.store.records().map(item => [item.id, item.revision]));
  const noticeId = record(w, WAITING).outcome.notices[0]?.id ?? '';
  w.store.close();
  w.db.close();
  // A store opened as the core opens it, before its first refresh commits anything, as when that refresh fails.
  const db = new DatabaseSync(w.file);
  context.after(() => { if (db.isOpen) db.close(); });
  let seeded: readonly Session30Record[] = [];
  const store = new CoreStore({database: db, clock: {now: w.clock.now}, sdk: {source: 'bunny/core', publishMessage: (_key, message) => Promise.resolve(message)},
    opened: records => { seeded = records; }});
  context.after(() => store.close());
  await store.open(AbortSignal.abort());
  const held = store.records();
  assert.deepEqual(held.map(item => item.id).sort(), [...revisions.keys()].sort(), 'the parts and the core\'s commands find every stored session');
  assert.deepEqual(seeded.map(item => item.id).sort(), [...revisions.keys()].sort(), 'the parts start from every stored session');
  for (const item of held) {
    assert.ok('status' in item && 'work' in item, 'as a session/3.0 record');
    assert.equal(item.revision, revisions.get(item.id), 'at the revision it was last published at');
  }
  // A command against a stored legacy session is taken.
  const target = sessionEntityId(WAITING.identity);
  const outcome = await store.acknowledge(commandMessage(target, w.clock.now()), target, noticeId, 'pixoo');
  assert.equal(outcome.ok, true);
});
