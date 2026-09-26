import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './fixture.mjs';
import {independentWallRead,until} from './isolation.mjs';

test('a competing wall read owns only the wall slot; releasing it restores independent progress',async()=>{
 let release;
 const gate=new Promise(resolve=>release=resolve);
 const f=await fixture({beforeRead:request=>request.id==='wall'?gate:undefined});
 const read=id=>fetch(f.hub.url+`/api/controllers/v1/${id}/snapshot`,{headers:f.headers,signal:AbortSignal.timeout(2000)});
 let competitor,pixelResponse;
 try{
  competitor=read('wall');await until(()=>f.requests.some(r=>r.id==='wall'));
  f.setDelay(800);pixelResponse=read('pixel');await until(()=>f.requests.some(r=>r.id==='pixel'));
  const collision=await read('wall');assert.equal(collision.status,429);assert.deepEqual(await collision.json(),{error:{code:'capacity'}});
  assert.equal(f.requests.filter(r=>r.id==='wall').length,1,'the rejected read never reaches the fake controller');
  release();assert.equal((await competitor).status,200);
  await independentWallRead(f,f.requests.find(r=>r.id==='pixel'));
  assert.equal((await pixelResponse).status,200);assert.equal(f.writes.length,0);
 }finally{release();await Promise.allSettled([competitor,pixelResponse]);await f.close();}
});

test('negative control rejects a wall read serialized behind the 800 ms Pixoo response',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const f=await fixture({beforeRead:request=>request.id==='pixel'?gate:undefined});f.setDelay(800);
 const pixelResponse=fetch(f.hub.url+'/api/controllers/v1/pixel/snapshot',{headers:f.headers,signal:AbortSignal.timeout(2000)});
 try{
  await until(()=>f.requests.some(r=>r.id==='pixel'));
  await assert.rejects(independentWallRead(f,f.requests.find(r=>r.id==='pixel'),async()=>{
   release();await pixelResponse;
   return fetch(f.hub.url+'/api/controllers/v1/wall/snapshot',{headers:f.headers,signal:AbortSignal.timeout(2000)});
  }),{code:'ERR_ASSERTION',message:'wall does not await pixel'});
  assert.equal(f.writes.length,0);
 }finally{release();await pixelResponse;await f.close();}
});
