import {spawn,type ChildProcess} from 'node:child_process';
import {createInterface} from 'node:readline';
import {outsideInstalledPorts} from './loopback.js';

export interface LaunchSpec {
 argv:readonly [string,...string[]];
 cwd?:string;
 env?:NodeJS.ProcessEnv;
 /** The URL that a ready line announces, or undefined for any other line. */
 ready(line:string):string|undefined;
}
export interface LaunchedProcess {child:ChildProcess;url:string;port:number;stdout:string[];stderr:string[];stop():Promise<void>}
/** A start failure with the process's stderr lines. */
export class StartError extends Error {constructor(message:string,readonly stderr:string[]){super(message);}}

/**
 * Start one process and wait for its ready line. Adapted from the launch
 * helper in divoom-app-upgrade tests/helpers/verify-run.ts, which ran a
 * verification run's launch spec.
 */
async function launchOnce(spec:LaunchSpec,timeoutMs:number):Promise<LaunchedProcess> {
 const child=spawn(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,env:spec.env,stdio:['ignore','pipe','pipe']});
 const stdout:string[]=[],stderr:string[]=[];
 createInterface({input:child.stderr}).on('line',line=>stderr.push(line));
 // A process that never started emits 'error' instead of 'exit'.
 const exited=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>resolve());});
 const stop=async()=>{if(child.exitCode===null&&child.signalCode===null&&child.pid!==undefined){child.kill('SIGTERM');await exited;}};
 try{
  const url=await new Promise<string>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('readiness timeout')),timeoutMs);
   createInterface({input:child.stdout}).on('line',line=>{stdout.push(line);const ready=spec.ready(line);if(ready){clearTimeout(timer);resolve(ready);}});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   // 'close' follows the end of stdout and stderr, so the failure carries all of stderr.
   child.once('close',code=>{clearTimeout(timer);reject(new StartError(`exited ${code}: ${stderr.join(' | ')}`,stderr));});
  });
  return {child,url,port:Number(new URL(url).port),stdout,stderr,stop};
 }catch(error){await stop();throw error;}
}

/**
 * Start a process that listens on an ephemeral port and names it in a ready
 * line. A launch whose ready line names an installed service's port is
 * stopped, and the process starts again (divoom-app-upgrade#125).
 */
export function launch(spec:LaunchSpec,timeoutMs=20000):Promise<LaunchedProcess> {
 return outsideInstalledPorts(()=>launchOnce(spec,timeoutMs),launched=>launched.port,launched=>launched.stop());
}
