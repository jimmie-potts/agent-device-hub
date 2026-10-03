import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('normal CLI enables canonical stderr diagnostics without changing readiness stdout',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-diagnostics-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const token='a'.repeat(43),file=join(directory,'host.json');
  await writeFile(file,JSON.stringify({directory,ownerId:'owner',consumers:[],controllers:[],port:0,
    credentials:[{id:'operator',digest:createHash('sha256').update(token).digest('hex'),scopes:['read'],devices:[]}],observability:{enabled:true}}),{mode:0o600});
  const child=spawn(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname,'serve',file],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('readiness timed out')),5000);
    child.stdout.on('data',()=>{if(stdout.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(stdout.trim()));}catch(e){reject(e);}}});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr));});
  });
  assert.equal(ready.ready,true);
  const response=await fetch(ready.url+'/api/hub/v1/health',{headers:{authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  child.kill('SIGTERM');assert.equal((await exited).code,0);
  assert.equal(stdout.trim().split('\n').length,1);
  const logs=stderr.split('\n').filter(line=>line.startsWith('{')).map(JSON.parse);
  assert.ok(logs.some(x=>x.event_name==='process.started'));
  assert.ok(logs.some(x=>x.event_name==='process.stopped'));
  assert.ok(logs.some(x=>x.scope.name==='bunny.http'&&x.event_name==='operation.completed'));
});

test('normal host adapter correlates a command and propagates only to its authenticated controller',async t=>{
 const {createServer}=await import('node:http');
 const {createHubDiagnostics}=await import('../dist/host-diagnostics.js');
 const {startHub}=await import('../dist/server.js');
 const {startFakeController}=await import('./fake-controller.mjs');
 const received=[];const collector=createServer((req,res)=>{let value='';req.on('data',c=>value+=c);req.on('end',()=>{received.push(JSON.parse(value));res.writeHead(200,{'content-type':'application/json'});res.end('{}');});});
 await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
 let parent;const fake=await startFakeController({diagnostics:{request:(_attributes,header)=>{parent=header;}}});
 const directory=await mkdtemp(join(tmpdir(),'hub-host-trace-'));let hub,diagnostics;
 t.after(async()=>{await hub?.close();await diagnostics?.runtime.shutdown();await fake.close();await new Promise(resolve=>collector.close(resolve));await rm(directory,{recursive:true,force:true});});
 diagnostics=await createHubDiagnostics({enabled:true,tracing:true,samplingRatio:1,collectorOrigin:`http://127.0.0.1:${collector.address().port}`});
 const token='h'.repeat(43);hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[fake.config()],diagnostics:diagnostics.commands,hostDiagnostics:diagnostics.runtime,
  credentials:[{id:'operator',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','control'],devices:['wall']}]});
 const snapshot=fake.snapshot10();
 const body={apiVersion:'1.0',controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,requestId:snapshot.nextRequestId,
  expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:snapshot.generation,command:{kind:'brightness.set',percent:42}};
 const response=await fetch(hub.url+'/api/controllers/v1/wall/commands',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1',
  traceparent:'00-'+'3'.repeat(32)+'-'+'4'.repeat(16)+'-01'},body:JSON.stringify(body)});
 assert.equal(response.status,202);assert.equal((await response.json()).outcome,'queued');assert.equal(fake.commands.length,1);
 assert.match(parent??'',new RegExp('^00-'+'3'.repeat(32)+'-[a-f0-9]{16}-01$'));
 await hub.close();await diagnostics.runtime.shutdown();
 const spans=received.flatMap(x=>x.resourceSpans?.[0].scopeSpans[0].spans??[]);
 assert.equal(spans.length,2);assert.ok(spans.every(x=>x.traceId==='3'.repeat(32)));
 const child=spans.find(x=>x.parentSpanId!=='4'.repeat(16));assert.ok(child);
 assert.equal(parent,`00-${child.traceId}-${child.spanId}-01`);
});


for(const mode of ['drop','receipt'])test(`HTTP diagnostic summary preserves uncertain ${mode} outcomes`,async t=>{
 const {startHub}=await import('../dist/server.js');
 const {startFakeController}=await import('./fake-controller.mjs');
 const fake=await startFakeController();fake.answerNext(mode==='drop'?{mode:'drop'}:{status:503,receipt:{outcome:'uncertain',priorEffects:'possible',uncertainOperations:['brightness'],failure:{code:'uncertain-result'}}});
 const directory=await mkdtemp(join(tmpdir(),'hub-uncertain-summary-'));let hub;
 t.after(async()=>{await hub?.close();await fake.close();await rm(directory,{recursive:true,force:true});});
 const events=[],token='h'.repeat(43);
 hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[fake.config()],
  hostDiagnostics:{event:(event,scope,attributes)=>events.push({event,scope,attributes})},
  credentials:[{id:'operator',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','control'],devices:['wall']}]});
 const snapshot=fake.snapshot10();
 const body={apiVersion:'1.0',controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,requestId:snapshot.nextRequestId,
  expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:snapshot.generation,command:{kind:'brightness.set',percent:42}};
 const response=await fetch(hub.url+'/api/controllers/v1/wall/commands',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify(body)});
 assert.equal(response.status,503);const result=await response.json();assert.equal(mode==='drop'?result.error.code:result.outcome,mode==='drop'?'uncertain-result':'uncertain');assert.equal(fake.commands.length,1);
 const summary=events.find(x=>x.scope==='bunny.http');assert.ok(summary);
 assert.equal(summary.attributes['bunny.outcome'],'uncertain');assert.equal(summary.attributes['bunny.write.possible'],true);
 const absent=await fetch(hub.url+'/api/unknown',{headers:{authorization:`Bearer ${token}`}});await absent.text();
 assert.equal(absent.status,404);assert.equal(events.at(-1).attributes['bunny.write.possible'],false);
});
