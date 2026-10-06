import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { supervise } from '../dist/supervisor.js';
import { validateSnapshot } from '@jimmie-potts/wispr-contracts';
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
 const writer=new DatabaseSync(sourcePath);writer.exec('ALTER TABLE History ADD COLUMN asrText TEXT; ALTER TABLE History ADD COLUMN formattedText TEXT; ALTER TABLE History ADD COLUMN editedText TEXT; ALTER TABLE History ADD COLUMN detectedLanguage TEXT; ALTER TABLE History ADD COLUMN editedTextStatus TEXT; ALTER TABLE History ADD COLUMN editObservationEnd TEXT; DELETE FROM History');
 const insert=writer.prepare('INSERT INTO History(id,timestamp,status,numWords,asrText,formattedText,editedText,detectedLanguage,editedTextStatus,editObservationEnd) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const id of ['a','b','c'])insert.run(id,'2026-10-01T12:00:00Z','formatted',2,'hello there','hello world','hello friend','en','complete','2026-10-01T12:01:00Z');writer.close();
 config.language.enabled=true;await run({command:'collect'});
 const language=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.equal(validateSnapshot(language).ok,true);assert.equal(language.language.availability,'available');assert.ok(language.language.tables.some(t=>t.words.some(w=>w.text==='friend')));
 await run({command:'backup',name:'text'});config.language.enabled=false;await run({command:'status'});
 const disabled=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.equal(disabled.language.availability,'disabled');assert.notEqual(disabled.generation,language.generation);assert.equal(disabled.numeric.totals.words,6);
 assert.ok(!readFileSync(join(stateDirectory,'aggregate.json'),'utf8').includes('friend'));
 console.log('Offline opted-in language publication and text-disabled recovery passed.');
}finally{rmSync(directory,{recursive:true,force:true});}
