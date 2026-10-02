import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat} from 'node:fs/promises';
import {readRegular,sha256,fullRevision,canonical,type Identity} from './files.js';
import {createPlan,assertApproval,inspectInstalled,installationStatus,type Layout,type Plan} from './plan.js';
import {inspectSource,remoteMain} from './source.js';
import {observeService,observeRunningBuild,serviceContract,systemdService} from './service.js';
import {selectRollback} from './retention.js';
import {buildTarget} from './build-target.js';
import {qualifyCompatibility} from './compatibility.js';
import {captureState,statePreserved} from './state.js';
import {executeOperation} from './operation.js';

type Arguments={command:'plan'|'status'|'upgrade'|'rollback';target?:string;owner?:string;tokenFile?:string;planFile?:string;approve?:string;rollback:boolean;baselineReceipt?:string};
export function parseInstallArguments(args:string[]):Arguments{
 const [command,...rest]=args;if(!['plan','status','upgrade','rollback'].includes(command))throw new Error('invalid-install-arguments');
 const result:Arguments={command:command as Arguments['command'],rollback:false};
 if(rest[0]&&!rest[0].startsWith('--'))result.target=rest.shift();
 const used=new Set<string>();
 while(rest.length){
  const flag=rest.shift()!;if(used.has(flag))throw new Error('invalid-install-arguments');used.add(flag);
  if(flag==='--rollback'&&command==='plan'){result.rollback=true;continue;}
  const key=({'--owner':'owner','--token-file':'tokenFile','--plan':'planFile','--approve':'approve','--baseline-receipt':'baselineReceipt'} as const)[flag as '--owner'];
  const value=rest.shift();if(!key||!value||value.startsWith('--'))throw new Error('invalid-install-arguments');result[key]=value;
 }
 if([result.tokenFile,result.planFile,result.baselineReceipt].some(path=>path!==undefined&&!isAbsolute(path)))throw new Error('invalid-install-arguments');
 if(command==='plan'){
  if(!result.owner||!result.tokenFile||result.planFile||result.approve)throw new Error('invalid-install-arguments');
 }else if(command==='status'){
  if(result.target||result.owner||result.planFile||result.approve)throw new Error('invalid-install-arguments');
 }else{
  if(!result.planFile||!result.approve||!/^[a-f0-9]{64}$/.test(result.approve))throw new Error('install-approval-required');
  if(result.owner||result.tokenFile||result.baselineReceipt||command==='upgrade'&&!fullRevision(result.target)||command==='rollback'&&result.target!==undefined&&!fullRevision(result.target))throw new Error('invalid-install-arguments');
 }
 return result;
}
async function layout(tokenFile?:string,baselineReceipt?:string):Promise<Layout>{
 const n=join(homedir(),'.local/share/codex-nanoleaf'),state=join(n,'shared-monitor');
 const protectedPaths:string[]=[];
 for(const path of [join(n,'runtime/node/bin/node'),join(n,'.venv/bin/python'),...['bridge','mcp','vendor','codex-gh30'].map(name=>join(n,'runtime',name)),...(tokenFile?[tokenFile]:[])]){
  try{await lstat(path);protectedPaths.push(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 return {root:join(homedir(),'.local/share/agent-device-hub/hub'),entry:join(n,'runtime/hub-gh30'),state,config:join(state,'host.json'),node:join(n,'runtime/node/bin/node'),protectedPaths,unit:'codex-nanoleaf-monitor.service',...(baselineReceipt?{baselineReceipt}:{})};
}
async function healthConfiguration(paths:Layout,tokenFile:string){
 const info=await lstat(paths.config);if(info.uid!==process.getuid!()||(info.mode&0o077)!==0)throw new Error('unsafe-install-configuration');
 const value=JSON.parse((await readRegular(paths.config,65536)).toString()) as {directory:string;port:number;browserAccess?:'trusted-loopback';credentials:{digest:string;scopes:string[]}[]};
 if(value.directory!==paths.state||!Number.isInteger(value.port)||value.port<1||value.port>65535||value.browserAccess!==undefined&&value.browserAccess!=='trusted-loopback')throw new Error('unsupported-install-configuration');
 const token=(await readRegular(tokenFile,1024)).toString().trim();
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!value.credentials.some(item=>item.digest===sha256(token)&&item.scopes.includes('read')))throw new Error('install-read-credential-required');
 return {endpoint:`http://127.0.0.1:${value.port}`,tokenFile,...(value.browserAccess?{browserAccess:value.browserAccess}:{})};
}
async function plan(repository:string,request:string,owner:string,tokenFile:string,rollback:boolean,pinned?:Identity,baselineReceipt?:string){
 const paths=await layout(tokenFile,baselineReceipt),installed=await inspectInstalled(paths),health=await healthConfiguration(paths,tokenFile);
 const contract=await serviceContract(paths);paths.protectedPaths.push(...contract.files);
 const selected=rollback?await selectRollback(paths.root,installed.identity,pinned?.kind==='release'?pinned.sourceRevision:request==='previous'?undefined:request):undefined;
 if(pinned&&selected&&canonical(selected.identity)!==canonical(pinned))throw new Error('install-target-changed');
 const target=selected?.identity.kind==='release'?selected.identity.sourceRevision:rollback?'main':request;
 const source=inspectSource(repository,target,installed.identity.kind==='release'?installed.identity.sourceRevision:null);
 if(selected?.identity.kind==='legacy'){source.comparison={status:'unknown',reason:'legacy-recovery-source-unknown'};source.commits=[];source.components=[];}
 return createPlan({layout:paths,source,service:await observeService(paths),owner,operation:rollback?'rollback':'upgrade',requestedTarget:request,...(selected?{rollbackTarget:selected.identity}:{}),serviceContractSha256:contract.sha256,health});
}
/** Source-checkout command. Only the two explicit mutation verbs compose service control. */
export async function runInstallCli(args:string[]):Promise<void>{
 try{
  const options=parseInstallArguments(args),repository=fileURLToPath(new URL('../../../..',import.meta.url));
  if(options.command==='status'){
   const paths=await layout(options.tokenFile,options.baselineReceipt);
   const observed=options.tokenFile?await observeRunningBuild({...await healthConfiguration(paths,options.tokenFile),state:paths.state,observe:()=>observeService(paths)}):await observeService(paths);
   process.stdout.write(JSON.stringify(await installationStatus(paths,observed,remoteMain(repository)),null,2)+'\n');return;
  }
  if(options.command==='plan'){
   const result=await plan(repository,options.target??(options.rollback?'previous':'main'),options.owner!,options.tokenFile!,options.rollback,undefined,options.baselineReceipt);
   process.stdout.write(JSON.stringify(result,null,2)+'\n');return;
  }
  const info=await lstat(options.planFile!);if(info.uid!==process.getuid!()||(info.mode&0o077)!==0)throw new Error('unsafe-install-plan');
  const saved=JSON.parse((await readRegular(options.planFile!,8*1024*1024)).toString()) as Plan;assertApproval(saved,options.approve!);
  if(saved.bound.operation!==options.command||!saved.bound.health)throw new Error('install-plan-operation-mismatch');
  if(options.command==='upgrade'&&options.target!==saved.bound.source.target||options.command==='rollback'&&options.target!==undefined&&(saved.bound.target.kind!=='release'||options.target!==saved.bound.target.sourceRevision))throw new Error('install-target-changed');
  const request=options.command==='upgrade'?saved.bound.source.target:saved.bound.requestedTarget;
  const refresh=async()=>{
   const current=await plan(repository,request,saved.bound.owner,saved.bound.health!.tokenFile,options.command==='rollback',options.command==='rollback'?saved.bound.target as Identity:undefined,saved.bound.layout.baselineReceipt);
   // A moving name in the approved document remains an exact pinned target at execution.
   current.bound.requestedTarget=saved.bound.requestedTarget;
   current.digest=sha256(canonical(current.bound));return current;
  };
  const current=await refresh();assertApproval(current,options.approve!);
  const result=await executeOperation({plan:refresh,approvedDigest:options.approve!,prepare:()=>options.command==='upgrade'?buildTarget(repository,current.bound.layout.root,current.bound.source.target):selectRollback(current.bound.layout.root,current.bound.previous,current.bound.target.kind==='release'?current.bound.target.sourceRevision:undefined),
   qualify:qualifyCompatibility,service:systemdService(current.bound.layout,{...current.bound.health!,state:current.bound.layout.state}),state:{capture:()=>captureState(current.bound.layout.state),preserved:statePreserved}});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.receipt.outcome!=='succeeded')process.exitCode=1;
 }catch(error){
  const code=error instanceof Error&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(error.message)?error.message:'install-command-failed';
  process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;
 }
}
