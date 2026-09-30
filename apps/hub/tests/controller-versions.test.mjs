import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validate} from '@jimmie-potts/device-contracts';
import {ControllerClient} from '../dist/controllers.js';
import {startHub} from '../dist/server.js';
import {startFakeController,snapshotV1_1} from './fake-controller.mjs';

// Hub #576: controller contract 1.1 reads with a 1.0 fallback, over loopback HTTP against the shared fake controller.
async function pair(t,options,timeoutMs){
  const fake=await startFakeController(options),client=new ControllerClient(fake.config(),timeoutMs);
  t.after(async()=>{client.close();await fake.close();});
  return {fake,client};
}
const versionedReads=fake=>fake.requests.filter(r=>r.versioned);

test('a 1.1 controller is read at 1.1 and validated against snapshotV1_1',async t=>{
  const {fake,client}=await pair(t,{serves:'1.1'});
  const snapshot=await client.snapshot('1.1');
  assert.ok(validate('snapshotV1_1',snapshot));
  assert.deepEqual(snapshot,fake.snapshot11());
  assert.equal(snapshot.apiVersion,'1.1');assert.equal(snapshot.capabilities.moments.supported,true);assert.deepEqual(snapshot.state.moment,{current:{status:'none'},last:{status:'none'}});
  assert.deepEqual(fake.requests.map(r=>r.search),['?deviceId=light&apiVersion=1.1']);
  assert.deepEqual(client.negotiation(),{verdict:'1.1',epoch:'runtime-1'});
  assert.equal(client.status().health,'ready');assert.equal(fake.commands.length,0);
});

test('a 1.0-only controller costs exactly one fallback read and no further probes in its epoch',async t=>{
  const {fake,client}=await pair(t,{serves:'1.0'});
  assert.deepEqual(client.negotiation(),{verdict:'unknown'});
  const first=await client.snapshot('1.1');
  assert.deepEqual(first,fake.snapshot10());assert.ok(validate('snapshot',first));assert.equal(first.apiVersion,'1.0');
  assert.deepEqual(fake.requests.map(r=>r.search),['?deviceId=light&apiVersion=1.1','?deviceId=light']);
  assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-1'});
  for(let i=0;i<3;i++)assert.deepEqual(await client.snapshot('1.1'),fake.snapshot10());
  assert.equal(versionedReads(fake).length,1);assert.equal(fake.reads(),5);
  assert.equal(fake.commands.length,0);
});

test('a controller that negotiates down answers a versioned read with 1.0 and needs no second read',async t=>{
  const {fake,client}=await pair(t,{serves:'1.0-negotiating'});
  assert.deepEqual(await client.snapshot('1.1'),fake.snapshot10());
  assert.equal(fake.reads(),1);assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-1'});
  await client.snapshot('1.1');assert.equal(versionedReads(fake).length,1);
});

test('a restart that now serves 1.1 is found on the next read and a still 1.0-only restart probes once',async t=>{
  const {fake,client}=await pair(t,{serves:'1.0'});
  await client.snapshot('1.1');assert.equal(client.negotiation().verdict,'1.0-only');
  fake.restart({epoch:'runtime-2',serves:'1.1'});
  const upgraded=await client.snapshot('1.1');
  assert.equal(upgraded.apiVersion,'1.1');assert.equal(upgraded.identity.controllerEpoch,'runtime-2');
  assert.deepEqual(client.negotiation(),{verdict:'1.1',epoch:'runtime-2'});
  fake.restart({epoch:'runtime-3',serves:'1.0'});
  const before=fake.reads();
  const downgraded=await client.snapshot('1.1');
  assert.equal(downgraded.apiVersion,'1.0');assert.equal(downgraded.identity.controllerEpoch,'runtime-3');
  assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-3'});
  // A new epoch is detected by the first read and probed once; a controller still 1.0-only is then quiet again.
  fake.restart({epoch:'runtime-4'});
  const probes=versionedReads(fake).length;
  await client.snapshot('1.1');
  assert.equal(versionedReads(fake).length,probes+1);assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-4'});
  await client.snapshot('1.1');assert.equal(versionedReads(fake).length,probes+1);
  assert.ok(fake.reads()>before);assert.equal(fake.commands.length,0);
});

test('timeouts and 5xx answers never produce or change a verdict',async t=>{
  const {fake,client}=await pair(t,{serves:'1.0'},80);
  fake.failNext('5xx',{versioned:true});
  await assert.rejects(client.snapshot('1.1'),error=>error.code==='controller-unavailable'&&error.status===503);
  assert.deepEqual(client.negotiation(),{verdict:'unknown'});
  fake.failNext('timeout',{versioned:true});
  await assert.rejects(client.snapshot('1.1'),error=>error.code==='controller-unavailable');
  assert.deepEqual(client.negotiation(),{verdict:'unknown'});
  // The probe repeats until it gets an answer.
  assert.equal((await client.snapshot('1.1')).apiVersion,'1.0');assert.equal(versionedReads(fake).length,3);
  assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-1'});
  // Failures during the fallback read leave nothing behind, and with a verdict they leave it unchanged.
  fake.restart({epoch:'runtime-2'});
  fake.failNext('5xx',{versioned:false,times:1});
  await assert.rejects(client.snapshot('1.1'),error=>error.code==='controller-unavailable');
  assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-1'});
  fake.failNext('timeout',{versioned:false});
  await assert.rejects(client.snapshot('1.1'),error=>error.code==='controller-unavailable');
  assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-1'});
  assert.equal((await client.snapshot('1.1')).identity.controllerEpoch,'runtime-2');
  assert.deepEqual(client.negotiation(),{verdict:'1.0-only',epoch:'runtime-2'});
  // A 1.1 controller that fails a read stays 1.1.
  const {fake:modern,client:reader}=await pair(t,{serves:'1.1'},80);
  await reader.snapshot('1.1');modern.failNext('5xx');
  await assert.rejects(reader.snapshot('1.1'),error=>error.code==='controller-unavailable');
  assert.deepEqual(reader.negotiation(),{verdict:'1.1',epoch:'runtime-1'});
  assert.equal(fake.commands.length+modern.commands.length,0);
});

test('a probe that is refused but whose fallback fails records no verdict',async t=>{
  const {fake,client}=await pair(t,{serves:'1.0'});
  fake.failNext('5xx',{versioned:false});
  await assert.rejects(client.snapshot('1.1'),error=>error.code==='controller-unavailable');
  assert.deepEqual(client.negotiation(),{verdict:'unknown'});
  assert.equal((await client.snapshot('1.1')).apiVersion,'1.0');assert.equal(client.negotiation().verdict,'1.0-only');
});

test('a 1.1 answer that fails validation is incompatible and records nothing',async t=>{
  const broken=snapshotV1_1();delete broken.state.moment;
  const {createServer}=await import('node:http');
  const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(broken));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fake=await startFakeController(),client=new ControllerClient({...fake.config(),endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`});
  t.after(async()=>{client.close();await fake.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  await assert.rejects(client.snapshot('1.1'),error=>error.code==='incompatible-controller'&&error.status===502);
  assert.deepEqual(client.negotiation(),{verdict:'unknown'});assert.equal(client.status().health,'unavailable');
});

test('default reads keep the 1.0 shape, send no version parameter and never probe',async t=>{
  for(const serves of ['1.1','1.0']){
    const {fake,client}=await pair(t,{serves});
    for(let i=0;i<3;i++){
      const snapshot=await client.snapshot();
      assert.deepEqual(snapshot,fake.snapshot10());assert.ok(validate('snapshot',snapshot));assert.equal(snapshot.apiVersion,'1.0');
      assert.equal(snapshot.capabilities.moments,undefined);assert.equal(snapshot.state.moment,undefined);
    }
    assert.equal(fake.reads(),3);assert.equal(versionedReads(fake).length,0);assert.deepEqual(client.negotiation(),{verdict:'unknown'});
    assert.equal(fake.commands.length,0);
  }
});

test('negotiation holds the controller slot for both reads',async t=>{
  const {fake,client}=await pair(t,{serves:'1.0'});
  const first=client.snapshot('1.1'),second=client.snapshot('1.1');
  await assert.rejects(second,error=>error.code==='capacity'&&error.status===429);
  await first;assert.equal(fake.reads(),2);
});

// The hub routes and the per-device MCP status tool over the same fakes.
const token='a'.repeat(43),hash=value=>createHash('sha256').update(value).digest('hex');
const credential={id:'operator',digest:hash(token),scopes:['read','control','ingest'],devices:['modern','legacy']};
async function hubWith(t,modern,legacy){
  const directory=await mkdtemp(join(tmpdir(),'hub-versions-'));
  const hub=await startHub({directory,ownerId:'owner',consumers:[],credentials:[credential],
    controllers:[modern.config({id:'modern'}),legacy.config({id:'legacy'})]});
  t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
  return hub;
}
const get=(hub,path,bearer=token)=>fetch(hub.url+path,{headers:{authorization:`Bearer ${bearer}`,'x-pixoo-request':'1'}});

test('the snapshot route returns 1.0 by default and 1.1 only on request',async t=>{
  const modern=await startFakeController({serves:'1.1',controllerId:'modern-owner'}),legacy=await startFakeController({serves:'1.0',controllerId:'legacy-owner'});
  t.after(async()=>{await modern.close();await legacy.close();});
  const hub=await hubWith(t,modern,legacy);
  for(const [alias,fake] of [['modern',modern],['legacy',legacy]]){
    const plain=await get(hub,`/api/controllers/v1/${alias}/snapshot`);
    assert.equal(plain.status,200);assert.deepEqual(await plain.json(),fake.snapshot10());
    const explicit=await get(hub,`/api/controllers/v1/${alias}/snapshot?apiVersion=1.0`);
    assert.equal(explicit.status,200);assert.deepEqual(await explicit.json(),fake.snapshot10());
  }
  assert.equal(modern.reads.versioned(),0);assert.equal(legacy.reads.versioned(),0);
  const upgraded=await (await get(hub,'/api/controllers/v1/modern/snapshot?apiVersion=1.1')).json();
  assert.deepEqual(upgraded,modern.snapshot11());assert.equal(upgraded.capabilities.moments.supported,true);assert.deepEqual(upgraded.state.moment,{current:{status:'none'},last:{status:'none'}});
  const old=await (await get(hub,'/api/controllers/v1/legacy/snapshot?apiVersion=1.1')).json();
  assert.deepEqual(old,legacy.snapshot10());assert.equal(old.capabilities.moments,undefined);assert.equal(old.state.moment,undefined);
  // One fallback read for the epoch, however many versioned reads follow.
  for(let i=0;i<3;i++)await get(hub,'/api/controllers/v1/legacy/snapshot?apiVersion=1.1');
  assert.equal(legacy.reads.versioned(),1);
  // A restart that starts serving 1.1 is seen by the next versioned read.
  legacy.restart({epoch:'runtime-2',serves:'1.1'});
  const restarted=await (await get(hub,'/api/controllers/v1/legacy/snapshot?apiVersion=1.1')).json();
  assert.equal(restarted.apiVersion,'1.1');assert.equal(restarted.identity.controllerEpoch,'runtime-2');
  assert.equal(modern.commands.length+legacy.commands.length,0);
});

test('unsupported values and extra parameters answer 400 before any controller read',async t=>{
  const modern=await startFakeController({serves:'1.1',controllerId:'modern-owner'}),legacy=await startFakeController({serves:'1.0',controllerId:'legacy-owner'});
  t.after(async()=>{await modern.close();await legacy.close();});
  const hub=await hubWith(t,modern,legacy);
  for(const query of ['?apiVersion=1.2','?apiVersion=2.0','?apiVersion=','?apiVersion=1.01','?apiVersion=1.1&apiVersion=1.1','?apiVersion=1.1&apiVersion=1.0',
    '?apiVersion=1.1&deviceId=light','?deviceId=light','?apiVersion=1.1&x=1','?x=1','?apiversion=1.1']){
    const response=await get(hub,'/api/controllers/v1/modern/snapshot'+query);
    assert.equal(response.status,400,query);assert.deepEqual(await response.json(),{error:{code:'invalid-request'}},query);
  }
  assert.equal(modern.reads(),0);assert.equal(legacy.reads(),0);
  // Authorization and target checks still come first.
  assert.equal((await get(hub,'/api/controllers/v1/modern/snapshot?apiVersion=1.2','x'.repeat(43))).status,401);
  assert.equal((await get(hub,'/api/controllers/v1/other/snapshot?apiVersion=1.2')).status,403);
  assert.equal(modern.reads()+legacy.reads(),0);
});

test('reads, retries and reconnects against either controller send no command',async t=>{
  const modern=await startFakeController({serves:'1.1',controllerId:'modern-owner'}),legacy=await startFakeController({serves:'1.0',controllerId:'legacy-owner'});
  t.after(async()=>{await modern.close();await legacy.close();});
  const hub=await hubWith(t,modern,legacy);
  for(let i=0;i<4;i++)for(const alias of ['modern','legacy'])for(const query of ['','?apiVersion=1.1'])await get(hub,`/api/controllers/v1/${alias}/snapshot${query}`);
  await get(hub,'/api/dashboard/v1/context');
  assert.equal(modern.commands.length+legacy.commands.length,0);
  assert.ok(modern.requests.concat(legacy.requests).every(r=>r.method==='GET'));
});
