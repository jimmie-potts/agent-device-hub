import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, LIMITS, MemoryStorage, validateSnapshot} from '../dist/index.js';

const DAY=86400000;
const identity=sessionId=>({provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',sessionId});
const options=(storage,clock)=>({storage,ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true}],clock});
function fixture(start=1000){
  let clock=start;const storage=new MemoryStorage();
  const event=(sessionId,kind,extra={})=>({apiVersion:'1.0',identity:identity(sessionId),turn:{status:'known',id:'turn-1'},parent:{status:'unknown'},
    event:kind.startsWith('attention.')?{kind,attention:{status:'unknown'}}:{kind},observedAtMs:clock,ordering:{status:'unknown'},...extra});
  return {storage,event,now:()=>clock,advance:ms=>{clock+=ms;},open:()=>createAgentState(options(storage,()=>clock))};
}
const ids=owner=>owner.snapshot().sessions.map(session=>session.identity.sessionId).sort();

test('expiry frees capacity for identities beyond the lifetime limit',async()=>{
  const {event,advance,open}=fixture();
  const owner=await open();
  for(let index=0;index<LIMITS.sessions;index++)assert.equal((await owner.ingest(event('first-'+index,'session.started'))).ok,true);
  assert.deepEqual(await owner.ingest(event('rejected','session.started')),{ok:false,code:'capacity'});
  assert.equal(owner.snapshot().lossCount,1);
  advance(DAY);
  assert.equal((await owner.ingest(event('second-0','session.started'))).outcome,'applied');
  assert.deepEqual(ids(owner),['second-0']);
  for(let index=1;index<LIMITS.sessions;index++)await owner.ingest(event('second-'+index,'session.started'));
  assert.equal(owner.snapshot().sessions.length,LIMITS.sessions);
  advance(DAY-1);
  assert.deepEqual(await owner.ingest(event('third-0','session.started')),{ok:false,code:'capacity'});
  advance(1);
  assert.equal((await owner.ingest(event('third-0','session.started'))).outcome,'applied');
  assert.deepEqual(ids(owner),['third-0']);
  assert.equal(owner.snapshot().lossCount,2);
  assert.equal(validateSnapshot(owner.snapshot()).ok,true);
  await owner.shutdown();
});

test('only lifecycle evidence renews the 24-hour window',async()=>{
  const {event,advance,open}=fixture();
  const owner=await open();
  await owner.ingest(event('renewed','session.started'));
  await owner.ingest(event('labelled','turn.started'));await owner.ingest(event('labelled','turn.ended'));
  advance(3600000);
  await owner.ingest(event('renewed','turn.started',{turn:{status:'known',id:'turn-2'}}));
  const labelled=owner.snapshot().sessions.find(session=>session.identity.sessionId==='labelled');
  assert.equal((await owner.setLabel(labelled.identity,'Chosen label')).ok,true);
  assert.equal((await owner.acknowledge(labelled.identity,labelled.notices[0].id,'nanoleaf')).ok,true);
  assert.equal(owner.snapshot().sessions.find(session=>session.identity.sessionId==='labelled').lastEvidenceAtMs,labelled.lastEvidenceAtMs);
  advance(DAY-3600000-1);await owner.maintain();
  assert.deepEqual(ids(owner),['labelled','renewed']);
  advance(1);await owner.maintain();
  assert.deepEqual(ids(owner),['renewed']);
  advance(3600000-1);await owner.maintain();
  assert.deepEqual(ids(owner),['renewed']);
  advance(1);await owner.maintain();
  assert.deepEqual(ids(owner),[]);
  await owner.shutdown();
});

test('a restart keeps the window and expires old sessions at startup',async()=>{
  const {event,advance,open}=fixture();
  let owner=await open();
  await owner.ingest(event('kept','session.started'));
  await owner.shutdown();
  advance(DAY-1);owner=await open();
  assert.deepEqual(ids(owner),['kept']);assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  await owner.shutdown();
  advance(1);owner=await open();
  assert.deepEqual(ids(owner),[]);
  await owner.shutdown();
  owner=await open();assert.deepEqual(ids(owner),[]);
  await owner.shutdown();
});

test('expiry runs from the maintenance timer without another provider event',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {event,advance,open}=fixture();
  const owner=await open();
  await owner.ingest(event('idle','session.started'));
  advance(3600000);await owner.ingest(event('recent','session.started'));
  const revision=owner.snapshot().revision;
  advance(DAY-3600000);t.mock.timers.tick(DAY-3600000);
  for(let index=0;index<20&&owner.snapshot().revision===revision;index++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ids(owner),['recent']);
  assert.deepEqual((await owner.exportState()).sessions.map(session=>session.identity.sessionId),['recent']);
  await owner.shutdown();
});

test('late and end-only observations cannot refill expired slots',async()=>{
  const {event,now,advance,open}=fixture();
  const owner=await open();
  assert.deepEqual(await owner.ingest(event('ended','runtime.ended')),{ok:true,revision:0,outcome:'stale'});
  await owner.ingest(event('kept','turn.started'));
  await owner.ingest(event('kept','turn.ended'));
  await owner.setLabel(identity('kept'),'Old label');
  const kept=owner.snapshot().sessions[0];
  advance(DAY);
  const late=event('kept','turn.started',{turn:{status:'known',id:'turn-2'},observedAtMs:now()-DAY});
  assert.equal((await owner.ingest(late)).outcome,'stale');
  assert.equal((await owner.ingest(event('new','session.started',{observedAtMs:now()-DAY}))).outcome,'stale');
  await owner.maintain();
  assert.deepEqual(ids(owner),[]);
  assert.equal((await owner.ingest(event('kept','runtime.ended'))).outcome,'stale');
  assert.deepEqual(ids(owner),[]);
  assert.equal((await owner.ingest(event('kept','session.started'))).outcome,'applied');
  const fresh=owner.snapshot().sessions[0];
  assert.equal(fresh.label,undefined);assert.deepEqual(fresh.notices,[]);assert.equal(fresh.read,'unknown');
  assert.equal(fresh.restartUncertain,false);assert.notDeepEqual(fresh.notices,kept.notices);
  assert.equal(owner.snapshot().lossCount,0);
  await owner.shutdown();
});

test('expiry forgets notices and attention without acknowledging them and keeps orphaned children valid',async()=>{
  const {event,advance,open}=fixture();
  const owner=await open();
  await owner.ingest(event('parent','turn.started'));await owner.ingest(event('parent','attention.approval'));await owner.ingest(event('parent','turn.ended'));
  await owner.ingest(event('other','session.started'));
  advance(3600000);
  const parent={status:'known',identity:identity('parent')};
  await owner.ingest(event('child','session.started',{parent,turn:{status:'unknown'}}));
  const second={turn:{status:'known',id:'turn-2'}};
  for(const kind of ['turn.started','attention.approval','turn.ended'])await owner.ingest(event('other',kind,second));
  await owner.setLabel(identity('other'),'Bystander');
  const other=owner.snapshot().sessions.find(session=>session.identity.sessionId==='other');
  assert.deepEqual([other.label,other.notices.length,other.attention.length],['Bystander',1,1]);
  advance(DAY-3600000);await owner.maintain();
  const snapshot=owner.snapshot();
  assert.deepEqual(ids(owner),['child','other']);
  assert.equal(validateSnapshot(snapshot).ok,true);
  assert.deepEqual(snapshot.sessions.find(session=>session.identity.sessionId==='child').parent,parent);
  const {observationAgeMs,freshness,...rest}=snapshot.sessions.find(session=>session.identity.sessionId==='other');
  const {observationAgeMs:_age,freshness:_freshness,...before}=other;
  assert.deepEqual(rest,before);
  assert.ok(owner.journal().every(row=>row.kind!=='notice.acknowledged'&&row.kind!=='attention.resolved'));
  await owner.shutdown();
});

test('sessions expire at startup and by timer even when no journal row is due',async t=>{
  const {event,advance,now,open}=fixture();
  const source=await open();
  await source.ingest(event('migrated','session.started'));
  // A migrated store can hold sessions whose journal rows were not carried over.
  const state={...(await source.exportState()),journal:[]};await source.shutdown();
  const importInto=async storage=>{const owner=await createAgentState({...options(storage,now),importState:state});return owner;};
  const restarted=new MemoryStorage();
  await (await importInto(restarted)).shutdown();
  advance(DAY);
  const reopened=await createAgentState(options(restarted,now));
  assert.deepEqual(ids(reopened),[]);await reopened.shutdown();
  t.mock.timers.enable({apis:['setTimeout']});
  advance(-DAY);
  const running=await importInto(new MemoryStorage());
  assert.deepEqual(ids(running),['migrated']);
  const revision=running.snapshot().revision;
  advance(DAY);t.mock.timers.tick(DAY);
  for(let index=0;index<20&&running.snapshot().revision===revision;index++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ids(running),[]);
  await running.shutdown();
});

test('journal pruning keeps the label, notices and attention of a renewed session',async()=>{
  const {event,now,advance,open}=fixture();
  let owner=await open();
  await owner.ingest(event('kept','turn.started'));await owner.ingest(event('kept','turn.ended'));
  await owner.setLabel(identity('kept'),'Kept label');
  advance(20*3600000);
  await owner.ingest(event('kept','attention.approval'));
  const before=owner.snapshot().sessions[0];
  assert.equal(before.lastEvidenceAtMs,now());
  advance(5*3600000);await owner.maintain();
  const current=owner.snapshot().sessions[0];
  assert.deepEqual([current.label,current.notices,current.attention],['Kept label',before.notices,before.attention]);
  assert.equal((await owner.exportState()).journal.some(row=>row.atMs<=now()-DAY),false);
  await owner.shutdown();
  owner=await open();
  const after=owner.snapshot().sessions[0];
  assert.deepEqual([after.label,after.notices,after.attention],['Kept label',before.notices,before.attention]);
  await owner.shutdown();
});

test('a late observation cannot renew a live session, and a corrected clock jump does not strand producers',async()=>{
  const {event,now,advance,open}=fixture(2*DAY);
  const owner=await open();
  await owner.ingest(event('live','session.started'));
  const first=owner.snapshot().sessions[0].lastEvidenceAtMs;
  advance(DAY-3600000);
  const renew=(offset,id)=>event('live','turn.started',{turn:{status:'known',id},observedAtMs:now()-DAY+offset});
  assert.equal((await owner.ingest(renew(0,'turn-2'))).outcome,'stale');
  assert.equal(owner.snapshot().sessions[0].lastEvidenceAtMs,first);
  assert.equal((await owner.ingest(renew(1,'turn-3'))).outcome,'applied');
  assert.equal(owner.snapshot().sessions[0].lastEvidenceAtMs,now());
  advance(2*DAY);assert.equal((await owner.ingest(event('ahead','session.started'))).outcome,'applied');
  advance(-2*DAY);
  assert.equal((await owner.ingest(event('corrected','session.started'))).outcome,'applied');
  assert.ok(ids(owner).includes('corrected'));
  await owner.shutdown();
});
