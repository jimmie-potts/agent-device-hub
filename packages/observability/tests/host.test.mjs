import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {record} from './sample.mjs';
import {catalog} from '@jimmie-potts/bunny-observability';
import {createHostDiagnostics} from '../runtime/host.mjs';
import {profileSpanNames, projectSpan} from '../runtime/span-projection.mjs';
import {ROOT_CONTEXT, trace} from '@opentelemetry/api';

test('disabled host preserves action results without constructing output', async () => {
  const host = await createHostDiagnostics({enabled:false});
  assert.equal(host.emit(record),false);
  assert.equal(await host.run({scope:'bunny.http',operation:'status'},async()=>42),42);
  await host.shutdown();
});

test('explicit host produces canonical local logs and correlated manual OTLP spans', async () => {
  const received=[], local=[];
  const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    received.push({url:req.url,body:JSON.parse(body)});res.writeHead(200,{'content-type':'application/json'});res.end('{}');
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const host=await createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,samplingRatio:1,
    collectorOrigin:`http://127.0.0.1:${server.address().port}`,localSink:line=>local.push(JSON.parse(line))});
  try {
    const results=await Promise.all([1,2].map(n=>host.run({scope:'bunny.http',operation:'status',root:true,
      attributes:{'bunny.request.id':String(n)}},async()=>host.run({scope:'bunny.queue',operation:'status',spanName:'bunny.command.execute'},async()=>n))));
    assert.deepEqual(results,[1,2]);
    await host.shutdown();
    assert.equal(local.length,4);
    const spans=received.flatMap(x=>x.body.resourceSpans?.[0].scopeSpans[0].spans??[]);
    const logs=received.flatMap(x=>x.body.resourceLogs?.[0].scopeLogs[0].logRecords??[]);
    assert.equal(spans.length,4);assert.equal(logs.length,4);
    assert.equal(new Set(local.map(x=>x.trace_id)).size,2);
    for(const item of local)assert.ok(spans.some(x=>x.traceId===item.trace_id&&x.spanId===item.span_id));
    assert.equal(spans.filter(x=>x.parentSpanId).length,2);
  } finally {await host.shutdown();await new Promise(resolve=>server.close(resolve));}
});

test('stalled output is bounded and diagnostic failures preserve domain error identity', async()=>{
  let calls=0;const failure=new Error('private domain failure');
  const host=await createHostDiagnostics({enabled:true,resource:record.resource,
    localSink:()=>new Promise(()=>{}),queueOptions:{maxRecords:2,flushMs:20}});
  for(let n=0;n<4;n++)host.event('process.started','bunny.host',{'bunny.operation':'startup'});
  await assert.rejects(host.run({scope:'bunny.http',operation:'status'},()=>{calls++;throw failure;}),error=>error===failure);
  assert.equal(calls,1);assert.ok(host.counts().logs.dropped>=3);assert.equal(host.counts().logs.queued,2);
  const start=performance.now();await host.shutdown();assert.ok(performance.now()-start<250);
  assert.equal(host.counts().logs.queued,0);
});

test('unavailable Collector preserves successful results and accounts failed export',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const host=await createHostDiagnostics({enabled:true,resource:record.resource,collectorOrigin:`http://127.0.0.1:${port}`,localSink:()=>{}});
  assert.equal(await host.run({scope:'bunny.http',operation:'status'},()=>123),123);
  await host.shutdown();assert.equal(host.counts().transport[0].failed,1);
});

test('zero sampling keeps valid unsampled correlation without exporting spans',async()=>{
 const server=createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end('{}');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const local=[];
 const host=await createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,samplingRatio:0,
  collectorOrigin:`http://127.0.0.1:${server.address().port}`,localSink:line=>local.push(JSON.parse(line))});
 try{await host.run({scope:'bunny.http',operation:'status',root:true},()=>42);await host.shutdown();
  assert.equal(local[0].trace_flags,'00');assert.match(local[0].trace_id,/^[a-f0-9]{32}$/);assert.equal(host.counts().transport[1].attempted,0);
 }finally{await host.shutdown();await new Promise(resolve=>server.close(resolve));}
});

test('a typed domain rejection stays unchanged and gets a truthful diagnostic outcome',async()=>{
 const local=[],receipt={outcome:'failed'};
 const host=await createHostDiagnostics({enabled:true,resource:record.resource,localSink:line=>local.push(JSON.parse(line))});
 assert.equal(await host.run({scope:'bunny.mcp',operation:'verification',outcome:()=>'rejected'},()=>receipt),receipt);
 await host.shutdown();assert.equal(local[0].event_name,'operation.failed');assert.equal(local[0].attributes['bunny.outcome'],'rejected');
});

// Hub #949: a bounded local span sink records spans without a Collector, and explicit parents need no process context.
const runtimeResource={...record.resource,'service.name':'runtime','service.version':'0.1.0'};
const remoteParent=(traceId,spanId)=>trace.setSpanContext(ROOT_CONTEXT,{traceId,spanId,traceFlags:1,isRemote:true});

test('tracing with a local span sink and no Collector records projected spans with parents and status',async()=>{
 const spans=[];
 const host=await createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,samplingRatio:1,localSink:()=>{},
  localSpanSink:line=>{spans.push(JSON.parse(line));}});
 const failure=new Error('tok_SYNTHETIC123');
 const result=await host.run({scope:'bunny.http',operation:'status',root:true},async()=>{
  await assert.rejects(host.run({scope:'bunny.queue',operation:'status',spanName:'bunny.command.execute'},()=>{throw failure;}),error=>error===failure);
  return 7;
 });
 assert.equal(result,7);
 await host.shutdown();
 const [child,parent]=spans.map(item=>item.resourceSpans[0].scopeSpans[0].spans[0]);
 assert.ok(child&&parent);
 assert.equal(parent.name,'bunny.helper.run');assert.equal(child.name,'bunny.command.execute');
 assert.equal(child.traceId,parent.traceId);assert.equal(child.parentSpanId,parent.spanId);assert.equal(parent.parentSpanId,undefined);
 assert.equal(child.status.code,2,'the failed operation');assert.equal(parent.status.code,0);
 assert.ok(BigInt(child.endTimeUnixNano)>=BigInt(child.startTimeUnixNano));
 assert.deepEqual(host.counts().transport,[],'no Collector transport, so no network request');
 assert.equal(JSON.stringify(spans).includes('tok_SYNTHETIC123'),false);
});

test('tracing with neither a Collector nor a local span sink still fails',async()=>{
 await assert.rejects(createHostDiagnostics({enabled:true,resource:record.resource,tracing:true}),/Tracing requires/);
 await assert.rejects(createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,localSpanSink:'stderr'}),/Invalid host/);
});

test('a stalled or throwing local span sink is bounded, counted and never reaches the operation',async()=>{
 const stalled=await createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,samplingRatio:1,localSink:()=>{},
  localSpanSink:()=>new Promise(()=>{}),queueOptions:{maxRecords:2,flushMs:20}});
 for(let n=0;n<5;n++)assert.equal(await stalled.run({scope:'bunny.http',operation:'status',root:true},()=>n),n);
 assert.ok(stalled.counts().traces.output.dropped>=2,'the queue holds at most two spans');
 const start=performance.now();await stalled.shutdown();assert.ok(performance.now()-start<250);
 const throwing=await createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,samplingRatio:1,localSink:()=>{},
  localSpanSink:()=>{throw new Error('tok_SYNTHETIC123');}});
 assert.equal(await throwing.run({scope:'bunny.http',operation:'status',root:true},()=>'kept'),'kept');
 await throwing.shutdown();
 assert.equal(throwing.counts().traces.output.failed,1);
 assert.equal(JSON.stringify(throwing.counts()).includes('tok_SYNTHETIC123'),false);
});

test('two hosts without a process context keep their own spans and explicit parents',async()=>{
 const sinks=[[],[]];
 const hosts=await Promise.all(sinks.map(lines=>createHostDiagnostics({enabled:true,resource:runtimeResource,schemaVersion:'1.3',tracing:true,
  samplingRatio:1,globalContext:false,localSink:()=>{},localSpanSink:line=>{lines.push(JSON.parse(line).resourceSpans[0].scopeSpans[0].spans[0]);}})));
 const tracers=hosts.map(host=>host.tracerFor({resource:runtimeResource,scope:'bunny.runtime'}));
 const parents=[remoteParent('11111111111111111111111111111111','1111111111111111'),remoteParent('22222222222222222222222222222222','2222222222222222')];
 const started=tracers.map((tracer,index)=>tracer.startSpan('bunny.command.queue',{attributes:{'bunny.provenance':'source'}},parents[index]));
 await new Promise(resolve=>setImmediate(resolve));
 for(const span of started.reverse())span.end();
 // A third host may still own the process context, since the first two installed none, and its active span never becomes
 // their parent.
 const owned=[];
 const owner=await createHostDiagnostics({enabled:true,resource:record.resource,tracing:true,samplingRatio:1,localSink:()=>{},
  localSpanSink:line=>{owned.push(JSON.parse(line).resourceSpans[0].scopeSpans[0].spans[0]);}});
 const fields={'bunny.module':'lamp'};
 assert.equal(await owner.run({scope:'bunny.http',operation:'status',root:true},()=>hosts[0].run({scope:'bunny.module',operation:'status',attributes:fields},()=>'kept')),'kept');
 await owner.shutdown();
 await Promise.all(hosts.map(host=>host.shutdown()));
 assert.equal(owned.length,1);
 const [ownerSpan]=owned;
 const [first,run]=sinks[0];
 assert.deepEqual(sinks.map(lines=>lines.slice(0,1).map(span=>[span.traceId,span.parentSpanId])),
  [[['11111111111111111111111111111111','1111111111111111']],[['22222222222222222222222222222222','2222222222222222']]],
  'each host has its own span with its explicit parent');
 assert.equal(sinks[1].length,1);
 assert.ok(first&&run&&ownerSpan);
 assert.equal(run.name,'bunny.helper.run');
 assert.equal(run.parentSpanId,undefined,'the run under another host\'s span is a root of its own');
 assert.notEqual(run.traceId,ownerSpan.traceId);
});

test('a host names the profile of its records and of its spans\' metadata',async()=>{
 await assert.rejects(createHostDiagnostics({enabled:true,resource:runtimeResource,localSink:()=>{}}),/Invalid host resource/,'profile 1.1 has no runtime service');
 await assert.rejects(createHostDiagnostics({enabled:true,resource:record.resource,schemaVersion:'1.4',localSink:()=>{}}),/Invalid host/);
 const lines=[];
 const host=await createHostDiagnostics({enabled:true,resource:runtimeResource,schemaVersion:'1.3',tracing:true,samplingRatio:1,globalContext:false,
  localSink:()=>{},localSpanSink:line=>{lines.push(JSON.parse(line).resourceSpans[0].scopeSpans[0]);}});
 const module=host.tracerFor({resource:runtimeResource,scope:'bunny.module'});
 module.startSpan('bunny.device.call',{attributes:{'bunny.provenance':'source','bunny.module':'lamp'}},ROOT_CONTEXT).end();
 host.tracerFor({resource:runtimeResource,scope:'bunny.runtime'}).startSpan('bunny.command.request',
  {attributes:{'bunny.provenance':'source','bunny.routing.key':'bunny.cmd.lamp.lamp-1'}},ROOT_CONTEXT).end();
 module.startSpan('bunny.device.call',{attributes:{'bunny.provenance':'source'}},ROOT_CONTEXT).end();
 await host.shutdown();
 assert.deepEqual(lines.map(group=>[group.scope.name,group.spans[0].name]),[['bunny.module','bunny.device.call'],['bunny.runtime','bunny.command.request']]);
 assert.ok(lines[0].spans[0].attributes.some(item=>item.key==='bunny.schema.version'&&item.value.stringValue==='1.3'));
 assert.equal(host.counts().traces.invalid,1,'a module span without its module\'s name is not recorded');
});

test('each profile registers only its own span names, so an earlier host records no span a later profile adds',async()=>{
 const later=catalog.additions['1.3'].span_names;
 assert.deepEqual(later,['bunny.outcome.publish','bunny.device.call']);
 for(const version of ['1.0','1.1','1.2'])assert.deepEqual(profileSpanNames(version).filter(name=>later.includes(name)),[],`profile ${version}`);
 assert.deepEqual(profileSpanNames('1.3'),catalog.span_names);
 assert.deepEqual(profileSpanNames('1.4'),[],'an unknown profile registers none');
 // A host's spans carry its records' profile, so a 1.2 or 1.1 host records the names its profile has and drops the rest.
 const recorded=async(schemaVersion,resource,scope)=>{
  const names=[];
  const host=await createHostDiagnostics({enabled:true,resource,schemaVersion,tracing:true,samplingRatio:1,globalContext:false,localSink:()=>{},
   localSpanSink:line=>{names.push(JSON.parse(line).resourceSpans[0].scopeSpans[0].spans[0].name);}});
  const tracer=host.tracerFor({resource,scope});
  for(const name of ['bunny.command.request','bunny.device.call','bunny.outcome.publish'])
   tracer.startSpan(name,{attributes:{'bunny.provenance':'source'}},ROOT_CONTEXT).end();
  await host.shutdown();
  const {invalid,unassociated}=host.counts().traces;
  return {names,invalid,unassociated};
 };
 // Refused when the span starts, so it is never registered and its end finds nothing to project.
 assert.deepEqual(await recorded('1.3',runtimeResource,'bunny.runtime'),
  {names:['bunny.command.request','bunny.device.call','bunny.outcome.publish'],invalid:0,unassociated:0});
 assert.deepEqual(await recorded('1.2',runtimeResource,'bunny.runtime'),{names:['bunny.command.request'],invalid:2,unassociated:2});
 assert.deepEqual(await recorded('1.1',record.resource,'bunny.http'),{names:['bunny.command.request'],invalid:2,unassociated:2});
 // The projection checks the name against its metadata's own profile too.
 const span={spanContext:()=>({traceId:'1'.repeat(32),spanId:'2'.repeat(16),traceFlags:1}),startTime:[1,0],endTime:[1,5],kind:0,status:{code:0}};
 assert.ok(projectSpan(span,{...record,schema_version:'1.3'},'bunny.device.call'));
 assert.equal(projectSpan(span,{...record,schema_version:'1.2'},'bunny.device.call'),undefined);
 assert.equal(projectSpan(span,{...record,schema_version:'1.1'},'bunny.outcome.publish'),undefined);
 assert.ok(projectSpan(span,{...record,schema_version:'1.1'},'bunny.helper.run'));
});
