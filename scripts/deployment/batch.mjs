import {readFile} from 'node:fs/promises';
import {refusalFields} from '../operator-refusal.mjs';
import {maintenanceHelperFor,maintenanceHelperDetails} from './maintenance-helper.mjs';
import {Outcome} from '../../packages/sdk/dist/src/evidence.js';
import {setTimeout as delay} from 'node:timers/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {operate,selected,access,container,stopped,privateHostDirectory,ordinaryVolume} from '../bunny.mjs';
import {withOperation,privateJson,writeNewPrivateJson} from '../bunny-operations.mjs';

const SHA=/^[a-f0-9]{40}$/,IMAGE=/^sha256:[a-f0-9]{64}$/,ID=/^[a-f0-9]{64}$/;
const refuse=()=>{throw new Error('deployment-refused');};
const keys=(value,names)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateRequest(request) {
  if(!keys(request,['schema','operation','id','owner','project','compose','containerId','previousImage','previousRevision','candidate','runId','runAttempt','includedIssues','requiredModules','client','forward','recovery','backup'])
    ||!keys(request.forward,['assessment','evidence'])||!keys(request.recovery,['status'])||!keys(request.backup,['volume','name'])
    ||request?.schema!=='bunny-batch-deployment/1.0'||!['forward','return'].includes(request.operation)
    ||!/^batch-[a-zA-Z0-9_.-]{1,100}$/.test(request.id??'')||typeof request.owner!=='string'||request.owner.length<1||request.owner.length>200
    ||!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(request.project??'')||!ID.test(request.containerId??'')
    ||!IMAGE.test(request.previousImage??'')||!SHA.test(request.previousRevision??'')||!SHA.test(request.candidate??'')
    ||!Number.isSafeInteger(request.runId)||request.runId<1||!Number.isSafeInteger(request.runAttempt)||request.runAttempt<1
    ||typeof request.compose!=='string'||!request.compose.startsWith('/')
    ||!Array.isArray(request.includedIssues)||request.includedIssues.length<1||request.includedIssues.length>100
    ||request.includedIssues.some(url=>!/^https:\/\/github.com\/jimmie-potts\/agent-device-hub\/issues\/[1-9][0-9]*$/.test(url))
    ||!Array.isArray(request.requiredModules)||request.requiredModules.length>64||!request.requiredModules.includes('core')||request.requiredModules.some(name=>!/^[a-z][a-z0-9-]{0,62}$/.test(name))
    ||request.operation==='return'&&request.recovery?.status!=='qualified'
    ||request.client!=='trusted-browser'||typeof request.forward?.assessment!=='string'||!request.forward.assessment.trim()||request.forward.assessment.length>8192
    ||typeof request.forward?.evidence!=='string'||!request.forward.evidence.trim()||request.forward.evidence.length>8192
    ||!['unknown','qualified'].includes(request.recovery?.status)
    ||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(request.backup?.volume??'')
    ||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(request.backup?.name??''))refuse();
  return request;
}
export function validateReturn(request,receipt,backup,target) {
  if(request.operation!=='return')return;
  if(!keys(receipt,['schema','outcome','image','revision','stateSha256','configSha256','evidence'])||request.recovery.status!=='qualified'||receipt?.schema!=='bunny-image-return/1.0'||receipt.outcome!=='compatible'
    ||receipt.image!==target.image.id||receipt.revision!==request.candidate||receipt.stateSha256!==backup.stateSha256
    ||receipt.configSha256!==backup.configSha256||typeof receipt.evidence!=='string'||!receipt.evidence.trim()||receipt.evidence.length>8192)refuse();
}
function identity(info,project) {
  return {mounts:container(info,project).map(({Destination,Name,RW,Type})=>({Destination,Name,RW,Type})).sort((a,b)=>a.Destination.localeCompare(b.Destination)),
    network:info.HostConfig.NetworkMode,ports:info.HostConfig.PortBindings??{},environment:[...(info.Config.Env??[])].sort(),
    user:info.Config.User,access:info.Config.Labels['io.bunny.access'],restart:info.HostConfig.RestartPolicy.Name};
}
export function replacementCompose(rendered,info,targetImage,project) {
  if(!rendered||Object.keys(rendered.services??{}).length!==1||!rendered.services.core)refuse();
  const document=structuredClone(rendered),core=document.services.core;
  const allowed=new Set(['image','init','user','read_only','network_mode','cap_drop','security_opt','pids_limit','mem_limit','cpus','restart','stop_grace_period','environment','tmpfs','volumes','labels','ports','networks','entrypoint','command','container_name']);
  if(Object.keys(core).some(key=>!allowed.has(key)))refuse();
  const entrypoint=['node','/opt/bunny/deploy/container/entrypoint.mjs'],command=['start'];
  if(!isDeepStrictEqual(info.Config.Entrypoint,entrypoint)||!isDeepStrictEqual(info.Config.Cmd,command)
    ||core.entrypoint!=null&&!isDeepStrictEqual(core.entrypoint,entrypoint)
    ||core.command!=null&&!isDeepStrictEqual(core.command,command)
    ||info.HostConfig.Privileged===true||info.HostConfig.ReadonlyRootfs!==true
    ||!isDeepStrictEqual(info.HostConfig.CapDrop,['ALL'])||!isDeepStrictEqual(info.HostConfig.SecurityOpt,['no-new-privileges:true'])
    ||(info.HostConfig.CapAdd??[]).length!==0||(info.HostConfig.Devices??[]).length!==0)refuse();
  if(core.build!==undefined||core.pull_policy==='always'||core.privileged===true||core.user!=='1000:1000'
    ||core.read_only!==true||!Array.isArray(core.volumes)||core.volumes.length!==3)refuse();
  const oldMounts=container(info,project);
  for(const volume of core.volumes) {
    const old=oldMounts.find(m=>m.Destination===volume.target);
    if(volume.type!=='volume'||!old||Boolean(volume.read_only)!==!old.RW)refuse();
    const declaration=document.volumes?.[volume.source];
    if(!declaration||declaration.name!==old.Name)refuse();
    document.volumes[volume.source]={name:old.Name,external:true};
  }
  if(info.HostConfig.NetworkMode==='none') {
    if(core.network_mode!=='none')refuse();
  } else {
    if(Object.keys(core.networks??{}).length!==1||!Object.hasOwn(core.networks,'local')||document.networks?.local?.name!==info.HostConfig.NetworkMode)refuse();
    document.networks.local={name:info.HostConfig.NetworkMode,external:true};
  }
  if(!isDeepStrictEqual(core.environment??{},Object.fromEntries((info.Config.Env??[]).filter(row=>row.startsWith('BUNNY_')).map(row=>{const at=row.indexOf('=');return [row.slice(0,at),row.slice(at+1)];}))))refuse();
  const ports=(core.ports??[]).map(p=>({host:p.host_ip,hostPort:String(p.published),target:String(p.target),protocol:p.protocol??'tcp'}));
  const expected=Object.entries(info.HostConfig.PortBindings??{}).flatMap(([key,bindings])=>bindings.map(p=>({host:p.HostIp,hostPort:p.HostPort,target:key.split('/')[0],protocol:key.split('/')[1]})));
  if(!isDeepStrictEqual(ports,expected))refuse();
  document.name=project;core.image=targetImage;delete core.pull_policy;
  return document;
}
export const CLIENT_PROBE=`const assert=require('node:assert/strict');(async()=>{const port=process.env.BUNNY_PORT??(process.env.BUNNY_ACCESS==='isolated'?'8788':'18788');const origin='http://127.0.0.1:'+port;const headers={'origin':origin,'bunny-request':'1','content-type':'application/json'};const call=(path,extra={})=>fetch(origin+path,{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(3000),...extra});const response=await call('/api/v2/browser/session');assert.equal(response.status,200);assert.equal((await response.json()).schema,'browser-session/2.0');const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);const check=await call('/api/v2/browser/check',{headers:{...headers,cookie}});assert.equal(check.status,200);assert.equal((await check.json()).active,true);const out=await call('/api/v2/browser/logout',{headers:{...headers,cookie}});assert.equal(out.status,200);console.log(JSON.stringify({client:'trusted-browser',status:'passed'}));})().catch(()=>{console.error('client-check-failed');process.exitCode=1;});`;
async function backupIdentity(request,info,run) {
  const result=JSON.parse(await run(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL',
    '--security-opt','no-new-privileges','--mount',`type=volume,source=${request.backup.volume},target=/backup,readonly`,
    '--entrypoint','node',info.Image,'-e',"const fs=require('node:fs'),c=require('node:crypto');const b=fs.readFileSync(process.argv[1]);const m=JSON.parse(b);console.log(JSON.stringify({manifestSha256:c.createHash('sha256').update(b).digest('hex'),stateSha256:c.createHash('sha256').update(JSON.stringify({configSha256:m.configSha256,references:m.references,directories:m.directories,files:m.files})).digest('hex'),configSha256:m.configSha256}));",'/backup/'+request.backup.name+'/manifest.json']));
  if(!/^[a-f0-9]{64}$/.test(result.stateSha256??'')||!/^[a-f0-9]{64}$/.test(result.manifestSha256??'')||!/^[a-f0-9]{64}$/.test(result.configSha256??''))refuse();return result;
}
export async function deployBatch(request,{run,qualification,root,compatibility}={}) {
  validateRequest(request);
  const target=await qualification(request);
  if(target.runId!==request.runId||target.runAttempt!==request.runAttempt||target.candidate!==request.candidate||!IMAGE.test(target.image?.id??'')||target.architecture!=='linux/arm64'||target.outcome!=='qualified')refuse();
  const imageRows=JSON.parse(await run(['image','inspect',target.image.id]));
  if(imageRows.length!==1||imageRows[0].Id!==target.image.id||imageRows[0].Architecture!=='arm64'||imageRows[0].Os!=='linux'
    ||imageRows[0].Config?.Labels?.['org.opencontainers.image.revision']!==request.candidate)refuse();
  return withOperation({project:request.project,root},async lease=>{
    const before=await selected(request,run);
    if(before?.Id!==request.containerId||before.Image!==request.previousImage)refuse();
    const previous=JSON.parse(await run(['image','inspect',before.Image]));
    if(previous.length!==1||previous[0].Config?.Labels?.['org.opencontainers.image.revision']!==request.previousRevision)refuse();
    await access(before,request.project,run);
    const preserved=identity(before,request.project);
    if(preserved.mounts.some(m=>m.Name===request.backup.volume))refuse();
    for(const name of [...preserved.mounts.map(m=>m.Name),request.backup.volume])await ordinaryVolume(name,run);
    const archiveCheck=JSON.parse(await run(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL',
      '--security-opt','no-new-privileges','--mount',`type=volume,source=${request.backup.volume},target=/backup,readonly`,
      '--entrypoint','node',before.Image,'-e',"const fs=require('node:fs'),a=require('node:assert/strict');const s=fs.statSync('/backup');a.equal(s.uid,1000);a.equal(s.mode&511,448);try{fs.lstatSync(process.argv[1]);throw Error('archive-preflight-refused');}catch(e){if(e.code!=='ENOENT')throw e;}console.log(JSON.stringify({status:'absent'}));",'/backup/'+request.backup.name]));
    if(archiveCheck.status!=='absent')refuse();
    const composeBytes=await readFile(request.compose);
    const rendered=JSON.parse(await run(['compose','-f',request.compose,'-p',request.project,'config','--format','json']));
    const replacement=replacementCompose(rendered,before,target.image.id,request.project);
    await privateHostDirectory(dirname(request.compose));
    const replacementPath=request.compose+'.'+request.id+'.json';

    let record={...request,schema:'bunny-batch-record/1.0',targetImage:target.image.id,qualification:{runId:target.runId,runAttempt:target.runAttempt},
      replacementCompose:replacementPath,previous:{image:before.Image,revision:request.previousRevision,container:before.Id},preserved,composeSha256:hash(composeBytes),phase:'prepared',outcome:Outcome.uncertain,startedAt:new Date().toISOString()};
    const phase=async name=>{record={...record,phase:name};await lease.record(record);};
    await phase('preparing-compose');
    let replacementId;
    try {
      await writeNewPrivateJson(replacementPath,replacement);await phase('prepared');
      if(hash(await readFile(request.compose))!==record.composeSha256)refuse();
      const current=await selected(request,run);
      if(current?.Id!==before.Id||!isDeepStrictEqual(identity(current,request.project),preserved))refuse();
      await phase('stopping');await operate({...request,command:'stop'},run);
      await phase('backing-up');
      const maintenanceHelper=maintenanceHelperFor(target);
      if(maintenanceHelper!==undefined)record.backupHelper=maintenanceHelperDetails(maintenanceHelper);
      record.backupResult=await operate({...request,command:'backup',archiveVolume:request.backup.volume,path:request.backup.name,...(maintenanceHelper===undefined?{}:{maintenanceHelper})},run);
      const backup=await backupIdentity(request,before,run);record.backupIdentity=backup;
      validateReturn(request,compatibility,backup,target);
      const stoppedCurrent=await selected(request,run);if(stoppedCurrent?.Id!==before.Id)refuse();stopped(stoppedCurrent);
      await phase('removing-stopped-container');await run(['rm',before.Id]);
      await phase('creating-replacement');await run(['compose','-f',replacementPath,'-p',request.project,'create','--no-build','--pull','never','core']);
      let after=await selected(request,run);replacementId=after?.Id;
      if(!after||after.Image!==target.image.id||!isDeepStrictEqual(identity(after,request.project),preserved))refuse();
      stopped(after);await access(after,request.project,run);
      record.replacementContainer=after.Id;await phase('starting');
      await operate({...request,compose:replacementPath,command:'start'},run);
      after=await selected(request,run);
      if(after?.Id!==replacementId||after.Image!==target.image.id||after.State.Running!==true)refuse();
      await phase('checking-health');
      let health,ready=false;
      const deadline=Date.now()+30000;
      while(Date.now()<=deadline) {
        try {
          health=JSON.parse(await run(['exec',replacementId,'node','/opt/bunny/deploy/container/entrypoint.mjs','status']));
          if(health.schema==='runtime-health/1.0'&&health.status==='ok'&&request.requiredModules.every(name=>health.modules?.some(row=>row.name===name&&row.state==='running'))){ready=true;break;}
        } catch {health=undefined;}
        if(Date.now()>=deadline)refuse();
        await delay(500);
      }
      if(!ready)refuse();
      record.health={status:health.status,modules:request.requiredModules};await phase('checking-client');
      const client=JSON.parse(await run(['exec',replacementId,'node','-e',CLIENT_PROBE]));
      if(client.client!=='trusted-browser'||client.status!=='passed')refuse();
      record={...record,clientResult:client,phase:'succeeded',outcome:Outcome.succeeded,completedAt:new Date().toISOString(),replacementCompose:replacementPath};
      await lease.complete(record);return {operation:request.id,outcome:Outcome.succeeded,revision:request.candidate,image:target.image.id,writerRelease:'recorded-after-unlock'};
    } catch(error) {
      try {const actual=await selected(request,run);record.observation=actual===undefined?{status:'not-created'}:{id:actual.Id,image:actual.Image,status:actual.State.Status,pid:actual.State.Pid,identity:identity(actual,request.project)};}catch{record.observation={status:'unknown'};}
      if(replacementId===undefined&&record.observation.image===target.image.id&&record.observation.id!==before.Id)replacementId=record.observation.id;
      let stop='not-needed';
      if(replacementId!==undefined) {
        try {const owned=await selected(request,run);if(owned?.Id!==replacementId)refuse();await operate({...request,command:'stop'},run);stop='verified-stopped';}
        catch {stop='uncertain';}
      }
      record={...record,refusal:refusalFields(error),outcome:stop==='uncertain'||record.observation.status==='unknown'?Outcome.uncertain:Outcome.failed,failedPhase:record.phase,replacementStop:stop,failedAt:new Date().toISOString()};
      await lease.record(record);throw error;
    }
  });
}
export async function readRequest(path) {await privateHostDirectory(dirname(path));const request=await privateJson(path);return validateRequest(request);}
