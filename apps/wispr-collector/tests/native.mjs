import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from '../dist/reader.js';

assert.equal(process.platform,'win32','native Wispr qualification requires Windows');
assert.equal(process.versions.node.split('.')[0],'24');
const self = fileURLToPath(import.meta.url);
if (process.argv[2] === 'writer') {
  const writer = new DatabaseSync(process.argv[3]);
  let revision = 2;
  const interval = setInterval(() => {
    writer.prepare('UPDATE History SET numWords=?').run(revision++);
    process.send({type:'committed'});
  },5);
  process.on('message', () => { clearInterval(interval); writer.close(); process.disconnect(); });
} else {
  const root = process.env.WISPR_TEST_TMPDIR;
  assert.ok(root && /^[A-Za-z]:\\/.test(root),'set WISPR_TEST_TMPDIR to an owned local Windows scratch directory');
  mkdirSync(root,{recursive:true});
  const dir = mkdtempSync(join(root,'native-reader-'));
  const path = join(dir,'history.sqlite');
  const db = new DatabaseSync(path);
  let writer;
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE History(id TEXT PRIMARY KEY,timestamp TEXT,status TEXT,numWords INTEGER,asrText TEXT)');
    const insert = db.prepare('INSERT INTO History VALUES(?,?,?,?,?)');
    db.exec('BEGIN');
    for (let i=0;i<1000;i++) insert.run(`synthetic-${i}`,'2026-10-02 12:00:00 +00:00','formatted',1,'SYNTHETIC_PRIVATE_CANARY');
    db.exec('COMMIT');
    const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
    const before = [hash(path),hash(path+'-wal')];
    const quiet = await readSource(path);
    assert.equal(quiet.rows.length,1000);
    assert.deepEqual([hash(path),hash(path+'-wal')],before);
    assert.equal(JSON.stringify(quiet).includes('SYNTHETIC_PRIVATE_CANARY'),false);
    writer = fork(self,['writer',path],{stdio:['ignore','ignore','ignore','ipc']});
    const exit = new Promise(resolve => writer.on('exit', code => resolve(code)));
    await new Promise((resolve,reject) => { writer.once('message',resolve); writer.once('error',reject); });
    for (let i=0;i<4;i++) {
      const observation = await readSource(path);
      assert.equal(observation.rows.length,1000);
      assert.equal(new Set(observation.rows.map(r=>r.numWords)).size,1,'each scan must contain one writer revision');
    }
    writer.send({stop:true}); assert.equal(await exit,0); writer = undefined;
    assert.equal(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);
    const portable = spawnSync(process.execPath,['--test',...['reader.test.mjs','lease.test.mjs','config.test.mjs','language.test.mjs','language-reader.test.mjs','language-aggregate.test.mjs','dictionary.test.mjs','operations.test.mjs','store.test.mjs','recovery.test.mjs'].map(name=>join(dirname(self),name))],{encoding:'utf8',timeout:60000});
    assert.equal(portable.status,0,portable.stdout+portable.stderr);
    process.stdout.write(portable.stdout);
    console.log(JSON.stringify({result:'passed',scope:'native synthetic reader and language/state suites; CLI/package checks separate',node:process.versions.node,sqlite:process.versions.sqlite,coherentScans:4,rowsPerScan:1000,sourcePreserved:true,readerReleased:true}));
  } finally {
    writer?.kill(); db.close(); rmSync(dir,{recursive:true,force:true});
  }
}
