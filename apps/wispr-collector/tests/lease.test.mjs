import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLease } from '../dist/lease.js';

function setup(t){const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'lease-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('one collector owns the lease and release permits the next run',t=>{
  const directory=setup(t),first=acquireLease(directory);
  try{assert.throws(()=>acquireLease(directory),/collector-busy/);}finally{first.release();}
  acquireLease(directory).release();
});
test('a process crash releases the lease without stale PID takeover',async t=>{
  const directory=setup(t);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {acquireLease} from ${JSON.stringify(new URL('../dist/lease.js',import.meta.url).href)}; const lease=acquireLease(process.argv[1]);console.log('ready');setInterval(()=>{},1000);`,directory],{stdio:['ignore','pipe','ignore']});
  const closed=new Promise(resolve=>child.on('close',resolve));
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  assert.throws(()=>acquireLease(directory),/collector-busy/);
  child.kill();await closed;
  acquireLease(directory).release();
});
