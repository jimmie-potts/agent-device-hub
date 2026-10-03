import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlan,assertApproval,installationStatus,protectedPath} from '../dist/install/plan.js';
import {inventory,sha256} from '../dist/install/files.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hi-plan-'));
 const program=join(root,'runtime/hub-gh30'),state=join(root,'state');
 await mkdir(program,{recursive:true});await mkdir(state,{mode:0o700});
 await writeFile(join(program,'manifest.json'),'{"version":"old"}');await writeFile(join(program,'app.js'),'old');
 await writeFile(join(root,'node'),'shared node');await writeFile(join(state,'host.json'),'{"ownerId":"owner"}');
 const layout={root:join(root,'hub'),entry:program,state,config:join(state,'host.json'),node:join(root,'node'),protectedPaths:[join(root,'node')],unit:'codex-nanoleaf-monitor.service'};
 const source={repository:'/source',head:'a'.repeat(40),target:'a'.repeat(40),mergedMain:'a'.repeat(40),clean:true,comparison:{status:'unknown',reason:'legacy-source-unknown'},commits:[],components:[]};
 const service={state:'active',pid:123,start:'first',executable:layout.node,entry:join(program,'dist/cli.js'),build:null};
 return {root,layout,source,service,options:{layout,source,service,owner:'operator',operation:'upgrade',requestedTarget:'main'}};
}
test('plan is read-only and approval binds baseline, configuration, target, owner and shared paths',async()=>{
 const f=await fixture();try{
  const before=await inventory(f.root),p=await createPlan(f.options);
  assert.deepEqual(await inventory(f.root),before);assert.equal(p.bound.source.comparison.status,'unknown');
  assert.equal(p.bound.previous.kind,'legacy');assert.equal(p.bound.unit,'codex-nanoleaf-monitor.service');
  assert.equal(p.bound.recovery.strategy,'latest-durable-state');assert.equal(p.bound.backup.restoreAutomatically,false);
  assertApproval(p,p.digest);assert.throws(()=>assertApproval(p,'0'.repeat(64)),/approval-changed/);
  await writeFile(f.layout.config,'{"ownerId":"changed"}');assert.notEqual((await createPlan(f.options)).digest,p.digest);
  await writeFile(f.layout.config,'{"ownerId":"owner"}');await writeFile(join(f.layout.entry,'app.js'),'changed');assert.notEqual((await createPlan(f.options)).digest,p.digest);
  await writeFile(join(f.layout.entry,'app.js'),'old');await writeFile(f.layout.node,'changed node');assert.notEqual((await createPlan(f.options)).digest,p.digest);
  assert.notEqual((await createPlan({...f.options,owner:'another'})).digest,p.digest);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('dirty or unmerged source refuses; process observations do not relabel an inactive installation',async()=>{
 const f=await fixture();try{
  await assert.rejects(createPlan({...f.options,source:{...f.source,clean:false}}),/dirty-install-source/);
  await assert.rejects(createPlan({...f.options,source:{...f.source,target:'branch'}}),/unmerged-install-source/);
  const status=await installationStatus(f.layout,{...f.service,state:'inactive'},null);
  assert.equal(status.running,null);assert.equal(status.remote.status,'unknown');assert.equal(status.installed.identity.kind,'legacy');
  const p=await createPlan(f.options),restarted=await createPlan({...f.options,service:{...f.service,pid:124,start:'second'}});
  assert.equal(restarted.digest,p.digest,'volatile process observations are not approval inputs');
  await symlink('/tmp',f.layout.root);await assert.rejects(createPlan(f.options),/unsafe-install-root/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('first adoption uses a trusted full prior release identity only after complete manifest verification',async()=>{
 const f=await fixture();try{
  const sourceRevision='c'.repeat(40),manifest=JSON.stringify({artifact:'@jimmie-potts/hub',version:'old',sourceRevision,files:{'app.js':sha256('old')},dependencyFiles:{}});
  await writeFile(join(f.layout.entry,'manifest.json'),manifest);
  const identity={kind:'release',sourceRevision,version:'old',archiveSha256:'b'.repeat(64),manifestSha256:sha256(manifest)};
  const baselineReceipt=join(f.root,'prior-source-receipt.json');await writeFile(baselineReceipt,JSON.stringify(identity),{mode:0o600});f.layout.baselineReceipt=baselineReceipt;
  assert.deepEqual((await createPlan(f.options)).bound.previous,identity);
  await writeFile(join(f.layout.entry,'app.js'),'changed');await assert.rejects(createPlan(f.options),/install-file-hash/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('protected executable fingerprints support the installed Node binary size without relaxing release reads',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-node-'));try{
  const path=join(root,'node'),handle=await open(path,'wx',0o700);await handle.truncate(126458664);await handle.close();
  const first=await protectedPath(path);assert.match(first.sha256,/^[a-f0-9]{64}$/);
  const changed=await open(path,'r+');await changed.write(Buffer.from('changed'),0,7,100000000);await changed.close();
  assert.notEqual((await protectedPath(path)).sha256,first.sha256);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('protected runtime inventories stream large executables while release and protected limits remain bounded',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-protected-'));try{
  const directory=join(root,'runtime');await mkdir(directory);
  const path=join(directory,'codex'),handle=await open(path,'wx',0o700);await handle.truncate(258659424);await handle.close();
  await assert.rejects(inventory(directory),/unsafe-install-file/);
  const first=await protectedPath(directory);assert.match(first.sha256,/^[a-f0-9]{64}$/);
  const changed=await open(path,'r+');await changed.write(Buffer.from('changed'),0,7,200000000);await changed.close();
  assert.notEqual((await protectedPath(directory)).sha256,first.sha256);
  const oversized=await open(path,'r+');await oversized.truncate(256*1024*1024+1);await oversized.close();
  await assert.rejects(protectedPath(directory),/unsafe-install-file/);
 }finally{await rm(root,{recursive:true,force:true});}
});
