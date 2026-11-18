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
import {sessionEntityId, type Attention, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {World} from './fixtures/store-world.js';
import {it, manualClock, stateDir} from './support.js';

const cases = loadSessionCases();

/** A record without what the case set numbers by steps, its notices on unknown turns unnamed. */
function comparable(record: SessionRecord): unknown {
  const {revision: _revision, generation: _generation, ...rest} = structuredClone(record);
  for (const notice of rest.notices) if (notice.turn.status === 'unknown') notice.id = '';
  return rest;
}

/** The sign of every pairwise difference of the records' revisions and generations, which the case set orders by steps. */
function order(records: readonly SessionRecord[]): number[] {
  const values = [...records].sort((a, b) => a.id < b.id ? -1 : 1).flatMap(record => [record.revision, record.generation]);
  return values.flatMap((a, i) => values.slice(i + 1).map(b => Math.sign(a - b)));
}

const compactAttention = (attention: Attention): unknown => ({kind: attention.kind, id: attention.id.status === 'known' ? attention.id.id : null,
  turn: attention.turn.status === 'known' ? attention.turn.id : null});

/** Runs one case through a world, checking each of its checks. */
async function run(item: SessionCase, context: Parameters<Parameters<typeof it>[1]>[0]): Promise<void> {
  const file = join(await stateDir(context), 'core.sqlite');
  const clock = manualClock(cases.startAtMs);
  const world = await World.open(context, {file, clock});
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
      assert.deepEqual(records.map(comparable).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
        expected.map(comparable).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1), `${where}: the records`);
      assert.deepEqual(order(records), order(expected), `${where}: the order of revisions and generations`);
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
  it(`the core store gives the case set's records and occurrences: ${item.id}`, async context => { await run(item, context); });
}

it('the core runs every case of the set, step 8\'s restart, root starts and capacity among them', () => {
  assert.deepEqual(cases.cases.filter(item => item.since === 'step 8').map(item => item.id).sort(), ['capacity', 'clear-resume', 'launch', 'restart']);
  assert.ok(cases.cases.some(item => item.since === 'step 7' && item.id === 'reset'));
  assert.deepEqual([...new Set(cases.cases.map(item => item.since))].sort(), ['now', 'step 7', 'step 8']);
});
