import test from 'node:test';
import assert from 'node:assert/strict';
import {operate, maintain, parse, privateHostDirectory} from '../bunny.mjs';

const id='1'.repeat(64), image='sha256:'+'2'.repeat(64), revision='3'.repeat(40);
function fixture() {
  const info={Id:id,Image:image,State:{Status:'exited',Running:false,Restarting:false,Pid:0},
    Config:{User:'1000:1000',Labels:{'com.docker.compose.project':'synthetic','com.docker.compose.service':'core'}},
    HostConfig:{RestartPolicy:{Name:'no'},PortBindings:{},NetworkMode:'none'},NetworkSettings:{Networks:{}},
    Mounts:[['state','/var/lib/bunny',true],['config','/etc/bunny',false],['secrets','/run/secrets/bunny',false]].map(([Name,Destination,RW])=>({Type:'volume',Name,Destination,RW}))};
  const calls=[];
  return {info,calls,run:async args=>{
    calls.push(args);
    if(args[0]==='ps')return id;
    if(args[0]==='inspect')return JSON.stringify([info]);
    if(args[0]==='volume')return JSON.stringify([{Name:args[2],Driver:'local',Scope:'local',Options:null}]);
    if(args[0]==='image')return JSON.stringify([{Config:{Labels:{'org.opencontainers.image.revision':revision}}}]);
    if(args[0]==='run')return JSON.stringify({operation:args.includes('worker-backup')?'backup':'restore',status:'complete',files:2});
    if(args[0]==='start'){Object.assign(info.State,{Status:'running',Running:true,Pid:101});return id;}
    if(args[0]==='stop'){Object.assign(info.State,{Status:'exited',Running:false,Pid:0});return id;}
    throw new Error('unexpected command');
  }};
}
const plan=command=>parse([command,...(['backup','restore'].includes(command)?['/private/backups/snapshot']:[]),'--project','synthetic']);
test('arguments require an exact project, fixed operation and no arbitrary worker flags',()=>{
  for(const args of [[],['start'],['delete','--project','synthetic'],['start','--project','x;bad'],['start','extra','--project','synthetic'],['worker-backup','--revision',revision,'--destination','/backup','--project','x']])assert.throws(()=>parse(args));
});

function localFixture(profile = 'host-local') {
  const f=fixture(), networkId='a'.repeat(64);
  Object.assign(f.info.Config.Labels,{'io.bunny.access':profile});
  f.info.Config.Env=['BUNNY_ACCESS='+profile,'BUNNY_CONTROL=disabled','BUNNY_PORT=18788'];
  f.info.HostConfig.NetworkMode='synthetic_local';
  Object.assign(f.info.HostConfig, {ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true']});
  f.info.HostConfig.PortBindings={'18788/tcp':[{HostIp:'127.0.0.1',HostPort:'18788'}]};
  f.info.NetworkSettings.Networks={synthetic_local:{NetworkID:networkId}};
  const network={Id:networkId,Name:'synthetic_local',Driver:'bridge',Scope:'local',Internal:false,Attachable:false,EnableIPv6:false,
    Labels:{'com.docker.compose.project':'synthetic','com.docker.compose.network':'local'},Options:{},Containers:{}};
  const run=async args=>{
    if(args[0]==='network'){f.calls.push(args);return JSON.stringify([network]);}
    const result=await f.run(args);
    if(args[0]==='start')f.info.NetworkSettings.Ports={'18788/tcp':[{HostIp:'127.0.0.1',HostPort:'18788'}]};
    return result;
  };
  return {...f,network,run};
}

test('production operator accepts explicit control and refuses unsafe mounts and extra listeners before start', async () => {
  const allowed = localFixture('production');
  allowed.info.Config.Env[1] = 'BUNNY_CONTROL=enabled';
  assert.equal((await operate(plan('start'), allowed.run)).status, 'running');
  const disabled = localFixture('production');
  assert.equal((await operate(plan('start'), disabled.run)).status, 'running');
  for (const mutate of [
    f => {f.info.Config.Env[1] = 'BUNNY_CONTROL=yes';},
    f => {f.info.Mounts.push({Type: 'bind', Source: '/private/host', Destination: '/host', RW: true});},
    f => {f.info.HostConfig.Privileged = true;},
    f => {f.info.HostConfig.ReadonlyRootfs = false;},
    f => {f.info.HostConfig.CapAdd = ['NET_ADMIN'];},
    f => {f.info.HostConfig.CapDrop = [];},
    f => {f.info.HostConfig.SecurityOpt = [];},
    f => {f.info.HostConfig.Devices = [{PathOnHost: '/dev/synthetic'}];},
    f => {f.info.HostConfig.PortBindings['1234/tcp'] = [{HostIp: '0.0.0.0', HostPort: '1234'}];},
  ]) {
    const f = localFixture('production'); mutate(f);
    await assert.rejects(operate(plan('start'), f.run));
    assert.ok(!f.calls.some(args => args[0] === 'start'));
  }
});

test('production operator bounds the optional Pixoo binding and checks its effective publication', async () => {
  const create = () => {
    const f = localFixture('production');
    f.info.Config.Env[1] = 'BUNNY_CONTROL=enabled';
    f.info.Config.Env.push('BUNNY_PIXOO_BIND=192.168.1.10');
    f.info.HostConfig.PortBindings['41240/tcp'] = [{HostIp: '192.168.1.10', HostPort: '41240'}];
    const run = async args => {
      const result = await f.run(args);
      if (args[0] === 'start') f.info.NetworkSettings.Ports['41240/tcp'] = [{HostIp: '192.168.1.10', HostPort: '41240'}];
      return result;
    };
    return {...f, run};
  };
  const allowed = create();
  assert.equal((await operate(plan('start'), allowed.run)).status, 'running');
  for (const mutate of [
    f => {f.info.HostConfig.PortBindings['41240/tcp'][0].HostIp = '0.0.0.0';},
    f => {f.info.HostConfig.PortBindings['41240/tcp'][0].HostPort = '41241';},
    f => {f.info.Config.Env[1] = 'BUNNY_CONTROL=disabled';},
    f => {f.info.Config.Env.push('BUNNY_PIXOO_BIND=192.168.1.10');},
  ]) {
    const f = create(); mutate(f);
    await assert.rejects(operate(plan('start'), f.run));
    assert.ok(!f.calls.some(args => args[0] === 'start'));
  }
  const widened = create();
  await assert.rejects(operate(plan('start'), async args => {
    const result = await widened.run(args);
    if (args[0] === 'start') widened.info.NetworkSettings.Ports['41240/tcp'][0].HostIp = '0.0.0.0';
    return result;
  }));
  assert.ok(widened.calls.some(args => args[0] === 'stop'));
});

test('private proxy operations keep loopback publication, selected networks and matching profile labels',async()=>{
  const allowed=localFixture('private-proxy');
  assert.equal((await operate(plan('start'),allowed.run)).status,'running');
  for(const mutate of [
    f=>f.info.Config.Labels['io.bunny.access']='host-local',
    f=>f.info.HostConfig.PortBindings['18788/tcp'][0].HostIp='0.0.0.0',
    f=>f.info.Config.Env[1]='BUNNY_CONTROL=enabled',
    f=>f.network.Containers['b'.repeat(64)]={},
  ]) {
    const f=localFixture('private-proxy');mutate(f);
    await assert.rejects(operate(plan('start'),f.run));
    assert.ok(!f.calls.some(a=>a[0]==='start'));
  }
  const widened=localFixture('private-proxy');
  await assert.rejects(operate(plan('start'),async args=>{
    const result=await widened.run(args);
    if(args[0]==='start')widened.info.NetworkSettings.Ports['18788/tcp'][0].HostIp='0.0.0.0';
    return result;
  }));
  assert.ok(widened.calls.some(a=>a[0]==='stop'));
});

test('explicit host-local profile retains stopped backup with network-none maintenance',async()=>{
  const f=localFixture();await operate(parse(['backup','snapshot-1','--archive-volume','archives','--project','synthetic']),f.run);
  assert.deepEqual(f.calls.find(a=>a[0]==='network'),['network','inspect','synthetic_local']);
  assert.ok(f.calls.find(a=>a[0]==='run').includes('--network=none'));
});

test('host-local start and backup refuse widened bindings, devices and unexpected or shared networks before effects',async()=>{
  for(const mutate of [
    f=>f.info.HostConfig.PortBindings['18788/tcp'][0].HostIp='0.0.0.0',
    f=>f.info.HostConfig.PortBindings['18788/tcp'][0].HostIp='::1',
    f=>f.info.HostConfig.PortBindings['18788/tcp'][0].HostPort='8788',
    f=>f.info.HostConfig.PortBindings['18788/udp']=[],
    f=>f.info.HostConfig.PortBindings['18788/tcp'].push({HostIp:'127.0.0.1',HostPort:'18789'}),
    f=>f.info.Config.Env[1]='BUNNY_CONTROL=enabled',
    f=>f.info.Config.Env.push('BUNNY_CONTROL=enabled'),
    f=>f.info.HostConfig.NetworkMode='host',
    f=>f.info.NetworkSettings.Networks.unrelated={},
    f=>f.network.Internal=true,
    f=>f.network.Attachable=true,
    f=>f.network.EnableIPv6=true,
    f=>f.network.Containers['b'.repeat(64)]={},
    f=>f.network.Labels['com.docker.compose.project']='other',
  ]) for(const command of ['start','backup']) {
    const f=localFixture();mutate(f);
    const selected=command==='backup' ? parse(['backup','snapshot-1','--archive-volume','archives','--project','synthetic']) : plan(command);
    await assert.rejects(operate(selected,f.run));
    assert.ok(!f.calls.some(a=>['start','run'].includes(a[0])));
  }
});

test('host-local start checks its actual network before and after starting',async()=>{
  const f=localFixture();assert.equal((await operate(plan('start'),f.run)).status,'running');
  assert.equal(f.calls.filter(a=>a[0]==='network').length,2);
  assert.ok(f.calls.findIndex(a=>a[0]==='network') < f.calls.findIndex(a=>a[0]==='start'));
});

test('host-local producer selection is explicit and refuses malformed or duplicate sources before effects',async()=>{
  const source='bunny/parts/hub-'+'1'.repeat(32);
  const allowed=localFixture();allowed.info.Config.Env.push('BUNNY_INGEST_SOURCE='+source);
  assert.equal((await operate(plan('start'),allowed.run)).status,'running');
  for(const entries of [
    ['BUNNY_INGEST_SOURCE='],['BUNNY_INGEST_SOURCE=bunny/core'],
    ['BUNNY_INGEST_SOURCE=bunny/modules/codex-desktop'],['BUNNY_INGEST_SOURCE='+source+'\n'],
    ['BUNNY_INGEST_SOURCE='+source,'BUNNY_INGEST_SOURCE='+source],
  ]) {
    const f=localFixture();f.info.Config.Env.push(...entries);
    await assert.rejects(operate(plan('start'),f.run));
    assert.ok(!f.calls.some(args=>args[0]==='start'));
  }
  const isolated=fixture();isolated.info.Config.Env=['BUNNY_INGEST_SOURCE='+source];
  await assert.rejects(operate(plan('start'),isolated.run));
  assert.ok(!isolated.calls.some(args=>args[0]==='start'));
});

test('host-local start stops the owned profile when effective publication is absent or widened',async()=>{
  for(const ports of [{},{'18788/tcp':[]},{'18788/tcp':[{HostIp:'0.0.0.0',HostPort:'18788'}]},
    {'18788/tcp':[{HostIp:'::1',HostPort:'18788'}]},{'18788/tcp':[{HostIp:'127.0.0.1',HostPort:'18789'}]},
    {'18788/tcp':[{HostIp:'127.0.0.1',HostPort:'18788'},{HostIp:'0.0.0.0',HostPort:'18788'}]},
    {'18788/tcp':[{HostIp:'127.0.0.1',HostPort:'18788'}],'18788/udp':[]},
  ]) for(const alreadyRunning of [false,true]) {
    const f=localFixture();
    if(alreadyRunning)Object.assign(f.info.State,{Status:'running',Running:true,Pid:101});
    f.info.NetworkSettings.Ports=ports;
    const run=async args=>{
      const result=await f.run(args);
      if(args[0]==='start')f.info.NetworkSettings.Ports=ports;
      return result;
    };
    await assert.rejects(operate(plan('start'),run));
    assert.ok(f.calls.some(a=>a[0]==='stop'));
    assert.equal(f.info.State.Pid,0);
  }
});

test('host-local accepts only Docker generated explicit IPv4 enablement',async()=>{
  for(const Options of [{},null,{'com.docker.network.enable_ipv4':'true'}]) {
    const f=localFixture();f.network.Options=Options;
    assert.equal((await operate(plan('start'),f.run)).status,'running');
    assert.equal(f.calls.filter(a=>a[0]==='network').length,2);
    await operate(plan('stop'),f.run);
    assert.equal((await operate(parse(['backup','snapshot','--archive-volume','archives','--project','synthetic']),f.run)).status,'complete');
  }
});

test('host-local refuses changed IPv4 values and every other bridge option before effects',async()=>{
  for(const Options of [
    {'com.docker.network.enable_ipv4':'false'},
    {'com.docker.network.enable_ipv4':true},
    {'com.docker.network.enable_ipv4':'1'},
    {'com.docker.network.bridge.host_binding_ipv4':'0.0.0.0'},
    {'com.docker.network.enable_ipv4':'true','com.docker.network.bridge.enable_icc':'true'},
  ]) for(const command of ['start','backup']) {
    const f=localFixture();f.network.Options=Options;
    const selected=command==='start' ? plan('start') : parse(['backup','snapshot','--archive-volume','archives','--project','synthetic']);
    await assert.rejects(operate(selected,f.run));
    assert.ok(f.calls.some(a=>a[0]==='network'));
    assert.ok(!f.calls.some(a=>['start','run'].includes(a[0])));
  }
});

test('new-container admission inspects created configuration before start and stops on an isolation change',async()=>{
  const f=localFixture();let created=false;
  const run=async args=>{
    if(args[0]==='ps'&&!created){f.calls.push(args);return '';}
    if(args[0]==='compose'){f.calls.push(args);assert.ok(args.includes('create'));created=true;return '';}
    const result=await f.run(args);
    if(args[0]==='start') f.network.Internal=true;
    return result;
  };
  await assert.rejects(operate(plan('start'),run));
  assert.ok(f.calls.some(a=>a[0]==='stop'));
  assert.equal(f.info.State.Pid,0);
});

test('stop remains available for a misconfigured owned profile',async()=>{
  const f=localFixture();Object.assign(f.info.State,{Status:'running',Running:true,Pid:101});
  f.info.HostConfig.PortBindings['18788/tcp'][0].HostIp='0.0.0.0';
  assert.equal((await operate(plan('stop'),f.run)).status,'stopped');
});
test('backup uses stopped ID, exact image, same volumes, private output and isolated helper',async()=>{
  const f=fixture(), paths=[]; await operate(plan('backup'),f.run,async p=>paths.push(p));
  assert.deepEqual(paths,['/private/backups']);
  const args=f.calls.find(a=>a[0]==='run');
  assert.ok(args.includes(image));assert.ok(args.includes('--read-only'));assert.ok(args.includes('--network=none'));assert.ok(args.includes('never'));
  assert.ok(args.includes('type=volume,source=state,target=/var/lib/bunny'));
  assert.ok(args.includes('type=volume,source=config,target=/etc/bunny,readonly'));
  assert.ok(args.includes('type=bind,source=/private/backups,target=/backup'));
  assert.deepEqual(args.slice(-5),['worker-backup','--destination','/backup/snapshot','--revision',revision]);
});
for(const state of ['running','restarting','paused','dead'])test(`backup refuses ${state} without launching a worker`,async()=>{
  const f=fixture();f.info.State.Status=state;await assert.rejects(operate(plan('backup'),f.run,async()=>{}));assert.ok(!f.calls.some(a=>a[0]==='run'));
});
test('restart actor, published port, wrong owner and writable configuration refuse',async()=>{
  for(const change of [i=>i.HostConfig.RestartPolicy.Name='always',i=>i.HostConfig.PortBindings.x=[],i=>i.Config.User='root',i=>i.Mounts[1].RW=true]){
    const f=fixture();change(f.info);await assert.rejects(operate(plan('backup'),f.run,async()=>{}));assert.ok(!f.calls.some(a=>a[0]==='run'));
  }
});
test('ambiguous project selection refuses',async()=>{
  await assert.rejects(operate(plan('stop'),async()=>id+'\n'+'4'.repeat(64)));
});
test('stop verifies the same container stopped and start reports health separately',async()=>{
  const f=fixture();const result=await operate(plan('start'),f.run);assert.equal(result.health,'not-checked');
  assert.equal((await operate(plan('stop'),f.run)).status,'stopped');
  assert.deepEqual(f.calls.find(a=>a[0]==='stop'),['stop','--timeout','30',id]);
});
test('restore passes archive read-only and never starts the target',async()=>{
  const f=fixture();await operate(plan('restore'),f.run,async()=>{});
  assert.ok(f.calls.find(a=>a[0]==='run').includes('type=bind,source=/private/backups/snapshot,target=/backup,readonly'));
  assert.ok(!f.calls.some(a=>a[0]==='start'));
});
test('nested state/config/secret mounts and parent mounts refuse before backup',async()=>{
  for (const Destination of ['/var/lib/bunny/modules/pixoo','/etc/bunny/runtime.json','/run/secrets/bunny/edge.json','/var/lib','/']) {
    const f=fixture();f.info.Mounts.push({Type:'volume',Name:'nested',Destination,RW:true});
    await assert.rejects(operate(plan('backup'),f.run,async()=>{}));assert.ok(!f.calls.some(a=>a[0]==='run'));
  }
});
test('private backup parent must be outside ordinary and worktree Git checkouts',{skip:process.getuid===undefined},async t=>{
  const {mkdtemp,mkdir,writeFile,rm,realpath}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path');
  const root=await mkdtemp(join(await realpath(tmpdir()),'bunny-private-parent-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=join(root,'private-backups');await mkdir(output,{mode:0o700});
  await privateHostDirectory(output);
  await mkdir(join(root,'.git'));await assert.rejects(privateHostDirectory(output));
  await rm(join(root,'.git'),{recursive:true});await writeFile(join(root,'.git'),'gitdir: elsewhere\n');
  await assert.rejects(privateHostDirectory(output));
});

for (const command of ['backup','restore']) test(`${command} uses an existing private archive volume without host binds`,async()=>{
  const f=fixture();
  await operate(parse([command,'snapshot-1','--archive-volume','archives','--project','synthetic']),f.run,async()=>assert.fail('host path check'));
  assert.deepEqual(f.calls.find(a=>a[0]==='volume' && a[2]==='archives'),['volume','inspect','archives']);
  const args=f.calls.find(a=>a[0]==='run');
  assert.ok(args.includes(`type=volume,source=archives,target=/backup${command==='restore'?',readonly':''}`));
  assert.ok(!args.some(a=>a.includes('type=bind')));
  assert.deepEqual(args.slice(-5),['worker-'+command,command==='backup'?'--destination':'--archive','/backup/snapshot-1','--revision',revision]);
  assert.ok(!f.calls.some(a=>['start','stop','compose'].includes(a[0])));
});
test('archive volume arguments reject traversal, nested paths and Docker mount injection',()=>{
  for(const path of ['','..','.','../snapshot','nested/snapshot','/snapshot','C:\\snapshot','a,b','a:b'])
    assert.throws(()=>parse(['backup',path,'--project','synthetic','--archive-volume','archives']));
  for(const name of ['','a','../volume','volume,readonly','--bad','volume/name'])
    assert.throws(()=>parse(['backup','snapshot','--project','synthetic','--archive-volume',name]));
  assert.throws(()=>parse(['start','--project','synthetic','--archive-volume','archives']));
  assert.throws(()=>parse(['worker-backup','--revision',revision,'--destination','/backup/snapshot','--archive-volume','archives']));
});
test('archive volumes refuse missing volumes, aliases, remote drivers and bind-backed local volumes',async()=>{
  for(const name of ['state','config','secrets']) {
    const f=fixture();
    await assert.rejects(operate(parse(['backup','snapshot','--project','synthetic','--archive-volume',name]),f.run));
    assert.ok(!f.calls.some(a=>a[0]==='run'));
  }
  for(const result of [[],[{Name:'wrong',Driver:'local',Scope:'local'}],
    [{Name:'archives',Driver:'remote',Scope:'local'}], [{Name:'archives',Driver:'local',Scope:'global'}],
    [{Name:'archives',Driver:'local',Scope:'local',Options:{type:'none',o:'bind',device:'/private'}}]]) {
    const f=fixture();
    let archiveInspected=false;
    const run=async args=>{
      if(args[0]==='volume' && args[2]==='archives') {archiveInspected=true;return JSON.stringify(result);}
      return f.run(args);
    };
    await assert.rejects(operate(parse(['backup','snapshot','--project','synthetic','--archive-volume','archives']),run));
    assert.equal(archiveInspected,true);
    assert.ok(!f.calls.some(a=>a[0]==='run'));
  }
});

test('selected state, config and secrets must be distinct ordinary local volumes',async()=>{
  const selected=parse(['backup','snapshot','--archive-volume','archives','--project','synthetic']);
  for(const pair of [[0,1],[0,2],[1,2]]) {
    const f=fixture(); f.info.Mounts[pair[1]].Name=f.info.Mounts[pair[0]].Name;
    await assert.rejects(operate(selected,f.run));
    assert.ok(!f.calls.some(a=>a[0]==='run'));
  }
  for(const name of ['state','config','secrets']) for(const override of [
    {Driver:'remote'}, {Scope:'global'}, {Options:{type:'none',o:'bind',device:'/synthetic'}},
  ]) {
    const f=fixture();
    const run=async args=>args[0]==='volume' && args[2]===name
      ? JSON.stringify([{Name:name,Driver:'local',Scope:'local',Options:null,...override}]) : f.run(args);
    await assert.rejects(operate(selected,run));
    assert.ok(!f.calls.some(a=>a[0]==='run'));
  }
});

async function qualifiedHelper(requestOverrides={}) {
  const {EXPECTED_JOB_NAMES,qualificationArtifactNames}=await import('../release/qualification.mjs');
  const {attestMaintenanceHelper}=await import('../deployment/maintenance-helper.mjs');
  const candidate='a'.repeat(40),helperImage='sha256:'+'b'.repeat(64),names=qualificationArtifactNames(candidate,10,1);
  const request={project:'synthetic',containerId:id,previousImage:image,previousRevision:revision,candidate,runId:10,runAttempt:1,...requestOverrides};
  const jobs=EXPECTED_JOB_NAMES.map((name,index)=>({id:index+1,name,run_id:10,run_attempt:1,head_sha:candidate,status:'completed',conclusion:'success'}));
  const receipt={schema:'bunny-release-qualification/1.0',repository:'jimmie-potts/agent-device-hub',candidate,evaluationRevision:candidate,runId:10,runAttempt:1,outcome:'qualified',architecture:'linux/arm64',
    evaluationInputs:Object.fromEntries(['lockfile','workflow','checksWorkflow','workflowWorkflow','dockerfile','verifyDockerfile'].map(key=>[key,'c'.repeat(64)])),
    image:{id:helperImage,revision:candidate,archive:'production-image.tar.gz',archiveSha256:'d'.repeat(64),artifactName:names.image},checks:jobs.map(job=>({id:job.id,name:job.name,result:'success',headSha:candidate})),createdAt:'2026-11-01T12:00:00Z'};
  const hosted={run:{id:10,run_attempt:1,head_sha:candidate,event:'workflow_dispatch',path:'.github/workflows/release-qualification.yml',status:'completed',conclusion:'success',repository:{full_name:receipt.repository}},jobs,
    artifacts:Object.values(names).map((name,index)=>({id:20+index,name,expired:false,workflow_run:{id:10,head_sha:candidate}}))};
  return {request,receipt,hosted,capability:attestMaintenanceHelper(receipt,hosted,request),candidate,helperImage};
}
test('qualified maintenance helper runs the fixed image while retaining old source and exact mounts',async()=>{
  const h=await qualifiedHelper(),f=fixture();
  const run=async args=>{
    if(args[0]==='image'&&args[2]===h.helperImage){f.calls.push(args);return JSON.stringify([{Id:h.helperImage,Architecture:'arm64',Os:'linux',Config:{Labels:{'org.opencontainers.image.revision':h.candidate}}}]);}
    if(args[0]==='run'){f.calls.push(args);return JSON.stringify({operation:'backup',status:'complete',files:2,manifestSchema:'bunny-container-backup/2',sourceRevision:revision,helper:{image:h.helperImage,revision:h.candidate}});}
    return f.run(args);
  };
  const result=await operate({...parse(['backup','snapshot','--archive-volume','archives','--project','synthetic']),maintenanceHelper:h.capability},run);
  assert.equal(result.sourceRevision,revision);const args=f.calls.find(args=>args[0]==='run');
  assert.ok(args.includes(h.helperImage));assert.ok(args.includes('BUNNY_MAINTENANCE_REVISION='+h.candidate));
  assert.deepEqual(args.slice(-2),['--revision',revision]);assert.ok(args.includes('--network=none'));
  assert.ok(args.includes('type=volume,source=config,target=/etc/bunny,readonly'));assert.ok(args.includes('type=volume,source=secrets,target=/run/secrets/bunny,readonly'));
});
test('raw helper assertions and wrong old-target bindings refuse before a worker runs',async()=>{
  const raw=fixture();await assert.rejects(operate({...plan('backup'),maintenanceHelper:{image:'sha256:'+'b'.repeat(64)}},raw.run));assert.equal(raw.calls.length,0);
  for(const mismatch of [{containerId:'f'.repeat(64)},{previousImage:'sha256:'+'f'.repeat(64)},{previousRevision:'f'.repeat(40)},{project:'other'}]) {
    const h=await qualifiedHelper(mismatch),f=fixture();await assert.rejects(operate({...plan('backup'),maintenanceHelper:h.capability},f.run));assert.ok(!f.calls.some(args=>args[0]==='run'));
  }
});
test('failed authentic qualification metadata cannot mint a helper and serialized capability cannot survive',async()=>{
  const h=await qualifiedHelper(),{attestMaintenanceHelper}=await import('../deployment/maintenance-helper.mjs');
  h.hosted.jobs[0].conclusion='failure';assert.throws(()=>attestMaintenanceHelper(h.receipt,h.hosted,h.request));
  const f=fixture();await assert.rejects(operate({...plan('backup'),maintenanceHelper:JSON.parse(JSON.stringify(h.capability))},f.run));assert.equal(f.calls.length,0);
});
test('operational stderr forwards only a fixed worker refusal and never raw private errors',async()=>{
  const {operatorRefusal,refusalMessage}=await import('../operator-refusal.mjs');
  const configuration=refusalMessage(operatorRefusal('configuration'));
  assert.match(configuration,/code=invalid-request stage=configuration/);
  assert.equal(refusalMessage({stderr:configuration}),configuration);
  const raw=refusalMessage({stderr:'SYNTHETIC_SECRET /private/selected/config runtime stack',message:'SYNTHETIC_SECRET'});
  assert.match(raw,/code=unavailable stage=worker/);assert.doesNotMatch(raw,/SYNTHETIC_SECRET|\/private|stack/);
  assert.match(refusalMessage({stderr:configuration+'SYNTHETIC_SECRET'}),/code=unavailable stage=worker/);
});
test('qualification request is limited to explicit backup and restore operator routes',()=>{
  assert.equal(parse(['backup','snapshot','--project','synthetic','--archive-volume','archives','--qualification-request','/private/request.json']).qualificationRequest,'/private/request.json');
  assert.throws(()=>parse(['start','--project','synthetic','--qualification-request','/private/request.json']));
  assert.throws(()=>parse(['worker-backup','--revision',revision,'--destination','/backup/snapshot','--qualification-request','/private/request.json']));
});

async function withoutUidOn(platform, work) {
  const platformDescriptor=Object.getOwnPropertyDescriptor(process,'platform');
  const uidDescriptor=Object.getOwnPropertyDescriptor(process,'getuid');
  Object.defineProperty(process,'platform',{...platformDescriptor,value:platform});
  Object.defineProperty(process,'getuid',{configurable:true,writable:true,value:undefined});
  try{return await work();}
  finally {
    Object.defineProperty(process,'platform',platformDescriptor);
    if(uidDescriptor)Object.defineProperty(process,'getuid',uidDescriptor);else delete process.getuid;
  }
}

test('native Windows manual commands preserve existing Docker paths without POSIX coordination',async t=>{
  const {mkdtemp,realpath,rm,lstat}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path');
  const directory=await mkdtemp(join(await realpath(tmpdir()),'bunny-windows-manual-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const coordination=join(directory,'must-stay-absent');
  await withoutUidOn('win32',async()=>{
    for(const command of ['start','stop','backup','restore']) {
      const f=fixture();
      if(command==='stop')Object.assign(f.info.State,{Status:'running',Running:true,Pid:101});
      const selected=parse([command,...(['backup','restore'].includes(command)?['snapshot-1','--archive-volume','archives']:[]),'--project','synthetic']);
      const result=await maintain(selected,f.run,async()=>assert.fail('native Windows host-directory export is unqualified'),coordination);
      assert.equal(result.status,command==='start'?'running':command==='stop'?'stopped':'complete');
      assert.ok(f.calls.some(args=>args[0]===({start:'start',stop:'stop',backup:'run',restore:'run'})[command]));
      assert.ok(!f.calls.some(args=>args.some(value=>value.includes('type=bind'))));
    }
  });
  await assert.rejects(lstat(coordination),{code:'ENOENT'});
});

test('missing POSIX UID support never bypasses Mac operation exclusion',async t=>{
  const {mkdtemp,realpath,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path');
  const root=await mkdtemp(join(await realpath(tmpdir()),'bunny-posix-guard-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture();
  await withoutUidOn('darwin',async()=>{
    await assert.rejects(maintain(plan('start'),f.run,undefined,root),/operator-refused/);
    assert.equal(f.calls.length,0);
  });
});
