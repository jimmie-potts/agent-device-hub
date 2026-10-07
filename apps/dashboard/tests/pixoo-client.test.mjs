import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'pixoo-client-'));
try{
 await build({entryPoints:['apps/dashboard/src/client.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'client.mjs')});
 const {Api}=await import(join(dir,'client.mjs'));
 test('PNG requests carry the browser bearer and share the controller read queue',async()=>{
  const previous=globalThis.fetch;let active=0,maximum=0;const calls=[];
  globalThis.fetch=async(path,options)=>{calls.push({path,options});active++;maximum=Math.max(active,maximum);await new Promise(r=>setTimeout(r,5));active--;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png',etag:'"'+'a'.repeat(64)+'"'}});};
  try{const api=new Api('secret');const path='/api/controllers/v1/pixel/integration/renditions/'+'a'.repeat(64)+'/preview.png';const results=await Promise.all([api.png(path),api.png(path)]);assert.equal(maximum,1);assert.equal(calls[0].options.headers.authorization,'Bearer secret');assert.equal(results[0].blob.size,3);}finally{globalThis.fetch=previous;}
 });
 test('a PNG read cancelled in flight keeps its device until the hub answers',async()=>{
  // The hub holds its one controller slot until the controller answers, so the next read waits instead of being refused (Hub #946).
  const previous=globalThis.fetch;const sent=[];let release;
  const image=()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png',etag:'"'+'a'.repeat(64)+'"'}});
  globalThis.fetch=async(path,options)=>{sent.push({path,signal:options.signal});if(path.endsWith('/first.png'))return new Promise(resolve=>{release=resolve;});return image();};
  try{
   const api=new Api('secret'),stop=new AbortController(),rendition='/api/controllers/v1/pixel/integration/renditions/'+'a'.repeat(64);
   const first=api.png(`${rendition}/first.png`,stop.signal),second=api.png(`${rendition}/second.png`);
   stop.abort();
   await assert.rejects(first,error=>error.code==='request-cancelled');
   await new Promise(resolve=>setTimeout(resolve,10));
   assert.deepEqual(sent.map(call=>call.path),[`${rendition}/first.png`],'the next read waits for the device');
   assert.equal(sent[0].signal.aborted,false,'the read in flight is not cancelled');
   release(image());
   assert.equal((await second).blob.size,3);
   assert.equal(sent.length,2);
  }finally{globalThis.fetch=previous;}
 });
}finally{await rm(dir,{recursive:true,force:true});}
