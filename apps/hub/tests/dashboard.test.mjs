import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
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
