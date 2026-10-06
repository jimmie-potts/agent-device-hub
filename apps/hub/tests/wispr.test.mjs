import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile,symlink,link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {emptySnapshot,emptyTotals,validateSnapshot} from '@jimmie-potts/wispr-contracts';
import {startHub} from '../dist/server.js';
import {wisprConfiguration} from '../dist/wispr.js';
const token='w'.repeat(43),generic='g'.repeat(43),wrong='x'.repeat(43);
const credential=(value,devices)=>({id:value[0],digest:createHash('sha256').update(value).digest('hex'),scopes:['read'],devices});
async function fixture(t,opts={}){
 const root=await mkdtemp(join(tmpdir(),'hub-wispr-')),directory=join(root,'hub');await mkdir(directory,{mode:0o700});
 let now=Date.parse('2026-10-02T16:00:00.000Z');
 const snapshot=emptySnapshot({namespace:randomUUID(),generation:randomUUID(),now:new Date(now).toISOString(),timezone:'America/New_York'});
 snapshot.health='ok';snapshot.revision=1;snapshot.lastSuccessAt=snapshot.generatedAt;snapshot.latestSourceDate='2026-10-02';
 const cell={...emptyTotals(),date:'2026-10-02',hour:12,weekday:5,app:'chatgpt',category:'ai-prompts',archived:false,words:120,dictations:2,speechSeconds:60,speechWords:120,speechSamples:2};
 snapshot.numeric={cells:[cell],totals:Object.fromEntries(Object.keys(emptyTotals()).map(k=>[k,cell[k]]))};snapshot.coverage.captured={from:cell.date,to:cell.date};snapshot.coverage.retained={...snapshot.coverage.captured};snapshot.coverage.sourceRows=2;snapshot.coverage.statuses.formatted=2;
 assert.equal(validateSnapshot(snapshot).ok,true);
 const wispr={sourceId:'dictation',aggregatePath:join(root,'aggregate.json'),diagnosticsPath:join(root,'status.json'),...opts};
 const publish=async(value=snapshot,enabled=false)=>{await writeFile(wispr.aggregatePath,JSON.stringify(value),{mode:0o600});await writeFile(wispr.diagnosticsPath,JSON.stringify({schemaVersion:'1.0',namespace:value.namespace,generation:value.generation,revision:value.revision,lastAttemptAt:value.generatedAt,lastSuccessAt:value.lastSuccessAt,latestSourceDate:value.latestSourceDate,health:value.health,languageEnabled:enabled}),{mode:0o600});};await publish();
 let hub;try{hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[credential(token,['dictation']),credential(generic,[]),credential(wrong,['other'])],wispr,clock:()=>now,browserAccess:'trusted-loopback'});}catch(e){await rm(root,{recursive:true,force:true});throw e;}
 t.after(async()=>{await hub.close();await rm(root,{recursive:true,force:true});});
 const get=(route,bearer=token,headers={})=>fetch(hub.url+'/api/wispr/v1/'+route,{headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),...headers}});
 return {hub,root,wispr,snapshot,publish,get,advance:ms=>{now+=ms;}};
}
test('Wispr numeric summary uses the producer contract through the real Hub',async t=>{
 const {get}=await fixture(t);const res=await get('summary');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');const value=await res.json();assert.equal(value.data.totals.words,120);assert.equal(value.data.speechWordsPerMinute,120);assert.equal(value.sourceId,'dictation');assert.equal(value.revision,1);assert.equal(value.timezone,'America/New_York');assert.equal(value.freshness,'fresh');
 for(const [key,status] of [[null,401],[generic,403],[wrong,403]])assert.equal((await get('summary',key)).status,status);
 assert.equal((await get('summary',token,{origin:'http://evil.invalid'})).status,403);
});

test('all numeric views and exports preserve filter totals and snapshot identity',async t=>{
 const {get}=await fixture(t);
 for(const route of ['series?bucket=day','series?bucket=week','series?bucket=month','heatmap','apps','export?format=json']){
  const r=await get(route);assert.equal(r.status,200,route);const v=await r.json();assert.equal(v.revision,1);assert.equal(v.sourceId,'dictation');assert.equal(JSON.stringify(v).includes('language'),false,'numeric-only response');
  const rows=v.data.rows??v.data.daily;assert.equal(rows.reduce((sum,row)=>sum+row.words,0),120,route);
 }
 const summary=await(await get('summary?app=chatgpt&category=email')).json();assert.equal(summary.data.totals.words,0,'intersection');
 for(const query of ['app=unknown','from=2026-02-30','from=2026-10-03&to=2026-10-02','from=2026-10-01','app=chatgpt&app=slack','timezone=UTC'])assert.equal((await get('summary?'+query)).status,400,query);
 assert.equal((await get('series?bucket=hour')).status,400);
 const csv=await get('export?format=csv');assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/^text\/csv/);assert.match(await csv.text(),/120/);
});

test('last-good numeric data retains its observation time on malformed replacement; clear fences it',async t=>{
 const {get,publish,snapshot,wispr,advance}=await fixture(t);const initial=await(await get('summary')).json();
 await writeFile(wispr.aggregatePath,'{"private":"CANARY_NOT_FOR_HTTP"');advance(610000);
 const stale=await(await get('summary')).json();assert.equal(stale.data.totals.words,120);assert.equal(stale.lastSuccessAt,initial.lastSuccessAt);assert.equal(stale.freshness,'stale');assert.equal(JSON.stringify(stale).includes('CANARY'),false);
 const cleared=structuredClone(snapshot);cleared.generation=randomUUID();cleared.revision++;cleared.health='cleared';cleared.numeric={cells:[],totals:emptyTotals()};cleared.coverage.captured={from:null,to:null};cleared.coverage.retained={from:null,to:null};await publish(cleared);await writeFile(wispr.aggregatePath,'bad');
 assert.equal((await get('summary')).status,503,'new manifest retires all old numeric data');await publish(snapshot);assert.equal((await get('summary')).status,503,'old generation cannot reappear');
});

function language(snapshot){
 snapshot.language={availability:'available',algorithmVersion:'english-1',stopwordVersion:'english-stop-1',tables:[{preset:'today',app:'all',category:'all',corpus:'formatted',words:[{text:'=SUM(1,2)',occurrences:3,dictations:3}],usefulWords:[],phrases:[],changes:[],omitted:{words:0,usefulWords:0,phrases:0,changes:0},coverage:{eligible:3,missing:0,unsupportedLanguage:0,oversized:0,uncertain:0,longChanges:0},comparison:'raw-to-formatted',finality:'unknown',insertions:0,deletions:0,substitutions:0,comparedDictations:3,changedDictations:0}]};return snapshot;
}
test('language requires both opt-ins and exact nonexpired preset selection',async t=>{
 const {get,publish,snapshot,wispr,advance}=await fixture(t,{shareTextAggregates:true});await publish(language(snapshot),true);
 const r=await get('language?period=today&corpus=cleaned');assert.equal(r.status,200);const v=await r.json();assert.equal(v.data.table.words[0].text,'=SUM(1,2)');assert.equal(v.data.table.finality,'unknown');
 assert.equal(JSON.stringify(await(await get('export?format=json')).json()).includes('SUM'),false);
 const csv=await(await get('export?format=csv&includeText=true&period=today&corpus=cleaned')).text();assert.match(csv,/'=SUM\(1,2\)/);
 assert.equal((await get('language?from=2026-10-02')).status,400);
 const missing=await(await get('language?period=today&corpus=raw')).json();assert.equal(missing.data.availability,'unavailable');
 const status=JSON.parse(await readFile(wispr.diagnosticsPath,'utf8'));status.languageEnabled=false;await writeFile(wispr.diagnosticsPath,JSON.stringify(status));
 assert.equal(JSON.stringify(await(await get('language?period=today&corpus=cleaned')).json()).includes('SUM'),false);
 assert.equal((await get('export?format=json&includeText=true&period=today&corpus=cleaned')).status,403);
 await publish(snapshot,true);advance(86400000);const expired=await(await get('language?period=today&corpus=cleaned')).json();assert.equal(expired.data.reason,'preset-expired');assert.equal(expired.data.preset.asOf,snapshot.generatedAt);
});

test('browser exposure is opt-in and privacy changes retire sessions',async t=>{
 const {hub,get}=await fixture(t);
 const sign=async()=>{const r=await fetch(hub.url+'/api/dashboard/v1/session',{method:'POST',headers:{origin:hub.url,'content-type':'application/json','x-pixoo-request':'1'},body:'{}'});assert.equal(r.status,200);return (await r.json()).token;};
 const first=await sign();assert.equal((await get('summary',first)).status,403);
 hub.setWisprPrivacy(true,false);const second=await sign();assert.equal((await get('summary',second)).status,200);assert.equal((await get('summary',first)).status,401);
 hub.setWisprPrivacy(false,false);assert.equal((await get('summary',second)).status,401);assert.equal((await get('summary')).status,200,'explicit machine grant remains valid');
});

test('credential revocation discards an already admitted asynchronous response',async t=>{
 const {hub,get,publish,snapshot}=await fixture(t,{shareTextAggregates:true});await publish(language(snapshot),true);
 const pending=get('export?includeText=true&format=json&period=today&corpus=cleaned');
 const deadline=Date.now()+2000;while(!hub.resources().wisprRequests&&Date.now()<deadline)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(hub.resources().wisprRequests,1,'request is inside asynchronous worker before revocation');
 hub.replaceCredentials([credential(generic,[])]);const res=await pending;assert.equal(res.status,401);assert.equal((await res.text()).includes('SUM'),false);
});

test('simultaneous clients coalesce snapshot refreshes and do not block Hub health',async t=>{
 const {hub,get,publish,snapshot,advance}=await fixture(t);
 const pending=Array.from({length:12},()=>get('summary'));
 const health=await fetch(hub.url+'/api/hub/v1/health',{headers:{authorization:'Bearer '+generic}});assert.equal(health.status,200);
 for(const res of await Promise.all(pending)){assert.equal(res.status,200);assert.equal((await res.json()).revision,1);}
 snapshot.revision=2;snapshot.numeric.cells[0].words=140;snapshot.numeric.totals.words=140;await publish(snapshot);
 const cached=await(await get('summary')).json();assert.equal(cached.revision,1);assert.equal(cached.freshness,'stale');assert.equal(cached.reason,'snapshot-behind-manifest');
 advance(30000);const fresh=await(await get('summary')).json();assert.equal(fresh.revision,2);assert.equal(fresh.data.totals.words,140);
});

test('missing source never invents zero; malformed and oversized files expose no private values',async t=>{
 const {get,wispr}=await fixture(t);await rm(wispr.aggregatePath);assert.equal((await get('summary')).status,503);
 await writeFile(wispr.aggregatePath,' '.repeat(16777217));assert.equal((await get('summary')).status,503);
 await writeFile(wispr.diagnosticsPath,JSON.stringify({secret:'SECRET_CANARY'}));const response=await get('summary');assert.equal(response.status,503);assert.equal((await response.text()).includes('SECRET'),false);
});

test('unsafe source paths and unknown or colliding configuration reject',async ()=>{
 const base={sourceId:'dictation',aggregatePath:'/synthetic/aggregate.json',diagnosticsPath:'/synthetic/status.json'};
 for(const opts of [{sourceId:'hub-service'},{sourceId:'speaker'},{aggregatePath:'relative.json'},{aggregatePath:'/tmp/OneDrive/aggregate.json'},{shareTextAggregates:'yes'},{extra:true}])assert.throws(()=>wisprConfiguration({...base,...opts},['speaker']),/invalid-wispr/);
});

test('cloud-folder spellings reject for both configured files',()=>{
 const base={sourceId:'dictation',aggregatePath:'/synthetic/aggregate.json',diagnosticsPath:'/synthetic/status.json'};
 for(const folder of ['iCloudDrive','iCloud Drive','ICLOUDDRIVE','OneDrive','OneDrive - Synthetic','Dropbox','Google Drive'])for(const key of ['aggregatePath','diagnosticsPath']){
  assert.throws(()=>wisprConfiguration({...base,[key]:`/mnt/c/synthetic/${folder}/data.json`},[]),/invalid-wispr/,`${folder} ${key}`);
 }
});

test('worker replacement preserves accepted clear fences and namespace binding',async t=>{
 const {createWispr}=await import('../dist/wispr.js');const {Worker}=await import('node:worker_threads');
 const {wispr,snapshot,publish}=await fixture(t,{shareTextAggregates:true});await publish(language(snapshot),true);
 const config=wisprConfiguration(wispr,[]);let worker;
 const service=createWispr(config,()=>Date.parse(snapshot.generatedAt),data=>{worker=new Worker(new URL('../dist/wispr-worker.js',import.meta.url),{workerData:data??config});return worker;});t.after(()=>service.close());
 const query=()=>service.request('language','?period=today&corpus=cleaned');
 assert.match((await query()).body,/SUM/);
 const cleared={...snapshot,generation:randomUUID(),revision:2};await publish(cleared,false);await writeFile(wispr.aggregatePath,'invalid');
 assert.equal((await query()).status,503);
 await publish(snapshot,true);assert.equal((await query()).status,503,'old generation refused before worker exit');
 await worker.terminate();assert.equal((await query()).status,503,'clear survives worker replacement');
 await publish({...snapshot,namespace:randomUUID(),generation:randomUUID(),revision:3},true);
 await worker.terminate();assert.equal((await query()).status,503,'namespace binding survives worker replacement');
 await publish(cleared,false);assert.equal((await service.request('summary','')).status,200,'matching new generation can recover');
 await worker.terminate();await publish(snapshot,true);assert.equal((await query()).status,503,'repeated replacement cannot restore retired text');
});


test('failed collector attempts never masquerade as fresh numeric observations',async t=>{
 const {get,wispr}=await fixture(t);const first=await(await get('summary')).json();
 const status=JSON.parse(await readFile(wispr.diagnosticsPath,'utf8'));status.health='source-busy';await writeFile(wispr.diagnosticsPath,JSON.stringify(status));
 const value=await(await get('summary')).json();assert.equal(value.data.totals.words,120);assert.equal(value.lastSuccessAt,first.lastSuccessAt);assert.equal(value.freshness,'stale');assert.equal(value.reason,'source-busy');
});

test('sharing opt-out discards a pending text export and preserves numeric history',async t=>{
 const {hub,get,publish,snapshot}=await fixture(t,{shareTextAggregates:true});await publish(language(snapshot),true);
 const pending=get('export?includeText=true&format=json&period=today&corpus=cleaned');
 const deadline=Date.now()+2000;while(!hub.resources().wisprRequests&&Date.now()<deadline)await new Promise(resolve=>setImmediate(resolve));assert.equal(hub.resources().wisprRequests,1);
 hub.setWisprPrivacy(false,false);const res=await pending;assert.equal(res.status,503);assert.equal((await res.text()).includes('SUM'),false);
 const numeric=await(await get('summary')).json();assert.equal(numeric.data.totals.words,120);assert.equal((await get('export?includeText=true')).status,403);
});

test('symlink and hard-link file replacements are refused without losing last good numeric data',async t=>{
 const {get,wispr,advance,root}=await fixture(t);assert.equal((await get('summary')).status,200);
 const copy=join(root,'copy.json');await writeFile(copy,await readFile(wispr.aggregatePath),{mode:0o600});await rm(wispr.aggregatePath);await symlink(copy,wispr.aggregatePath);advance(30000);
 let v=await(await get('summary')).json();assert.equal(v.reason,'snapshot-unavailable');assert.equal(v.data.totals.words,120);
 await rm(wispr.aggregatePath);await link(copy,wispr.aggregatePath);advance(30000);v=await(await get('summary')).json();assert.equal(v.reason,'snapshot-unavailable');
});

test('numeric rows and byte limits return typed errors without truncating',async t=>{
 const {snapshot,wispr}=await fixture(t);
 const {projectWispr}=await import('../dist/wispr-query.js');
 const config=wisprConfiguration(wispr,[]),now=Date.parse(snapshot.generatedAt);
 snapshot.numeric.cells=Array.from({length:10001},(_,i)=>{const date=new Date(Date.UTC(1990,0,1)+i*86400000).toISOString().slice(0,10);return {...snapshot.numeric.cells[0],date,weekday:new Date(date).getUTCDay()};});
 snapshot.coverage.captured={from:snapshot.numeric.cells[0].date,to:snapshot.numeric.cells.at(-1).date};
 assert.throws(()=>projectWispr(snapshot,config,'series','?bucket=day',now,null,false),/wispr-row-capacity/);
 const coarse=projectWispr(snapshot,config,'series','?bucket=month',now,null,false);assert.equal(coarse.status,200);assert.equal(JSON.parse(coarse.body).data.rows.reduce((a,b)=>a+b.words,0),120*10001);
 snapshot.coverage.gaps=Array.from({length:15000},()=>({from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z',reason:'not-observed'}));
 const oversized=projectWispr(snapshot,config,'summary','',now,null,false);assert.equal(oversized.status,413);assert.deepEqual(JSON.parse(oversized.body),{error:{code:'wispr-response-capacity'}});
});

test('bundled collector output retains weighted denominators, DST gaps and app filters',async t=>{
 const {get,publish}=await fixture(t);const produced=JSON.parse(await readFile(new URL('../fixtures/wispr-numeric.json',import.meta.url),'utf8'));await publish(produced);
 const summary=await(await get('summary')).json();assert.equal(summary.data.totals.words,130);assert.equal(summary.data.totals.dictations,4);assert.equal(summary.data.speechWordsPerMinute,150);assert.equal(summary.data.recordingWordsPerMinute,75);assert.equal(summary.data.totals.zeroRecording,1);assert.equal(summary.data.totals.invalidRecording,1);assert.equal(summary.data.totals.correctionSamples,1);assert.equal(summary.data.totals.wordsCorrected,0);
 const heatmap=await(await get('heatmap')).json();assert.deepEqual(heatmap.data.rows.map(c=>c.hour),[1,3]);
 for(const route of ['series?bucket=day&app=slack&category=messaging','apps?app=slack&category=messaging','heatmap?app=slack&category=messaging','export?format=json&app=slack&category=messaging']){
  const r=await get(route);assert.equal(r.status,200,route);const v=await r.json();assert.equal((v.data.rows??v.data.daily).reduce((sum,c)=>sum+c.words,0),100,route);assert.equal(v.namespace,produced.namespace);
 }
});

test('unknown optional language algorithms remain unavailable while numeric data works',async t=>{
 const {get,publish,snapshot}=await fixture(t,{shareTextAggregates:true});language(snapshot);snapshot.language.algorithmVersion='future-unsupported';await publish(snapshot,true);
 const v=await(await get('language?corpus=cleaned')).json();assert.equal(v.data.availability,'unavailable');assert.equal(v.data.reason,'language-algorithm-unsupported');assert.equal((await get('summary')).status,200);
});

test('a stalled analytics worker has a bounded deadline and is retired before replacement',async t=>{
 const {createWispr}=await import('../dist/wispr.js');const {Worker}=await import('node:worker_threads');let starts=0;
 const service=createWispr(wisprConfiguration({sourceId:'dictation',aggregatePath:'/synthetic/a.json',diagnosticsPath:'/synthetic/s.json'},[]),Date.now,()=>{starts++;return new Worker(new URL('./wispr-stalled-worker.mjs',import.meta.url));});t.after(()=>service.close());
 const started=performance.now();await assert.rejects(service.request('summary',''),/wispr-unavailable/);assert.ok(performance.now()-started>=2400);assert.ok(performance.now()-started<3500);assert.equal(starts,1);assert.equal(service.pending(),0);await service.close();
 assert.throws(()=>service.request('summary',''),/wispr-unavailable/);assert.equal(starts,1);
});
