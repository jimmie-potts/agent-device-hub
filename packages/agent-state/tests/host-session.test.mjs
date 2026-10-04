import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';
import {createAgentState,LIMITS,MemoryStorage,validateExport,validateSnapshot} from '../dist/index.js';

const durable21=new Ajv2020({strict:true,allErrors:false}).compile(JSON.parse(readFileSync(new URL('../schemas/durable-v2.1.schema.json',import.meta.url),'utf8')));
const desktopId='local_0f8e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b',otherId='local_11111111-2222-4333-8444-555555555555';
const identity=sessionId=>({provider:'claude',client:'code',hostId:'host',sourceId:'source',sessionId});
function fixture(storage=new MemoryStorage()){
 let clock=10000,turn=0;
 const event=(sessionId,kind='turn.started',extra={})=>({apiVersion:'1.2',identity:identity(sessionId),turn:{status:'known',id:`turn-${++turn}`},
  parent:{status:'unknown'},event:{kind},observedAtMs:clock,ordering:{status:'unknown'},...extra});
 return {storage,event,advance:ms=>{clock+=ms;},open:extra=>createAgentState({storage,ownerId:'owner',consumers:[],clock:()=>clock,...extra})};
}
const host=(owner,sessionId)=>owner.snapshot('1.3').sessions.find(s=>s.identity.sessionId===sessionId)?.hostSessionId;
function noField(value){const text=JSON.stringify(value);assert.ok(!text.includes('hostSessionId')&&!text.includes(desktopId)&&!text.includes(otherId),text.slice(0,200));}

test('snapshot 1.3 carries the Desktop session ID while older projections keep their shapes',async()=>{
 const f=fixture(),owner=await f.open();
 try{
  assert.equal((await owner.ingest(f.event('session-a','turn.started',{hostSessionId:desktopId,title:{value:'Fix café prompts',source:'user'},project:'device-hub'}))).ok,true);
  const current=owner.snapshot('1.3');
  assert.equal(current.apiVersion,'1.3');assert.equal(validateSnapshot(current).ok,true);
  assert.equal(current.sessions[0].hostSessionId,desktopId);assert.equal(current.sessions[0].title.value,'Fix café prompts');
  for(const version of ['1.0','1.1','1.2']){
   const old=owner.snapshot(version);assert.equal(old.apiVersion,version);assert.equal(validateSnapshot(old).ok,true);noField(old);
  }
  assert.deepEqual(owner.snapshot(),owner.snapshot('1.0'));
  assert.throws(()=>owner.snapshot('1.4'),/unsupported-version/);
 }finally{await owner.shutdown();}
});

test('a Claude /clear retires the old hook session and the new one is a separate record with the same Desktop ID',async()=>{
 const f=fixture(),owner=await f.open();
 try{
  await owner.ingest(f.event('before-clear','session.started',{hostSessionId:desktopId}));
  await owner.ingest(f.event('before-clear','turn.ended',{hostSessionId:desktopId}));
  assert.equal((await owner.ingest(f.event('before-clear','runtime.ended',{hostSessionId:desktopId}))).outcome,'applied');
  await owner.ingest(f.event('after-clear','session.started',{hostSessionId:desktopId}));
  const sessions=owner.snapshot('1.3').sessions;
  assert.deepEqual(sessions.map(s=>[s.identity.sessionId,s.hostSessionId]),[['after-clear',desktopId]]);
  // Two live hook sessions with one Desktop ID stay two records; the ID is never an identity.
  await owner.ingest(f.event('parallel','session.started',{hostSessionId:desktopId}));
  assert.deepEqual(owner.snapshot('1.3').sessions.map(s=>[s.identity.sessionId,s.hostSessionId]).sort(),[['after-clear',desktopId],['parallel',desktopId]]);
  assert.equal(owner.snapshot('1.3').sessions.every(s=>s.children.active===0),true);
 }finally{await owner.shutdown();}
});

test('committed 1.2 events set or clear the value; 1.0 and 1.1 events and duplicates leave it',async()=>{
 const f=fixture(),owner=await f.open();
 try{
  const first=f.event('session-a','turn.started',{hostSessionId:desktopId,eventId:'event-1'});
  await owner.ingest(first);assert.equal(host(owner,'session-a'),desktopId);
  const revision=owner.snapshot().revision;
  assert.equal((await owner.ingest(first)).outcome,'duplicate');assert.equal(owner.snapshot().revision,revision);
  await owner.ingest({...f.event('session-a','turn.ended'),apiVersion:'1.1'});assert.equal(host(owner,'session-a'),desktopId);
  await owner.ingest({...f.event('session-a','turn.started'),apiVersion:'1.0'});assert.equal(host(owner,'session-a'),desktopId);
  const before=owner.snapshot().revision;
  await owner.ingest(f.event('session-a','turn.ended',{hostSessionId:otherId}));
  assert.equal(host(owner,'session-a'),otherId);assert.ok(owner.snapshot().revision>before,'a changed value accompanies a committed revision');
  await owner.ingest(f.event('session-a','turn.started'));assert.equal(host(owner,'session-a'),undefined);
  assert.equal('hostSessionId' in owner.snapshot('1.3').sessions[0],false);
 }finally{await owner.shutdown();}
});

test('a failed commit keeps the previous value',async()=>{
 const memory=new MemoryStorage();let fail=false;
 const storage={acquire:async(id,signal)=>{const lease=await memory.acquire(id,signal);return {...lease,commit:async(change,abort)=>{if(fail)throw new Error('PRIVATE_CANARY');return lease.commit(change,abort);}};}};
 const f=fixture(storage),owner=await f.open();
 try{
  await owner.ingest(f.event('session-a','turn.started',{hostSessionId:desktopId}));
  fail=true;
  assert.deepEqual(await owner.ingest(f.event('session-a','turn.ended',{hostSessionId:otherId})),{ok:false,code:'storage-failed'});
  assert.equal(host(owner,'session-a'),desktopId);
 }finally{await owner.shutdown().catch(()=>{});}
});

test('retirement and expiry forget the value with the record',async()=>{
 const f=fixture(),owner=await f.open();
 try{
  await owner.ingest(f.event('ended','session.started',{hostSessionId:desktopId}));
  await owner.ingest(f.event('ended','runtime.ended',{hostSessionId:desktopId}));
  f.advance(1000);
  await owner.ingest({...f.event('ended','session.started'),apiVersion:'1.1'});
  assert.equal(owner.snapshot('1.3').sessions.length,1);assert.equal(host(owner,'ended'),undefined);
  await owner.ingest(f.event('expired','session.started',{hostSessionId:otherId}));
  f.advance(LIMITS.sessionAgeMs+1);await owner.maintain();
  assert.equal(owner.snapshot('1.3').sessions.length,0);
  await owner.ingest({...f.event('expired','session.started'),apiVersion:'1.1'});
  assert.equal(host(owner,'expired'),undefined);
 }finally{await owner.shutdown();}
});

test('durable export and reopen stay format 2.1 without the field; a restart waits for the next event',async()=>{
 const f=fixture(),owner=await f.open();
 let saved;
 try{
  await owner.ingest(f.event('session-a','turn.started',{hostSessionId:desktopId}));
  await owner.ingest(f.event('session-b','turn.started',{hostSessionId:otherId}));
  saved=await owner.exportState();
 }finally{await owner.shutdown();}
 assert.equal(saved.formatVersion,'2.1');assert.equal(durable21(saved),true);assert.equal(validateExport(saved).ok,true);noField(saved);
 const lease=await f.storage.acquire('probe',new AbortController().signal);
 const stored=await lease.load(new AbortController().signal);await lease.release();
 assert.equal(durable21(stored),true);noField(stored);
 const restored=await f.open();
 try{
  const after=restored.snapshot('1.3');assert.equal(after.sessions.length,2);assert.ok(after.sessions.every(s=>s.restartUncertain&&!('hostSessionId' in s)));
  await restored.ingest(f.event('session-a','turn.ended',{hostSessionId:desktopId}));
  assert.equal(host(restored,'session-a'),desktopId);assert.equal(host(restored,'session-b'),undefined);
  noField(await restored.exportState());
 }finally{await restored.shutdown();}
 const imported=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[],clock:()=>20000,importState:saved});
 try{assert.equal(imported.snapshot('1.3').sessions.some(s=>'hostSessionId' in s),false);}finally{await imported.shutdown();}
});

test('a record with a known parent never carries the value, whichever event made the parent known',async()=>{
 // Ordering A: the child is known first, then sends a root-shaped 1.2 event with a host session ID.
 const a=fixture(),first=await a.open();
 try{
  await first.ingest(a.event('root','session.started',{hostSessionId:desktopId}));
  await first.ingest(a.event('child','session.started',{parent:{status:'known',identity:identity('root')}}));
  assert.equal((await first.ingest(a.event('child','turn.started',{hostSessionId:otherId}))).ok,true);
  const snapshot=first.snapshot('1.3'),child=snapshot.sessions.find(s=>s.identity.sessionId==='child');
  assert.equal(child.parent.status,'known');assert.equal('hostSessionId' in child,false);
  assert.equal(host(first,'root'),desktopId);assert.equal(validateSnapshot(snapshot).ok,true);
 }finally{await first.shutdown();}
 // Ordering B: a 1.2 root event sets the value, then a 1.1 event makes the parent known.
 const b=fixture(),second=await b.open();
 try{
  await second.ingest(b.event('root','session.started'));
  await second.ingest(b.event('later-child','session.started',{hostSessionId:otherId}));
  assert.equal(host(second,'later-child'),otherId);
  assert.equal((await second.ingest({...b.event('later-child','turn.started',{parent:{status:'known',identity:identity('root')}}),apiVersion:'1.1'})).ok,true);
  const snapshot=second.snapshot('1.3'),child=snapshot.sessions.find(s=>s.identity.sessionId==='later-child');
  assert.equal(child.parent.status,'known');assert.equal('hostSessionId' in child,false);assert.equal(validateSnapshot(snapshot).ok,true);
  // A later root-shaped 1.2 event cannot bring it back while the parent stays known.
  await second.ingest(b.event('later-child','turn.ended',{hostSessionId:otherId}));
  assert.equal(validateSnapshot(second.snapshot('1.3')).ok,true);assert.equal(host(second,'later-child'),undefined);
 }finally{await second.shutdown();}
});

test('a snapshot taken while a commit is in flight shows only committed values',async()=>{
 const memory=new MemoryStorage();let hold=null;
 const storage={acquire:async(id,signal)=>{const lease=await memory.acquire(id,signal);return {...lease,commit:async(change,abort)=>{if(hold)await hold.promise;return lease.commit(change,abort);}};}};
 const f=fixture(storage),owner=await f.open();
 try{
  await owner.ingest(f.event('session-a','turn.started',{hostSessionId:desktopId}));
  let release;hold={promise:new Promise(resolve=>{release=resolve;})};
  const pending=owner.ingest(f.event('session-a','turn.ended',{hostSessionId:otherId}));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(host(owner,'session-a'),desktopId,'an uncommitted value must not be visible');
  hold=null;release();
  assert.equal((await pending).ok,true);assert.equal(host(owner,'session-a'),otherId);
 }finally{await owner.shutdown();}
});
