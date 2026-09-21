import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {open,lstat,realpath} from 'node:fs/promises';
import {validateExport,type DurableState} from '@jimmie-potts/agent-state';
import {loopbackEndpoint,responseJson,object} from './common.js';

export type ManagedOwner={readonly url:string;readonly pid:number};
export type ReleasedState={readonly ownerId:string;readonly revision:number};
const managed=new WeakMap<ManagedOwner,{child:ChildProcess;exit:Promise<number|null>;token:string;quiescing:boolean;kind:'hub'|'pixoo';config?:{path:string;digest:string}}>();
const releases=new WeakMap<ReleasedState,DurableState>();

/** Explicit source tooling. It owns only children it starts; no PID guessing or shell. */
export async function launchOwner(input:{kind:'hub'|'pixoo';entrypoint:string;args:string[];environment:Record<string,string>;token:string}):Promise<ManagedOwner>{
 if(process.platform!=='linux'||resolve(input.entrypoint)!==input.entrypoint||!/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(input.token))throw new Error('invalid-launch');
 let config:{path:string;digest:string}|undefined;
 if(input.kind==='pixoo'){
  const data=input.environment.PIXOO_DATA_DIR;if(!data||resolve(data)!==data)throw new Error('invalid-launch');
  const path=join(data,'agent-monitor','config.json'),file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=await file.stat();if(!info.isFile()||info.size>8192)throw new Error('invalid-launch');const bytes=Buffer.alloc(8193);let size=0;while(size<bytes.length){const part=await file.read(bytes,size,bytes.length-size,null);size+=part.bytesRead;if(!part.bytesRead)break;}if(size>8192)throw new Error('invalid-launch');config={path,digest:createHash('sha256').update(bytes.subarray(0,size)).digest('hex')};}finally{await file.close();}
 }
 const child=spawn(process.execPath,[input.entrypoint,...input.args],{env:input.environment,stdio:['ignore','pipe','pipe']});
 const exit=new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 // Drain bounded diagnostics without exposing paths or credentials.
 child.stderr!.resume();let output='';
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const url=await Promise.race([new Promise<string>((resolve,reject)=>{
   timer=setTimeout(()=>reject(new Error('owner-start-timeout')),5000);
   child.stdout!.on('data',chunk=>{
    output+=chunk.toString();if(Buffer.byteLength(output)>8192){reject(new Error('owner-start-invalid'));return;}
    const lines=output.split('\n');output=lines.pop()!;
    for(const line of lines){
     if(input.kind==='pixoo'){const match=/^Pixoo simulator listening on (http:\/\/127\.0\.0\.1:[0-9]+)$/.exec(line);if(match)resolve(match[1]);}
     else{try{const value=JSON.parse(line);if(value.ready===true&&typeof value.url==='string')resolve(value.url);}catch{}}
    }
   });
  }),exit.then(()=>{throw new Error('owner-start-failed');})]);
  const parsed=loopbackEndpoint(url+'/');if(parsed.pathname!=='/'||url!==parsed.origin)throw new Error('owner-start-invalid');
  child.stdout!.removeAllListeners('data');child.stdout!.resume();
  if (!child.pid || child.exitCode!==null || child.signalCode!==null) throw new Error('owner-start-failed');
  const owner=Object.freeze({url,pid:child.pid});managed.set(owner,{child,exit,token:input.token,quiescing:false,kind:input.kind,config});return owner;
 }catch(error){child.kill('SIGTERM');await Promise.race([exit.catch(()=>{}),new Promise(r=>{const timer=setTimeout(r,1000);timer.unref();})]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit.catch(()=>{});}throw error;}
 finally{clearTimeout(timer);}
}
export async function stopOwner(owner:ManagedOwner):Promise<void>{
 const process=managed.get(owner);if(!process)throw new Error('unmanaged-owner');
 if(process.child.exitCode===null&&process.child.signalCode===null)process.child.kill('SIGTERM');
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{const code=await Promise.race([process.exit,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('owner-stop-timeout')),5000);})]);if(code!==0||process.child.signalCode!==null)throw new Error('owner-stop-failed');}
 finally{clearTimeout(timer);}
}
async function call(owner:ManagedOwner,path:string,body?:unknown):Promise<unknown>{
 const source=managed.get(owner);if(!source)throw new Error('unmanaged-owner');
 const response=await fetch(owner.url+'/api/monitor/v1'+path,{signal:AbortSignal.timeout(4000),redirect:'error',headers:{authorization:`Bearer ${source.token}`,'content-type':'application/json','x-pixoo-request':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 const value=await responseJson(response,16*1024*1024);if(!response.ok)throw new Error('source-unavailable');return value;
}
async function saveExport(path:string,state:DurableState):Promise<void>{
 const parent=dirname(path);
 if(resolve(path)!==path||path.startsWith('/mnt/')||await realpath(parent)!==parent)throw new Error('invalid-export-path');
 const stat=await lstat(parent);if(!stat.isDirectory()||(stat.mode&0o077)!==0||stat.uid!==process.getuid!())throw new Error('invalid-export-path');
 for(let directory=parent;;directory=dirname(directory)){
  try{const marker=await lstat(join(directory,'.git'));if(marker.isFile())throw new Error('export-in-checkout');await lstat(join(directory,'.git','HEAD'));throw new Error('export-in-checkout');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(directory===dirname(directory))break;
 }
 const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
 const directory=await open(parent,'r');try{await directory.sync();}finally{await directory.close();}
}
/** Successful quiesce precedes verified exit; failed/ambiguous attempts never mint an import capability. */
export async function quiesceAndStop(owner:ManagedOwner,exportPath:string):Promise<ReleasedState>{
 const source=managed.get(owner);if(!source||source.quiescing||source.child.exitCode!==null||source.child.signalCode!==null)throw new Error('source-not-running');
 source.quiescing=true;
 const view=await call(owner,'/sessions');if(!object(view)||typeof view.nextRequestId!=='string')throw new Error('source-incompatible');
 const result=validateExport(await call(owner,'/commands',{operation:'quiesce',requestId:view.nextRequestId}));
 if(!result.ok||result.value.ownerId!==view.ownerId)throw new Error('source-incompatible');
 await saveExport(exportPath,result.value);
 await stopOwner(owner);
 // Exit is authoritative. Also reject an unexpected replacement listener.
 try{await fetch(owner.url+'/api/monitor/v1/sessions',{signal:AbortSignal.timeout(1000),redirect:'error'});throw new Error('source-still-listening');}
 catch(error){if(!(error instanceof TypeError)||!object(error.cause)||error.cause.code!=='ECONNREFUSED')throw new Error('source-release-unverified');}
 const receipt=Object.freeze({ownerId:result.value.ownerId,revision:result.value.revision});releases.set(receipt,structuredClone(result.value));return receipt;
}
/** Internal single-use transfer. Consumed synchronously before destination acquisition. */
export function consumeReleasedState(receipt:ReleasedState):DurableState{
 const state=releases.get(receipt);if(!state)throw new Error('invalid-or-consumed-release');releases.delete(receipt);return state;
}

/** Bind consumer readiness to a live Pixoo child and the exact selected config loaded at launch. */
export function managedPixooConsumer(owner:ManagedOwner,path:string,digest:string):{endpoint:string;token:string}{
 const record=managed.get(owner);
 if(!record||record.kind!=='pixoo'||record.quiescing||record.child.exitCode!==null||record.child.signalCode!==null||record.config?.path!==path||record.config.digest!==digest)throw new Error('consumer-not-ready');
 return {endpoint:owner.url+'/api/monitor/v1',token:record.token};
}
