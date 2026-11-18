// The one-time session reset and generations from the core revision (Hub #1865 group 7, design decisions 9 and 12): a
// store shaped like an installed one, with the old agent-state `state` row, session records, session latest-history and
// span rows and pending session publications, opens with no session at the stored revision plus one. It publishes
// nothing and keeps every other row. A session that comes back gets a generation no earlier record carried.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAgentState, MemoryStorage} from '@jimmie-potts/agent-state';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {CoreStore} from '../src/core/store.js';
import {DEFAULT_CONSUMERS} from '../src/index.js';
import {CHILD, OTHER, approvalPrompt, runtimeEnded, sessionStarted, turnEnded, turnStarted} from './fixtures/agents.js';
import {fillDisk} from './fixtures/disk.js';
import {World} from './fixtures/store-world.js';
import {START, flush, it, stateDir} from './support.js';

const records = (messages: readonly Message[]): SessionRecord[] =>
  messages.filter(message => message.type === 'org.bunny.session.updated').map(message => message.data as SessionRecord);
const OLD_STATE = 'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)';
/** The session family's routing keys, as the reset deletes their pending publications. */
const SESSION_KEYS = ['bunny.state.session.', 'bunny.event.attention-raised.', 'bunny.event.attention-cleared.', 'bunny.event.turn-ended.', 'bunny.event.session-ended.'];
const sessionKey = (key: string): boolean => SESSION_KEYS.some(prefix => key.startsWith(prefix));

/** The old agent-state owner's 2.1 state block, as an installed store keeps it in `state`: empty, or holding one session. */
async function oldStateBlock(session: boolean): Promise<string> {
  const owner = await createAgentState({storage: new MemoryStorage(), ownerId: 'bunny-core', consumers: DEFAULT_CONSUMERS.map(consumer => ({...consumer})), clock: () => START});
  if (session) {
    const result = await owner.ingest({apiVersion: '1.2', identity: OTHER, turn: {status: 'known', id: 'turn-old'}, parent: {status: 'top-level'},
      event: {kind: 'turn.started'}, observedAtMs: START, ordering: {status: 'unknown'}});
    assert.equal(result.ok, true);
  }
  const state = await owner.exportState();
  await owner.shutdown();
  return JSON.stringify(state);
}

/** Every table's rows, by table name, to show what a start changed. */
function tables(db: DatabaseSync): Record<string, unknown[]> {
  const names = (db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name').all() as {name: string}[]).map(row => row.name);
  return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name}"`).all().map(row => ({...row}))]));
}

/** Plants the old `state` table with its row, as a store the release before this step wrote it holds it. */
async function plantOldState(file: string, session = true): Promise<void> {
  const db = new DatabaseSync(file);
  try {
    db.exec(OLD_STATE);
    const block = await oldStateBlock(session);
    db.prepare('INSERT INTO state VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload')
      .run((JSON.parse(block) as {revision: number}).revision, block);
  } finally {
    db.close();
  }
}

it('a session recreated after the reset never reuses a generation or revision from before it', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  const world = await World.open(context, {file});
  await world.observe(sessionStarted);
  await world.observe(turnStarted);
  await world.observe(turnEnded);
  await world.observe(sessionStarted, {identity: OTHER});
  const before = records(world.since(0));
  const generations = new Set(before.map(record => record.generation));
  const revision = world.store.revision;
  world.close();

  // The cutover: the old owner's `state` row is still in the store when this release first opens it. Before this step,
  // the closest a store came to dropping its sessions was an empty state block, which restarted the old owner's count.
  await plantOldState(file, false);
  const again = await World.open(context, {file});
  const from = again.published.length;
  await again.observe(sessionStarted);
  const [created] = records(again.since(from)).filter(record => record.identity.sessionId === 'session-sim-1');
  assert.ok(created, 'the session comes back as a new record');
  assert.equal(generations.has(created.generation), false, `generation ${created.generation} was not used before the reset (${[...generations].join(', ')})`);
  assert.ok(created.generation > revision, 'the generation is a core revision after every earlier one');
  assert.ok(created.revision >= created.generation, 'a generation is never after its revision');
});

it('the reset empties session state on a store shaped like an installed one, publishes nothing, keeps every other row, and runs once', async context => {
  const dir = await stateDir(context);
  const file = join(dir, 'core.sqlite');
  const setup = new DatabaseSync(file);
  setup.exec('CREATE TABLE part_rows (value TEXT NOT NULL); INSERT INTO part_rows VALUES (\'kept\')');
  setup.close();
  const world = await World.open(context, {file});
  await world.observe(turnStarted, {sequence: 1});
  await world.observe(approvalPrompt('approval-1'), {sequence: 2});
  await world.observe(sessionStarted, {identity: OTHER});
  await world.observe(sessionStarted, {identity: CHILD});
  await world.observe(runtimeEnded, {identity: CHILD});
  // Pending publications at the upgrade: a session state and occurrence, and another part's message.
  world.dead = true;
  await world.observe(turnEnded, {sequence: 3});
  const other = await world.store.transaction(tx => tx.add('bunny.state.mode.synthetic', {
    kind: 'state', type: 'org.bunny.mode.updated', subject: 'synthetic', dataschema: 'https://bunny.invalid/events/mode/2.0',
    data: {id: 'synthetic', revision: tx.revision(), mode: 'work', selectedAtMs: START},
  }));
  await flush();
  world.close();
  await plantOldState(file);

  const db = new DatabaseSync(file);
  const before = tables(db);
  db.close();
  const pending = (before.bunny_outbox as {routing_key: string; id: string}[]);
  assert.ok(pending.some(row => sessionKey(row.routing_key)), 'session publications are pending');
  assert.ok(pending.some(row => row.id === other.id), 'and another part\'s');
  assert.ok((before.core_history_latest as {family: string}[]).some(row => row.family === 'session'), 'session latest-history rows exist');
  assert.ok((before.core_records as {family: string}[]).some(row => row.family === 'session'), 'and session records');
  assert.ok(before.core_sessions?.length === 2 && before.core_session_guards?.length === 1, 'and rows in the session and guard tables');
  const revision = (before.core_revision as {value: number}[])[0]?.value ?? 0;

  const reset = await World.open(context, {file});
  assert.deepEqual(reset.store.records(), [], 'no session is served');
  assert.equal(reset.store.revision, revision + 1, 'at the stored revision plus one');
  const sent = reset.since(0);
  assert.deepEqual(sent.filter(message => message.subject !== 'synthetic').map(message => message.type), [], 'no session message goes out');
  assert.deepEqual(sent.map(message => message.id), [other.id], 'another part\'s pending message still goes out, once');
  reset.close();

  const after = new DatabaseSync(file);
  context.after(() => { if (after.isOpen) after.close(); });
  const opened = tables(after);
  assert.equal(opened.state, undefined, 'the old state table is gone');
  assert.deepEqual([opened.core_sessions, opened.core_session_guards], [[], []], 'the session and guard tables are empty');
  assert.deepEqual(opened.part_rows, before.part_rows, 'other parts\' tables are untouched');
  assert.deepEqual(opened.core_taken, before.core_taken, 'taken (source, id) records stay');
  assert.deepEqual(opened.core_history, before.core_history, 'history fact rows are never deleted');
  assert.deepEqual((opened.core_history_latest as {family: string}[]).filter(row => row.family === 'session'), [], 'the session latest-history rows are gone');
  assert.deepEqual((opened.core_history_span as {family: string}[]).filter(row => row.family === 'session'), [], 'and their spans');
  assert.deepEqual((opened.core_history_latest as {family: string}[]).filter(row => row.family !== 'session'),
    (before.core_history_latest as {family: string}[]).filter(row => row.family !== 'session'), 'other families\' latest rows stay');
  assert.deepEqual((opened.core_records as {family: string}[]).filter(row => row.family === 'session'), [], 'no session record is kept');
  assert.deepEqual(opened.bunny_outbox, [], 'the session publications were deleted and the other part\'s went out');
  after.close();

  // A second start finds nothing to drop: it changes nothing and publishes nothing.
  const quiet = new DatabaseSync(file);
  const settled = tables(quiet);
  quiet.close();
  const second = await World.open(context, {file});
  assert.deepEqual(second.since(0), []);
  assert.equal(second.store.revision, revision + 1);
  second.close();
  const last = new DatabaseSync(file);
  assert.deepEqual(tables(last), settled, 'the second start changed no row');
  last.close();
});

/** A store as the release before this step left it: its revision and the old `state` table, with no session table of this step. */
function oldStore(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`${OLD_STATE}; INSERT INTO state VALUES (1, 1, '{}');
    CREATE TABLE core_revision (only INTEGER PRIMARY KEY CHECK (only = 1), value INTEGER NOT NULL, commits INTEGER NOT NULL) STRICT;
    INSERT INTO core_revision VALUES (1, 7, 7)`);
  db.close();
}

/** A store on `database`, as the core opens it, with a participant that takes every publication. */
function store(database: DatabaseSync): CoreStore {
  return new CoreStore({database, clock: {now: () => START}, onError: () => {},
    sdk: {source: 'bunny/core', publishMessage: <T extends object>(_key: string, message: Message<T>): Promise<Message<T>> => Promise.resolve(message)}});
}
const hasState = (db: DatabaseSync): boolean => db.prepare('SELECT 1 FROM sqlite_master WHERE name = \'state\'').get() !== undefined;
const revisionOf = (db: DatabaseSync): number => (db.prepare('SELECT value FROM core_revision').get() as {value: number}).value;

it('a reset that falls on a full disk leaves the store unopened and unchanged, and runs once there is room', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  oldStore(file);
  const db = new DatabaseSync(file);
  context.after(() => { if (db.isOpen) db.close(); });
  fillDisk(db);
  const full = store(db);
  context.after(() => { full.close(); });
  await assert.rejects(full.open(AbortSignal.abort()), /storage-unavailable/);
  assert.equal(full.takeFailure(), 'full', 'a full disk, so the core keeps running and refuses durable work');
  assert.equal(full.isOpen, false);
  assert.equal(hasState(db), true, 'nothing changed');
  assert.equal(revisionOf(db), 7);
  db.exec('PRAGMA max_page_count = 1073741823');
  await full.open(AbortSignal.abort());
  assert.equal(full.isOpen, true);
  assert.equal(hasState(db), false, 'the reset ran');
  assert.equal(full.revision, 8);
});

it('a crash during the reset leaves the store unchanged, and the next start runs the reset again', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  oldStore(file);
  const db = new DatabaseSync(file);
  context.after(() => { if (db.isOpen) db.close(); });
  // The process dies inside the reset's transaction: its writes never commit.
  const dying = new Proxy(db, {get(target, property) {
    if (property === 'exec') {
      return (sql: string): void => {
        if (sql.includes('DROP TABLE state')) throw new Error('the process died');
        target.exec(sql);
      };
    }
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  }});
  const crashed = store(dying);
  await assert.rejects(crashed.open(AbortSignal.abort()), /storage-unavailable/);
  crashed.close();
  assert.equal(db.isTransaction, false);
  assert.equal(hasState(db), true, 'the store is unchanged');
  assert.equal(revisionOf(db), 7);
  const next = store(db);
  context.after(() => { next.close(); });
  await next.open(AbortSignal.abort());
  assert.equal(hasState(db), false);
  assert.equal(next.revision, 8);
});

it('a release before the reset run in between writes a state row again, and the next start resets the new session tables too', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  const world = await World.open(context, {file});
  await world.observe(turnStarted);
  await world.observe(sessionStarted, {identity: OTHER});
  await world.observe(runtimeEnded, {identity: OTHER});
  assert.equal(world.store.sessions().length, 1);
  assert.equal(world.rows('SELECT * FROM core_session_guards').length, 1);
  const revision = world.store.revision;
  world.close();
  // The earlier release starts with empty session state and writes its own state row; it never reads the new tables.
  await plantOldState(file, false);
  const forward = await World.open(context, {file});
  assert.deepEqual(forward.store.sessions(), [], 'no session from before the reset returns');
  assert.deepEqual(forward.rows('SELECT * FROM core_session_guards'), [], 'nor any guard');
  assert.deepEqual(forward.store.records(), []);
  assert.equal(forward.store.revision, revision + 1);
  assert.deepEqual(forward.since(0), [], 'and nothing is published');
});
