import {lstat,realpath,readlink,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {canonical,sha256,readRegular,inventory,verifyRelease,fullRevision,type Identity,type ReleaseIdentity} from './files.js';

export type Layout={root:string;entry:string;state:string;config:string;node:string;protectedPaths:string[];unit:'codex-nanoleaf-monitor.service';baselineReceipt?:string};
export type ServiceObservation={state:'active'|'inactive'|'unknown';pid:number|null;start:string|null;executable:string|null;entry:string|null;build:{sourceRevision:string;version:string}|null};
export type Source={repository:string;head:string;target:string;mergedMain:string;clean:boolean;comparison:{status:'complete'}|{status:'unknown';reason:string};commits:{sha:string;subject:string;pullRequests:number[]}[];removedCommits?:{sha:string;subject:string;pullRequests:number[]}[];components:string[]};
export type ProtectedPath={path:string;resolved:string;link:string|null;sha256:string;mode:number;uid:number};
export type Installed={path:string;identity:Identity;inventorySha256:string;adopted:boolean};

async function optionalStat(path:string){try{return await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export async function privateRoot(path:string,allowMissing=false):Promise<void>{
 const info=await optionalStat(path);
 if(!info&&allowMissing){let parent=dirname(resolve(path));while(!await optionalStat(parent)){if(parent===dirname(parent))throw new Error('unsafe-install-root');parent=dirname(parent);}if(await realpath(parent)!==parent)throw new Error('unsafe-install-root');return;}
 if(!info||!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path)||info.uid!==process.getuid!()||(info.mode&0o077)!==0)throw new Error('unsafe-install-root');
}
export async function protectedPath(path:string):Promise<ProtectedPath>{
 const info=await lstat(path),resolved=await realpath(path),actual=await lstat(resolved);
 const hash=actual.isDirectory()?(await inventory(resolved)).sha256:sha256(await readRegular(resolved));
 return {path,resolved,link:info.isSymbolicLink()?await readlink(path):null,sha256:hash,mode:actual.mode&0o777,uid:actual.uid};
}
export async function inspectInstalled(layout:Layout):Promise<Installed>{
 await privateRoot(layout.root,true);
 const entry=await lstat(layout.entry),path=await realpath(layout.entry);
 const adopted=entry.isSymbolicLink();
 if(adopted){
  if(resolve(dirname(layout.entry),await readlink(layout.entry))!==join(layout.root,'current'))throw new Error('unknown-install-entry');
  const anchor=await lstat(join(layout.root,'current'));if(!anchor.isSymbolicLink())throw new Error('unknown-install-anchor');
  const relative=path.slice(layout.root.length+1);
  if(!path.startsWith(layout.root+'/')||!/^((releases\/[a-f0-9]{40})|(legacy\/legacy-[a-f0-9]{64}))$/.test(relative))throw new Error('unknown-install-anchor');
  if(relative.startsWith('releases/')){
   const identity=JSON.parse((await readRegular(join(layout.root,'provenance',relative.slice(9)+'.json'))).toString()) as ReleaseIdentity;
   if(identity.sourceRevision!==relative.slice(9))throw new Error('install-source-identity');
   const verified=await verifyRelease(path,identity);return {path,identity,inventorySha256:verified.inventory.sha256,adopted};
  }
 }else if(!entry.isDirectory()||path!==layout.entry)throw new Error('unknown-install-entry');
 else if(layout.baselineReceipt){
  const info=await lstat(layout.baselineReceipt);if(info.uid!==process.getuid!()||(info.mode&0o077)!==0)throw new Error('unsafe-baseline-receipt');
  const identity=JSON.parse((await readRegular(layout.baselineReceipt)).toString()) as ReleaseIdentity;
  const verified=await verifyRelease(path,identity);return {path,identity,inventorySha256:verified.inventory.sha256,adopted:false};
 }
 const content=await inventory(path),manifest=await readRegular(join(path,'manifest.json'));
 const legacyId='legacy-'+content.sha256;
 if(adopted&&path!==join(layout.root,'legacy',legacyId))throw new Error('install-legacy-hash');
 return {path,identity:{kind:'legacy',legacyId,sourceRevision:'unknown',contentSha256:content.sha256,manifestSha256:sha256(manifest)},inventorySha256:content.sha256,adopted};
}
export async function installationStatus(layout:Layout,service:ServiceObservation,remote:string|null){
 const installed=await inspectInstalled(layout);
 return {installed,service:service.state,running:service.state==='active'?service:null,remote:remote&&fullRevision(remote)?{status:'known' as const,sourceRevision:remote}:{status:'unknown' as const}};
}
export async function configurationInventory(directory:string):Promise<unknown[]>{
 const files:unknown[]=[];
 async function walk(prefix:string):Promise<void>{
  for(const name of (await readdir(join(directory,prefix))).sort()){
   const relative=prefix?prefix+'/'+name:name,path=join(directory,relative),info=await lstat(path);
   if(!prefix&&/^(state|owner)\.sqlite(?:-(journal|wal|shm))?$/.test(name))continue;
   if(info.isSocket())continue;
   if(info.isSymbolicLink()||info.uid!==process.getuid!())throw new Error('unsafe-install-configuration');
   if(info.isDirectory()){await walk(relative);continue;}
   if(!info.isFile())throw new Error('unsafe-install-configuration');
   files.push({path:relative,mode:info.mode&0o777,sha256:sha256(await readRegular(path))});
  }
 }
 await walk('');return files;
}
export type PlanOptions={layout:Layout;source:Source;service:ServiceObservation;owner:string;operation:'upgrade'|'rollback';requestedTarget:string;rollbackTarget?:Identity;serviceContractSha256?:string;health?:{endpoint:string;tokenFile:string;browserAccess?:'trusted-loopback'}};
export async function createPlan(options:PlanOptions){
 const {layout,source,owner,operation,requestedTarget}=options;
 if(!/^[A-Za-z0-9_.-]{1,128}$/.test(owner))throw new Error('invalid-install-owner');
 if(!source.clean)throw new Error('dirty-install-source');
 if(!fullRevision(source.head)||!fullRevision(source.target)||!fullRevision(source.mergedMain))throw new Error('unmerged-install-source');
 if(layout.unit!=='codex-nanoleaf-monitor.service'||Object.values(layout).filter(value=>typeof value==='string'&&value!==layout.unit).some(path=>!String(path).startsWith('/')))throw new Error('invalid-install-layout');
 await privateRoot(layout.state);
 if(layout.config!==join(layout.state,'host.json')||[layout.state,layout.entry].some(path=>path===layout.root||path.startsWith(layout.root+'/')||layout.root.startsWith(path+'/')))throw new Error('unsupported-install-layout');
 const installed=await inspectInstalled(layout),configuration=await readRegular(layout.config);
 const host=JSON.parse(configuration.toString()) as {ownerId?:unknown};
 if(typeof host.ownerId!=='string'||!host.ownerId)throw new Error('invalid-install-configuration');
 const protectedPaths=await Promise.all([...new Set([...layout.protectedPaths,layout.node,...(layout.baselineReceipt?[layout.baselineReceipt]:[])])].sort().map(protectedPath));
 const parent=await lstat(dirname(layout.entry));if(!parent.isDirectory()||parent.isSymbolicLink()||await realpath(dirname(layout.entry))!==dirname(layout.entry))throw new Error('unsafe-shared-runtime');
 const target=operation==='rollback'?options.rollbackTarget:{kind:'source' as const,sourceRevision:source.target};
 if(!target)throw new Error('missing-rollback-target');
 const configurations=await configurationInventory(layout.state);
 const {mergedMain,...sourceBound}=source;
 const bound={schemaVersion:'hub-install-plan/1.0',owner,operation,requestedTarget,source:sourceBound,target,previous:installed.identity,health:options.health??null,
  baselineSha256:installed.inventorySha256,configurationSha256:sha256(canonical(configurations)),hostConfigurationSha256:sha256(configuration),configurations,serviceContractSha256:options.serviceContractSha256??null,stateOwner:host.ownerId,layout,unit:layout.unit,
  sharedParent:{path:dirname(layout.entry),device:parent.dev,inode:parent.ino,mode:parent.mode&0o777,uid:parent.uid},protectedPaths,
  migration:!installed.adopted,outage:{stopTimeoutMs:30000,healthTimeoutMs:30000,healthAttempts:30,units:[layout.unit]},
  backup:{directory:layout.state,configuration:layout.config,exclude:['sockets','transient process objects'],restoreAutomatically:false},
  recovery:{identity:installed.identity,strategy:'latest-durable-state',compatibility:'required-before-stop',attempts:1}};
 return {bound,digest:sha256(canonical(bound)),observations:{remoteMain:mergedMain,service:options.service.state,running:options.service.state==='active'?options.service:null,installedPath:installed.path}};
}
export type Plan=Awaited<ReturnType<typeof createPlan>>;
export function assertApproval(plan:Plan,approvedDigest:string):void{
 if(!/^[a-f0-9]{64}$/.test(approvedDigest)||sha256(canonical(plan.bound))!==approvedDigest||plan.digest!==approvedDigest)throw new Error('install-approval-changed');
}
