// History as a fact log (#1740): each row's origin and place in that origin's order, the migration of a store written
// before it, read after a sequence, and the duplicate check limited to the local origin. Synthetic stores only, each in
// a temporary directory or in memory; the clock is the store's manual clock and nothing waits on real time.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {hostname, userInfo} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {it} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {openModuleDatabaseFile} from '@jimmie-potts/sdk';
import {History, MAX_FACTS, type OperationStep} from '../src/core/history.js';
import {World} from './fixtures/store-world.js';
import {stateDir} from './support.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** History's tables exactly as the release before #1740 creates them (history.ts at e106dfa6). */
const RELEASED_SCHEMA = `CREATE TABLE IF NOT EXISTS core_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, revision INTEGER NOT NULL,
    kind TEXT NOT NULL, source TEXT NOT NULL, message_id TEXT, type TEXT NOT NULL, subject TEXT NOT NULL, request_id TEXT, record TEXT NOT NULL) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS core_history_message ON core_history (source, message_id) WHERE message_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS core_history_request ON core_history (request_id) WHERE request_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS core_history_latest (source TEXT NOT NULL, family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
    record TEXT NOT NULL, PRIMARY KEY (source, family, id)) STRICT;
  CREATE TABLE IF NOT EXISTS core_refused (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, source TEXT NOT NULL, message_id TEXT NOT NULL,
    message TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS core_records (family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL,
    PRIMARY KEY (family, id)) STRICT`;

const OLD_COLUMNS = 'seq, at_ms, revision, kind, source, message_id, type, subject, request_id, record';

/** Every table's rows and every schema entry, as plain values. */
function dump(database: DatabaseSync, skip: readonly string[] = []): Record<string, unknown> {
  const tables = (database.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name').all() as {name: string}[]).map(row => row.name);
  const out: Record<string, unknown> = {
    schema: database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all().map(row => ({...row})),
  };
  for (const table of tables.filter(name => !skip.includes(name))) out[table] = database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map(row => ({...row}));
  return out;
}

const step = (index: number): OperationStep => ({
  event: 'sent', requestId: `request-${index}`, kind: 'device', command: 'power-set', target: 'lamp', requestedBy: 'bunny/parts/dashboard', status: 'sent',
});

const outcome = (id: string, result = 'succeeded'): Message<unknown> => ({
  specversion: '1.0', bunnyprofile: '2.0', id, source: 'bunny/modules/lamp', type: 'org.bunny.power.set.completed', subject: 'lamp',
  time: '2026-10-06T12:00:00.000Z', kind: 'outcome', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/outcome/2.0',
  data: {requestId: `request-${id}`, result},
}) as Message<unknown>;

void it('a store written by the release before #1740 migrates every row to this origin in write order, exactly and once', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  const database = openModuleDatabaseFile(file);
  context.after(() => { if (database.isOpen) database.close(); });
  database.exec(RELEASED_SCHEMA);
  // Rows as the release writes them: every kind, an operation step without a message ID, a removal and its tombstone,
  // instants out of order, and a gap in `seq` that the per-origin sequence must not copy.
  const insert = database.prepare(`INSERT INTO core_history (seq, at_ms, revision, kind, source, message_id, type, subject, request_id, record)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rows: [number, number, number, string, string, string | null, string, string, string | null, string][] = [
    [1, 5000, 1, 'change', 'bunny/core', 'state-1', 'org.bunny.session.updated', 'session-a', null, '{"family":"session","id":"session-a","revision":1,"previous":null,"changed":{"activity":"working"},"removed":[]}'],
    [2, 4000, 1, 'operation', 'bunny/parts/dashboard', null, 'power-set', 'lamp', 'request-1', JSON.stringify(step(1))],
    [3, 6000, 2, 'occurrence', 'bunny/core', 'occurrence-1', 'org.bunny.attention.raised', 'session-a', null, '{"kind":"occurrence"}'],
    [5, 6000, 2, 'outcome', 'bunny/modules/lamp', 'outcome-1', 'org.bunny.power.set.completed', 'lamp', 'request-1', JSON.stringify(outcome('outcome-1'))],
    [6, 7000, 3, 'removal', 'bunny/core', 'removal-1', 'org.bunny.session.removed', 'session-a', null, '{"kind":"removal"}'],
    [9, 8000, 4, 'operation', 'bunny/parts/dashboard', null, 'power-set', 'lamp', 'request-2', JSON.stringify(step(2))],
  ];
  for (const row of rows) insert.run(...row);
  database.prepare('INSERT INTO core_history_latest VALUES (?, ?, ?, ?, ?)').run('bunny/core', 'session', 'session-a', 3, 'null');
  database.prepare('INSERT INTO core_refused (at_ms, source, message_id, message) VALUES (?, ?, ?, ?)').run(6500, 'bunny/modules/lamp', 'outcome-1', '{}');
  database.prepare('INSERT INTO core_records VALUES (?, ?, ?, ?)').run('session', 'session-a', 2, '{"id":"session-a"}');
  const before = dump(database, ['core_history']);
  const oldRows = database.prepare(`SELECT ${OLD_COLUMNS} FROM core_history ORDER BY seq`).all().map(row => ({...row}));
  const oldSchema = (before.schema as {name: string}[]).filter(entry => !['core_history', 'core_history_message'].includes(entry.name));

  const history = new History(database);

  assert.match(history.origin, UUID, 'the origin is a random UUID');
  assert.deepEqual(database.prepare('SELECT * FROM core_origin').all().map(row => ({...row})), [{only: 1, origin: history.origin}]);
  const migrated = database.prepare('SELECT seq, origin, origin_seq AS originSeq FROM core_history ORDER BY seq').all().map(row => ({...row}));
  assert.deepEqual(migrated, rows.map(([seq], index) => ({seq, origin: history.origin, originSeq: index + 1})),
    'every row has this origin, and its sequence follows the order the rows were written, from 1, with no gaps or repeats');
  assert.deepEqual(database.prepare(`SELECT ${OLD_COLUMNS} FROM core_history ORDER BY seq`).all().map(row => ({...row})), oldRows, 'every other column is unchanged');
  const after = dump(database, ['core_history']);
  for (const table of Object.keys(before).filter(name => name !== 'schema')) assert.deepEqual(after[table], before[table], `${table} is unchanged`);
  assert.deepEqual(after.core_origin, [{only: 1, origin: history.origin}], 'the origin is created');
  assert.deepEqual(after.core_history_span, [], 'and the span table (#1772) is created empty');
  const newSchema = (after.schema as {name: string}[]);
  for (const entry of oldSchema) assert.ok(newSchema.some(item => JSON.stringify(item) === JSON.stringify(entry)), `${entry.name} is unchanged`);
  assert.deepEqual(newSchema.map(entry => entry.name).filter(name => !oldSchema.some(item => item.name === name)).sort(),
    ['core_history', 'core_history_origin', 'core_history_origin_message', 'core_history_span', 'core_origin', 'sqlite_autoindex_core_history_span_1'],
    'history gains its origin columns and indexes, the old message index goes, and the span table (#1772) comes');
  assert.equal(database.isTransaction, false, 'the migration committed');

  // Opened again, as at the next start, it changes nothing at all.
  const migratedDump = dump(database);
  const again = new History(database);
  assert.equal(again.origin, history.origin);
  assert.deepEqual(dump(database), migratedDump, 'a second run changes nothing');

  // The next row continues this origin's order.
  again.write([{kind: 'operation', step: step(3)}], 9000, 5);
  assert.deepEqual(again.after(history.origin, 6).map(row => [row.seq, row.originSeq]), [[10, 7]]);
  database.close();
});

void it('opening an existing history store keeps retired metadata on old rows and leaves it empty on new rows', context => {
  const database = new DatabaseSync(':memory:');
  context.after(() => database.close());
  const first = new History(database);
  const columns = (): unknown[] => database.prepare('PRAGMA table_info(core_history)').all().map(row => row.name);
  assert.deepEqual(columns(), [...OLD_COLUMNS.split(', '), 'origin', 'origin_seq']);
  first.write([{kind: 'operation', step: step(1)}], 1000, 1);
  database.exec(`ALTER TABLE core_history ADD COLUMN continuity TEXT;
    ALTER TABLE core_history ADD COLUMN settings_patch TEXT;
    CREATE INDEX core_history_legacy_barrier ON core_history (origin, origin_seq) WHERE continuity GLOB 'legacy:*';
    UPDATE core_history SET continuity = 'legacy:synthetic', settings_patch = '{"kind":"change"}' WHERE seq = 1`);
  const before = dump(database);
  const reopened = new History(database);
  assert.deepEqual(dump(database), before);
  reopened.write([{kind: 'operation', step: step(2)}], 2000, 2);
  assert.deepEqual(dump(database).schema, before.schema);
  assert.deepEqual(database.prepare('SELECT * FROM core_history WHERE seq = 1').all().map(row => ({...row})), before.core_history);
  assert.deepEqual({...database.prepare('SELECT continuity, settings_patch FROM core_history WHERE seq = 2').get()},
    {continuity: null, settings_patch: null});
  const rows = reopened.after(first.origin, 0);
  assert.deepEqual(rows.map(row => [row.originSeq, row.record]), [[1, step(1)], [2, step(2)]]);
  assert.ok(rows.every(row => !('continuity' in row) && !('settings_patch' in row)));
});

void it('an ignored origin backfill rolls back without adding history metadata', context => {
  const database = new DatabaseSync(':memory:');
  context.after(() => database.close());
  database.exec(RELEASED_SCHEMA);
  database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, type, subject, record)
    VALUES (1, 1, 'operation', 'bunny/core', 'power-set', 'lamp', ?)`).run(JSON.stringify(step(1)));
  database.exec("CREATE TRIGGER ignore_origin BEFORE UPDATE ON core_history BEGIN SELECT RAISE(IGNORE); END");
  const before = dump(database);
  assert.throws(() => new History(database), /the local history origin was not stored/);
  assert.deepEqual(dump(database), before);
});

void it('a migration that fails at its last step leaves the store exactly as it was', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  const database = openModuleDatabaseFile(file);
  context.after(() => { if (database.isOpen) database.close(); });
  database.exec(RELEASED_SCHEMA);
  const insert = database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record)
    VALUES (?, 1, 'operation', 'bunny/parts/dashboard', NULL, 'power-set', 'lamp', ?, ?)`);
  for (let index = 1; index <= 3; index++) insert.run(1000 * index, `request-${index}`, JSON.stringify(step(index)));
  database.prepare('INSERT INTO core_refused (at_ms, source, message_id, message) VALUES (?, ?, ?, ?)').run(6500, 'bunny/modules/lamp', 'outcome-1', '{}');
  // A table under the name of the index the migration creates last, so that step throws after every other step ran.
  database.exec('CREATE TABLE core_history_origin (x INTEGER)');
  const before = dump(database);

  assert.throws(() => new History(database), /core_history_origin/);

  assert.equal(database.isTransaction, false, 'the transaction ended');
  assert.deepEqual(dump(database), before, 'every table, schema entry and sqlite_sequence is as it was');
  assert.equal(database.prepare('SELECT 1 FROM sqlite_master WHERE name = \'core_origin\'').get(), undefined, 'no origin is left behind');
  assert.deepEqual((database.prepare('PRAGMA table_info(core_history)').all() as {name: string}[]).map(column => column.name),
    OLD_COLUMNS.split(', '), 'no new column is left behind');
  database.close();
});

void it('a process killed partway through the backfill leaves the store as the previous release wrote it', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  let database = openModuleDatabaseFile(file);
  context.after(() => { if (database.isOpen) database.close(); });
  database.exec(RELEASED_SCHEMA);
  const insert = database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record)
    VALUES (?, 1, 'operation', 'bunny/parts/dashboard', NULL, 'power-set', 'lamp', ?, ?)`);
  database.exec('BEGIN');
  for (let index = 1; index <= 2000; index++) insert.run(index, `request-${index}`, JSON.stringify(step(index)));
  database.exec('COMMIT');
  const before = dump(database);
  database.close();

  // The child migrates the store with the runtime's opener and kills itself with SIGKILL from a trigger when the backfill
  // reaches row 1000: a fixed point in the work, so nothing depends on timing.
  const child = `
    const [historyUrl, sdkUrl, file] = process.argv.slice(1);
    const {History} = await import(historyUrl);
    const {openModuleDatabaseFile} = await import(sdkUrl);
    const database = openModuleDatabaseFile(file);
    database.function('die', () => { process.kill(process.pid, 'SIGKILL'); return 0; });
    database.exec('CREATE TEMP TRIGGER die_midway AFTER UPDATE ON core_history WHEN NEW.seq = 1000 BEGIN SELECT die(); END');
    new History(database);
    process.exit(3);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child, '--',
    new URL('../src/core/history.js', import.meta.url).href, import.meta.resolve('@jimmie-potts/sdk'), file], {encoding: 'utf8'});
  assert.equal(result.signal, 'SIGKILL', `the child was killed partway: ${result.stderr}`);

  database = openModuleDatabaseFile(file);
  assert.deepEqual(dump(database), before, 'the store reopens exactly as the previous release wrote it');
  assert.deepEqual(database.prepare('PRAGMA integrity_check').all().map(row => ({...row})), [{integrity_check: 'ok'}]);
  const history = new History(database);
  assert.deepEqual({...database.prepare('SELECT COUNT(*) AS rows, MIN(origin_seq) AS low, MAX(origin_seq) AS high FROM core_history WHERE origin = ?').get(history.origin)},
    {rows: 2000, low: 1, high: 2000}, 'the next start migrates it whole');
  database.close();
});

void it('rows a release before #1740 adds to a migrated store join this origin\'s order at the next start', context => {
  const database = new DatabaseSync(':memory:');context.after(() => database.close());
  const history = new History(database);
  history.write([{kind: 'operation', step: step(1)}, {kind: 'operation', step: step(2)}], 1000, 1);
  // The release before #1740 names neither column, and its message index comes back.
  database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record)
    VALUES (2000, 2, 'operation', 'bunny/parts/dashboard', NULL, 'power-set', 'lamp', 'request-3', ?)`).run(JSON.stringify(step(3)));
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS core_history_message ON core_history (source, message_id) WHERE message_id IS NOT NULL');
  const reopened = new History(database);
  assert.deepEqual(reopened.after(history.origin, 0).map(row => [row.seq, row.originSeq, row.requestId]),
    [[1, 1, 'request-1'], [2, 2, 'request-2'], [3, 3, 'request-3']]);
  assert.equal(database.prepare('SELECT 1 FROM sqlite_master WHERE name = \'core_history_message\'').get(), undefined);
});

void it('the origin is created once, survives a restart, differs between stores and names no host, user or path', async context => {
  const world = await World.open(context);
  const {origin} = world.store.history;
  assert.match(origin, UUID);
  for (const personal of [hostname(), userInfo().username, world.file].filter(value => value.length >= 4)) {
    assert.ok(!origin.includes(personal.toLowerCase()), 'no host, user or path');
  }
  await world.crashAndRestart();
  assert.equal(world.store.history.origin, origin, 'the same origin after a restart');
  assert.deepEqual(world.rows('SELECT origin FROM core_origin'), [{origin}], 'one origin, kept in the store');
  const other = await World.open(context);
  assert.notEqual(other.store.history.origin, origin, 'two installations never share one');
});

void it('a read after N returns exactly that origin\'s rows after N, in order, a bounded page at a time', context => {
  const database = new DatabaseSync(':memory:');context.after(() => database.close());
  const history = new History(database);
  const {origin} = history;
  history.write(Array.from({length: 7}, (_, index) => ({kind: 'operation', step: step(index + 1)})), 1000, 1);
  database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record, origin, origin_seq)
    VALUES (1000, 1, 'operation', 'bunny/parts/dashboard', NULL, 'power-set', 'lamp', 'foreign', '{}', ?, 4)`).run('7d1b3c1e-0b0a-4c4e-9a52-2f8f7f0c0001');
  assert.deepEqual(history.after(origin, 0).map(row => row.originSeq), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(history.after(origin, 3).map(row => [row.originSeq, row.requestId]), [[4, 'request-4'], [5, 'request-5'], [6, 'request-6'], [7, 'request-7']]);
  assert.deepEqual(history.after(origin, 3, 2).map(row => row.originSeq), [4, 5], 'bounded by the limit');
  assert.deepEqual(history.after(origin, 3)[0]?.record, step(4));
  assert.ok(history.after(origin, 0).every(row => row.origin === origin), 'another origin\'s rows stay out');
  // A reader that keeps its own cursor rebuilds the whole log and then hears nothing new.
  const read: number[] = [];
  let cursor = 0;
  for (let page = history.after(origin, cursor, 3); page.length > 0; page = history.after(origin, cursor, 3)) {
    read.push(...page.map(row => row.originSeq));
    cursor = page.at(-1)?.originSeq ?? cursor;
  }
  assert.deepEqual(read, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(history.after(origin, cursor), [], 'a repeated read after the same cursor returns nothing new');
  assert.deepEqual(history.after('3f0d2a6c-5a52-4d0c-8f3e-000000000000', 0), [], 'an unknown origin returns nothing');
  history.write([{kind: 'operation', step: step(8)}], 2000, 2);
  assert.deepEqual(history.after(origin, cursor).map(row => row.originSeq), [8], 'and the next row once it is written');
  for (const [afterSeq, limit] of [[-1, 1], [1.5, 1], [0, 0], [0, MAX_FACTS + 1], [0, 2.5]] as const) {
    assert.throws(() => history.after(origin, afterSeq, limit), RangeError, `${afterSeq}, ${limit}`);
  }
});

void it('a read after N returns at most 500 rows by default', context => {
  const database = new DatabaseSync(':memory:');context.after(() => database.close());
  const history = new History(database);
  database.exec('BEGIN');
  history.write(Array.from({length: MAX_FACTS + 20}, (_, index) => ({kind: 'operation', step: step(index)})), 1000, 1);
  database.exec('COMMIT');
  const page = history.after(history.origin, 0);
  assert.equal(page.length, MAX_FACTS);
  assert.deepEqual([page[0]?.originSeq, page.at(-1)?.originSeq], [1, MAX_FACTS]);
  assert.equal(history.after(history.origin, MAX_FACTS).length, 20);
});

void it('the duplicate check looks only at this origin\'s rows', context => {
  const database = new DatabaseSync(':memory:');context.after(() => database.close());
  const history = new History(database);
  const message = outcome('outcome-1');
  // Another origin's copy of the same fact, inserted directly, since merging is not built.
  database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record, origin, origin_seq)
    VALUES (1000, 1, 'outcome', ?, ?, ?, 'lamp', 'request-outcome-1', ?, '7d1b3c1e-0b0a-4c4e-9a52-2f8f7f0c0001', 1)`)
    .run(message.source, message.id, message.type, JSON.stringify(message));
  assert.equal(history.received(message), 'new', 'another origin\'s copy is not this origin\'s duplicate');
  history.write([{kind: 'message', message}], 2000, 1);
  assert.deepEqual(history.after(history.origin, 0).map(row => [row.originSeq, row.messageId]), [[1, 'outcome-1']], 'the local copy is kept');
  assert.equal(history.received(message), 'duplicate');
  assert.equal(history.received(outcome('outcome-1', 'failed')), 'conflict');
  history.write([{kind: 'message', message}], 3000, 2);
  assert.equal(history.after(history.origin, 0).length, 1, 'a resend adds nothing');
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM core_history').get() as {count: number}).count, 2);
});

void it('reading the log writes nothing and publishes nothing', async context => {
  const world = await World.open(context);
  await world.store.transaction(tx => {
    tx.step(step(1));
    tx.record(outcome('outcome-1'));
    tx.step({...step(1), event: 'outcome', status: 'completed', outcome: {source: 'bunny/modules/lamp', id: 'outcome-1'}});
  });
  const before = dump(world.db);
  const published = world.published.length;
  const {origin} = world.store.history;
  assert.deepEqual(world.store.history.after(origin, 0).map(row => [row.originSeq, row.kind]), [[1, 'operation'], [2, 'outcome'], [3, 'operation']]);
  assert.deepEqual(world.store.history.after(origin, 3), []);
  assert.deepEqual(dump(world.db), before, 'no table changed');
  assert.equal(world.published.length, published, 'nothing was published');
});
