// Explicit source acceptance on fresh synthetic volumes only. The qualification metadata below is a controlled fixture.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {docker,operate,selected} from '../bunny.mjs';
import {withOperation} from '../bunny-operations.mjs';
import {attestMaintenanceHelper} from '../deployment/maintenance-helper.mjs';
import {EXPECTED_JOB_NAMES,qualificationArtifactNames} from '../release/qualification.mjs';
import {refusalMessage} from '../operator-refusal.mjs';
const oldImage=process.env.BUNNY_BACKUP_TEST_OLD_IMAGE,helperImage=process.env.BUNNY_BACKUP_TEST_HELPER_IMAGE;
if(![oldImage,helperImage].every(value=>/^sha256:[a-f0-9]{64}$/.test(value??'')))throw Error('explicit old and helper test image IDs required');
const inspectImage=async image=>JSON.parse(await docker(['image','inspect',image]))[0];
const old=await inspectImage(oldImage),helper=await inspectImage(helperImage);
for(const image of [old,helper]){assert.equal(image.Architecture,'arm64');assert.equal(image.Os,'linux');}
const revision=old.Config.Labels['org.opencontainers.image.revision'],candidate=helper.Config.Labels['org.opencontainers.image.revision'];
const project='backup1343-'+randomUUID().slice(0,8),restoredProject=project+'-restore';
const root=await mkdtemp(join(await realpath(tmpdir()),project+'-'));
const archive=project+'_archives',volumes=[...['state','config','secrets'].map(key=>project+'_'+key),...['state','config','secrets'].map(key=>restoredProject+'_'+key),archive];
const section={id:'onn',configurationRevision:1,adbSocket:'/not-configured/socket',serial:'192.0.2.10:12345',hostExecutable:'/not-configured/adb',hostExecutableSha256:'0'.repeat(64),hostVersion:'37.0.1',hostKeyDirectory:'/not-configured/keys'};
const raw='  '+JSON.stringify({schema:'runtime-config/1.0',modules:{onn:section},edge:{credentials:'/run/secrets/bunny/edge.json',browserAccess:'trusted-loopback',launcher:false,mcp:false}})+'\n';
const secret=JSON.stringify({schema:'edge-credentials/1.0',credentials:[]})+'\n';
const rawHash=createHash('sha256').update(raw).digest('hex');
const composeFiles=new Map();let holder,completed=false;
async function prepare(name) {
  assert.equal(await docker(['ps','-aq','--filter','label=com.docker.compose.project='+name]),'');
  const file=join(root,name+'.json');composeFiles.set(name,file);
  await writeFile(file,JSON.stringify({services:{core:{image:oldImage,init:true,user:'1000:1000',read_only:true,network_mode:'none',cap_drop:['ALL'],security_opt:['no-new-privileges:true'],pids_limit:256,mem_limit:'4g',cpus:2,restart:'no',environment:{BUNNY_ACCESS:'isolated',BUNNY_CONTROL:'disabled'},tmpfs:['/tmp:mode=1777,size=256m'],volumes:['state:/var/lib/bunny','config:/etc/bunny:ro','secrets:/run/secrets/bunny:ro']}},volumes:Object.fromEntries(['state','config','secrets'].map(key=>[key,{name:name+'_'+key}]))}),{mode:0o600});
  await docker(['compose','-f',file,'-p',name,'create','--no-build','--pull','never','core']);
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=volume,source=${name}_config,target=/etc/bunny`,'--mount',`type=volume,source=${name}_secrets,target=/run/secrets/bunny`,'--entrypoint','node',oldImage,'-e',"const fs=require('node:fs'),a=require('node:assert/strict');a.equal(fs.statSync('/etc/bunny').uid,1000);a.equal(fs.readdirSync('/run/secrets/bunny').length,0);fs.writeFileSync('/etc/bunny/runtime.json',process.argv[1],{mode:384});fs.writeFileSync('/run/secrets/bunny/edge.json',process.argv[2],{mode:384});",raw,secret]);
}
function capability(info,name,wrongRevision=false) {
  const selected=wrongRevision?'f'.repeat(40):candidate,names=qualificationArtifactNames(selected,1,1);
  const jobs=EXPECTED_JOB_NAMES.map((name,index)=>({id:index+1,name,run_id:1,run_attempt:1,head_sha:selected,status:'completed',conclusion:'success'}));
  const receipt={schema:'bunny-release-qualification/1.0',repository:'jimmie-potts/agent-device-hub',candidate:selected,evaluationRevision:selected,runId:1,runAttempt:1,outcome:'qualified',architecture:'linux/arm64',evaluationInputs:Object.fromEntries(['lockfile','workflow','checksWorkflow','workflowWorkflow','dockerfile','verifyDockerfile'].map(key=>[key,'a'.repeat(64)])),image:{id:helperImage,revision:selected,archive:'production-image.tar.gz',archiveSha256:'b'.repeat(64),artifactName:names.image},checks:jobs.map(job=>({id:job.id,name:job.name,result:'success',headSha:selected})),createdAt:'2026-11-01T12:00:00Z'};
  const hosted={main:[{ref:'refs/heads/main',object:{sha:selected,type:'commit'}}],comparisons:[{base_commit:{sha:selected},merge_base_commit:{sha:selected},status:'identical',ahead_by:0,behind_by:0,total_commits:0,commits:[]}],run:{id:1,run_attempt:1,head_sha:selected,event:'workflow_dispatch',status:'completed',conclusion:'success',path:'.github/workflows/release-qualification.yml',repository:{full_name:receipt.repository}},jobs,artifacts:Object.values(names).map((name,index)=>({id:20+index,name,expired:false,workflow_run:{id:1,head_sha:selected}}))};
  return attestMaintenanceHelper(receipt,hosted,{candidate:selected,runId:1,runAttempt:1,project:name,containerId:info.Id,previousImage:oldImage,previousRevision:revision});
}
async function ready(info) {for(let i=0;i<40;i++){try{const h=JSON.parse(await docker(['exec',info.Id,'node','/opt/bunny/deploy/container/entrypoint.mjs','status']));if(h.status==='ok')return;}catch{}await delay(250);}throw Error('synthetic core readiness failed');}
async function archiveCheck(name) {
  return JSON.parse(await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:mode=1777,size=64m','--mount',`type=volume,source=${archive},target=/backup,readonly`,'--mount',`type=volume,source=${name}_config,target=/etc/bunny,readonly`,'--mount',`type=volume,source=${name}_secrets,target=/run/secrets/bunny,readonly`,'--entrypoint','node',helperImage,'--input-type=module','-e',"import{verify}from'/opt/bunny/scripts/bunny-backup.mjs';import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';const m=await verify({archive:'/backup/full',revision:process.argv[1]});console.log(JSON.stringify({schema:m.schema,revision:m.revision,helper:m.helper,dependencies:m.externalHostDependencies.length,references:m.references.length,configSha256:createHash('sha256').update(await readFile('/backup/full/runtime.json')).digest('hex')}));",revision]));
}
try {
  assert.equal(await docker(['volume','ls','-q','--filter','name=^'+project]),'');
  await prepare(project);await prepare(restoredProject);
  await docker(['volume','create',archive]);
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--mount',`type=volume,source=${archive},target=/var/lib/bunny`,'--entrypoint','node',oldImage,'-e',"const f=require('node:fs'),a=require('node:assert/strict');a.equal(f.statSync('/var/lib/bunny').uid,1000);a.equal(f.readdirSync('/var/lib/bunny').length,0)"]);
  await operate({command:'start',project,compose:composeFiles.get(project)},docker);let source=await selected({project},docker);await ready(source);
  await assert.rejects(operate({command:'backup',project,archiveVolume:archive,path:'running'},docker));
  await operate({command:'stop',project},docker);source=await selected({project},docker);
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--mount',`type=volume,source=${project}_state,target=/var/lib/bunny`,'--entrypoint','node',helperImage,'-e',"const{DatabaseSync}=require('node:sqlite');process.umask(63);const d=new DatabaseSync('/var/lib/bunny/modules/onn.sqlite');d.exec(\"CREATE TABLE synthetic(value TEXT);INSERT INTO synthetic VALUES('retained ONN state')\");d.close();"]);
  const plan={command:'backup',project,archiveVolume:archive,path:'full'};
  await assert.rejects(operate({...plan,path:'old-helper'},docker));
  await assert.rejects(operate({...plan,path:'wrong',maintenanceHelper:capability(source,project,true)},docker));
  const admitted=capability(source,project);
  holder=await docker(['create','--name',project+'-holder','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=volume,source=${project}_state,target=/var/lib/bunny`,'--entrypoint','node',helperImage,'--input-type=module','-e',"import{acquireRuntimeOwnership}from'/opt/bunny/apps/runtime/dist/src/runtime-ownership.js';await acquireRuntimeOwnership('/var/lib/bunny');console.log('held');setInterval(()=>{},1000);"]);
  await docker(['start',holder]);for(let i=0;i<40;i++){if((await docker(['logs',holder])).includes('held'))break;if(i===39)throw Error('test lease not held');await delay(100);}
  let leaseRefusal;try{await operate({...plan,path:'held',maintenanceHelper:admitted},docker);assert.fail('held lease admitted');}catch(error){leaseRefusal=refusalMessage(error);}
  assert.match(leaseRefusal,/code=unavailable stage=ownership/);await docker(['stop','--timeout','5',holder]);await docker(['rm',holder]);holder=undefined;
  const result=await withOperation({root,project},()=>operate({...plan,maintenanceHelper:admitted},docker));assert.equal(result.sourceRevision,revision);assert.equal(result.helper.image,helperImage);
  const summary=await archiveCheck(project);assert.equal(summary.schema,'bunny-container-backup/2');assert.equal(summary.configSha256,rawHash);assert.equal(summary.revision,revision);assert.equal(summary.helper.revision,candidate);assert.equal(summary.dependencies,3);assert.equal(summary.references,1);
  const target=await selected({project:restoredProject},docker),targetHelper=capability(target,restoredProject);
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--mount',`type=volume,source=${restoredProject}_secrets,target=/run/secrets/bunny`,'--entrypoint','node',helperImage,'-e',"require('node:fs').appendFileSync('/run/secrets/bunny/edge.json',' ')"]);
  await assert.rejects(operate({command:'restore',project:restoredProject,archiveVolume:archive,path:'full',maintenanceHelper:targetHelper},docker));
  const empty=await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--mount',`type=volume,source=${restoredProject}_state,target=/state,readonly`,'--entrypoint','node',helperImage,'-e',"console.log(JSON.stringify(require('node:fs').readdirSync('/state')))"]);assert.equal(empty,'[]');
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--mount',`type=volume,source=${restoredProject}_secrets,target=/run/secrets/bunny`,'--entrypoint','node',helperImage,'-e',"require('node:fs').writeFileSync('/run/secrets/bunny/edge.json',process.argv[1],{mode:384})",secret]);
  const restored=await withOperation({root,project:restoredProject},()=>operate({command:'restore',project:restoredProject,archiveVolume:archive,path:'full',maintenanceHelper:targetHelper},docker));assert.equal(restored.startup,'stopped');
  assert.equal((await selected({project:restoredProject},docker)).State.Pid,0);await archiveCheck(restoredProject);
  const value=await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--mount',`type=volume,source=${restoredProject}_state,target=/state,readonly`,'--entrypoint','node',helperImage,'-e',"const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/state/modules/onn.sqlite',{readOnly:true});console.log(d.prepare('SELECT value FROM synthetic').get().value);d.close();"]);assert.equal(value,'retained ONN state');
  completed=true;console.log(JSON.stringify({schema:'bunny-maintenance-disposable/1.0',outcome:'passed',oldSourceRevision:revision,helperRevision:candidate,checks:['old-helper-refusal','full-byte-exact-config','external-declarations-no-host-access','real-lease-contention','wrong-helper-source-refusal','old-source-helper-attribution','secret-mismatch-unchanged-target','separate-empty-target-roundtrip','retained-inactive-ONN-state'],hostedQualification:'synthetic-controlled-fixture',scope:'core and inactive ONN synthetic state only'}));
} finally {
  if(holder!==undefined){await docker(['stop','--timeout','5',holder]);await docker(['rm',holder]);}
  for(const name of [project,restoredProject]){const info=await selected({project:name},docker);if(info){if(info.State.Running)await docker(['stop','--timeout','30',info.Id]);await docker(['rm',info.Id]);}}
  for(const volume of volumes)await docker(['volume','rm',volume]);
  for(const name of [project,restoredProject])assert.equal(await docker(['ps','-aq','--filter','label=com.docker.compose.project='+name]),'');
  assert.equal(await docker(['volume','ls','-q','--filter','name=^'+project]),'');
  if(completed)await rm(root,{recursive:true});else console.error('Synthetic evidence retained at '+root);
}
