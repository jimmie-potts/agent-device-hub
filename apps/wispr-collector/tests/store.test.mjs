import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { NumericStore } from '../dist/store.js';

const namespace='11111111-1111-4111-8111-111111111111';
const row=(id,words=10)=>({id,timestamp:'2026-10-01T01:00:00Z',status:'formatted',numWords:words,duration:5,speechDuration:3,numWordsCorrected:null,numDictionaryReplacements:null,appName:'Slack',invalid:[]});
function setup(t){
  const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'store-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const options={directory:dir,namespace,sourceIdentity:'synthetic-source-1',timezone:'America/New_York'};
  return {options,open:()=>new NumericStore(options)};
}
const collect=(store,rows,now='2026-10-02T16:00:00.000Z')=>{
  const s=store.ingest(rows,now);store.markPublished(s.revision);return s;
};

test('retained state survives retries, edits, pruning and reappearance exactly once',t=>{
  const {open}=setup(t);let store=open();
  assert.equal(collect(store,[row('a'),row('b',20)]).numeric.totals.words,30);
  assert.equal(collect(store,[row('a'),row('b',20)]).numeric.totals.words,30);
  assert.equal(collect(store,[row('a',40),row('b',20)]).numeric.totals.words,60);
  let pruned=collect(store,[row('b',20)]);
  assert.equal(pruned.numeric.totals.words,60);assert.equal(pruned.coverage.archivedRows,1);
  store.close();store=open();
  assert.equal(collect(store,[row('a',50),row('b',20)]).numeric.totals.words,70);
  assert.equal(store.snapshot().coverage.archivedRows,0);store.close();
});

test('pending committed publication survives restart and blocks a second scan',t=>{
  const {open}=setup(t);let store=open();
  const committed=store.ingest([row('a')],'2026-10-02T16:00:00.000Z');store.close();store=open();
  assert.equal(store.pending().revision,committed.revision);
  assert.throws(()=>store.ingest([row('a')],'2026-10-02T16:05:00.000Z'),/publication-pending/);
  store.markPublished(committed.revision);
  assert.equal(collect(store,[row('a')]).numeric.totals.words,10);store.close();
});

test('failed scans never reach ingest; transaction faults preserve last-good contributions',t=>{
  const {open}=setup(t);const store=open();
  const good=collect(store,[row('a')]);
  assert.throws(()=>store.ingest([row('a'),row('a',30)],'2026-10-02T16:05:00.000Z'),/duplicate-source-id/);
  assert.deepEqual(store.snapshot(),good);assert.equal(store.pending(),null);
  assert.equal(collect(store,[]).numeric.totals.words,10);store.close();
});

test('binding, namespace and zone mismatches fail without silently merging',t=>{
  const {open,options}=setup(t);open().close();
  for(const override of [{sourceIdentity:'replacement'},{namespace:'22222222-2222-4222-8222-222222222222'},{timezone:'UTC'}]){
    assert.throws(()=>new NumericStore({...options,...override}),/binding-mismatch|zone-change-required/);
  }
});

test('explicit zone rebuild uses retained times without advancing source freshness',t=>{
  const {open}=setup(t);const store=open();
  collect(store,[row('a')]);collect(store,[],'2026-10-02T16:05:00.000Z');
  assert.equal(store.snapshot().numeric.cells[0].date,'2026-09-30');
  const shifted=store.rebuildZone('UTC','2026-10-03T10:00:00.000Z');
  assert.equal(shifted.numeric.cells[0].date,'2026-10-01');
  assert.equal(shifted.lastSuccessAt,'2026-10-02T16:05:00.000Z');
  assert.equal(shifted.coverage.archivedRows,1);store.close();
});
test('an aggregation memory budget failure preserves contributions and the previous revision',t=>{
 const {open,options}=setup(t);let store=open();const before=collect(store,[row('a')]);store.close();
 store=new NumericStore({...options,maxMemoryBytes:1});
 try{assert.throws(()=>store.ingest([row('a',99)],'2026-10-03T16:00:00.000Z'),/source-capacity/);}finally{store.close();}
 store=open();assert.deepEqual(store.snapshot(),before);assert.equal(store.pending(),null);store.close();
});
