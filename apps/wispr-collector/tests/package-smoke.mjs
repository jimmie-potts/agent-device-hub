import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { supervise } from '../dist/supervisor.js';
import { validateSnapshot,numericReport } from '@jimmie-potts/wispr-contracts';
const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'offline-'));
try{
 const stateDirectory=join(directory,'state'),sourcePath=join(directory,'source.sqlite');mkdirSync(stateDirectory);
 const db=new DatabaseSync(sourcePath);db.exec("CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,duration REAL,speechDuration REAL,transcript TEXT);INSERT INTO History VALUES('a','2026-10-01T12:00:00Z','formatted',12,6,4,'PRIVATE_CANARY')");db.close();
 const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:directory,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:false}};
 const run=operation=>supervise({directory:stateDirectory,entry:new URL('../dist/run-worker.js',import.meta.url),payload:{config,operation}});
 await run({command:'collect'});const snapshot=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.equal(validateSnapshot(snapshot).ok,true);assert.equal(snapshot.numeric.totals.words,12);
 await run({command:'export',format:'json',output:join(directory,'numeric.json')});await run({command:'export',format:'csv',output:join(directory,'numeric.csv')});
 for(const file of ['numeric.json','numeric.csv'])assert.equal(readFileSync(join(directory,file),'utf8').includes('PRIVATE_CANARY'),false);
 const status=await run({command:'status'});assert.equal(status.revision,1);console.log('Offline synthetic collection, numeric JSON/CSV export, status and independent contract import passed.');
}finally{rmSync(directory,{recursive:true,force:true});}
