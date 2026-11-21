// Publication on meaning changes and the aging table (Hub #1865 group 9, design decisions 4 and 5, as Hub #1947 amends
// them): silence changes no claim, and only a core restart leaves running work unconfirmed. A record's evidence time is
// part of its meaning at `SESSION_LIMITS.evidenceResolutionMs`: a work observation that changes no other public member
// writes the session row and publishes nothing until the evidence time is that far past the published one, which then
// publishes at a new revision. History keeps such an evidence-only publication as a confirmation of the session's open
// span, with no row (owner decision of 2026-11-21 on #1947). A busy session therefore publishes for its evidence at most
// once per resolution and an idle one never; the measurement test counts that. Everything runs on the runtime's manual
// clock, with no real wait.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {coreValidator, sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {readSession} from '@jimmie-potts/event-contracts/v2/session';
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
type Span = {sinceAtMs: number | null; confirmedAtMs: number | null; confirmations: number; seenRevision: number};
/** The session's open span in history, which evidence-only publications confirm. */
const spanOf = (w: World, id: string): Span | undefined => w.rows(`SELECT since_at_ms AS sinceAtMs, confirmed_at_ms AS confirmedAtMs, confirmations,
  seen_revision AS seenRevision FROM core_history_span WHERE family = 'session' AND id = '${id}'`)[0] as Span | undefined;
type Event = {revision: number; previous: number | null; changed: Record<string, unknown>; removed: string[]; span?: object; closedBy?: string};
/** The session's change rows, oldest first. */
const changeRows = (w: World, id: string): Event[] =>
  (w.rows(`SELECT record FROM core_history WHERE kind = 'change' AND subject = '${id}' ORDER BY seq`) as {record: string}[]).map(row => JSON.parse(row.record) as Event);
/** The record the rows give at their last row: each row's changed members over the last, its removed ones dropped. */
function rebuilt(id: string, events: readonly Event[]): Record<string, unknown> {
  const record: Record<string, unknown> = {id};
  for (const event of events) {
    Object.assign(record, structuredClone(event.changed), {revision: event.revision});
    for (const name of event.removed) delete record[name];
  }
  return record;
}
/** A record without its instants: the members an evidence-only publication moves. */
const withoutInstants = (record: Record<string, unknown>): unknown => {
  const {revision: _revision, observedAtMs: _observed, lastEvidenceAtMs: _evidence, ...rest} = structuredClone(record) as Record<string, Record<string, unknown>>;
  for (const claim of ['work', 'attention', 'outcome']) if (rest[claim] !== undefined) delete rest[claim].evidenceAtMs;
  return rest;
};
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
  assert.equal(historyRows(w), rows, 'history writes no row for it: it confirms the session\'s open span');
  assert.deepEqual(spanOf(w, first.id), {sinceAtMs: first.lastEvidenceAtMs, confirmedAtMs: heard.lastEvidenceAtMs, confirmations: 2, seenRevision: heard.revision});

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

// Hub #1947: what history keeps of evidence-only publications (owner decision of 2026-11-21, revising #1768 decision 6 for
// session evidence instants). They confirm the open span and write no row. At a confirmation the record rebuilt from the
// rows equals the published one but for its revision and instants; the span names the publication's revision and the
// commit's instant on the core's clock, which matches the record's `lastEvidenceAtMs` here because the manual clock never
// steps back (after a backward step the record keeps its later instant). The next change row carries the moved
// instants and closes the span, so the rebuild equals the published record there, and a removal closes a span with
// confirmations beyond its row first, as for any family.
it('evidence-only publications confirm the session\'s open span; the next change and a removal close it', async context => {
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  await w.store.drain();
  const id = record(w, ROOT).id, opened = record(w, ROOT);
  const publications: Session30Record[] = [];
  for (let minute = 1; minute <= 3; minute++) {
    w.clock.advance(RESOLUTION_MS);
    assert.equal(await take(w, ROOT, progress), 'applied');
    await w.store.drain();
    publications.push(record(w, ROOT));
  }
  assert.deepEqual(new Set(publications.map(item => item.revision)).size, 3, 'three evidence-only publications');
  assert.equal(changeRows(w, id).length, 1, 'only the start wrote a row');
  const last = publications.at(-1);
  assert.ok(last);
  assert.deepEqual(spanOf(w, id), {sinceAtMs: opened.lastEvidenceAtMs, confirmedAtMs: last.lastEvidenceAtMs, confirmations: 4, seenRevision: last.revision});
  assert.deepEqual(withoutInstants(rebuilt(id, changeRows(w, id))), withoutInstants(last), 'the rebuild equals the published record but for its instants');
  assert.equal(rebuilt(id, changeRows(w, id)).lastEvidenceAtMs, opened.lastEvidenceAtMs, 'it keeps the last row\'s instants');

  // A change of meaning writes one row with the moved instants and the span it closes.
  w.clock.advance(10_000);
  assert.equal(await take(w, ROOT, ended), 'applied');
  await w.store.drain();
  const finished = record(w, ROOT), rows = changeRows(w, id), closing = rows.at(-1);
  assert.equal(rows.length, 2);
  assert.deepEqual(closing?.span, {sinceAtMs: opened.lastEvidenceAtMs, lastConfirmedAtMs: last.lastEvidenceAtMs, confirmations: 4});
  assert.equal(closing?.previous, opened.revision);
  assert.ok(Object.hasOwn(closing?.changed ?? {}, 'lastEvidenceAtMs') && Object.hasOwn(closing?.changed ?? {}, 'observedAtMs'));
  assert.deepEqual(rebuilt(id, rows), {...finished}, 'the rebuild equals the published record at the change row');

  // A new turn, two evidence-only publications, then the session's expiry: a closing row comes before the removal.
  assert.equal(await take(w, ROOT, started, 'turn-2'), 'applied');
  const turn = record(w, ROOT);
  for (let minute = 1; minute <= 2; minute++) {
    w.clock.advance(RESOLUTION_MS);
    assert.equal(await take(w, ROOT, progress, 'turn-2'), 'applied');
  }
  await w.store.drain();
  const before = changeRows(w, id).length;
  await advance(w, 86_400_000);
  const after = changeRows(w, id);
  assert.equal(after.length, before + 1);
  assert.deepEqual(after.at(-1), {family: 'session', id, revision: turn.revision, previous: turn.revision, changed: {}, removed: [],
    span: {sinceAtMs: turn.lastEvidenceAtMs, lastConfirmedAtMs: turn.lastEvidenceAtMs + 2 * RESOLUTION_MS, confirmations: 3}, closedBy: 'removal'});
  assert.deepEqual(rebuilt(id, after), {...turn}, 'the rebuild at the closing row equals the record published at its revision');
  assert.equal((w.rows(`SELECT seq FROM core_history WHERE kind = 'removal' AND subject = '${id}'`) as unknown[]).length, 1);
});

// Hub #1947's open design point, as the owner decided it: how many revisions, history rows and span confirmations the
// evidence time adds. One session works for an hour at each evidence cadence, on the manual clock; the counts are the
// publications of evidence alone, since nothing else changes. Each is at most one per resolution, each confirms the
// session's open span with no history row, and a silent session adds nothing.
it('a busy session publishes its evidence time at most once a minute: revisions, history rows and span confirmations per hour by cadence', async context => {
  const measured: string[] = [];
  for (const everyMs of [1000, 5000, 30_000, 59_000, 61_000, 90_000, 300_000]) {
    const w = await open(context);
    assert.equal(await take(w, ROOT, started), 'applied');
    await w.store.drain();
    const revision = w.store.revision, rows = historyRows(w), from = w.published.length, id = record(w, ROOT).id;
    const end = w.clock.now() + HOUR_MS;
    let observations = 0;
    while (w.clock.now() + everyMs <= end) {
      w.clock.advance(everyMs);
      assert.equal(await take(w, ROOT, progress), 'applied');
      observations++;
    }
    await w.store.drain();
    const published = states(w, from).length, added = historyRows(w) - rows, confirmed = (spanOf(w, id)?.confirmations ?? 0) - 1;
    // The published evidence time steps whenever it falls a resolution behind: every ceil(resolution / cadence) observations.
    const expected = Math.floor(observations / Math.ceil(RESOLUTION_MS / everyMs));
    assert.equal(published, expected, `every ${String(everyMs)} ms`);
    assert.equal(added, 0, 'no publication adds a history row');
    assert.equal(confirmed, published, 'each confirms the open span');
    assert.equal(w.store.revision - revision, published, 'and one revision');
    assert.ok(published <= HOUR_MS / RESOLUTION_MS, 'at most one per resolution');
    assert.ok(w.clock.now() - record(w, ROOT).lastEvidenceAtMs < RESOLUTION_MS, 'the published evidence time lags the last evidence by less than the resolution');
    measured.push(`every ${String(everyMs / 1000)} s: ${String(observations)} observations, ${String(published)} revisions, ${String(added)} history rows, ${String(confirmed)} span confirmations`);
  }
  // A silent session: an hour publishes nothing.
  const w = await open(context);
  assert.equal(await take(w, ROOT, started), 'applied');
  await w.store.drain();
  const rows = historyRows(w), from = w.published.length;
  await advance(w, HOUR_MS);
  assert.deepEqual([states(w, from).length, historyRows(w) - rows, spanOf(w, record(w, ROOT).id)?.confirmations], [0, 0, 1]);
  measured.push('silent: 0 revisions, 0 history rows, 0 span confirmations');
  context.diagnostic(`per session-hour at a ${String(RESOLUTION_MS / 1000)} s resolution: ${measured.join('; ')}`);
});

/**
 * Rewrites one running session as the release before Hub #1947 (037b327a, #1865 step 9) left it once its work deadline
 * passed: the stored session keeps the deadline marking and its private progress time, and its published record and
 * latest history row carry the work reason `deadline`. Without `marked`, only the progress time is stored, as for running
 * work still within its deadline.
 */
function asDeadlineRelease(w: World, who: typeof ROOT, marked: boolean): void {
  const id = sessionEntityId(who.identity);
  const row = w.rows(`SELECT session FROM core_sessions WHERE id = '${id}'`)[0] as {session: string} | undefined;
  assert.ok(row);
  const session = JSON.parse(row.session) as {lastEvidenceAtMs: number};
  w.db.prepare('UPDATE core_sessions SET session = ? WHERE id = ?').run(JSON.stringify({...session, progressAtMs: session.lastEvidenceAtMs,
    ...(marked ? {deadlineUnconfirmed: true} : {})}), id);
  if (!marked) return;
  const published = record(w, who);
  const old = {...published, work: {...published.work, confidence: 'unconfirmed', reasons: ['deadline']},
    status: published.status.class === 'working' ? {class: 'working', detail: 'unconfirmed'} : published.status};
  w.db.prepare('UPDATE core_records SET record = ? WHERE family = \'session\' AND id = ?').run(JSON.stringify(old), id);
  w.db.prepare('UPDATE core_history_latest SET record = ? WHERE family = \'session\' AND id = ?').run(JSON.stringify(old), id);
}

// Hub #1947, the upgrade from the installed release (037b327a): its store may hold running work its deadline left
// unconfirmed, the deadline marking and progress time on stored sessions, and published records with reason `deadline`.
// The start transaction drops the two fields from every stored session, marks running work unconfirmed for the restart
// instead, and publishes each changed record once; qualifying evidence then confirms the work as for any restart.
it('a store the release before #1947 wrote upgrades at the first start: deadline work turns restart-unconfirmed once, and the fields go', async context => {
  const w = await open(context);
  const BUSY = identity('progress-busy');
  assert.equal(await take(w, ROOT, started), 'applied');
  assert.equal(await take(w, WAITING, started), 'applied');
  assert.equal(await take(w, WAITING, question('q1')), 'applied');
  assert.equal(await take(w, BUSY, started), 'applied');
  await w.store.drain();
  w.clock.advance(6 * 60_000);
  asDeadlineRelease(w, ROOT, true);
  asDeadlineRelease(w, WAITING, true);
  asDeadlineRelease(w, BUSY, false);
  // That release also committed a state message with reason deadline that a crash kept from going out.
  const last = [...w.since(0)].reverse().find(message => message.subject === sessionEntityId(ROOT.identity) && message.type === 'org.bunny.session.updated');
  assert.ok(last);
  const kept = (w.rows(`SELECT record FROM core_records WHERE family = 'session' AND id = '${last.subject}'`)[0] as {record: string}).record;
  const pending = {...last, id: 'pending-deadline-state', data: JSON.parse(kept) as Session30Record};
  assert.deepEqual(pending.data.work.reasons, ['deadline']);
  w.db.prepare('INSERT INTO bunny_outbox (id, kind, routing_key, message) VALUES (?, ?, ?, ?)').run(pending.id, 'state', `bunny.state.session.${last.subject}`,
    JSON.stringify(pending));
  const from = w.published.length, rows = historyRows(w);
  w.clock.advance(1000);
  await w.crashAndRestart();
  await w.store.refresh();
  await w.store.drain();
  const stored = (w.rows('SELECT session FROM core_sessions') as {session: string}[]).map(row => JSON.parse(row.session) as Record<string, unknown>);
  assert.equal(stored.length, 3);
  assert.ok(stored.every(session => !Object.hasOwn(session, 'deadlineUnconfirmed') && !Object.hasOwn(session, 'progressAtMs')), 'the retired fields are gone');
  // The resent message goes out unchanged, validates and reads, as `deadline` stays accepted and never emitted; the start's
  // newer revision supersedes it in every copy that keeps the highest revision.
  const resent = w.since(from).find(message => message.id === pending.id);
  assert.ok(resent);
  assert.equal(coreValidator().validate(resent).ok, true, 'the resent deadline record validates');
  assert.deepEqual(readSession(resent)?.work.reasons, ['deadline']);
  const sent = w.since(from).filter(message => message.type === 'org.bunny.session.updated' && message.id !== pending.id);
  assert.deepEqual(sent.map(message => (message.data as Session30Record).identity.sessionId).sort(), ['progress-busy', 'progress-root', 'progress-waiting'],
    'each session publishes once');
  assert.ok(sent.every(message => coreValidator().validate(message).ok));
  assert.deepEqual([status(record(w, ROOT)), record(w, ROOT).work.reasons], ['working/unconfirmed', ['restart']]);
  assert.ok(record(w, ROOT).revision > (resent.data as Session30Record).revision);
  assert.deepEqual([status(record(w, WAITING)), record(w, WAITING).work.reasons], ['needs-owner/question', ['restart']]);
  assert.deepEqual(record(w, BUSY).work.reasons, ['restart']);
  assert.equal(historyRows(w), rows + 3, 'history keeps each as a change against the last row');
  // Qualifying evidence on the current turn confirms the work again, as after any restart.
  w.clock.advance(1000);
  assert.equal(await take(w, ROOT, progress), 'applied');
  assert.deepEqual([status(record(w, ROOT)), record(w, ROOT).work.reasons], ['working/confirmed', []]);
  // A second start finds nothing left to drop.
  const again = w.published.length;
  w.clock.advance(1000);
  await w.crashAndRestart();
  await w.store.refresh();
  await w.store.drain();
  assert.deepEqual(w.since(again).filter(message => message.type === 'org.bunny.session.updated').map(message => (message.data as Session30Record).identity.sessionId),
    ['progress-root'], 'only the confirmed work is marked again');
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
