import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, LIMITS, MemoryStorage, validateSnapshot} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

// Hub #807: subagent records must not crowd new root tasks out of a full owner.
const DAY=86400000;
const identity=sessionId=>({provider:'claude',client:'code',hostId:'host',sourceId:'source',sessionId});
function fixture({start=1000,storage=new MemoryStorage(),...extra}={}){
  let clock=start;
  const event=(sessionId,kind,more={})=>({apiVersion:'1.0',identity:identity(sessionId),turn:{status:'known',id:'turn-1'},
    parent:{status:'top-level'},event:kind.startsWith('attention.')?{kind,attention:{status:'unknown'}}:{kind},observedAtMs:clock,ordering:{status:'unknown'},...more});
  const child=(sessionId,parent,kind='session.started')=>event(sessionId,kind,{parent:{status:'known',identity:identity(parent)}});
  // A child that started and finished its turn: activity `idle`.
  const finishedChild=async(owner,sessionId,parent)=>{
    assert.equal((await owner.ingest(child(sessionId,parent))).ok,true);
    assert.equal((await owner.ingest(child(sessionId,parent,'turn.ended'))).ok,true);
  };
  const fillRoots=async owner=>{
    for(let i=owner.snapshot().sessions.length;i<LIMITS.sessions;i++){clock+=1;await owner.ingest(event(`root-${i}`,'turn.started'));}
    assert.equal(owner.snapshot().sessions.length,LIMITS.sessions);
  };
  return {event,child,finishedChild,fillRoots,advance:ms=>{clock+=ms;},now:()=>clock,
    open:()=>createAgentState({storage,ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true}],clock:()=>clock,...extra})};
}
const ids=owner=>owner.snapshot().sessions.map(s=>s.identity.sessionId).sort();
const activity=(owner,sessionId)=>owner.snapshot().sessions.find(s=>s.identity.sessionId===sessionId)?.activity;

test('a new root task displaces the finished child subtree with the oldest evidence, with its descendants',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    for(const [name,parent] of [['child-old','root-parent'],['grandchild','child-old'],['child-new','root-parent']]){
      f.advance(1);await f.finishedChild(owner,name,parent);
    }
    assert.equal(activity(owner,'child-old'),'idle');
    await f.fillRoots(owner);
    const before=owner.snapshot();
    f.advance(1);
    assert.equal((await owner.ingest(f.event('new-root','session.started'))).outcome,'applied');
    const after=owner.snapshot();
    assert.ok(after.sessions.some(s=>s.identity.sessionId==='new-root'));
    assert.equal(after.sessions.some(s=>['child-old','grandchild'].includes(s.identity.sessionId)),false,'the subtree goes together');
    assert.ok(after.sessions.some(s=>s.identity.sessionId==='child-new'));
    assert.equal(after.sessions.filter(s=>s.parent.status!=='known').length,before.sessions.filter(s=>s.parent.status!=='known').length+1,'no root is displaced');
    assert.equal(after.lossCount,before.lossCount+1,'the displacement is counted as loss');
    assert.equal(after.revision,before.revision+2,'one revision retires the child, one admits the root');
    assert.equal(validateSnapshot(after).ok,true);
    // Retirement guards: the displaced child's later events other than an eligible start are stale.
    assert.equal((await owner.ingest(f.child('child-old','root-parent','turn.ended'))).outcome,'stale');
  }finally{await owner.shutdown();}
});

test('subtree evidence ranks children: a child whose grandchild worked recently is not the oldest',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    f.advance(1);await f.finishedChild(owner,'child-a','root-parent');
    f.advance(1);await f.finishedChild(owner,'child-b','root-parent');
    f.advance(1);await f.finishedChild(owner,'grandchild-a','child-a');
    await f.fillRoots(owner);
    f.advance(1);
    assert.equal((await owner.ingest(f.event('new-root','session.started'))).outcome,'applied');
    const left=ids(owner);
    assert.ok(left.includes('child-a')&&left.includes('grandchild-a'));
    assert.equal(left.includes('child-b'),false);
  }finally{await owner.shutdown();}
});

test('running, unknown or attended subtrees are never displaced',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    // The oldest records: a running child, a child with unknown activity from real Claude hooks, an attended one.
    f.advance(1);await owner.ingest(f.child('running','root-parent'));
    const src={provider:'claude',client:'code',hostId:'host',sourceId:'source'};
    for(const hook of ['SubagentStart','SubagentStop']){
      f.advance(1);
      const hooked=normalizeHook({session_id:'root-parent',agent_id:'subagent',agent_type:'general'},{...src,hook},f.now());
      assert.ok(hooked);await owner.ingest(hooked);
    }
    f.advance(1);await f.finishedChild(owner,'attended','root-parent');
    f.advance(1);await f.finishedChild(owner,'pending-grandchild','attended');
    f.advance(1);await owner.ingest(f.child('pending-grandchild','attended','attention.approval'));
    f.advance(1);await f.finishedChild(owner,'eligible','root-parent');
    assert.equal(activity(owner,'running'),'active');
    assert.equal(activity(owner,'subagent'),'unknown');
    await f.fillRoots(owner);
    f.advance(1);
    assert.equal((await owner.ingest(f.event('new-root','session.started'))).outcome,'applied');
    const left=ids(owner);
    for(const kept of ['running','subagent','attended','pending-grandchild'])assert.ok(left.includes(kept),kept);
    assert.equal(left.includes('eligible'),false);
    // With no eligible child left, the next root is rejected and nothing is removed.
    const before=ids(owner);
    f.advance(1);
    assert.deepEqual(await owner.ingest(f.event('another-root','session.started')),{ok:false,code:'capacity'});
    assert.deepEqual(ids(owner),before);
  }finally{await owner.shutdown();}
});

test('a full owner rejects a new child even when a finished child exists',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    f.advance(1);await f.finishedChild(owner,'finished','root-parent');
    await f.fillRoots(owner);
    const before=ids(owner);
    f.advance(1);
    assert.deepEqual(await owner.ingest(f.child('new-child','root-parent')),{ok:false,code:'capacity'});
    assert.deepEqual(ids(owner),before);
    assert.equal(owner.snapshot().lossCount,1);
  }finally{await owner.shutdown();}
});

test('events that would not create a root displace nothing',async()=>{
  const f=fixture({start:2*DAY}),owner=await f.open();
  try{
    await owner.ingest(f.event('retired-root','turn.started'));
    await owner.ingest(f.event('retired-root','runtime.ended'));
    await owner.ingest(f.event('root-parent','turn.started'));
    f.advance(1);await f.finishedChild(owner,'finished','root-parent');
    await f.fillRoots(owner);
    const before=ids(owner);
    f.advance(1);
    // Reaches the new branch: the reducer creates no session for an acknowledgment of an unknown identity.
    assert.equal((await owner.ingest(f.event('acknowledger','notice.acknowledged',{event:{kind:'notice.acknowledged',noticeId:'n1',consumerId:'nanoleaf'}}))).ok,true);
    // Guarded: a retired root's later non-start event.
    assert.equal((await owner.ingest(f.event('retired-root','turn.ended'))).outcome,'stale');
    // Older than the retention window.
    assert.equal((await owner.ingest(f.event('old-root','turn.started',{observedAtMs:f.now()-DAY-1}))).outcome,'stale');
    assert.deepEqual(ids(owner),before);
    assert.equal(owner.snapshot().lossCount,0);
  }finally{await owner.shutdown();}
});

test('an archived Codex Desktop conversation displaces nothing',async()=>{
  let clock=1000;
  const desktopId=sessionId=>({provider:'codex',client:'desktop',hostId:'host',sourceId:'source',sessionId});
  const event=(id,kind,parent={status:'top-level'})=>({apiVersion:'1.0',identity:id,turn:{status:'known',id:'turn-1'},parent,event:{kind},observedAtMs:clock,ordering:{status:'unknown'}});
  const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true}],clock:()=>clock,
    isArchived:async target=>target.sessionId==='archived'});
  try{
    await owner.ingest(event(desktopId('parent'),'turn.started'));
    for(const kind of ['session.started','turn.ended']){clock+=1;await owner.ingest(event(desktopId('child'),kind,{status:'known',identity:desktopId('parent')}));}
    for(let i=2;i<LIMITS.sessions;i++){clock+=1;await owner.ingest(event(desktopId(`root-${i}`),'turn.started'));}
    clock+=1;
    assert.equal((await owner.ingest(event(desktopId('archived'),'session.started'))).outcome,'stale');
    assert.ok(ids(owner).includes('child'),'the child stays');
    assert.equal((await owner.ingest(event(desktopId('live'),'session.started'))).outcome,'applied');
    assert.equal(ids(owner).includes('child'),false);
  }finally{await owner.shutdown();}
});

test('a failed displacement commit admits nothing and leaves the child',async()=>{
  const memory=new MemoryStorage();let failing=false;
  const storage={async acquire(...args){const lease=await memory.acquire(...args);
    return {...lease,async commit(change,signal){if(failing)throw new Error('disk');return lease.commit(change,signal);}};}};
  const f=fixture({storage}),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    f.advance(1);await f.finishedChild(owner,'finished','root-parent');
    await f.fillRoots(owner);
    failing=true;f.advance(1);
    const result=await owner.ingest(f.event('new-root','session.started'));
    assert.equal(result.ok,false);
    assert.ok(ids(owner).includes('finished'));
    assert.equal(ids(owner).includes('new-root'),false);
  }finally{failing=false;await owner.shutdown().catch(()=>{});}
});
