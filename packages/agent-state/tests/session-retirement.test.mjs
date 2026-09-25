import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAgentState, LIMITS, MemoryStorage, validateExport, validateSnapshot} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

// Every supported provider/client path shares one retirement rule (Hub #241).
const PATHS=[['codex','desktop'],['codex','cli'],['claude','code']];
const consumers=[{id:'nanoleaf',clearOnNewTurn:true},{id:'pixoo',clearOnNewTurn:false}];
function fixture(provider='codex',client='desktop'){
  let clock=1000;const storage=new MemoryStorage();
  const identity=sessionId=>({provider,client,hostId:'host',sourceId:'source',sessionId});
  const event=(sessionId,kind,extra={})=>({apiVersion:'1.0',identity:identity(sessionId),turn:{status:'known',id:'turn-1'},
    parent:{status:'top-level'},event:{kind},observedAtMs:clock,ordering:{status:'unknown'},...extra});
  // The real normalizer drops the provider's reason; retirement never depends on it.
  const end=(sessionId,raw={})=>normalizeHook({session_id:sessionId,reason:'other',...raw},{provider,client,hostId:'host',sourceId:'source',hook:'SessionEnd'},clock);
  return {storage,identity,event,end,advance:ms=>{clock+=ms;},now:()=>clock,
    open:extra=>createAgentState({storage,ownerId:'owner',consumers,clock:()=>clock,...extra})};
}
const ids=owner=>owner.snapshot().sessions.map(s=>s.identity.sessionId).sort();
const keys=owner=>owner.snapshot().sessions.map(s=>[s.identity.provider,s.identity.client,s.identity.sessionId].join('/')).sort();

for(const [provider,client] of PATHS){
  const path=`${provider}/${client}`;

  test(`${path}: one normalized end atomically retires parent and known descendants with one revision`,async()=>{
    const f=fixture(provider,client),owner=await f.open();
    try{
      await owner.ingest(f.event('parent','turn.started'));
      await owner.ingest(f.event('parent','turn.ended'));
      await owner.setLabel(f.identity('parent'),'Old task');
      for(const [child,parent] of [['child','parent'],['grandchild','child']])
        await owner.ingest(f.event(child,'session.started',{parent:{status:'known',identity:f.identity(parent)}}));
      for(let i=3;i<LIMITS.sessions;i++)await owner.ingest(f.event(`unrelated-${i}`,'turn.started'));
      const before=owner.snapshot(),kept=before.sessions.filter(s=>s.identity.sessionId.startsWith('unrelated-'));
      const feed=owner.subscribe('nanoleaf',before.revision);
      const end=f.end('parent',{reason:client==='code'?'prompt_input_exit':'other'});
      assert.ok(end);assert.equal('reason' in end.event,false);
      assert.equal((await owner.ingest(end)).outcome,'applied');
      const after=owner.snapshot();
      assert.equal(after.revision,before.revision+1);
      assert.deepEqual(after.sessions,kept);
      assert.equal((await feed.next()).value.revision,after.revision);
      assert.equal((await owner.ingest(f.event('new','turn.started'))).ok,true,'retirement released capacity');
      assert.equal(owner.snapshot().lossCount,0);
      assert.equal(validateSnapshot(after).ok,true);
      const revision=owner.snapshot().revision;
      assert.equal((await owner.ingest(end)).outcome,'stale');
      assert.equal((await owner.ingest(f.end('unknown'))).outcome,'stale');
      assert.equal(owner.snapshot().revision,revision);
      const state=await owner.exportState();
      assert.equal(validateExport(state).ok,true);
      assert.deepEqual(state.retirements.map(item=>item.identity.sessionId).sort(),['child','grandchild','parent']);
      feed.close();
    }finally{await owner.shutdown();}
  });

  test(`${path}: retirement guards survive restart and preserve fresh same-identity work after a missed removal`,async()=>{
    const f=fixture(provider,client);let owner=await f.open();
    const first=f.event('parent','turn.started',{eventId:'start-old'});
    const end=f.event('parent','runtime.ended',{eventId:'end-old'});
    try{
      await owner.ingest(first);
      await owner.ingest(f.event('parent','turn.ended'));
      await owner.setLabel(f.identity('parent'),'Forgotten');
      const old=owner.snapshot('1.1');
      await owner.ingest(end);
      await owner.shutdown();owner=await f.open();
      for(const event of [first,f.event('parent','activity.observed'),end])
        assert.equal((await owner.ingest(event)).outcome,'stale');
      assert.deepEqual(ids(owner),[]);
      f.advance(1);
      // A resumed session reuses its native identity; the eligible start creates a fresh record.
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

  test(`${path}: old ordered ends and delayed children cannot remove or refill a retired tree`,async()=>{
    const f=fixture(provider,client),owner=await f.open();
    const ordered=(kind,sequence,turn='a')=>f.event('parent',kind,{turn:{status:'known',id:turn},ordering:{status:'known',epoch:'native',sequence}});
    try{
      await owner.ingest(ordered('turn.started',10));
      assert.equal((await owner.ingest(ordered('runtime.ended',9))).outcome,'stale');
      assert.deepEqual(ids(owner),['parent']);
      await owner.ingest(f.event('child','session.started',{parent:{status:'known',identity:f.identity('parent')}}));
      await owner.ingest(ordered('runtime.ended',11));
      assert.deepEqual(ids(owner),[]);
      assert.equal((await owner.ingest(f.event('unseen-child','session.started',{parent:{status:'known',identity:f.identity('parent')}}))).outcome,'stale');
      assert.equal((await owner.ingest(f.event('child','turn.started'))).outcome,'stale');
      await owner.ingest(ordered('turn.started',12,'b'));
      assert.equal((await owner.ingest(ordered('runtime.ended',11,'unknown-old-turn'))).outcome,'stale');
      assert.deepEqual(ids(owner),['parent']);
    }finally{await owner.shutdown();}
  });

  test(`${path}: ordinary completion, waiting, interruption, acknowledgment, child completion and a long turn retain their records`,async()=>{
    const f=fixture(provider,client),owner=await f.open();
    try{
      await owner.ingest(f.event('waiting','turn.started'));
      await owner.ingest(f.event('waiting','attention.input',{event:{kind:'attention.input',attention:{status:'known',id:'input'}}}));
      await owner.ingest(f.event('finished','turn.started'));
      await owner.ingest(f.event('finished','turn.ended'));
      const finished=owner.snapshot().sessions.find(s=>s.identity.sessionId==='finished');
      await owner.acknowledge(finished.identity,finished.notices[0].id,'nanoleaf');
      if(client==='desktop')await owner.ingest(f.event('finished','read.observed',{event:{kind:'read.observed',state:'read'}}));
      await owner.ingest(f.event('interrupted','turn.started'));
      await owner.ingest(f.event('interrupted','turn.interrupted'));
      await owner.ingest(f.event('parent','turn.started'));
      await owner.ingest(f.event('child','session.started',{parent:{status:'known',identity:f.identity('parent')}}));
      // SubagentStop is the child's turn end; it completes neither the child's record nor the parent.
      await owner.ingest(f.event('child','turn.ended',{parent:{status:'known',identity:f.identity('parent')}}));
      await owner.ingest(f.event('long','turn.started'));
      f.advance(31*60*1000);await owner.maintain();
      assert.deepEqual(ids(owner),['child','finished','interrupted','long','parent','waiting']);
      assert.ok(owner.snapshot().sessions.every(s=>s.freshness==='uncertain'));
      assert.equal(owner.snapshot().sessions.find(s=>s.identity.sessionId==='long').activity,'active');
      assert.equal(owner.snapshot().sessions.find(s=>s.identity.sessionId==='finished').notices.length,1);
      // The separate 24-hour evidence expiry remains the only fallback for a missing end.
      f.advance(24*60*60*1000-31*60*1000-1);await owner.maintain();
      assert.equal(ids(owner).length,6);
      f.advance(1);await owner.maintain();
      assert.deepEqual(ids(owner),[]);
    }finally{await owner.shutdown();}
  });
}

test('ending one path\'s last session preserves other paths, including the same session ID elsewhere',async()=>{
  const f=fixture(),owner=await f.open();
  const on=(provider,client)=>{const g=fixture(provider,client);return {event:(s,k,x)=>({...g.event(s,k,x),observedAtMs:f.now()}),end:s=>({...g.end(s),observedAtMs:f.now()}),identity:g.identity};};
  const paths=PATHS.map(([provider,client])=>on(provider,client));
  try{
    for(const path of paths){
      await owner.ingest(path.event('shared','turn.started'));
      await owner.ingest(path.event('shared','turn.ended'));
      await owner.ingest(path.event('child','session.started',{parent:{status:'known',identity:path.identity('shared')}}));
    }
    const before=owner.snapshot();
    assert.equal(before.sessions.length,6);
    const [desktop,cli,claude]=paths;
    assert.equal((await owner.ingest(claude.end('shared'))).outcome,'applied');
    assert.deepEqual(keys(owner),['codex/cli/child','codex/cli/shared','codex/desktop/child','codex/desktop/shared']);
    assert.equal(owner.snapshot().revision,before.revision+1);
    assert.equal((await owner.ingest(cli.end('shared'))).outcome,'applied');
    assert.deepEqual(keys(owner),['codex/desktop/child','codex/desktop/shared']);
    assert.equal((await owner.ingest(cli.end('never-seen'))).outcome,'stale');
    assert.equal((await owner.ingest(claude.event('child','turn.started',{parent:{status:'known',identity:claude.identity('shared')}}))).outcome,'stale');
    const notice=owner.snapshot().sessions.find(s=>s.identity.client==='desktop'&&s.identity.sessionId==='shared').notices[0];
    assert.deepEqual(notice.acknowledgedBy,[],'another path\'s end acknowledges nothing');
    assert.equal((await owner.ingest(desktop.end('shared'))).outcome,'applied');
    assert.deepEqual(keys(owner),[]);
    f.advance(1);
    await owner.ingest(claude.event('shared','turn.started',{turn:{status:'known',id:'resumed'}}));
    assert.deepEqual(keys(owner),['claude/code/shared']);
    assert.equal(owner.snapshot('1.1').sessions[0].generation,owner.snapshot().revision);
    assert.equal(validateSnapshot(owner.snapshot()).ok,true);
  }finally{await owner.shutdown();}
});

test('retirement guards are count-bounded, durable and expire independently of active records',async()=>{
  const f=fixture('codex','cli');let owner=await f.open();
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
  const f=fixture('claude','code');let reject=false;
  const storage={async acquire(...args){const lease=await f.storage.acquire(...args);return {...lease,
    async commit(change,signal){if(reject&&change.replace)throw new Error('private-adapter-failure');return lease.commit(change,signal);}};}};
  let owner=await f.open({storage});
  try{
    await owner.ingest(f.event('parent','turn.started'));
    await owner.ingest(f.event('child','session.started',{parent:{status:'known',identity:f.identity('parent')}}));
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
  await source.setLabel(f.identity('legacy'),'Preserved');
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

// Stores written before Hub #241 kept a Claude/CLI record after its accepted end. A qualified-order
// end, or an end on unknown activity, left activity `ended`. The packaged hooks supply no ordering, so an
// end after a turn on an active or idle record left activity `unknown` with ambiguous evidence and only a
// bounded diagnostic journal row. Startup retires exactly the `ended` records and their known descendants;
// every other record keeps its evidence clock and the 24-hour fallback, and the journal is not authority.
const journalKey=identity=>createHash('sha256').update(JSON.stringify(identity)).digest('hex');
async function legacyStore(f,formatVersion){
  const source=await f.open();
  const start=f.event('ended','turn.started');
  await source.ingest(start);
  await source.ingest(f.event('ended','turn.ended'));
  await source.setLabel(f.identity('ended'),'Finished earlier');
  await source.ingest(f.event('ended-child','session.started',{parent:{status:'known',identity:f.identity('ended')}}));
  await source.ingest(f.event('hooked','turn.started'));
  await source.ingest(f.event('hooked','turn.ended'));
  await source.ingest(f.event('idle','turn.started'));
  await source.ingest(f.event('idle','turn.ended'));
  await source.ingest(f.event('waiting','turn.started'));
  await source.ingest(f.event('waiting','attention.approval',{event:{kind:'attention.approval',attention:{status:'unknown'}}}));
  await source.ingest(f.event('unknown','turn.started'));
  await source.ingest(f.event('unknown','turn.started',{turn:{status:'unknown'}}));
  const exported=structuredClone(await source.exportState());await source.shutdown();
  // Previous owner with qualified order or unknown activity: the accepted end was reduced into the record.
  exported.sessions.find(session=>session.identity.sessionId==='ended').activity='ended';
  // Previous owner with an unordered hook end on an idle record: activity became unknown/ambiguous and the
  // diagnostic journal kept the accepted end as its last row for that session.
  const hooked=exported.sessions.find(session=>session.identity.sessionId==='hooked');
  hooked.activity='unknown';hooked.unavailable=[{kind:'evidence.unavailable',dimension:'activity',reason:'ambiguous'}];
  exported.revision+=1;
  exported.journal.push({revision:exported.revision,atMs:exported.lastCommitAtMs,sessionKey:journalKey(hooked.identity),kind:'runtime.ended',outcome:'ambiguous'});
  assert.equal(exported.sessions.find(session=>session.identity.sessionId==='unknown').activity,'unknown');
  if(formatVersion==='1.0'){exported.formatVersion='1.0';delete exported.retirements;for(const session of exported.sessions)delete session.generation;}
  assert.equal(validateExport(exported).ok,true,formatVersion);
  return {exported,start};
}
async function seed(storage,exported){
  const signal=new AbortController().signal,lease=await storage.acquire('owner',signal);
  await lease.commit({expectedRevision:null,revision:exported.revision,atMs:exported.lastCommitAtMs,pruneBeforeMs:0,replace:structuredClone(exported)},signal);
  await lease.release();
}

test('an upgraded store retires records holding an accepted end and retains every other record unchanged',async()=>{
  for(const formatVersion of ['2.0','1.0']){
    const f=fixture('claude','code'),{exported,start}=await legacyStore(f,formatVersion);
    f.advance(60*1000);
    const storage=new MemoryStorage();
    // Format 2.0 opens an already-stored store, the installed upgrade path; format 1.0 uses the import path.
    if(formatVersion==='2.0')await seed(storage,exported);
    let owner=await f.open(formatVersion==='2.0'?{storage}:{storage,importState:exported});
    try{
      assert.deepEqual(ids(owner),['hooked','idle','unknown','waiting'],formatVersion);
      assert.equal(owner.snapshot().revision,exported.revision+1,'one durable revision settles the upgrade');
      const snapshot=owner.snapshot('1.1');
      for(const session of snapshot.sessions){
        const stored=exported.sessions.find(item=>item.identity.sessionId===session.identity.sessionId);
        assert.equal(session.lastEvidenceAtMs,stored.lastEvidenceAtMs,'evidence clocks are preserved');
        assert.deepEqual(session.notices,stored.notices,'nothing is acknowledged');
        assert.deepEqual(session.attention,stored.attention);
        assert.equal(session.activity,stored.activity);
        assert.deepEqual(session.unavailable,stored.unavailable);
        assert.equal(session.restartUncertain,true);
      }
      const state=await owner.exportState();
      assert.equal(state.formatVersion,'2.0');assert.equal(validateExport(state).ok,true);
      assert.deepEqual(state.retirements.map(item=>item.identity.sessionId).sort(),['ended','ended-child']);
      assert.ok(state.retirements.every(item=>item.atMs===f.now()));
      assert.equal(state.journal.length,exported.journal.length,'settlement records no journal row');
      // Export quiesces the owner; reopen the same store, which also proves the settlement is durable.
      await owner.shutdown();owner=await f.open({storage});
      assert.deepEqual(ids(owner),['hooked','idle','unknown','waiting']);
      // The settled record's retained keys and turns guard its own old evidence; a new start is fresh.
      assert.equal((await owner.ingest(start)).outcome,'stale','the original start is rejected by its retained key');
      assert.equal((await owner.ingest(f.event('ended','activity.observed'))).outcome,'stale');
      assert.equal((await owner.ingest(f.event('ended-child','turn.started',{parent:{status:'known',identity:f.identity('ended')}}))).outcome,'stale');
      await owner.ingest(f.event('ended','turn.started',{turn:{status:'known',id:'resumed'}}));
      const fresh=owner.snapshot('1.1').sessions.find(session=>session.identity.sessionId==='ended');
      assert.equal(fresh.label,undefined);assert.deepEqual(fresh.notices,[]);assert.ok(fresh.generation>0);
      await owner.shutdown();owner=await f.open({storage});
      assert.deepEqual(ids(owner),['ended','hooked','idle','unknown','waiting']);
      // The hook-shaped record waits for its own 24-hour expiry, measured from its last evidence.
      f.advance(LIMITS.sessionAgeMs-60*1000-1);await owner.maintain();
      assert.deepEqual(ids(owner),['ended','hooked','idle','unknown','waiting']);
      f.advance(1);await owner.maintain();
      assert.deepEqual(ids(owner),['ended']);
    }finally{await owner.shutdown();}
  }
});

test('a failed settlement at startup fails closed and leaves the stored records for the next open',async()=>{
  const f=fixture('codex','cli'),{exported}=await legacyStore(f,'2.0');
  let reject=true;const inner=new MemoryStorage();
  const storage={async acquire(...args){const lease=await inner.acquire(...args);return {...lease,
    async commit(change,signal){if(reject&&change.replace&&change.expectedRevision!==null)throw new Error('private-adapter-failure');return lease.commit(change,signal);}};}};
  await seed(storage,exported);
  f.advance(60*1000);
  await assert.rejects(f.open({storage}),/invalid-storage/);
  reject=false;
  const owner=await f.open({storage});
  try{
    assert.deepEqual(ids(owner),['hooked','idle','unknown','waiting']);
    assert.equal(owner.snapshot().revision,exported.revision+1);
    assert.deepEqual((await owner.exportState()).retirements.map(item=>item.identity.sessionId).sort(),['ended','ended-child']);
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

test('archive admission checks known ancestors even without a retained parent or retirement guard',async()=>{
  const f=fixture();let archivedParent=false;
  const owner=await f.open({isArchived:async (candidate,_signal,ancestors=[])=>
    archivedParent&&[candidate,...ancestors].some(item=>item.sessionId==='parent')});
  try{
    const child=f.event('child','session.started',{parent:{status:'known',identity:f.identity('parent')}});
    archivedParent=true;
    assert.equal((await owner.ingest(child)).outcome,'stale');
    assert.deepEqual(ids(owner),[]);
    archivedParent=false;
    assert.equal((await owner.ingest(child)).outcome,'applied');
    archivedParent=true;
    const grandchild=f.event('grandchild','session.started',{parent:{status:'known',identity:f.identity('child')}});
    assert.equal((await owner.ingest(grandchild)).outcome,'stale');
    assert.deepEqual(ids(owner),['child']);
  }finally{await owner.shutdown();}
});

test('archive admission stays specific to Codex Desktop identities',async()=>{
  const f=fixture('claude','code');let calls=0;
  const owner=await f.open({isArchived:async()=>{calls++;return true;}});
  try{
    assert.equal((await owner.ingest(f.event('claude','turn.started'))).outcome,'applied');
    assert.equal(calls,0,'no archive probe for a Claude identity');
    const desktop=fixture();
    assert.equal((await owner.ingest({...desktop.event('desktop','turn.started'),observedAtMs:f.now()})).outcome,'stale');
    assert.equal(calls,1);
    assert.deepEqual(ids(owner),['claude']);
  }finally{await owner.shutdown();}
});
