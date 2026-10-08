// The Pixoo module's own rows (`PixooStore`) on a full database: a settings save that cannot commit reports the full
// disk, rolls back whole and leaves the store usable once there is room. The database opens as the runtime opens a
// module's (Hub #972), and is filled through SQLite's own full-disk path, as the runtime's tests/fixtures/disk.ts does.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {openModuleDatabaseFile} from '@jimmie-potts/sdk';
import type {PresentationConfiguration} from '../../src/core/index.js';
import {PixooStore} from '../../src/module/store.js';

/** SQLite's result code for a full database, from a node:sqlite error's `errcode`. */
const SQLITE_FULL = 13;

/**
 * Leaves the database no room to grow: small pages, then a page limit at the file's size once VACUUM has emptied its
 * free list. A WAL database keeps its page size through a VACUUM, so it leaves WAL for the VACUUM and comes back.
 */
function fillDisk(db: DatabaseSync): number {
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA page_size = 512; VACUUM; PRAGMA journal_mode = WAL');
  const pages = Number((db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count);
  db.exec(`PRAGMA max_page_count = ${String(pages)}`);
  return pages;
}

const presentation = (q: string): PresentationConfiguration => ({version: 1, mode: 'monitor', filter: {q}, cadenceMs: 1000});

void test('a settings save on a full database reports the full disk, rolls back whole and leaves the store usable', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'pixoo-store-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const db = openModuleDatabaseFile(join(dir, 'pixoo.sqlite'));
  context.after(() => { db.close(); });
  const store = new PixooStore(db);
  store.savePresentation(presentation('before'));
  const revision = store.configurationRevision;
  const pages = fillDisk(db);

  // A value larger than a page needs new pages, which the database may not take.
  assert.throws(() => { store.savePresentation(presentation('x'.repeat(4096))); }, (error: unknown) => {
    assert.ok(error instanceof Error && 'errcode' in error && typeof error.errcode === 'number', 'a SQLite error');
    assert.equal(error.errcode & 0xff, SQLITE_FULL, 'the full disk, not the failed rollback that followed it');
    return true;
  });
  assert.equal(db.isTransaction, false, 'no transaction is left open');
  assert.equal(store.configurationRevision, revision, 'the configuration revision did not move');
  assert.deepEqual(store.presentation(), presentation('before'), 'the saved setting is the one before');

  // Once there is room, the same store saves again.
  db.exec(`PRAGMA max_page_count = ${String(pages * 64)}`);
  store.savePresentation(presentation('after'));
  assert.equal(store.configurationRevision, revision + 1);
  assert.deepEqual(store.presentation(), presentation('after'));
});
