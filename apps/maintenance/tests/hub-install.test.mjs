import test from 'node:test';
import {createHash} from 'node:crypto';
import {canonical} from '../../hub/dist/install/files.js';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runHubInstall} from '../install/hub.mjs';
const corpus=JSON.parse(await readFile(new URL('../../../packages/contracts/fixtures/install-receipt-v1.json',import.meta.url),'utf8'));
export async function installFixture(){
 const directory=await mkdtemp(join(tmpdir(),'hub-adapter-'));const root=join(directory,'native'),evidenceRoot=join(directory,'evidence'),evidenceDirectory=join(evidenceRoot,'attempt');
 for(const path of [root,join(root,'receipts'),evidenceRoot,evidenceDirectory])await mkdir(path,{mode:0o700});
 const config={schemaVersion:1,owner:'primary',node:process.execPath,sourceRoot:join(directory,'source'),tokenFile:join(directory,'token'),baselineReceipt:null,installationRoot:root,stateDirectory:join(directory,'state'),evidenceRoot,reserveSeconds:600,capacityBytes:16*1024*1024};
 const input={schemaVersion:1,operation:'install',repository:'jimmie-potts/agent-device-hub',issue:1,merge:'b'.repeat(40),owner:config.owner,deadline:Date.now()/1000+1800,evidenceDirectory};
 const receipt=structuredClone(corpus.cases.find(x=>x.id==='upgrade-success').value);receipt.operationId='op-00000000-0000-4000-8000-000000000001';
 const plan={digest:receipt.approval.planSha256,bound:{owner:'primary',operation:'upgrade',migration:false,source:{target:input.merge,comparison:{status:'complete'},clean:true,removedCommits:[],components:['apps/hub/src/http.ts']},layout:{root,node:'/qualified/node'},health:{tokenFile:config.tokenFile,endpoint:'http://127.0.0.1:3456'},previous:receipt.previous,stateOwner:'hub-owner'}};
 plan.digest=createHash('sha256').update(canonical(plan.bound)).digest('hex');receipt.approval.planSha256=plan.digest;
 let running=receipt.previous;const calls=[];
 const call=async(_config,args)=>{
  calls.push(args);
  if(args[0]==='plan')return {code:0,value:plan};
  if(args[0]==='upgrade'){
   assert.equal(args[args.indexOf('--approve')+1],plan.digest);assert.equal(Number(args[args.indexOf('--deadline')+1]),input.deadline);
   await writeFile(join(root,'receipts',receipt.operationId+'.json'),JSON.stringify(receipt),{mode:0o600});running=receipt.outcome==='succeeded'?receipt.target:receipt.previous;
   return {code:receipt.outcome==='succeeded'?0:1,value:{receipt,path:join(root,'receipts',receipt.operationId+'.json')}};
  }
  assert.equal(args[0],'status');const path=join(root,'releases',running.sourceRevision);
  return {code:0,value:{installed:{identity:running,path},service:'active',running:{state:'active',pid:123,start:'12345',executable:'/qualified/node',entry:join(path,'dist/cli.js'),build:{sourceRevision:running.sourceRevision,version:running.version}}}};
 };
 const health=async()=>({ownerId:'hub-owner',collector:'running',admission:'open',build:{sourceRevision:running.sourceRevision,version:running.version}});
 return {directory,root,config,input,receipt,plan,calls,call,health,dispose:()=>rm(directory,{recursive:true,force:true})};
}
test('Hub adapter forwards native digest/deadline and verifies full receipt plus current process/health',async()=>{
 const f=await installFixture();try{
  const result=await runHubInstall(f.input,f.config,f);assert.equal(result.status,'installed',result.reason);assert.equal(result.installedRevision,f.input.merge);assert.match(result.receipt.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(f.calls.map(x=>x[0]),['plan','upgrade','status','status']);await assert.rejects(lstat(join(f.root,'install.lock')),/ENOENT/);
 }finally{await f.dispose();}
});
test('Hub adapter rejects wrong owner, deadline and evidence location before native effects',async()=>{
 for(const patch of [{owner:'other'},{deadline:Date.now()/1000+1},{evidenceDirectory:'/outside'}]){
  const f=await installFixture();try{const result=await runHubInstall({...f.input,...patch},f.config,f);assert.equal(result.status,'blocked');assert.deepEqual(f.calls,[]);}finally{await f.dispose();}
 }
});
test('lost native response reconciles by reads and never repeats upgrade',async()=>{
 const f=await installFixture();try{
  const call=async(...args)=>{const result=await f.call(...args);if(args[1][0]==='upgrade')throw new Error('lost-response');return result;};
  assert.equal((await runHubInstall(f.input,f.config,{call,health:f.health})).status,'uncertain');
  const result=await runHubInstall({...f.input,operation:'reconcile'},f.config,f);assert.equal(result.status,'installed',result.reason);
  assert.equal(f.calls.filter(x=>x[0]==='upgrade').length,1);assert.equal((await runHubInstall(f.input,f.config,f)).status,'uncertain');
 }finally{await f.dispose();}
});
test('unhealthy readback, native lock and incomplete receipts retain uncertainty',async()=>{
 for(const mode of ['health','lock','receipt']){
  const f=await installFixture();try{
   const call=async(...args)=>{const result=await f.call(...args);if(args[1][0]==='upgrade'){
    if(mode==='lock')await mkdir(join(f.root,'install.lock'));
    if(mode==='receipt')await writeFile(join(f.root,'receipts',f.receipt.operationId+'.json'),'{}',{mode:0o600});
   }return result;};
   const result=await runHubInstall(f.input,f.config,{call,health:mode==='health'?async()=>({collector:'faulted'}):f.health});
   assert.equal(result.status,'uncertain',mode);if(mode==='lock')assert.equal((await lstat(join(f.root,'install.lock'))).isDirectory(),true);
  }finally{await f.dispose();}
 }
});
test('terminal refused or recovered native result needs fresh healthy baseline before releasing claim',async()=>{
 for(const mode of ['refused','failed-rolled-back']){
  const f=await installFixture();try{
   const example=corpus.cases.find(x=>x.valid!==false&&x.value?.outcome===mode&&x.value.runtime==='hub');assert.ok(example,mode);
   const approval=structuredClone(f.receipt.approval);Object.assign(f.receipt,structuredClone(example.value),{operationId:f.receipt.operationId,requestedTarget:f.input.merge,installationId:f.config.owner,previous:f.plan.bound.previous});
   f.receipt.approval=approval;f.receipt.approval.planSha256=f.plan.digest;
   if(mode==='failed-rolled-back')f.receipt.running.identity=f.receipt.previous;
   const result=await runHubInstall(f.input,f.config,f);assert.equal(result.status,'blocked',result.reason);assert.equal(result.outcome,mode);assert.equal(result.locksClear,true);assert.deepEqual(result.baselineIdentity,f.receipt.previous);
  }finally{await f.dispose();}
 }
});
test('active installer machinery and unqualified migration are deferred before native upgrade',async()=>{
 for(const mode of ['machinery','migration']){
  const f=await installFixture();try{
   if(mode==='machinery')f.plan.bound.source.components.push('apps/hub/src/install/cli.ts');else f.plan.bound.migration=true;
   f.plan.digest=createHash('sha256').update(canonical(f.plan.bound)).digest('hex');f.receipt.approval.planSha256=f.plan.digest;
   const result=await runHubInstall(f.input,f.config,f);assert.equal(result.status,'blocked');
   assert.equal(result.reason,mode==='machinery'?'hub-active-machinery-needs-stopped-boundary':'hub-install-unqualified-migration');
   assert.deepEqual(f.calls.map(x=>x[0]),['plan']);
  }finally{await f.dispose();}
 }
});
test('real stdin adapter uses native argv and bounded read-only loopback health',async()=>{
 const {fixture,invoke}=await import('./hub-install-fixture.mjs');const f=await fixture();try{
  const response=await invoke(process.execPath,new URL('../bin/hub-supervisor-install.mjs',import.meta.url).pathname,f.configPath,f.request,f.dir);
  assert.equal(response.code,0,response.stderr);const result=JSON.parse(response.stdout);assert.equal(result.status,'installed',result.reason);
  assert.deepEqual((await f.read()).calls,['plan','upgrade','status','status']);
 }finally{await f.close();}
});
