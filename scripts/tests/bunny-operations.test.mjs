import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withOperation, reconcileOperation, readPending} from '../bunny-operations.mjs';
async function fixture(t) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'bunny-operations-'));
  t.after(()=>rm(root,{recursive:true,force:true}));return {root,project:'synthetic'};
}
test('one operation excludes all other writers and records actual release',async t=>{
  const p=await fixture(t);let release;
  const entered=new Promise(resolve=>{release=resolve;});
  let done;const held=withOperation(p,async()=>{release();await new Promise(resolve=>{done=resolve;});return 'ok';});
  await entered;await assert.rejects(withOperation(p,()=>assert.fail('overlap')));
  done();assert.equal(await held,'ok');
  assert.equal(await withOperation(p,()=>42),42);
});
test('pending effects survive failure and manual maintenance refuses until explicit reconciliation',async t=>{
  const p=await fixture(t);
  await assert.rejects(withOperation(p,async lease=>{await lease.record({id:'batch-1',phase:'stopping',outcome:'uncertain'});throw Error('interrupted');}));
  assert.equal((await readPending(p)).phase,'stopping');
  await assert.rejects(withOperation(p,()=>assert.fail('pending bypass')));
  const result=await reconcileOperation(p,async()=>({id:'a'.repeat(64),status:'exited',pid:0}));
  assert.equal(result.outcome,'reconciled');
  assert.equal((await readPending(p)),undefined);
  assert.equal(await withOperation(p,()=>7),7);
});
test('reconciliation uses the same exclusion as a live normal operation',async t=>{
  const p=await fixture(t);
  await withOperation(p,async lease=>{
    await lease.record({id:'batch-live',phase:'starting',outcome:'uncertain'});
    await assert.rejects(reconcileOperation(p,()=>assert.fail('must not inspect a live operation')));
  });
});
test('a killed process leaves the last durable phase until explicit unfinished-operation reconciliation',async t=>{
  const p=await fixture(t);const {spawn}=await import('node:child_process');
  const moduleUrl=new URL('../bunny-operations.mjs',import.meta.url).href;
  const program=`import{withOperation}from ${JSON.stringify(moduleUrl)};await withOperation(${JSON.stringify(p)},async lease=>{await lease.record({id:'batch-killed',phase:'creating-replacement',outcome:'uncertain'});process.stdout.write('durable\\n');setInterval(()=>{},1000);await new Promise(()=>{});});`;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==null)reject(Error('child exited before durable phase'));});});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  assert.equal((await readPending(p)).phase,'creating-replacement');
  await assert.rejects(withOperation(p,()=>assert.fail('dead owner was not reconciled')));
  const result=await reconcileOperation(p,async()=>({status:'created',pid:0}));
  assert.ok(result.writerReleasedAt);assert.equal(result.observation.status,'created');
});
test('malformed persisted operation identity refuses reconciliation without an out-of-records write',async t=>{
  const p=await fixture(t);
  await writeFile(join(p.root,'synthetic.pending.json'),JSON.stringify({id:'../escaped',phase:'starting',outcome:'uncertain'}),{mode:0o600});
  await assert.rejects(reconcileOperation(p,async()=>({status:'exited',pid:0})));
  await assert.rejects(readFile(join(p.root,'escaped.json')),{code:'ENOENT'});
});
test('reconciliation still excludes a new writer if a pending path disappears during its inspection',async t=>{
  const p=await fixture(t);
  await assert.rejects(withOperation(p,async lease=>{await lease.record({id:'batch-old',phase:'starting',outcome:'uncertain'});throw Error('stopped');}));
  const original=await readPending(p);let entered,finish;
  const started=new Promise(resolve=>{entered=resolve;});
  const reconciling=reconcileOperation(p,async()=>{entered();await new Promise(resolve=>{finish=resolve;});return {status:'exited',pid:0};});
  await started;
  const {unlink}=await import('node:fs/promises');await unlink(join(p.root,'synthetic.pending.json'));
  await assert.rejects(withOperation(p,async lease=>{await lease.record({id:'batch-new',phase:'starting',outcome:'uncertain'});}));
  await writeFile(join(p.root,'synthetic.pending.json'),JSON.stringify(original),{mode:0o600});
  finish();await reconciling;
  await withOperation(p,async lease=>{await lease.record({id:'batch-new',phase:'starting',outcome:'uncertain'});});
  assert.equal((await readPending(p)).id,'batch-new');
});
