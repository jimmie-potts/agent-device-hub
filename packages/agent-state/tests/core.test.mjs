import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, MemoryStorage} from '../dist/index.js';

const identity={provider:'codex',client:'cli',hostId:'host-1',sourceId:'source-1',sessionId:'session-1'};
const envelope=(kind,sequence=1,extra={})=>({apiVersion:'1.0',identity,turn:{status:'known',id:'turn-1'},parent:{status:'unknown'},event:{kind},observedAtMs:1000,ordering:{status:'known',epoch:'epoch-1',sequence},...extra});
const options=(storage,clock=()=>1000)=>({storage,ownerId:'owner-1',consumers:[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:false}],clock});

test('restart restores committed labels and notices and requires fresh evidence',async()=>{
  const storage=new MemoryStorage();
  const owner=await createAgentState(options(storage));
  assert.equal((await owner.ingest(envelope('turn.started'))).ok,true);
  assert.equal((await owner.setLabel(identity,'Build monitor')).ok,true);
  assert.equal((await owner.ingest(envelope('turn.ended',2))).ok,true);
  const before=owner.snapshot();
  assert.equal(before.sessions[0].label,'Build monitor');
  assert.equal(before.sessions[0].notices.length,1);
  await owner.shutdown();
  const restored=await createAgentState(options(storage));
  const after=restored.snapshot();
  assert.equal(after.sessions[0].label,'Build monitor');
  assert.deepEqual(after.sessions[0].notices,before.sessions[0].notices);
  assert.equal(after.sessions[0].freshness,'uncertain');
  assert.equal(after.sessions[0].restartUncertain,true);
  await restored.shutdown();
});

test('activity, correlated attention, notices and consumer acknowledgment stay independent',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(envelope('turn.started',1));
  await owner.ingest(envelope('question.continuing',2,{event:{kind:'question.continuing',attention:{status:'known',id:'question-1'}}}));
  await owner.ingest(envelope('attention.approval',3,{event:{kind:'attention.approval',attention:{status:'known',id:'approval-1'}}}));
  await owner.ingest(envelope('activity.observed',4));
  assert.equal(owner.snapshot().sessions[0].attention.length,2);
  await owner.ingest(envelope('attention.resolved',5,{event:{kind:'attention.resolved',attention:{status:'unknown'}}}));
  assert.equal(owner.snapshot().sessions[0].attention.length,2);
  await owner.ingest(envelope('attention.resolved',6,{event:{kind:'attention.resolved',attention:{status:'known',id:'approval-1'}}}));
  assert.deepEqual(owner.snapshot().sessions[0].attention.map(a=>a.kind),['question']);
  await owner.ingest(envelope('turn.ended',7));
  const notice=owner.snapshot().sessions[0].notices[0];
  await owner.ingest(envelope('runtime.ended',8));
  assert.equal(owner.snapshot().sessions[0].notices.length,1);
  assert.equal((await owner.acknowledge(identity,notice.id,'pixoo')).ok,true);
  assert.deepEqual(owner.snapshot().sessions[0].notices[0].acknowledgedBy,['pixoo']);
  assert.equal(owner.snapshot().sessions[0].read,'unknown');
  assert.equal(owner.snapshot().sessions[0].attention.length,1);
  await owner.shutdown();
});

test('new evidenced turn retires only its configured notices and rejects late old turns',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(envelope('turn.started',1));
  await owner.ingest(envelope('turn.ended',2));
  const next=envelope('turn.started',3,{turn:{status:'known',id:'turn-2'}});
  await owner.ingest(next);
  const current=owner.snapshot();
  assert.deepEqual(current.sessions[0].turn,next.turn);
  assert.deepEqual(current.sessions[0].notices[0].acknowledgedBy,['pixoo']);
  assert.equal((await owner.ingest(envelope('turn.ended',4))).outcome,'stale');
  assert.deepEqual(owner.snapshot().sessions,current.sessions);
  await owner.shutdown();
});

test('unknown ordering and native ID collisions stay uncertain without clearing state',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  const event=envelope('turn.ended',1,{eventId:'event-1',turn:{status:'unknown'},ordering:{status:'unknown'}});
  await owner.ingest(event);
  assert.equal((await owner.ingest(event)).outcome,'duplicate');
  assert.equal((await owner.ingest({...event,event:{kind:'activity.observed'}})).outcome,'ambiguous');
  const revision=owner.snapshot().revision;
  assert.equal((await owner.ingest({...event,event:{kind:'activity.observed'}})).outcome,'duplicate');
  assert.equal(owner.snapshot().revision,revision);
  const state=owner.snapshot().sessions[0];
  assert.equal(state.notices.length,1);
  assert.ok(state.unavailable.some(item=>item.dimension==='ordering'));
  await owner.shutdown();
});

test('ordered observations preserve independently reordered activity and attention',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(envelope('turn.started',1));
  await owner.ingest(envelope('attention.approval',5,{event:{kind:'attention.approval',attention:{status:'known',id:'approval'}}}));
  await owner.ingest(envelope('turn.ended',4));
  assert.equal(owner.snapshot().sessions[0].activity,'idle');
  assert.equal(owner.snapshot().sessions[0].attention.length,1);
  assert.equal((await owner.ingest(envelope('activity.observed',3))).outcome,'stale');
  await owner.ingest(envelope('attention.resolved',6,{event:{kind:'attention.resolved',attention:{status:'known',id:'approval'}}}));
  assert.equal(owner.snapshot().sessions[0].attention.length,0);
  assert.equal(owner.snapshot().sessions[0].notices.length,1);
  await owner.shutdown();
});

test('observation age and unique child counts are independent of reads and collector health',async()=>{
  let now=1000;const storage=new MemoryStorage();const owner=await createAgentState(options(storage,()=>now));
  const start=envelope('turn.started',1);
  await owner.ingest(start);
  const child=envelope('turn.started',1,{identity:{...identity,sessionId:'child-1'},parent:{status:'known',identity}});
  await Promise.all([owner.ingest(child),owner.ingest(child),owner.ingest(child)]);
  assert.deepEqual(owner.snapshot().sessions[0].children,{active:1,uncertain:0});
  now+=300000;await owner.ingest(start);
  const snapshot=owner.snapshot();
  assert.equal(snapshot.collector,'running');
  assert.equal(snapshot.sessions[0].observationAgeMs,300000);
  assert.equal(snapshot.sessions[0].freshness,'uncertain');
  assert.deepEqual(snapshot.sessions[0].children,{active:0,uncertain:1});
  await owner.shutdown();
});

test('failed and ambiguous commits publish no speculative revision and recover committed state',async()=>{
  for(const committed of [false,true]){
    const memory=new MemoryStorage();
    const storage={async acquire(...args){const lease=await memory.acquire(...args);return {...lease,async commit(change,signal){if(change.revision===2){if(committed)await lease.commit(change,signal);throw new Error('PRIVATE_CANARY');}return lease.commit(change,signal);}};}};
    const owner=await createAgentState(options(storage));await owner.ingest(envelope('turn.started'));
    const before=owner.snapshot();
    const result=await owner.setLabel(identity,'Saved label');
    assert.deepEqual(result,{ok:false,code:'storage-failed'});
    assert.equal(owner.snapshot().revision,before.revision);
    assert.equal(owner.snapshot().sessions[0].label,undefined);
    assert.ok(!JSON.stringify([result,owner.snapshot(),owner.journal()]).includes('PRIVATE_CANARY'));
    await owner.shutdown();
    const restored=await createAgentState(options(memory));
    assert.equal(restored.snapshot().sessions[0].label,committed?'Saved label':undefined);
    await restored.shutdown();
  }
});

test('storage lease rejects concurrent owners and is released by shutdown',async()=>{
  const storage=new MemoryStorage();const owner=await createAgentState(options(storage));
  await assert.rejects(createAgentState(options(storage)),/storage-unavailable/);
  await owner.shutdown();const next=await createAgentState(options(storage));await next.shutdown();
});

test('journal caps time and count without erasing state, chosen labels or undismissed notices',async()=>{
  let now=1000;const storage=new MemoryStorage();const owner=await createAgentState(options(storage,()=>now));
  await owner.ingest(envelope('turn.ended',1));await owner.setLabel(identity,'Retained');
  for(let sequence=2;sequence<=10002;sequence++)await owner.ingest(envelope('activity.observed',sequence));
  assert.equal(owner.journal().length,10000);
  assert.ok(owner.journal()[0].revision>1);
  now+=86400000;
  assert.equal(owner.journal().length,0);
  await owner.maintain();await owner.shutdown();
  const restored=await createAgentState(options(storage,()=>now));
  assert.equal(restored.journal().length,0);
  assert.equal(restored.snapshot().sessions[0].label,'Retained');
  assert.equal(restored.snapshot().sessions[0].notices.length,1);
  await restored.shutdown();
});
