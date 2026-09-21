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
