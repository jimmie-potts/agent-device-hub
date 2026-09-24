import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createAgentState,MemoryStorage,validateExport,validateSnapshot} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

const identity={provider:'codex',client:'desktop',hostId:'host',sourceId:'source',sessionId:'session'};
const consumers=[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:false}];
const hook=(name,turn,at=1000,selected=identity)=>normalizeHook(
  {session_id:selected.sessionId,...(turn===undefined?{}:{turn_id:turn,prompt_id:turn})},
  {...selected,hook:name},at);
const options=(storage=new MemoryStorage(),clock=()=>1000)=>({storage,ownerId:'owner',consumers,clock});

test('ordinary Desktop provider start stop next start updates activity and consumer notices',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  const start=hook('UserPromptSubmit','turn-one');
  assert.deepEqual(start.ordering,{status:'unknown'});
  await owner.ingest(start);
  assert.equal(owner.snapshot().sessions[0].activity,'active');
  await owner.ingest(hook('Stop','turn-one',1001));
  let session=owner.snapshot().sessions[0];
  assert.equal(session.activity,'idle');
  assert.equal(session.notices.length,1);
  assert.deepEqual(session.notices[0].acknowledgedBy,[]);
  await owner.ingest(hook('UserPromptSubmit','turn-two',1002));
  session=owner.snapshot().sessions[0];
  assert.equal(session.activity,'active');
  assert.deepEqual(session.turn,{status:'known',id:'turn-two'});
  assert.deepEqual(session.ordering,{status:'unknown'});
  assert.deepEqual(session.notices[0].acknowledgedBy,['pixoo']);
});

for(const [provider,client] of [['codex','cli'],['claude','code']])test(`${provider} ${client} keeps the same ordinary lifecycle contract`,async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  const selected={...identity,provider,client};
  for(const [name,turn] of [['UserPromptSubmit','a'],['Stop','a'],['UserPromptSubmit','b']])
    assert.equal((await owner.ingest(hook(name,turn,1000,selected))).ok,true);
  const session=owner.snapshot().sessions[0];
  assert.equal(session.activity,'active');assert.equal(session.turn.id,'b');
  assert.deepEqual(session.notices[0].acknowledgedBy,['pixoo']);
});

test('unchanged starts and stops with new receipt times cannot revive, refresh or restore notices',async t=>{
  let now=1000;const owner=await createAgentState(options(new MemoryStorage(),()=>now));t.after(()=>owner.shutdown());
  await owner.ingest(hook('UserPromptSubmit','a'));
  const started=owner.snapshot().revision;now+=300000;
  assert.equal((await owner.ingest(hook('UserPromptSubmit','a',now))).outcome,'duplicate');
  assert.equal(owner.snapshot().revision,started);assert.equal(owner.snapshot().sessions[0].freshness,'uncertain');
  await owner.ingest(hook('Stop','a',++now));
  const notice=owner.snapshot().sessions[0].notices[0];
  await owner.acknowledge(identity,notice.id,'nanoleaf');
  const stopped=owner.snapshot().revision;now+=300000;
  for(const name of ['UserPromptSubmit','Stop'])await owner.ingest(hook(name,'a',now));
  assert.equal(owner.snapshot().revision,stopped);assert.equal(owner.snapshot().sessions[0].activity,'idle');
  assert.deepEqual(owner.snapshot().sessions[0].notices[0].acknowledgedBy,['nanoleaf']);
  assert.equal(owner.snapshot().sessions[0].freshness,'uncertain');
  await owner.ingest(hook('UserPromptSubmit','b',++now));
  const selected=owner.snapshot();
  for(const name of ['UserPromptSubmit','Stop'])assert.equal((await owner.ingest(hook(name,'a',++now))).outcome,'stale');
  assert.equal(owner.snapshot().revision,selected.revision);assert.equal(owner.snapshot().sessions[0].turn.id,'b');
  assert.deepEqual(owner.snapshot().sessions[0].notices[0].acknowledgedBy,['nanoleaf','pixoo']);
});

test('completion before start stays completed and an unseen delayed start has the documented receipt-order limit',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  await owner.ingest(hook('Stop','a'));
  await owner.ingest(hook('UserPromptSubmit','a',1001));
  assert.equal(owner.snapshot().sessions[0].activity,'idle');
  // Native IDs and timestamps do not prove provider order: this unseen older start wins.
  await owner.ingest(hook('UserPromptSubmit','unseen-older',1));
  const session=owner.snapshot().sessions[0];
  assert.equal(session.turn.id,'unseen-older');assert.equal(session.activity,'active');
  assert.deepEqual(session.ordering,{status:'unknown'});
  assert.deepEqual(session.notices[0].acknowledgedBy,['pixoo']);
});

test('missing and contradictory turn evidence cannot select or clear; a genuinely new start recovers',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  assert.deepEqual(await owner.ingest(normalizeHook({}, {...identity,hook:'UserPromptSubmit'},1000)),{ok:false,code:'invalid-event'});
  await owner.ingest(hook('Stop','a'));
  await owner.ingest(hook('UserPromptSubmit',undefined,1001));
  let session=owner.snapshot().sessions[0];
  assert.equal(session.activity,'unknown');assert.deepEqual(session.notices[0].acknowledgedBy,[]);
  assert.ok(session.unavailable.some(item=>item.dimension==='turn'));
  await owner.ingest(hook('UserPromptSubmit','b',1002));
  await owner.ingest(hook('Stop','unseen-other',1003));
  session=owner.snapshot().sessions[0];assert.equal(session.activity,'unknown');assert.equal(session.turn.status,'unknown');
  await owner.ingest(hook('UserPromptSubmit','b',1004));
  assert.equal(owner.snapshot().sessions[0].activity,'unknown');
  await owner.ingest(hook('UserPromptSubmit','c',1005));
  session=owner.snapshot().sessions[0];assert.equal(session.activity,'active');assert.equal(session.turn.id,'c');
  assert.ok(!session.unavailable.some(item=>['activity','turn'].includes(item.dimension)));
  assert.ok(session.unavailable.some(item=>item.dimension==='ordering'));
});

test('retiring a turn preserves its attention and accepts exact resolution without changing current activity',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  const attention=(kind,turn,request,at)=>({...hook('PermissionRequest',turn,at),event:{kind,attention:{status:'known',id:request}}});
  await owner.ingest(hook('UserPromptSubmit','a'));
  await owner.ingest(attention('attention.approval','a','approval',1001));
  await owner.ingest(hook('Stop','a',1002));await owner.ingest(hook('UserPromptSubmit','b',1003));
  await owner.ingest(attention('attention.input','a','input',1004));
  await owner.ingest(attention('attention.resolved','b','approval',1005));
  let session=owner.snapshot().sessions[0];assert.equal(session.attention.length,2);assert.equal(session.turn.id,'b');
  await owner.ingest(attention('attention.resolved','a','approval',1006));
  session=owner.snapshot().sessions[0];assert.equal(session.activity,'active');assert.equal(session.turn.id,'b');
  assert.deepEqual(session.attention.map(item=>item.kind),['input']);
  assert.deepEqual(session.notices[0].acknowledgedBy,['pixoo']);assert.equal(session.read,'unknown');
});

test('genuine ordering survives unordered interference and qualified attention can still lead a turn',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  const ordered=(name,turn,sequence)=>({...hook(name,turn,sequence),ordering:{status:'known',epoch:'epoch',sequence},eventId:`native-${sequence}`});
  await owner.ingest(ordered('UserPromptSubmit','a',1));await owner.ingest(ordered('Stop','a',2));
  const approval={...ordered('PermissionRequest','b',4),event:{kind:'attention.approval',attention:{status:'known',id:'request'}}};
  await owner.ingest(approval);await owner.ingest(ordered('UserPromptSubmit','b',3));
  let session=owner.snapshot().sessions[0];assert.equal(session.turn.id,'b');assert.equal(session.attention.length,1);
  assert.deepEqual(session.notices[0].acknowledgedBy,['pixoo']);
  await owner.ingest(hook('UserPromptSubmit','unordered',1000));
  assert.notEqual(owner.snapshot().sessions[0].activity,'active');
  await owner.ingest(hook('UserPromptSubmit','another-unordered',1001));
  assert.notEqual(owner.snapshot().sessions[0].turn.id,'another-unordered');
  // A conflicting payload cannot reuse a qualified native event ID as a fresh start.
  assert.equal((await owner.ingest({...approval,event:{kind:'turn.started'},turn:{status:'known',id:'collision'}})).outcome,'ambiguous');
  assert.notEqual(owner.snapshot().sessions[0].turn.id,'collision');
});

test('two sessions and consumer-scoped manual dismissal stay independent',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  const other={...identity,sessionId:'other'};
  for(const selected of [identity,other]){
    await owner.ingest(hook('UserPromptSubmit','a',1000,selected));await owner.ingest(hook('Stop','a',1001,selected));
  }
  const [first,second]=owner.snapshot().sessions;
  await owner.acknowledge(identity,first.notices[0].id,'nanoleaf');
  assert.equal((await owner.acknowledge(other,first.notices[0].id,'pixoo')).ok,false);
  await owner.ingest(hook('UserPromptSubmit','b',1002));
  const [after,unchanged]=owner.snapshot().sessions;
  assert.deepEqual(after.notices[0].acknowledgedBy,['nanoleaf','pixoo']);assert.deepEqual(unchanged,second);
});

test('fresh selection can recover activity while conflicting parent evidence stays unknown',async t=>{
  const owner=await createAgentState(options());t.after(()=>owner.shutdown());
  const parent=id=>({status:'known',identity:{...identity,sessionId:id}});
  await owner.ingest({...hook('UserPromptSubmit','a'),parent:parent('first-parent')});
  // A correlated approval survives selection; retired-turn no-ID approvals clear (#225).
  await owner.ingest({...hook('PermissionRequest','a',1001),event:{kind:'attention.approval',attention:{status:'known',id:'request'}},parent:parent('other-parent')});
  await owner.ingest({...hook('UserPromptSubmit','b',1002),parent:parent('first-parent')});
  const session=owner.snapshot().sessions[0];
  assert.equal(session.activity,'active');assert.equal(session.turn.id,'b');assert.equal(session.parent.status,'unknown');
  assert.ok(session.unavailable.some(item=>item.dimension==='parent'&&item.reason==='ambiguous'));
  assert.equal(session.attention.length,1);
});

for(const [kind,name] of [['turn.started','UserPromptSubmit'],['turn.ended','Stop'],['turn.ended','UserPromptSubmit'],['turn.interrupted','UserPromptSubmit']])test(`repeated ${name} preserves changed parent evidence without replaying ${kind}`,async t=>{
  const storage=new MemoryStorage();let now=1000;
  let owner=await createAgentState(options(storage,()=>now));t.after(()=>owner.shutdown());
  const parent=id=>({status:'known',identity:{...identity,sessionId:id}});
  await owner.ingest(hook('UserPromptSubmit','a'));
  if(kind!=='turn.started')await owner.ingest({...hook('Stop','a',1001),event:{kind}});
  const before=owner.snapshot().sessions[0];
  await owner.shutdown();owner=await createAgentState(options(storage,()=>now));now+=300000;
  // Starts and stops carry independent metadata even after the turn completes.
  assert.equal((await owner.ingest({...hook(name,'a',now),parent:parent('parent-a')})).outcome,'applied');
  assert.equal(owner.snapshot().sessions[0].parent.identity.sessionId,'parent-a');
  assert.equal((await owner.ingest({...hook(name,'a',++now),parent:parent('parent-b')})).outcome,'ambiguous');
  const session=owner.snapshot().sessions[0];
  assert.deepEqual(session.parent,{status:'unknown'});
  assert.ok(session.unavailable.some(item=>item.dimension==='parent'&&item.reason==='ambiguous'));
  assert.equal(session.activity,before.activity);assert.deepEqual(session.turn,before.turn);
  assert.deepEqual(session.notices,before.notices);assert.equal(session.lastEvidenceAtMs,before.lastEvidenceAtMs);
  assert.equal(session.observedAtMs,before.observedAtMs);assert.equal(session.freshness,'uncertain');
  assert.equal(session.restartUncertain,true);
  const revision=owner.snapshot().revision;
  assert.equal((await owner.ingest({...hook(name,'a',++now),parent:parent('parent-b')})).outcome,kind==='turn.ended'&&name==='UserPromptSubmit'?'stale':'duplicate');
  assert.equal(owner.snapshot().revision,revision);
});

test('retained completions do not evict the 256 most recently superseded turns',async t=>{
  const storage=new MemoryStorage();let owner=await createAgentState(options(storage));t.after(()=>owner.shutdown());
  for(let i=0;i<128;i++){
    await owner.ingest(hook('UserPromptSubmit',`done-${i}`,1000+i*2));
    await owner.ingest(hook('Stop',`done-${i}`,1001+i*2));
  }
  for(let i=0;i<=256;i++)await owner.ingest(hook('UserPromptSubmit',`active-${i}`,2000+i));
  const exported=await owner.exportState();assert.equal(validateExport(exported).ok,true);
  assert.deepEqual(exported.sessions[0].retiredTurns,Array.from({length:256},(_,i)=>`active-${i}`));
  await owner.shutdown();owner=await createAgentState(options(storage));
  for(const turn of ['active-0','active-100','active-255','done-0'])
    assert.equal((await owner.ingest(hook('UserPromptSubmit',turn,3000))).outcome,'stale');
  assert.equal(owner.snapshot().sessions[0].turn.id,'active-256');
  assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  await owner.ingest(hook('UserPromptSubmit','active-257',3001));
  assert.equal((await owner.ingest(hook('UserPromptSubmit','active-0',3002))).outcome,'applied');
  assert.equal(owner.snapshot().sessions[0].notices.length,128);
});

test('retired identities use a bounded FIFO across restart; retained completions outlive retry-key eviction',async t=>{
  const storage=new MemoryStorage();let owner=await createAgentState(options(storage));t.after(()=>owner.shutdown());
  await owner.ingest(hook('Stop','completed'));
  for(let i=0;i<259;i++)assert.equal((await owner.ingest(hook('UserPromptSubmit',`turn-${i}`,1000+i))).ok,true);
  const exported=await owner.exportState();assert.equal(validateExport(exported).ok,true);
  assert.equal(exported.sessions[0].retiredTurns.length,256);assert.equal(exported.sessions[0].seen.length,256);
  assert.ok(!exported.sessions[0].retiredTurns.includes('turn-0'));
  await owner.shutdown();owner=await createAgentState(options(storage));
  assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  for(const turn of ['turn-257','completed']){
    await owner.ingest(hook('UserPromptSubmit',turn,9999));await owner.ingest(hook('Stop',turn,10000));
  }
  assert.equal(owner.snapshot().sessions[0].turn.id,'turn-258');assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  assert.equal(owner.snapshot().sessions[0].notices.length,1);
  await owner.ingest(hook('UserPromptSubmit','turn-0',10001));
  assert.equal(owner.snapshot().sessions[0].turn.id,'turn-0');assert.equal(owner.snapshot().sessions[0].restartUncertain,false);
});

test('old ambiguous format recovers in place without losing unrelated state or inventing history',async t=>{
  const bytes=readFileSync(new URL('../fixtures/legacy-ambiguous-v1.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'9b4b4947cbca54c58a35bb002a499ea0a49909db976b1c237606f49f6da60b16');
  const legacy=JSON.parse(bytes);assert.equal(validateExport(legacy).ok,true);
  const storage=new MemoryStorage();let now=2000;
  let owner=await createAgentState({...options(storage,()=>now),importState:legacy});t.after(()=>owner.shutdown());
  const before=owner.snapshot();assert.equal(before.sessions[0].activity,'unknown');assert.equal(before.sessions[0].turn.status,'unknown');
  await owner.ingest(hook('UserPromptSubmit','fresh-turn',now));
  const recovered=owner.snapshot();const session=recovered.sessions[0];
  assert.equal(session.activity,'active');assert.equal(session.turn.id,'fresh-turn');assert.equal(session.label,'Chosen task');
  assert.deepEqual(session.attention,before.sessions[0].attention);assert.equal(session.read,'unknown');
  assert.deepEqual(recovered.sessions[1],before.sessions[1]);
  assert.deepEqual(session.notices.find(notice=>notice.turn.status==='known').acknowledgedBy,['pixoo']);
  assert.deepEqual(session.notices.find(notice=>notice.turn.status==='unknown').acknowledgedBy,[]);
  assert.equal(validateSnapshot(recovered).ok,true);
  const python=spawnSync(process.env.PYTHON??'python3',['-c','import json, sys; from agent_state import validate_snapshot; assert validate_snapshot(json.load(sys.stdin))["ok"]'],
    {input:JSON.stringify(recovered),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:new URL('../python',import.meta.url).pathname}});
  assert.equal(python.status,0,python.stderr);
  assert.ok(owner.journal().every(row=>!('event' in row)&&!('turn' in row)));
  await owner.shutdown();owner=await createAgentState(options(storage,()=>now));
  assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  await owner.ingest(hook('Stop','fresh-turn',++now));assert.equal(owner.snapshot().sessions[0].activity,'idle');
  now+=300000;assert.equal(owner.snapshot().sessions[0].freshness,'uncertain');
  assert.equal(owner.snapshot().sessions[0].notices.length,3);
});
