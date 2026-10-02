import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareBackendDirectory} from '../backend-files.mjs';
import {backendCreateRequests} from '../backend-create.mjs';
import {allocateBackend} from '../backend-allocation.mjs';
import {registerHostRoots} from '../host-roots.mjs';
import {cleanupBenchmark} from '../benchmark-cleanup.mjs';
async function fixture(t) {
  const base=await mkdtemp(join(tmpdir(),'bc-')),local=join(base,'.local');await mkdir(local);
  t.after(()=>rm(base,{recursive:true,force:true}));
  const stateParent=join(local,'state');await mkdir(stateParent);const directory=join(local,'run');
  const {plan}=await prepareBackendDirectory(directory,{runId:'cleanup',ports:{grafana:43000,otlp:43001,loki:43002,tempo:43003,health:43004}});
  const states={},effects=[],ids={container:'a'.repeat(64),network:'b'.repeat(64),volume:plan.volumeName};
  const image={Id:'sha256:'+'c'.repeat(64),Size:1024**3,Os:'linux',Architecture:'amd64',RepoDigests:['grafana/otel-lgtm@'+plan.image.split('@')[1]]};
  const backend={
    inspectImage:async()=>image,inspectPlanned:async kind=>states[kind]??null,
    create:async kind=>{
      if(kind==='network')states[kind]={Id:ids.network,Name:plan.networkName,Created:'2026-10-02T00:00:00Z',Labels:plan.labels,
        Driver:'bridge',Scope:'local',Internal:false,Attachable:false,Ingress:false,Containers:{},Options:{}};
      if(kind==='volume')states[kind]={Name:plan.volumeName,CreatedAt:'2026-10-02T00:00:00Z',Driver:'local',Scope:'local',
        Mountpoint:'/docker/owned/_data',Labels:plan.labels,Options:null};
      if(kind==='container'){
        const config=backendCreateRequests(plan).container.body;
        states[kind]={Id:ids.container,Name:'/'+plan.containerName,Image:image.Id,Config:config,HostConfig:config.HostConfig,
          State:{Running:false},Mounts:config.HostConfig.Mounts.map(m=>({...m,Name:m.Type==='volume'?m.Source:undefined,Destination:m.Target,RW:!m.ReadOnly}))};
      }
      return {id:ids[kind],warningCount:0};
    },
    inspect:async kind=>structuredClone(states[kind]??null),
    remove:async(kind,id)=>{assert.equal(id,ids[kind]);effects.push(kind);delete states[kind];},
    stop:async()=>assert.fail('cleanup must not repeat an unconfirmed stop'),
  };
  await allocateBackend({directory,backend,hostProbe:async()=>({ready:true,availableMemoryBytes:16*1024**3,availableDiskBytes:10*1024**3})});
  const roots=await registerHostRoots(directory,stateParent);
  return {directory,backend,states,effects,roots,base};
}
test('completed benchmark cleanup removes only registered resources and retains raw evidence and unrelated state',async t=>{
  const f=await fixture(t);await writeFile(join(f.directory,'workload.jsonl'),'');
  await writeFile(join(f.base,'unrelated'),'keep');
  const result=await cleanupBenchmark({...f,teardownStartedNs:String(process.hrtime.bigint())});
  assert.equal(result.complete,true);assert.equal(result.syntheticStateRemoved,true);assert.ok(result.teardownMs>=0);
  assert.deepEqual(f.effects,['container','network','volume']);
  assert.equal(await readFile(join(f.base,'unrelated'),'utf8'),'keep');
  assert.equal(await readFile(join(f.directory,'workload.jsonl'),'utf8'),'');
  await assert.rejects(readFile(join(f.roots.roots.state.path,'observability-owner.json')),{code:'ENOENT'});
});
test('a running backend or live recorded application prevents cleanup effects',async t=>{
  for(const mode of ['backend','application']) {
    const f=await fixture(t);
    if(mode==='backend')f.states.container.State.Running=true;
    else await writeFile(join(f.directory,'workload.jsonl'),JSON.stringify({event:{kind:'application-start',identity:{pid:process.pid}}})+'\n');
    await assert.rejects(cleanupBenchmark(f),/unconfirmed/);assert.deepEqual(f.effects,[]);
    assert.ok(await readFile(join(f.roots.roots.state.path,'observability-owner.json')));
  }
});
test('foreign container identity prevents removal; unknown synthetic state is retained',async t=>{
  const foreign=await fixture(t);foreign.states.container.Image='sha256:'+'d'.repeat(64);
  await assert.rejects(cleanupBenchmark(foreign),/ownership/);assert.deepEqual(foreign.effects,[]);
  const extra=await fixture(t);await writeFile(join(extra.roots.roots.state.path,'unrelated'),'keep');
  await assert.rejects(cleanupBenchmark(extra),/unknown resources/);
  assert.equal(await readFile(join(extra.roots.roots.state.path,'unrelated'),'utf8'),'keep');
});
