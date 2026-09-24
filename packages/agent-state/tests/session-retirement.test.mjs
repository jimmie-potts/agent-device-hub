import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, LIMITS, MemoryStorage, validateExport, validateSnapshot} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

const identity=sessionId=>({provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',sessionId});
const consumers=[{id:'nanoleaf',clearOnNewTurn:true},{id:'pixoo',clearOnNewTurn:false}];
function fixture(){
  let clock=1000;const storage=new MemoryStorage();
  const event=(sessionId,kind,extra={})=>({apiVersion:'1.0',identity:identity(sessionId),turn:{status:'known',id:'turn-1'},
    parent:{status:'top-level'},event:{kind},observedAtMs:clock,ordering:{status:'unknown'},...extra});
  return {storage,event,advance:ms=>{clock+=ms;},now:()=>clock,
    open:extra=>createAgentState({storage,ownerId:'owner',consumers,clock:()=>clock,...extra})};
}
const ids=owner=>owner.snapshot().sessions.map(s=>s.identity.sessionId).sort();

test('one normalized Desktop end atomically retires parent and known descendants with one revision',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('parent','turn.started'));
    await owner.ingest(f.event('parent','turn.ended'));
    await owner.setLabel(identity('parent'),'Old task');
    for(const [child,parent] of [['child','parent'],['grandchild','child']])
      await owner.ingest(f.event(child,'session.started',{parent:{status:'known',identity:identity(parent)}}));
    for(let i=3;i<LIMITS.sessions;i++)await owner.ingest(f.event(`unrelated-${i}`,'turn.started'));
    const before=owner.snapshot(),kept=before.sessions.filter(s=>s.identity.sessionId.startsWith('unrelated-'));
    const feed=owner.subscribe('nanoleaf',before.revision);
    const end=normalizeHook({session_id:'parent',reason:'other'},
      {provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',hook:'SessionEnd'},f.now());
    assert.ok(end);
    assert.equal((await owner.ingest(end)).outcome,'applied');
    const after=owner.snapshot();
    assert.equal(after.revision,before.revision+1);
    assert.deepEqual(after.sessions,kept);
    assert.equal((await feed.next()).value.revision,after.revision);
    assert.equal((await owner.ingest(f.event('new','turn.started'))).ok,true);
    assert.equal(owner.snapshot().lossCount,0);
    assert.equal(validateSnapshot(after).ok,true);
    const revision=owner.snapshot().revision;
    assert.equal((await owner.ingest(end)).outcome,'stale');
    assert.equal((await owner.ingest(f.event('unknown','runtime.ended'))).outcome,'stale');
    assert.equal(owner.snapshot().revision,revision);
    feed.close();
  }finally{await owner.shutdown();}
});

test('retirement guards are count-bounded, durable and expire independently of active records',async()=>{
  const f=fixture();let owner=await f.open();
  try{
    for(let i=0;i<=LIMITS.retirements;i++){
      await owner.ingest(f.event('retired-'+i,'turn.started'));
      await owner.ingest(f.event('retired-'+i,'runtime.ended'));
    }
    let state=await owner.exportState();
    assert.equal(state.formatVersion,'2.0');assert.equal(validateExport(state).ok,true);
    assert.equal(state.retirements.length,LIMITS.retirements);
    assert.equal(state.retirements[0].identity.sessionId,'retired-1');
    assert.equal(state.sessions.length,0);
    await owner.shutdown();owner=await f.open();
    f.advance(LIMITS.sessionAgeMs-1);
    assert.equal((await owner.ingest(f.event('retired-1','turn.started'))).outcome,'stale');
    await owner.ingest(f.event('active','turn.started'));
    f.advance(1);await owner.maintain();
    assert.deepEqual(ids(owner),['active']);
    state=await owner.exportState();assert.deepEqual(state.retirements,[]);
    await owner.shutdown();owner=await f.open();
    assert.equal((await owner.ingest(f.event('retired-1','turn.started'))).outcome,'applied');
  }finally{await owner.shutdown();}
});

test('failed retirement publishes no partial removal and restart recovers the committed tree',async()=>{
  const f=fixture();let reject=false;
  const storage={async acquire(...args){const lease=await f.storage.acquire(...args);return {...lease,
    async commit(change,signal){if(reject&&change.replace)throw new Error('private-adapter-failure');return lease.commit(change,signal);}};}};
  let owner=await f.open({storage});
  try{
    await owner.ingest(f.event('parent','turn.started'));
    await owner.ingest(f.event('child','session.started',{parent:{status:'known',identity:identity('parent')}}));
    const before=owner.snapshot();reject=true;
    assert.deepEqual(await owner.ingest(f.event('parent','runtime.ended')),{ok:false,code:'storage-failed'});
    assert.deepEqual(owner.snapshot().sessions,before.sessions);
    assert.equal(owner.snapshot().revision,before.revision);
    await owner.shutdown();reject=false;owner=await f.open({storage});
    assert.deepEqual(ids(owner),['child','parent']);
    await owner.ingest(f.event('parent','runtime.ended'));assert.deepEqual(ids(owner),[]);
  }finally{await owner.shutdown();}
});

test('legacy durable import preserves clocks and defaults to generation zero before new admission',async()=>{
  const f=fixture(),source=await f.open();
  await source.ingest(f.event('legacy','turn.started'));
  await source.setLabel(identity('legacy'),'Preserved');
  const exported=structuredClone(await source.exportState());await source.shutdown();
  exported.formatVersion='1.0';delete exported.retirements;
  for(const session of exported.sessions)delete session.generation;
  assert.equal(validateExport(exported).ok,true);
  f.advance(5000);
  const owner=await f.open({storage:new MemoryStorage(),importState:exported});
  try{
    const session=owner.snapshot('1.1').sessions[0];
    assert.equal(session.generation,0);assert.equal(session.label,'Preserved');
    assert.equal(session.lastEvidenceAtMs,exported.sessions[0].lastEvidenceAtMs);
    assert.equal(session.restartUncertain,true);
    assert.equal(owner.snapshot().revision,exported.revision+1);
    await owner.ingest(f.event('new','turn.started'));
    const state=await owner.exportState();assert.equal(state.formatVersion,'2.0');assert.equal(validateExport(state).ok,true);
  }finally{await owner.shutdown();}
});

test('archive evidence has a bounded wait and a hung reader cannot accumulate probes or delay retirement',async()=>{
  const f=fixture();let calls=0;
  const owner=await f.open({isArchived:async()=>{calls++;return new Promise(()=>{});}});
  try{
    await owner.ingest(f.event('one','turn.started'));
    await owner.ingest(f.event('two','turn.started'));
    assert.equal(calls,1);
    await owner.ingest(f.event('one','runtime.ended'));
    assert.deepEqual(ids(owner),['two']);assert.equal(calls,1);
  }finally{await owner.shutdown();}
});

test('retirement guards survive restart and preserve fresh same-identity work after a missed removal',async()=>{
  const f=fixture();let owner=await f.open();
  const first=f.event('parent','turn.started',{eventId:'start-old'});
  const end=f.event('parent','runtime.ended',{eventId:'end-old'});
  try{
    await owner.ingest(first);
    await owner.ingest(f.event('parent','turn.ended'));
    await owner.setLabel(identity('parent'),'Forgotten');
    const old=owner.snapshot('1.1');
    await owner.ingest(end);
    await owner.shutdown();owner=await f.open();
    for(const event of [first,f.event('parent','activity.observed'),end])
      assert.equal((await owner.ingest(event)).outcome,'stale');
    assert.deepEqual(ids(owner),[]);
    f.advance(1);
    await owner.ingest(f.event('parent','turn.started',{turn:{status:'known',id:'new-turn'}}));
    const fresh=owner.snapshot('1.1');
    assert.equal(fresh.apiVersion,'1.1');
    assert.ok(fresh.sessions[0].generation>old.sessions[0].generation);
    assert.equal(fresh.sessions[0].label,undefined);
    assert.equal(fresh.sessions[0].projectId,undefined);
    assert.deepEqual(fresh.sessions[0].notices,[]);
    assert.deepEqual(fresh.sessions[0].attention,[]);
    assert.equal(fresh.sessions[0].read,'unknown');
    assert.equal((await owner.ingest(end)).outcome,'stale');
    assert.equal((await owner.ingest(first)).outcome,'stale');
    assert.deepEqual(owner.snapshot('1.1'),fresh);
    assert.equal(validateSnapshot(fresh).ok,true);
    assert.equal('generation' in owner.snapshot().sessions[0],false);
    const generation=fresh.sessions[0].generation;
    await owner.shutdown();owner=await f.open();
    assert.equal(owner.snapshot('1.1').sessions[0].generation,generation);
  }finally{await owner.shutdown();}
});

test('old ordered ends and delayed children cannot remove or refill a retired tree',async()=>{
  const f=fixture(),owner=await f.open();
  const ordered=(kind,sequence,turn='a')=>f.event('parent',kind,{turn:{status:'known',id:turn},ordering:{status:'known',epoch:'native',sequence}});
  try{
    await owner.ingest(ordered('turn.started',10));
    assert.equal((await owner.ingest(ordered('runtime.ended',9))).outcome,'stale');
    assert.deepEqual(ids(owner),['parent']);
    await owner.ingest(f.event('child','session.started',{parent:{status:'known',identity:identity('parent')}}));
    await owner.ingest(ordered('runtime.ended',11));
    assert.deepEqual(ids(owner),[]);
    assert.equal((await owner.ingest(f.event('unseen-child','session.started',{parent:{status:'known',identity:identity('parent')}}))).outcome,'stale');
    assert.equal((await owner.ingest(f.event('child','turn.started'))).outcome,'stale');
    await owner.ingest(ordered('turn.started',12,'b'));
    assert.equal((await owner.ingest(ordered('runtime.ended',11,'unknown-old-turn'))).outcome,'stale');
    assert.deepEqual(ids(owner),['parent']);
  }finally{await owner.shutdown();}
});

test('ordinary completion, waiting, read, acknowledgment and a long turn retain their records',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('waiting','turn.started'));
    await owner.ingest(f.event('waiting','attention.input',{event:{kind:'attention.input',attention:{status:'known',id:'input'}}}));
    await owner.ingest(f.event('finished','turn.started'));
    await owner.ingest(f.event('finished','turn.ended'));
    const finished=owner.snapshot().sessions.find(s=>s.identity.sessionId==='finished');
    await owner.acknowledge(finished.identity,finished.notices[0].id,'nanoleaf');
    await owner.ingest(f.event('finished','read.observed',{event:{kind:'read.observed',state:'read'}}));
    await owner.ingest(f.event('long','turn.started'));
    f.advance(31*60*1000);await owner.maintain();
    assert.deepEqual(ids(owner),['finished','long','waiting']);
    assert.ok(owner.snapshot().sessions.every(s=>s.freshness==='uncertain'));
    assert.equal(owner.snapshot().sessions.find(s=>s.identity.sessionId==='long').activity,'active');
    for(const [provider,client] of [['codex','cli'],['claude','code']]){
      const extra={identity:{...identity(provider),provider,client}};
      await owner.ingest(f.event(provider,'turn.started',extra));
      await owner.ingest(f.event(provider,'runtime.ended',extra));
      assert.ok(ids(owner).includes(provider));
    }
  }finally{await owner.shutdown();}
});
