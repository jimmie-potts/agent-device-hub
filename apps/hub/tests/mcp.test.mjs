import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
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

const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'},turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:Date.now(),ordering:{status:'unknown'}};
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
 const list=await c.rpc('tools/list',{});assert.deepEqual(list.body.result.tools.map(t=>t.name).sort(),['hub_acknowledge','hub_devices','hub_label','hub_recover_approval','hub_sessions']);
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
   else if(mode==='revision-conflict'||mode==='stale-generation'){status=409;value={failure:{code:mode}};}
   else if(mode==='rejected-receipt'){status=422;value={...receipt,controllerId:input.controllerId,deviceId:input.deviceId,requestId:input.requestId,outcome:'failed',priorEffects:'none',completedOperations:[],failure:{code:'unsupported-capability'}};}
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
test('media tools bind every alias and forward guarded playlist and playback commands',async t=>{
 const pixoo=await controller(t,'desk','pixoo'),wall=await controller(t,'wall');
 const hub=await fixture(t,{controllers:[pixoo.config,wall.config],credentials:[{...credential,devices:['desk','wall']}]});
 const c=client(hub);await c.initialize();
 const tools=(await c.rpc('tools/list',{})).body.result.tools;
 for(const alias of ['desk','wall']){
  const name=await prefix(c,alias);
  for(const suffix of ['media_start','media_control']){
   const tool=tools.find(tool=>tool.name===name+'_'+suffix);assert.ok(tool);
   assert.match(tool.description,/explicitly select Media through integration_set/);
   assert.match(tool.description,/does not switch or restore modes/);
  }
 }
 assert.equal(pixoo.seen.length,0);assert.equal(wall.seen.length,0);
 const name=await prefix(c,'desk'),current=(await c.call(name+'_status')).structuredContent.data.result;
 const commands=[{kind:'media.start',playlistId:'saved-list'},...['pause','resume','stop','next','previous','restart-with-changes','clear'].map(action=>({kind:'media.control',action}))];
 for(const [index,command] of commands.entries()){
  const {kind,...fields}=command;
  const args={...guards(current),requestId:{...current.nextRequestId,sequence:current.nextRequestId.sequence+index},...fields};
  const before=pixoo.seen.length;
  const result=await c.call(name+'_'+kind.replace('.','_'),args);
  assert.equal(result.isError,false);assert.equal(result.structuredContent.kind,'extension');
  assert.deepEqual(pixoo.seen.at(-1).input,{apiVersion:'1.0',controllerId:pixoo.config.controllerId,deviceId:'native',...guards(current),requestId:args.requestId,command});
  assert.equal(pixoo.seen.length,before+1);
  assert.deepEqual(result.structuredContent.data.result.requestId,args.requestId);
  assert.equal(result.structuredContent.data.result.outcome,'sent');
  assert.equal(result.structuredContent.data.result.priorEffects,'confirmed-transmission');
  const replay=await c.call(name+'_'+kind.replace('.','_'),args);
  assert.deepEqual(replay,result);assert.equal(pixoo.effects,index+1);
 }
 assert.equal(wall.seen.length,0);
});
test('media tools reject invalid inputs before contacting the owner',async t=>{
 const native=await controller(t,'desk','pixoo');
 const hub=await fixture(t,{controllers:[native.config],credentials:[{...credential,devices:['desk']}]});
 const c=client(hub);await c.initialize();const name=await prefix(c,'desk'),guard=guards(native.snapshot);
 for(const [suffix,fields] of [
  ['media_start',{}],['media_start',{playlistId:''}],['media_start',{playlistId:'a'.repeat(129)}],['media_start',{playlistId:'/private/media'}],
  ['media_control',{}],['media_control',{action:'seek'}],['media_control',{action:'PAUSE'}]
 ])assert.equal((await c.call(name+'_'+suffix,{...guard,...fields})).isError,true);
 for(const [suffix,fields] of [['media_start',{playlistId:'saved-list'}],['media_control',{action:'pause'}]]){
  for(const override of [{deviceId:'other'},{controllerId:'other'},{url:'http://elsewhere.invalid'},{renditionId:'other'}]){
   assert.equal((await c.call(name+'_'+suffix,{...guard,...fields,...override})).isError,true);
  }
  for(const key of Object.keys(guard)){
   const args={...guard,...fields};delete args[key];assert.equal((await c.call(name+'_'+suffix,args)).isError,true);
  }
 }
 assert.equal(native.seen.length,0);
});
test('media tools preserve owner failures and ambiguous request identity without retry',async t=>{
 const native=await controller(t,'desk','pixoo');
 const hub=await fixture(t,{controllers:[native.config],credentials:[{...credential,devices:['desk']}]});
 const c=client(hub);await c.initialize();const name=await prefix(c,'desk');
 for(const [suffix,fields] of [['media_start',{playlistId:'saved-list'}],['media_control',{action:'pause'}]]){
  const args={...guards(native.snapshot),...fields};
  for(const [mode,code] of [['unsupported','unsupported-capability'],['revision-conflict','revision-conflict'],['stale-generation','stale-generation'],['drop','uncertain-result']]){
   native.mode=mode;const before=native.seen.length,result=await c.call(name+'_'+suffix,args);
   assert.equal(result.isError,true);assert.equal(result.structuredContent.kind,'extension');
   assert.deepEqual(result.structuredContent.data,{code,priorEffects:mode==='drop'?'possible':'none',retry:'never-automatically',requestId:args.requestId});
   assert.equal(native.seen.length,before+1);
  }
  native.mode='rejected-receipt';const result=await c.call(name+'_'+suffix,args);
  assert.equal(result.isError,true);const receipt=result.structuredContent.data.result;
  assert.equal(receipt.outcome,'failed');assert.equal(receipt.failure.code,'unsupported-capability');
  assert.deepEqual(receipt.requestId,args.requestId);assert.equal(receipt.priorEffects,'none');
 }
 assert.equal(native.effects,0);
});
test('media discovery and calls enforce current control scope and device permissions',async t=>{
 const native=await controller(t,'desk','pixoo'),readerToken='r'.repeat(43);
 const operator={...credential,devices:['desk']},reader={...operator,id:'reader',digest:hash(readerToken),scopes:['read']};
 const hub=await fixture(t,{controllers:[native.config],credentials:[operator,reader]});
 const c=client(hub),read=client(hub,readerToken);await c.initialize();await read.initialize();
 const name=await prefix(c,'desk');
 async function denied(c){
  const tools=(await c.rpc('tools/list',{})).body.result.tools;
  for(const [suffix,fields] of [['media_start',{playlistId:'saved-list'}],['media_control',{action:'pause'}]]){
   assert.ok(!tools.some(tool=>tool.name===name+'_'+suffix));
   const result=await c.call(name+'_'+suffix,{...guards(native.snapshot),...fields});
   assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'forbidden');
  }
 }
 await denied(read);
 hub.replaceCredentials([{...operator,scopes:['read']}]);await denied(c);
 hub.replaceCredentials([{...operator,devices:[]}]);await denied(c);
 assert.equal(native.seen.length,0);
 hub.replaceCredentials([operator]);
 const args={...guards(native.snapshot),playlistId:'saved-list'};
 assert.equal((await c.call(name+'_media_start',args)).isError,false);
 hub.replaceCredentials([{...operator,devices:[]}]);
 assert.equal((await c.call(name+'_media_start',args)).structuredContent.code,'forbidden');
 assert.equal(native.seen.length,1);assert.equal(native.effects,1);
});
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

test('MCP approval recovery requires an explicit guarded call and leaves activity unchanged',async t=>{
 const now=Date.now();t.mock.timers.enable({apis:['Date'],now});
 const hub=await fixture(t),c=client(hub);await c.initialize();
 await http(hub,'/api/monitor/v1/events',{...event,event:{kind:'attention.approval',attention:{status:'unknown'}}});
 t.mock.timers.setTime(now+300001);
 const before=(await c.call('hub_sessions')).structuredContent.data.result;
 const request={request_id:before.nextRequestId,identity:event.identity,turn_id:event.turn.id,expected_revision:before.snapshot.revision};
 const result=await c.call('hub_recover_approval',request);
 assert.equal(result.isError,false);
 assert.equal(result.structuredContent.data.result.ok,true);
 const after=(await c.call('hub_sessions')).structuredContent.data.result;
 assert.equal(after.snapshot.sessions[0].attention.length,0);
 assert.equal(after.snapshot.sessions[0].activity,before.snapshot.sessions[0].activity);
 assert.equal(after.snapshot.sessions[0].freshness,'uncertain');
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

// A fake Sony receiver for the playback tools. `mode` switches commands between accepted, refused and unanswered.
async function receiver(t){
 const calls=[];let state='PLAYING',mode='sent';
 const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const request=JSON.parse(text);
  if(request.method!=='getPlayingContentInfo'){calls.push(request.method);if(mode==='hang')return;}
  const body=request.method==='getPlayingContentInfo'?{result:[[{source:'extInput:airPlay',stateInfo:{state},title:'Song',artist:'Artist'}]]}:mode==='failed'?{error:[40000,'refused']}:{result:[]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:request.id,...body}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 return {calls,endpoint:`http://127.0.0.1:${server.address().port}/sony`,set:(next={})=>{state=next.state??state;mode=next.mode??mode;}};
}
const playbackConfig=endpoint=>({id:'living-room',sources:[{kind:'sony',endpoint}]});
const playbackTools=async c=>(await c.rpc('tools/list',{})).body.result.tools.map(tool=>tool.name).filter(name=>name.includes('_playback_')).sort();
async function available(c,status){for(let i=0;i<100;i++){const view=(await c.call(status)).structuredContent?.data?.result;if(view?.availability==='available')return view;await new Promise(r=>setTimeout(r,50));}throw new Error('playback never became available');}
test('playback tools are bound to the configured source and listed only for granted credentials',async t=>{
 const sony=await receiver(t),readerToken='r'.repeat(43),otherToken='o'.repeat(43);
 const operator={...credential,devices:['living-room']},reader={...operator,id:'reader',digest:hash(readerToken),scopes:['read']},other={...credential,id:'other',digest:hash(otherToken)};
 const hub=await fixture(t,{credentials:[operator,reader,other],playback:playbackConfig(sony.endpoint)});
 const c=client(hub),read=client(hub,readerToken),none=client(hub,otherToken);await c.initialize();await read.initialize();await none.initialize();
 const [command,status]=await playbackTools(c);
 assert.match(status,/^device_living_room_[a-f0-9]{16}_playback_status$/);assert.equal(command,status.replace(/status$/,'command'));
 const tools=(await c.rpc('tools/list',{})).body.result.tools;
 assert.deepEqual(Object.keys(tools.find(tool=>tool.name===command).inputSchema.properties).sort(),['action','requestId'],'the source is bound by the tool, never an argument');
 assert.deepEqual(await playbackTools(read),[status]);assert.deepEqual(await playbackTools(none),[]);
 const discovered=async who=>(await who.call('hub_devices')).structuredContent.data.result.playback;
 assert.deepEqual(await discovered(c),{sourceId:'living-room',toolPrefix:status.replace(/_playback_status$/,'')});
 assert.deepEqual(await discovered(read),{sourceId:'living-room',toolPrefix:status.replace(/_playback_status$/,'')});assert.equal(await discovered(none),undefined);
 const view=await available(c,status);
 assert.deepEqual([view.sourceId,view.playback.title,view.playback.controls],['living-room','Song',['pause','next','previous']]);
 const first=await c.call(command,{requestId:'m1',action:'next'}),again=await c.call(command,{requestId:'m1',action:'next'});
 const receipt={requestId:'m1',sourceId:'living-room',action:'next',outcome:'sent',priorEffects:'confirmed-transmission'};
 assert.deepEqual([first.isError,first.structuredContent.data.result,again.structuredContent.data.result],[false,receipt,receipt]);
 assert.deepEqual(sony.calls,['setPlayNextContent'],'a repeated request ID returns the original receipt');
 for(const [who,name,args] of [[read,command,{requestId:'m2',action:'pause'}],[none,status,{}],[none,command,{requestId:'m2',action:'pause'}]]){
  const denied=await who.call(name,args);assert.deepEqual([denied.isError,denied.structuredContent.code],[true,'forbidden']);
 }
 hub.replaceCredentials([{...operator,devices:[]},reader,other]);
 assert.deepEqual(await playbackTools(c),[]);
 assert.equal((await c.call(command,{requestId:'m3',action:'pause'})).structuredContent.code,'forbidden');
 assert.deepEqual(sony.calls,['setPlayNextContent']);
});
test('playback tool rejections are typed, uncertain results are not retried and staged hubs refuse commands',async t=>{
 const sony=await receiver(t),operator={...credential,devices:['living-room']};
 const hub=await fixture(t,{credentials:[operator],playback:playbackConfig(sony.endpoint)});
 const c=client(hub);await c.initialize();const [command,status]=await playbackTools(c);await available(c,status);
 const code=async args=>{const result=await c.call(command,args);return [result.isError,result.structuredContent.data.code,result.structuredContent.data.priorEffects];};
 assert.deepEqual(await code({requestId:'r1',action:'play'}),[true,'unsupported-control','none']);
 assert.equal((await c.call(command,{requestId:'r1',action:'pause',sourceId:'kitchen'})).isError,true,'a target override is refused by the schema');
 sony.set({mode:'failed'});
 const refused=await c.call(command,{requestId:'r2',action:'previous'});
 assert.deepEqual([refused.isError,refused.structuredContent.data.result],[true,{requestId:'r2',sourceId:'living-room',action:'previous',outcome:'failed',priorEffects:'none'}]);
 sony.set({mode:'hang'});
 const uncertain=await c.call(command,{requestId:'r3',action:'pause'});
 assert.deepEqual([uncertain.isError,uncertain.structuredContent.data.result],[true,{requestId:'r3',sourceId:'living-room',action:'pause',outcome:'uncertain',priorEffects:'possible'}]);
 assert.deepEqual(sony.calls,['setPlayPreviousContent','pausePlayingContent'],'nothing is retried');
 sony.set({state:'PAUSED',mode:'sent'});
 for(let i=0;i<100&&(await c.call(status)).structuredContent.data.result.playback?.status!=='paused';i++)await new Promise(r=>setTimeout(r,50));
 assert.deepEqual(await code({requestId:'r4',action:'pause'}),[true,'unsupported-control','none']);
 const directory=await mkdtemp(join(tmpdir(),'hub-mcp-playback-staged-'));
 const staged=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[operator],mcp:true,playback:playbackConfig(sony.endpoint)},{staged:true});
 t.after(async()=>{await staged.close();await rm(directory,{recursive:true,force:true});});
 const s=client(staged);await s.initialize();await available(s,status);
 const result=await s.call(command,{requestId:'s1',action:'next'});
 assert.deepEqual([result.structuredContent.data.code,result.structuredContent.data.priorEffects],['owner-quiesced','none']);
 assert.deepEqual(sony.calls,['setPlayPreviousContent','pausePlayingContent']);
});

test('tidbyt and lifx aliases bind only the tools their kind can use',async t=>{
 const profile={profileId:'lifx-light',profileVersion:'1.0.0'},seen=[];let failing=false;
 const snapshot=deviceId=>({apiVersion:'1.0',identity:{deviceId,controllerId:'local',sourceId:'s',controllerEpoch:'e'},configurationRevision:0,generation:{epoch:'e',sequence:0},nextRequestId:{epoch:'e',sequence:0},cursor:{epoch:'e',sequence:0},
  sampleClock:{domain:'controller-monotonic',epoch:'e',sampledAtMs:1},serviceHealth:'ready',capabilities:{power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:false},zones:{supported:false},scenes:{supported:false},preview:{supported:false}},
  limits:{maxPending:8,maxBodyBytes:65536,maxInFlight:8,maxReceipts:256,maxEvents:1,maxStreams:1,authenticationTimeoutMs:1},
  state:{desired:{power:{status:'unknown'},brightness:{status:'unknown'},mode:{status:'unknown'}},pending:[],lastSuccessfulSend:{status:'unknown'},lastOutcome:{status:'unknown'},externalControl:{status:'unknown'},observation:{status:'unknown'}}});
 const lighting={capabilities:{color:true,temperature:{minimum:1500,maximum:9000},effects:false},pending:[],observation:{status:'unknown'},visible:{status:'unknown'}};
 const fake=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const url=new URL(req.url,'http://x');seen.push([req.method,url.pathname,body&&JSON.parse(body)]);
  if(req.method==='POST'){if(failing){req.socket.destroy();return;}const r=JSON.parse(body);res.end(JSON.stringify({apiVersion:'1.0',controllerId:r.controllerId,deviceId:r.deviceId,requestId:r.requestId,configurationRevision:1,generation:{epoch:'e',sequence:0},outcome:'sent',priorEffects:'confirmed-transmission',completedOperations:['write'],uncertainOperations:[]}));return;}
  const deviceId=url.searchParams.get('deviceId');
  res.end(JSON.stringify(url.pathname.includes('lifx-light')?{profile,controller:snapshot(deviceId),lighting}:snapshot(deviceId)));
 });
 await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{fake.close(resolve);fake.closeAllConnections();}));
 const endpoint=`http://127.0.0.1:${fake.address().port}/controller/v1`;
 const hub=await fixture(t,{credentials:[{...credential,devices:['tidbyt','desk']}],controllers:[{id:'tidbyt',kind:'tidbyt',controllerId:'local',deviceId:'tidbyt',token:'c'.repeat(43),endpoint},{id:'desk',kind:'lifx',controllerId:'local',deviceId:'desk',token:'d'.repeat(43),endpoint}]});
 const c=client(hub);await c.initialize();
 const devices=(await c.call('hub_devices')).structuredContent.data.result.devices;
 assert.deepEqual(devices.map(d=>[d.alias,d.kind]),[['tidbyt','tidbyt'],['desk','lifx']]);
 const tools=(await c.rpc('tools/list',{})).body.result.tools.map(tool=>tool.name);
 const bound=alias=>tools.filter(name=>name.startsWith(devices.find(d=>d.alias===alias).toolPrefix+'_')).map(name=>name.slice(devices.find(d=>d.alias===alias).toolPrefix.length+1)).sort();
 assert.deepEqual(bound('tidbyt'),['status']);
 assert.deepEqual(bound('desk'),['brightness_set','color_set','lighting_status','power_set','status','temperature_set']);
 const prefix=devices.find(d=>d.alias==='desk').toolPrefix;
 const status=(await c.call(prefix+'_lighting_status')).structuredContent.data.result;
 assert.deepEqual(status.lighting.capabilities.temperature,{minimum:1500,maximum:9000});
 const guards={requestId:status.controller.nextRequestId,expectedConfigurationRevision:status.controller.configurationRevision,expectedGeneration:status.controller.generation};
 const color=await c.call(prefix+'_color_set',{...guards,hue:120,saturation:60});
 assert.equal(color.isError,false);assert.equal(color.structuredContent.data.result.outcome,'sent');
 const before=seen.length;
 assert.equal((await c.rpc('tools/call',{name:prefix+'_color_set',arguments:{...guards,hue:361,saturation:60}})).body.result?.isError??true,true);
 assert.equal(seen.length,before);
 const temperature=await c.call(prefix+'_temperature_set',{...guards,requestId:{epoch:'e',sequence:1},kelvin:2700});
 assert.equal(temperature.structuredContent.data.result.outcome,'sent');
 assert.deepEqual(seen.filter(([method])=>method==='POST').map(([,path,body])=>[path,body.profile,body.command]),[
  ['/controller/lifx-light/v1/commands',profile,{kind:'lifx.color.set',hue:120,saturation:60}],['/controller/lifx-light/v1/commands',profile,{kind:'lifx.temperature.set',kelvin:2700}]]);
 failing=true;
 const lost=await c.call(prefix+'_color_set',{...guards,requestId:{epoch:'e',sequence:2},hue:1,saturation:1});
 assert.equal(lost.isError,true);assert.deepEqual([lost.structuredContent.data.code,lost.structuredContent.data.priorEffects,lost.structuredContent.data.retry],['uncertain-result','possible','never-automatically']);
 assert.equal(seen.filter(([method])=>method==='POST').length,3);
});

// Hub #357: a sixth controller used to push the tool catalog past the 1 MiB response limit and stop the hub.
test('MCP starts with the owner controller set and at the controller maximum',async t=>{
 const at=(id,kind,deviceId,controllerId=id+'-controller')=>({id,kind,controllerId,deviceId,endpoint:'http://127.0.0.1:9/controller/v1',token:'n'.repeat(43)});
 const owner=[at('nanoleaf-wall','nanoleaf','wall','local-controller'),at('nanoleaf-panels','nanoleaf','panels','local-controller'),at('pixoo','pixoo','pixoo-local'),
  at('tidbyt','tidbyt','tidbyt'),at('beam','lifx','beam','lifx'),at('pendant-1','lifx','pendant-1','lifx')];
 const maximum=Array.from({length:16},(_,i)=>at('nanoleaf-'+i,'nanoleaf','device-'+i,'local-controller'));
 // The installed hub also serves the HT-A9 playback source, whose tools share the catalog. A credential names at most 16
 // devices, so the maximum case covers controllers only.
 const playback={id:'ht-a9',sources:[{kind:'sony',endpoint:'http://127.0.0.1:9/sony'}]};
 for(const [controllers,withPlayback] of [[owner,true],[maximum,false]]){
  const hub=await fixture(t,{controllers,...(withPlayback?{playback}:{}),credentials:[{...credential,devices:[...controllers.map(c=>c.id),...(withPlayback?['ht-a9']:[])]}]});
  const c=client(hub);assert.equal((await c.initialize()).status,200);
  const list=await c.rpc('tools/list',{});
  assert.equal(list.status,200);
  const bytes=Buffer.byteLength(JSON.stringify(list.body.result));
  assert.ok(bytes<512*1024,`${controllers.length} controllers publish a ${bytes}-byte catalog`);
  for(const controller of controllers)assert.ok(list.body.result.tools.some(tool=>tool.name.startsWith('device_'+controller.id.replace(/-/g,'_'))),controller.id);
  if(withPlayback)assert.ok(list.body.result.tools.some(tool=>tool.name.startsWith('device_ht_a9')),'playback');
 }
});
