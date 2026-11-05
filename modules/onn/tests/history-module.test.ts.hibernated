import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {InProcessBus, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createOnnModule} from '../src/module.js';
import type {OnnTransport, AppObservation} from '../src/transport.js';
import type {MetadataSample} from '../src/metadata.js';
import type {HistoryDetail, HistoryPage, HistoryState} from '../src/history.js';

const section = {id:'onn',configurationRevision:1,adbSocket:'/not-configured/s',serial:'192.0.2.10:12345',hostExecutable:'/not-configured/adb',hostExecutableSha256:'0'.repeat(64),hostVersion:'37.0.1',hostKeyDirectory:'/not-configured/keys',historyEnabled:true};
const sample = (title = 'Synthetic selected title', state = 3): MetadataSample => ({schema:'onn-metadata/2.0',deviceElapsedMs:1000,sessions:[{app:'youtube',metadata:{title,displayTitle:null,subtitle:null,artist:'Synthetic channel',album:null,genre:null,description:null,mediaId:'synthetic-id',durationMs:120000},playback:{state,positionMs:10000,speed:state===2?0:1,positionUpdatedElapsedMs:1000},omissions:[]}]});
const turns = async ():Promise<void> => {for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function time() {
  let now=1_800_000_000_000;
  const timers:Array<{ms:number;work:()=>void;canceled:boolean}>=[];
  const scheduler:Scheduler={after:(ms,work)=>{const row={ms,work,canceled:false};timers.push(row);return()=>{row.canceled=true;};}};
  return {clock:{now:()=>now},scheduler,async tick(ms:number){const i=timers.findIndex(row=>!row.canceled&&row.ms===ms);assert.ok(i>=0,`missing timer ${ms}`);const row=timers.splice(i,1)[0];assert.ok(row);now+=ms;row.work();await turns();}};
}
async function fixture(context:TestContext,transport:OnnTransport,enabled=true) {
  const dir=await mkdtemp(join(tmpdir(),'onn-history-owner-')),clock=time(),bus=new InProcessBus({now:clock.clock.now}),operator=bus.connect('bunny/parts/history-test'),module=createOnnModule({transport});
  const host=new ModuleHarness(module,{bus,stateDir:dir,section:{...section,historyEnabled:enabled},...clock});
  context.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();
  const content=(ref:string,query:Record<string,string>={})=>{assert.ok(module.manifest.content,'stored history content must be registered');return module.manifest.content(ref,{query,signal:AbortSignal.timeout(1000)});};
  const value=async<T>(ref:string,query:Record<string,string>={}):Promise<T>=>{const answer=await content(ref,query);assert.ok(answer&&'bytes'in answer);return JSON.parse(Buffer.from(answer.bytes).toString()) as T;};
  const tool=(name:string,args:Record<string,unknown>={})=>{const found=module.manifest.tools?.find(tool=>tool.name===name);assert.ok(found,`missing ${name} tool`);return found.read(args);};
  const press=()=>operator.request('bunny.cmd.onn-key-press.onn',{type:'org.bunny.onn-key.press.requested',subject:'onn',dataschema:'https://bunny.invalid/events/onn-key-press/2.0',data:{key:'right'}},{requestId:'priority-key',timeoutMs:1000});
  return {host,module,bus,dir,clock,content,value,tool,press};
}

void test('collection, content and tools share retained observations without query transport effects',async context=>{
  let reads=0,effects=0;let observation:AppObservation={app:'youtube',metadata:sample()};
  const f=await fixture(context,{read:()=>{reads++;return Promise.resolve(observation);},execute:()=>{effects++;return Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'});}});
  await f.clock.tick(0);const state=await f.value<HistoryState>('history-state');assert.equal(state.status,'fresh');assert.equal(state.current[0]?.metadata?.title,'Synthetic selected title');
  const page=await f.value<HistoryPage>('history');assert.equal(page.items.length,1);assert.deepEqual(await f.tool('history'),page);
  const first=page.items[0];assert.ok(first);assert.deepEqual(await f.tool('history_detail',{id:first.id}),await f.value('history-detail',{id:first.id}));
  assert.equal(reads,1);assert.equal(effects,0,'stored reads may never operate the device');
  observation={app:'youtube',metadata:{...sample('Synthetic selected title',2),deviceElapsedMs:6000}};await f.clock.tick(5000);
  assert.equal((await f.value<HistoryState>('history-state')).current[0]?.playback?.state,2);
  observation={app:'youtube',metadata:{schema:'onn-metadata/2.0',deviceElapsedMs:11000,sessions:[]}};await f.clock.tick(5000);
  assert.deepEqual((await f.value<HistoryState>('history-state')).current,[]);assert.equal((await f.value<HistoryPage>('history')).items.length,1);
  assert.ok('error'in await f.tool('history',{readerPath:'/arbitrary'}));const invalid=await f.content('history',{limit:'1e2'});assert.ok(invalid);assert.ok('error'in invalid);
});
void test('controls cancel and settle a read before device work, preserving reachability and an explicit busy gap',async context=>{
  let reading=false,reads=0,effects=0;
  const f=await fixture(context,{read:signal=>{reads++;if(reads===1)return Promise.resolve({app:'youtube',metadata:sample()});reading=true;return new Promise(resolve=>{signal.addEventListener('abort',()=>{reading=false;resolve({app:'youtube',metadataFailure:true});},{once:true});});},execute:()=>{assert.equal(reading,false,'device work cannot overlap the reader');effects++;return Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'});}});
  await f.clock.tick(0);await f.clock.tick(5000);assert.equal(reading,true);
  assert.equal((await f.press()).status,'accepted');await turns();assert.equal(effects,1);
  const state=await f.value<HistoryState>('history-state');assert.ok(state.coverage.recentGaps.some(gap=>gap.reason==='busy'));
  assert.equal((await f.tool('status') as {connection:string}).connection,'available');
});
void test('metadata refusal preserves controls and reports last-observed evidence instead of fresh content',async context=>{
  let observation:AppObservation={app:'youtube',metadata:sample()};
  const f=await fixture(context,{read:()=>Promise.resolve(observation),execute:()=>Promise.reject(new Error('no commands'))});
  await f.clock.tick(0);observation={app:'youtube',metadataFailure:true};await f.clock.tick(5000);
  const state=await f.value<HistoryState>('history-state');assert.equal(state.status,'unavailable');assert.equal(state.currentEvidence,'last-observed');assert.equal(state.current[0]?.metadata?.title,'Synthetic selected title');
  assert.equal((await f.tool('status') as {connection:string}).connection,'available');
});
void test('disabled collection preserves a read API without accepting accidental transport metadata',async context=>{
  const f=await fixture(context,{read:()=>Promise.resolve({app:'youtube',metadata:sample()}),execute:()=>Promise.reject(new Error('no commands'))},false);
  await f.clock.tick(0);assert.equal((await f.value<HistoryState>('history-state')).status,'disabled');assert.equal((await f.value<HistoryPage>('history')).items.length,0);
});
void test('collection storage failure refuses intake, preserves originals and records loss on recovery',async context=>{
  const f=await fixture(context,{read:()=>Promise.resolve({app:'youtube',metadata:sample()}),execute:()=>Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'})});
  await f.clock.tick(0);await f.clock.tick(5000);const db=f.host.moduleDatabase();assert.ok(db);const count=db.prepare('SELECT count(*) AS n FROM onn_history_intakes').get();
  const before=await f.value<HistoryPage>('history');const id=before.items[0]?.id;assert.ok(id!==undefined&&id.length>0);
  const firstDetail=await f.value<HistoryDetail>('history-detail',{id,limit:'1'});assert.ok(firstDetail.nextCursor!==null&&firstDetail.nextCursor.length>0);
  db.exec('PRAGMA query_only=ON');await f.clock.tick(5000);const failed=await f.value<HistoryState>('history-state');assert.equal(failed.status,'unavailable');assert.equal(failed.coverage.storageAvailable,false);assert.deepEqual(db.prepare('SELECT count(*) AS n FROM onn_history_intakes').get(),count);
  const page=await f.value<HistoryPage>('history');assert.equal(page.coverage.storageAvailable,false);assert.deepEqual(page.coverage.pendingGap,failed.coverage.pendingGap);
  const occurrence=page.items[0];assert.ok(occurrence);
  const detail=await f.value<HistoryDetail>('history-detail',{id:occurrence.id});assert.equal(detail.coverage.storageAvailable,false);assert.deepEqual(detail.coverage.pendingGap,failed.coverage.pendingGap);
  const older=await f.value<HistoryDetail>('history-detail',{id,limit:'1',cursor:firstDetail.nextCursor});assert.equal(older.cutoff,firstDetail.cutoff);assert.deepEqual(older.coverage.pendingGap,failed.coverage.pendingGap);assert.equal(older.coverage.storageAvailable,false);
  assert.deepEqual(await f.tool('history'),page);assert.deepEqual(await f.tool('history_detail',{id:occurrence.id}),detail);
  db.exec('PRAGMA query_only=OFF');await f.clock.tick(5000);const recovered=await f.value<HistoryState>('history-state');assert.ok(recovered.coverage.recentGaps.some(gap=>gap.reason==='storage'));assert.equal((await f.value<HistoryPage>('history')).items.length,2);
  const restored=await f.value<HistoryPage>('history');assert.equal(restored.coverage.storageAvailable,true);assert.equal(restored.coverage.pendingGap,null);
});
