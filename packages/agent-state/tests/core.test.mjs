import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAgentState, MemoryStorage, recoveryJournalKey, validateSnapshot} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

const identity={provider:'codex',client:'cli',hostId:'host-1',sourceId:'source-1',sessionId:'session-1'};
const envelope=(kind,sequence=1,extra={})=>({apiVersion:'1.0',identity,turn:{status:'known',id:'turn-1'},parent:{status:'unknown'},event:{kind},observedAtMs:1000,ordering:{status:'known',epoch:'epoch-1',sequence},...extra});
const options=(storage,clock=()=>1000)=>({storage,ownerId:'owner-1',consumers:[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:false}],clock});
const hook=(name,raw)=>normalizeHook(raw,{provider:'codex',client:'cli',hostId:identity.hostId,sourceId:identity.sourceId,hook:name},1000);

test('explicit recovery retires only an uncertain uncorrelated approval',async()=>{
  let clock=1000;
  const storage=new MemoryStorage();
  const owner=await createAgentState(options(storage,()=>clock));
  await owner.ingest(hook('UserPromptSubmit',{session_id:identity.sessionId,turn_id:'turn-1'}));
  await owner.ingest(hook('PermissionRequest',{session_id:identity.sessionId,turn_id:'turn-1'}));
  const before=owner.snapshot();
  assert.equal(before.sessions[0].attention[0].kind,'approval');
  assert.equal((await owner.recoverApproval(identity,'turn-1',before.revision)).ok,false);
  clock+=300000;
  const result=await owner.recoverApproval(identity,'turn-1',before.revision);
  assert.equal(result.ok,true);
  const after=owner.snapshot();
  assert.equal(after.sessions[0].attention.length,0);
  assert.equal(after.sessions[0].freshness,'uncertain');
  assert.equal(after.sessions[0].activity,before.sessions[0].activity);
  assert.equal(after.sessions[0].lastEvidenceAtMs,before.sessions[0].lastEvidenceAtMs);
  assert.deepEqual([owner.journal().at(-1).kind,owner.journal().at(-1).outcome],['attention.resolved','ambiguous']);
  assert.equal(owner.journal().at(-1).sessionKey,recoveryJournalKey(identity,'turn-1'));
  const reordered={sessionId:identity.sessionId,sourceId:identity.sourceId,hostId:identity.hostId,client:identity.client,provider:identity.provider};
  assert.equal(recoveryJournalKey(reordered,'turn-1'),recoveryJournalKey(identity,'turn-1'));
  assert.notEqual(owner.journal().at(-1).sessionKey,createHash('sha256').update(JSON.stringify(identity)).digest('hex'));
  assert.equal((await owner.recoverApproval(identity,'turn-1',before.revision)).ok,false);
  await owner.shutdown();
  const restored=await createAgentState(options(storage,()=>clock));
  assert.equal(restored.snapshot().sessions[0].attention.length,0);
  assert.equal(restored.journal().at(-1).sessionKey,recoveryJournalKey(identity,'turn-1'));
  await restored.shutdown();
});

test('read evidence changes only the read dimension',async()=>{
  let clock=1000;
  const storage=new MemoryStorage();
  let owner=await createAgentState(options(storage,()=>clock));
  const desktop={...identity,client:'desktop'};
  const provider=(name,turn)=>normalizeHook({session_id:desktop.sessionId,turn_id:turn},{provider:'codex',client:'desktop',hostId:desktop.hostId,sourceId:desktop.sourceId,hook:name},1000);
  const read=state=>({apiVersion:'1.0',identity:desktop,turn:{status:'known',id:'turn-1'},parent:{status:'unknown'},event:{kind:'read.observed',state},observedAtMs:clock,ordering:{status:'unknown'}});
  assert.deepEqual(await owner.ingest(read('read')),{ok:true,revision:0,outcome:'stale'});
  assert.equal(owner.snapshot().sessions.length,0);assert.equal(owner.snapshot().lossCount,0);
  await owner.ingest(provider('UserPromptSubmit','turn-1'));await owner.ingest(provider('Stop','turn-1'));
  const before=owner.snapshot().sessions[0];
  clock+=300000;
  assert.equal((await owner.ingest(read('read'))).outcome,'applied');
  let session=owner.snapshot().sessions[0];
  assert.equal(session.read,'read');assert.equal(session.freshness,'uncertain');
  assert.equal(session.lastEvidenceAtMs,before.lastEvidenceAtMs);assert.equal(session.observedAtMs,before.observedAtMs);
  assert.deepEqual([session.turn,session.activity,session.notices],[before.turn,before.activity,before.notices]);
  clock++;assert.equal((await owner.ingest(read('unread'))).outcome,'applied');
  clock++;assert.equal((await owner.ingest(read('read'))).outcome,'applied');
  assert.equal(owner.snapshot().sessions[0].read,'read');
  await owner.shutdown();
  owner=await createAgentState(options(storage,()=>clock));
  await owner.ingest(read('unread'));
  session=owner.snapshot().sessions[0];
  assert.equal(session.read,'unread');assert.equal(session.restartUncertain,true);
  await owner.shutdown();
});

test('read evidence leaves turn, ordering and metadata evidence unchanged',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  const desktop={...identity,client:'desktop'};
  const observed=(event,extra={})=>({apiVersion:'1.0',identity:desktop,turn:{status:'known',id:'turn-1'},parent:{status:'unknown'},event,observedAtMs:1000,ordering:{status:'known',epoch:'epoch-1',sequence:1},...extra});
  await owner.ingest(observed({kind:'turn.started'}));
  const before=owner.snapshot().sessions[0];
  assert.deepEqual(before.ordering,{status:'known',epoch:'epoch-1',sequence:1});
  assert.equal((await owner.ingest(observed({kind:'read.observed',state:'read'},{turn:{status:'unknown'},ordering:{status:'unknown'}}))).outcome,'applied');
  assert.equal((await owner.ingest(observed({kind:'read.observed',state:'unread'},{turn:{status:'known',id:'turn-2'},ordering:{status:'known',epoch:'epoch-2',sequence:5},
    parent:{status:'known',identity:{...desktop,sessionId:'parent'}},label:{origin:'user',value:'Renamed'}}))).outcome,'applied');
  const after=owner.snapshot().sessions[0];
  assert.equal(after.read,'unread');
  assert.deepEqual([after.turn,after.ordering,after.unavailable,after.parent,after.label,after.activity],
    [before.turn,before.ordering,before.unavailable,before.parent,before.label,before.activity]);
  await owner.shutdown();
});

test('child permission requests remain on the child established by its start',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  const raw={session_id:identity.sessionId,agent_id:'child',turn_id:'parent-turn'};
  await owner.ingest(hook('SubagentStart',raw));await owner.ingest(hook('PermissionRequest',raw));
  const sessions=owner.snapshot().sessions;
  assert.equal(sessions.length,1);assert.equal(sessions[0].identity.sessionId,'child');
  assert.equal(sessions[0].attention[0].kind,'approval');assert.deepEqual(sessions[0].attention[0].turn,{status:'unknown'});
  await owner.shutdown();
});

test('an unordered turn cannot retire a turn supported by a later qualified sequence',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(envelope('turn.started',20));
  await owner.ingest(envelope('turn.started',0,{turn:{status:'known',id:'old'},ordering:{status:'unknown'}}));
  const result=await owner.ingest(envelope('turn.ended',21));
  assert.notEqual(result.outcome,'stale');assert.equal(result.ok,true);
  assert.ok(owner.snapshot().sessions[0].notices.some(notice=>notice.turn.id==='turn-1'));
  await owner.shutdown();
});

test('unordered successive starts select by receipt and reject a superseded completion',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  for(const turn_id of ['turn-1','turn-3','turn-2'])await owner.ingest(hook('UserPromptSubmit',{session_id:identity.sessionId,turn_id}));
  const result=await owner.ingest(hook('Stop',{session_id:identity.sessionId,turn_id:'turn-3'}));
  assert.equal(result.outcome,'stale');
  const session=owner.snapshot().sessions[0];
  assert.deepEqual(session.turn,{status:'known',id:'turn-2'});
  assert.equal(session.activity,'active');
  assert.deepEqual(session.ordering,{status:'unknown'});
  assert.equal(session.notices.length,0);
  await owner.shutdown();
});

for(const kind of ['attention.approval','attention.input','question.continuing','turn.ended'])test(`${kind} arriving before its newer turn start is retained without a retry`,async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(envelope('turn.started',1));await owner.ingest(envelope('turn.ended',2));
  const turn={status:'known',id:'turn-2'};
  const observation=envelope(kind,4,{turn,event:kind==='turn.ended'?{kind}:{kind,attention:{status:'known',id:'request'}}});
  assert.equal((await owner.ingest(observation)).ok,true);
  await owner.ingest(envelope('turn.started',3,{turn}));
  const session=owner.snapshot().sessions[0];
  assert.deepEqual(session.turn,turn);
  if(kind==='turn.ended'){
    assert.equal(session.activity,'idle');assert.ok(session.notices.some(notice=>notice.turn.id==='turn-2'));
  }else assert.deepEqual(session.attention.map(item=>item.turn),[turn]);
  assert.equal((await owner.ingest(observation)).outcome,'duplicate');
  await owner.shutdown();
});

test('unordered child start and stop permutations yield the same uncertain count after restart',async()=>{
  for(const names of [['SubagentStart','SubagentStop'],['SubagentStop','SubagentStart']]){
    const storage=new MemoryStorage();const owner=await createAgentState(options(storage));
    await owner.ingest(envelope('turn.started'));
    const raw={session_id:identity.sessionId,agent_id:'child'};
    for(const name of names)await owner.ingest(hook(name,raw));
    for(const name of names)await owner.ingest(hook(name,raw));
    const snapshot=owner.snapshot();
    assert.deepEqual(snapshot.sessions[0].children,{active:0,uncertain:1});
    assert.equal(snapshot.sessions[1].activity,'unknown');assert.equal(snapshot.sessions[1].freshness,'current');
    assert.equal(validateSnapshot(snapshot).ok,true);
    await owner.shutdown();const restored=await createAgentState(options(storage));
    assert.deepEqual(restored.snapshot().sessions[0].children,{active:0,uncertain:1});
    assert.equal(validateSnapshot(restored.snapshot()).ok,true);await restored.shutdown();
  }
});

test('conflicting parent permutations cannot attribute a child to either parent',async()=>{
  const other={...identity,sessionId:'other-parent'};
  for(const parents of [[identity,other],[other,identity]]){
    const storage=new MemoryStorage();const owner=await createAgentState(options(storage));
    for(const parent of [identity,other])await owner.ingest(envelope('turn.started',1,{identity:parent}));
    for(const [i,parent] of [...parents,parents[0]].entries())await owner.ingest(envelope('activity.observed',i+1,{identity:{...identity,sessionId:'child'},parent:{status:'known',identity:parent}}));
    const snapshot=owner.snapshot();
    for(const parent of snapshot.sessions.slice(0,2))assert.deepEqual(parent.children,{active:0,uncertain:0});
    assert.deepEqual(snapshot.sessions[2].parent,{status:'unknown'});
    assert.ok(snapshot.sessions[2].unavailable.some(item=>item.dimension==='parent'&&item.reason==='ambiguous'));
    assert.equal(validateSnapshot(snapshot).ok,true);
    await owner.shutdown();const restored=await createAgentState(options(storage));
    assert.deepEqual(restored.snapshot().sessions[2].parent,{status:'unknown'});await restored.shutdown();
  }
});

test('qualified child ordering gives the same idle count in either delivery order',async()=>{
  const start=envelope('turn.started',1,{identity:{...identity,sessionId:'child'},parent:{status:'known',identity}});
  const end={...start,event:{kind:'turn.ended'},ordering:{status:'known',epoch:'epoch-1',sequence:2}};
  for(const events of [[start,end],[end,start]]){
    const owner=await createAgentState(options(new MemoryStorage()));await owner.ingest(envelope('turn.started'));
    for(const event of events)await owner.ingest(event);
    assert.deepEqual(owner.snapshot().sessions[0].children,{active:0,uncertain:0});
    assert.equal(owner.snapshot().sessions[1].activity,'idle');assert.equal(validateSnapshot(owner.snapshot()).ok,true);
    await owner.shutdown();
  }
});

test('parent identity is independent of JSON property order',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));await owner.ingest(envelope('turn.started'));
  const child={...identity,sessionId:'child'};
  await owner.ingest(envelope('turn.started',1,{identity:child,parent:{status:'known',identity}}));
  const reversed=Object.fromEntries(Object.entries(identity).reverse());
  await owner.ingest(envelope('activity.observed',2,{identity:child,parent:{identity:reversed,status:'known'}}));
  assert.deepEqual(owner.snapshot().sessions[0].children,{active:1,uncertain:0});
  await owner.shutdown();
});

test('attention identity is independent of JSON property order',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(envelope('attention.approval',1,{event:{kind:'attention.approval',attention:{status:'known',id:'approval'}}}));
  await owner.ingest(envelope('attention.approval',2,{turn:{id:'turn-1',status:'known'},event:{kind:'attention.approval',attention:{id:'approval',status:'known'}}}));
  assert.equal(owner.snapshot().sessions[0].attention.length,1);
  await owner.shutdown();
});

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

test('journal count caps keep state, chosen labels and undismissed notices until a day without evidence',async()=>{
  let now=1000;const storage=new MemoryStorage();const owner=await createAgentState(options(storage,()=>now));
  await owner.ingest(envelope('turn.ended',1));await owner.setLabel(identity,'Retained');
  for(let sequence=2;sequence<=10002;sequence++)await owner.ingest(envelope('activity.observed',sequence));
  assert.equal(owner.journal().length,10000);
  assert.ok(owner.journal()[0].revision>1);
  await owner.shutdown();
  let restored=await createAgentState(options(storage,()=>now));
  assert.equal(restored.snapshot().sessions[0].label,'Retained');
  assert.equal(restored.snapshot().sessions[0].notices.length,1);
  now+=86400000;
  assert.equal(restored.journal().length,0);
  await restored.maintain();await restored.shutdown();
  restored=await createAgentState(options(storage,()=>now));
  assert.equal(restored.journal().length,0);
  assert.equal(restored.snapshot().sessions.length,0);
  await restored.shutdown();
});
