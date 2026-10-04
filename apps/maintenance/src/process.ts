import { spawn } from 'node:child_process';

export type ProcessOptions={deadline:number; maxBytes:number; input?:string; cwd?:string; env?:NodeJS.ProcessEnv; partial?:boolean};
export type ProcessResult={stdout:string; code:number; reason?:string; subscriptionAuthenticated:boolean};
// Children inherit the supervisor's process group. Never detach from its claim.
// No shell and no telemetry/model-provided executable or argument expansion.
export async function runProcess(executable:string,args:string[],options:ProcessOptions):Promise<ProcessResult> {
  if(options.deadline<=Date.now())throw new Error('process-deadline');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:options.cwd,env:options.env,stdio:['pipe','pipe','pipe'],detached:false});
    let size=0,reason='',output:Buffer[]=[],subscriptionAuthenticated=false;
    let escalation:NodeJS.Timeout|undefined;
    const stop=(why:string)=>{
      if(reason)return;
      reason=why;child.kill('SIGTERM');
      escalation=setTimeout(()=>child.kill('SIGKILL'),500);escalation.unref();
    };
    const timer=setTimeout(()=>stop('process-deadline'),Math.min(2**31-1,options.deadline-Date.now()));
    child.stdout.on('data',(chunk:Buffer)=>{
      const room=Math.max(0,options.maxBytes-size);size+=chunk.length;
      output.push(chunk.subarray(0,room));if(size>options.maxBytes)stop('process-output-limit');
    });
    // Diagnostics can contain credentials. Do not retain child stderr.
    child.stderr.on('data',(chunk:Buffer)=>{if(chunk.toString('utf8').trim()==='Logged in using ChatGPT')subscriptionAuthenticated=true;size+=chunk.length;if(size>options.maxBytes)stop('process-output-limit');});
    child.stdin.on('error',()=>{});
    child.once('error',()=>{clearTimeout(timer);clearTimeout(escalation);reject(new Error('process-unavailable'));});
    child.once('close',(code)=>{
      clearTimeout(timer);clearTimeout(escalation);
      const failure=reason||(code!==0?'process-failed':'');
      if(failure&&!options.partial)reject(new Error(failure));
      else resolve({stdout:Buffer.concat(output).toString('utf8'),code:code??-1,subscriptionAuthenticated,...(failure?{reason:failure}:{})});
    });
    child.stdin.end(options.input??'');
  });
}
export function subscriptionEnvironment():NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={};
  // Do not offer a paid API fallback to the installed subscription client.
  for(const key of ['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TERM','CODEX_HOME','XDG_CONFIG_HOME','TMPDIR'])
    if(process.env[key]!==undefined)env[key]=process.env[key];
  return env;
}
