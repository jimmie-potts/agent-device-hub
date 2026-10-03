import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {record} from './sample.mjs';
import {createHostDiagnostics} from '../runtime/host.mjs';

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
