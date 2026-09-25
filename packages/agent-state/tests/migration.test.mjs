import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState,MemoryStorage} from '../dist/index.js';
const options=storage=>({storage,ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true}],clock:()=>1000});
const identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'};
const event={apiVersion:'1.0',identity,turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'turn.ended'},observedAtMs:1000,ordering:{status:'unknown'}};

test('quiesced migration preserves state and permits explicit rollback after releasing the new owner',async()=>{
  const oldStore=new MemoryStorage(),owner=await createAgentState(options(oldStore));
  await owner.ingest(event);await owner.setLabel(identity,'My task');
  const notice=owner.snapshot().sessions[0].notices[0];await owner.acknowledge(identity,notice.id,'pixoo');
  const exported=await owner.exportState();
  assert.equal((await owner.ingest({...event,event:{kind:'activity.observed'}})).code,'unavailable');
  const nextStore=new MemoryStorage();
  const replacement=await createAgentState({...options(nextStore),importState:exported});
  assert.equal(replacement.snapshot().revision,exported.revision);
  assert.equal(replacement.snapshot().sessions[0].label,'My task');
  assert.deepEqual(replacement.snapshot().sessions[0].notices,owner.snapshot().sessions[0].notices);
  assert.equal(replacement.snapshot().sessions[0].restartUncertain,true);
  await replacement.shutdown();await owner.shutdown();
  const rollback=await createAgentState(options(oldStore));assert.equal(rollback.snapshot().revision,exported.revision);await rollback.shutdown();
});

test('malformed, private and incompatible exports never enter an empty or existing store',async()=>{
  const source=await createAgentState(options(new MemoryStorage()));await source.ingest(event);
  const valid=await source.exportState();await source.shutdown();
  const variants=[{...valid,formatVersion:'3.0'},{...valid,privatePrompt:'SECRET_CANARY'},
    {...valid,sessions:[{...valid.sessions[0],toolContent:'SECRET_CANARY'}]},
    {...valid,sessions:[valid.sessions[0],valid.sessions[0]]}];
  for(const bad of variants){
    const storage=new MemoryStorage();
    await assert.rejects(createAgentState({...options(storage),importState:bad}),error=>{assert.doesNotMatch(String(error),/SECRET_CANARY/);return true;});
    const empty=await createAgentState(options(storage));assert.equal(empty.snapshot().sessions.length,0);await empty.shutdown();
  }
  const existing=new MemoryStorage();const owner=await createAgentState(options(existing));await owner.shutdown();
  await assert.rejects(createAgentState({...options(existing),importState:valid}),/invalid-storage/);
});

test('untrusted persisted rows are rejected without evaluating getters or exposing private values',async()=>{
  let reads=0,released=false;
  const stored={formatVersion:'1.0',ownerId:'owner',revision:1,lastCommitAtMs:0,consumers:options(null).consumers,sessions:[],journal:[]};
  Object.defineProperty(stored,'private',{enumerable:true,get(){reads++;throw new Error('SECRET_CANARY');}});
  const storage={async acquire(){return {async load(){return stored;},async commit(){assert.fail('must not commit');},async release(){released=true;}};}};
  await assert.rejects(createAgentState(options(storage)),error=>{assert.doesNotMatch(String(error),/SECRET_CANARY/);return true;});
  assert.equal(reads,0);assert.equal(released,true);
});
