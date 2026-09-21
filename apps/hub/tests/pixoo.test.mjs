import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ControllerClient} from '../dist/controllers.js';
const ticket='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1';
const snapshot={apiVersion:'pixoo-integration/1.0',serverId:ticket.split(':')[0],nextRequestId:ticket,configurationRevision:0,
 configuration:{version:1,mode:'media',filter:{},cadenceMs:1000},sourceRevision:null,sourceConnection:'unavailable',renditionGeneration:null,generation:0,pendingMode:null,participating:false,inFlight:0,lastOutcome:null,
 capabilities:{modes:['monitor','media'],filters:['provider','projectId','session','q'],minimumCadenceMs:1000,maximumCadenceMs:10000},identity:{controllerId:'pixoo-controller',deviceId:'pixoo',sourceId:'pixoo'}};
test('Pixoo extension preserves native mode/view guards and sanitizes conflicts',async()=>{
 let status=200,value=snapshot;const seen=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push({url:req.url,body:body?JSON.parse(body):null});res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=new ControllerClient({id:'desk',kind:'pixoo',controllerId:'pixoo-controller',deviceId:'pixoo',endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:'p'.repeat(43)});
 try{
  assert.deepEqual(await client.integrationSnapshot(),snapshot);
  const request={apiVersion:snapshot.apiVersion,controllerId:'pixoo-controller',deviceId:'pixoo',requestId:ticket,expectedConfigurationRevision:0,expectedGeneration:0,action:{operation:'view',filter:{projectId:'chosen',provider:'codex'},cadenceMs:2000}};
  const commandResult={...snapshot};delete commandResult.identity;value=commandResult;
  assert.deepEqual(await client.integrationCommand(request),{status:200,body:commandResult});
  assert.equal(seen[0].url,'/controller/pixoo-integration/v1/snapshot');assert.deepEqual(seen[1].body,request);
  status=409;value={error:{code:'revision-conflict',message:'PRIVATE_CANARY'}};
  await assert.rejects(client.integrationCommand(request),e=>e.code==='revision-conflict'&&e.status===409&&!e.message.includes('PRIVATE_CANARY'));
  const count=seen.length;await assert.rejects(client.integrationCommand({...request,action:{operation:'view',filter:{prompt:'private'},cadenceMs:2000}}),e=>e.code==='invalid-request');assert.equal(seen.length,count);
  status=200;value={...snapshot,token:'PRIVATE_CANARY'};await assert.rejects(client.integrationSnapshot(),e=>e.code==='incompatible-controller');
  await assert.rejects(client.integrationReceipt({epoch:'a'.repeat(32),sequence:0}),e=>e.code==='unsupported-capability');
 }finally{client.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});

test('pinned owning-service Pixoo examples match the strict projection',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const {validatePixooRequest,validatePixooSnapshot}=await import('../dist/pixoo-integration.js');
 const bytes=await readFile(new URL('../fixtures/pixoo-integration.json',import.meta.url));
 const pin=JSON.parse(await readFile(new URL('../fixtures/pixoo-source.json',import.meta.url),'utf8'));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.fixtureSha256);
 const examples=JSON.parse(bytes);assert.equal(validatePixooSnapshot(examples.snapshot,true),true);
 for(const c of examples.cases){assert.equal(validatePixooRequest(c.request),true);assert.equal(validatePixooSnapshot(c.result),true);}
});
