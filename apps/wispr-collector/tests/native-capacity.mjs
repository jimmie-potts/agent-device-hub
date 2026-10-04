import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { supervise } from '../dist/supervisor.js';
import {qualifyLanguageResources} from './language-resources.mjs';
assert.equal(process.platform,'win32');assert.equal(Number(process.versions.node.split('.')[0]),24);
const root=process.env.WISPR_TEST_TMPDIR;assert.ok(root);const directory=mkdtempSync(join(root,'native-capacity-'));
try{
 const sourcePath=join(directory,'source.sqlite'),stateDirectory=join(directory,'state');mkdirSync(stateDirectory);
 const db=new DatabaseSync(sourcePath);db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,duration REAL,speechDuration REAL);BEGIN');
 const insert=db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?)');for(let i=0;i<100000;i++)insert.run(String(i),'2026-10-01T12:00:00Z','formatted',10,5,3);db.exec('COMMIT');db.close();
 const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:directory,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:false}};
 const run=()=>supervise({directory:stateDirectory,entry:new URL('../dist/run-worker.js',import.meta.url),payload:{config,operation:{command:'collect'}}});
 const start=performance.now();await run();const elapsedMs=Math.round(performance.now()-start),snapshot=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));
 assert.equal(snapshot.numeric.totals.dictations,100000);assert.equal(snapshot.numeric.totals.words,1000000);
 const extra=new DatabaseSync(sourcePath);extra.prepare('INSERT INTO History VALUES(?,?,?,?,?,?)').run('overflow','2026-10-01T12:00:00Z','formatted',10,5,3);extra.close();
 await assert.rejects(run(),/source-capacity/);assert.deepEqual(JSON.parse(readFileSync(join(stateDirectory,'aggregate.json'))),snapshot);
 console.log(JSON.stringify({result:'passed',scope:'native synthetic 100000-row bound',rows:100000,elapsedMs,overflowRejected:true,lastGoodPreserved:true}));
}finally{rmSync(directory,{recursive:true,force:true});}
console.log(JSON.stringify(qualifyLanguageResources(root)));
