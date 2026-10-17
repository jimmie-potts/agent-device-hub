import assert from 'node:assert/strict';
import {chmod,link,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCoreModule} from '../src/core/core.js';
import {edgeConfig,it,run,stateDir} from './support.js';
import {roomModelFixture} from './fixtures/room-model.js';
import {MAX_ROOM_MODEL_BYTES,parseRoomCatalog,parseRoomModel,type RoomModel,type RoomBatch,type RoomAnchor} from '../src/room-model.js';
import {readRoomContent} from '../src/core/room-models.js';

it('core serves a private prepared room only through authenticated content reads',async context=>{
  const directory=await stateDir(context);
  const reader={id:'room-reader',source:'bunny/parts/room-reader',token:'synthetic-room-reader-token',scopes:['read' as const]};
  const files=await edgeConfig(context,[reader]);
  const {runtime,logs}=await run(context,{modules:[createCoreModule()],stateDir:directory,configFile:files.config,edge:{schemas:{}}});
  const folder=join(directory,'modules/core/room-models');
  await mkdir(folder,{recursive:true,mode:0o700});
  await writeFile(join(folder,'catalog.json'),JSON.stringify({schema:'room-model-catalog/1.0',models:[{id:'studio',roomId:'studio'}]}),{mode:0o600});
  await writeFile(join(folder,'studio.json'),JSON.stringify(roomModelFixture()),{mode:0o600});
  const url=runtime.url+'/modules/core/content/room-model-studio';
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers:{authorization:'Bearer '+reader.token}});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),roomModelFixture());
  assert.equal((await fetch(url+'?path=outside',{headers:{authorization:'Bearer '+reader.token}})).status,400);
  const filename=join(folder,'studio.json');
  await chmod(filename,0o644);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+reader.token}})).status,403);
  await chmod(filename,0o600);
  await link(filename,join(folder,'duplicate.json'));
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+reader.token}})).status,403);
  await rm(join(folder,'duplicate.json'));
  await rm(filename);
  await symlink(join(folder,'catalog.json'),filename);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+reader.token}})).status,403);
  await rm(filename);
  await writeFile(filename,'x'.repeat(MAX_ROOM_MODEL_BYTES+1),{mode:0o600});
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+reader.token}})).status,413);
  await writeFile(filename,'invalid json',{mode:0o600});
  const malformed=await fetch(url,{headers:{authorization:'Bearer '+reader.token}});
  assert.equal(malformed.status,400);
  assert.equal((await malformed.text()).includes(folder),false);
  assert.equal(JSON.stringify(logs).includes(folder),false);
  await chmod(join(directory,'modules/core'),0o755);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+reader.token}})).status,500);
  assert.equal(runtime.health().status,'ok','an unsafe content folder does not fail core');
  await chmod(join(directory,'modules/core'),0o700);
});

it('prepared geometry refuses excessive, external, non-finite and mismatched data',()=>{
  const valid=parseRoomModel(roomModelFixture());assert.ok(valid);
  const mutations:((v:RoomModel,b:RoomBatch,a:RoomAnchor,c:RoomAnchor)=>void)[]=[
    v=>{v.schema='other' as 'room-model/1.0';},v=>{v.scene.width=Infinity;},(_v,b)=>{b.count=300_003;},
    (_v,b)=>{b.indices=Buffer.from(new Uint16Array([65535,0,1]).buffer).toString('base64');b.count=3;},
    (_v,b)=>{b.vertices=Buffer.from(new Float32Array([NaN,0,0,0,1,0]).buffer).toString('base64');},
    (_v,_b,a)=>{a.owner='bunny/modules/other';a.deviceId=null;},
    (_v,_b,a,c)=>{c.deviceId=a.deviceId;},(_v,_b,a,c)=>{c.group=a.group;},(_v,_b,a)=>{a.group='missing';},
  ];
  for(const change of mutations){
    const candidate:RoomModel=structuredClone(valid),batch=candidate.scene.batches[0],a=candidate.anchors[0],c=candidate.anchors[1];
    assert.ok(batch!==undefined&&a!==undefined&&c!==undefined);change(candidate,batch,a,c);assert.equal(parseRoomModel(candidate),undefined);
  }
  assert.equal(parseRoomModel({...valid,url:'https://external.invalid/scan'}),undefined);
  assert.equal(parseRoomCatalog({schema:'room-model-catalog/1.0',models:[{id:'studio',roomId:'studio'},{id:'other',roomId:'studio'}]}),undefined);
});

it('content reads fence cancellation, unknown references and private directory links',async context=>{
  const directory=await stateDir(context),folder=join(directory,'room-models');await mkdir(folder,{mode:0o700});
  const lifetime=new AbortController();
  assert.equal(await readRoomContent(directory,'unrelated',lifetime.signal),undefined);
  const cancelled=new AbortController();cancelled.abort();
  assert.equal((await readRoomContent(directory,'room-model-catalog',cancelled.signal) as {error:{code:string}}).error.code,'cancelled');
  await writeFile(join(folder,'catalog.json'),JSON.stringify({schema:'room-model-catalog/1.0',models:[]}),{mode:0o600});
  assert.equal((await readRoomContent(directory,'room-model-catalog',lifetime.signal) as {type:string}).type,'application/json');
  await chmod(folder,0o755);
  assert.equal((await readRoomContent(directory,'room-model-catalog',lifetime.signal) as {error:{code:string}}).error.code,'forbidden');
  await rm(folder,{recursive:true});await symlink(directory,folder);
  assert.equal((await readRoomContent(directory,'room-model-catalog',lifetime.signal) as {error:{code:string}}).error.code,'forbidden');
});
