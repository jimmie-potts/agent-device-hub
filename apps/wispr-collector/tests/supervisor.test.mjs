import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { supervise,requestStop } from '../dist/supervisor.js';
import { acquireLease } from '../dist/lease.js';
function setup(t){const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'supervisor-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function worker(dir,body){const path=join(dir,'worker.mjs');writeFileSync(path,`process.on('message',async m=>{${body}});`);return pathToFileURL(path);}
const waitFor=async pred=>{const end=Date.now()+4000;while(!pred()){if(Date.now()>end)throw Error('fixture-timeout');await new Promise(r=>setTimeout(r,10));}};
test('deadline kills blocked synchronous work and releases ownership only after exit',async t=>{
 const directory=setup(t),entry=worker(directory,`process.send({type:'phase',phase:'reading'});while(true){}`);
 await assert.rejects(supervise({directory,entry,payload:{},readDeadlineMs:100,runDeadlineMs:2000}),/source-deadline/);
 acquireLease(directory).release();assert.equal(existsSync(join(directory,'run.json')),false);
});
test('clear cancellation stops an overlapping run and permits the next owner',async t=>{
 const directory=setup(t),entry=worker(directory,`process.send({type:'phase',phase:'processing'});while(true){}`);
 const running=supervise({directory,entry,payload:{},runDeadlineMs:3000});
 const rejected=assert.rejects(running,/run-cancelled/);
 await waitFor(()=>existsSync(join(directory,'run.json')));
 await requestStop(directory,2000);await rejected;
 acquireLease(directory).release();
});
test('full run deadline also covers processing after a completed read',async t=>{
 const directory=setup(t),entry=worker(directory,`process.send({type:'phase',phase:'reading'});process.send({type:'phase',phase:'processing'});while(true){}`);
 await assert.rejects(supervise({directory,entry,payload:{},readDeadlineMs:100,runDeadlineMs:250}),/run-deadline/);
});
test('worker errors are sanitized and success waits for process exit',async t=>{
 const directory=setup(t);
 const bad=worker(directory,`process.send({type:'failure',code:'PRIVATE SECRET'});process.exit(1);`);
 await assert.rejects(supervise({directory,entry:bad,payload:{}}),/^Error: run-failed$/);
 const good=worker(directory,`process.send({type:'success',result:{revision:3}});process.exit(0);`);
 assert.deepEqual(await supervise({directory,entry:good,payload:{}}),{revision:3});acquireLease(directory).release();
});
test('a surviving worker retains ownership after its supervisor dies',async t=>{
 const {spawn}=await import('node:child_process');
 const directory=setup(t),entry=join(directory,'orphan-worker.mjs'),ready=join(directory,'ready');
 writeFileSync(entry,`import {acquireLease} from ${JSON.stringify(new URL('../dist/lease.js',import.meta.url).href)};import {writeFileSync} from 'node:fs';process.once('disconnect',()=>process.exit(0));process.on('message',m=>{const guard=acquireLease(m.directory,'worker-lease.sqlite');writeFileSync(m.ready,'ready');const end=Date.now()+1500;while(Date.now()<end){};guard.release();});`);
 const parentFile=join(directory,'parent.mjs');writeFileSync(parentFile,`import {supervise} from ${JSON.stringify(new URL('../dist/supervisor.js',import.meta.url).href)};await supervise({directory:process.argv[2],entry:new URL(process.argv[3]),payload:{directory:process.argv[2],ready:process.argv[4]}});`);
 const parent=spawn(process.execPath,[parentFile,directory,pathToFileURL(entry).href,ready],{stdio:'ignore'}),closed=new Promise(resolve=>parent.once('close',resolve));
 try{
   await waitFor(()=>existsSync(ready));parent.kill();await closed;
   let unexpected;try{assert.throws(()=>{unexpected=acquireLease(directory,'worker-lease.sqlite');},/collector-busy/);}finally{unexpected?.release();}
   await requestStop(directory,5000);acquireLease(directory).release();acquireLease(directory,'worker-lease.sqlite').release();
 }finally{parent.kill();await closed;await requestStop(directory,5000);}
});
