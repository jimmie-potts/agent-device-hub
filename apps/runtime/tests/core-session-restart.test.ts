// The core's restart rule (Hub #1865 group 8, tasks.md 8.1, design decision 4): one start transaction marks every
// session whose work is running unconfirmed, publishes the changed records and no occurrence, and stores the marking.
// Questions, outcomes and read evidence stay as stored. Only qualifying evidence on the current turn (`turn-started`,
// `activity-observed` or `attention-resolved`) whose producer instant is at or after the core's start confirms the work
// again, so a delayed event from before the start never does. The producer instant is the earlier of the observation's
// `observedAtMs` and `occurredAtMs`; a host clock that runs behind therefore delays confirmation until its next
// evidence, and one that runs ahead can let a delayed event confirm, the limit the design accepts. Everything runs on
// the runtime's manual clock.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Deriver} from '../src/core/store.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, it, manualClock} from './support.js';

const identity = (provider: 'claude' | 'codex', sessionId: string): Identity => provider === 'claude'
  ? {provider, client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId}
  : {provider, client: 'local', hostId: 'synthetic-host', sourceId: 'codex-hooks', sessionId};
const CODEX = identity('codex', 'waiting'), CLAUDE = identity('claude', 'finished'), RUNNING = identity('claude', 'running');

type At = {turn?: string | null; atMs?: number; occurredAtMs?: number};

/** The world, opened as the core opens its store, and the helpers these tests share. */
async function open(context: TestContext, derivers: readonly Deriver[] = []): Promise<World> {
  const wrap = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
  return World.open(context, {clock: manualClock(START), wrap, derivers});
}

function observation(w: World, who: Identity, event: LifecycleEvent, at: At = {}): LifecycleObservation {
  const turn = at.turn === undefined ? 'turn-1' : at.turn;
  return {
    identity: who, turn: turn === null ? {status: 'unknown'} : {status: 'known', id: turn}, parent: {status: 'unknown'}, event,
    observedAtMs: at.atMs ?? w.clock.now(), ordering: {status: 'unknown'}, ...(at.occurredAtMs === undefined ? {} : {occurredAtMs: at.occurredAtMs}),
  };
}

/** Takes one observation through the store's intake and gives its outcome word, or the refusal's code. */
async function take(w: World, who: Identity, event: LifecycleEvent, at: At = {}): Promise<string> {
  const result = await w.take(lifecycleMessage(observation(w, who, event, at), w.clock.now()));
  return result.ok ? result.outcome : result.code;
}

const record = (w: World, who: Identity): SessionRecord => {
  const found = w.store.records().find(item => item.id === sessionEntityId(who));
  assert.ok(found, `${who.sessionId} is held`);
  return found;
};
const stored = (w: World, who: Identity): boolean | undefined =>
  w.store.sessions().find(session => session.id === sessionEntityId(who))?.restartUnconfirmed;
const started: LifecycleEvent = {kind: 'turn-started'}, ended: LifecycleEvent = {kind: 'turn-ended'}, progress: LifecycleEvent = {kind: 'activity-observed'};
const question = (id: string): LifecycleEvent => ({kind: 'question-continuing', attention: {status: 'known', id}});

/** A waiting session with a question, a finished session with its notice, and a running session. */
async function three(w: World): Promise<void> {
  assert.equal(await take(w, CODEX, started, {turn: 't1'}), 'applied');
  assert.equal(await take(w, CODEX, question('q1'), {turn: 't1'}), 'applied');
  assert.equal(await take(w, CLAUDE, started, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, CLAUDE, ended, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, RUNNING, started, {turn: 'r1'}), 'applied');
}

it('a restart marks only running work unconfirmed, in one start transaction that stores the marking and publishes no occurrence', async context => {
  const w = await open(context);
  await three(w);
  const before = new Map(w.store.records().map(item => [item.id, item]));
  w.clock.advance(10_000);
  w.published.splice(0);
  w.changes.splice(0);
  await w.crashAndRestart();
  await w.store.drain();
  const sent = w.since(0);
  assert.deepEqual(sent.map(message => [message.kind, message.subject]), [['state', sessionEntityId(CODEX)], ['state', sessionEntityId(RUNNING)]],
    'only the sessions whose work runs are published again, with no removal and no occurrence');
  assert.equal(w.changes.length, 1, 'one transaction');
  assert.equal(new Set(sent.map(message => (message.data as SessionRecord).revision)).size, 1, 'at one revision');
  assert.ok(sent.every(message => (message.data as SessionRecord).restartUncertain && (message.data as SessionRecord).freshness === 'uncertain'));
  // The question and the outcome stay as stored.
  assert.deepEqual(record(w, CODEX).attention, before.get(sessionEntityId(CODEX))?.attention);
  assert.equal(record(w, CODEX).activity, 'active');
  assert.deepEqual(record(w, CLAUDE), before.get(sessionEntityId(CLAUDE)), 'the finished session is not republished and keeps its notice');
  assert.equal(record(w, CLAUDE).restartUncertain, false);
  assert.deepEqual([stored(w, CODEX), stored(w, CLAUDE), stored(w, RUNNING)], [true, undefined, true], 'the marking is stored with each session');

  // The marking is stored: another restart without evidence between changes nothing.
  w.published.splice(0);
  w.clock.advance(1000);
  await w.crashAndRestart();
  await w.store.drain();
  assert.deepEqual(w.since(0), []);
  assert.equal(record(w, RUNNING).restartUncertain, true);
});

it('only qualifying evidence on the current turn, observed after the start, confirms the work again', async context => {
  const w = await open(context);
  await three(w);
  w.clock.advance(10_000);
  await w.crashAndRestart();
  w.clock.advance(1000);
  // A question is evidence, but not of work: the work stays unconfirmed.
  assert.equal(await take(w, RUNNING, question('q2'), {turn: 'r1'}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, true);
  assert.equal(record(w, RUNNING).freshness, 'uncertain');
  assert.equal(record(w, RUNNING).attention.length, 1, 'and is taken');
  // Progress on the current turn confirms it.
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1'}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, false);
  assert.equal(record(w, RUNNING).freshness, 'current');
  assert.equal(stored(w, RUNNING), undefined);
  // The answer to the waiting session's question is qualifying evidence on its turn.
  assert.equal(await take(w, CODEX, {kind: 'attention-resolved', attention: {status: 'known', id: 'q1'}}, {turn: 't1'}), 'applied');
  assert.deepEqual([record(w, CODEX).restartUncertain, record(w, CODEX).attention], [false, []]);
});

it('a turn that ends after the restart leaves no work to confirm, and a new turn after the start is confirmed', async context => {
  const w = await open(context);
  await three(w);
  w.clock.advance(10_000);
  await w.crashAndRestart();
  w.clock.advance(1000);
  assert.equal(await take(w, RUNNING, ended, {turn: 'r1'}), 'applied');
  assert.deepEqual([record(w, RUNNING).activity, record(w, RUNNING).restartUncertain], ['idle', false]);
  assert.equal(await take(w, RUNNING, started, {turn: 'r2'}), 'applied');
  assert.deepEqual([record(w, RUNNING).activity, record(w, RUNNING).restartUncertain], ['active', false]);
});

it('a delayed event from before the core\'s start does not confirm the work again', async context => {
  const w = await open(context);
  await three(w);
  const sent = w.clock.now();
  w.clock.advance(10_000);
  await w.crashAndRestart();
  const startAt = w.clock.now();
  w.clock.advance(500);
  // Progress the hook observed before the restart, delivered after it.
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1', atMs: sent + 2000}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, true, 'the delayed progress does not confirm');
  assert.equal(record(w, RUNNING).observedAtMs, sent + 2000, 'but is taken');
  // Observed after the start, but of an event that occurred before it: the earlier instant counts.
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1', atMs: startAt + 100, occurredAtMs: startAt - 100}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, true);
  // Progress from after the start confirms.
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1', atMs: startAt + 400}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, false);
});

it('work that a delayed event from before the start sets running is unconfirmed until evidence from after the start', async context => {
  const w = await open(context);
  await three(w);
  const sent = w.clock.now();
  w.clock.advance(10_000);
  await w.crashAndRestart();
  w.clock.advance(500);
  // The finished session's next prompt and a session the core never saw, both observed before the restart.
  assert.equal(await take(w, CLAUDE, started, {turn: 'p2', atMs: sent + 1000}), 'applied');
  assert.deepEqual([record(w, CLAUDE).activity, record(w, CLAUDE).restartUncertain], ['active', true]);
  const late = identity('claude', 'late');
  assert.equal(await take(w, late, started, {turn: 'l1', atMs: sent + 2000}), 'applied');
  assert.deepEqual([record(w, late).activity, record(w, late).restartUncertain], ['active', true]);
  assert.equal(await take(w, CLAUDE, progress, {turn: 'p2'}), 'applied');
  assert.equal(record(w, CLAUDE).restartUncertain, false);
});

it('a host clock behind the hub delays confirmation to its next evidence; one ahead lets a delayed event confirm, the accepted limit', async context => {
  const w = await open(context);
  await three(w);
  w.clock.advance(10_000);
  await w.crashAndRestart();
  const startAt = w.clock.now();
  // A host 30 s behind: evidence it observes a second after the start carries an instant before it.
  w.clock.advance(1000);
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1', atMs: w.clock.now() - 30_000}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, true);
  w.clock.advance(40_000);
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1', atMs: w.clock.now() - 30_000}), 'applied');
  assert.equal(record(w, RUNNING).restartUncertain, false, 'its next evidence, now after the start on its own clock, confirms');
  // A host 30 s ahead: progress it sent just before the restart and the hub took just after carries an instant after the start.
  assert.equal(await take(w, CODEX, progress, {turn: 't1', atMs: startAt - 1000 + 30_000}), 'applied');
  assert.equal(record(w, CODEX).restartUncertain, false, 'a delayed event from a host clock ahead confirms work (design decision 4)');
});

it('after a restart an approval can be recovered only where the restart left work unconfirmed, or after five minutes', async context => {
  const w = await open(context);
  const approval: LifecycleEvent = {kind: 'attention-approval', attention: {status: 'unknown'}};
  const halted = identity('claude', 'halted');
  for (const who of [RUNNING, halted]) {
    assert.equal(await take(w, who, started, {turn: 'r1'}), 'applied');
    assert.equal(await take(w, who, approval, {turn: 'r1'}), 'applied');
  }
  assert.equal(await take(w, halted, {kind: 'turn-interrupted'}, {turn: 'r1'}), 'applied');
  w.clock.advance(10_000);
  await w.crashAndRestart();
  const recover = async (who: Identity): Promise<string> => {
    const result = await w.recoverApproval(who, 'r1');
    return result.ok ? result.outcome : result.code;
  };
  assert.equal(record(w, halted).restartUncertain, false, 'interrupted work is not running');
  assert.equal(await recover(halted), 'invalid-state');
  assert.equal(await recover(RUNNING), 'ambiguous', 'recovered');
  assert.equal(record(w, RUNNING).attention.length, 0);
  w.clock.advance(300_000);
  assert.equal(await recover(halted), 'ambiguous', 'five minutes without evidence still allow it');
});

it('a start transaction that cannot commit changes nothing, and no session change commits before it', async context => {
  let failing = false;
  const w = await open(context, [() => { if (failing) throw Object.assign(new Error('database or disk is full'), {errcode: 13}); }]);
  await three(w);
  w.clock.advance(10_000);
  failing = true;
  w.published.splice(0);
  w.changes.splice(0);
  await assert.rejects(w.crashAndRestart());
  const rows = w.snapshot();
  assert.deepEqual(w.published, []);
  assert.equal(record(w, RUNNING).restartUncertain, false, 'the stored record still says what it said');
  assert.equal(await take(w, RUNNING, progress, {turn: 'r1'}), 'storage-failed', 'a session change waits for the start transaction');
  assert.deepEqual(w.snapshot(), rows, 'nothing committed');
  failing = false;
  w.clock.advance(1000);
  // The next change first commits the start transaction, then its own.
  assert.equal(await take(w, CLAUDE, started, {turn: 'p2'}), 'applied');
  await w.store.drain();
  assert.equal(w.changes.length, 2);
  assert.deepEqual(w.changes[0]?.messages.map(message => message.subject), [sessionEntityId(CODEX), sessionEntityId(RUNNING)]);
  assert.deepEqual(w.changes[1]?.messages.map(message => message.subject), [sessionEntityId(CLAUDE)]);
  assert.deepEqual([record(w, CODEX).restartUncertain, record(w, RUNNING).restartUncertain, record(w, CLAUDE).restartUncertain], [true, true, false]);
});
