import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHub} from '../dist/server.js';
import {createHash} from 'node:crypto';
import {validateRequest,configurationResult} from '../dist/vendor/nanoleaf-integration.js';
import {validateIntegrationSnapshot,validateIntegrationReceipt} from '../dist/integration.js';

test('pinned Nanoleaf request fixtures and configuration-only outcomes',async()=>{
  const pin=JSON.parse(await readFile(new URL('../fixtures/nanoleaf-source.json',import.meta.url),'utf8'));
  for(const [path,hash] of Object.entries(pin.files)) assert.equal(createHash('sha256').update(await readFile(new URL('../'+path.replace(/^apps\/hub\//,''),import.meta.url))).digest('hex'),hash);
  const cases=JSON.parse(await readFile(new URL('../fixtures/nanoleaf-integration.json',import.meta.url),'utf8'));
  for(const c of cases.requests) assert.equal(validateRequest(c.request),c.valid,c.name);
  for(const c of cases.receipts) assert.equal(configurationResult(c.receipt),c.result,c.name);
});

export const snapshot={apiVersion:'nanoleaf.integration/1.0',identity:{controllerId:'controller',deviceId:'device',sourceId:'source',controllerEpoch:'epoch'},
 configurationRevision:0,revision:'b'.repeat(64),mode:'Work',settings:{style:'classic',coverage:'whole'},source:'legacy',projects:[],tasks:[],elements:[],wallPending:null,
 pending:[],outcomes:[],nextRequestId:{epoch:'a'.repeat(32),sequence:0},
 capabilities:Object.fromEntries(['settings.set','elements.assign','task.assign','project.color','mode.set'].map(k=>[k,{supported:true,scope:'control',...(k==='mode.set'?{route:'/controller/v1/commands'}:{})}])),
 limits:{maxItems:1000,maxPending:1,maxReceipts:256,maxBodyBytes:65536}};

test('integration projection rejects unexpected private data and invalid receipts',()=>{
 assert.equal(validateIntegrationSnapshot(snapshot),true);
 assert.equal(validateIntegrationSnapshot({...snapshot,token:'PRIVATE_CANARY'}),false);
 assert.equal(validateIntegrationSnapshot({...snapshot,projects:[{id:'project-'+'a'.repeat(64),color:'#ffffff',title:'PRIVATE_CANARY'}]}),false);
 assert.equal(validateIntegrationReceipt({apiVersion:'nanoleaf.integration/1.0',requestId:snapshot.nextRequestId,outcome:'applied',priorEffects:'configuration',physicalOutcome:'unknown'}),true);
 assert.equal(validateIntegrationReceipt({apiVersion:'nanoleaf.integration/1.0',requestId:snapshot.nextRequestId,outcome:'applied',priorEffects:'none',physicalOutcome:'sent'}),false);
});


test('Nanoleaf routes retain owner status, tickets and private credential boundary',async()=>{
 const cases=JSON.parse(await readFile(new URL('../fixtures/nanoleaf-integration.json',import.meta.url),'utf8'));
 const request=cases.requests.find(c=>c.valid).request;
 const receipt={apiVersion:snapshot.apiVersion,requestId:request.requestId,outcome:'failed',priorEffects:'none',physicalOutcome:'unknown',failure:{code:'request-expired'}};
 const nativeToken='n'.repeat(43),browserToken='b'.repeat(43);let status=410;const seen=[];
 const native=createServer((req,res)=>{seen.push({path:req.url,authorization:req.headers.authorization});res.writeHead(req.url.includes('/snapshot')?200:status,{'content-type':'application/json'});res.end(JSON.stringify(req.url.includes('/snapshot')?snapshot:receipt));});
 await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));const directory=await mkdtemp(join(tmpdir(),'hub-integration-'));let hub;
 try{
  hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[{id:'wall',kind:'nanoleaf',controllerId:'controller',deviceId:'device',endpoint:`http://127.0.0.1:${native.address().port}/controller/v1`,token:nativeToken}],credentials:[{id:'browser',digest:createHash('sha256').update(browserToken).digest('hex'),scopes:['read','control'],devices:['wall']}]});
  const headers={authorization:`Bearer ${browserToken}`,'content-type':'application/json','x-pixoo-request':'1'};
  const call=(path,body)=>fetch(hub.url+'/api/controllers/v1/wall/integration/'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const current=await call('snapshot');assert.equal(current.status,200);assert.deepEqual(await current.json(),snapshot);
  let result=await call('commands',request);assert.equal(result.status,410);assert.deepEqual(await result.json(),receipt);
  status=200;result=await call('commands',request);assert.equal(result.status,200);assert.deepEqual(await result.json(),receipt);
  result=await call(`receipt?epoch=${request.requestId.epoch}&sequence=0`);assert.equal(result.status,200);assert.deepEqual(await result.json(),receipt);
  status=202;receipt.outcome='queued';delete receipt.failure;result=await call('commands',request);assert.equal(result.status,202);assert.deepEqual(await result.json(),receipt);
  status=200;receipt.outcome='cancelled';result=await call('cancel',{apiVersion:snapshot.apiVersion,deviceId:'device',requestId:request.requestId});assert.equal(result.status,200);assert.deepEqual(await result.json(),receipt);
  assert.ok(seen.every(row=>row.authorization===`Bearer ${nativeToken}`));assert.ok(seen.every(row=>row.path.startsWith('/controller/integration/v1/')));
 }finally{await hub?.close();await new Promise(resolve=>{native.close(resolve);native.closeAllConnections();});await rm(directory,{recursive:true,force:true});}
});
