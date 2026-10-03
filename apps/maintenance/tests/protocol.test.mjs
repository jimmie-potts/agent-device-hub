import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runProcess} from '../dist/process.js';
import {fixture} from './fixture.mjs';
async function invoke(f,request=f.request){const r=await runProcess(process.execPath,[f.cli,'--config',f.configPath],{deadline:Date.now()+10000,maxBytes:65536,input:JSON.stringify(request),env:{...process.env,OPENAI_API_KEY:'synthetic-api-key-must-not-reach-planner'}});return JSON.parse(r.stdout);}
test('real CLI creates one supported issue, retains original privately and returns only selection',async()=>{
 const f=await fixture();try{
  const result=await invoke(f);assert.equal(result.status,'complete');assert.equal(result.selections.length,1);
  assert.equal(result.selections[0].issue,12);
  const remote=await f.read();assert.equal(remote.creates,1);assert.equal(remote.apiKeyOffered,false);
  assert.ok(!/private-device|private-cursor|Private detail/.test(remote.issues[0].body));
  assert.ok(!/private-device|private-cursor/.test(remote.prompt));
  assert.match(await readFile(join(f.config.stateRoot,'observations-fixture-run.json'),'utf8'),/private-device/);
  const report=JSON.parse(await readFile(join(f.request.evidenceDirectory,'intake-report.json'),'utf8'));
  assert.equal(report.delivery,'not-observed');assert.equal(report.coverage.status,'partial');
  assert.equal((await stat(join(f.config.stateRoot,'observations-fixture-run.json'))).mode&0o777,0o600);
  await invoke(f);assert.equal((await f.read()).creates,1);
 }finally{await f.close();}
});
for(const mode of ['performance','speculative','expected','missing-source','bad-source','adversarial','stale-source'])test(`${mode} cannot publish a supported defect`,async()=>{
 const f=await fixture({mode});try{const r=await invoke(f);assert.equal(r.selections.length,0);assert.equal((await f.read()).creates,0);}finally{await f.close();}
});
test('lost create response reconciles the exact issue without repeating a write',async()=>{
 const f=await fixture({mode:'lost-response'});try{
  assert.equal((await invoke(f)).status,'uncertain');assert.equal((await f.read()).creates,1);
  assert.equal((await invoke(f)).reason,'interrupted-run-needs-reconciliation');
  await f.change({mode:'success'});
  const r=await invoke(f,{...f.request,operation:'reconcile'});assert.equal(r.status,'complete');assert.equal(r.selections[0].issue,12);assert.equal((await f.read()).creates,1);
 }finally{await f.close();}
});
test('conflicting markers and unavailable lookups preserve uncertainty without replay',async()=>{
 const f=await fixture({mode:'lost-response'});try{
  await invoke(f);const state=await f.read();
  await f.change({mode:'success',issues:[...state.issues,{...state.issues[0],number:13}]});
  assert.equal((await invoke(f,{...f.request,operation:'reconcile'})).status,'uncertain');
  await f.change({mode:'lookup-unavailable'});
  assert.equal((await invoke(f,{...f.request,operation:'reconcile'})).status,'blocked');assert.equal((await f.read()).creates,1);
 }finally{await f.close();}
});
test('existing eligible issues are reused and closed findings are never reopened',async()=>{
 const issue={number:25,state:'open',title:'Existing supported defect',body:'Synthetic existing work',labels:[{name:'status:ready'}],assignees:[]};
 const f=await fixture({issues:[issue]});try{
  await f.change({existingIssue:25});const r=await invoke(f);assert.equal(r.selections[0].issue,25);assert.equal((await f.read()).creates,0);
  await f.change({issues:[{...issue,state:'closed'}]});
  const next=await invoke(f,{...f.request,runId:'next-run'});assert.equal(next.status,'complete');assert.equal(next.selections.length,0);assert.equal((await f.read()).creates,0);
 }finally{await f.close();}
});
test('expired and wrong-authority requests cause no diagnostic, planning or GitHub calls',async()=>{
 const f=await fixture();try{
  assert.equal((await invoke(f,{...f.request,authority:'owner-queue'})).status,'blocked');
  assert.equal((await invoke(f,{...f.request,deadline:1})).status,'blocked');
  assert.deepEqual((await f.read()).calls,[]);
 }finally{await f.close();}
});
test('partial query preserves accepted originals; missing input does not claim healthy coverage',async()=>{
 for(const mode of ['partial-query','query-unavailable']){
  const f=await fixture({mode});try{
   await invoke(f);const report=JSON.parse(await readFile(join(f.request.evidenceDirectory,'intake-report.json'),'utf8'));
   assert.equal(report.coverage.status,mode==='partial-query'?'partial':'unavailable');
   if(mode==='partial-query')assert.match(await readFile(join(f.config.stateRoot,'observations-fixture-run.json'),'utf8'),/private-device/);
  }finally{await f.close();}
 }
});
test('pagination checks later existing work before creating an issue',async()=>{
 const issues=Array.from({length:101},(_,i)=>({number:i+1,state:'closed',title:'Synthetic completed work',body:'Fixture',labels:[],assignees:[]}));issues[100].state='open';
 const f=await fixture({issues});try{await f.change({existingIssue:101});const r=await invoke(f);assert.equal(r.selections[0].issue,101);assert.equal((await f.read()).creates,0);assert.ok((await f.read()).calls.some(c=>c.args.at(-1).includes('page=2')));}finally{await f.close();}
});
test('credential-shaped unsupported fields are excluded without widening diagnostics',async()=>{
 const f=await fixture();try{
  const state=await f.read(),row=JSON.parse(state.row),message=JSON.parse(row.MESSAGE);message.attributes.api_key='synthetic-secret';row.MESSAGE=JSON.stringify(message);
  await f.change({row:JSON.stringify(row)+'\n'});const r=await invoke(f);assert.equal(r.selections.length,0);
  assert.ok(!(await readFile(join(f.config.stateRoot,'observations-fixture-run.json'),'utf8')).includes('synthetic-secret'));
 }finally{await f.close();}
});
test('an issue marker alone cannot bypass source-backed planning',async()=>{
 const seed=await fixture();let markerBody;
 try{await invoke(seed);markerBody=(await seed.read()).issues[0].body;}finally{await seed.close();}
 const f=await fixture({issues:[{number:44,state:'open',title:'Untrusted copied marker',body:markerBody,labels:[],assignees:[]}]});
 try{const r=await invoke(f);assert.equal(r.selections.length,0);assert.equal((await f.read()).creates,0);assert.ok((await f.read()).calls.some(c=>c.tool==='codex'&&c.args[0]==='exec'));}finally{await f.close();}
});
