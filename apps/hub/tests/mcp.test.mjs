import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../dist/server.js';

const token='a'.repeat(43), hash=value=>createHash('sha256').update(value).digest('hex');
const credential={id:'operator',digest:hash(token),scopes:['read','control','ingest'],devices:[]};
async function fixture(t,options={}) {
 const directory=await mkdtemp(join(tmpdir(),'hub-mcp-'));
 let hub;try{hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[credential],mcp:true,...options});}catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 return hub;
}
function client(hub,bearer=token,version='2025-11-25',name='codex-protocol-fixture') {
 let session,id=0;
 const headers=()=>({authorization:`Bearer ${bearer}`,accept:'application/json, text/event-stream','content-type':'application/json',...(session?{'mcp-session-id':session,'mcp-protocol-version':version}:{})});
 async function rpc(method,params,extra={}) {
  const response=await fetch(hub.url+'/mcp',{method:'POST',headers:{...headers(),...extra.headers},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++id}),method,params}),signal:extra.signal});
  const text=await response.text();return {status:response.status,headers:response.headers,body:text?JSON.parse(text):null};
 }
 return {rpc,async initialize(){const response=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name,version:'synthetic-1'}});session=response.headers.get('mcp-session-id');if(response.status===200)await rpc('notifications/initialized');return response;},
  async call(name,args={}){return (await rpc('tools/call',{name,arguments:args})).body?.result;},
  async close(){return fetch(hub.url+'/mcp',{method:'DELETE',headers:headers()});}};
}

test('opt-in host initializes the reusable MCP transport without devices',async t=>{
 const hub=await fixture(t),c=client(hub);
 assert.equal((await c.initialize()).status,200);
 const list=await c.rpc('tools/list',{});
 assert.ok(list.body.result.tools.some(tool=>tool.name==='hub_sessions'));
});

const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'},turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:1,ordering:{status:'unknown'}};
const http=async(hub,path,body,bearer=token)=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json','x-pixoo-request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('session tools retain evidence and share HTTP command replay without read effects',async t=>{
 const hub=await fixture(t),c=client(hub);await c.initialize();
 await http(hub,'/api/monitor/v1/events',event);
 const before=await (await http(hub,'/api/monitor/v1/sessions')).json();
 const inspected=(await c.call('hub_sessions')).structuredContent.data.result;
 assert.equal(inspected.snapshot.revision,before.snapshot.revision);assert.equal(inspected.snapshot.sessions[0].read,'unknown');
 assert.deepEqual(inspected.snapshot.sessions[0].identity,event.identity);
 const args={request_id:before.nextRequestId,identity:event.identity,label:'Chosen label'};
 const changed=(await c.call('hub_label',args)).structuredContent.data.result;
 assert.equal(changed.ok,true);
 const replay=await http(hub,'/api/monitor/v1/commands',{operation:'label',requestId:args.request_id,identity:event.identity,label:args.label});
 assert.deepEqual(await replay.json(),changed);
 const conflict=await c.call('hub_label',{...args,label:'Other'});
 assert.equal(conflict.isError,true);assert.equal(conflict.structuredContent.data.code,'request-conflict');
 const after=await (await http(hub,'/api/monitor/v1/sessions')).json();
 assert.equal(after.snapshot.revision,changed.revision);
 await c.close();const reconnect=client(hub);await reconnect.initialize();await reconnect.call('hub_sessions');
 assert.equal((await (await http(hub,'/api/monitor/v1/sessions')).json()).snapshot.revision,changed.revision);
});

for(const profile of ['codex-protocol-fixture','claude-protocol-fixture'])for(const version of ['2025-11-25','2025-06-18'])test(`${profile} ${version} host discovery/auth/permissions`,async t=>{
 const readerToken='r'.repeat(43),hub=await fixture(t,{credentials:[credential,{...credential,id:'reader',digest:hash(readerToken),scopes:['read']}]});
 const c=client(hub,token,version,profile);assert.equal((await c.initialize()).status,200);
 const list=await c.rpc('tools/list',{});assert.deepEqual(list.body.result.tools.map(t=>t.name).sort(),['hub_acknowledge','hub_devices','hub_label','hub_sessions']);
 assert.deepEqual((await c.call('hub_devices')).structuredContent.data.result,{devices:[]});
 const reader=client(hub,readerToken,version,profile);await reader.initialize();
 assert.deepEqual((await reader.rpc('tools/list',{})).body.result.tools.map(t=>t.name).sort(),['hub_devices','hub_sessions']);
 const denied=await reader.call('hub_label',{request_id:'unused',identity:event.identity,label:'Denied'});assert.equal(denied.isError,true);assert.equal(denied.structuredContent.code,'forbidden');
 assert.equal((await c.rpc('tools/list',{}, {headers:{origin:'http://evil.invalid'}})).status,403);
 assert.equal(await hostileHost(hub),403);
 assert.equal((await c.rpc('tools/list',{}, {headers:{'sec-fetch-site':'cross-site'}})).status,403);
 hub.replaceCredentials([{...credential,scopes:['read']}]);
 assert.deepEqual((await c.rpc('tools/list',{})).body.result.tools.map(t=>t.name).sort(),['hub_devices','hub_sessions']);
 assert.equal((await reader.rpc('tools/list',{})).status,401);
});
test('disabled MCP and invalid configuration fail without activation',async t=>{
 const hub=await fixture(t,{mcp:false});assert.equal((await client(hub).initialize()).status,404);
 await assert.rejects(fixture(t,{mcp:'yes'}),/invalid-configuration/);
});

async function controller(t,alias,kind='nanoleaf'){
 const {createServer}=await import('node:http'),{readFile}=await import('node:fs/promises');
 const corpus=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
 const snapshot=structuredClone(corpus.schemaCases.find(c=>c.definition==='snapshot'&&c.valid).value);
 Object.assign(snapshot.identity,{controllerId:alias+'-owner',deviceId:'native'});
 const receipt=structuredClone(corpus.schemaCases.find(c=>c.definition==='receipt'&&c.valid).value);
 const seen=[],ledger=new Map();let effects=0,mode='normal',release;
 const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const input=text?JSON.parse(text):null;
  seen.push({path:req.url,input,authorization:req.headers.authorization});
  if(mode==='drop'){res.destroy();return;}
  if(mode==='hold')await new Promise(resolve=>{release=resolve;});
  let status=200,value=snapshot;
  if(req.url.includes('/integration/')||req.url.includes('/pixoo-integration/')){status=404;value={failure:{code:'unknown-device'}};}
  else if(input){
   const key=JSON.stringify(input.requestId),fingerprint=JSON.stringify(input),old=ledger.get(key);
   if(old&&old.fingerprint!==fingerprint){status=409;value={failure:{code:'request-conflict'}};}
   else if(old)value=old.value;
   else if(mode==='unsupported'){status=422;value={failure:{code:'unsupported-capability'}};}
   else{effects++;value={...receipt,controllerId:input.controllerId,deviceId:input.deviceId,requestId:input.requestId,outcome:'sent',priorEffects:'confirmed-transmission'};ledger.set(key,{fingerprint,value});}
  }
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{release?.();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
 return {config:{id:alias,kind,controllerId:snapshot.identity.controllerId,deviceId:'native',endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:'n'.repeat(43)},snapshot,seen,
  get effects(){return effects;},set mode(value){mode=value;},release:()=>release?.(),get waiting(){return !!release;}};
}
async function prefix(c,alias){return (await c.call('hub_devices')).structuredContent.data.result.devices.find(d=>d.alias===alias).toolPrefix;}
const guards=s=>({requestId:s.nextRequestId,expectedConfigurationRevision:s.configurationRevision,expectedGeneration:s.generation});
test('aliases bind native identities, filter discovery, preserve replay and isolate failure',async t=>{
 const first=await controller(t,'wall.one'),second=await controller(t,'wall_one');
 const hub=await fixture(t,{controllers:[first.config,second.config],credentials:[{...credential,devices:['wall.one','wall_one']}]});
 const c=client(hub);await c.initialize();const one=await prefix(c,'wall.one'),two=await prefix(c,'wall_one');assert.notEqual(one,two);
 assert.equal(first.seen.length,0);assert.equal(second.seen.length,0);
 const current=(await c.call(one+'_status')).structuredContent.data.result;assert.deepEqual(current,first.snapshot);
 assert.equal(current.identity.deviceId,'native');assert.equal(current.state.observation.status,'unknown');
 const args={...guards(current),on:true};
 const result=await c.call(one+'_power_set',args);assert.equal(result.isError,false);assert.equal(result.structuredContent.data.result.deviceId,'native');
 const native={apiVersion:'1.0',controllerId:first.config.controllerId,deviceId:'native',...guards(current),command:{kind:'power.set',on:true}};
 assert.deepEqual(first.seen.at(-1).input,native);
 const replay=await http(hub,'/api/controllers/v1/wall.one/commands',native);assert.deepEqual(await replay.json(),result.structuredContent.data.result);assert.equal(first.effects,1);
 const conflict=await c.call(one+'_power_set',{...args,on:false});assert.equal(conflict.structuredContent.data.code,'request-conflict');assert.equal(first.effects,1);
 second.mode='unsupported';const unsupported=await c.call(two+'_brightness_set',{...guards(second.snapshot),percent:50});assert.equal(unsupported.structuredContent.data.code,'unsupported-capability');assert.equal(unsupported.structuredContent.data.priorEffects,'none');
 first.mode='drop';const lost=await c.call(one+'_power_set',{...args,requestId:{...args.requestId,sequence:args.requestId.sequence+1}});assert.equal(lost.structuredContent.data.priorEffects,'possible');assert.equal(lost.structuredContent.data.code,'uncertain-result');
 second.mode='normal';assert.equal((await c.call(two+'_status')).isError,false);
 hub.replaceCredentials([{...credential,devices:['wall_one']}]);
 assert.deepEqual((await c.call('hub_devices')).structuredContent.data.result.devices.map(d=>d.alias),['wall_one']);
 assert.ok(!(await c.rpc('tools/list',{})).body.result.tools.some(t=>t.name.startsWith(one+'_')));
 const before=first.seen.length;await c.rpc('tools/call',{name:one+'_status',arguments:{}});assert.equal(first.seen.length,before);
 assert.ok(first.seen.every(s=>s.authorization==='Bearer '+'n'.repeat(43)));
});

test('Pixoo integration extension preserves native view request and string ticket',async t=>{
 const {createServer}=await import('node:http'),{readFile}=await import('node:fs/promises');
 const sample=JSON.parse(await readFile(new URL('../fixtures/pixoo-integration.json',import.meta.url),'utf8'));
 const request=sample.cases[0].request,result=sample.cases[0].result,seen=[];
 const native=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;seen.push(text?JSON.parse(text):null);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(req.url.endsWith('/snapshot')?sample.snapshot:result));});
 await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));t.after(async()=>new Promise(resolve=>{native.close(resolve);native.closeAllConnections();}));
 const hub=await fixture(t,{controllers:[{id:'desk',kind:'pixoo',controllerId:request.controllerId,deviceId:request.deviceId,endpoint:`http://127.0.0.1:${native.address().port}/controller/v1`,token:'n'.repeat(43)}],credentials:[{...credential,devices:['desk']}]});
 const c=client(hub);await c.initialize();const name=await prefix(c,'desk');
 assert.deepEqual((await c.call(name+'_integration_status')).structuredContent.data.result,sample.snapshot);
 const args={request_id:request.requestId,expectedConfigurationRevision:request.expectedConfigurationRevision,expectedGeneration:request.expectedGeneration,action:request.action};
 const actual=await c.call(name+'_integration_set',args);assert.equal(actual.isError,false);assert.deepEqual(actual.structuredContent.data.result,result);assert.deepEqual(seen.at(-1),request);
});

async function hostileHost(hub){
 const {request}=await import('node:http');
 return new Promise((resolve,reject)=>{const req=request(hub.url+'/mcp',{method:'POST',headers:{host:'evil.invalid',authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');});
}

test('Nanoleaf settings, receipts and cancellation retain native identities',async t=>{
 const {createServer}=await import('node:http'),{readFile}=await import('node:fs/promises');
 const cases=JSON.parse(await readFile(new URL('../fixtures/nanoleaf-integration.json',import.meta.url),'utf8'));
 const request=cases.requests.find(c=>c.valid).request;
 const receipt={apiVersion:'nanoleaf.integration/1.0',requestId:request.requestId,outcome:'applied',priorEffects:'configuration',physicalOutcome:'unknown'};
 const seen=[];const native=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;seen.push({url:req.url,body:text?JSON.parse(text):null});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(receipt));});
 await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));t.after(async()=>new Promise(resolve=>{native.close(resolve);native.closeAllConnections();}));
 const hub=await fixture(t,{controllers:[{id:'wall',kind:'nanoleaf',controllerId:request.controllerId,deviceId:request.deviceId,endpoint:`http://127.0.0.1:${native.address().port}/controller/v1`,token:'n'.repeat(43)}],credentials:[{...credential,devices:['wall']}]});
 const c=client(hub);await c.initialize();const name=await prefix(c,'wall');
 const args={requestId:request.requestId,expectedRevision:request.expectedRevision,command:request.command};
 assert.deepEqual((await c.call(name+'_integration_set',args)).structuredContent.data.result,receipt);assert.deepEqual(seen.at(-1).body,request);
 assert.deepEqual((await c.call(name+'_integration_receipt',{requestId:request.requestId})).structuredContent.data.result,receipt);assert.ok(seen.at(-1).url.includes('/receipt?deviceId=device&epoch='));
 receipt.outcome='cancelled';receipt.priorEffects='none';
 const cancelled=await c.call(name+'_integration_cancel',{requestId:request.requestId});assert.equal(cancelled.isError,true);assert.deepEqual(cancelled.structuredContent.data.result,receipt);
 assert.deepEqual(seen.at(-1).body,{apiVersion:receipt.apiVersion,deviceId:'device',requestId:request.requestId});
 const before=seen.length;assert.equal((await c.call(name+'_integration_set',{...args,deviceId:'override'})).isError,true);assert.equal(seen.length,before);
});
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('fake dispatch did not occur');}
test('MCP disconnect retains admitted work, concurrent HTTP admission is bounded',async t=>{
 const native=await controller(t,'wall'),hub=await fixture(t,{controllers:[native.config],credentials:[{...credential,devices:['wall']}]});
 const c=client(hub);await c.initialize();const name=await prefix(c,'wall'),args={...guards(native.snapshot),on:true};
 native.mode='hold';const abort=new AbortController();
 const pending=c.rpc('tools/call',{name:name+'_power_set',arguments:args},{signal:abort.signal}).catch(e=>e);
 await until(()=>native.waiting);
 const busy=await http(hub,'/api/controllers/v1/wall/snapshot');assert.equal(busy.status,429);assert.equal(native.seen.length,1);
 abort.abort();await pending;
 native.release();await until(()=>native.effects===1);native.mode='normal';
 const again=client(hub);await again.initialize();await again.call(name+'_status');assert.equal(native.effects,1);
 assert.equal(native.seen.filter(s=>s.input).length,1);
 const replay=await again.call(name+'_power_set',args);assert.equal(replay.structuredContent.data.result.outcome,'sent');assert.equal(native.effects,1);
});
test('stale session evidence and exact acknowledgment remain separate from reads',async t=>{
 const now=Date.now();t.mock.timers.enable({apis:['Date'],now});
 const hub=await fixture(t,{consumers:[{id:'view',clearOnNewTurn:false}]}),c=client(hub);await c.initialize();
 await http(hub,'/api/monitor/v1/events',event);
 await http(hub,'/api/monitor/v1/events',{...event,event:{kind:'turn.ended'}});
 t.mock.timers.setTime(now+300001);
 const before=(await c.call('hub_sessions')).structuredContent.data.result;
 assert.equal(before.snapshot.sessions[0].freshness,'uncertain');assert.ok(before.snapshot.sessions[0].observationAgeMs>300000);
 assert.equal(before.snapshot.sessions[0].notices.length,1);
 const notice=before.snapshot.sessions[0].notices[0];assert.deepEqual(notice.acknowledgedBy,[]);
 const result=await c.call('hub_acknowledge',{request_id:before.nextRequestId,identity:event.identity,noticeId:notice.id,consumerId:'view'});assert.equal(result.isError,false);
 const after=(await c.call('hub_sessions')).structuredContent.data.result;assert.deepEqual(after.snapshot.sessions[0].notices[0].acknowledgedBy,['view']);assert.equal(after.snapshot.sessions[0].read,'unknown');
});

test('reserved aliases, unknown tools, raw selectors and session admission are bounded',async t=>{
 const native=await controller(t,'hub-service');await assert.rejects(fixture(t,{controllers:[native.config]}),/reserved-mcp-alias/);
 const hub=await fixture(t),c=client(hub);await c.initialize();
 const unknown=await c.rpc('tools/call',{name:'unknown_device_status',arguments:{}});assert.ok(unknown.body.error||unknown.body.result?.isError);
 const invalid=await c.call('hub_sessions',{url:'http://private.invalid'});assert.equal(invalid.isError,true);
 for(let i=1;i<16;i++)assert.equal((await client(hub).initialize()).status,200);
 assert.equal((await client(hub).initialize()).status,429);
 await c.close();assert.equal((await client(hub).initialize()).status,200);
});
test('staged owner permits inspection but rejects MCP state mutation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-mcp-staged-'));
 const hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[credential],mcp:true},{staged:true});
 t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 const c=client(hub);await c.initialize();const view=(await c.call('hub_sessions')).structuredContent.data.result;
 assert.equal(view.snapshot.collector,'quiesced');
 const result=await c.call('hub_label',{request_id:view.nextRequestId,identity:event.identity,label:'chosen'});
 assert.equal(result.structuredContent.data.code,'owner-quiesced');assert.equal(result.structuredContent.data.priorEffects,'none');
});
