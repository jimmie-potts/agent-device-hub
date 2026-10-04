import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,mkdir,readdir,rmdir} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {canonical} from '../../hub/dist/install/files.js';
import {PrivateStore,readRegular,privateDirectory} from '../dist/storage.js';
const repository='jimmie-potts/agent-device-hub';
const require=(ok,reason)=>{if(!ok)throw new Error(reason);};
const digest=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>canonical(a)===canonical(b);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const identity=x=>x?.kind==='release'&&/^[a-f0-9]{40}$/.test(x.sourceRevision);
const reason=e=>/^[a-z][a-z0-9-]{0,90}$/.test(e?.message??'')?e.message:'hub-install-evidence-unavailable';
const remaining=(request,seconds=0)=>require(request.deadline-Date.now()/1000>=seconds,'hub-install-deadline-reserve');
export function validate(config,input){
 require(exact(config,['schemaVersion','owner','node','sourceRoot','tokenFile','baselineReceipt','installationRoot','stateDirectory','evidenceRoot','reserveSeconds','capacityBytes']),'invalid-hub-install-config');
 require(config.schemaVersion===1&&typeof config.owner==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(config.owner),'invalid-hub-install-owner');
 for(const key of ['node','sourceRoot','tokenFile','installationRoot','stateDirectory','evidenceRoot'])require(typeof config[key]==='string'&&isAbsolute(config[key])&&resolve(config[key])===config[key],'invalid-hub-install-path');
 require(config.baselineReceipt===null||typeof config.baselineReceipt==='string'&&isAbsolute(config.baselineReceipt),'invalid-hub-install-baseline');
 require(Number.isSafeInteger(config.reserveSeconds)&&config.reserveSeconds>=600&&config.reserveSeconds<=3600&&Number.isSafeInteger(config.capacityBytes)&&config.capacityBytes>=1048576&&config.capacityBytes<=1073741824,'invalid-hub-install-bound');
 require(exact(input,['schemaVersion','operation','repository','issue','merge','owner','deadline','evidenceDirectory']),'invalid-hub-install-request');
 require(input.schemaVersion===1&&['install','reconcile'].includes(input.operation)&&input.repository===repository&&Number.isSafeInteger(input.issue)&&input.issue>0&&/^[a-f0-9]{40}$/.test(input.merge)&&input.owner===config.owner&&Number.isFinite(input.deadline),'invalid-hub-install-identity');
 require(typeof input.evidenceDirectory==='string'&&resolve(input.evidenceDirectory)===input.evidenceDirectory&&input.evidenceDirectory.startsWith(config.evidenceRoot+'/'),'invalid-hub-install-evidence');
 require(!config.stateDirectory.startsWith(config.sourceRoot+'/')&&!input.evidenceDirectory.startsWith(config.sourceRoot+'/'),'hub-install-state-in-source');
}
// A native mutation is never killed by this wrapper. The supervisor retains its
// group/claim while the native installer completes or its uncertainty is resolved.
export async function nativeCall(config,args,request,mutation=false){
 const timeout=mutation?undefined:Math.min(120000,Math.max(1,(request.deadline-Date.now()/1000)*1000));
 return new Promise((resolveResult,reject)=>{
  const child=spawn(config.node,[join(config.sourceRoot,'apps/hub/bin/hub-install.mjs'),...args],{cwd:config.sourceRoot,stdio:['ignore','pipe','pipe'],shell:false});
  let size=0,capped=false;const chunks=[];
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size<=8*1024*1024)chunks.push(chunk);else capped=true;});
  child.stderr.on('data',()=>{});
  let killTimer;const timer=timeout===undefined?null:setTimeout(()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),500);},timeout);
  const clear=()=>{if(timer)clearTimeout(timer);if(killTimer)clearTimeout(killTimer);};
  child.on('error',error=>{clear();reject(error);});
  child.on('close',code=>{clear();let value=null;try{if(!capped)value=JSON.parse(Buffer.concat(chunks).toString());}catch{}resolveResult({code,value});});
 });
}
export async function healthRead(plan,config){
 const url=new URL(plan.bound.health.endpoint);
 require(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash,'invalid-hub-health-origin');
 const token=(await readRegular(config.tokenFile,1024,true)).toString().trim();require(/^[A-Za-z0-9_-]{43}$/.test(token),'invalid-hub-read-token');
 const response=await fetch(url.origin+'/api/hub/v1/health',{redirect:'error',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1500)});
 if(!response.ok||!response.body){await response.body?.cancel();throw new Error('hub-health-unavailable');}const parts=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;require(size<=65536,'hub-health-capacity');parts.push(chunk);}
 return JSON.parse(Buffer.concat(parts).toString());
}
function bindPlan(plan,config,input){
 require(plan&&/^[a-f0-9]{64}$/.test(plan.digest)&&plan.bound?.owner===config.owner&&plan.bound.operation==='upgrade'&&plan.bound.source?.target===input.merge&&plan.bound.layout?.root===config.installationRoot&&plan.bound.health?.tokenFile===config.tokenFile,'hub-install-plan-mismatch');
 require(digest(canonical(plan.bound))===plan.digest,'hub-install-plan-digest');
 require(plan.bound.migration===false&&plan.bound.source.comparison?.status==='complete','hub-install-unqualified-migration');
 require(plan.bound.source.clean===true&&plan.bound.source.removedCommits?.length===0,'hub-install-source-unqualified');
 require(Array.isArray(plan.bound.source.components)&&!plan.bound.source.components.some(path=>/^(?:apps\/maintenance\/|apps\/hub\/(?:src\/install\/|bin\/hub-install\.mjs)|scripts\/package-maintenance\.mjs)/.test(path)),'hub-active-machinery-needs-stopped-boundary');
}
async function receiptInventory(config){
 const root=join(config.installationRoot,'receipts'),names=await readdir(root);require(names.length<=10000,'hub-install-receipt-capacity');const rows=[];
 for(const name of names){
  if(!/^op-[a-f0-9-]+\.json$/.test(name))continue;
  const path=join(root,name),bytes=await readRegular(path,4*1024*1024,true),value=JSON.parse(bytes.toString());
  require(validateInstallReceipt(value)&&['succeeded','refused','failed-rolled-back'].includes(value.outcome),'hub-native-barrier-unresolved');
  rows.push({path,sha256:digest(bytes),value});
 }
 return rows;
}
async function inspect(config,operation){
 require((await lstat(config.installationRoot)).isDirectory(),'hub-installation-missing');
 await privateDirectory(config.installationRoot);const path=join(config.installationRoot,'install.lock');
 try{await mkdir(path,{mode:0o700});}catch{throw new Error('hub-native-lock-unavailable');}
 const owned=await lstat(path);
 try{return await operation();}finally{
  const current=await lstat(path);require(current.dev===owned.dev&&current.ino===owned.ino,'hub-native-lock-changed');
  await rmdir(path);
 }
}
async function verifyCurrent(config,input,plan,expected,call,health){
 const args=['status','--token-file',config.tokenFile,...(config.baselineReceipt?['--baseline-receipt',config.baselineReceipt]:[])];
 const first=await call(config,args,input),status=first.value;
 require(first.code===0&&equal(status?.installed?.identity,expected)&&status.service==='active'&&status.running?.state==='active'&&Number.isSafeInteger(status.running.pid)&&status.running.pid>0&&status.running.start&&status.running.executable===plan.bound.layout.node&&status.running.entry===join(status.installed.path,'dist/cli.js'),'hub-running-identity-unverified');
 if(identity(expected))require(status.running.build?.sourceRevision===expected.sourceRevision&&status.running.build.version===expected.version,'hub-running-build-mismatch');
 const value=await health(plan,config);
 require(value.ownerId===plan.bound.stateOwner&&value.collector==='running'&&value.admission==='open','hub-current-health-unverified');
 if(identity(expected))require(value.build?.sourceRevision===expected.sourceRevision&&value.build.version===expected.version,'hub-health-build-mismatch');
 const second=await call(config,args,input);
 require(second.code===0&&equal(second.value?.installed?.identity,expected)&&equal(second.value?.running,status.running),'hub-process-changed');
 return {identity:expected,process:status.running,health:'healthy'};
}
export async function runHubInstall(input,config,{call=nativeCall,health=healthRead}={}){
 let intent=false;
 const output={schemaVersion:1,repository:input?.repository,merge:input?.merge,owner:input?.owner};
 try{
  validate(config,input);remaining(input);
  await privateDirectory(config.evidenceRoot);await privateDirectory(input.evidenceDirectory);
  const store=new PrivateStore(config.stateDirectory,config.capacityBytes);await store.open();
  const evidence=new PrivateStore(input.evidenceDirectory,32*1024*1024);await evidence.open();
  const name=`${input.issue}-${input.merge}.json`;let state=await store.read(name);
  require(!state||state.owner===input.owner&&state.issue===input.issue&&state.merge===input.merge,'hub-install-state-conflict');
  intent=Boolean(state?.intent);
  if(input.operation==='install'){
   require(!state,'hub-install-existing-attempt-needs-reconcile');remaining(input,config.reserveSeconds);
   const result=await call(config,['plan',input.merge,'--owner',config.owner,'--token-file',config.tokenFile,...(config.baselineReceipt?['--baseline-receipt',config.baselineReceipt]:[])],input);
   require(result.code===0,'hub-install-plan-unavailable');const plan=result.value;bindPlan(plan,config,input);
   // Qualification inspected this complete bundle; the native digest refreshes it.
   await evidence.save('native-plan.json',plan);
   const prior=await inspect(config,()=>receiptInventory(config));
   state={schemaVersion:1,owner:input.owner,issue:input.issue,merge:input.merge,plan,deadline:input.deadline,priorReceipts:prior.map(row=>row.path),intent:false};
   // The native entry guard records an attributable refusal if planning used
   // the remaining reserve. Do not leave an unreceipted local dispatch gap.
   await store.save(name,state);
   state.intent=true;await store.save(name,state);intent=true;
   await call(config,['upgrade',input.merge,'--plan',evidence.path('native-plan.json'),'--approve',plan.digest,'--deadline',String(input.deadline)],input,true);
  }else require(state?.intent,'hub-install-reconciliation-state-missing');
  const plan=state.plan;bindPlan(plan,config,input);
  const result=await inspect(config,async()=>{
   const rows=await receiptInventory(config),matches=rows.filter(x=>!state.priorReceipts.includes(x.path)&&x.value.installationId===config.owner&&x.value.approval?.planSha256===plan.digest&&x.value.requestedTarget===input.merge);
   require(matches.length===1,'hub-install-receipt-ambiguous');const receipt=matches[0],native=receipt.value;
   const success=native.outcome==='succeeded';
   const expected=success?native.target:native.previous;
   require(expected&&(!success||identity(expected)&&expected.sourceRevision===input.merge)&&equal(native.previous,plan.bound.previous),'hub-install-receipt-identity');
   if(success)require(equal(native.running?.identity,expected)&&native.health.status==='healthy','hub-install-receipt-health');
   if(native.outcome==='failed-rolled-back')require(native.rollback.status==='succeeded'&&equal(native.running?.identity,expected)&&native.health.status==='healthy','hub-install-recovery-unverified');
   const current=await verifyCurrent(config,input,plan,expected,call,health);
   await evidence.save('installed-readback.json',{receipt:{path:receipt.path,sha256:receipt.sha256},current});
   return success?{...output,status:'installed',installedRevision:input.merge,runningRevision:input.merge,health:'healthy',receipt:{path:receipt.path,sha256:receipt.sha256}}:
    {...output,status:'blocked',effects:native.outcome==='refused'?'none':'reconciled',outcome:native.outcome,baselineIdentity:expected,runningIdentity:current.identity,health:'healthy',locksClear:true,barriersClear:true,receipt:{path:receipt.path,sha256:receipt.sha256}};
  });
  await store.save(name,{...state,result});return result;
 }catch(error){return {...output,status:intent?'uncertain':'blocked',effects:intent?'uncertain':'none',reason:reason(error)};}
}
export async function cli(configPath,input){const config=JSON.parse((await readRegular(configPath,128*1024,true)).toString());return runHubInstall(input,config);}
