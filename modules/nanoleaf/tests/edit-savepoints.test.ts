// A machine edit's savepoints on a full disk (Hub #1001). A machine edit's check at admission (`checkEdit`) and a queued
// machine edit's application (`processMachineEdits`) run inside the caller's transaction, each under a savepoint. When
// SQLite ends that whole transaction, as a full disk does, the edit must throw the full disk's error, not the failed
// savepoint rollback's ("no such savepoint"), and the store must take the next edit once there is room. When the
// transaction stays open, the savepoint must still undo the edit's own writes and keep the caller's. The module's store
// opens as the runtime opens a module's (Hub #972) and fills through SQLite's own full-disk path, as the runtime's
// tests/fixtures/disk.ts does; the module-level behavior follows at the end, on the running module's own connection.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {openModuleDatabaseFile, type CommandDraft} from '@jimmie-potts/sdk';
import {initialize} from '../src/database.js';
import {checkEdit, processMachineEdits, queuedEdits, type MapEdit} from '../src/module/edits.js';
import {MODULE_TABLES} from '../src/module/views.js';
import {NANOLEAF_FAMILIES} from '../src/index.js';
import {SharedCopy} from '../src/shared-input.js';
import {execute, first} from '../src/sqlite.js';
import {ModuleWorld, moduleCommand} from './module-support.js';
import {suite, temporary, test} from './support.js';

/** SQLite's result code for a full database, from a node:sqlite error's `errcode`. */
const SQLITE_FULL = 13;
const DEVICE = 'wall';
const RECOLOR: MapEdit = {kind: 'project-color', project: 'a', color: '#123456'};

const codeOf = (error: unknown): number | undefined =>
  error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;

/**
 * Leaves the database no room to grow: small pages, then a page limit at the file's size once VACUUM has emptied its free
 * list, as tests/fixtures/disk.ts does. A WAL database keeps its page size through a VACUUM, so it leaves WAL for it.
 * Returns the page count, for giving the room back.
 */
function fillDisk(db: DatabaseSync): number {
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA page_size = 512; VACUUM; PRAGMA journal_mode = WAL');
  const pages = Number((db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count);
  db.exec(`PRAGMA max_page_count = ${String(pages)}`);
  return pages;
}

/**
 * Filler rows on both sides of each key an edit's bookkeeping (`markDirty`) writes, which is removed first, so whichever
 * page that key's row goes into is full once VACUUM has packed the pages.
 */
function padBookkeeping(db: DatabaseSync): void {
  db.exec("DELETE FROM meta WHERE key IN ('event_revision','dirty')");
  for (const prefix of ['dirty', 'event_revision']) {
    for (let row = 0; row < 60; row += 1) execute(db, 'INSERT INTO meta VALUES (?, ?)', `${prefix}-${String(row).padStart(2, '0')}`, 'x'.repeat(30));
  }
}

/**
 * The module's store with one project, `a`, and meta rows that fill their pages, so an edit's own bookkeeping
 * (`markDirty`'s rows) needs a page of its own, as a store that has run for a while would.
 */
function store(context: TestContext): DatabaseSync {
  const db = openModuleDatabaseFile(join(temporary(context), 'nanoleaf.sqlite'));
  context.after(() => { db.close(); });
  initialize(db);
  db.exec(MODULE_TABLES);
  execute(db, 'INSERT INTO nanoleaf_devices (device) VALUES (?)', DEVICE);
  db.exec("INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]')");
  padBookkeeping(db);
  return db;
}

const colorOf = (db: DatabaseSync): unknown => first(db, "SELECT color FROM projects WHERE id='a'")?.[0];
const queue = (db: DatabaseSync, edit: MapEdit): void => {
  execute(db, 'INSERT INTO nanoleaf_machine_edits (id,device,edit,revision,expires_ms) VALUES (?,?,?,?,?)', 'machine-1', DEVICE, JSON.stringify(edit), 0, 2 ** 40);
};
const check = (db: DatabaseSync): void => { checkEdit(db, new SharedCopy(), undefined, DEVICE, RECOLOR, [DEVICE]); };
const applyQueued = (db: DatabaseSync): ReturnType<typeof processMachineEdits> => processMachineEdits(db, new SharedCopy(), undefined, DEVICE, 0, [DEVICE], () => 0);

suite('a machine edit on a full disk reports the full disk, and its savepoint keeps the caller\'s transaction', () => {
  test('the check at admission throws the full disk, leaves no transaction, and checks once there is room', context => {
    const db = store(context);
    const pages = fillDisk(db);
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => { check(db); }, (error: unknown) => {
      assert.equal(codeOf(error), SQLITE_FULL, 'the full disk, not "no such savepoint"');
      return true;
    });
    assert.equal(db.isTransaction, false, 'SQLite ended the transaction, and nothing is left open');
    db.exec(`PRAGMA max_page_count = ${String(pages * 64)}`);
    db.exec('BEGIN IMMEDIATE');
    check(db);
    db.exec('COMMIT');
    assert.equal(colorOf(db), '#aa55ff', 'a check changes nothing');
  });

  test('a queued edit throws the full disk, leaves no transaction, and applies once there is room', context => {
    const db = store(context);
    queue(db, RECOLOR);
    const pages = fillDisk(db);
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => applyQueued(db), (error: unknown) => {
      assert.equal(codeOf(error), SQLITE_FULL, 'the full disk, not "no such savepoint"');
      return true;
    });
    assert.equal(db.isTransaction, false, 'SQLite ended the transaction, and nothing is left open');
    assert.equal(queuedEdits(db, DEVICE).length, 1, 'the edit still waits');
    db.exec(`PRAGMA max_page_count = ${String(pages * 64)}`);
    db.exec('BEGIN IMMEDIATE');
    assert.deepEqual(applyQueued(db).map(end => end.result), ['applied']);
    db.exec('COMMIT');
    assert.equal(colorOf(db), '#123456');
  });

  // The other branch: a statement error that keeps the transaction open, here a trigger that refuses the edit's
  // bookkeeping after the edit's own write. The savepoint must undo that write and keep the caller's.
  const refuseBookkeeping = (db: DatabaseSync): void => {
    db.exec("CREATE TRIGGER refuse_dirty BEFORE INSERT ON meta WHEN NEW.key = 'event_revision' BEGIN SELECT RAISE(ABORT, 'refused'); END");
  };

  test('a check that succeeds, or fails with the transaction open, rolls back to its savepoint and keeps the caller\'s work', context => {
    const db = store(context);
    db.exec('BEGIN IMMEDIATE');
    execute(db, 'INSERT INTO meta VALUES (?, ?)', 'callers-work', '1');
    check(db);
    assert.equal(colorOf(db), '#aa55ff', 'the check rolled its own write back');
    assert.equal(db.isTransaction, true, 'the caller\'s transaction stays open');
    refuseBookkeeping(db);
    assert.throws(() => { check(db); }, /refused/);
    assert.equal(colorOf(db), '#aa55ff', 'the failed check rolled its own write back');
    assert.equal(db.isTransaction, true, 'the caller\'s transaction stays open');
    db.exec('COMMIT');
    assert.equal(first(db, "SELECT value FROM meta WHERE key='callers-work'")?.[0], '1', 'the caller\'s work committed');
  });

  test('a queued edit that fails with the transaction open rolls back to its savepoint and keeps the caller\'s work', context => {
    const db = store(context);
    queue(db, RECOLOR);
    refuseBookkeeping(db);
    db.exec('BEGIN IMMEDIATE');
    execute(db, 'INSERT INTO meta VALUES (?, ?)', 'callers-work', '1');
    assert.throws(() => applyQueued(db), /refused/);
    assert.equal(colorOf(db), '#aa55ff', 'the failed edit rolled its own write back');
    assert.equal(db.isTransaction, true, 'the caller\'s transaction stays open');
    db.exec('COMMIT');
    assert.equal(first(db, "SELECT value FROM meta WHERE key='callers-work'")?.[0], '1', 'the caller\'s work committed');
    assert.equal(queuedEdits(db, DEVICE).length, 1, 'the edit still waits');
  });
});

const wallEdit = (requestId: string, edit: object): {key: string; draft: CommandDraft<object>} =>
  moduleCommand(NANOLEAF_FAMILIES.wallEdit.family, NANOLEAF_FAMILIES.wallEdit.type, {requestId, edit});
const machineEdit = (requestId: string, expected: number, edit: object): {key: string; draft: CommandDraft<object>} =>
  moduleCommand(NANOLEAF_FAMILIES.machineEdit.family, NANOLEAF_FAMILIES.machineEdit.type, {requestId, expectedConfigurationRevision: expected, edit});

suite('the module on a full disk', () => {
  test('refuses a wall edit and a machine edit with capacity, leaves no transaction, and takes both once there is room', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const db = world.harness.moduleDatabase();
    if (db === undefined) throw new Error('the module has no open store');
    db.exec("INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]')");
    padBookkeeping(db);
    const revision = (): number => Number(world.query('SELECT configuration_revision FROM nanoleaf_devices WHERE device=?', 'wall')[0]?.[0]);
    const pages = fillDisk(db);
    for (const [name, command] of [['wall-full', () => wallEdit('wall-full', RECOLOR)], ['machine-full', () => machineEdit('machine-full', revision(), RECOLOR)]] as const) {
      const {key, draft} = command();
      const result = await world.request(key, draft);
      // A full disk is the registry's `capacity`: the store cannot take the command now, and nothing changed.
      assert.deepEqual(result.status === 'rejected' && result.error.error, {
        code: 'capacity', retryable: true, detail: 'the module\'s store is full; nothing changed', requestId: name,
        traceId: result.status === 'rejected' ? result.error.error.traceId : undefined,
      }, `${name}: ${JSON.stringify(result)}`);
      assert.equal(db.isTransaction, false, `${name}: no transaction is left open`);
      // The bus records the reply at the registry's level for `capacity`, WARN; the module adds no ERROR record.
      const decision = world.diagnostics.find(diagnostic => diagnostic.event === 'command.replied' && diagnostic.requestId === name);
      assert.deepEqual([decision?.level, decision?.code, decision?.outcome], ['warn', 'capacity', 'rejected'], name);
      assert.deepEqual(world.logs().filter(record => record.fields['bunny.request.id'] === name).map(record => [record.level, record.event]), [], name);
    }
    // No record holds the error's text: SQLite's message for a full disk, or the failed rollback's.
    const text = JSON.stringify([world.logs(), world.diagnostics]);
    for (const leak of ['database or disk is full', 'no such savepoint']) assert.ok(!text.includes(leak), leak);
    assert.deepEqual(world.query("SELECT color FROM projects WHERE id='a'"), [['#aa55ff']], 'nothing changed');
    db.exec(`PRAGMA max_page_count = ${String(pages * 64)}`);
    const wall = wallEdit('wall-room', {kind: 'project-color', project: 'a', color: '#223344'});
    assert.equal((await world.request(wall.key, wall.draft)).status, 'accepted');
    const machine = machineEdit('machine-room', revision(), RECOLOR);
    assert.equal((await world.request(machine.key, machine.draft)).status, 'accepted');
    await world.until(() => world.outcomes('machine-room').length > 0, 5000, 'the machine edit applied');
    assert.equal(world.outcomes('machine-room')[0]?.data.result, 'succeeded');
    assert.deepEqual(world.query("SELECT color FROM projects WHERE id='a'"), [['#123456']]);
  });

  test('any other store failure at admission stays internal, logged once at ERROR with its type and no text', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const db = world.harness.moduleDatabase();
    if (db === undefined) throw new Error('the module has no open store');
    db.exec("INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]')");
    // A read-only store refuses each write with SQLITE_READONLY, not a full disk.
    const release = world.refuseStore('writes');
    const {key, draft} = wallEdit('wall-refused', RECOLOR);
    const result = await world.request(key, draft);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'internal');
    const records = world.logs().filter(record => record.fields['bunny.request.id'] === 'wall-refused');
    assert.deepEqual(records.map(record => [record.level, record.event, record.fields['bunny.code'], record.fields['error.type']]),
      [['error', 'command.rejected', 'internal', 'Error']]);
    assert.ok(!JSON.stringify(records).includes('readonly database'), 'no record holds the error\'s text');
    release();
  });
});
