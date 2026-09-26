import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {startHub} from '../dist/server.js';
import {requestBrowserLaunch} from '../dist/browser-launch.js';

// Hub #276: the opt-in trusted-loopback sign-in and the localhost Host alias.
const digest=value=>createHash('sha256').update(value).digest('hex');
const configuredToken='r'.repeat(43);
const identity={provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'};

async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'hub-trusted-loopback-'));let hub;
 try{hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'configured',digest:digest(configuredToken),scopes:['read','control','ingest','admin'],devices:[]}],...options});}
 catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 const port=new URL(hub.url).port,local=`http://localhost:${port}`;
 /** Sends one request with exactly these headers, including Host, which fetch cannot set. */
 const raw=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const text=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body);
  const req=request({host:'127.0.0.1',port,path,method,headers:{...headers,...(text===undefined?{}:{'content-length':Buffer.byteLength(text)})}},res=>{let value='';res.setEncoding('utf8');res.on('data',chunk=>value+=chunk);res.on('end',()=>resolve({status:res.statusCode,text:value,json:()=>JSON.parse(value)}));});
  req.on('error',reject);req.end(text);
 });
 const sign={host:`127.0.0.1:${port}`,origin:hub.url,'content-type':'application/json','x-pixoo-request':'1','sec-fetch-site':'same-origin'};
 const session=async(headers=sign,body={})=>raw('/api/dashboard/v1/session',{method:'POST',headers,body});
 const signIn=async(headers=sign)=>{const response=await session(headers);assert.equal(response.status,200,response.text);const value=response.json();assert.match(value.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(value.expiresInSeconds,8*60*60);return {authorization:`Bearer ${value.token}`};};
 const launch=async()=>{const {code}=await requestBrowserLaunch(directory);const response=await fetch(hub.url+'/api/dashboard/v1/launch',{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1',origin:hub.url},body:JSON.stringify({code})});assert.equal(response.status,200);return {authorization:`Bearer ${(await response.json()).token}`};};
 return {hub,directory,port,local,raw,sign,session,signIn,launch};
}

test('the session route is off without browserAccess and issues nothing',async t=>{
 const {hub,session}=await fixture(t);
 const response=await session();
 assert.equal(response.status,404);assert.deepEqual(response.json(),{error:{code:'not-found'}});
 assert.equal(hub.resources().browserSessions,0);
});

test('browserAccess accepts only trusted-loopback',async t=>{
 for(const value of ['trusted',true,'','TRUSTED-LOOPBACK',{}]){
  const directory=await mkdtemp(join(tmpdir(),'hub-trusted-invalid-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'configured',digest:digest(configuredToken),scopes:['read'],devices:[]}],browserAccess:value}),/invalid-configuration/,String(value));
 }
});

test('a trusted-loopback session has the launcher grants and nothing more',async t=>{
 // The alias's endpoint is never contacted: the context and grants come from configuration.
 const wall={id:'wall',kind:'nanoleaf',controllerId:'wall-controller',deviceId:'wall',endpoint:'http://127.0.0.1:9/controller/v1',token:'n'.repeat(43)};
 const {hub,signIn,raw,sign}=await fixture(t,{browserAccess:'trusted-loopback',mcp:true,controllers:[wall]});
 const headers=await signIn();
 assert.equal(hub.resources().browserSessions,1);
 const context=await fetch(hub.url+'/api/dashboard/v1/context',{headers});assert.equal(context.status,200);
 const value=await context.json();assert.equal(value.control,true);assert.deepEqual(value.components.map(c=>c.id),['wall'],'the session is granted every configured alias');
 const view=await fetch(hub.url+'/api/monitor/v1/sessions',{headers});assert.equal(view.status,200);
 const label=await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers:{...headers,'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify({operation:'label',requestId:(await view.json()).nextRequestId,identity,label:'Chosen'})});
 assert.equal(label.status,200,'control scope admits a monitor command');
 const event={apiVersion:'1.0',identity,turn:{status:'unknown'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:Date.now(),ordering:{status:'unknown'}};
 assert.equal((await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers:{...headers,'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify(event)})).status,403,'no ingest');
 const next=(await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json()).nextRequestId;
 assert.equal((await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers:{...headers,'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify({operation:'quiesce',requestId:next})})).status,403,'no admin');
 const mcp=await fetch(hub.url+'/mcp',{method:'POST',headers:{...headers,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'trusted-fixture',version:'1'}}})});
 assert.equal(mcp.status,401,'MCP refuses a browser session');
 assert.equal((await raw('/api/dashboard/v1/logout',{method:'POST',headers:{...sign,...headers},body:{}})).status,200);
 assert.equal(hub.resources().browserSessions,0);
});

test('a trusted-loopback request from anywhere but the page is refused without a session',async t=>{
 const {hub,port,session,sign}=await fixture(t,{browserAccess:'trusted-loopback'});
 const {origin,...noOrigin}=sign,{'x-pixoo-request':_,...noHeader}=sign,{'content-type':__,...noType}=sign;
 const cases=[
  ['foreign Host',{...sign,host:`evil.example:${port}`,origin:`http://evil.example:${port}`}],
  ['foreign Origin',{...sign,origin:'http://evil.example'}],
  ['mismatched Origin',{...sign,origin:`http://localhost:${port}`}],
  ['missing Origin',noOrigin],
  ['cross-site fetch',{...sign,'sec-fetch-site':'cross-site'}],
  ['same-site fetch',{...sign,'sec-fetch-site':'same-site'}],
  ['user-initiated navigation',{...sign,'sec-fetch-site':'none'}],
  ['missing custom header',noHeader],
  ['wrong custom header',{...sign,'x-pixoo-request':'0'}],
 ];
 for(const [name,headers] of cases){const response=await session(headers);assert.equal(response.status,403,name);}
 assert.equal((await session(noType)).status,400,'a body that is not JSON');
 for(const body of [{code:'x'},[],null,'']){const response=await session(sign,body);assert.equal(response.status,400,JSON.stringify(body));}
 assert.equal(hub.resources().browserSessions,0);
});

test('localhost serves the page and the API, and a mixed Origin is refused',async t=>{
 const {hub,port,local,raw,signIn,sign}=await fixture(t,{browserAccess:'trusted-loopback'});
 const localSign={...sign,host:`localhost:${port}`,origin:local};
 const page=await raw('/',{headers:{host:`localhost:${port}`,'sec-fetch-site':'none'}});
 assert.equal(page.status,200);assert.match(page.text,/<div id="root">/);
 const headers=await signIn(localSign);
 assert.equal((await raw('/api/dashboard/v1/context',{headers:{...headers,host:`localhost:${port}`,origin:local,'sec-fetch-site':'same-origin'}})).status,200);
 assert.equal((await raw('/api/dashboard/v1/context',{headers:{...headers,host:`localhost:${port}`}})).status,200,'a GET without Origin');
 assert.equal((await raw('/api/dashboard/v1/context',{headers:{...headers,host:`localhost:${port}`,origin:hub.url}})).status,403,'a localhost Host with a numeric Origin');
 assert.equal((await raw('/api/dashboard/v1/context',{headers:{...headers,host:`127.0.0.1:${port}`,origin:local}})).status,403,'a numeric Host with a localhost Origin');
 assert.equal((await raw('/api/dashboard/v1/context',{headers:{...headers,host:`localhost:${Number(port)+1}`}})).status,403,'another port');
 assert.equal((await raw('/',{headers:{host:`evil.example:${port}`}})).status,403,'a rebinding page');
 const configured={authorization:`Bearer ${configuredToken}`};
 assert.equal((await raw('/api/monitor/v1/sessions',{headers:{...configured,host:`localhost:${port}`}})).status,200,'the alias applies to configured credentials too');
});

test('localhost is accepted without the option, and the launch exchange accepts it too',async t=>{
 const {hub,directory,port,local,raw}=await fixture(t);
 assert.equal((await raw('/',{headers:{host:`localhost:${port}`}})).status,200);
 const {code}=await requestBrowserLaunch(directory);
 const response=await raw('/api/dashboard/v1/launch',{method:'POST',headers:{host:`localhost:${port}`,origin:local,'content-type':'application/json','x-pixoo-request':'1'},body:{code}});
 assert.equal(response.status,200);assert.equal(hub.resources().browserSessions,1);
});

test('trusted-loopback and launcher sessions share the cap and the retirement path',async t=>{
 const {hub,signIn,launch}=await fixture(t,{browserAccess:'trusted-loopback'});
 const read=headers=>fetch(hub.url+'/api/monitor/v1/sessions',{headers}).then(r=>r.status);
 const first=await signIn(),rest=[];
 for(let index=0;index<15;index++)rest.push(index%2?await launch():await signIn());
 assert.equal(hub.resources().browserSessions,16);assert.equal(await read(first),200);
 const extra=await signIn();
 assert.equal(await read(first),401,'the oldest session is evicted');assert.equal(hub.resources().browserSessions,16);
 hub.replaceCredentials([{id:'configured',digest:digest(configuredToken),scopes:['read'],devices:[]}]);
 assert.equal(await read(extra),401,'credential replacement retires trusted sessions');
 assert.equal(hub.resources().browserSessions,0);
 const expiring=await signIn();
 const now=Date.now,start=now();
 try{Date.now=()=>start+8*60*60*1000+1;assert.equal(await read(expiring),401,'a trusted session expires after eight hours');}finally{Date.now=now;}
 const closing=await signIn();assert.equal(await read(closing),200);
 await hub.close();assert.equal(hub.resources().browserSessions,0,'shutdown retires trusted sessions');
});

test('a session request whose body arrives during shutdown issues nothing',async t=>{
 const {hub,port,sign}=await fixture(t,{browserAccess:'trusted-loopback'});
 const response=new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:'/api/dashboard/v1/session',method:'POST',headers:{...sign,'content-length':2}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',()=>resolve('closed'));req.flushHeaders();
  (async()=>{const deadline=Date.now()+5000;while(hub.resources().requests<1){if(Date.now()>deadline)throw new Error('request-not-admitted');await new Promise(r=>setTimeout(r,5));}
   const closing=hub.close();req.end('{}');await closing;})().catch(reject);
 });
 assert.notEqual(await response,200);
 assert.equal(hub.resources().browserSessions,0,'shutdown leaves no browser session behind');
});

test('the CLI reads browserAccess from the private configuration and refuses other values',async t=>{
 const {spawn,execFile}=await import('node:child_process'),{once}=await import('node:events'),{writeFile,mkdir}=await import('node:fs/promises'),{promisify}=await import('node:util');
 const directory=await mkdtemp(join(tmpdir(),'hub-trusted-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=join(directory,'state');await mkdir(store,{mode:0o700});
 const cli=new URL('../dist/cli.js',import.meta.url).pathname,write=(file,browserAccess)=>writeFile(file,JSON.stringify({directory:store,ownerId:'owner',consumers:[],controllers:[],port:0,credentials:[{id:'reader',digest:digest(configuredToken),scopes:['read'],devices:[]}],browserAccess}),{mode:0o600});
 const invalid=join(directory,'invalid.json');await write(invalid,'on');
 const failure=await promisify(execFile)(process.execPath,[cli,'serve',invalid]).then(()=>assert.fail('start must fail'),error=>error);
 assert.equal(failure.stderr,'hub-start-failed: invalid-configuration\n');
 const config=join(directory,'host.json');await write(config,'trusted-loopback');
 const child=spawn(process.execPath,[cli,'serve',config],{stdio:['ignore','pipe','pipe']});const exited=once(child,'exit');
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const [chunk]=await Promise.race([once(child.stdout,'data'),exited.then(result=>{throw new Error('CLI exited before readiness: '+JSON.stringify(result));})]);
 const {url}=JSON.parse(chunk.toString());
 const response=await fetch(url+'/api/dashboard/v1/session',{method:'POST',headers:{origin:url,'content-type':'application/json','x-pixoo-request':'1'},body:'{}'});
 assert.equal(response.status,200);
 child.kill('SIGTERM');assert.deepEqual(await exited,[0,null]);
});
