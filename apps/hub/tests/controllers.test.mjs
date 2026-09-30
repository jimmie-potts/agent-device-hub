import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {ControllerClient} from '../dist/controllers.js';

const fixtures=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
const value=definition=>structuredClone(fixtures.schemaCases.find(c=>c.definition===definition&&c.valid).value);
async function fake(handler){const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};}
const config=endpoint=>({id:'wall',kind:'nanoleaf',endpoint,token:'c'.repeat(43),controllerId:value('snapshot').identity.controllerId,deviceId:value('snapshot').identity.deviceId});

test('offline controller cannot occupy another device slot; reads never command',async()=>{
  let requests=0;
  const slow=await fake(()=>{}),healthy=await fake((req,res)=>{requests++;assert.equal(req.method,'GET');res.end(JSON.stringify(value('snapshot')));});
  const a=new ControllerClient(config(slow.endpoint),80),b=new ControllerClient(config(healthy.endpoint));
  try {
    const pending=assert.rejects(a.snapshot(),error=>error.code==='controller-unavailable');
    await assert.rejects(a.snapshot(),error=>error.code==='capacity');
    assert.deepEqual(await b.snapshot(),value('snapshot'));
    await pending;assert.equal(a.status().health,'unavailable');assert.equal(b.status().health,'ready');assert.equal(requests,1);
  } finally {a.close();b.close();await slow.close();await healthy.close();}
});

test('invalid responses and endpoint configuration reject without returning secrets',async()=>{
  const fakeServer=await fake((req,res)=>res.end(JSON.stringify({...value('snapshot'),token:'PRIVATE_CANARY'})));
  const client=new ControllerClient(config(fakeServer.endpoint));
  try {await assert.rejects(client.snapshot(),error=>error.code==='incompatible-controller'&&!error.message.includes('PRIVATE_CANARY'));}
  finally {client.close();await fakeServer.close();}
  assert.throws(()=>new ControllerClient(config('http://example.com:80/controller/v1')),/invalid-endpoint/);
});

test('controller conflicts remain actionable and no command is retried',async()=>{
  let calls=0;const request=value('request');
  const upstream=await fake((req,res)=>{calls++;res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({failure:{code:'revision-conflict'}}));});
  const client=new ControllerClient({...config(upstream.endpoint),controllerId:request.controllerId,deviceId:request.deviceId});
  try {await assert.rejects(client.command(request),error=>error.code==='revision-conflict'&&error.status===409);assert.equal(calls,1);}
  finally {client.close();await upstream.close();}
});


test('redirects never forward credentials; ambiguous timed-out commands are not retried',async()=>{
 let redirected=0,calls=0;
 const target=await fake((req,res)=>{redirected++;res.end('{}');});
 const redirect=await fake((req,res)=>{res.writeHead(307,{location:target.endpoint+'/snapshot'});res.end();});
 const stalled=await fake(()=>{calls++;});
 const reader=new ControllerClient(config(redirect.endpoint)),request=value('request');
 const writer=new ControllerClient({...config(stalled.endpoint),controllerId:request.controllerId,deviceId:request.deviceId},80);
 try {
  await assert.rejects(reader.snapshot(),error=>error.code==='controller-unavailable');assert.equal(redirected,0);
  await assert.rejects(writer.command(request),error=>error.code==='uncertain-result');assert.equal(calls,1);
  const pending=assert.rejects(writer.snapshot(),error=>error.code==='controller-unavailable');writer.close();await pending;
  await assert.rejects(writer.snapshot(),error=>error.code==='controller-unavailable');
 }finally{reader.close();writer.close();await redirect.close();await target.close();await stalled.close();}
});

const profile={profileId:'lifx-light',profileVersion:'1.0.0'};
const lightingSnapshot=snapshot=>({profile,controller:snapshot,lighting:{capabilities:{color:true,temperature:{minimum:1500,maximum:9000},effects:false},pending:[],
 observation:{status:'known',color:{hue:12000,saturation:32000,brightness:50000,kelvin:3500},readAt:{...snapshot.sampleClock},evidenceAgeMs:0},visible:{status:'unknown'}}});
const colorRequest=snapshot=>({apiVersion:'1.0',controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,requestId:snapshot.nextRequestId,
 expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:snapshot.generation,profile,command:{kind:'lifx.color.set',hue:200,saturation:80}});

test('tidbyt and lifx kinds read their configured device and have no integration route',async()=>{
 const seen=[],snapshot=value('snapshot'),request=value('request');
 const upstream=await fake((req,res)=>{seen.push(req.method+' '+req.url);res.end(JSON.stringify(snapshot));});
 try {
  for(const kind of ['tidbyt','lifx']){
   const client=new ControllerClient({...config(upstream.endpoint),kind});
   try {
    assert.deepEqual(await client.snapshot(),snapshot);
    assert.equal(client.status().kind,kind);
    for(const call of [()=>client.integrationSnapshot(),()=>client.integrationCommand(request),()=>client.integrationReceipt({epoch:'e',sequence:1}),()=>client.integrationCancel({})])
     await assert.rejects(call(),error=>error.code==='unsupported-capability'&&error.status===422);
   } finally {client.close();}
  }
  const read='GET /controller/v1/snapshot?deviceId='+encodeURIComponent(snapshot.identity.deviceId);
  assert.deepEqual(seen,[read,read]);
 } finally {await upstream.close();}
});

test('lifx lighting forwards only strict profile requests and checks what comes back',async()=>{
 const snapshot=value('snapshot'),seen=[];let reply;
 const upstream=await fake(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push([req.method,req.url,body&&JSON.parse(body)]);res.writeHead(reply.status??200,{'content-type':'application/json'});res.end(JSON.stringify(reply.body));});
 let client;
 try {
  client=new ControllerClient({...config(upstream.endpoint),kind:'lifx'});
  reply={body:lightingSnapshot(snapshot)};
  assert.deepEqual(await client.lightingSnapshot(),lightingSnapshot(snapshot));
  assert.deepEqual(seen.at(-1).slice(0,2),['GET','/controller/lifx-light/v1/snapshot?deviceId='+encodeURIComponent(snapshot.identity.deviceId)]);
  const request=colorRequest(snapshot);
  const receipt={...value('receipt'),controllerId:request.controllerId,deviceId:request.deviceId,requestId:request.requestId};
  reply={body:receipt};
  assert.deepEqual(await client.lightingCommand(request),{status:200,body:receipt});
  assert.deepEqual(seen.at(-1),['POST','/controller/lifx-light/v1/commands',request]);
  const temperature={...request,command:{kind:'lifx.temperature.set',kelvin:2700}};
  assert.equal((await client.lightingCommand(temperature)).status,200);
  const calls=seen.length;
  for(const invalid of [{...request,profile:{...profile,profileVersion:'2.0.0'}},{...request,command:{kind:'lifx.color.set',hue:361,saturation:1}},
   {...request,command:{kind:'lifx.color.set',hue:1.5,saturation:1}},{...request,command:{kind:'lifx.color.set',hue:1,saturation:1,brightness:1}},
   {...request,command:{kind:'lifx.temperature.set',kelvin:1000}},{...request,command:{kind:'brightness.set',percent:5}},{...request,address:'192.0.2.1'},
   (({profile:_,...rest})=>rest)(request),{...request,apiVersion:'2.0'}])
   await assert.rejects(client.lightingCommand(invalid),error=>error.code==='invalid-request'&&error.status===400);
  await assert.rejects(client.lightingCommand({...request,deviceId:'other'}),error=>error.code==='unknown-device');
  assert.equal(seen.length,calls);
  // What comes back must be for this device and this request.
  reply={body:{...receipt,requestId:{...receipt.requestId,sequence:receipt.requestId.sequence+1}}};
  await assert.rejects(client.lightingCommand(request),error=>error.code==='uncertain-result');
  reply={body:{...lightingSnapshot(snapshot),controller:{...snapshot,identity:{...snapshot.identity,deviceId:'other'}}}};
  await assert.rejects(client.lightingSnapshot(),error=>error.code==='incompatible-controller');
  reply={body:{...lightingSnapshot(snapshot),lighting:{...lightingSnapshot(snapshot).lighting,address:'192.0.2.1'}}};
  await assert.rejects(client.lightingSnapshot(),error=>error.code==='incompatible-controller');
  reply={status:409,body:{failure:{code:'request-conflict'}}};
  await assert.rejects(client.lightingCommand(request),error=>error.code==='request-conflict'&&error.status===409);
 } finally {client?.close();await upstream.close();}
 for(const kind of ['tidbyt','nanoleaf','pixoo']){
  const other=new ControllerClient({...config('http://127.0.0.1:9/controller/v1'),kind});
  try {
   await assert.rejects(other.lightingSnapshot(),error=>error.code==='unsupported-capability'&&error.status===422);
   await assert.rejects(other.lightingCommand(colorRequest(snapshot)),error=>error.code==='unsupported-capability'&&error.status===422);
  } finally {other.close();}
 }
});

// Hub #335: the opt-in bounded slot wait that only sends use. Reads keep the immediate capacity rejection.
async function gated(){
 const seen=[];let open;const gate=new Promise(resolve=>{open=resolve;});
 const server=await fake(async(req,res)=>{seen.push(req.method+' '+req.url);if(seen.length===1)await gate;res.end(JSON.stringify(value('snapshot')));});
 const client=new ControllerClient(config(server.endpoint));
 const reached=async()=>{while(!seen.length)await new Promise(resolve=>setTimeout(resolve,5));};
 return {seen,client,open,reached,close:async()=>{client.close();await server.close();}};
}

test('a send waits for the slot a read holds, then runs once while reads never wait',async()=>{
 const g=await gated();
 try {
  const read=g.client.snapshot();await g.reached();
  const order=[];
  const send=g.client.hold(2500,async()=>{order.push('send');assert.equal(g.client.status().pending,1);return 'sent';});
  // A read during the held slot and the waiting send is rejected at once, not queued behind them.
  await assert.rejects(g.client.snapshot(),error=>error.code==='capacity'&&error.status===429);
  await assert.rejects(g.client.snapshot('1.1'),error=>error.code==='capacity');
  await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(order,[]);
  g.open();
  assert.deepEqual(await read,value('snapshot'));assert.equal(await send,'sent');assert.deepEqual(order,['send']);
  assert.equal(g.client.status().pending,0);assert.deepEqual(g.seen.length,1);
  // Waiting sends take the slot in arrival order, each after the previous one releases it.
  const log=[];let first;
  const hold1=g.client.hold(0,()=>new Promise(resolve=>{first=resolve;log.push('one');}));
  const hold2=g.client.hold(2500,async()=>{log.push('two');});
  const hold3=g.client.hold(2500,async()=>{log.push('three');});
  await new Promise(resolve=>setTimeout(resolve,20));first();
  await Promise.all([hold1,hold2,hold3]);assert.deepEqual(log,['one','two','three']);
 } finally {await g.close();}
});

test('a send still waiting at its bound fails with capacity and contacts nothing',async()=>{
 const g=await gated();
 try {
  const read=g.client.snapshot();await g.reached();
  let ran=false;const started=performance.now();
  await assert.rejects(g.client.hold(120,async()=>{ran=true;}),error=>error.code==='capacity'&&error.status===429);
  assert.ok(performance.now()-started>=110);assert.equal(ran,false);
  g.open();await read;assert.equal(g.seen.length,1);
  // An expired waiter leaves nothing behind: the next send takes the free slot at once.
  assert.equal(await g.client.hold(0,async()=>'free'),'free');
  for(const invalid of [-1,2501,1.5,Number.NaN])assert.throws(()=>g.client.hold(invalid,async()=>{}),/invalid-slot-wait/);
 } finally {await g.close();}
});

test('closing the client fails waiting sends as unavailable',async()=>{
 const g=await gated();
 const read=assert.rejects(g.client.snapshot(),error=>error.code==='controller-unavailable');await g.reached();
 const waiting=assert.rejects(g.client.hold(2500,async()=>{assert.fail('must not run');}),error=>error.code==='controller-unavailable'&&error.status===503);
 await g.close();await waiting;await read;
 await assert.rejects(g.client.hold(2500,async()=>{}),error=>error.code==='controller-unavailable');
});

test('the held slot gives its reads only while it is held',async()=>{
 const g=await gated();g.open();
 try {
  let kept;
  const snapshot=await g.client.hold(0,async slot=>{kept=slot;return slot.snapshot('1.1');});
  assert.deepEqual(snapshot,value('snapshot'));
  await assert.rejects(kept.snapshot('1.1'),/slot-released/);
 } finally {await g.close();}
});
