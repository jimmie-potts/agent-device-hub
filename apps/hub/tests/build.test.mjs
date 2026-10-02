import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,chmod,cp,symlink,rename,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {startHub} from '../dist/server.js';
import {readBuild} from '../dist/build.js';

test('metadata failures remain unknown and never expose manifest values or paths',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-build-metadata-')),file=join(directory,'manifest.json');
 const empty={sourceRevision:'unknown',version:'unknown'};
 const valid={artifact:'@jimmie-potts/hub',version:'0.4.0',sourceRevision:'a'.repeat(40)};
 try{
  assert.deepEqual(readBuild(pathToFileURL(file)),empty);
  assert.deepEqual(readBuild(pathToFileURL(directory)),empty);
  for(const value of ['{',JSON.stringify(null),JSON.stringify([]),JSON.stringify({...valid,artifact:'wrong'}),' '.repeat(256*1024+1)]){
   await writeFile(file,value);assert.deepEqual(readBuild(pathToFileURL(file)),empty);
  }
  for(const sourceRevision of [null,7,'abc','g'.repeat(40),'a'.repeat(40)+'\n','/private/SECRET',undefined]){
   await writeFile(file,JSON.stringify({...valid,sourceRevision}));
   assert.deepEqual(readBuild(pathToFileURL(file)),{sourceRevision:'unknown',version:'0.4.0'});
  }
  for(const version of [null,7,'/private/SECRET','0.4.0\n','v'.repeat(129),undefined]){
   await writeFile(file,JSON.stringify({...valid,version}));
   assert.deepEqual(readBuild(pathToFileURL(file)),{sourceRevision:valid.sourceRevision,version:'unknown'});
  }
  await writeFile(file,JSON.stringify({...valid,privatePath:'/private/SECRET'}));
  assert.deepEqual(readBuild(pathToFileURL(file)),{sourceRevision:valid.sourceRevision,version:valid.version});
  const target=join(directory,'another-release.json');await rename(file,target);await symlink(target,file);
  assert.deepEqual(readBuild(pathToFileURL(file)),empty,'a linked manifest cannot supply another release identity');
  await rm(file);await rename(target,file);
  await chmod(file,0);
  if(process.getuid?.()!==0)assert.deepEqual(readBuild(pathToFileURL(file)),empty);
 }finally{await chmod(file,0o600).catch(()=>{});await rm(directory,{recursive:true,force:true});}
});

test('running process keeps its identity across manifest replacement and current-link switch; restart adopts target',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-build-process-'));let processHandle;
 const packageRoot=fileURLToPath(new URL('..',import.meta.url));
 let dependencyRoot=packageRoot;
 while(!(await stat(join(dependencyRoot,'node_modules')).catch(()=>null))){
  const parent=dirname(dependencyRoot);assert.notEqual(parent,dependencyRoot,'find installed dependency closure');dependencyRoot=parent;
 }
 const first={sourceRevision:'a'.repeat(40),version:'0.4.0'},second={sourceRevision:'b'.repeat(40),version:'0.4.0'};
 const current=join(directory,'current'),token='r'.repeat(43),config=join(directory,'config.json');
 async function start(){
  const child=spawn(process.execPath,[join(current,'dist/cli.js'),'serve',config],{stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');let errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  try{
   const [chunk]=await Promise.race([once(child.stdout,'data'),exited.then(value=>{throw new Error('child exited '+JSON.stringify(value)+' '+errors);})]);
   const ready=JSON.parse(chunk.toString());assert.equal(ready.ready,true);
   return {url:ready.url,async close(){child.kill('SIGTERM');assert.deepEqual(await exited,[0,null]);clearTimeout(timer);}};
  }catch(error){child.kill('SIGKILL');await exited;clearTimeout(timer);throw error;}
 }
 const read=async path=>{const r=await fetch(processHandle.url+path,{headers:{authorization:`Bearer ${token}`}});assert.equal(r.status,200);return r.json();};
 try{
  for(const [name,identity] of [['first',first],['second',second]]){
   const release=join(directory,name);await mkdir(release);
   await cp(join(packageRoot,'dist'),join(release,'dist'),{recursive:true});
   await writeFile(join(release,'package.json'),JSON.stringify({type:'module'}));
   await writeFile(join(release,'manifest.json'),JSON.stringify({artifact:'@jimmie-potts/hub',...identity}));
   await symlink(join(dependencyRoot,'node_modules'),join(release,'node_modules'),'dir');
  }
  const state=join(directory,'state');await mkdir(state,{mode:0o700});
  await writeFile(config,JSON.stringify({directory:state,ownerId:'build-owner',consumers:[],controllers:[],port:0,credentials:[{id:'reader',digest:createHash('sha256').update(token).digest('hex'),scopes:['read'],devices:[]}]}),{mode:0o600});
  await symlink(join(directory,'first'),current,'dir');processHandle=await start();
  assert.deepEqual((await read('/api/hub/v1/health')).build,first);
  await writeFile(join(directory,'first','manifest.json'),JSON.stringify({artifact:'@jimmie-potts/hub',sourceRevision:'c'.repeat(40),version:'9.9.9'}));
  await symlink(join(directory,'second'),join(directory,'next'),'dir');await rename(join(directory,'next'),current);
  assert.deepEqual((await read('/api/hub/v1/health')).build,first);
  assert.deepEqual((await read('/api/dashboard/v1/context')).build,first);
  await processHandle.close();processHandle=undefined;processHandle=await start();
  assert.deepEqual((await read('/api/hub/v1/health')).build,second);
  assert.deepEqual((await read('/api/dashboard/v1/context')).build,second);
 }finally{await processHandle?.close();await rm(directory,{recursive:true,force:true});}
});

test('health and context share running identity without weakening read scope or failed health',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-build-'));
 const token='b'.repeat(43),ingest='i'.repeat(43);
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const hub=await startHub({directory,ownerId:'build-owner',consumers:[],controllers:[],credentials:[
  {id:'reader',digest:digest(token),scopes:['read','control','admin'],devices:[]},
  {id:'ingest',digest:digest(ingest),scopes:['ingest'],devices:[]}
 ]});
 const get=(path,credential=token)=>fetch(hub.url+path,{headers:{authorization:`Bearer ${credential}`}});
 try{
  const health=await get('/api/hub/v1/health');assert.equal(health.status,200);
  const value=await health.json();assert.ok(value.build,'health includes running build');
  assert.deepEqual(Object.keys(value.build).sort(),['sourceRevision','version']);
  assert.match(value.build.sourceRevision,/^(?:unknown|[0-9a-f]{40})$/);
  assert.deepEqual((await (await get('/api/dashboard/v1/context')).json()).build,value.build);
  for(const path of ['/api/hub/v1/health','/api/dashboard/v1/context']){
   assert.equal((await fetch(hub.url+path)).status,401);
   assert.equal((await get(path,ingest)).status,403);
  }
  const monitor=await (await get('/api/monitor/v1/sessions')).json();
  const stopped=await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify({operation:'quiesce',requestId:monitor.nextRequestId})});
  assert.equal(stopped.status,200);
  const failed=await get('/api/hub/v1/health');assert.equal(failed.status,503);
  assert.deepEqual((await failed.json()).build,value.build);
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});
