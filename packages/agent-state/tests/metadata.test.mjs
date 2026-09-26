import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState,MemoryStorage,validateSnapshot,validateExport} from '../dist/index.js';
const identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'};
const event=(at,title='Initial title',extra={})=>({apiVersion:'1.1',identity,turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'turn.started'},observedAtMs:at,ordering:{status:'unknown'},title:{value:title,source:'provider'},project:'device-hub',...extra});
const options=storage=>({storage,ownerId:'owner',consumers:[],clock:()=>1000});
test('title/project rename persists independently of explicit labels and legacy projections',async()=>{
 const storage=new MemoryStorage(),owner=await createAgentState(options(storage));
 try{
  assert.equal((await owner.ingest(event(100))).ok,true);
  assert.equal((await owner.setLabel(identity,'Owner label')).ok,true);
  assert.equal((await owner.ingest(event(200,'Renamed',{label:{origin:'agent',value:'Agent label'}}))).ok,true);
  const current=owner.snapshot('1.2');assert.equal(validateSnapshot(current).ok,true);
  assert.equal(current.sessions[0].label,'Owner label');assert.equal(current.sessions[0].labelOrigin,'user');
  assert.deepEqual(current.sessions[0].title,{value:'Renamed',source:'provider'});assert.equal(current.sessions[0].project,'device-hub');
  for(const version of ['1.0','1.1']){const old=owner.snapshot(version);assert.equal(validateSnapshot(old).ok,true);for(const key of ['title','project','labelOrigin','metadataObservedAtMs'])assert.equal(key in old.sessions[0],false);assert.equal(old.sessions[0].label,'Owner label');}
  await owner.ingest(event(150,'Late old title'));assert.equal(owner.snapshot('1.2').sessions[0].title.value,'Renamed');
  const saved=await owner.exportState();assert.equal(saved.formatVersion,'2.1');assert.equal(validateExport(saved).ok,true);
 }finally{await owner.shutdown();}
 const restored=await createAgentState(options(storage));try{assert.equal(restored.snapshot('1.2').sessions[0].title.value,'Renamed');assert.equal(restored.snapshot('1.2').sessions[0].restartUncertain,true);}finally{await restored.shutdown();}
});
test('agent label provenance cannot overwrite owner labels and does not leak into legacy projections',async()=>{
 const owner=await createAgentState(options(new MemoryStorage()));try{
  await owner.ingest(event(100,'A',{label:{value:'Agent label',origin:'agent'}}));
  assert.equal(owner.snapshot('1.2').sessions[0].labelOrigin,'agent');assert.equal(owner.snapshot().sessions[0].label,undefined);
  await owner.setLabel(identity,'Owner');await owner.setLabel(identity,'Attempt','agent');assert.equal(owner.snapshot('1.2').sessions[0].label,'Owner');
  await owner.setLabel(identity,null);assert.equal(owner.snapshot('1.2').sessions[0].label,undefined);
  assert.equal((await owner.setLabel(identity,'😀'.repeat(80))).ok,true);assert.equal((await owner.setLabel(identity,'😀'.repeat(81))).ok,false);
 }finally{await owner.shutdown();}
});
test('a metadata-only rename preserves the lifecycle evidence clock',async()=>{
 let now=1000;
 const owner=await createAgentState({...options(new MemoryStorage()),clock:()=>now});
 try{
  await owner.ingest(event(100));now=2000;
  await owner.ingest(event(200,'Renamed'));
  const session=owner.snapshot('1.2').sessions[0];
  assert.equal(session.title.value,'Renamed');
  assert.equal(session.lastEvidenceAtMs,1000);
  assert.equal(session.observationAgeMs,1000);
 }finally{await owner.shutdown();}
});
test('durable 2.0 imports preserve legacy label precedence while adopting metadata',async()=>{
 const original=await createAgentState(options(new MemoryStorage()));
 let saved;
 try{await original.ingest({...event(100),label:{origin:'user',value:'Legacy owner label'}});saved=structuredClone(await original.exportState());}
 finally{await original.shutdown();}
 saved.formatVersion='2.0';
 for(const session of saved.sessions)for(const key of ['title','project','labelOrigin','metadataObservedAtMs'])delete session[key];
 assert.equal(validateExport(saved).ok,true);
 const owner=await createAgentState({...options(new MemoryStorage()),importState:saved});
 try{
  await owner.ingest(event(200,'New title',{label:{origin:'agent',value:'Agent label'}}));
  const session=owner.snapshot('1.2').sessions[0];
  assert.equal(session.label,'Legacy owner label');assert.equal(session.labelOrigin,'user');assert.equal(session.title.value,'New title');
  assert.equal((await owner.exportState()).formatVersion,'2.1');
 }finally{await owner.shutdown();}
});
