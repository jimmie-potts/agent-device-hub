import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';

test('source CLI starts only explicit private configuration and shuts down on SIGTERM',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-process-'));let child;
 try {
  const store=join(directory,'state');await mkdir(store,{mode:0o700});
  const token='d'.repeat(43),config=join(directory,'config.json');
  await writeFile(config,JSON.stringify({directory:store,ownerId:'owner',consumers:[],controllers:[],port:0,credentials:[{id:'reader',digest:createHash('sha256').update(token).digest('hex'),scopes:['read'],devices:[]}]}),{mode:0o600});
  child=spawn(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname,'serve',config],{stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
  try {
   const [chunk]=await Promise.race([once(child.stdout,'data'),exited.then(result=>{throw new Error('CLI exited before readiness: '+JSON.stringify(result));})]);const ready=JSON.parse(chunk.toString());assert.equal(ready.ready,true);
   const response=await fetch(ready.url+'/api/hub/v1/health',{headers:{authorization:`Bearer ${token}`}});assert.equal(response.status,200);
   child.kill('SIGTERM');assert.deepEqual(await exited,[0,null]);
  }finally{clearTimeout(timer);}
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await rm(directory,{recursive:true,force:true});}
});


test('SIGTERM the instant the hub announces readiness closes cleanly ten times',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-ready-stop-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=join(directory,'state');await mkdir(store,{mode:0o700});
 const config=join(directory,'config.json');
 await writeFile(config,JSON.stringify({directory:store,ownerId:'owner',consumers:[],controllers:[],port:0,credentials:[{id:'reader',digest:createHash('sha256').update('d'.repeat(43)).digest('hex'),scopes:['read'],devices:[]}]}),{mode:0o600});
 for(let run=0;run<10;run++){
  const child=spawn(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname,'serve',config],{stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');
  const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
  let stdout='',signalled=false;
  child.stdout.on('data',chunk=>{
   stdout+=chunk;
   if(!signalled&&stdout.includes('"ready":true')){signalled=true;child.kill('SIGTERM');}
  });
  try{
   assert.deepEqual(await closed,[0,null],`run ${run}`);
   assert.equal(signalled,true,`run ${run} reached readiness`);
   assert.equal(JSON.parse(stdout).ready,true);
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
 }
});


for(const signal of ['SIGINT','SIGTERM']) test(`${signal} during hub startup is honored after startup finishes`,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-start-stop-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=join(directory,'state');await mkdir(store,{mode:0o700});
 const config=join(directory,'config.json');
 await writeFile(config,JSON.stringify({directory:store,ownerId:'owner',consumers:[],controllers:[],port:0,credentials:[{id:'reader',digest:createHash('sha256').update('d'.repeat(43)).digest('hex'),scopes:['read'],devices:[]}]}),{mode:0o600});
 const child=spawn(process.execPath,['--experimental-test-module-mocks','--import',new URL('./startup-signal-fixture.mjs',import.meta.url).href,new URL('../dist/cli.js',import.meta.url).pathname,'serve',config],{env:{...process.env,TEST_START_SIGNAL:signal},stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');
 const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
 let stdout='';child.stdout.on('data',chunk=>{stdout+=chunk;});
 try{
  assert.deepEqual(await closed,[0,null]);
  assert.equal(JSON.parse(stdout).ready,true);
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
});
