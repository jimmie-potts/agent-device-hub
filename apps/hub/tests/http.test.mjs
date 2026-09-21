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
 turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:1,ordering:{status:'unknown'}};

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
    assert.deepEqual(view.matches,[event.identity]);
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
