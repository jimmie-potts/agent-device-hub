import { fork, type Serializable } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync,readFileSync,statSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLease } from './lease.js';
import { atomicJson } from './publication.js';

export const RUN_CODES = ['source-unavailable','source-schema','source-busy','source-capacity','source-deadline','source-read','store-capacity','aggregate-capacity','publication-capacity','publication-failed','run-deadline','binding-mismatch','zone-change-required','collection-disabled','backup-before-clear','backup-unavailable','backup-exists','invalid-backup','invalid-backup-name','run-cancelled','run-failed','unsafe-path','unsafe-private-path','unsupported-platform','invalid-config','language-extension-unavailable','source-changed','publication-pending','invalid-store','control-missing','invalid-control','invalid-clear-time'] as const;
export function safeCode(error:unknown): string {
  const code=error instanceof Error?error.message:error;
  return typeof code==='string'&&(RUN_CODES as readonly string[]).includes(code)?code:'run-failed';
}
function readToken(path:string):string|null {
  if(!existsSync(path))return null;
  if(statSync(path).size>1024)throw new Error('invalid-control');
  const value=JSON.parse(readFileSync(path,'utf8'));
  if(!value||typeof value.token!=='string'||!/^[0-9a-f-]{36}$/.test(value.token)||Object.keys(value).length!==1)throw new Error('invalid-control');
  return value.token;
}
function removeOwned(path:string,token:string):void {if(readToken(path)===token)unlinkSync(path);}
export type Supervision = { directory:string;entry:URL;payload:Serializable;readDeadlineMs?:number;runDeadlineMs?:number;maxMemoryBytes?:number;onFailure?:(code:string)=>void };
/** Parent owns the run lease until its one direct worker has exited. No nested workers. */
export async function supervise(options:Supervision):Promise<unknown> {
  const runLimit=options.runDeadlineMs??60_000,readLimit=options.readDeadlineMs??10_000,memoryLimit=options.maxMemoryBytes??512*1024*1024;
  if(!Number.isSafeInteger(runLimit)||runLimit<1||runLimit>60_000||!Number.isSafeInteger(readLimit)||readLimit<1||readLimit>10_000||!Number.isSafeInteger(memoryLimit)||memoryLimit<1||memoryLimit>512*1024*1024)throw new Error('invalid-config');
  const lease=acquireLease(options.directory),token=randomUUID(),run=join(options.directory,'run.json'),stop=join(options.directory,'stop.json');
  try{
    // A surviving worker from a crashed supervisor retains this independent guard.
    const guard=acquireLease(options.directory,'worker-lease.sqlite');guard.release();
    atomicJson(run,{token},1024);
    return await new Promise((resolve,reject)=>{
      let failure:string|undefined,result:unknown,success=false,readTimer:NodeJS.Timeout|undefined;
      const child=fork(options.entry,[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=192','--max-semi-space-size=8'],env:{...process.env,NODE_OPTIONS:''}});
      const stopWorker=(code:string)=>{failure??=code;child.kill();};
      const runTimer=setTimeout(()=>stopWorker('run-deadline'),runLimit);
      const poll=setInterval(()=>{
        try{if(readToken(stop)===token)stopWorker('run-cancelled');}catch{stopWorker('invalid-control');}
        if(process.memoryUsage().rss>memoryLimit)stopWorker('source-capacity');
      },25);
      child.on('message',(message:unknown)=>{
        if(!message||typeof message!=='object')return;
        const m=message as Record<string,unknown>;
        if(m.type==='phase'){
          if(m.phase==='reading'){if(readTimer)stopWorker('run-failed');else readTimer=setTimeout(()=>stopWorker('source-deadline'),readLimit);}
          else if(m.phase==='processing'){clearTimeout(readTimer);readTimer=undefined;}
        }else if(m.type==='memory'){
          if(typeof m.rss!=='number'||m.rss+process.memoryUsage().rss>memoryLimit)stopWorker('source-capacity');
        }else if(m.type==='failure'){stopWorker(safeCode(m.code));}
        else if(m.type==='success'){success=true;result=m.result;}
      });
      child.on('error',()=>stopWorker('run-failed'));
      child.on('close',code=>{
        clearInterval(poll);clearTimeout(runTimer);clearTimeout(readTimer);
        if(failure)reject(new Error(failure));else if(code!==0||!success)reject(new Error('run-failed'));else resolve(result);
      });
      const workerMemoryLimit=Math.max(1,memoryLimit-process.memoryUsage().rss-32*1024*1024);
      const payload=options.payload&&typeof options.payload==='object'&&!Array.isArray(options.payload)?{...options.payload,workerMemoryLimit}:options.payload;
      child.send(payload,error=>{if(error)stopWorker('run-failed');});
    }).catch(error=>{try{options.onFailure?.(safeCode(error));}catch{}throw error;});
  }finally{
    try{removeOwned(run,token);removeOwned(stop,token);}finally{lease.release();}
  }
}
/** A clear waits for the old worker's exit; elapsed time never grants ownership. */
export async function requestStop(directory:string,deadlineMs=10_000):Promise<void> {
  const end=Date.now()+deadlineMs;
  for(;;){
    try{const lease=acquireLease(directory);try{const guard=acquireLease(directory,'worker-lease.sqlite');guard.release();return;}finally{lease.release();}}
    catch(error){if(!(error instanceof Error)||error.message!=='collector-busy')throw error;}
    const token=readToken(join(directory,'run.json'));
    if(token)atomicJson(join(directory,'stop.json'),{token},1024);
    if(Date.now()>=end)throw new Error('collector-busy');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
