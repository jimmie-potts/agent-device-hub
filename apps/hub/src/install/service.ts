import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,readFile,readlink,realpath,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {request as httpRequest} from 'node:http';
import {requestBrowserLaunch} from '../browser-launch.js';
import {canonical,sha256,readRegular,type Identity} from './files.js';
import type {Layout,ServiceObservation} from './plan.js';
import type {HealthProof,ServiceControl} from './operation.js';

const execute=promisify(execFile),unit='codex-nanoleaf-monitor.service';
async function systemctl(args:string[]):Promise<string>{
 try{return (await execute('systemctl',['--user',...args,unit],{timeout:5000,maxBuffer:1024*1024,env:{...process.env,SYSTEMD_PAGER:'cat'}})).stdout.trim();}catch{throw new Error('install-service-unavailable');}
}
async function properties():Promise<Record<string,string>>{
 const text=await systemctl(['show','--property=ActiveState,SubState,MainPID,ControlGroup,Job,ExecStart,KillMode,FragmentPath,DropInPaths,Restart,Type,Environment,EnvironmentFiles,WorkingDirectory,CanFreeze,FreezerState']);
 return Object.fromEntries(text.split('\n').map(line=>{const offset=line.indexOf('=');return [line.slice(0,offset),line.slice(offset+1)];}));
}
export async function serviceContract(layout:Layout):Promise<{sha256:string;files:string[]}>{
 const value=await properties(),expected=[layout.node,join(layout.entry,'dist/cli.js'),'serve',layout.config].join(' ');
 if(value.ExecStart.match(/argv\[\]=(.*?) ;/)?.[1]!==expected||!['control-group','mixed'].includes(value.KillMode)||value.Type!=='simple'||value.CanFreeze!=='yes'||value.FreezerState!=='running')throw new Error('unknown-install-service-contract');
 const files=[value.FragmentPath,...value.DropInPaths.split(' ')].filter(Boolean).sort();if(!files.length)throw new Error('unknown-install-service-contract');
 const content:Record<string,string>={};for(const file of files)content[file]=sha256(await readRegular(await realpath(file)));
 // ExecStart's timestamp/PID fields are volatile; the approved executable arguments are not.
 return {sha256:sha256(canonical({argv:expected,KillMode:value.KillMode,Restart:value.Restart,Type:value.Type,CanFreeze:value.CanFreeze,Environment:value.Environment,EnvironmentFiles:value.EnvironmentFiles,WorkingDirectory:value.WorkingDirectory,content})),files};
}
async function groupEmpty(group:string):Promise<boolean>{
 if(!group.startsWith('/')||group.includes('..'))return false;
 const root='/sys/fs/cgroup'+group;let count=0;
 async function visit(path:string):Promise<boolean>{
  if(++count>64)return false;
  try{
   if((await readFile(join(path,'cgroup.procs'),'utf8')).trim())return false;
   for(const entry of await readdir(path,{withFileTypes:true}))if(entry.isDirectory()&&!await visit(join(path,entry.name)))return false;
   return true;
  }catch(error){return (error as NodeJS.ErrnoException).code==='ENOENT';}
 }
 return visit(root);
}
export async function observeService(layout:Layout):Promise<ServiceObservation>{
 const unknown:ServiceObservation={state:'unknown',pid:null,start:null,executable:null,entry:null,build:null};
 try{
  const value=await properties(),pid=Number(value.MainPID);
  if(['inactive','failed'].includes(value.ActiveState)&&pid===0&&(!value.Job||value.Job==='0')&&(!value.ControlGroup||await groupEmpty(value.ControlGroup)))return {...unknown,state:'inactive'};
  if(value.ActiveState!=='active'||!Number.isSafeInteger(pid)||pid<1)return unknown;
  const executable=await readlink(`/proc/${pid}/exe`),argv=(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0').filter(Boolean),stat=await readFile(`/proc/${pid}/stat`,'utf8');
  if(executable!==await realpath(layout.node)||canonical(argv.slice(1))!==canonical([join(layout.entry,'dist/cli.js'),'serve',layout.config]))return unknown;
  return {state:'active',pid,start:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],executable:layout.node,entry:await realpath(argv[1]),build:null};
 }catch{return unknown;}
}
type HealthOptions={endpoint:string;tokenFile:string;state:string;browserAccess?:'trusted-loopback';observe:()=>Promise<ServiceObservation>;signal?:AbortSignal};
/** Status reads build metadata without opening a browser session or requesting a launch code. */
export async function observeRunningBuild(options:HealthOptions):Promise<ServiceObservation>{
 const observed=await options.observe();if(observed.state!=='active')return {...observed,build:null};
 try{
  const url=new URL(options.endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('invalid-install-endpoint');
  const info=await lstat(options.tokenFile);if(info.uid!==process.getuid!()||(info.mode&0o077)!==0)throw new Error('unsafe-install-token');
  const token=(await readRegular(options.tokenFile,1024)).toString().trim();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid-install-token');
  const response=await fetch(url.origin+'/api/hub/v1/health',{redirect:'error',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1500)});
  if(!response.ok){await response.body?.cancel();return {...observed,build:null};}
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();throw new Error('install-health-capacity');}chunks.push(part.value);}
  const value=JSON.parse(Buffer.concat(chunks).toString()) as {build?:{sourceRevision?:unknown;version?:unknown}};
  const again=await options.observe();
  if(again.state!=='active'||again.pid!==observed.pid||again.start!==observed.start)return {...again,build:null};
  if(typeof value.build?.sourceRevision!=='string'||!/^([a-f0-9]{40}|unknown)$/.test(value.build.sourceRevision)||typeof value.build.version!=='string'||value.build.version.length>128)return {...again,build:null};
  return {...again,build:{sourceRevision:value.build.sourceRevision,version:value.build.version}};
 }catch{return {...observed,build:null};}
}
export async function probeHealth(options:HealthOptions,program:string,identity:Identity):Promise<HealthProof>{
 const origin=new URL(options.endpoint);
 if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('invalid-install-endpoint');
 const endpoint=origin.origin,tokenStat=await lstat(options.tokenFile);
 if(tokenStat.uid!==process.getuid!()||(tokenStat.mode&0o077)!==0)throw new Error('unsafe-install-token');
 const token=(await readRegular(options.tokenFile,1024)).toString().trim();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid-install-token');
 async function request(path:string,init:RequestInit={},status=200){
  // Fetch overwrites Sec-Fetch-Mode. Preserve exact navigation headers for these security probes.
  return new Promise<{headers:Headers;bytes:Buffer}>((resolve,reject)=>{
   const req=httpRequest(endpoint+path,{method:init.method??'GET',headers:Object.fromEntries(new Headers(init.headers).entries()),signal:AbortSignal.any([AbortSignal.timeout(1500),...(options.signal?[options.signal]:[])])},response=>{
    if(response.statusCode!==status){response.destroy();reject(new Error('install-health-request'));return;}
    const parts:Buffer[]=[];let size=0;response.on('error',reject);
    response.on('data',(part:Buffer)=>{size+=part.length;if(size>8*1024*1024){req.destroy(new Error('install-health-capacity'));return;}parts.push(part);});
    response.on('end',()=>{const headers=new Headers();for(const [key,value] of Object.entries(response.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);resolve({headers,bytes:Buffer.concat(parts)});});
   });
   req.on('error',reject);req.end(typeof init.body==='string'?init.body:undefined);
  });
 }
 const health=JSON.parse((await request('/api/hub/v1/health',{headers:{authorization:'Bearer '+token}})).bytes.toString()) as {ownerId:string;collector:string;admission:string;build?:{sourceRevision:string;version:string}};
 for(const [path,file] of [['/','index.html'],['/dashboard.js','dashboard.js'],['/dashboard.css','dashboard.css']]){
  const response=await request(path);if(sha256(response.bytes)!==sha256(await readRegular(join(program,'public',file))))throw new Error('install-served-asset-mismatch');
  if(response.headers.get('x-frame-options')!=='DENY'||response.headers.get('cross-origin-opener-policy')!=='same-origin')throw new Error('install-browser-security');
 }
 await request('/',{headers:{'sec-fetch-site':'same-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}});
 await request('/',{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}},403);
 const launch=await requestBrowserLaunch(options.state);if(new URL(launch.url).origin!==endpoint)throw new Error('install-launch-identity');
 const sessionHeaders={'content-type':'application/json','x-pixoo-request':'1',origin:endpoint,'sec-fetch-site':'same-origin'};
 async function checkSession(path:string,body:string){
  const session=JSON.parse((await request(path,{method:'POST',headers:sessionHeaders,body})).bytes.toString()) as {token:string};
  if(!/^[A-Za-z0-9_-]{43}$/.test(session.token))throw new Error('install-browser-session');
  const authorization='Bearer '+session.token;
  try{await request('/api/dashboard/v1/context',{headers:{authorization}});}finally{await request('/api/dashboard/v1/logout',{method:'POST',headers:{...sessionHeaders,authorization},body:'{}'});}
 }
 await checkSession('/api/dashboard/v1/launch',JSON.stringify({code:launch.code}));
 if(options.browserAccess==='trusted-loopback'){
  await request('/api/dashboard/v1/session',{method:'POST',headers:{...sessionHeaders,'sec-fetch-site':'cross-site'},body:'{}'},403);
  await checkSession('/api/dashboard/v1/session','{}');
 }else await request('/api/dashboard/v1/session',{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1',origin:endpoint},body:'{}'},404);
 const observed=await options.observe();if(observed.state!=='active'||observed.entry!==join(program,'dist/cli.js'))throw new Error('install-process-identity');
 observed.build=health.build??null;
 return {identity,process:observed,program,owner:health.ownerId,collector:health.collector,admission:health.admission,assets:true,launchSocket:true,browserSecurity:true};
}
type PauseControl={freeze:()=>Promise<void>;thaw:()=>Promise<void>;isFrozen:()=>Promise<boolean>};
/** No SQLite reader overlaps a runnable owner. Always thaw before any health request. */
export async function inspectPausedOwner<T>(pause:PauseControl,read:()=>Promise<T>):Promise<T>{
 if(await pause.isFrozen())throw new Error('install-owner-already-paused');
 try{
  await pause.freeze();if(!await pause.isFrozen())throw new Error('install-owner-pause-unverified');
  return await read();
 }finally{
  await pause.thaw();if(await pause.isFrozen())throw new Error('install-owner-resume-unverified');
 }
}
export function systemdService(layout:Layout,health:Omit<HealthOptions,'observe'|'signal'>):ServiceControl{
 const observe=()=>observeService(layout);
 async function control(action:'stop'|'start'){
  await systemctl(['--no-block',action]);const deadline=Date.now()+28000;
  while(Date.now()<deadline){const observed=await observe();if(observed.state===(action==='stop'?'inactive':'active'))return;await delay(100);}
  throw new Error('install-service-timeout');
 }
 return {observe,stop:()=>control('stop'),start:()=>control('start'),inspect:read=>inspectPausedOwner({freeze:async()=>{await systemctl(['freeze']);},thaw:async()=>{await systemctl(['thaw']);},isFrozen:async()=>{const state=(await properties()).FreezerState;if(!['running','frozen'].includes(state))throw new Error('install-owner-pause-unknown');return state==='frozen';}},read),health:async(program,identity)=>{
  const signal=AbortSignal.timeout(25000);let last:unknown;
  for(let attempt=0;attempt<30&&!signal.aborted;attempt++){
   try{return await probeHealth({...health,observe,signal},program,identity);}catch(error){last=error;}
   await delay(250);
  }
  throw last instanceof Error?last:new Error('install-health-timeout');
 }};
}
