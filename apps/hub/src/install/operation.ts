import {randomUUID} from 'node:crypto';
import {mkdir,lstat,readdir,rename,symlink,rm,open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {canonical,sha256,readRegular,inventory,verifyRelease,type Identity} from './files.js';
import {assertApproval,inspectInstalled,protectedPath,configurationInventory,type Plan,type ServiceObservation} from './plan.js';
import {ownedDirectory,retainLegacy,retainRelease,switchCurrent,syncDirectory,writeDurable} from './stage.js';
import {pruneReleases} from './retention.js';

export type HealthProof={identity:Identity;process:ServiceObservation;program:string;owner:string;collector:string;admission:string;assets:boolean;launchSocket:boolean;browserSecurity:boolean};
export type ServiceControl={observe:()=>Promise<ServiceObservation>;stop:()=>Promise<void>;start:()=>Promise<void>;inspect:<T>(read:()=>Promise<T>)=>Promise<T>;health:(program:string,identity:Identity)=>Promise<HealthProof>};
export type OperationInput={plan:()=>Promise<Plan>;approvedDigest:string;prepare:()=>Promise<{path:string;identity:Identity}>;
 qualify:(previous:string,target:string)=>Promise<{status:string;evidenceSha256?:string}>;service:ServiceControl;
 state:{capture:()=>Promise<unknown>;preserved:(before:unknown,after:unknown)=>boolean};checkpoint?:(phase:string)=>Promise<void>};
type Phase='preflight'|'stage'|'intent'|'stop'|'backup'|'switch'|'start'|'health'|'rollback'|'receipt-finalization'|'recovery';
export type Receipt={schemaVersion:'install-receipt/1.0';operationId:string;operation:'migrate'|'upgrade'|'rollback';runtime:'hub';installationId:string;
 startedAt:string;updatedAt:string;completedAt:string|null;requestedTarget:string;previous:Identity|null;target:Identity|null;
 approval:{planSha256:string;baselineSha256:string;configurationSha256:string};compatibility:{status:string;evidence:string|null};backup:{reference:string;sha256:string}|null;
 running:{identity:Identity;verification:'build-health'|'legacy-process-artifacts';evidence:string}|null;health:{status:string;evidence:string|null};
 failure:{phase:Phase;code:string;evidence:string|null}|null;rollback:{status:string;evidence:string|null};statePreservation:{strategy:'latest-durable-state';evidence:string|null};outcome:string};
const now=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const safeCode=(error:unknown)=>error instanceof Error&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(error.message)?error.message:'install-operation-failed';
async function bounded<T>(operation:()=>Promise<T>,ms:number):Promise<T>{
 let timer:NodeJS.Timeout|undefined;
 try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('install-operation-timeout')),ms);})]);}finally{clearTimeout(timer);}
}
async function verifyProgram(path:string,identity:Identity):Promise<void>{
 if(identity.kind==='release')await verifyRelease(path,identity);
 else if((await inventory(path)).sha256!==identity.contentSha256||sha256(await readRegular(join(path,'manifest.json')))!==identity.manifestSha256)throw new Error('install-legacy-hash');
}
async function backupState(source:string,destination:string):Promise<{reference:string;sha256:string}>{
 await ownedDirectory(destination);
 async function copy(from:string,to:string):Promise<void>{
  for(const entry of await readdir(from,{withFileTypes:true})){
   const input=join(from,entry.name),output=join(to,entry.name),stat=await lstat(input);
   if(stat.isSocket())continue;
   if(stat.isSymbolicLink()||stat.uid!==process.getuid!())throw new Error('unsafe-backup-entry');
   if(stat.isDirectory()){await mkdir(output,{mode:0o700});await copy(input,output);}
   else if(stat.isFile()){
    const bytes=await readRegular(input),file=await open(output,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    if(sha256(await readRegular(input))!==sha256(bytes))throw new Error('backup-source-changed');
   }else throw new Error('unsafe-backup-entry');
  }
  await syncDirectory(to);
 }
 await copy(source,destination);await syncDirectory(dirname(destination));
 return {reference:destination,sha256:(await inventory(destination)).sha256};
}
async function protectedUnchanged(plan:Plan):Promise<void>{
 if(sha256(await readRegular(plan.bound.layout.config))!==plan.bound.hostConfigurationSha256)throw new Error('install-configuration-changed');
 if(sha256(canonical(await configurationInventory(plan.bound.layout.state)))!==plan.bound.configurationSha256)throw new Error('install-configuration-changed');
 for(const saved of plan.bound.protectedPaths)if(canonical(await protectedPath(saved.path))!==canonical(saved))throw new Error('install-shared-path-changed');
 const expected=plan.bound.sharedParent,actual=await lstat(expected.path);
 if(!actual.isDirectory()||actual.isSymbolicLink()||actual.dev!==expected.device||actual.ino!==expected.inode||actual.uid!==expected.uid||(actual.mode&0o777)!==expected.mode)throw new Error('install-shared-parent-changed');
}
function assertHealth(proof:HealthProof,plan:Plan,path:string,identity:Identity,before:ServiceObservation,initial=false):void{
 const current=proof.process;
 if(canonical(proof.identity)!==canonical(identity)||proof.program!==path||current.entry!==join(path,'dist/cli.js')||current.state!=='active'||!current.pid||!current.start||(!initial&&(current.start===before.start||current.pid===before.pid))||current.executable!==plan.bound.layout.node||
  proof.owner!==plan.bound.stateOwner||proof.collector!=='running'||proof.admission!=='open'||!proof.assets||!proof.launchSocket||!proof.browserSecurity)throw new Error('install-health-unverified');
 if(identity.kind==='release'&&(current.build?.sourceRevision!==identity.sourceRevision||current.build.version!==identity.version))throw new Error('install-running-identity');
}
/** The CLI supplies the fixed systemd adapter; isolated tests supply fake service effects. */
export async function executeOperation(input:OperationInput):Promise<{receipt:Receipt;path:string;diagnostic:string|null;retention:unknown}>{
 const initial=await input.plan();assertApproval(initial,input.approvedDigest);
 const root=initial.bound.layout.root,lock=join(root,'install.lock');
 await ownedDirectory(root);
 try{await mkdir(lock,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('install-operation-unresolved');throw error;}
 const operationId='op-'+randomUUID(),path=join(root,'receipts',operationId+'.json'),evidence=join(root,'receipts',operationId+'-evidence.json');
 let releaseLock=false,phase:Phase='preflight',switched=false,adoptionIncomplete=false,diagnostic:string|null=null;
 const startedAt=now();
 const receipt:Receipt={schemaVersion:'install-receipt/1.0',operationId,operation:initial.bound.migration?'migrate':initial.bound.operation,runtime:'hub',installationId:initial.bound.owner,
  startedAt,updatedAt:startedAt,completedAt:null,requestedTarget:initial.bound.requestedTarget,previous:initial.bound.previous,target:null,
  approval:{planSha256:initial.digest,baselineSha256:initial.bound.baselineSha256,configurationSha256:initial.bound.configurationSha256},compatibility:{status:'unknown',evidence:null},backup:null,
  running:null,health:{status:'not-checked',evidence:null},failure:null,rollback:{status:'not-attempted',evidence:null},statePreservation:{strategy:'latest-durable-state',evidence:null},outcome:'in-progress'};
 const observations:Record<string,unknown>={};
 const persist=async()=>{if(!validateInstallReceipt(receipt))throw new Error('invalid-install-receipt');await writeDurable(path,receipt);};
 const checkpoint=async(name:string)=>{await writeDurable(evidence,{operationId,phase:name,observations});await input.checkpoint?.(name);};
 const stop=async()=>{await bounded(input.service.stop,initial.bound.outage.stopTimeoutMs);const stopped=await input.service.observe();if(stopped.state!=='inactive'||stopped.pid!==null)throw new Error('install-owner-still-running');};
 let previousPath='',before:ServiceObservation|null=null,stateBefore:unknown;
 try{
  await writeDurable(join(lock,'owner.json'),{operationId,pid:process.pid,planSha256:initial.digest});await syncDirectory(root);
  await ownedDirectory(join(root,'receipts'));await ownedDirectory(join(root,'backups'));
  // A stale intent is not made safe by an operator deleting only its lock.
  for(const file of await readdir(join(root,'receipts'))){
   if(!/^op-[a-f0-9-]+\.json$/.test(file))continue;
   const old=JSON.parse((await readRegular(join(root,'receipts',file))).toString()) as Receipt;
   if(!validateInstallReceipt(old)||!['succeeded','failed-rolled-back','refused'].includes(old.outcome))throw new Error('install-operation-unresolved');
  }
  const plan=await input.plan();assertApproval(plan,input.approvedDigest);await protectedUnchanged(plan);
  await writeDurable(join(root,'receipts',operationId+'-plan.json'),plan);
  before=await input.service.observe();if(before.state!=='active'||!before.pid||!before.start)throw new Error('install-baseline-not-running');
  const installed=await inspectInstalled(plan.bound.layout);
  const baselineHealth=await bounded(()=>input.service.health(installed.path,installed.identity),plan.bound.outage.healthTimeoutMs);
  assertHealth(baselineHealth,plan,installed.path,installed.identity,before,true);observations.baselineHealth=baselineHealth;phase='stage';
  const target=await input.prepare();receipt.target=target.identity;
  if(plan.bound.operation==='upgrade'&&(target.identity.kind!=='release'||target.identity.sourceRevision!==plan.bound.source.target))throw new Error('install-target-changed');
  if(plan.bound.operation==='rollback'&&canonical(target.identity)!==canonical(plan.bound.target))throw new Error('install-target-changed');
  const expectedPath=target.identity.kind==='release'?join(root,'releases',target.identity.sourceRevision):join(root,'legacy',target.identity.legacyId);
  if(target.path!==expectedPath)throw new Error('unknown-install-target');await verifyProgram(target.path,target.identity);
  previousPath=installed.identity.kind==='legacy'?await retainLegacy(root,installed.path,installed.identity):installed.adopted?installed.path:await retainRelease(root,installed.path,installed.identity);
  observations.recovery={path:previousPath,identity:installed.identity};observations.target=target;
  const compatibility=await input.qualify(previousPath,target.path);
  if(compatibility.status!=='compatible'||!compatibility.evidenceSha256)throw new Error('install-rollback-unqualified');
  receipt.compatibility={status:'compatible',evidence};observations.compatibility=compatibility;
  // Staging and qualification can be slow; recheck the approved baseline immediately before intent.
  assertApproval(await input.plan(),input.approvedDigest);await protectedUnchanged(plan);await verifyProgram(target.path,target.identity);await verifyProgram(previousPath,installed.identity);
  phase='intent';await checkpoint('intent');await persist();
  phase='stop';await checkpoint('stopping');await stop();
  phase='backup';stateBefore=await input.state.capture();observations.before=stateBefore;
  receipt.backup=await backupState(plan.bound.layout.state,join(root,'backups',operationId));
  if(canonical(await input.state.capture())!==canonical(stateBefore))throw new Error('install-state-changed-while-stopped');
  await protectedUnchanged(plan);phase='switch';
  if(plan.bound.migration){
   await switchCurrent(root,previousPath);
   const history=plan.bound.layout.entry+'.prev-'+operationId;observations.history=history;
   await checkpoint('legacy-rename-intent');adoptionIncomplete=true;
   await rename(plan.bound.layout.entry,history);await syncDirectory(dirname(history));await checkpoint('legacy-renamed');
   await symlink(join(root,'current'),plan.bound.layout.entry);await syncDirectory(dirname(plan.bound.layout.entry));await checkpoint('legacy-forwarded');adoptionIncomplete=false;
  }
  await checkpoint('switch-intent');switched=true;await switchCurrent(root,target.path);await checkpoint('target-selected');
  if(canonical(await input.state.capture())!==canonical(stateBefore))throw new Error('install-state-changed-during-switch');
  phase='start';await bounded(input.service.start,plan.bound.outage.stopTimeoutMs);
  phase='health';const health=await bounded(()=>input.service.health(target.path,target.identity),plan.bound.outage.healthTimeoutMs);assertHealth(health,plan,target.path,target.identity,before);observations.health=health;
  const after=await input.service.inspect(input.state.capture);if(!input.state.preserved(stateBefore,after))throw new Error('install-state-not-preserved');observations.after=after;await protectedUnchanged(plan);
  const finalHealth=await bounded(()=>input.service.health(target.path,target.identity),plan.bound.outage.healthTimeoutMs);assertHealth(finalHealth,plan,target.path,target.identity,before);observations.finalHealth=finalHealth;
  receipt.running={identity:target.identity,verification:target.identity.kind==='release'?'build-health':'legacy-process-artifacts',evidence};receipt.health={status:'healthy',evidence};receipt.statePreservation.evidence=evidence;receipt.outcome='succeeded';releaseLock=true;
 }catch(error){
  receipt.failure={phase,code:safeCode(error),evidence};observations.failure={phase,code:safeCode(error)};
  if(adoptionIncomplete){receipt.outcome='interrupted';receipt.failure.phase='recovery';receipt.health={status:'unknown',evidence};}
  else if(switched&&before){
   const originalPhase=phase;
   try{
    phase='rollback';await checkpoint('recovery-stop');await stop();
    const latest=await input.state.capture();observations.latestBeforeRecovery=latest;
    await verifyProgram(previousPath,initial.bound.previous);await protectedUnchanged(initial);
    const recoveringFrom=await input.service.observe();await switchCurrent(root,previousPath);
    if(canonical(await input.state.capture())!==canonical(latest))throw new Error('install-state-changed-during-recovery');
    await bounded(input.service.start,initial.bound.outage.stopTimeoutMs);
    const health=await bounded(()=>input.service.health(previousPath,initial.bound.previous),initial.bound.outage.healthTimeoutMs);
    assertHealth(health,initial,previousPath,initial.bound.previous,recoveringFrom);
    const after=await input.service.inspect(input.state.capture);
    // Recovery must retain both the original records and writes made by the candidate.
    if(!input.state.preserved(stateBefore,after)||!input.state.preserved(latest,after))throw new Error('install-state-not-preserved');await protectedUnchanged(initial);
    const finalHealth=await bounded(()=>input.service.health(previousPath,initial.bound.previous),initial.bound.outage.healthTimeoutMs);assertHealth(finalHealth,initial,previousPath,initial.bound.previous,recoveringFrom);
    observations.recovered={health,after,finalHealth};receipt.running={identity:initial.bound.previous,verification:initial.bound.previous.kind==='release'?'build-health':'legacy-process-artifacts',evidence};
    receipt.health={status:'healthy',evidence};receipt.statePreservation.evidence=evidence;receipt.rollback={status:'succeeded',evidence};receipt.outcome='failed-rolled-back';releaseLock=true;
    receipt.failure.phase=['switch','start','health'].includes(originalPhase)?originalPhase:'health';
   }catch(recovery){receipt.outcome='rollback-failed';receipt.failure={phase:'rollback',code:safeCode(recovery),evidence};receipt.rollback={status:'failed',evidence};receipt.health={status:'unknown',evidence};receipt.running=null;}
  }else if(['preflight','stage','intent'].includes(phase)){receipt.outcome='refused';releaseLock=true;}
  else{receipt.outcome='failed-before-switch';}
 }
 try{
  receipt.updatedAt=now();receipt.completedAt=receipt.outcome==='interrupted'?null:receipt.updatedAt;
  await checkpoint('final-receipt');await persist();
  if(canonical(JSON.parse((await readRegular(path)).toString()))!==canonical(receipt))throw new Error('install-receipt-readback');
 }catch(error){
  releaseLock=false;receipt.outcome='receipt-finalization-failed';receipt.updatedAt=now();receipt.completedAt=null;receipt.failure={phase:'receipt-finalization',code:safeCode(error),evidence};
  if(!validateInstallReceipt(receipt))throw new Error('invalid-install-diagnostic');
  diagnostic=join(root,'receipts',operationId+'-diagnostic.json');
  try{await writeDurable(diagnostic,receipt);}catch{diagnostic=null;}
 }
 let retention:unknown=null;
 if(releaseLock&&receipt.outcome==='succeeded'){
  try{retention=await pruneReleases(root,path,[initial.bound.previous]);}catch(error){retention={status:'incomplete',code:safeCode(error)};}
 }
 if(releaseLock){await rm(lock,{recursive:true});await syncDirectory(root);}
 return {receipt,path,diagnostic,retention};
}
