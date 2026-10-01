import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {ControllerClient} from '../dist/controllers.js';
const legacy=JSON.parse(await readFile(new URL('../fixtures/pixoo-integration.json',import.meta.url))).snapshot;
const snapshot={...legacy,apiVersion:'pixoo-integration/1.1',catalogRevision:7,currentMedia:null,capabilities:{...legacy.capabilities,catalog:{supported:true,preview:'png-frames',maximumPageSize:100}}};
test('Pixoo negotiates the catalog snapshot and preserves the legacy command contract',async()=>{
 const seen=[];const server=createServer((req,res)=>{seen.push(req.url);res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.includes('?apiVersion=')?snapshot:legacy));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=new ControllerClient({id:'pixel',kind:'pixoo',controllerId:legacy.identity.controllerId,deviceId:legacy.identity.deviceId,endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:'p'.repeat(43)});
 try{assert.equal((await client.integrationSnapshot()).apiVersion,'pixoo-integration/1.1');assert.match(seen[0],/apiVersion=pixoo-integration%2F1.1/);}finally{client.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

import {createHash} from 'node:crypto';
import {framePng,pixooCatalogFixture} from './pixoo-catalog-fixture.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHub} from '../dist/server.js';
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'hub-catalog-')),catalogData=pixooCatalogFixture(),writes=[],reader='r'.repeat(43);
 const server=createServer((req,res)=>{if(req.method!=='GET')writes.push(req.url);if(!catalogData.serve(req,res,legacy)){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'not-found'}}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const hub=await startHub({directory,ownerId:'catalog-test',consumers:[],controllers:[{id:'pixel',kind:'pixoo',controllerId:legacy.identity.controllerId,deviceId:legacy.identity.deviceId,endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:'p'.repeat(43)}],credentials:[{id:'reader',digest:createHash('sha256').update(reader).digest('hex'),scopes:['read'],devices:['pixel']}]});
 return {hub,reader,writes,catalogData,async close(){await hub.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}};
}
import {validateManifest,catalogOperation,validateCatalogReply} from '../dist/pixoo-catalog.js';
test('catalog routes enforce scope, membership and exact conditional representations without device writes',async()=>{
 const f=await fixture({catalog:true,empty:true});
 try{
  const root=f.hub.url+'/api/controllers/v1/pixel/integration',headers={authorization:`Bearer ${f.reader}`};
  const get=(path,extra={})=>fetch(root+path,{headers:{...headers,...extra}});
  const list=await get('/catalog/renditions');assert.equal(list.status,200);const catalog=await list.json();assert.equal(catalog.items.length,25);assert.equal(catalog.total,30);assert.equal(catalog.items[0].compatible,false);
  const page=await (await get('/catalog/renditions?offset=25&limit=5')).json();assert.equal(page.items.length,5);
  for(const query of ['limit=101','limit=0','offset=-1','limit=2&limit=3','q=secret'])assert.equal((await get('/catalog/renditions?'+query)).status,400);
  const id=f.catalogData.ids[0],base='/renditions/'+id;
  const manifest=await (await get(base+'/preview.json')).json();assert.equal(manifest.frames.length,20);assert.deepEqual(manifest.frames.slice(0,2),[{index:0,delayMs:50},{index:1,delayMs:150}]);
  const frame=await get(base+'/frames/0.png'),bytes=Buffer.from(await frame.arrayBuffer());assert.equal(frame.status,200);assert.deepEqual(bytes,framePng(0));assert.equal(frame.headers.get('etag'),'"'+createHash('sha256').update(bytes).digest('hex')+'"');
  const etag=frame.headers.get('etag');assert.equal((await get(base+'/frames/0.png',{'if-none-match':etag})).status,304);
  f.catalogData.removed=true;assert.equal((await get(base+'/frames/0.png',{'if-none-match':etag})).status,404);f.catalogData.removed=false;
  assert.equal((await get(base+'/frames/1000.png')).status,400);assert.equal((await get(base+'/frames/20.png')).status,404);
  f.catalogData.broken=true;assert.equal((await get(base+'/frames/0.png')).status,502);f.catalogData.broken=false;
  assert.equal((await fetch(root+'/catalog/renditions')).status,401);
  f.hub.replaceCredentials([{id:'read',digest:createHash('sha256').update(f.reader).digest('hex'),scopes:['read'],devices:[]}]);
  const before=f.catalogData.reads.length;assert.equal((await get(base+'/frames/0.png',{'if-none-match':etag})).status,403);assert.equal(f.catalogData.reads.length,before);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});
test('strict manifests reject incomplete order/duration and admit exact still and full-color frames',()=>{
 const id='a'.repeat(64),base={apiVersion:'pixoo-integration/1.1',renditionId:id,width:64,height:64,frameCount:2,durationMs:200,frames:[{index:0,delayMs:50},{index:1,delayMs:150}],warnings:[]};
 assert.equal(validateManifest(base,id),true);assert.equal(validateManifest({...base,frames:base.frames.slice(0,1)},id),false);assert.equal(validateManifest({...base,durationMs:500},id),false);assert.equal(validateManifest({...base,token:'private'},id),false);
 const maximum={...base,frameCount:1000,durationMs:100000,frames:Array.from({length:1000},(_,index)=>({index,delayMs:100})),warnings:Array.from({length:1000},(_,frame)=>({frame,code:'missing-delay',effectiveDelayMs:100}))};assert.equal(validateManifest(maximum,id),true);
 assert.equal(validateManifest({...base,frameCount:1,durationMs:null,frames:[{index:0,delayMs:null}]},id),true);
 assert.throws(()=>catalogOperation('catalog/renditions',new URLSearchParams('limit=1&limit=1')));
 assert.equal(validateCatalogReply({apiVersion:'pixoo-integration/1.1',catalogRevision:1,items:[],total:0,offset:0,limit:25,token:'private'},{kind:'renditions',offset:0,limit:25}),false);
});
test('legacy producer version refusal falls back once without changing commands',async()=>{
 const seen=[];const server=createServer((req,res)=>{seen.push(req.url);res.setHeader('content-type','application/json');const versioned=req.url.includes('?');res.statusCode=versioned?400:200;res.end(JSON.stringify(versioned?{error:{code:'invalid-input'}}:legacy));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=new ControllerClient({id:'pixel',kind:'pixoo',controllerId:legacy.identity.controllerId,deviceId:legacy.identity.deviceId,endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:'p'.repeat(43)});
 try{assert.equal((await client.integrationSnapshot()).apiVersion,'pixoo-integration/1.0');assert.equal(seen.length,2);}finally{client.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
