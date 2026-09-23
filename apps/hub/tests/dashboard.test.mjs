import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {startHub} from '../dist/server.js';

test('dashboard context exposes only authorized components and no native credentials',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dashboard-'));
 const token='a'.repeat(43);let hub;
 try {
  hub=await startHub({directory,ownerId:'owner',consumers:[{id:'dashboard',clearOnNewTurn:false}],credentials:[{id:'reader',digest:createHash('sha256').update(token).digest('hex'),scopes:['read'],devices:['wall']}],controllers:[{id:'wall',kind:'nanoleaf',controllerId:'c',deviceId:'d',endpoint:'http://127.0.0.1:1/controller/v1',token:'b'.repeat(43)},{id:'private',kind:'pixoo',controllerId:'c2',deviceId:'d2',endpoint:'http://127.0.0.1:2/controller/v1',token:'c'.repeat(43)}]});
  const url=hub.url+'/api/dashboard/v1/context';
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);
  const view=await response.json();
  assert.equal(view.control,false);assert.deepEqual(view.consumers,['dashboard']);
  assert.deepEqual(view.components.map(c=>c.id),['wall']);
  assert.equal(JSON.stringify(view).includes('endpoint'),false);assert.equal(JSON.stringify(view).includes('token'),false);
  assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token}`,origin:'http://evil.invalid'}})).status,403);
 } finally {await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('static dashboard has a restrictive CSP and rejects cross-site fetches',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dashboard-assets-'));let hub;
 try{
  hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'reader',digest:createHash('sha256').update('x'.repeat(43)).digest('hex'),scopes:['read'],devices:[]}]});
  const response=await fetch(hub.url+'/');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await response.text(),/dashboard.js/);
  assert.equal((await fetch(hub.url+'/dashboard.js')).status,200);
  assert.equal((await fetch(hub.url+'/',{headers:{origin:'http://evil.invalid'}})).status,403);
  assert.equal((await fetch(hub.url+'/',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await fetch(hub.url+'/../package.json')).status,401);
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('editor links reject credentials and nonloopback destinations before startup',async()=>{
 for(const url of ['http://example.com/wall','http://user:secret@127.0.0.1/wall','http://127.0.0.1/wall?token=secret','javascript:alert(1)']){
  await assert.rejects(startHub({directory:'/invalid-test-directory',ownerId:'owner',consumers:[],controllers:[{id:'wall',kind:'nanoleaf',controllerId:'c',deviceId:'d',endpoint:'http://127.0.0.1:1/controller/v1',token:'b'.repeat(43)}],credentials:[{id:'reader',digest:createHash('sha256').update('x'.repeat(43)).digest('hex'),scopes:['read'],devices:['wall']}],editorLinks:{wall:url}}),/invalid-editor-links/);
 }
});

test('general controller commands are validated before forwarding and require control scope',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dashboard-general-'));
 const control='c'.repeat(43),reader='r'.repeat(43),native='n'.repeat(43);const upstream=[];let hub;
 const fake=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;upstream.push({authorization:req.headers.authorization,request:JSON.parse(body)});const request=JSON.parse(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({apiVersion:'1.0',controllerId:request.controllerId,deviceId:request.deviceId,requestId:request.requestId,configurationRevision:1,generation:request.expectedGeneration,outcome:'queued',priorEffects:'none',completedOperations:[],uncertainOperations:[]}));});
 await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
 try {
  hub=await startHub({directory,ownerId:'owner',consumers:[],credentials:[{id:'browser',digest:createHash('sha256').update(control).digest('hex'),scopes:['read','control'],devices:['pixel']},{id:'reader',digest:createHash('sha256').update(reader).digest('hex'),scopes:['read'],devices:['pixel']}],controllers:[{id:'pixel',kind:'pixoo',controllerId:'c',deviceId:'d',endpoint:`http://127.0.0.1:${fake.address().port}/controller/v1`,token:native}]});
  const base={apiVersion:'1.0',controllerId:'c',deviceId:'d',requestId:{epoch:'e',sequence:1},expectedConfigurationRevision:0,expectedGeneration:{epoch:'g',sequence:0}};
  const post=(token,command)=>fetch(hub.url+'/api/controllers/v1/pixel/commands',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify({...base,command})});
  assert.equal((await post(reader,{kind:'power.set',on:false})).status,403);
  for(const command of [{kind:'brightness.set',percent:150},{kind:'media.control',action:'restart'},{kind:'media.start'},{kind:'power.set',on:'yes'},{kind:'scene.activate',sceneId:'Beach Waves'},{kind:'scene.activate'}]){const response=await post(control,command);assert.equal(response.status,400);assert.equal((await response.json()).error.code,'invalid-request');}
  assert.equal(upstream.length,0,'unauthorized or invalid general commands never reach the controller');
  const accepted=await post(control,{kind:'brightness.set',percent:40});assert.equal(accepted.status,200);assert.equal((await accepted.json()).outcome,'queued');
  assert.equal(upstream.length,1);assert.deepEqual(upstream[0].request.command,{kind:'brightness.set',percent:40});assert.equal(upstream[0].authorization,`Bearer ${native}`);
  const scene=await post(control,{kind:'scene.activate',sceneId:'scene-'+'a'.repeat(64)});assert.equal(scene.status,200);assert.equal(upstream.length,2);assert.deepEqual(upstream[1].request.command,{kind:'scene.activate',sceneId:'scene-'+'a'.repeat(64)});
  const context=await (await fetch(hub.url+'/api/dashboard/v1/context',{headers:{authorization:`Bearer ${control}`}})).json();assert.equal(context.control,true);assert.equal(JSON.stringify(context).includes(native),false);
 } finally {await hub?.close();await new Promise(resolve=>{fake.close(resolve);fake.closeAllConnections();});await rm(directory,{recursive:true,force:true});}
});
