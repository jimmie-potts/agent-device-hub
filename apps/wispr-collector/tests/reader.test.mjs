import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readSource, readSyntheticSource } from '../dist/reader.js';

const root = process.env.WISPR_TEST_TMPDIR ?? resolve('.local/scratch/wispr-tests');
mkdirSync(root,{recursive:true});
function fixture(t, schema = 'CREATE TABLE History(id TEXT PRIMARY KEY,timestamp TEXT,status TEXT,numWords INTEGER,duration REAL,speechDuration REAL,appName TEXT,asrText TEXT)') {
  const dir = mkdtempSync(join(root,'reader-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'source.sqlite');
  const db = new DatabaseSync(path);
  db.exec(schema);
  return {path,db};
}
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');

test('numeric scan returns only declared columns and preserves source bytes', async t => {
  const {path,db} = fixture(t);
  db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?,?,?)').run('a','2026-10-02 15:00:00 +00:00','formatted',12,5,3,'Slack','SYNTHETIC_PRIVATE_TRANSCRIPT');
  db.close();
  const before = hash(path);
  const result = await readSyntheticSource(path);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].numWords,12);
  assert.equal(result.rows[0].numWordsCorrected,null);
  assert.equal(result.rows[0].numDictionaryReplacements,null);
  assert.equal(result.coverage.duration,true);
  assert.equal(result.coverage.numWordsCorrected,false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_TRANSCRIPT'),false);
  assert.equal('asrText' in result.rows[0],false);
  assert.equal(hash(path),before);
});

test('empty supported source differs from missing or unsupported source', async t => {
  const {path,db} = fixture(t); db.close();
  assert.equal((await readSyntheticSource(path)).rows.length,0);
  await assert.rejects(readSyntheticSource(path+'.absent'),{code:'source-unavailable'});
  const wrong = fixture(t,'CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT)'); wrong.db.close();
  await assert.rejects(readSyntheticSource(wrong.path),{code:'source-schema'});
});

test('views and incompatible required types fail closed', async t => {
  for (const schema of [
    "CREATE VIEW History AS SELECT 'x' AS id,'2026-10-02T00:00:00Z' AS timestamp,'formatted' AS status,1 AS numWords",
    'CREATE TABLE History(id TEXT,timestamp BLOB,status TEXT,numWords INTEGER)',
  ]) {
    const {path,db} = fixture(t,schema); db.close();
    await assert.rejects(readSyntheticSource(path),{code:'source-schema'});
  }
});

test('row, selected-byte, memory and source deadlines reject whole observations', async t => {
  const {path,db} = fixture(t);
  db.exec("INSERT INTO History(id,timestamp,status,numWords) VALUES('a','2026-10-02T00:00:00Z','formatted',1),('b','2026-10-02T00:00:00Z','formatted',2)");
  db.close();
  await assert.rejects(readSyntheticSource(path,{maxRows:1}),{code:'source-capacity'});
  await assert.rejects(readSyntheticSource(path,{maxBytes:8}),{code:'source-capacity'});
  await assert.rejects(readSyntheticSource(path,{maxMemoryBytes:1}),{code:'source-capacity'});
  await assert.rejects(readSyntheticSource(path,{deadlineMs:1}),{code:'source-deadline'});
});

test('duplicate identifiers reject a source scan', async t => {
  const {path,db} = fixture(t,'CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER)');
  db.exec("INSERT INTO History VALUES('same','2026-10-02T00:00:00Z','formatted',1),('same','2026-10-02T00:00:00Z','formatted',2)"); db.close();
  await assert.rejects(readSyntheticSource(path),{code:'source-schema'});
});

test('busy failure is bounded and sanitized', async t => {
  const {path,db} = fixture(t);
  db.exec('BEGIN EXCLUSIVE');
  try {
    const start = performance.now();
    await assert.rejects(readSyntheticSource(path), error => {
      assert.equal(error.code,'source-busy');
      assert.equal(error.message,'source-busy');
      return true;
    });
    assert.ok(performance.now()-start < 5000);
  } finally { db.exec('ROLLBACK'); db.close(); }
});

test('ordinary source entrypoint cannot read SQLite from Linux/WSL', {skip: process.platform==='win32'}, async () => {
  await assert.rejects(readSource('C:\\private\\history.sqlite'),{code:'unsupported-platform'});
});
