// The shared session case set on the core store (Hub #1865, design decision 10): every case (`since` "now", "step 7" and
// "step 8") runs through the store as the core takes its input, on the runtime's manual clock, and must leave each
// check's expected records, removals and occurrences. Revisions and generations count steps in the case set, so their
// order is compared. A notice on an unknown turn is named from the observation's semantic key, whose form step 7
// changed, so such notices are compared by their turn.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {loadSessionCases, noticeIdOf, type CompactOccurrence, type SessionCase} from '@jimmie-potts/event-contracts/v2/session-cases';
import {sessionEntityId, type Attention, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {World} from './fixtures/store-world.js';
import {it, manualClock, stateDir} from './support.js';

const cases = loadSessionCases();

/** A record without what the case set numbers by steps, its notices on unknown turns unnamed. */
function comparable(record: Session30Record): unknown {
  const {revision: _revision, generation: _generation, ...rest} = structuredClone(record);
  for (const notice of rest.outcome.notices) if (notice.turn.status === 'unknown') notice.id = '';
  return rest;
}

/**
 * At most this many differences are reported. A failing check of 128 sessions then fails at once with a short message:
 * a deep comparison of the whole sets builds a diff that grew past 15 GB on the capacity case.
 */
const REPORTED = 5;
const clipped = (value: unknown): string => JSON.stringify(value).slice(0, 400);

/** The records that differ from the expected ones, by entity ID, at most `REPORTED` of them. */
function recordDifferences(records: readonly Session30Record[], expected: readonly Session30Record[]): string[] {
  const got = new Map(records.map(record => [record.id, JSON.stringify(comparable(record))]));
  const want = new Map(expected.map(record => [record.id, JSON.stringify(comparable(record))]));
  const differences: string[] = [];
  for (const id of new Set([...want.keys(), ...got.keys()])) {
    if (differences.length === REPORTED) break;
    if (got.get(id) !== want.get(id)) differences.push(`${id}: got ${clipped(got.get(id) ?? null)}, want ${clipped(want.get(id) ?? null)}`);
  }
  return differences;
}

/** One of the roots a case's fill step adds: the case set gives a fill step's sessions one revision, as one step. */
const filler = (record: Session30Record): boolean => /^synthetic-filler-\d{3}$/.test(record.identity.sessionId);

/**
 * Where the order of the records' revisions and generations differs from the expected order, which the case set gives
 * by steps, at most `REPORTED` places. Every pair of values is compared by the sign of its difference, except two values
 * of different fillers: the core commits a fill step's sessions one by one.
 */
function orderDifferences(records: readonly Session30Record[], expected: readonly Session30Record[]): string[] {
  const values = (items: readonly Session30Record[]): {id: string; filler: boolean; name: string; value: number}[] => [...items].sort((a, b) => a.id < b.id ? -1 : 1)
    .flatMap(record => [{id: record.id, filler: filler(record), name: 'revision', value: record.revision}, {id: record.id, filler: filler(record), name: 'generation', value: record.generation}]);
  const got = values(records), want = values(expected);
  if (got.map(item => item.id).join() !== want.map(item => item.id).join()) return ['the records are not the expected ones'];
  const differences: string[] = [];
  for (let i = 0; i < got.length && differences.length < REPORTED; i++) {
    for (let j = i + 1; j < got.length && differences.length < REPORTED; j++) {
      const a = got[i], b = got[j], c = want[i], d = want[j];
      if (a === undefined || b === undefined || c === undefined || d === undefined || a.filler && b.filler && a.id !== b.id) continue;
      if (Math.sign(a.value - b.value) !== Math.sign(c.value - d.value)) differences.push(`${a.name} of ${a.id} against ${b.name} of ${b.id}`);
    }
  }
  return differences;
}

const compactAttention = (attention: Attention): unknown => ({kind: attention.kind, id: attention.id.status === 'known' ? attention.id.id : null,
  turn: attention.turn.status === 'known' ? attention.turn.id : null});

/** Runs one case through a world, checking each of its checks. */
async function run(item: SessionCase, context: Parameters<Parameters<typeof it>[1]>[0]): Promise<void> {
  const file = join(await stateDir(context), 'core.sqlite');
  const clock = manualClock(cases.startAtMs);
  // The cases need no sync to disk: crashes and their recovery are the store's own tests.
  const world = await World.open(context, {file, clock, wrap: db => { db.exec('PRAGMA synchronous = OFF'); return db; }});
  const names = new Map(Object.entries(cases.sessions).map(([key, {identity}]) => [sessionEntityId(identity), key]));
  const identities = new Map(Object.values(cases.sessions).map(({identity}) => [sessionEntityId(identity), identity]));
  for (const check of item.checks) for (const message of check.messages) identities.set(message.subject, message.data.identity);
  const name = (id: string): string => names.get(id) ?? id;
  // The manual clock moves to the step's instant, and the core's timer then runs what fell due by then.
  const until = async (atMs: number): Promise<void> => {
    if (atMs <= clock.now()) return;
    clock.advance(atMs - clock.now());
    await world.store.refresh();
    await world.store.drain();
  };
  // The core's intake drops a repeated (source, id) before its session logic sees it.
  const take = async (message: Message<Parameters<World['take']>[0]['data']>): Promise<void> => {
    if (world.store.received(message) !== 'new') return;
    await world.take(message);
  };
  let from = 0;
  for (const [index, step] of item.steps.entries()) {
    await until(cases.startAtMs + step.atMs);
    if (step.kind === 'observe' || step.kind === 'deliver') await take(step.message);
    else if (step.kind === 'fill') for (const message of step.messages) await take(message);
    else if (step.kind === 'acknowledge') await world.store.acknowledge(step.message, step.message.subject, step.message.data.noticeId, step.message.data.consumerId);
    else if (step.kind === 'restart') await world.crashAndRestart();
    else if (step.kind === 'reset') {
      // The cutover: the old agent-state `state` row is still in the store when this release first opens it.
      world.close();
      const db = new DatabaseSync(file);
      db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL); INSERT INTO state VALUES (1, 0, \'{}\')');
      db.close();
      await world.crashAndRestart();
    }
    await world.store.drain();
    for (const check of item.checks.filter(found => found.after === index + 1)) {
      const where = `${item.id} check after ${check.after}`;
      await until(cases.startAtMs + check.atMs);
      const records = world.store.records();
      const expected = check.messages.map(message => message.data);
      assert.deepEqual(recordDifferences(records, expected), [], `${where}: the records`);
      assert.deepEqual(orderDifferences(records, expected), [], `${where}: the order of revisions and generations`);
      for (const record of records) assert.ok(record.generation <= record.revision, `${where}: a generation is never after its revision`);
      const sent = world.published.slice(from).map(({message}) => message);
      from = world.published.length;
      assert.deepEqual(sent.filter(message => message.type === 'org.bunny.session.removed')
        .map(message => ({session: name(message.subject), reason: (message.data as {reason: string}).reason})), check.removed, `${where}: the removals`);
      const occurrences = sent.filter(message => message.kind === 'occurrence').map((message): CompactOccurrence => {
        const data = message.data as {session: string; attention?: Attention; cause?: string; noticeId?: string};
        const kind = message.dataschema.split('/').at(-2) as CompactOccurrence['kind'];
        if (kind === 'session-ended') return {kind, session: name(data.session)};
        if (kind === 'turn-ended') {
          const identity = identities.get(data.session);
          const turn = ['p1', 'p2', 'p3', 't1', 't2', 't3', 'c1', 'k1'].find(found => identity !== undefined && noticeIdOf(identity, found) === data.noticeId);
          return {kind, session: name(data.session), notice: turn ?? null};
        }
        return {kind, session: name(data.session), attention: compactAttention(data.attention as Attention), ...(data.cause === undefined ? {} : {cause: data.cause})} as CompactOccurrence;
      });
      // A notice the case names by its hex ID is one on an unknown turn.
      const expectedOccurrences = check.occurrences.map(occurrence => occurrence.kind === 'turn-ended' && occurrence.notice !== null && /^[0-9a-f]{64}$/.test(occurrence.notice)
        ? {...occurrence, notice: null} : occurrence);
      assert.deepEqual(occurrences, expectedOccurrences, `${where}: the occurrences in order`);
    }
  }
}

for (const item of cases.cases) {
  // The capacity case commits 130 changes; the rest take a few.
  it(`the core store gives the case set's records and occurrences: ${item.id}`, async context => { await run(item, context); }, item.id === 'capacity' ? 60_000 : 20_000);
}

it('a check of a full core fails fast with a short report, and orders a fill step as one step', () => {
  const capacity = cases.cases.find(item => item.id === 'capacity');
  const check = capacity?.checks[0];
  assert.ok(check);
  const expected = check.messages.map(message => message.data);
  assert.equal(expected.length, 128);
  // The core commits each filler at its own revision, before every other session's.
  let revision = 0;
  const committed = expected.map(record => filler(record) ? {...record, revision: ++revision, generation: revision}
    : {...record, revision: record.revision + 200, generation: record.generation + 200});
  assert.deepEqual(orderDifferences(committed, expected), []);
  // Every record wrong, and every order reversed: still at most five short differences each.
  const wrong = expected.map(record => ({...record, revision: 1000 - record.revision, generation: 1000 - record.revision, turn: {status: 'known' as const, id: 'wrong'}}));
  const records = recordDifferences(wrong, expected), order = orderDifferences(wrong, expected);
  assert.deepEqual([records.length, order.length], [REPORTED, REPORTED]);
  assert.ok([...records, ...order].every(text => text.length < 1000));
});

it('the core runs every case of the set, step 8\'s restart, root starts and capacity among them', () => {
  assert.deepEqual(cases.cases.filter(item => item.since === 'step 8').map(item => item.id).sort(), ['capacity', 'child-only', 'clear-resume', 'launch', 'restart']);
  assert.ok(cases.cases.some(item => item.since === 'step 7' && item.id === 'reset'));
  assert.deepEqual([...new Set(cases.cases.map(item => item.since))].sort(), ['now', 'step 7', 'step 8']);
});
