import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {validate} from '@jimmie-potts/device-contracts';
import {startHub} from '../dist/server.js';

const token='a'.repeat(43),readToken='b'.repeat(43);
const hash=value=>createHash('sha256').update(value).digest('hex');
const credentials=[{id:'writer',digest:hash(token),scopes:['read','ingest','control','admin'],devices:[]},
  {id:'reader',digest:hash(readToken),scopes:['read'],devices:[]}];
const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'},
 turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:Date.now(),ordering:{status:'unknown'}};

test('approval recovery requires control authority, exact revision and stale evidence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-approval-'));let hub,clock=1000;
 try{
  hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[],clock:()=>clock});
  const call=(path,body,credential=token)=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${credential}`,'x-pixoo-request':'1','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  await call('/api/monitor/v1/events',{...event,event:{kind:'attention.approval',attention:{status:'unknown'}}});
  let view=await (await call('/api/monitor/v1/sessions')).json();
  const command={operation:'recover-approval',requestId:view.nextRequestId,identity:event.identity,turnId:'turn',expectedRevision:view.snapshot.revision};
  assert.equal((await call('/api/monitor/v1/commands',command,readToken)).status,403);
  assert.deepEqual(await (await call('/api/monitor/v1/commands',command)).json(),{ok:false,code:'invalid-operation'});
  clock+=300000;
  view=await (await call('/api/monitor/v1/sessions')).json();
  const recover={...command,requestId:view.nextRequestId};
  const applied=await (await call('/api/monitor/v1/commands',recover)).json();
  assert.equal(applied.ok,true);
  assert.deepEqual(await (await call('/api/monitor/v1/commands',recover)).json(),applied);
  view=await (await call('/api/monitor/v1/sessions')).json();
  assert.equal(view.snapshot.sessions[0].attention.length,0);
  assert.equal(view.snapshot.sessions[0].freshness,'uncertain');
  assert.deepEqual(await (await call('/api/monitor/v1/commands',{...command,requestId:view.nextRequestId})).json(),{ok:false,code:'revision-conflict'});
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('authenticated Pixoo-compatible reads, scoped writes, replay and restart fence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-http-'));let hub;
  try {
    hub=await startHub({directory,ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true}],credentials,controllers:[]});
    const call=async(path,body,credential=token,headers={})=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${credential}`,'x-pixoo-request':'1','content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions')).status,401);
    assert.equal((await call('/api/monitor/v1/events',event,readToken)).status,403);
    assert.equal((await call('/api/monitor/v1/events',event,token,{origin:'http://evil.invalid'})).status,403);
    assert.equal((await call('/api/monitor/v1/events',{...event,prompt:'PRIVATE_CANARY'})).status,400);
    assert.equal((await call('/api/monitor/v1/events',event)).status,200);
    let view=await (await call('/api/monitor/v1/sessions')).json();
    assert.equal(view.ownerId,'owner');assert.equal(view.snapshot.sessions.length,1);
    assert.equal(view.matches,undefined);
    assert.deepEqual((await (await call('/api/monitor/v1/sessions?q=')).json()).matches,[event.identity]);
    assert.deepEqual((await (await call('/api/monitor/v1/sessions?q=does-not-match')).json()).matches,[]);
    const command={operation:'label',requestId:view.nextRequestId,identity:event.identity,label:'Explicit label'};
    const first=await (await call('/api/monitor/v1/commands',command)).json();
    assert.deepEqual(await (await call('/api/monitor/v1/commands',command)).json(),first);
    assert.equal((await call('/api/monitor/v1/commands',{...command,label:'Different'})).status,409);
    view=await (await call('/api/monitor/v1/sessions')).json();
    assert.equal(view.snapshot.sessions[0].label,'Explicit label');
    assert.equal((await call('/api/monitor/v1/commands',{operation:'quiesce',requestId:view.nextRequestId})).status,200);
    assert.equal((await call('/api/monitor/v1/events',event)).status,503);
    await hub.close();hub=undefined;
    await assert.rejects(startHub({directory,ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true}],credentials,controllers:[]}),/owner-quiesced/);
  } finally {await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('typed upstream rejection keeps its HTTP status, identity and receipt',async()=>{
 const corpus=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
 const request=structuredClone(corpus.schemaCases.find(c=>c.definition==='request'&&c.valid).value);
 const receipt=structuredClone(corpus.schemaCases.find(c=>c.definition==='receipt'&&c.valid).value);
 Object.assign(receipt,{controllerId:request.controllerId,deviceId:request.deviceId,requestId:request.requestId,outcome:'failed',priorEffects:'none',completedOperations:[],uncertainOperations:[],failure:{code:'revision-conflict'}});
 assert.equal(validate('receipt',receipt),true);
 let calls=0,status=409;const fake=createServer((req,res)=>{calls++;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(receipt));});
 await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
 const directory=await mkdtemp(join(tmpdir(),'hub-receipt-'));let hub;
 try {
  hub=await startHub({directory,ownerId:'owner',consumers:[],credentials:[{...credentials[0],devices:['wall']}],controllers:[{id:'wall',kind:'nanoleaf',controllerId:request.controllerId,deviceId:request.deviceId,token:'c'.repeat(43),endpoint:`http://127.0.0.1:${fake.address().port}/controller/v1`}]});
  const response=await fetch(hub.url+'/api/controllers/v1/wall/commands',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-pixoo-request':'1','content-type':'application/json'},body:JSON.stringify(request)});
  assert.equal(response.status,409);assert.deepEqual(await response.json(),receipt);assert.equal(calls,1);
  status=200;
  const replay=await fetch(hub.url+'/api/controllers/v1/wall/commands',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-pixoo-request':'1','content-type':'application/json'},body:JSON.stringify(request)});
  assert.equal(replay.status,200);assert.deepEqual(await replay.json(),receipt);assert.equal(calls,2);

 }finally{await hub?.close();await new Promise(resolve=>{fake.close(resolve);fake.closeAllConnections();});await rm(directory,{recursive:true,force:true});}
});

test('feed publishes quiesced health at the same revision and revocation closes streams',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-feed-'));let hub,reader;
 try {
  hub=await startHub({directory,ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true}],credentials,controllers:[]});
  const response=await fetch(hub.url+'/api/monitor/v1/changes',{headers:{authorization:`Bearer ${readToken}`},signal:AbortSignal.timeout(5000)});
  reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/"collector":"running"/);
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
  const view=await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json();
  assert.equal((await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers,body:JSON.stringify({operation:'quiesce',requestId:view.nextRequestId})})).status,200);
  assert.match(new TextDecoder().decode((await reader.read()).value),/"collector":"quiesced"/);
  hub.replaceCredentials([credentials[0]]);
  try {const end=await reader.read();assert.equal(end.done,true);}catch(error){assert.match(String(error),/terminated|abort/);}
  assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions',{headers:{authorization:`Bearer ${readToken}`}})).status,401);
 }finally{await reader?.cancel().catch(()=>{});await hub?.close();await rm(directory,{recursive:true,force:true});}
});


test('aggregate replay retention expires old tickets and rejects them after credential revocation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-replay-'));let hub;
 try {
  hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[]});
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
  let original;
  for(let i=0;i<257;i++){
   const view=await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json();
   const command={operation:'quiesce',requestId:view.nextRequestId};original??=command;
   const response=await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers,body:JSON.stringify(command)});
   assert.equal(response.status,200);const exported=await response.json();assert.equal(exported.revision,0);
  }
  const replay=()=>fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers,body:JSON.stringify(original)});
  assert.equal((await replay()).status,410);
  hub.replaceCredentials([credentials[1]]);assert.equal((await replay()).status,401);
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('tidbyt and lifx components route controller v1 and only lifx has lighting routes',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
 const snapshot=structuredClone(fixtures.schemaCases.find(c=>c.definition==='snapshot'&&c.valid).value);
 const identity=deviceId=>({...snapshot,identity:{...snapshot.identity,controllerId:'local',deviceId}});
 const profile={profileId:'lifx-light',profileVersion:'1.0.0'};
 const lighting={capabilities:{color:true,temperature:{minimum:1500,maximum:9000},effects:false},pending:[],observation:{status:'unknown'},visible:{status:'unknown'}};
 const seen=[];
 const fake=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const url=new URL(req.url,'http://x'),deviceId=url.searchParams.get('deviceId')??JSON.parse(body||'{}').deviceId;seen.push(req.method+' '+url.pathname+' '+deviceId);
  if(url.pathname==='/controller/lifx-light/v1/snapshot'){res.end(JSON.stringify({profile,controller:identity(deviceId),lighting}));return;}
  if(req.method==='POST'){const request=JSON.parse(body);res.end(JSON.stringify({apiVersion:'1.0',controllerId:request.controllerId,deviceId:request.deviceId,requestId:request.requestId,configurationRevision:1,generation:snapshot.generation,outcome:'sent',priorEffects:'confirmed-transmission',completedOperations:['write'],uncertainOperations:[]}));return;}
  res.end(JSON.stringify(identity(deviceId)));
 });
 await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
 const endpoint=`http://127.0.0.1:${fake.address().port}/controller/v1`;
 const directory=await mkdtemp(join(tmpdir(),'hub-local-'));let hub;
 try {
  hub=await startHub({directory,ownerId:'owner',consumers:[],credentials:[{...credentials[0],devices:['tidbyt','desk']},{...credentials[1],devices:['tidbyt','desk']}],controllers:[
   {id:'tidbyt',kind:'tidbyt',controllerId:'local',deviceId:'tidbyt',token:'c'.repeat(43),endpoint},{id:'desk',kind:'lifx',controllerId:'local',deviceId:'desk',token:'d'.repeat(43),endpoint}]});
  const call=(path,body,credential=token)=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${credential}`,'x-pixoo-request':'1','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const context=await (await call('/api/dashboard/v1/context')).json();
  assert.deepEqual(context.components.map(c=>[c.id,c.kind]),[['tidbyt','tidbyt'],['desk','lifx']]);
  assert.equal((await (await call('/api/controllers/v1/tidbyt/snapshot')).json()).identity.deviceId,'tidbyt');
  const desk=await (await call('/api/controllers/v1/desk/lighting/snapshot')).json();
  assert.deepEqual([desk.profile,desk.controller.identity.deviceId],[profile,'desk']);
  const request={apiVersion:'1.0',controllerId:'local',deviceId:'desk',requestId:snapshot.nextRequestId,expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:snapshot.generation,profile,command:{kind:'lifx.color.set',hue:30,saturation:100}};
  const sent=await call('/api/controllers/v1/desk/lighting/commands',request);
  assert.equal(sent.status,200);assert.equal((await sent.json()).outcome,'sent');
  const before=seen.length;
  assert.equal((await call('/api/controllers/v1/desk/lighting/commands',request,readToken)).status,403);
  assert.equal((await call('/api/controllers/v1/tidbyt/lighting/snapshot')).status,422);
  assert.equal((await call('/api/controllers/v1/tidbyt/lighting/commands',{...request,deviceId:'tidbyt'})).status,422);
  assert.equal((await call('/api/controllers/v1/desk/lighting/commands',{...request,command:{kind:'lifx.color.set',hue:400,saturation:1}})).status,400);
  assert.equal((await call('/api/controllers/v1/desk/integration/snapshot')).status,422);
  assert.equal((await call('/api/controllers/v1/desk/lighting/receipt')).status,404);
  assert.equal((await call('/api/controllers/v1/hall/lighting/snapshot')).status,403);
  assert.equal(seen.length,before);
  assert.deepEqual(seen,['GET /controller/v1/snapshot tidbyt','GET /controller/lifx-light/v1/snapshot desk','POST /controller/lifx-light/v1/commands desk']);
 }finally{await hub?.close();await new Promise(resolve=>{fake.close(resolve);fake.closeAllConnections();});await rm(directory,{recursive:true,force:true});}
});
