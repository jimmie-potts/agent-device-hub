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
