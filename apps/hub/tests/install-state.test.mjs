import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {captureState,statePreserved} from '../dist/install/state.js';
const program=fileURLToPath(new URL('..',import.meta.url));
for(const scenario of ['empty-fence','delayed-observation'])test('real owner evolution preserves '+scenario,async()=>{
 const {createAgentState}=await import('@jimmie-potts/agent-state');
 const {HubStorage}=await import('../dist/storage.js');
 const root=await mkdtemp(join(tmpdir(),'hi-state-owner-'));let owner,lease;
 const identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'};
 const options={storage:{acquire:async(id,signal)=>lease=await new HubStorage(root).acquire(id,signal)},ownerId:'owner',consumers:[],clock:()=>10000};
 const event=(kind,sequence,observedAtMs)=>({apiVersion:'1.0',identity,turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind},observedAtMs,ordering:{status:'known',epoch:'epoch',sequence}});
 try{
  owner=await createAgentState(options);
  if(scenario==='delayed-observation')lease.setFence(false);
  assert.equal((await owner.ingest(event('session.started',1,10000))).ok,true);
  await owner.shutdown();owner=undefined;const before=await captureState(root);
  owner=await createAgentState(options);
  const result=scenario==='empty-fence'?await owner.setLabel(identity,'Latest label'):await owner.ingest(event('turn.ended',2,9000));
  assert.equal(result.ok,true);assert.equal(owner.snapshot().collector,'running');
  await owner.shutdown();owner=undefined;const after=await captureState(root);
  assert.equal(after.state.revision,before.state.revision+1);
  if(scenario==='empty-fence')assert.deepEqual(after.tables.fence,[]);
  else assert.equal(after.state.sessions[0].observedAtMs,9000);
  assert.equal(statePreserved(before,after),true);assert.equal(statePreserved(after,before),false);
  const lost=structuredClone(after);lost.state.sessions=[];assert.equal(statePreserved(after,lost),false);
 }finally{await owner?.shutdown();await rm(root,{recursive:true,force:true});}
});
test('read-only durable evidence covers all tables and rejects older records or missing dedup history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-state-'));
 try{
  const probe=spawnSync(process.execPath,[join(program,'bin/install-compatibility-probe.mjs'),program,root,'write'],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
  const bytes=await readFile(join(root,'state.sqlite')),before=await captureState(root);
  assert.deepEqual(await readFile(join(root,'state.sqlite')),bytes);assert.equal(statePreserved(before,await captureState(root)),true);
  const db=new DatabaseSync(join(root,'state.sqlite'));
  db.prepare('INSERT INTO automation_events VALUES(?,?)').run('github:newer',100);db.close();
  const newer=await captureState(root);assert.equal(statePreserved(before,newer),true);assert.equal(statePreserved(newer,before),false);
  const lost=structuredClone(newer);lost.state.sessions[0].notices[0].acknowledgedBy=[];assert.equal(statePreserved(newer,lost),false);
  const old=structuredClone(newer);old.state.revision--;assert.equal(statePreserved(newer,old),false);
  const relabelled=structuredClone(newer);relabelled.state.sessions[0].label='Old label';assert.equal(statePreserved(newer,relabelled),false);
  const changed=structuredClone(newer);changed.tables.automation_settings=[];assert.equal(statePreserved(newer,changed),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('latest-state evidence accepts real label and settings updates without accepting older or missing records',async()=>{
 const {createAgentState}=await import('@jimmie-potts/agent-state');
 const {HubStorage}=await import('../dist/storage.js');
 const root=await mkdtemp(join(tmpdir(),'hi-state-evolution-'));let owner;
 try{
  const probe=spawnSync(process.execPath,[join(program,'bin/install-compatibility-probe.mjs'),program,root,'write'],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
  const before=await captureState(root);let lease;
  owner=await createAgentState({storage:{acquire:async(id,signal)=>lease=await new HubStorage(root).acquire(id,signal)},ownerId:before.state.ownerId,consumers:before.state.consumers,clock:()=>10000});
  assert.equal((await owner.setLabel(before.state.sessions[0].identity,'Latest approved label')).ok,true);
  const settings=lease.automation.settings();lease.automation.replaceSettings({...settings,noFlourishes:!settings.noFlourishes});
  const rule=lease.automation.rules()[0];assert.equal(lease.automation.replaceRule({...rule,name:'Updated rule',updatedAtMs:10001}),true);
  lease.automation.replaceInterruptSet(['ci.failed']);
  await owner.shutdown();owner=undefined;
  const latest=await captureState(root);assert.equal(statePreserved(before,latest),true);assert.equal(statePreserved(latest,latest),true);assert.equal(statePreserved(latest,before),false);
  const lost=structuredClone(latest);lost.state.sessions=[];assert.equal(statePreserved(latest,lost),false);
  owner=await createAgentState({storage:{acquire:async(id,signal)=>lease=await new HubStorage(root).acquire(id,signal)},ownerId:before.state.ownerId,consumers:before.state.consumers,clock:()=>10000});
  assert.equal(lease.automation.deleteRule(rule.id),true);
  lease.automation.replaceSettings(settings);
  await owner.shutdown();owner=undefined;
  const edited=await captureState(root);assert.equal(edited.state.revision,latest.state.revision);assert.equal(statePreserved(latest,edited),true);assert.equal(statePreserved(edited,latest),false);
  owner=await createAgentState({storage:new HubStorage(root),ownerId:before.state.ownerId,consumers:before.state.consumers,clock:()=>86410001});
  await owner.shutdown();owner=undefined;
  const expired=await captureState(root);assert.deepEqual(expired.state.sessions,[]);assert.deepEqual(expired.state.journal,[]);assert.deepEqual(expired.state.retirements,[]);assert.equal(statePreserved(edited,expired),true);assert.equal(statePreserved(expired,edited),false);
 }finally{await owner?.shutdown();await rm(root,{recursive:true,force:true});}
});
