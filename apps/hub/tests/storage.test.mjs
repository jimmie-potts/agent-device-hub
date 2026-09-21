import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, chmod, symlink} from 'node:fs/promises';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentState} from '@jimmie-potts/agent-state';
import {HubStorage} from '../dist/storage.js';

const identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'};
const event={apiVersion:'1.0',identity,turn:{status:'known',id:'turn'},parent:{status:'unknown'},
  event:{kind:'session.started'},observedAtMs:1000,ordering:{status:'unknown'}};
const consumers=[{id:'pixoo',clearOnNewTurn:true}];
test('exclusive ownership, durable labels and restart uncertainty',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-store-'));
  let owner;
  try {
    owner=await createAgentState({storage:new HubStorage(directory),ownerId:'owner',consumers});
    assert.equal((await owner.ingest(event)).ok,true);
    assert.equal((await owner.setLabel(identity,'Chosen label')).ok,true);
    const revision=owner.snapshot().revision;
    await assert.rejects(createAgentState({storage:new HubStorage(directory),ownerId:'owner',consumers}));
    await owner.shutdown();
    owner=await createAgentState({storage:new HubStorage(directory),ownerId:'owner',consumers});
    assert.equal(owner.snapshot().revision,revision);
    assert.equal(owner.snapshot().sessions[0].label,'Chosen label');
    assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  } finally {await owner?.shutdown();await rm(directory,{recursive:true,force:true});}
});

test('lease excludes another process and fences survive release',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-lease-'));
  const signal=new AbortController().signal;
  let lease;
  try {
    lease=await new HubStorage(directory).acquire('owner',signal);
    lease.setFence(true);
    const code=`import {HubStorage} from ${JSON.stringify(new URL('../dist/storage.js',import.meta.url).href)}; try { const l=await new HubStorage(process.argv[1]).acquire('owner',new AbortController().signal);await l.release();process.exit(2); } catch { process.exit(0); }`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code,directory],{encoding:'utf8',timeout:5000});
    assert.equal(child.status,0,child.stderr);
    await assert.rejects(new HubStorage(directory).acquire('owner',signal));
    const afterSameProcess=spawnSync(process.execPath,['--input-type=module','-e',code,directory],{encoding:'utf8',timeout:5000});
    assert.equal(afterSameProcess.status,0,'Failed same-process acquisition must not release the original OS lease');
    await lease.release();
    lease=await new HubStorage(directory).acquire('owner',signal);
    assert.equal(lease.fenced(),true);
    lease.setFence(false);
    assert.equal(lease.fenced(),false);
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(lease.load(aborted.signal));
    await assert.rejects(lease.commit({expectedRevision:1,revision:2,atMs:0,pruneBeforeMs:0},signal),/revision-conflict/);
    assert.equal(await lease.load(signal),null);
  } finally {await lease?.release();await rm(directory,{recursive:true,force:true});}
});

test('public directories and symlinked storage are refused',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-private-'));
  const link=directory+'-link';
  try {
    await chmod(directory,0o755);
    await assert.rejects(new HubStorage(directory).acquire('owner',new AbortController().signal),/invalid-store/);
    await chmod(directory,0o700);await symlink(directory,link);
    await assert.rejects(new HubStorage(link).acquire('owner',new AbortController().signal),/invalid-store/);
  } finally {await rm(link,{force:true});await rm(directory,{recursive:true,force:true});}
});

test('process death releases the lease and leaves a complete committed revision',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-crash-'));let child,owner;
 try {
  const module=new URL('../dist/storage.js',import.meta.url).href;
  const code=`import {HubStorage} from ${JSON.stringify(module)};import {createAgentState} from '@jimmie-potts/agent-state';const o=await createAgentState({storage:new HubStorage(process.argv[1]),ownerId:'owner',consumers:${JSON.stringify(consumers)}});await o.ingest(${JSON.stringify(event)});process.stdout.write('ready\\n');for(let n=0;n<10000;n++)await o.setLabel(${JSON.stringify(identity)},'label-'+n);setInterval(()=>{},1000);`;
  child=spawn(process.execPath,['--input-type=module','-e',code,directory],{stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');const killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
  try {await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw new Error('child exited before readiness');})]);child.kill('SIGKILL');await exited;}finally{clearTimeout(killTimer);}
  owner=await createAgentState({storage:new HubStorage(directory),ownerId:'owner',consumers});
  assert.ok(owner.snapshot().revision>=1);assert.equal(owner.snapshot().sessions.length,1);
  assert.equal(owner.snapshot().sessions[0].restartUncertain,true);
  if(owner.snapshot().sessions[0].label)assert.match(owner.snapshot().sessions[0].label,/^label-\d+$/);
 }finally{if(child?.exitCode===null&&child?.signalCode===null)child.kill('SIGKILL');await owner?.shutdown();await rm(directory,{recursive:true,force:true});}
});


test('failed commits and caller mutation cannot alter durable state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-rollback-'));let owner,lease;
 const signal=new AbortController().signal;
 try{
  owner=await createAgentState({storage:new HubStorage(directory),ownerId:'owner',consumers});await owner.ingest(event);await owner.shutdown();owner=undefined;
  lease=await new HubStorage(directory).acquire('owner',signal);const initial=await lease.load(signal);
  const change={expectedRevision:initial.revision,revision:initial.revision+1,atMs:initial.lastCommitAtMs,pruneBeforeMs:0,session:{...initial.sessions[0],label:'Changed'}};
  await assert.rejects(lease.commit({...change,atMs:-1},signal),/invalid-state/);
  assert.deepEqual(await lease.load(signal),initial);
  await lease.commit(change,signal);const read=await lease.load(signal);assert.equal(read.sessions[0].label,'Changed');
  read.sessions[0].label='Caller mutation';assert.equal((await lease.load(signal)).sessions[0].label,'Changed');
  await lease.release();lease=await new HubStorage(directory).acquire('owner',signal);assert.equal((await lease.load(signal)).sessions[0].label,'Changed');
 }finally{await owner?.shutdown();await lease?.release();await rm(directory,{recursive:true,force:true});}
});
