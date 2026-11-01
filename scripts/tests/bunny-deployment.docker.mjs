// Explicit disposable exercise only. Every runtime uses fresh volumes, no network, no host port and disabled control.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {docker,operate,selected,maintain} from '../bunny.mjs';
import {deployBatch} from '../deployment/batch.mjs';
import {reconcileOperation,readPending} from '../bunny-operations.mjs';
import {spawn} from 'node:child_process';
const previousImage=process.env.BUNNY_BATCH_TEST_PREVIOUS_IMAGE,targetImage=process.env.BUNNY_BATCH_TEST_TARGET_IMAGE;
if(![previousImage,targetImage].every(value=>/^sha256:[a-f0-9]{64}$/.test(value??'')))throw Error('select two explicit disposable-test images');
const project='batch1365-'+randomUUID().slice(0,8);
const root=await mkdtemp(join(await realpath(tmpdir()),project+'-'));
const compose=join(root,'compose.json');
const volumes=['state','config','secrets'].map(key=>project+'_'+key),archive=project+'_archives';
const image=async id=>JSON.parse(await docker(['image','inspect',id]))[0];
const old=await image(previousImage),target=await image(targetImage);
const previousRevision=old.Config.Labels['org.opencontainers.image.revision'],candidate=target.Config.Labels['org.opencontainers.image.revision'];
assert.equal(old.Architecture,'arm64');assert.equal(target.Architecture,'arm64');
assert.equal(await docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]),'');
const document={services:{core:{image:previousImage,init:true,user:'1000:1000',read_only:true,network_mode:'none',cap_drop:['ALL'],security_opt:['no-new-privileges:true'],
  pids_limit:256,mem_limit:'4g',cpus:2,restart:'no',stop_grace_period:'30s',environment:{BUNNY_CONTROL:'disabled',BUNNY_ACCESS:'isolated'},tmpfs:['/tmp:mode=1777,size=256m'],
  volumes:['state:/var/lib/bunny','config:/etc/bunny:ro','secrets:/run/secrets/bunny:ro']}},volumes:{state:{name:volumes[0]},config:{name:volumes[1]},secrets:{name:volumes[2]}}};
await writeFile(compose,JSON.stringify(document),{mode:0o600});
let completed=false;
try {
  await docker(['compose','-f',compose,'-p',project,'create','--no-build','--pull','never','core']);
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--mount',`type=volume,source=${volumes[1]},target=/etc/bunny`,'--mount',`type=volume,source=${volumes[2]},target=/run/secrets/bunny`,
    '--entrypoint','node',previousImage,'/opt/bunny/deploy/container/provision-local.mjs']);
  await docker(['volume','create',archive]);
  await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--mount',`type=volume,source=${archive},target=/var/lib/bunny`,'--entrypoint','node',previousImage,'-e',"const fs=require('node:fs'),a=require('node:assert/strict');a.equal(fs.statSync('/var/lib/bunny').uid,1000);a.equal(fs.readdirSync('/var/lib/bunny').length,0)"]);
  await operate({command:'start',compose,project},docker);
  const before=await selected({project},docker);
  for(let i=0;i<30;i++){try{const health=JSON.parse(await docker(['exec',before.Id,'node','/opt/bunny/deploy/container/entrypoint.mjs','status']));if(health.status==='ok')break;}catch{}if(i===29)throw Error('initial readiness failed');await delay(500);}
  const request={schema:'bunny-batch-deployment/1.0',operation:'forward',id:'batch-disposable-'+randomUUID(),owner:'disposable-source-exercise',project,compose,
    containerId:before.Id,previousImage,previousRevision,candidate,runId:1,runAttempt:1,includedIssues:['https://github.com/jimmie-potts/agent-device-hub/issues/1365'],
    requiredModules:['core'],client:'trusted-browser',forward:{assessment:'Disposable same-format core test only.',evidence:'real stopped backup and candidate startup'},recovery:{status:'unknown'},backup:{volume:archive,name:'before-upgrade'}};
  const qualification=async()=>({candidate,outcome:'qualified',architecture:'linux/arm64',image:{id:targetImage},runId:1,runAttempt:1});
  const result=await deployBatch(request,{root,run:docker,qualification});assert.equal(result.outcome,'succeeded');
  const after=await selected({project},docker);assert.equal(after.Image,targetImage);assert.notEqual(after.Id,before.Id);
  const record=JSON.parse(await readFile(join(root,project+'.records',request.id+'.json'),'utf8'));assert.ok(record.writerReleasedAt);
  assert.deepEqual(after.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name).sort(),volumes.slice().sort());
  await operate({command:'stop',project,compose},docker);
  // Reopen the candidate's genuinely written latest store with the previous production reader, on a disposable copy.
  const readerProgram=`import{cp,mkdir}from'node:fs/promises';import{spawn}from'node:child_process';import{setTimeout as wait}from'node:timers/promises';await mkdir('/tmp/reader',{mode:0o700});await cp('/latest','/tmp/reader/state',{recursive:true});const child=spawn('node',['/opt/bunny/deploy/container/entrypoint.mjs','start'],{env:{...process.env,BUNNY_ACCESS:'isolated',BUNNY_CONTROL:'disabled',BUNNY_PORT:'8788',BUNNY_STATE_DIR:'/tmp/reader/state'},stdio:'ignore'});let healthy=false;try{for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:8788/api/runtime/v1/health',{signal:AbortSignal.timeout(500)});const h=await r.json();if(h.status==='ok'&&h.modules.some(m=>m.name==='core'&&m.state==='running')){healthy=true;break;}}catch{}await wait(250);}if(!healthy)throw Error('previous runtime refused latest copied state');console.log(JSON.stringify({previousReader:'core-runtime-reopen',status:'ok'}));}finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}`;
  const reader=JSON.parse(await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--tmpfs','/tmp:mode=1777,size=256m','--mount',`type=volume,source=${volumes[0]},target=/latest,readonly`,
    '--mount',`type=volume,source=${volumes[1]},target=/etc/bunny,readonly`,'--mount',`type=volume,source=${volumes[2]},target=/run/secrets/bunny,readonly`,
    '--entrypoint','node',previousImage,'--input-type=module','-e',readerProgram]));
  assert.equal(reader.status,'ok');
  const failedRequest={...request,id:'batch-failed-client-'+randomUUID(),containerId:after.Id,previousImage:targetImage,previousRevision:candidate,backup:{volume:archive,name:'before-failed-client'}};
  await assert.rejects(deployBatch(failedRequest,{root,qualification,run:async args=>{
    if(args[0]==='exec'&&args.includes('-e')){
      await docker(['exec',args[1],'node','-e',"require('node:fs').writeFileSync('/var/lib/bunny/deployment-test.txt','candidate latest data',{mode:384})"]);
      throw Error('synthetic client refusal');
    }
    return docker(args);
  }}));
  let failed=await selected({project},docker);assert.equal(failed.State.Pid,0);assert.equal(failed.Image,targetImage);
  assert.equal((await readPending({root,project})).replacementStop,'verified-stopped');
  await assert.rejects(maintain({command:'start',project,compose},docker,undefined,root));
  await reconcileOperation({root,project},async()=>({id:failed.Id,image:failed.Image,status:failed.State.Status,pid:failed.State.Pid}));
  const interrupted={...failedRequest,id:'batch-interrupted-'+randomUUID(),containerId:failed.Id,backup:{volume:archive,name:'before-interrupted'}};
  const batchUrl=new URL('../deployment/batch.mjs',import.meta.url).href,bunnyUrl=new URL('../bunny.mjs',import.meta.url).href;
  const program=`import{deployBatch}from ${JSON.stringify(batchUrl)};import{docker}from ${JSON.stringify(bunnyUrl)};const request=${JSON.stringify(interrupted)},root=${JSON.stringify(root)},target=${JSON.stringify(await qualification())};await deployBatch(request,{root,qualification:async()=>target,run:async args=>{const result=await docker(args);if(args[0]==='compose'&&args.includes('create')){process.stdout.write('replacement-created\\n');setInterval(()=>{},1000);await new Promise(()=>{});}return result;}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('interruption child exited '+code+' '+stderr)));});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  const pending=await readPending({root,project});assert.equal(pending.phase,'creating-replacement');
  await assert.rejects(maintain({command:'start',project,compose},docker,undefined,root));
  failed=await selected({project},docker);assert.equal(failed.State.Pid,0);assert.equal(failed.Image,targetImage);
  const retained=await docker(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000',
    '--mount',`type=volume,source=${volumes[0]},target=/latest,readonly`,'--entrypoint','node',targetImage,'-e',"console.log(require('node:fs').readFileSync('/latest/deployment-test.txt','utf8'))"]);
  assert.equal(retained,'candidate latest data');
  const reconciled=await reconcileOperation({root,project},async()=>({id:failed.Id,image:failed.Image,status:failed.State.Status,pid:failed.State.Pid}));
  const returnRequest={...interrupted,operation:'return',id:'batch-return-'+randomUUID(),containerId:failed.Id,candidate:previousRevision,recovery:{status:'qualified'},backup:{volume:archive,name:'before-return'}};
  const compatibility={schema:'bunny-image-return/1.0',outcome:'compatible',image:previousImage,revision:previousRevision,
    stateSha256:reconciled.backupIdentity.stateSha256,configSha256:reconciled.backupIdentity.configSha256,evidence:'previous production core reopened copied latest synthetic state'};
  await deployBatch(returnRequest,{root,run:docker,compatibility,qualification:async()=>({candidate:previousRevision,outcome:'qualified',architecture:'linux/arm64',image:{id:previousImage},runId:1,runAttempt:1})});
  const returned=await selected({project},docker);assert.equal(returned.Image,previousImage);
  assert.equal(await docker(['exec',returned.Id,'node','-e',"console.log(require('node:fs').readFileSync('/var/lib/bunny/deployment-test.txt','utf8'))"]),'candidate latest data');
  completed=true;process.stdout.write(JSON.stringify({schema:'bunny-batch-disposable/1.0',project,outcome:'passed',previousRevision,candidate,
    checks:['stopped-backup','exact-image','preserved-volumes','health','trusted-browser-sign-in-check-logout','private-release-record','previous-core-runtime-copy-reopen','failed-client-stops-replacement','latest-data-preserved','real-process-kill-after-create','unfinished-manual-start-refusal','explicit-dead-owner-reconciliation','explicit-compatible-image-return-preserves-latest-data'],
    recovery:'qualified-disposable-core-only',hostedQualification:'synthetic-injected-only'})+'\n');
} finally {
  const info=await selected({project},docker);
  if(info){if(info.State.Running)await docker(['stop','--timeout','30',info.Id]);await docker(['rm',info.Id]);}
  for(const volume of [...volumes,archive])await docker(['volume','rm',volume]);
  assert.equal(await docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]),'');
  if(completed)await rm(root,{recursive:true});else process.stderr.write('Disposable evidence retained at '+root+'\n');
}
