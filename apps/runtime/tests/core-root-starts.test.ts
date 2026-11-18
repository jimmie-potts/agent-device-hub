// Root starts and the session limit in the core (Hub #1865 group 8, tasks.md 8.2 and 8.3, design decisions 6 and 7).
// A root start is a `session-started` observation whose parent is not known: a hook's SessionStart, from any provider
// and any hook release. It claims no work: a new root starts idle with no work turn, whatever turn the start carries,
// and a known root keeps its work and its turn, so launch, /clear and /resume stay quiet (#397) and mid-turn compaction
// keeps the running turn. A child start, a SubagentStart under a known parent, keeps its meaning as evidenced child
// work. The limit counts every session from every source; a refusal changes nothing and publishes nothing. Everything
// runs on the runtime's manual clock.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation, type Parent, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, it, manualClock} from './support.js';

const claude = (sessionId: string): Identity => ({provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId});
const codex = (sessionId: string, client: 'local' | 'cli' | 'desktop' = 'local'): Identity =>
  ({provider: 'codex', client, hostId: 'synthetic-host', sourceId: client === 'desktop' ? 'codex-desktop' : 'codex-hooks', sessionId});

type At = {turn?: string | null; parent?: Parent; sequence?: number};

async function open(context: TestContext): Promise<World> {
  const wrap = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
  return World.open(context, {clock: manualClock(START), wrap});
}

function observation(w: World, who: Identity, event: LifecycleEvent, at: At = {}): LifecycleObservation {
  const turn = at.turn === undefined ? null : at.turn;
  return {
    identity: who, turn: turn === null ? {status: 'unknown'} : {status: 'known', id: turn}, parent: at.parent ?? {status: 'unknown'}, event,
    observedAtMs: w.clock.now(),
    ordering: at.sequence === undefined ? {status: 'unknown'} : {status: 'known', authority: who.sourceId, epoch: 'e1', sequence: at.sequence},
  };
}

/** Takes one observation a millisecond after the last, and gives its outcome word, or the refusal's code. */
async function take(w: World, who: Identity, event: LifecycleEvent, at: At = {}): Promise<string> {
  w.clock.advance(1);
  const result = await w.take(lifecycleMessage(observation(w, who, event, at), w.clock.now()));
  return result.ok ? result.outcome : result.code;
}

const record = (w: World, who: Identity): SessionRecord => {
  const found = w.store.records().find(item => item.id === sessionEntityId(who));
  assert.ok(found, `${who.sessionId} is held`);
  return found;
};
const turnOf = (item: SessionRecord): string | null => item.turn.status === 'known' ? item.turn.id : null;
const ambiguous = (item: SessionRecord): string[] => item.unavailable.filter(entry => entry.reason === 'ambiguous').map(entry => entry.dimension);
const start: LifecycleEvent = {kind: 'session-started'}, started: LifecycleEvent = {kind: 'turn-started'}, ended: LifecycleEvent = {kind: 'turn-ended'};

it('launch, /clear and /resume without a prompt stay quiet (#397)', async context => {
  const w = await open(context);
  // Launch: a new root with no turn.
  assert.equal(await take(w, claude('launched'), start), 'applied');
  assert.deepEqual([record(w, claude('launched')).activity, turnOf(record(w, claude('launched')))], ['idle', null]);
  assert.deepEqual(record(w, claude('launched')).unavailable, [{dimension: 'turn', reason: 'missing'}, {dimension: 'ordering', reason: 'missing'}]);
  // A finished session, then /clear: the new session ID starts quiet.
  assert.equal(await take(w, claude('finished'), started, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, claude('finished'), ended, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, claude('cleared'), start), 'applied');
  assert.equal(record(w, claude('cleared')).activity, 'idle');
  // In-session /resume: the start carries the command's prompt ID, which selects no work turn.
  const notices = record(w, claude('finished')).notices;
  assert.equal(await take(w, claude('finished'), start, {turn: 'resume-command'}), 'applied');
  const resumed = record(w, claude('finished'));
  assert.deepEqual([resumed.activity, turnOf(resumed), ambiguous(resumed)], ['idle', 'p1', []]);
  assert.deepEqual(resumed.notices, notices, 'the finished turn\'s notice stays');
  // /resume of a session the core does not hold: a new root, idle, with no work turn.
  assert.equal(await take(w, claude('elsewhere'), start, {turn: 'resume-command'}), 'applied');
  assert.deepEqual([record(w, claude('elsewhere')).activity, turnOf(record(w, claude('elsewhere')))], ['idle', null]);
  assert.deepEqual(record(w, claude('elsewhere')).unavailable, [{dimension: 'turn', reason: 'missing'}, {dimension: 'ordering', reason: 'missing'}]);
  for (const item of w.store.records()) assert.equal(item.children.active, 0);
});

it('mid-turn compaction keeps the active turn, with or without another prompt ID, and makes nothing ambiguous', async context => {
  const w = await open(context);
  const who = claude('compacting');
  assert.equal(await take(w, who, started, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, who, start), 'applied');
  assert.deepEqual([record(w, who).activity, turnOf(record(w, who)), ambiguous(record(w, who))], ['active', 'p1', []]);
  assert.equal(await take(w, who, start, {turn: 'p9'}), 'applied');
  assert.deepEqual([record(w, who).activity, turnOf(record(w, who)), ambiguous(record(w, who))], ['active', 'p1', []]);
  assert.equal(record(w, who).freshness, 'current');
  // The running turn still ends with its notice.
  assert.equal(await take(w, who, ended, {turn: 'p1'}), 'applied');
  assert.deepEqual([record(w, who).activity, record(w, who).notices.map(notice => notice.turn)], ['idle', [{status: 'known', id: 'p1'}]]);
});

it('a stale or conflicting start cannot replace a newer turn or restore a finished one', async context => {
  const w = await open(context);
  const who = claude('session');
  assert.equal(await take(w, who, started, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, who, ended, {turn: 'p1'}), 'applied');
  // A start that names the finished turn does not bring its work back.
  assert.equal(await take(w, who, start, {turn: 'p1'}), 'applied');
  assert.deepEqual([record(w, who).activity, turnOf(record(w, who)), ambiguous(record(w, who))], ['idle', 'p1', []]);
  assert.equal(await take(w, who, started, {turn: 'p2'}), 'applied');
  const revision = record(w, who).revision;
  // A delayed start on the retired turn is stale.
  assert.equal(await take(w, who, start, {turn: 'p1'}), 'stale');
  assert.equal(record(w, who).revision, revision);
  assert.deepEqual([record(w, who).activity, turnOf(record(w, who))], ['active', 'p2']);
  // An ordered start below the watermark is stale too.
  const ordered = codex('ordered');
  assert.equal(await take(w, ordered, started, {turn: 't2', sequence: 5}), 'applied');
  assert.equal(await take(w, ordered, start, {turn: 't1', sequence: 4}), 'stale');
  assert.deepEqual([record(w, ordered).activity, turnOf(record(w, ordered))], ['active', 't2']);
});

it('a child start keeps its meaning as evidenced child work under its known parent', async context => {
  const w = await open(context);
  const root = claude('root'), child = claude('root-agent');
  assert.equal(await take(w, root, start), 'applied');
  assert.equal(await take(w, child, start, {parent: {status: 'known', identity: root}}), 'applied');
  assert.equal(record(w, child).activity, 'active');
  assert.deepEqual(record(w, root).children, {active: 1, uncertain: 0});
  assert.equal(record(w, root).activity, 'idle', 'the root itself stays quiet');
});

it('a prompt after the start is work, and its end finishes the turn with a notice', async context => {
  const w = await open(context);
  const who = claude('session');
  assert.equal(await take(w, who, start), 'applied');
  assert.equal(await take(w, who, started, {turn: 'p1'}), 'applied');
  assert.deepEqual([record(w, who).activity, turnOf(record(w, who))], ['active', 'p1']);
  assert.equal(await take(w, who, ended, {turn: 'p1'}), 'applied');
  assert.deepEqual([record(w, who).activity, record(w, who).notices.length, ambiguous(record(w, who))], ['idle', 1, []]);
  const again = observation(w, who, start);
  assert.equal((await w.take(lifecycleMessage(again, w.clock.now()))).ok, true, 'a start after the turn changes nothing but its evidence');
  assert.deepEqual([record(w, who).activity, turnOf(record(w, who))], ['idle', 'p1']);
  const repeated = await w.take(lifecycleMessage(structuredClone(again), w.clock.now()));
  assert.equal(repeated.ok && repeated.outcome, 'duplicate', 'the same start under another message ID is a semantic duplicate');
});

it('every provider\'s root start is quiet, and so is a start from an older hook release', async context => {
  const w = await open(context);
  for (const who of [codex('local'), codex('cli', 'cli'), codex('desktop', 'desktop')]) {
    assert.equal(await take(w, who, start, {parent: {status: 'top-level'}, turn: 'turn-a'}), 'applied');
    assert.deepEqual([record(w, who).activity, turnOf(record(w, who))], ['idle', null], who.client);
  }
});

it('roots of two sources fill the limit; a new root displaces only a finished child subtree, and a refusal changes nothing', async context => {
  const w = await open(context);
  const parent = claude('parent'), child = claude('parent-agent');
  assert.equal(await take(w, parent, started, {turn: 'p1'}), 'applied');
  assert.equal(await take(w, child, start, {parent: {status: 'known', identity: parent}, turn: 'c1'}), 'applied');
  assert.equal(await take(w, child, ended, {parent: {status: 'known', identity: parent}, turn: 'c1'}), 'applied');
  for (let index = 0; w.store.records().length < 128; index++) {
    assert.equal(await take(w, index % 2 === 0 ? claude(`filler-${index}`) : codex(`filler-${index}`), start), 'applied');
  }
  const roots = w.store.records().filter(item => item.parent.status !== 'known').map(item => item.id).sort();
  assert.equal(roots.length, 127);
  const from = w.published.length;
  // A new root of the other source takes the finished child's place, in one transaction.
  assert.equal(await take(w, codex('new-root'), start), 'applied');
  const sent = w.since(from);
  assert.deepEqual(sent.filter(message => message.kind === 'removal').map(message => [message.subject, (message.data as {reason: string}).reason]),
    [[sessionEntityId(child), 'retired']]);
  assert.equal(new Set(sent.map(message => (message.data as {revision: number}).revision)).size, 1);
  assert.deepEqual(w.store.records().filter(item => item.parent.status !== 'known').map(item => item.id).sort(), [...roots, sessionEntityId(codex('new-root'))].sort(),
    'no root is displaced');
  // Nothing left to displace: the next root of either source, and any new child, is refused, and nothing changes.
  const rows = w.snapshot(), published = w.published.length;
  assert.equal(await take(w, claude('refused-root'), start), 'capacity');
  assert.equal(await take(w, codex('refused-root'), started, {turn: 't1'}), 'capacity');
  assert.equal(await take(w, claude('refused-child'), start, {parent: {status: 'known', identity: parent}}), 'capacity');
  assert.deepEqual(w.snapshot(), rows);
  assert.equal(w.published.length, published, 'a refusal publishes nothing');
});
