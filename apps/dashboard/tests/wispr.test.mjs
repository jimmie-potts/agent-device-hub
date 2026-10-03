import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-wispr-'));
try{
 await build({entryPoints:['apps/dashboard/src/routes.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'routes.mjs')});
 const {parseRoute,routeHash}=await import(join(dir,'routes.mjs'));
 test('Wispr routes round-trip separately from components and playback',()=>{
  const route={kind:'wispr',sourceId:'private dictation'};
  assert.deepEqual(parseRoute('#/wispr/private%20dictation'),route);
  assert.equal(routeHash(route),'#/wispr/private%20dictation');
  assert.deepEqual(parseRoute('#/component/wispr'),{kind:'component',id:'wispr'});
 });
}finally{await rm(dir,{recursive:true,force:true});}

const helperDir=await mkdtemp(join(tmpdir(),'wispr-data-'));
try{
 await build({entryPoints:['apps/dashboard/src/wispr-data.ts'],bundle:true,platform:'node',format:'esm',outfile:join(helperDir,'data.mjs')});
 const {numericSelection,readWispr,numericCsv,metrics}=await import(join(helperDir,'data.mjs'));
 const status={apiVersion:'1.0',sourceId:'dictation',namespace:'n',generation:'g',revision:1,timezone:'America/New_York',generatedAt:'2026-03-08T16:00:00.000Z',lastSuccessAt:'2026-03-08T16:00:00.000Z',latestSourceDate:'2026-03-08',freshness:'fresh',ageMs:0,reason:null,coverage:{captured:{from:'2026-03-06',to:'2026-03-08'}},data:{availability:'ok',textAllowed:true,presets:[{key:'7d',from:'2026-03-02',to:'2026-03-08',asOf:'2026-03-08T16:00:00.000Z',validUntil:'2026-03-09T04:00:00.000Z'},{key:'today',from:'2026-03-08',to:'2026-03-08',asOf:'2026-03-08T16:00:00.000Z',validUntil:'2026-03-09T04:00:00.000Z'}]}};
 test('preset query intersects coverage without treating uncovered days as zero',()=>{
  const s=numericSelection(status,{period:'7d',app:'slack',category:'messaging'});
  assert.equal(s.query,'from=2026-03-06&to=2026-03-08&app=slack&category=messaging');assert.equal(s.partial,true);assert.equal(s.from,'2026-03-06');
  const noData=structuredClone(status);noData.coverage.captured.to='2026-03-07';assert.equal(numericSelection(noData,{period:'today',app:'all',category:'all'}).query,null);
 });
 test('missing duration remains unavailable while observed zero counters remain zero',()=>{
  const value=metrics({dictations:2,words:100,speechSamples:0,speechSeconds:0,speechWords:0,recordingSamples:1,recordingSeconds:20});
  assert.equal(value.speech,null);assert.equal(value.wpm,null);assert.equal(value.length,50);assert.equal(value.recording,1/3);
 });
 test('source replacement and cancellation retire pending results',async()=>{
  const stop=new AbortController();let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const api={request:async path=>path.endsWith('/status')?status:pending};
  const read=readWispr(api,'dictation',{period:'today',app:'all',category:'all'},false,stop.signal);
  await new Promise(resolve=>setImmediate(resolve));stop.abort();release({...status,data:{}});await assert.rejects(read,/request-cancelled/);
  const changed={request:async path=>path.endsWith('/status')?status:{...status,generation:'replacement',data:{}}};
  await assert.rejects(readWispr(changed,'dictation',{period:'today',app:'all',category:'all'},false,new AbortController().signal),/snapshot-changed/);
 });
 test('numeric CSV escapes formulas and does not invent null values',()=>{assert.match(numericCsv({label:'=1+1',missing:null}),/"label","'=1\+1"/);assert.match(numericCsv({missing:null}),/"missing",""/);});
 test('a final status opt-out discards already received language tables',async()=>{
  let statuses=0;
  const api={request:async path=>path.endsWith('/status')?{...status,data:{...status.data,textAllowed:++statuses===1}}:path.includes('/language')?{...status,data:{availability:'available',table:{words:[{text:'PRIVATE_CANARY'}]}}}:{...status,data:{totals:{words:9}}}};
  const value=await readWispr(api,'dictation',{period:'today',app:'all',category:'all'},true,new AbortController().signal);
  assert.equal(value.status.data.textAllowed,false);assert.deepEqual(value.language,{});assert.equal(JSON.stringify(value).includes('PRIVATE_CANARY'),false);
 });
 test('a final collector failure clears text and carries failure freshness into numeric export',async()=>{
  let statuses=0;
  const api={request:async path=>path.endsWith('/status')?{...status,...(++statuses===2?{reason:'source-unavailable',freshness:'stale',ageMs:100}: {})}:path.includes('/language')?{...status,data:{availability:'available',table:{words:[{text:'PRIVATE_CANARY'}]}}}:{...status,data:{totals:{words:9}}}};
  const value=await readWispr(api,'dictation',{period:'today',app:'all',category:'all'},true,new AbortController().signal);
  assert.deepEqual(value.language,{});assert.equal(value.numeric.freshness,'stale');assert.equal(value.numeric.reason,'source-unavailable');assert.equal(value.numeric.ageMs,100);
 });
 test('dictionary snapshots remain available when the selected period has no numeric capture',async()=>{
  const empty={...status,coverage:{captured:{from:null,to:null}}},dictionary={activeEntries:3,window:'unknown',filtered:false};
  const api={request:async path=>path.endsWith('/status')?empty:{...empty,data:{dictionary}}};
  const value=await readWispr(api,'dictation',{period:'today',app:'all',category:'all'},false,new AbortController().signal);
  assert.equal(value.numeric,undefined);assert.deepEqual(value.dictionary,dictionary);
 });
 test('a new revision or revoked request cannot commit a mixed snapshot',async()=>{
  let count=0;const api={request:async path=>path.endsWith('/status')?{...status,revision:++count}:{...status,data:{}}};
  await assert.rejects(readWispr(api,'dictation',{period:'today',app:'all',category:'all'},false,new AbortController().signal),/snapshot-changed/);
  const stop=new AbortController();stop.abort();await assert.rejects(readWispr(api,'dictation',{period:'today',app:'all',category:'all'},false,stop.signal),/request-cancelled/);
 });
}finally{await rm(helperDir,{recursive:true,force:true});}
