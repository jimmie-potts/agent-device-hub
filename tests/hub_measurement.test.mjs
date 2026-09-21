import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('measurement retains signal failures and cleans disposable stores',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-diagnostic-test-'));const output=join(directory,'receipt.json');
 const runner=spawn(process.execPath,[new URL('../scripts/measure-hub.mjs',import.meta.url).pathname,output],{env:{...process.env,TMPDIR:directory},stdio:'ignore'});
 const exited=once(runner,'exit');let checking=false;
 const interrupt=setInterval(async()=>{
  if(checking)return;checking=true;
  try{
   // Only direct children of this test-owned runner are eligible.
   const children=await readFile(`/proc/${runner.pid}/task/${runner.pid}/children`,'utf8');
   for(const pid of children.trim().split(/\s+/).filter(value=>/^\d+$/.test(value)))try{process.kill(Number(pid),'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  }catch(error){if(error.code!=='ENOENT')runner.kill('SIGKILL');}finally{checking=false;}
 },10);
 const deadline=setTimeout(()=>runner.kill('SIGKILL'),10000);
 try{
  const [code,signal]=await exited;assert.equal(signal,null);assert.equal(code,1);
  const report=JSON.parse(await readFile(output,'utf8'));assert.equal(report.complete,false);assert.equal(report.profiles.length,9);
  assert.ok(report.profiles.every(profile=>profile.failures.length>0));
  assert.deepEqual(await readdir(directory),['receipt.json']);
 }finally{clearInterval(interrupt);clearTimeout(deadline);await rm(directory,{recursive:true,force:true});}
});
