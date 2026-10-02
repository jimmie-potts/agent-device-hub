import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,truncateSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join,resolve } from 'node:path';
import { NumericStore } from '../dist/store.js';

const namespace='11111111-1111-4111-8111-111111111111';
const row=(id,timestamp='2026-10-01T12:00:00Z',numWords=10)=>({id,timestamp,status:'formatted',numWords,duration:5,speechDuration:3,numWordsCorrected:null,numDictionaryReplacements:null,appName:'Slack',invalid:[]});
function setup(t){const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'recovery-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const options={directory,namespace,sourceIdentity:'synthetic-source-1',timezone:'America/New_York'};return {directory,open:()=>new NumericStore(options)};}
function collect(store,rows,now='2026-10-02T16:00:00.000Z'){const s=store.ingest(rows,now);store.markPublished(s.revision);return s;}

test('clear advances generation and prevents automatic old-history reimport',t=>{
  const {open}=setup(t);let store=open();const before=collect(store,[row('old')]);
  const cleared=store.clearAll('2026-10-03T00:00:00.000Z');
  assert.notEqual(cleared.snapshot.generation,before.generation);assert.equal(cleared.snapshot.numeric.totals.words,0);
  assert.equal(cleared.unmanagedCopiesRecallable,false);store.markPublished(cleared.snapshot.revision);
  store.close();store=open();
  const after=collect(store,[row('old'),row('new','2026-10-03T00:01:00Z',20)],'2026-10-03T01:00:00.000Z');
  assert.equal(after.numeric.totals.words,20);assert.equal(after.coverage.excluded.beforeCapture,1);store.close();
});
test('historical reimport requires its explicit reset choice',t=>{
  const {open}=setup(t);const store=open();collect(store,[row('old')]);
  const cleared=store.clearAll('2026-10-03T00:00:00.000Z');store.markPublished(cleared.snapshot.revision);
  assert.equal(collect(store,[row('old')],'2026-10-03T01:00:00.000Z').numeric.totals.words,0);
  const reset=store.clearAll('2026-10-03T02:00:00.000Z',{historicalReimport:true});store.markPublished(reset.snapshot.revision);
  assert.equal(collect(store,[row('old')],'2026-10-03T03:00:00.000Z').numeric.totals.words,10);store.close();
});
test('backup preserves archived history and restore never rewinds revisions',async t=>{
  const {open}=setup(t);const store=open();collect(store,[row('a')]);collect(store,[]);
  await store.backup('saved');const newer=collect(store,[row('b','2026-10-02T12:00:00Z',20)]);
  const restored=store.restore('saved','2026-10-03T00:00:00.000Z');
  assert.ok(restored.revision>newer.revision);assert.equal(restored.numeric.totals.words,10);
  assert.equal(restored.coverage.archivedRows,1);store.close();
});
test('pre-clear backup and stale pending publication cannot revive old data',async t=>{
  const {open}=setup(t);let store=open();const first=collect(store,[row('a')]);await store.backup('before-clear');
  store.ingest([row('a'),row('b')],'2026-10-02T17:00:00.000Z');
  const cleared=store.clearAll('2026-10-03T00:00:00.000Z');
  assert.notEqual(store.pending().generation,first.generation);store.close();store=open();
  assert.equal(store.pending().numeric.totals.words,0);store.markPublished(cleared.snapshot.revision);
  assert.throws(()=>store.restore('before-clear','2026-10-03T01:00:00.000Z'),/backup-before-clear/);
  assert.equal(store.snapshot().numeric.totals.words,0);store.close();
});
test('explicit historical backup restore recovers captured history without importing other old rows',async t=>{
  const {open}=setup(t);const store=open();collect(store,[row('saved')]);await store.backup('history');
  const cleared=store.clearAll('2026-10-03T00:00:00.000Z');store.markPublished(cleared.snapshot.revision);
  const restored=store.restore('history','2026-10-03T01:00:00.000Z',{historicalReimport:true});
  assert.equal(restored.numeric.totals.words,10);assert.equal(restored.language.availability,'disabled');store.markPublished(restored.revision);
  const rescanned=collect(store,[row('saved','2026-10-01T12:00:00Z',20),row('not-in-backup','2026-10-01T13:00:00Z',30)],'2026-10-03T02:00:00.000Z');
  assert.equal(rescanned.numeric.totals.words,20);assert.equal(rescanned.coverage.excluded.beforeCapture,1);
  const again=store.clearAll('2026-10-04T00:00:00.000Z');store.markPublished(again.snapshot.revision);
  assert.equal(collect(store,[row('saved')],'2026-10-04T01:00:00.000Z').numeric.totals.words,0);store.close();
});
test('a crash after durable clear authority is repaired before exposing the store',t=>{
  const {open,directory}=setup(t);let store=open();collect(store,[row('a')]);store.close();
  const path=join(directory,'control.json');const control=JSON.parse(readFileSync(path,'utf8'));
  control.generation='33333333-3333-4333-8333-333333333333';control.dataEpoch='44444444-4444-4444-8444-444444444444';control.captureAfter=Date.parse('2026-10-03T00:00:00Z');control.changedAt='2026-10-03T00:00:00.000Z';control.revisionFloor++;
  writeFileSync(path,JSON.stringify(control));
  store=open();assert.equal(store.pending().numeric.totals.words,0);assert.equal(store.snapshot().generation,control.generation);store.close();
});
test('text opt-out preserves numeric history and changes publication generation',async t=>{
  const {open}=setup(t);const store=open();const before=collect(store,[row('a')]);await store.backup('numeric');
  const cleared=store.clearText('2026-10-03T00:00:00.000Z');
  assert.equal(cleared.snapshot.numeric.totals.words,10);assert.notEqual(cleared.snapshot.generation,before.generation);
  assert.equal(cleared.snapshot.language.availability,'disabled');store.markPublished(cleared.snapshot.revision);
  const restored=store.restore('numeric','2026-10-03T01:00:00.000Z');assert.equal(restored.numeric.totals.words,10);assert.equal(restored.language.availability,'disabled');store.close();
});

test('interrupted text clear removes managed derivatives, backups and pending output on restart',async t=>{
  const {open,directory}=setup(t);let store=open();collect(store,[row('a')]);store.close();
  const local=new DatabaseSync(join(directory,'analytics.sqlite'));
  local.prepare('INSERT INTO language VALUES(?,?)').run('a',JSON.stringify({words:{SYNTHETIC_DERIVATIVE_CANARY:3}}));local.close();
  store=open();await store.backup('with-text');store.close();
  const pending=join(directory,'.aggregate.json.55555555-5555-4555-8555-555555555555.pending');writeFileSync(pending,'SYNTHETIC_DERIVATIVE_CANARY');
  const path=join(directory,'control.json'),control=JSON.parse(readFileSync(path,'utf8'));
  control.generation='33333333-3333-4333-8333-333333333333';control.textEpoch++;control.cleanupPending=true;control.changedAt='2026-10-03T00:00:00.000Z';control.revisionFloor++;
  writeFileSync(path,JSON.stringify(control));store=open();
  assert.equal(store.snapshot().numeric.totals.words,10);assert.equal(store.snapshot().language.availability,'disabled');
  assert.equal(existsSync(join(directory,'backups','with-text.sqlite')),false);assert.equal(existsSync(pending),false);
  assert.equal(readFileSync(join(directory,'analytics.sqlite')).includes(Buffer.from('SYNTHETIC_DERIVATIVE_CANARY')),false);
  assert.equal(JSON.parse(readFileSync(path,'utf8')).cleanupPending,false);store.close();
});

test('a malformed backup cannot import extra private fields or damage current data',async t=>{
  const {open,directory}=setup(t);const store=open();collect(store,[row('a')]);await store.backup('bad');const good=collect(store,[row('b')]);
  const db=new DatabaseSync(join(directory,'backups','bad.sqlite'));
  const value=JSON.parse(db.prepare('SELECT value FROM contributions LIMIT 1').get().value);value.rawTranscript='SYNTHETIC_SECRET';
  db.prepare('UPDATE contributions SET value=?').run(JSON.stringify(value));db.close();
  assert.throws(()=>store.restore('bad','2026-10-03T00:00:00.000Z'),/invalid-backup/);
  assert.deepEqual(store.snapshot(),good);store.close();
});
test('oversized backups reject before opening and preserve current data',async t=>{
  const {open,directory}=setup(t);const store=open();const good=collect(store,[row('a')]);await store.backup('oversized');
  truncateSync(join(directory,'backups','oversized.sqlite'),1024*1024*1024+1);
  assert.throws(()=>store.restore('oversized','2026-10-03T00:00:00.000Z'),/invalid-backup/);
  assert.deepEqual(store.snapshot(),good);store.close();
});

test('store capacity rollback retains the last complete report without evicting history',t=>{
  const {directory}=setup(t);
  const store=new NumericStore({directory,namespace,sourceIdentity:'synthetic-source-1',timezone:'America/New_York',maxStoreBytes:65536});
  const good=collect(store,[row('a')]);
  assert.throws(()=>store.ingest(Array.from({length:1000},(_,i)=>row('new-'+i)),'2026-10-02T17:00:00.000Z'),/store-capacity/);
  assert.deepEqual(store.snapshot(),good);assert.equal(store.pending(),null);
  assert.ok(store.capacity().bytes<=65536);store.close();
});
