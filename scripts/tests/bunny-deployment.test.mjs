import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,realpath,rm,stat,symlink} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {refusalMessage} from '../operator-refusal.mjs';
import {tmpdir} from 'node:os';
import {deployBatch,validateReturn} from '../deployment/batch.mjs';
import {readPending,reconcileOperation,withOperation} from '../bunny-operations.mjs';
import {maintain} from '../bunny.mjs';
const oldId='1'.repeat(64),newId='2'.repeat(64),oldImage='sha256:'+'3'.repeat(64),newImage='sha256:'+'4'.repeat(64),oldRevision='5'.repeat(40),revision='6'.repeat(40);
async function fixture(t) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'bunny-batch-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const compose=join(root,'compose.json');await writeFile(compose,'{}',{mode:0o600});
  const state=join(root,'state');await writeFile(state,'latest-before\n',{mode:0o600});
  const request={schema:'bunny-batch-deployment/1.0',operation:'forward',id:'batch-synthetic',owner:'synthetic-task',project:'synthetic',compose,
    containerId:oldId,previousImage:oldImage,previousRevision:oldRevision,candidate:revision,runId:11,runAttempt:1,
    includedIssues:['https://github.com/jimmie-potts/agent-device-hub/issues/1365'],requiredModules:['core'],client:'trusted-browser',
    forward:{assessment:'No stored-format change.',evidence:'synthetic write/reopen check'},recovery:{status:'unknown'},backup:{volume:'archives',name:'snapshot-1'}};
  const mounts=[['state','/var/lib/bunny',true],['config','/etc/bunny',false],['secrets','/run/secrets/bunny',false]].map(([Name,Destination,RW])=>({Type:'volume',Name,Destination,RW}));
  let info={Id:oldId,Image:oldImage,State:{Status:'running',Running:true,Restarting:false,Pid:123},
    Config:{Entrypoint:['node','/opt/bunny/deploy/container/entrypoint.mjs'],Cmd:['start'],User:'1000:1000',Env:['BUNNY_CONTROL=disabled'],Labels:{'com.docker.compose.project':'synthetic','com.docker.compose.service':'core'}},
    HostConfig:{ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],RestartPolicy:{Name:'no'},NetworkMode:'none'},NetworkSettings:{Networks:{}},Mounts:mounts};
  const rendered={name:'synthetic',services:{core:{image:oldImage,user:'1000:1000',read_only:true,network_mode:'none',environment:{BUNNY_CONTROL:'disabled'},
    volumes:mounts.map(m=>({type:'volume',source:m.Name,target:m.Destination,read_only:!m.RW}))}},volumes:Object.fromEntries(mounts.map(m=>[m.Name,{name:m.Name}]))};
  const target={candidate:revision,outcome:'qualified',architecture:'linux/arm64',image:{id:newImage},runId:11,runAttempt:1};
  const calls=[];const f={root,request,state,target,calls,get info(){return info;},failAt:undefined,revisions:new Map([[oldImage,oldRevision],[newImage,revision]])};
  f.run=async args=>{
    calls.push(args);
    if(f.failAt===args[0]||f.failAt==='client'&&args[0]==='exec'&&args.includes('-e'))throw Error('synthetic-failure');
    if(args[0]==='ps')return info?.Id??'';
    if(args[0]==='inspect')return JSON.stringify([info]);
    if(args[0]==='image')return JSON.stringify([{Id:args[2],Architecture:'arm64',Os:'linux',Config:{Labels:{'org.opencontainers.image.revision':f.revisions.get(args[2])}}}]);
    if(args[0]==='volume')return JSON.stringify([{Name:args[2],Driver:'local',Scope:'local',Options:null}]);
    if(args[0]==='compose'&&args.includes('config'))return JSON.stringify(rendered);
    if(args[0]==='compose'&&args.includes('create')) {
      // Creates from the file it is given, as Compose would, so a missing or wrong replacement file fails here.
      const image=JSON.parse(await readFile(args[args.indexOf('-f')+1],'utf8')).services.core.image;
      info={...info,Id:image===newImage?newId:createHash('sha256').update(image).digest('hex'),Image:image,State:{Status:'created',Running:false,Restarting:false,Pid:0}};return '';
    }
    if(args[0]==='stop'){Object.assign(info.State,{Status:'exited',Running:false,Pid:0});return '';}
    if(args[0]==='start'){Object.assign(info.State,{Status:'running',Running:true,Pid:124});await writeFile(state,'latest-before\nnew-candidate-state\n');return '';}
    if(args[0]==='rm')return '';
    if(args[0]==='run'&&args.at(-1)==='/backup/snapshot-1')return JSON.stringify({status:'absent'});
    if(args[0]==='run')return JSON.stringify(args.includes('worker-backup')?{operation:'backup',status:'complete',files:2}:{stateSha256:'9'.repeat(64),manifestSha256:'7'.repeat(64),configSha256:'8'.repeat(64)});
    if(args[0]==='exec')return JSON.stringify(args.includes('-e')?{client:'trusted-browser',status:'passed'}:{schema:'runtime-health/1.0',status:'ok',modules:[{name:'core',state:'running'}]});
    throw Error('unexpected command '+JSON.stringify(args));
  };
  f.deploy=()=>deployBatch(request,{root,run:f.run,qualification:async()=>target});return f;
}
test('qualified batch backs up stopped writer, preserves private resources and records release',async t=>{
  const f=await fixture(t);assert.equal((await f.deploy()).outcome,'succeeded');
  const beforeBackup=f.calls.findIndex(a=>a.includes('worker-backup'));
  assert.ok(f.calls.findIndex(a=>a[0]==='stop')<beforeBackup);
  assert.ok(beforeBackup<f.calls.findIndex(a=>a[0]==='rm'));
  assert.ok(!f.calls.some(a=>a.includes('-v')||a[0]==='restore'));
  const record=JSON.parse(await readFile(join(f.root,'synthetic.records','batch-synthetic.json'),'utf8'));
  assert.equal(record.schema,'bunny-batch-record/1.0');assert.equal(record.outcome,'succeeded');assert.equal(record.targetImage,newImage);assert.ok(record.writerReleasedAt);
  assert.equal(await readPending({root:f.root,project:'synthetic'}),undefined);
  assert.equal(record.recovery.status,'unknown');
});
test('bad qualification and wrong image/target refuse before stopping',async t=>{
  for(const mutate of [f=>f.target.outcome='failed',f=>f.target.candidate='9'.repeat(40),f=>f.target.architecture='linux/amd64',f=>f.request.containerId='a'.repeat(64),f=>f.request.unselectedCredential='synthetic-secret-must-not-be-retained']) {
    const f=await fixture(t);mutate(f);await assert.rejects(f.deploy());assert.ok(!f.calls.some(a=>a[0]==='stop'||a[0]==='rm'));
  }
});
test('failed client check stops exact owned replacement and preserves candidate latest state behind pending record',async t=>{
  const f=await fixture(t);f.failAt='client';await assert.rejects(f.deploy());
  assert.equal(f.info.Id,newId);assert.equal(f.info.State.Pid,0);
  assert.match(await readFile(f.state,'utf8'),/new-candidate-state/);
  const pending=await readPending({root:f.root,project:'synthetic'});
  assert.equal(pending.phase,'checking-client');assert.equal(pending.outcome,'failed');assert.equal(pending.replacementStop,'verified-stopped');
  const count=f.calls.length;await assert.rejects(f.deploy());assert.ok(!f.calls.slice(count).some(a=>['stop','rm','start'].includes(a[0])));
  const result=await reconcileOperation({root:f.root,project:'synthetic'},async()=>({id:f.info.Id,image:f.info.Image,status:f.info.State.Status,pid:f.info.State.Pid}));
  assert.equal(result.phase,'reconciled');assert.match(await readFile(f.state,'utf8'),/new-candidate-state/);
});
test('ambiguous failed stop remains uncertain and is never retried automatically',async t=>{
  const f=await fixture(t);f.failAt='client';const run=f.run;let stops=0;
  f.run=async args=>{if(args[0]==='stop'&&++stops===2)throw Error('unknown stop result');return run(args);};
  await assert.rejects(f.deploy());const pending=await readPending({root:f.root,project:'synthetic'});
  assert.equal(pending.outcome,'uncertain');assert.equal(pending.replacementStop,'uncertain');assert.equal(stops,2);
});
test('deployment exclusion applies to existing manual start stop backup and restore; status remains available',async t=>{
  const f=await fixture(t);
  await withOperation({root:f.root,project:'synthetic'},async()=>{
    for(const command of ['start','stop','backup','restore']) {
      const count=f.calls.length;await assert.rejects(maintain({...f.request,command},f.run,undefined,f.root));assert.equal(f.calls.length,count);
    }
    assert.equal((await maintain({...f.request,command:'status'},f.run,undefined,f.root)).status,'running');
  });
});
test('explicit previous-image return requires exact latest backup and configuration evidence',()=>{
  const request={operation:'return',candidate:oldRevision,recovery:{status:'qualified'}};
  const target={image:{id:oldImage}};const backup={stateSha256:'a'.repeat(64),configSha256:'b'.repeat(64)};
  const receipt={schema:'bunny-image-return/1.0',outcome:'compatible',image:oldImage,revision:oldRevision,stateSha256:backup.stateSha256,configSha256:backup.configSha256,evidence:'previous reader reopened new synthetic state'};
  validateReturn(request,receipt,backup,target);
  for(const changed of [{outcome:'incompatible'},{image:newImage},{stateSha256:'c'.repeat(64)},{configSha256:'d'.repeat(64)}])assert.throws(()=>validateReturn(request,{...receipt,...changed},backup,target));
  assert.throws(()=>validateReturn({...request,recovery:{status:'unknown'}},receipt,backup,target));
});
test('duplicate completed ID cannot replace the previous batch Compose or affect the runtime',async t=>{
  const f=await fixture(t);await f.deploy();
  const path=join(f.root,f.request.id+'.compose.json'),before=await readFile(path,'utf8');
  f.request.containerId=f.info.Id;f.request.previousImage=newImage;f.request.previousRevision=revision;
  const nextImage='sha256:'+'a'.repeat(64),nextRevision='b'.repeat(40);
  f.request.candidate=nextRevision;f.target.candidate=nextRevision;f.target.image.id=nextImage;
  const run=f.run;f.run=async args=>args[0]==='image'&&args[2]===nextImage?JSON.stringify([{Id:nextImage,Architecture:'arm64',Os:'linux',Config:{Labels:{'org.opencontainers.image.revision':nextRevision}}}]):run(args);
  const count=f.calls.length;await assert.rejects(f.deploy());
  assert.equal(await readFile(path,'utf8'),before);
  assert.ok(!f.calls.slice(count).some(a=>['stop','rm','start'].includes(a[0])));
  assert.equal(await readPending({root:f.root,project:'synthetic'}),undefined);
});
// The next request names the previous record's replacementCompose, so a name built from the source name grew per batch (#1502).
test('a request whose Compose is a previous replacement gets a replacement name bounded by its own ID',async t=>{
  const f=await fixture(t),records=[];
  for(let n=1;n<=4;n++) {
    if(n>1) {
      const image='sha256:'+createHash('sha256').update('image-'+n).digest('hex'),next=createHash('sha1').update('revision-'+n).digest('hex');
      f.revisions.set(image,next);
      Object.assign(f.request,{compose:records.at(-1).replacementCompose,containerId:f.info.Id,previousImage:f.info.Image,previousRevision:f.request.candidate,candidate:next});
      Object.assign(f.target,{candidate:next,image:{id:image}});
    }
    f.request.id='batch-'+String(n).padEnd(100,'x');
    assert.equal((await f.deploy()).outcome,'succeeded');
    records.push(JSON.parse(await readFile(join(f.root,'synthetic.records',f.request.id+'.json'),'utf8')));
  }
  for(const [n,record] of records.entries()) {
    assert.equal(dirname(record.replacementCompose),f.root);
    assert.equal(basename(record.replacementCompose),record.id+'.compose.json');
    assert.ok(Buffer.byteLength(basename(record.replacementCompose))<=128);
    assert.equal(record.compose,n===0?join(f.root,'compose.json'):records[n-1].replacementCompose);
    assert.equal((await stat(record.replacementCompose)).mode&0o777,0o600);
    assert.equal(JSON.parse(await readFile(record.replacementCompose,'utf8')).services.core.image,record.targetImage);
    assert.ok(f.calls.some(a=>a[0]==='compose'&&a.includes('create')&&a[a.indexOf('-f')+1]===record.replacementCompose));
  }
  assert.equal(f.info.Image,records.at(-1).targetImage);
});
test('a failed replacement Compose write names its step in the record and stops nothing',async t=>{
  const f=await fixture(t),occupied=join(f.root,f.request.id+'.compose.json');
  await writeFile(occupied,'{"synthetic":"existing"}\n',{mode:0o600});
  await assert.rejects(f.deploy());
  const pending=await readPending({root:f.root,project:'synthetic'});
  assert.equal(pending.failedPhase,'preparing-compose');
  assert.equal(pending.failedStep,'writing-replacement-compose');
  assert.equal(pending.failedFileError,'EEXIST');
  assert.equal(pending.replacementCompose,occupied);
  assert.equal(await readFile(occupied,'utf8'),'{"synthetic":"existing"}\n');
  assert.ok(!f.calls.some(a=>['stop','rm','start'].includes(a[0])||a[0]==='compose'&&a.includes('create')));
});
// Node resolves a symlink for import.meta.url but keeps it in argv, so a path comparison missed and exited 0 (#1470).
test('the deploy command reaches its entry point through a symlinked path',{skip:process.platform==='win32',timeout:60_000},async t=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'bunny-deploy-entry-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const script=fileURLToPath(new URL('../bunny-deploy.mjs',import.meta.url)),linked=join(root,'bunny-deploy.mjs');
  await symlink(script,linked);
  for(const path of [script,linked]) {
    // No arguments: the command refuses before reading a request or calling the engine.
    const result=await new Promise(done=>execFile(process.execPath,[path],{env:{PATH:'/usr/bin:/bin',HOME:root},timeout:30_000},
      (error,stdout,stderr)=>done({code:error?.code??0,stdout,stderr})));
    assert.deepEqual(result,{code:1,stdout:'',stderr:refusalMessage(Error('deployment-refused'))},path);
  }
});
