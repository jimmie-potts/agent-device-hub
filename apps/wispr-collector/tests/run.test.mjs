import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { supervise,requestStop } from '../dist/supervisor.js';
const namespace='11111111-1111-4111-8111-111111111111';
function setup(t){const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const stateDirectory=join(dir,'state');mkdirSync(stateDirectory);const sourcePath=join(dir,'source.sqlite'),db=new DatabaseSync(sourcePath);db.exec("CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER);INSERT INTO History VALUES('a','2026-10-01T12:00:00Z','formatted',10)");db.close();const config={schemaVersion:'1.0',namespace,ownerDirectory:dir,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:false}};const run=operation=>supervise({directory:stateDirectory,entry:new URL('../dist/run-worker.js',import.meta.url),payload:{config,operation}});return{dir,config,run};}
test('the direct worker collects and clear replaces the published generation',async t=>{
 const {config,run}=setup(t);const collected=await run({command:'collect'});assert.equal(collected.revision,1);
 const before=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));await run({command:'clear'});
 const after=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.notEqual(after.generation,before.generation);assert.equal(after.numeric.totals.words,0);
 await run({command:'collect'});assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))).numeric.totals.words,0);
});
for(const checkpoint of ['before-commit','committed','published'])test(`process death at ${checkpoint} recovers without duplicate counts`,async t=>{
 const {dir,config,run}=setup(t);await run({command:'collect'});
 const db=new DatabaseSync(config.sourcePath);db.exec('UPDATE History SET numWords=20');db.close();
 const fixture=join(dir,'crash-worker.mjs');writeFileSync(fixture,`import {executeOperation} from ${JSON.stringify(new URL('../dist/operations.js',import.meta.url).href)};import {acquireLease} from ${JSON.stringify(new URL('../dist/lease.js',import.meta.url).href)};process.on('message',async m=>{const guard=acquireLease(m.config.stateDirectory,'worker-lease.sqlite');await executeOperation(m.config,m.operation,{phase:phase=>process.send({type:'phase',phase}),checkpoint:p=>{if(p===${JSON.stringify(checkpoint)})process.exit(7);}});});`);
 await assert.rejects(supervise({directory:config.stateDirectory,entry:pathToFileURL(fixture),payload:{config,operation:{command:'collect'}}}),/run-failed/);
 await run({command:'status'});let snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(snapshot.numeric.totals.words,checkpoint==='before-commit'?10:20);
 await run({command:'collect'});snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(snapshot.numeric.totals.words,20);
});
