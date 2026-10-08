// The SDK's full-disk test (Hub #1003): `fullDisk` tells a full disk from SQLite (`SQLITE_FULL`) or the file system
// (`ENOSPC`) by codes alone, on the error or on a bounded chain of its causes, as the modules and the runtime's tools map
// it to `capacity` or `disk-short`. A real full database comes from SQLite's own page limit, as the runtime's
// tests/fixtures/disk.ts makes one.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fullDisk, openModuleDatabaseFile} from '../src/index.js';

/** A chain of `depth` wrappers around `inner`, each the `cause` of the one before. */
function wrapped(inner: unknown, depth: number): unknown {
  let error = inner;
  for (let level = 0; level < depth; level += 1) error = new Error(`wrapper ${String(level)}`, {cause: error});
  return error;
}

void test('a full database from SQLite is a full disk, by its result code', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-full-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const db = openModuleDatabaseFile(join(dir, 'module.sqlite'));
  context.after(() => { db.close(); });
  db.exec('CREATE TABLE t (b BLOB)');
  const pages = Number((db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count);
  db.exec(`PRAGMA max_page_count = ${String(pages)}`);
  let caught: unknown;
  try {
    db.exec('INSERT INTO t VALUES (zeroblob(100000))');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== undefined, 'the insert failed');
  assert.equal(fullDisk(caught), true);
  // An extended result code keeps SQLITE_FULL in its low byte.
  assert.equal(fullDisk({errcode: 13 | (1 << 8)}), true);
});

void test('ENOSPC from the file system is a full disk, by its code', () => {
  assert.equal(fullDisk(Object.assign(new Error('write failed'), {code: 'ENOSPC'})), true);
  assert.equal(fullDisk({code: 'ENOSPC'}), true);
});

void test('a full disk is found through the causes that wrap it, as far as seven deep', () => {
  assert.equal(fullDisk(wrapped({errcode: 13}, 1)), true, 'SQLITE_FULL one cause deep');
  assert.equal(fullDisk(wrapped({code: 'ENOSPC'}, 1)), true, 'ENOSPC one cause deep');
  assert.equal(fullDisk(wrapped({errcode: 13}, 7)), true, 'the seventh cause is read');
  assert.equal(fullDisk(wrapped({errcode: 13}, 8)), false, 'the eighth cause is not: the walk is bounded');
});

void test('nothing else is a full disk: other codes, the text alone, non-errors and a cycle', () => {
  assert.equal(fullDisk({errcode: 5}), false, 'SQLITE_BUSY');
  assert.equal(fullDisk(Object.assign(new Error('denied'), {code: 'EACCES'})), false, 'EACCES');
  assert.equal(fullDisk(new Error('database or disk is full')), false, 'the text alone tells nothing');
  for (const value of [undefined, null, 'ENOSPC', 13]) assert.equal(fullDisk(value), false, String(value));
  const cycle = new Error('a cause of itself') as Error & {cause?: unknown};
  cycle.cause = cycle;
  assert.equal(fullDisk(cycle), false, 'a cycle ends the walk');
});
