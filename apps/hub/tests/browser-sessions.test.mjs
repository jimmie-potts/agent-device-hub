import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer,request} from 'node:http';
import {startHub} from '../dist/server.js';
import {requestBrowserLaunch} from '../dist/browser-launch.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const configuredToken='r'.repeat(43);
const configured={authorization:`Bearer ${configuredToken}`};
const identity={provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'};
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1',...headers},body:JSON.stringify(body)});
// The documented bound once every browser session has retired: the configured reader's own ticket ledger and nothing else.
const settled={requests:0,browserSessions:0,launchCodes:0,streams:0,ledgers:1,replayEntries:1,pendingReplays:0};

async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'hub-browser-sessions-'));let hub;
 try{hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'reader',digest:digest(configuredToken),scopes:['read','control'],devices:[]}],...options});}
 catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 const launch=async()=>{const {code}=await requestBrowserLaunch(directory);const response=await post(hub.url+'/api/dashboard/v1/launch',{code},{origin:hub.url});assert.equal(response.status,200);return {authorization:`Bearer ${(await response.json()).token}`};};
 const read=async headers=>{const response=await fetch(hub.url+'/api/monitor/v1/sessions',{headers});assert.equal(response.status,200);return (await response.json()).nextRequestId;};
 const label=(headers,requestId,value='Chosen')=>post(hub.url+'/api/monitor/v1/commands',{operation:'label',requestId,identity,label:value},headers);
 const logout=headers=>post(hub.url+'/api/dashboard/v1/logout',{},headers);
 const stream=async headers=>{const response=await fetch(hub.url+'/api/monitor/v1/changes',{headers});assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();return reader;};
 return {hub,directory,launch,read,label,logout,stream};
}
/** Resolves true when the stream ends within the window, false while it keeps delivering. */
async function ends(reader,ms=3000){
 let timer;const expired=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);});
 const drained=(async()=>{try{for(;;){if((await reader.read()).done)return true;}}catch{return true;}})();
 try{return await Promise.race([drained,expired]);}finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
}
const counts=hub=>{const {replayBytes,...rest}=hub.resources();return rest;};

test('logout, expiry and eviction retire each browser session with its tickets, stream and replay entries',async t=>{
 const {hub,launch,read,label,logout,stream}=await fixture(t);
 // The configured reader keeps one settled replay entry throughout; browser sessions must return to that bound.
 assert.equal((await label(configured,await read(configured))).status,200);
 const baseline=hub.resources();assert.deepEqual(counts(hub),settled);
 for(let index=0;index<20;index++){
  const headers=await launch(),requestId=await read(headers);
  const command=await label(headers,requestId);assert.equal(command.status,200);const result=await command.json();
  const reader=await stream(headers);
  assert.equal(hub.resources().ledgers,2,`launch ${index+1} holds one browser ledger`);
  assert.equal((await logout(headers)).status,200);
  assert.equal(await ends(reader),true,'logout closes that session’s stream');
  assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).status,401,'the retired token is refused');
  const replay=await label(headers,requestId);assert.equal(replay.status,401,'its cached request is refused before replay');assert.notDeepEqual(await replay.json(),result);
 }
 assert.deepEqual(counts(hub),settled);assert.equal(hub.resources().replayBytes,baseline.replayBytes);

 const expiring=await launch(),expiringTicket=await read(expiring);assert.equal((await label(expiring,expiringTicket)).status,200);
 const expiringStream=await stream(expiring);
 const now=Date.now,start=now();
 try{
  Date.now=()=>start+8*60*60*1000+1;
  assert.equal(await ends(expiringStream),true,'expiry closes the stream on its next authorization');
  assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions',{headers:expiring})).status,401);
  assert.equal((await label(expiring,expiringTicket)).status,401);
 }finally{Date.now=now;}
 assert.deepEqual(counts(hub),settled);

 const sessions=[],cached=[];let oldestStream;
 for(let index=0;index<17;index++){
  const headers=await launch(),requestId=await read(headers);assert.equal((await label(headers,requestId)).status,200);sessions.push(headers);cached.push(requestId);
  if(index===0)oldestStream=await stream(headers);
 }
 assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions',{headers:sessions[0]})).status,401,'the oldest session was evicted');
 assert.equal(await ends(oldestStream),true,'eviction closes the evicted session’s stream');
 assert.equal((await label(sessions[0],cached[0])).status,401,'the evicted session’s cached request is refused');
 assert.deepEqual({browserSessions:hub.resources().browserSessions,ledgers:hub.resources().ledgers,replayEntries:hub.resources().replayEntries},{browserSessions:16,ledgers:17,replayEntries:17});
 for(const headers of sessions.slice(1))assert.equal((await logout(headers)).status,200);
 assert.deepEqual(counts(hub),settled);assert.equal(hub.resources().replayBytes,baseline.replayBytes);

 // Credential replacement and shutdown retire every remaining browser session the same way.
 const replaced=await launch();assert.equal((await label(replaced,await read(replaced))).status,200);
 hub.replaceCredentials([{id:'reader',digest:digest(configuredToken),scopes:['read','control'],devices:[]}]);
 assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions',{headers:replaced})).status,401);
 assert.deepEqual(counts(hub),settled,'replacement keeps the unchanged configured credential’s ledger only');
 const closing=await launch();assert.equal((await label(closing,await read(closing))).status,200);
 await hub.close();
 assert.deepEqual({browserSessions:hub.resources().browserSessions,ledgers:hub.resources().ledgers,replayEntries:hub.resources().replayEntries},{browserSessions:0,ledgers:1,replayEntries:1},'shutdown retires the last browser session');
});

test('logging out never revokes a configured credential, its tickets or another principal',async t=>{
 const {hub,launch,read,label,logout,stream}=await fixture(t,{mcp:true});
 const ticket=await read(configured),first=await label(configured,ticket,'Configured');assert.equal(first.status,200);const result=await first.json();
 const next=await read(configured);
 const other=await launch(),otherStream=await stream(other),configuredStream=await stream(configured);
 const leaving=await launch();await read(leaving);
 assert.equal((await logout(configured)).status,200,'a dashboard opened with a configured credential can disconnect');
 assert.equal((await logout(leaving)).status,200);
 assert.equal(await read(configured),next,'the configured credential keeps its ticket sequence and epoch');
 const replay=await label(configured,ticket,'Configured');assert.equal(replay.status,200);assert.deepEqual(await replay.json(),result,'an old configured request returns its retained result');
 assert.equal((await label(configured,ticket,'Different')).status,409,'an old ticket never executes a different request');
 assert.equal(await ends(configuredStream,1500),false,'the configured stream stays open');
 assert.equal(await ends(otherStream,1500),false,'another browser session’s stream stays open');
 assert.equal((await label(other,await read(other))).status,200,'another browser session can still command');
 const mcp=await fetch(hub.url+'/mcp',{method:'POST',headers:{...configured,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'retirement-fixture',version:'1'}}})});
 assert.equal(mcp.status,200,'the configured MCP principal remains usable');
 assert.equal(hub.resources().browserSessions,1);assert.equal(hub.resources().ledgers,2);
});

/** Sends a POST whose headers are authorized before `between` runs and whose body arrives after it. */
async function lateBody(hub,path,headers,value,between){
 const origin=new URL(hub.url),body=JSON.stringify(value);
 return new Promise((resolve,reject)=>{
  const req=request({host:origin.hostname,port:origin.port,path,method:'POST',headers:{...headers,'content-type':'application/json','x-pixoo-request':'1','content-length':Buffer.byteLength(body)}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));});
  req.on('error',reject);req.flushHeaders();
  // The handler authorizes synchronously on arrival and then waits for the body, so one active request means authorization has run.
  (async()=>{const deadline=Date.now()+5000;while(hub.resources().requests<1){if(Date.now()>deadline)throw new Error('request-not-admitted');await new Promise(r=>setTimeout(r,5));}await between();req.end(body);})().catch(reject);
 });
}

test('a write admitted before logout but delivered after it reaches neither the owner nor a controller',async t=>{
 // A schema-valid controller v1 request, so the late write would otherwise be forwarded to the controller.
 const corpus=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
 const valid=structuredClone(corpus.schemaCases.find(c=>c.definition==='request'&&c.valid).value);
 let controllerCalls=0;const controller=createServer((req,res)=>{controllerCalls++;res.writeHead(500);res.end();});
 await new Promise(resolve=>controller.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{controller.close(resolve);controller.closeAllConnections();}));
 const {hub,launch,read,logout}=await fixture(t,{controllers:[{id:'wall',kind:'nanoleaf',controllerId:valid.controllerId,deviceId:valid.deviceId,token:'c'.repeat(43),endpoint:`http://127.0.0.1:${controller.address().port}/controller/v1`}]});
 const monitor=await launch(),requestId=await read(monitor);
 const late=await lateBody(hub,'/api/monitor/v1/commands',monitor,{operation:'label',requestId,identity,label:'Late'},async()=>assert.equal((await logout(monitor)).status,200));
 assert.equal(late.status,401);
 assert.deepEqual({browserSessions:hub.resources().browserSessions,ledgers:hub.resources().ledgers,replayEntries:hub.resources().replayEntries},{browserSessions:0,ledgers:0,replayEntries:0});
 for(const [path,value] of [['/api/controllers/v1/wall/commands',valid],['/api/controllers/v1/wall/integration/commands',{apiVersion:'1.0'}],['/api/controllers/v1/wall/integration/cancel',{apiVersion:'1.0'}]]){
  const device=await launch();
  const response=await lateBody(hub,path,device,value,async()=>assert.equal((await logout(device)).status,200));
  assert.equal(response.status,401,path);
 }
 assert.equal(controllerCalls,0,'no controller request was sent for a retired session');
});

test('a configured credential rotated while its request body is in flight sends nothing',async t=>{
 const {hub,read}=await fixture(t),requestId=await read(configured);
 const late=await lateBody(hub,'/api/monitor/v1/commands',configured,{operation:'label',requestId,identity,label:'Late'},async()=>{
  // The same ID now carries only read scope.
  hub.replaceCredentials([{id:'reader',digest:digest(configuredToken),scopes:['read'],devices:[]}]);
 });
 assert.equal(late.status,401);
 assert.equal(await read(configured),requestId,'the rotated credential keeps its ticket and nothing was admitted');
});
