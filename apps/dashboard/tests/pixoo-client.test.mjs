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
}finally{await rm(dir,{recursive:true,force:true});}
