import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,readlink,readdir,rm,lstat,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {createPlan} from '../dist/install/plan.js';
import {sha256} from '../dist/install/files.js';
import {executeOperation} from '../dist/install/operation.js';
import {selectRollback} from '../dist/install/retention.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hi-op-')),state=join(root,'state'),entry=join(root,'runtime/hub-gh30');
 await mkdir(entry,{recursive:true});await mkdir(state,{mode:0o700});
 await writeFile(join(entry,'manifest.json'),'{"version":"old"}');await writeFile(join(entry,'app.js'),'old');
 await writeFile(join(root,'runtime/node'),'shared-node');await writeFile(join(root,'runtime/other'),'other-owner');
 await writeFile(join(state,'host.json'),'{"ownerId":"owner"}',{mode:0o600});await writeFile(join(state,'state.sqlite'),'["old"]',{mode:0o600});
 const layout={root:join(root,'hub'),state,entry,node:join(root,'runtime/node'),config:join(state,'host.json'),protectedPaths:[join(root,'runtime/other')],unit:'codex-nanoleaf-monitor.service'};
 const source={repository:'/source',head:'a'.repeat(40),target:'a'.repeat(40),mergedMain:'a'.repeat(40),clean:true,comparison:{status:'unknown',reason:'legacy-source-unknown'},commits:[],components:[]};
 let observed={state:'active',pid:100,start:'initial',executable:layout.node,entry:join(entry,'dist/cli.js'),build:null};
 const calls=[],options={layout,source,owner:'operator',operation:'upgrade',requestedTarget:'main'};
 const plan=()=>createPlan({...options,service:observed});
 const approved=await plan();
 const target=join(layout.root,'releases',source.target);
 const manifest=JSON.stringify({artifact:'@jimmie-potts/hub',version:'new',sourceRevision:source.target,files:{'app.js':sha256('new')},dependencyFiles:{}});
 const identity={kind:'release',sourceRevision:source.target,version:'new',archiveSha256:'b'.repeat(64),manifestSha256:sha256(manifest)};
 const prepare=async()=>{await mkdir(target,{recursive:true,mode:0o700});await writeFile(join(target,'app.js'),'new');await writeFile(join(target,'manifest.json'),manifest);await mkdir(join(layout.root,'provenance'),{recursive:true,mode:0o700});await writeFile(join(layout.root,'provenance',source.target+'.json'),JSON.stringify(identity));return {path:target,identity};};
 const service={observe:async()=>structuredClone(observed),stop:async()=>{calls.push('stop');observed={...observed,state:'inactive',pid:null};},start:async()=>{calls.push('start');observed={...observed,state:'active',pid:100+calls.length,start:'start-'+calls.length};},
  health:async(path,id)=>({identity:id,process:{...structuredClone(observed),entry:join(path,'dist/cli.js'),build:id.kind==='release'?{sourceRevision:id.sourceRevision,version:id.version}:null},program:path,owner:'owner',collector:'running',admission:'open',assets:true,launchSocket:true,browserSecurity:true})};
 const stateReader={capture:async()=>JSON.parse(await readFile(join(state,'state.sqlite'),'utf8')),preserved:(before,after)=>before.every(item=>after.includes(item))};
 const input={plan,approvedDigest:approved.digest,prepare,qualify:async()=>({status:'compatible',evidenceSha256:'c'.repeat(64)}),service,state:stateReader};
 return {root,layout,calls,plan,approved,target,identity,input,service,stateReader,options};
}
const valid=result=>assert.equal(validateInstallReceipt(result.receipt),true,JSON.stringify(result.receipt));
test('first adoption preserves stable shared paths and retains original while producing a valid success receipt',async()=>{
 const f=await fixture();try{
  const result=await executeOperation(f.input);valid(result);assert.equal(result.receipt.outcome,'succeeded');assert.equal(result.receipt.operation,'migrate');
  assert.equal(await readlink(f.layout.entry),join(f.layout.root,'current'));assert.equal(await realpath(f.layout.entry),f.target);
  assert.equal(await readFile(f.layout.node,'utf8'),'shared-node');assert.equal(await readFile(join(f.root,'runtime/other'),'utf8'),'other-owner');
  assert.equal((await lstat(join(f.root,'runtime'))).isDirectory(),true);assert((await readdir(join(f.root,'runtime'))).some(x=>x.startsWith('hub-gh30.prev-')));
  assert.deepEqual(f.calls,['stop','start']);assert.deepEqual(await f.stateReader.capture(),['old']);
  await assert.rejects(lstat(join(f.layout.root,'install.lock')),/ENOENT/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('baseline drift and unknown compatibility refuse before any service stop',async()=>{
 for(const kind of ['drift','unknown']){const f=await fixture();try{
  if(kind==='drift'){await writeFile(f.layout.config,'{"ownerId":"different"}');await assert.rejects(executeOperation(f.input),/approval-changed/);}
  else{f.input.qualify=async()=>({status:'unknown'});const result=await executeOperation(f.input);valid(result);assert.equal(result.receipt.outcome,'refused');}
  assert.deepEqual(f.calls,[]);
 }finally{await rm(f.root,{recursive:true,force:true});}}
});
test('failed target health recovers legacy against newer state, never the pre-upgrade backup',async()=>{
 const f=await fixture();try{
  const health=f.service.health;f.service.health=async(path,id)=>{if(id.kind==='release'){await writeFile(join(f.layout.state,'state.sqlite'),'["old","new-notice","new-consumed-event"]');throw new Error('candidate-health');}return health(path,id);};
  const result=await executeOperation(f.input);valid(result);assert.equal(result.receipt.outcome,'failed-rolled-back');assert.equal(result.receipt.running.verification,'legacy-process-artifacts');
  assert.deepEqual(await f.stateReader.capture(),['old','new-notice','new-consumed-event']);assert.match(await realpath(f.layout.entry),/\/legacy\/legacy-/);assert.deepEqual(f.calls,['stop','start','stop','start']);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('stop failure, interrupted migration, failed rollback and final receipt failure retain inspection barriers',async()=>{
 for(const kind of ['stop','interrupted','rollback','receipt']){const f=await fixture();try{
  if(kind==='stop')f.service.stop=async()=>{f.calls.push('stop');throw new Error('stop-failed');};
  if(kind==='interrupted')f.input.checkpoint=async phase=>{if(phase==='legacy-renamed')throw new Error('injected-interruption');};
  if(kind==='rollback'){const health=f.service.health;f.service.health=async(...args)=>{if(f.calls.includes('start'))throw new Error('unhealthy');return health(...args);};}
  if(kind==='receipt')f.input.checkpoint=async phase=>{if(phase==='final-receipt')throw new Error('disk-full');};
  const result=await executeOperation(f.input);valid(result);
  assert.equal(result.receipt.outcome,{stop:'failed-before-switch',interrupted:'interrupted',rollback:'rollback-failed',receipt:'receipt-finalization-failed'}[kind]);
  assert.equal((await lstat(join(f.layout.root,'install.lock'))).isDirectory(),true);
  await assert.rejects(executeOperation({...f.input,approvedDigest:(await f.plan().catch(()=>f.approved)).digest}),/install-operation-unresolved|unknown-install|ENOENT/);
  if(kind==='receipt'){const persisted=JSON.parse(await readFile(result.path,'utf8'));assert.equal(persisted.outcome,'in-progress');assert(result.diagnostic);}
 }finally{await rm(f.root,{recursive:true,force:true});}}
});
test('another operation cannot enter while the first owns its lock',async()=>{
 const f=await fixture();let release,started;
 const ready=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
 try{
  const stop=f.service.stop;f.service.stop=async()=>{started();await held;await stop();};
  const first=executeOperation(f.input);await ready;
  await assert.rejects(executeOperation(f.input),/install-operation-unresolved/);
  release();assert.equal((await first).receipt.outcome,'succeeded');assert.deepEqual(f.calls,['stop','start']);
 }finally{release?.();await rm(f.root,{recursive:true,force:true});}
});
test('backup failure never switches, and wrong running identity causes verified recovery',async()=>{
 for(const kind of ['backup','identity']){const f=await fixture();try{
  if(kind==='backup')f.input.state.capture=async()=>{throw new Error('backup-state-unreadable');};
  else{const health=f.service.health;f.service.health=async(path,id)=>{const result=await health(path,id);if(id.kind==='release')result.process.build.sourceRevision='f'.repeat(40);return result;};}
  const result=await executeOperation(f.input);valid(result);
  assert.equal(result.receipt.outcome,kind==='backup'?'failed-before-switch':'failed-rolled-back');
  if(kind==='backup'){assert.equal((await lstat(f.layout.entry)).isDirectory(),true);assert.deepEqual(f.calls,['stop']);}
 }finally{await rm(f.root,{recursive:true,force:true});}}
});
test('explicit rollback and re-upgrade use verified targets while preserving the latest records',async()=>{
 const f=await fixture();try{
  const first=await executeOperation(f.input);assert.equal(first.receipt.outcome,'succeeded');
  await writeFile(join(f.layout.state,'state.sqlite'),'["old","latest"]');
  const selected=await selectRollback(f.layout.root,f.identity);
  const rollbackPlan=()=>createPlan({...f.options,operation:'rollback',requestedTarget:'previous',rollbackTarget:selected.identity,service:{state:'active',pid:500,start:'observed',executable:f.layout.node,entry:'unused',build:null}});
  const rollback=await executeOperation({...f.input,plan:rollbackPlan,approvedDigest:(await rollbackPlan()).digest,prepare:async()=>selected});valid(rollback);assert.equal(rollback.receipt.operation,'rollback');assert.equal(rollback.receipt.outcome,'succeeded');
  f.input.approvedDigest=(await f.plan()).digest;
  const again=await executeOperation(f.input);valid(again);assert.equal(again.receipt.outcome,'succeeded');assert.deepEqual(await f.stateReader.capture(),['old','latest']);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('Hub-first and Nanoleaf-first adoption preserve the shared parent, Node and other runtime selection',async()=>{
 for(const order of ['hub-first','nanoleaf-first']){const f=await fixture();try{
  const n=join(f.root,'nanoleaf');await mkdir(n);
  const components=['bridge','mcp','vendor'];
  for(const component of components){const path=join(f.root,'runtime',component);await mkdir(path);await writeFile(join(path,'marker'),'legacy-'+component);f.layout.protectedPaths.push(path);}
  for(const release of ['one','two'])for(const component of components){const path=join(n,release,component);await mkdir(path,{recursive:true});await writeFile(join(path,'marker'),release+'-'+component);}
  const changeNL=async()=>{
   const hub=await realpath(f.layout.entry),node=await readFile(f.layout.node);
   await symlink(join(n,'one'),join(n,'current'));
   for(const component of components){const path=join(f.root,'runtime',component);await rename(path,path+'.prev-nanoleaf');await symlink(join(n,'current',component),path);}
   for(const release of ['two','one','two']){await symlink(join(n,release),join(n,'next'));await rename(join(n,'next'),join(n,'current'));assert.equal(await realpath(f.layout.entry),hub);assert.deepEqual(await readFile(f.layout.node),node);assert((await lstat(join(f.root,'runtime'))).isDirectory());}
  };
  if(order==='nanoleaf-first')await changeNL();
  const before=await Promise.all(components.map(component=>realpath(join(f.root,'runtime',component))));f.input.approvedDigest=(await f.plan()).digest;
  assert.equal((await executeOperation(f.input)).receipt.outcome,'succeeded');
  assert.deepEqual(await Promise.all(components.map(component=>realpath(join(f.root,'runtime',component)))),before);
  if(order==='hub-first')await changeNL();
  assert.equal(await realpath(f.layout.entry),f.target);assert.equal(await readFile(f.layout.node,'utf8'),'shared-node');
 }finally{await rm(f.root,{recursive:true,force:true});}}
});
