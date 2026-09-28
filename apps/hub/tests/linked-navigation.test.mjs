import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {startHub} from '../dist/server.js';
import {requestBrowserLaunch} from '../dist/browser-launch.js';

// Hub #561: a link from another loopback app, such as the wall's B.U.N.N.Y. link, is a same-site top-level navigation.
// Only that navigation to the page itself is admitted. The page cannot be framed, and the assets, the API, the
// trusted-loopback session route and the launch exchange keep refusing every same-site request.
const digest=value=>createHash('sha256').update(value).digest('hex');
const token='t'.repeat(43);
/** The fetch metadata Chromium sends when a link on http://127.0.0.1:<another port>/ is clicked. */
const link={'sec-fetch-site':'same-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
const without=(headers,name)=>Object.fromEntries(Object.entries(headers).filter(([key])=>key!==name));

async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'hub-linked-'));let hub;
 try{hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'configured',digest:digest(token),scopes:['read','control','ingest'],devices:[]}],...options});}
 catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 const port=Number(new URL(hub.url).port);
 /** Sends one request with exactly these headers, including Host, which fetch cannot set. */
 const raw=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const text=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body);
  const req=request({host:'127.0.0.1',port,path,method,headers:{host:`127.0.0.1:${port}`,...headers,...(text===undefined?{}:{'content-length':Buffer.byteLength(text)})}},res=>{let value='';res.setEncoding('utf8');res.on('data',chunk=>value+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:value}));});
  req.on('error',reject);req.end(text);
 });
 return {hub,directory,port,raw};
}

const refused=(response,name)=>{assert.equal(response.status,403,name);assert.deepEqual(JSON.parse(response.text),{error:{code:'forbidden'}},name);};

test('a link from another loopback app loads the page',async t=>{
 const {hub,port,raw}=await fixture(t,{browserAccess:'trusted-loopback'});
 const cases=[
  ['a link click on another loopback port',link],
  ['a script or redirect navigation from another loopback port, without user activation',without(link,'sec-fetch-user')],
  ['a link click between two localhost ports',{...link,host:`localhost:${port}`}],
  ['no fetch metadata (a typed address or a non-browser client)',{}],
  ['a bookmark or typed address',{...link,'sec-fetch-site':'none'}],
  ['a reload from the page itself',{...link,'sec-fetch-site':'same-origin'}],
 ];
 for(const [name,headers] of cases){
  const page=await raw('/',{headers});
  assert.equal(page.status,200,name);assert.match(page.text,/<div id="root">/,name);assert.equal(page.headers['cache-control'],'no-store',name);
 }
 assert.equal(hub.resources().browserSessions,0,'loading the page issues no session by itself');
});

test('no page can frame the dashboard or keep a handle to its tab, however it was reached',async t=>{
 const {port,raw}=await fixture(t,{browserAccess:'trusted-loopback'});
 for(const [name,headers] of [['a bookmark',{...link,'sec-fetch-site':'none'}],['localhost',{...link,'sec-fetch-site':'none',host:`localhost:${port}`}],['a link from another loopback app',link]]){
  const page=await raw('/',{headers});
  assert.equal(page.status,200,name);
  assert.equal(page.headers['x-frame-options'],'DENY',name);
  assert.match(page.headers['content-security-policy'],/(^|; )frame-ancestors 'none'(;|$)/,name);
  // A linking page must not keep a scriptable handle to the tab, or it could re-navigate it to pile up sign-ins.
  assert.equal(page.headers['cross-origin-opener-policy'],'same-origin',name);
 }
});

test('a framed, fetched, cross-site or rebinding request for the page is refused',async t=>{
 const {port,raw}=await fixture(t,{browserAccess:'trusted-loopback'});
 const cases=[
  ['a link from another site',{...link,'sec-fetch-site':'cross-site'}],
  ['an iframe on another loopback port',{...link,'sec-fetch-dest':'iframe'}],
  ['a frame on another loopback port',{...link,'sec-fetch-dest':'frame'}],
  ['an object element on another loopback port',{...link,'sec-fetch-mode':'navigate','sec-fetch-dest':'object'}],
  ['an embed element on another loopback port',{...link,'sec-fetch-mode':'navigate','sec-fetch-dest':'embed'}],
  ['a fetch from another loopback port',{'sec-fetch-site':'same-site','sec-fetch-mode':'cors','sec-fetch-dest':'empty',origin:`http://127.0.0.1:${port+1}`}],
  ['a no-cors subresource from another loopback port',{'sec-fetch-site':'same-site','sec-fetch-mode':'no-cors','sec-fetch-dest':'script'}],
  ['a same-site request that is not a navigation',{...link,'sec-fetch-mode':'cors'}],
  ['a same-site navigation without Sec-Fetch-Dest',without(link,'sec-fetch-dest')],
  ['a same-site navigation without Sec-Fetch-Mode',without(link,'sec-fetch-mode')],
  ['a same-site navigation that carries an Origin',{...link,origin:`http://127.0.0.1:${port+1}`}],
  ['a same-site navigation that carries the page\'s own Origin',{...link,origin:`http://127.0.0.1:${port}`}],
  ['a same-site navigation with a rebinding Host',{...link,host:`evil.example:${port}`}],
  ['a same-site navigation with another port as Host',{...link,host:`127.0.0.1:${port+1}`}],
  ['an unknown Sec-Fetch-Site value',{...link,'sec-fetch-site':'same-site, same-origin'}],
 ];
 for(const [name,headers] of cases)refused(await raw('/',{headers}),name);
 assert.notEqual((await raw('/?from=wall',{headers:link})).status,200,'the page route takes no query string');
 assert.notEqual((await raw('/',{method:'POST',headers:{...link,'content-type':'application/json'},body:{}})).status,200,'a form post to / is not the page');
});

test('the assets, the API, the session route and the launch exchange still refuse same-site requests',async t=>{
 const {hub,directory,port,raw}=await fixture(t,{browserAccess:'trusted-loopback'});
 const other=`http://127.0.0.1:${port+1}`,bearer={authorization:`Bearer ${token}`};
 for(const asset of ['/dashboard.js','/dashboard.css']){
  assert.equal((await raw(asset,{headers:{'sec-fetch-site':'same-origin','sec-fetch-mode':'no-cors','sec-fetch-dest':asset.endsWith('.js')?'script':'style'}})).status,200,asset+' from the page itself');
  refused(await raw(asset,{headers:{'sec-fetch-site':'same-site','sec-fetch-mode':'no-cors','sec-fetch-dest':asset.endsWith('.js')?'script':'style'}}),asset+' as a subresource of another loopback app');
  refused(await raw(asset,{headers:link}),asset+' as a link from another loopback app');
 }
 const fetchFromOther={'sec-fetch-site':'same-site','sec-fetch-mode':'cors','sec-fetch-dest':'empty'};
 for(const [path,method,body] of [['/api/dashboard/v1/context','GET'],['/api/monitor/v1/sessions','GET'],['/api/monitor/v1/changes','GET'],['/api/hub/v1/health','GET'],['/api/monitor/v1/commands','POST',{operation:'label',requestId:{epoch:'e',sequence:1}}],['/api/dashboard/v1/logout','POST',{}]]){
  const write=method==='POST'?{'content-type':'application/json','x-pixoo-request':'1'}:{};
  // The change stream stays open when admitted, so only the finite routes are read from the page itself.
  if(path!=='/api/monitor/v1/changes')assert.notEqual((await raw(path,{method,headers:{...bearer,...write,'sec-fetch-site':'same-origin',origin:hub.url},body})).status,403,path+' from the page itself is not refused as forbidden');
  refused(await raw(path,{method,headers:{...bearer,...write,...fetchFromOther,origin:other},body}),path+' fetched by another loopback app');
  refused(await raw(path,{method,headers:{...bearer,...write,...fetchFromOther},body}),path+' same-site without an Origin');
  refused(await raw(path,{method,headers:{...bearer,...write,...link},body}),path+' with link navigation metadata');
 }
 const session={'content-type':'application/json','x-pixoo-request':'1'};
 refused(await raw('/api/dashboard/v1/session',{method:'POST',headers:{...session,...fetchFromOther,origin:other},body:{}}),'a session request from another loopback app');
 refused(await raw('/api/dashboard/v1/session',{method:'POST',headers:{...session,...fetchFromOther,origin:hub.url},body:{}}),'a same-site session request with the page\'s Origin');
 refused(await raw('/api/dashboard/v1/session',{method:'POST',headers:{...session,...link},body:{}}),'a session request with link navigation metadata');
 assert.equal(hub.resources().browserSessions,0,'no same-site request issued a session');
 const {code}=await requestBrowserLaunch(directory);
 refused(await raw('/api/dashboard/v1/launch',{method:'POST',headers:{...session,...fetchFromOther,origin:other},body:{code}}),'a launch exchange from another loopback app');
 refused(await raw('/api/dashboard/v1/launch',{method:'POST',headers:{...session,...link},body:{code}}),'a launch exchange with link navigation metadata');
 assert.equal(hub.resources().browserSessions,0);
 const exchange=await raw('/api/dashboard/v1/launch',{method:'POST',headers:{...session,'sec-fetch-site':'same-origin',origin:hub.url},body:{code}});
 assert.equal(exchange.status,200,'the refused exchanges did not consume the code');assert.equal(hub.resources().browserSessions,1);
});

test('without trusted-loopback a linked page loads and still cannot sign itself in',async t=>{
 const {hub,raw}=await fixture(t);
 const page=await raw('/',{headers:link});
 assert.equal(page.status,200);assert.equal(page.headers['x-frame-options'],'DENY');
 const session=await raw('/api/dashboard/v1/session',{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1','sec-fetch-site':'same-origin',origin:hub.url},body:{}});
 assert.equal(session.status,404,'the page offers the launcher and token form as before');
 assert.equal(hub.resources().browserSessions,0);
});
