import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,readFileSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { executeOperation } from '../dist/operations.js';
import { sourceIdentity } from '../dist/config.js';
import { emptyTotals,numericReport } from '@jimmie-potts/wispr-contracts';
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

test('SQLite rescans replace delayed formatting and nullable counters without duplication',async t=>{
 const {config,run}=setup(t);
 const update=sql=>{const db=new DatabaseSync(config.sourcePath);try{db.exec(sql);}finally{db.close();}};
 update(`ALTER TABLE History ADD COLUMN duration REAL;ALTER TABLE History ADD COLUMN speechDuration REAL;
 ALTER TABLE History ADD COLUMN numWordsCorrected INTEGER;ALTER TABLE History ADD COLUMN numDictionaryReplacements INTEGER;
 UPDATE History SET numWords=20,speechDuration=2,numWordsCorrected=0,numDictionaryReplacements=0;
 INSERT INTO History(id,timestamp,status,numWords) VALUES
 ('late','2026-10-01T13:00:00Z','raw',999),('empty','2026-10-01T12:00:00Z','empty',999),
 ('dismissed','2026-10-01T12:00:00Z','dismissed',999),('unknown','2026-10-01T12:00:00Z','FUTURE_PRIVATE_STATUS',999),
 ('zero','2026-10-01T12:00:00Z','formatted',0),('bad-time','not-a-date','formatted',999);`);
 async function capture(expected,statuses){
   // Each operation opens/closes the retained store, exercising restart as well as rescan.
   await run({command:'collect'});
   const snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));
   assert.deepEqual(snapshot.numeric.totals,{...emptyTotals(),...expected});
   assert.deepEqual(snapshot.coverage.statuses,statuses);
   assert.deepEqual(snapshot.coverage.excluded,{words:1,timestamp:1,beforeCapture:0});
   assert.equal(snapshot.coverage.sourceRows,7);assert.equal(snapshot.coverage.archivedRows,0);
   assert.equal(JSON.stringify(snapshot).includes('FUTURE_PRIVATE_STATUS'),false);return snapshot;
 }
 const initial={dictations:1,words:20,speechSeconds:2,speechWords:20,speechSamples:1,correctionSamples:1,replacementSamples:1};
 await capture(initial,{formatted:3,raw:1,empty:1,dismissed:1,unknown:1});
 update("UPDATE History SET status='formatted',numWords=40,duration=8,speechDuration=4 WHERE id='late'");
 const statuses={formatted:4,raw:0,empty:1,dismissed:1,unknown:1};
 const formatted={...initial,dictations:2,words:60,recordingSeconds:8,recordingWords:40,recordingSamples:1,speechSeconds:6,speechWords:60,speechSamples:2};
 const snapshot=await capture(formatted,statuses),report=numericReport(snapshot,{});
 assert.equal(report.recordingWordsPerMinute,300);assert.equal(report.speechWordsPerMinute,600);
 update("UPDATE History SET numWordsCorrected=0,numDictionaryReplacements=0 WHERE id='late'");
 const zero={...formatted,correctionSamples:2,replacementSamples:2};await capture(zero,statuses);
 update("UPDATE History SET numWordsCorrected=3,numDictionaryReplacements=2 WHERE id='late'");
 const positive={...zero,wordsCorrected:3,dictionaryReplacements:2};await capture(positive,statuses);await capture(positive,statuses);
 update("UPDATE History SET numWords=30,duration=6,speechDuration=3,numWordsCorrected=NULL,numDictionaryReplacements=NULL WHERE id='late'");
 await capture({...formatted,words:50,recordingSeconds:6,recordingWords:30,speechSeconds:5,speechWords:50},statuses);
});

function enableLanguage(config){
 const db=new DatabaseSync(config.sourcePath);
 db.exec('ALTER TABLE History ADD COLUMN asrText TEXT; ALTER TABLE History ADD COLUMN formattedText TEXT; ALTER TABLE History ADD COLUMN editedText TEXT; ALTER TABLE History ADD COLUMN detectedLanguage TEXT; ALTER TABLE History ADD COLUMN editedTextStatus TEXT; ALTER TABLE History ADD COLUMN editObservationEnd TEXT; DELETE FROM History');
 const insert=db.prepare('INSERT INTO History(id,timestamp,status,numWords,asrText,formattedText,editedText,detectedLanguage,editedTextStatus,editObservationEnd) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const id of ['a','b','c'])insert.run(id,'2026-10-01T12:00:00Z','formatted',2,'hello there','hello world','hello friend','en','complete','2026-10-01T12:01:00Z');db.close();config.language={enabled:true};
}
test('opt-in pipeline publishes text and opt-out clears pending revisions and managed text backups before disabled collect',async t=>{
 const {config,run}=setup(t);enableLanguage(config);await run({command:'collect'});
 let snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(snapshot.language.availability,'available');assert.ok(snapshot.language.tables.some(t=>t.words.some(w=>w.text==='friend')));
 await run({command:'backup',name:'text'});
 await assert.rejects(run({command:'collect'},{checkpoint:phase=>{if(phase==='committed')throw Error('run-failed');}}),/run-failed/);
 config.language.enabled=false;config.collectionEnabled=false;renameSync(config.sourcePath,config.sourcePath+'.offline');
 await assert.rejects(run({command:'collect'}),/collection-disabled/);
 const disabled=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(disabled.language.availability,'disabled');assert.equal(disabled.numeric.totals.words,6);assert.notEqual(disabled.generation,snapshot.generation);assert.ok(!JSON.stringify(disabled).includes('friend'));
 const {existsSync}=await import('node:fs');assert.equal(existsSync(join(config.stateDirectory,'backups/text.sqlite')),false);
 const privateDb=new DatabaseSync(join(config.stateDirectory,'analytics.sqlite'),{readOnly:true});assert.equal(privateDb.prepare('SELECT count(*) AS n FROM language').get().n,0);privateDb.close();
 await run({command:'status'});assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'status.json'))).languageEnabled,false);
});

test('opt-out publishes a denial fence even when replacing the aggregate file fails',async t=>{
 const {config,run}=setup(t);enableLanguage(config);await run({command:'collect'});
 const path=join(config.stateDirectory,'aggregate.json'),statusPath=join(config.stateDirectory,'status.json');
 const old=JSON.parse(readFileSync(statusPath));assert.equal(old.languageEnabled,true);
 renameSync(path,path+'.locked');mkdirSync(path);config.language.enabled=false;
 await assert.rejects(run({command:'status'}),/publication-failed/);
 const fence=JSON.parse(readFileSync(statusPath));assert.equal(fence.languageEnabled,false);assert.notEqual(fence.generation,old.generation);
 rmSync(path,{recursive:true});await run({command:'status'});assert.equal(JSON.parse(readFileSync(path)).language.availability,'disabled');
});

test('opt-out denial survives a malformed managed backup that blocks cleanup',async t=>{
 const {config,run}=setup(t);enableLanguage(config);await run({command:'collect'});await run({command:'backup',name:'broken'});
 const backup=new DatabaseSync(join(config.stateDirectory,'backups/broken.sqlite'));backup.exec("UPDATE metadata SET value='{}' WHERE key='state'");backup.close();
 config.language.enabled=false;await assert.rejects(run({command:'status'}));
 assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'status.json'))).languageEnabled,false);
});

test('opt-out clears text before a reporting-zone mismatch rejects collection',async t=>{
 const {config,run}=setup(t);enableLanguage(config);await run({command:'collect'});
 config.language.enabled=false;config.timezone='America/New_York';await assert.rejects(run({command:'collect'}),/zone-change-required/);
 assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'status.json'))).languageEnabled,false);
});

test('reenabling cannot recreate pruned text and numeric restore cannot revive backup text',async t=>{
 const {config,run}=setup(t);enableLanguage(config);await run({command:'collect'});await run({command:'backup',name:'text'});
 await run({command:'restore',name:'text'});assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))).language.availability,'disabled');
 await run({command:'collect'});assert.equal(JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))).language.availability,'available');
 config.language.enabled=false;await run({command:'status'});
 const db=new DatabaseSync(config.sourcePath);db.exec('DELETE FROM History');db.close();config.language.enabled=true;await run({command:'collect'});
 const snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.equal(snapshot.numeric.totals.words,6);assert.ok(snapshot.language.tables.every(t=>t.words.length===0));
});

test('dictionary counters are snapshots in numeric mode and decreases start a new segment',async t=>{
 const {config,run}=setup(t);const db=new DatabaseSync(config.sourcePath);db.exec('CREATE TABLE Dictionary(isDeleted INTEGER,isSnippet INTEGER,frequencyUsed INTEGER,remoteFrequencyUsed INTEGER,phrase TEXT)');db.exec("INSERT INTO Dictionary VALUES(0,1,5,8,'NEVER_EXPORT_DICTIONARY_LABEL')");db.close();
 const capture=async()=>{await run({command:'collect'});return JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))).dictionary;};
 const first=await capture();assert.equal(first.localUsage,5);assert.equal(first.activeSnippets,1);assert.deepEqual(await capture(),first);
 const update=sql=>{const db=new DatabaseSync(config.sourcePath);db.exec(sql);db.close();};
 update('UPDATE Dictionary SET frequencyUsed=NULL');assert.equal((await capture()).localUsage,null);
 update('UPDATE Dictionary SET frequencyUsed=1');const reset=await capture();assert.equal(reset.localUsage,1);assert.equal(reset.segment,first.segment+1);
 config.timezone='America/New_York';await run({command:'zone'});assert.deepEqual(JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json'))).dictionary,reset);
 assert.ok(!readFileSync(join(config.stateDirectory,'aggregate.json'),'utf8').includes('NEVER_EXPORT_DICTIONARY_LABEL'));
});

test('a changed exclusion policy replaces old pending rankings before status publication',async t=>{
 const {config,run}=setup(t);enableLanguage(config);await run({command:'collect'});
 await assert.rejects(run({command:'collect'},{checkpoint:phase=>{if(phase==='committed')throw Error('run-failed');}}),/run-failed/);
 config.language.excludedTerms=['friend'];renameSync(config.sourcePath,config.sourcePath+'.offline');await run({command:'status'});
 const snapshot=JSON.parse(readFileSync(join(config.stateDirectory,'aggregate.json')));assert.ok(snapshot.language.tables.every(t=>t.words.length===0));assert.equal(snapshot.numeric.totals.words,6);
 assert.equal(snapshot.language.tables.find(t=>t.preset==='all'&&t.app==='all'&&t.category==='all'&&t.corpus==='raw').coverage.uncertain,3);
});
