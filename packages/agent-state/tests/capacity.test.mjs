import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, LIMITS, MemoryStorage, validateSnapshot} from '../dist/index.js';

// Hub #807: subagent records must not crowd new root tasks out of a full owner.
const identity=sessionId=>({provider:'claude',client:'code',hostId:'host',sourceId:'source',sessionId});
function fixture(extra={}){
  let clock=1000;const storage=new MemoryStorage();
  const event=(sessionId,kind,more={})=>({apiVersion:'1.0',identity:identity(sessionId),turn:{status:'known',id:'turn-1'},
    parent:{status:'top-level'},event:kind.startsWith('attention.')?{kind,attention:{status:'unknown'}}:{kind},observedAtMs:clock,ordering:{status:'unknown'},...more});
  const child=(sessionId,parent,kind='session.started')=>event(sessionId,kind,{parent:{status:'known',identity:identity(parent)}});
  return {event,child,advance:ms=>{clock+=ms;},
    open:()=>createAgentState({storage,ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true}],clock:()=>clock,...extra})};
}
const ids=owner=>owner.snapshot().sessions.map(s=>s.identity.sessionId).sort();

/** Roots and children in arrival order, one millisecond apart, filling the owner. */
async function fill(f,owner,children){
  await owner.ingest(f.event('root-parent','turn.started'));
  for(const name of children){f.advance(1);assert.equal((await owner.ingest(f.child(name,'root-parent'))).ok,true);}
  for(let i=owner.snapshot().sessions.length;i<LIMITS.sessions;i++){f.advance(1);await owner.ingest(f.event(`root-${i}`,'turn.started'));}
  assert.equal(owner.snapshot().sessions.length,LIMITS.sessions);
}

test('a new root task displaces the least recently active child without attention, with its descendants',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    for(const [name,parent] of [['child-old','root-parent'],['grandchild','child-old'],['child-new','root-parent']]){
      f.advance(1);assert.equal((await owner.ingest(f.child(name,parent))).ok,true);
    }
    for(let i=owner.snapshot().sessions.length;i<LIMITS.sessions;i++){f.advance(1);await owner.ingest(f.event(`root-${i}`,'turn.started'));}
    const before=owner.snapshot();
    assert.equal(before.sessions.length,LIMITS.sessions);
    f.advance(1);
    assert.equal((await owner.ingest(f.event('new-root','session.started'))).outcome,'applied');
    const after=owner.snapshot();
    assert.ok(after.sessions.some(s=>s.identity.sessionId==='new-root'));
    // The grandchild's own evidence is newer than child-old's, but it goes with its parent.
    assert.equal(after.sessions.some(s=>['child-old','grandchild'].includes(s.identity.sessionId)),false);
    assert.ok(after.sessions.some(s=>s.identity.sessionId==='child-new'));
    assert.equal(after.sessions.filter(s=>s.parent.status!=='known').length,before.sessions.filter(s=>s.parent.status!=='known').length+1,'no root is displaced');
    assert.equal(after.lossCount,before.lossCount+1,'the displacement is counted as loss');
    assert.equal(validateSnapshot(after).ok,true);
    // Retirement guards reject the displaced child's delayed events instead of re-creating it.
    assert.equal((await owner.ingest(f.child('child-old','root-parent','turn.ended'))).outcome,'stale');
  }finally{await owner.shutdown();}
});

test('a full owner still rejects a new child, and a new root when every child has attention',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await fill(f,owner,['busy-1','busy-2']);
    for(const name of ['busy-1','busy-2']){f.advance(1);await owner.ingest(f.child(name,'root-parent','attention.approval'));}
    const before=ids(owner);
    f.advance(1);
    assert.deepEqual(await owner.ingest(f.child('new-child','root-parent')),{ok:false,code:'capacity'});
    assert.deepEqual(await owner.ingest(f.event('new-root','session.started')),{ok:false,code:'capacity'});
    assert.deepEqual(ids(owner),before,'nothing is removed when nothing is eligible');
    assert.equal(owner.snapshot().lossCount,2);
  }finally{await owner.shutdown();}
});

test('a child whose descendant awaits attention is skipped for the next eligible child',async()=>{
  const f=fixture(),owner=await f.open();
  try{
    await owner.ingest(f.event('root-parent','turn.started'));
    for(const [name,parent] of [['child-old','root-parent'],['grandchild','child-old'],['child-next','root-parent']]){
      f.advance(1);await owner.ingest(f.child(name,parent));
    }
    f.advance(1);await owner.ingest(f.child('grandchild','child-old','attention.approval'));
    for(let i=owner.snapshot().sessions.length;i<LIMITS.sessions;i++){f.advance(1);await owner.ingest(f.event(`root-${i}`,'turn.started'));}
    f.advance(1);
    assert.equal((await owner.ingest(f.event('new-root','session.started'))).outcome,'applied');
    const left=ids(owner);
    assert.ok(left.includes('child-old')&&left.includes('grandchild'),'the subtree with a pending approval stays');
    assert.equal(left.includes('child-next'),false);
  }finally{await owner.shutdown();}
});

test('an event that would not create a root displaces nothing',async()=>{
  const f=fixture({isArchived:async()=>true}),owner=await f.open();
  try{
    await fill(f,owner,['child-1']);
    const before=ids(owner);
    f.advance(1);
    assert.equal((await owner.ingest(f.event('ender','runtime.ended'))).outcome,'stale');
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
    clock+=1;await owner.ingest(event(desktopId('child'),'session.started',{status:'known',identity:desktopId('parent')}));
    for(let i=2;i<LIMITS.sessions;i++){clock+=1;await owner.ingest(event(desktopId(`root-${i}`),'turn.started'));}
    clock+=1;
    assert.equal((await owner.ingest(event(desktopId('archived'),'session.started'))).outcome,'stale');
    assert.ok(ids(owner).includes('child'),'the child stays');
    assert.equal((await owner.ingest(event(desktopId('live'),'session.started'))).outcome,'applied');
    assert.equal(ids(owner).includes('child'),false);
  }finally{await owner.shutdown();}
});
