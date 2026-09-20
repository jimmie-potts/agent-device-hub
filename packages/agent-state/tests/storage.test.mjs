import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState,MemoryStorage} from '../dist/index.js';
const config=storage=>({storage,ownerId:'owner',consumers:[],clock:()=>1000,storageTimeoutMs:15});
const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'},turn:{status:'unknown'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:1000,ordering:{status:'unknown'}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('revision exhaustion rejects admission without committing an invalid revision',async()=>{
  const original=await createAgentState(config(new MemoryStorage()));
  const exported=structuredClone(await original.exportState());await original.shutdown();
  exported.revision=Number.MAX_SAFE_INTEGER;
  const owner=await createAgentState({...config(new MemoryStorage()),importState:exported});
  assert.deepEqual(await owner.ingest(event),{ok:false,code:'capacity'});
  assert.equal(owner.snapshot().revision,Number.MAX_SAFE_INTEGER);assert.equal(owner.snapshot().sessions.length,0);
  await owner.shutdown();
});
test('late initialization reads retain the lease until settlement then release it',async()=>{
  const memory=new MemoryStorage();let settle;
  const storage={async acquire(...args){const lease=await memory.acquire(...args);return {...lease,load:()=>new Promise(resolve=>{settle=resolve;})};}};
  await assert.rejects(createAgentState(config(storage)),/invalid-storage/);
  await assert.rejects(createAgentState(config(memory)),/storage-unavailable/);
  settle(null);await tick();
  const owner=await createAgentState(config(memory));await owner.shutdown();
});
test('shutdown errors never expose host storage exception content',async()=>{
  const memory=new MemoryStorage();let bad=true;
  const storage={async acquire(...args){const lease=await memory.acquire(...args);return {...lease,async release(){if(bad)throw new Error('PRIVATE_CANARY');return lease.release();}};}};
  const owner=await createAgentState(config(storage));
  await assert.rejects(owner.shutdown(),error=>{assert.doesNotMatch(String(error),/PRIVATE_CANARY/);return error.message==='storage-unavailable';});
  assert.equal(owner.snapshot().collector,'faulted');bad=false;await owner.shutdown();
});
test('input canaries cannot reach storage commits, diagnostics or errors',async()=>{
  const memory=new MemoryStorage(),writes=[];
  const storage={async acquire(...args){const lease=await memory.acquire(...args);return {...lease,async commit(change,signal){writes.push(structuredClone(change));return lease.commit(change,signal);}};}};
  const owner=await createAgentState(config(storage));
  for(const extra of [{prompt:'PRIVATE_CANARY'},{identity:{...event.identity,title:'PRIVATE_CANARY'}},{event:{kind:'session.started',tool:'PRIVATE_CANARY'}}]){
    assert.deepEqual(await owner.ingest({...event,...extra}),{ok:false,code:'invalid-event'});
  }
  assert.equal(writes.length,1);assert.doesNotMatch(JSON.stringify([writes,owner.snapshot(),owner.journal()]),/PRIVATE_CANARY/);
  await owner.shutdown();
});

test('idle journal entries expire through storage without another provider event',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let now=1000;
  const owner=await createAgentState({...config(new MemoryStorage()),clock:()=>now});
  await owner.ingest({...event,event:{kind:'turn.ended'}});
  await owner.setLabel(event.identity,'Keep this label');
  now+=86400000;t.mock.timers.tick(86400000);await tick();
  const persisted=await owner.exportState();
  assert.equal(persisted.journal.length,0);assert.equal(persisted.sessions[0].notices.length,1);
  assert.equal(persisted.sessions[0].label,'Keep this label');await owner.shutdown();
});
