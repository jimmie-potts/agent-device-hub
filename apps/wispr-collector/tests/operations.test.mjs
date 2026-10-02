import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,readFileSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { executeOperation } from '../dist/operations.js';
import { sourceIdentity } from '../dist/config.js';
const namespace='11111111-1111-4111-8111-111111111111';
function setup(t){const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'ops-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const stateDirectory=join(dir,'state');mkdirSync(stateDirectory);const sourcePath=join(dir,'source.sqlite');const db=new DatabaseSync(sourcePath);db.exec("CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,transcript TEXT); INSERT INTO History VALUES('a','2026-10-01T12:00:00Z','formatted',10,'PRIVATE_CANARY')");db.close();const config={schemaVersion:'1.0',namespace,ownerDirectory:dir,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:false}};return{dir,config,run:(operation,hooks={})=>executeOperation(config,operation,{phase:()=>{},...hooks})};}
test('one-shot collect, export and source-offline clear use the same retained generation',async t=>{
 const {dir,config,run}=setup(t);await run({command:'collect'});
 const before=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(before.numeric.totals.words,10);
 await run({command:'export',format:'json',output:join(dir,'export.json')});assert.equal(readFileSync(join(dir,'export.json'),'utf8').includes('PRIVATE_CANARY'),false);
 await run({command:'backup',name:'first'});renameSync(config.sourcePath,config.sourcePath+'.offline');
 const cleared=await run({command:'clear'});assert.equal(cleared.unmanagedCopiesRecallable,false);
 const after=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(after.numeric.totals.words,0);assert.notEqual(after.generation,before.generation);
 await assert.rejects(run({command:'restore',name:'first'}),/backup-before-clear/);
 await run({command:'restore',name:'first',historicalReimport:true});assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))).numeric.totals.words,10);
});
test('replacement source requires explicit rebind and disabled collection never scans',async t=>{
 const {config,run}=setup(t);await run({command:'collect'});const original=sourceIdentity(config.sourcePath);renameSync(config.sourcePath,config.sourcePath+'.old');
 const db=new DatabaseSync(config.sourcePath);db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER)');db.close();assert.notEqual(sourceIdentity(config.sourcePath),original);
 await assert.rejects(run({command:'collect'}),/binding-mismatch/);
 await run({command:'rebind',confirmSameSource:true});await run({command:'collect'});
 config.collectionEnabled=false;await assert.rejects(run({command:'collect'}),/collection-disabled/);
});
test('pending commit retries publication before scanning and preserves last-success on failed read',async t=>{
 const {config,run}=setup(t);let failed=false;
 await assert.rejects(run({command:'collect'},{checkpoint:phase=>{if(phase==='committed'&&!failed){failed=true;throw Error('run-failed');}}}),/run-failed/);
 renameSync(config.sourcePath,config.sourcePath+'.offline');await assert.rejects(run({command:'collect'}),/source-unavailable/);
 const published=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))),status=JSON.parse(readFileSync(join(config.stateDirectory,'status.json')));
 assert.equal(published.numeric.totals.words,10);assert.equal(status.lastSuccessAt,published.lastSuccessAt);assert.equal(status.health,'source-unavailable');
 const reported=await run({command:'status'});assert.equal(reported.health,'source-unavailable');assert.equal(reported.lastAttemptAt,status.lastAttemptAt);
});
test('a fresh private directory can recover a numeric backup without reading the source or importing other old rows',async t=>{
 const {dir,config,run}=setup(t);await run({command:'collect'});await run({command:'backup',name:'first'});
 const fresh=join(dir,'recovered');mkdirSync(fresh);mkdirSync(join(fresh,'backups'));
 const {copyFileSync}=await import('node:fs');copyFileSync(join(config.stateDirectory,'backups/first.sqlite'),join(fresh,'backups/first.sqlite'));
 config.stateDirectory=fresh;renameSync(config.sourcePath,config.sourcePath+'.offline');
 await run({command:'restore',name:'first',historicalReimport:true});
 assert.equal(JSON.parse(readFileSync(join(fresh,'aggregate.json'))).numeric.totals.words,10);
 assert.ok(JSON.parse(readFileSync(join(fresh,'control.json'))).captureAfter);
});
test('a failed observation is retained as a gap on the next complete snapshot',async t=>{
 const {config,run}=setup(t);await run({command:'collect'});
 renameSync(config.sourcePath,config.sourcePath+'.offline');await assert.rejects(run({command:'collect'}),/source-unavailable/);
 renameSync(config.sourcePath+'.offline',config.sourcePath);await run({command:'collect'});
 const snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(snapshot.coverage.gaps.some(g=>g.reason==='failed-attempt'),true);
});
