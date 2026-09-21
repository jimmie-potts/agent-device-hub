import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir,release,arch} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';

// Source-only loopback measurement. No installed services, hooks or devices.
const output=process.argv[2];if(!output)throw new Error('output-path-required');
const budgets=JSON.parse(await readFile(new URL('../docs/performance/linux-budgets.json',import.meta.url),'utf8'));
const report={formatVersion:1,measuredAt:new Date().toISOString(),runtime:process.version,kernel:release(),arch:arch(),scope:'Synthetic HTTP ingestion plus current snapshot in a separate Linux host process; excludes provider process, renderer, consumer cutover and devices.',qualified:false,profiles:[]};
const token='m'.repeat(43),headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
for(const tasks of [1,10,50])for(let repeat=1;repeat<=3;repeat++){
 const directory=await mkdtemp(join(tmpdir(),'hub-measure-'));let child,timer,exited;
 const result={tasks,repeat,samples:[],failures:[]};report.profiles.push(result);
 try{
  const store=join(directory,'state');await mkdir(store,{mode:0o700});const config=join(directory,'config.json');
  await writeFile(config,JSON.stringify({directory:store,ownerId:'measurement',consumers:[],controllers:[],port:0,credentials:[{id:'probe',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest'],devices:[]}]}),{mode:0o600});
  child=spawn(process.execPath,[new URL('../apps/hub/dist/cli.js',import.meta.url).pathname,'serve',config],{stdio:['ignore','pipe','pipe']});
  exited=once(child,'exit');timer=setTimeout(()=>child.kill('SIGKILL'),120000);
  const [bytes]=await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw new Error('startup-failed');})]);const {url}=JSON.parse(bytes);
  for(let i=0;i<1000;i++){
   const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'synthetic',sourceId:'probe',sessionId:'task-'+i%tasks},turn:{status:'known',id:'turn-'+i},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:Date.now(),ordering:{status:'unknown'}};
   const start=performance.now();
   const response=await fetch(url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(event),signal:AbortSignal.timeout(3000)});
   const outcome=await response.json();
   const observed=await fetch(url+'/api/monitor/v1/sessions',{headers,signal:AbortSignal.timeout(3000)});const view=await observed.json();
   result.samples.push(performance.now()-start);
   if(response.status!==200||!outcome.ok||observed.status!==200||view.snapshot?.revision<outcome.revision)result.failures.push({sample:i,ingestStatus:response.status,readStatus:observed.status});
  }
  const status=await readFile('/proc/'+child.pid+'/status','utf8');result.peakRssMiB=Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1])/1024;
  result.p95Ms=percentile(result.samples,.95);result.p99Ms=percentile(result.samples,.99);result.maxMs=Math.max(...result.samples);
  result.serviceRssLimitMiB=budgets.futureIntegratedConstraints.serviceRssMiB;
  result.serviceRssWithinLimit=result.peakRssMiB<=result.serviceRssLimitMiB;
  result.legacyHookLatencyCeilings=budgets.limits[tasks];
  result.latencyComparison='Informational only: HTTP ingestion/read is a different boundary from the frozen full-hook measurement.';
  child.kill('SIGTERM');const [code,signal]=await exited;if(code!==0||signal)result.failures.push({shutdown:{code,signal}});
 }catch(error){result.failures.push({error:error instanceof Error?error.message:String(error)});}
 finally{clearTimeout(timer);if(child?.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited?.catch(()=>{});}await rm(directory,{recursive:true,force:true});}
 console.error(JSON.stringify({tasks,repeat,samples:result.samples.length,p95Ms:result.p95Ms,peakRssMiB:result.peakRssMiB,failures:result.failures.length}));
}
report.complete=report.profiles.every(p=>p.samples.length===1000&&p.failures.length===0);
report.serviceRssWithinLimit=report.profiles.every(p=>p.serviceRssWithinLimit);
await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(!report.complete||!report.serviceRssWithinLimit)process.exitCode=1;
