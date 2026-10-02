import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {aggregate,contribution} from '../apps/wispr-collector/dist/numeric.js';
const row=(id,overrides={})=>({id,timestamp:'2026-03-08 06:30:00 +00:00',status:'formatted',numWords:60,duration:60,speechDuration:30,numWordsCorrected:null,numDictionaryReplacements:null,appName:'Slack',invalid:[],...overrides});
export const producer=()=>aggregate([
 row('a'),row('b',{timestamp:'2026-03-08 07:30:00 +00:00',numWords:40,duration:20,speechDuration:10,numWordsCorrected:0,numDictionaryReplacements:2}),
 row('c',{numWords:20,duration:0,speechDuration:null,appName:'ChatGPT'}),row('d',{numWords:10,duration:-1,speechDuration:-1,appName:'C:\\private\\CANARY.exe'}),
 row('e',{status:'raw',numWords:500}),row('f',{numWords:0}),row('g',{timestamp:'2026-02-31T12:00:00Z'})
].map(r=>contribution(r)),{namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',revision:1,now:'2026-03-09T00:00:00.000Z',timezone:'America/New_York'});
test('the bundled Hub numeric fixture is exact current collector output',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../apps/hub/fixtures/wispr-numeric.json',import.meta.url),'utf8'));assert.deepEqual(fixture,producer());assert.equal(JSON.stringify(fixture).includes('CANARY'),false);
});

test('opted-in collector stages and revocation agree with the real authorized Hub routes',async t=>{
 const {mkdtemp,mkdir,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const {DatabaseSync}=await import('node:sqlite'),{createHash}=await import('node:crypto');
 const {executeOperation}=await import('../apps/wispr-collector/dist/operations.js'),{startHub}=await import('../apps/hub/dist/server.js');
 const root=await mkdtemp(join(tmpdir(),'wispr-language-consumer-')),stateDirectory=join(root,'state'),directory=join(root,'hub');await mkdir(stateDirectory,{mode:0o700});await mkdir(directory,{mode:0o700});
 let hub;t.after(async()=>{await hub?.close();await rm(root,{recursive:true,force:true});});
 const sourcePath=join(root,'source.sqlite'),db=new DatabaseSync(sourcePath);
 db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,appName TEXT,asrText TEXT,formattedText TEXT,editedText TEXT,detectedLanguage TEXT,editedTextStatus TEXT,editObservationEnd TEXT)');
 const insert=db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 for(const id of ['a','b','c'])insert.run(id,new Date().toISOString(),'formatted',2,'Slack','hello there','hello world','hello friend','en','complete',new Date(Date.now()+1000).toISOString());db.close();
 const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:root,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:true}};
 await executeOperation(config,{command:'collect'},{phase:()=>{}});
 const snapshot=JSON.parse(await readFile(join(stateDirectory,'aggregate.json'),'utf8')),token='w'.repeat(43);
 hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'reader',digest:createHash('sha256').update(token).digest('hex'),scopes:['read'],devices:['dictation']}],wispr:{sourceId:'dictation',aggregatePath:join(stateDirectory,'aggregate.json'),diagnosticsPath:join(stateDirectory,'status.json'),shareTextAggregates:true},clock:()=>Date.parse(snapshot.generatedAt)});
 const get=async path=>{const response=await fetch(hub.url+'/api/wispr/v1/'+path,{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200,path);return response.json();};
 for(const [corpus,field] of [['raw','raw'],['cleaned','formatted'],['observed','observed']])for(const period of ['today','7d','30d','all']){
  const result=await get(`language?corpus=${corpus}&period=${period}&app=slack&category=messaging`);
  assert.equal(result.revision,snapshot.revision);assert.deepEqual(result.data.table,snapshot.language.tables.find(t=>t.corpus===field&&t.preset===period&&t.app==='slack'&&t.category==='messaging'));
 }
 const summary=await get('summary');assert.equal(summary.data.totals.words,6);
 assert.ok(!JSON.stringify(await get('export?format=json')).includes('friend'));
 assert.ok(JSON.stringify(await get('export?format=json&includeText=true&period=all&corpus=observed')).includes('friend'));
 config.language.enabled=false;await executeOperation(config,{command:'status'},{phase:()=>{}});
 const revoked=await get('language?period=all&corpus=observed');assert.notEqual(revoked.generation,snapshot.generation);assert.equal(revoked.data.availability,'disabled');assert.ok(!JSON.stringify(revoked).includes('friend'));
});
