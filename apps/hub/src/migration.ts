import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {validateExport,type DurableState} from '@jimmie-potts/agent-state';
import {loopbackEndpoint,responseJson,object} from './common.js';

export type ManagedOwner={readonly url:string};
export type ReleasedState={readonly ownerId:string;readonly revision:number};
const managed=new WeakMap<ManagedOwner,{child:ChildProcess;exit:Promise<number|null>;token:string}>();
const releases=new WeakMap<ReleasedState,DurableState>();

/** Explicit source tooling. It owns only children it starts; no PID guessing or shell. */
export async function launchOwner(input:{kind:'hub'|'pixoo';entrypoint:string;args:string[];environment:Record<string,string>;token:string}):Promise<ManagedOwner>{
 if(process.platform!=='linux'||resolve(input.entrypoint)!==input.entrypoint||!/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(input.token))throw new Error('invalid-launch');
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
  const owner=Object.freeze({url});managed.set(owner,{child,exit,token:input.token});return owner;
 }catch(error){child.kill('SIGTERM');await Promise.race([exit.catch(()=>{}),new Promise(r=>setTimeout(r,5000))]);throw error;}
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
/** Successful quiesce precedes verified exit; failed/ambiguous attempts never mint an import capability. */
export async function quiesceAndStop(owner:ManagedOwner):Promise<ReleasedState>{
 const source=managed.get(owner);if(!source||source.child.exitCode!==null||source.child.signalCode!==null)throw new Error('source-not-running');
 const view=await call(owner,'/sessions');if(!object(view)||typeof view.nextRequestId!=='string')throw new Error('source-incompatible');
 const result=validateExport(await call(owner,'/commands',{operation:'quiesce',requestId:view.nextRequestId}));
 if(!result.ok||result.value.ownerId!==view.ownerId)throw new Error('source-incompatible');
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
