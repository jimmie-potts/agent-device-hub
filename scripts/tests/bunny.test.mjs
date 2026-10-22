import test from 'node:test';
import assert from 'node:assert/strict';
import {operate, parse, privateHostDirectory} from '../bunny.mjs';

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

function localFixture() {
  const f=fixture(), networkId='a'.repeat(64);
  Object.assign(f.info.Config.Labels,{'io.bunny.access':'host-local'});
  f.info.Config.Env=['BUNNY_ACCESS=host-local','BUNNY_CONTROL=disabled','BUNNY_PORT=18788'];
  f.info.HostConfig.NetworkMode='synthetic_local';
  f.info.HostConfig.PortBindings={'18788/tcp':[{HostIp:'127.0.0.1',HostPort:'18788'}]};
  f.info.NetworkSettings.Networks={synthetic_local:{NetworkID:networkId}};
  const network={Id:networkId,Name:'synthetic_local',Driver:'bridge',Scope:'local',Internal:true,Attachable:false,EnableIPv6:false,
    Labels:{'com.docker.compose.project':'synthetic','com.docker.compose.network':'local'},Options:{},Containers:{}};
  const run=async args=>{
    if(args[0]==='network'){f.calls.push(args);return JSON.stringify([network]);}
    return f.run(args);
  };
  return {...f,network,run};
}

test('explicit host-local profile retains stopped backup with network-none maintenance',async()=>{
  const f=localFixture();await operate(parse(['backup','snapshot-1','--archive-volume','archives','--project','synthetic']),f.run);
  assert.deepEqual(f.calls.find(a=>a[0]==='network'),['network','inspect','synthetic_local']);
  assert.ok(f.calls.find(a=>a[0]==='run').includes('--network=none'));
});

test('host-local start and backup refuse widened bindings, devices and shared or external networks before effects',async()=>{
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
    f=>f.network.Internal=false,
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

test('new-container admission inspects created configuration before start and stops on an isolation change',async()=>{
  const f=localFixture();let created=false;
  const run=async args=>{
    if(args[0]==='ps'&&!created){f.calls.push(args);return '';}
    if(args[0]==='compose'){f.calls.push(args);assert.ok(args.includes('create'));created=true;return '';}
    const result=await f.run(args);
    if(args[0]==='start') f.network.Internal=false;
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
