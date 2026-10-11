import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openModuleDatabaseFile, PrivateRequestDigest, SdkError} from '../src/index.js';

void test('actual SQLite exhaustion during private identity pinning reports capacity and preserves a safe retry', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'sdk-private-digest-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const database = openModuleDatabaseFile(join(dir, 'private.sqlite'));
  context.after(() => {database.close();});
  const digest = new PrivateRequestDigest(database, () => dir);
  database.exec(`CREATE TABLE pressure (value BLOB);
    CREATE TRIGGER full_before_pin BEFORE INSERT ON bunny_private_request_key BEGIN INSERT INTO pressure VALUES (zeroblob(100000)); END;`);
  const pages = (database.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  database.exec(`PRAGMA max_page_count = ${String(pages)}; BEGIN IMMEDIATE`);
  try {
    assert.throws(() => digest.digest('synthetic', 'SYNTHETIC_PRIVATE_INPUT', true), error => error instanceof SdkError && error.body.error.code === 'capacity');
  } finally {if (database.isTransaction) database.exec('ROLLBACK');}
  assert.equal(database.prepare('SELECT 1 FROM bunny_private_request_key').get(), undefined);
  database.exec('DROP TRIGGER full_before_pin; BEGIN IMMEDIATE');
  const identity = digest.digest('synthetic', 'SYNTHETIC_PRIVATE_INPUT', true);
  database.exec('COMMIT; BEGIN IMMEDIATE');
  assert.equal(digest.digest('synthetic', 'SYNTHETIC_PRIVATE_INPUT', false), identity);
  database.exec('COMMIT');
});
