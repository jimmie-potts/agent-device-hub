import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { emptySnapshot } from '@jimmie-potts/wispr-contracts';
import { atomicJson, publishSnapshot, recordFailure } from '../dist/publication.js';

function setup(t){const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'publish-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {directory:dir,aggregate:join(dir,'aggregate.json'),status:join(dir,'status.json')};}
const snapshot=()=>emptySnapshot({namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',now:'2026-10-02T16:00:00.000Z',timezone:'America/New_York'});
const read=path=>JSON.parse(readFileSync(path,'utf8'));

test('publication replaces the full validated snapshot and matching status',t=>{
  const paths=setup(t);const value=snapshot();
  publishSnapshot(paths,value);
  assert.deepEqual(read(paths.aggregate),value);
  assert.equal(read(paths.status).generation,value.generation);
  assert.equal(read(paths.status).health,'cleared');
  assert.deepEqual(readdirSync(paths.directory).sort(),['aggregate.json','status.json']);
});
test('failure status does not refresh successful data or source activity',t=>{
  const paths=setup(t);const value=snapshot();value.lastSuccessAt=value.generatedAt;value.latestSourceDate='2026-10-01';
  publishSnapshot(paths,value);const original=readFileSync(paths.aggregate,'utf8');
  recordFailure(paths,value,'source-unavailable','2026-10-03T16:00:00.000Z');
  assert.equal(readFileSync(paths.aggregate,'utf8'),original);
  const status=read(paths.status);assert.equal(status.lastSuccessAt,value.lastSuccessAt);assert.equal(status.latestSourceDate,'2026-10-01');assert.equal(status.lastAttemptAt,'2026-10-03T16:00:00.000Z');
});
test('invalid or oversized publication preserves the previous valid file',t=>{
  const paths=setup(t);const value=snapshot();publishSnapshot(paths,value);
  assert.throws(()=>publishSnapshot(paths,{...value,transcript:'SYNTHETIC_SECRET'}),/invalid-snapshot/);
  assert.deepEqual(read(paths.aggregate),value);
  assert.throws(()=>atomicJson(paths.aggregate,{large:'x'.repeat(1000)},10),/publication-capacity/);
  assert.deepEqual(read(paths.aggregate),value);
});
test('failed atomic replacement preserves destination and removes only owned temporary data',t=>{
  const paths=setup(t);mkdirSync(paths.aggregate);writeFileSync(join(paths.aggregate,'owned-marker'),'untouched');
  assert.throws(()=>atomicJson(paths.aggregate,{value:1}),/publication-failed/);
  assert.equal(readFileSync(join(paths.aggregate,'owned-marker'),'utf8'),'untouched');
  assert.deepEqual(readdirSync(paths.directory),['aggregate.json']);
});
