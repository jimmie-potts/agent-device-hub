import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStore, DEFAULT_TRANSFORM, SIMULATOR_PROFILE } from '@pixoo/media';
import { runWorker } from '../../packages/media/src/worker-client.js';
import { pathToFileURL } from 'node:url';
import { gifFixture } from '../helpers/media-fixtures.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map(p=>rm(p,{recursive:true,force:true}))); roots.length=0; });
async function setup() { const root = await mkdtemp(join(tmpdir(),'pixoo-media-test-')); roots.push(root); return {root,store:new MediaStore({directory:root,limits:{concurrency:2}})}; }
async function* upload(b: Buffer) { yield b.subarray(0,10); yield b.subarray(10); }
const gif = () => gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:4}]);
it('preserves streamed originals and deduplicates complete immutable renditions', async () => {
  const {store,root} = await setup(); const original=gif();
  const [a,b] = await Promise.all([store.render(upload(original)),store.render(upload(original))]);
  expect(a.id).toBe(b.id);
  expect(await readFile(join(root,'originals',a.sourceHash))).toEqual(original);
  expect(a.frames[0]!.delayMs).toBe(40);
  const rgb = await store.readFrame(a.id,0,'rgb'); expect(rgb.length).toBe(12288);
  rgb.fill(0); expect((await store.readFrame(a.id,0,'rgb'))[0]).toBe(255);
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect(await readdir(join(root,'renditions'))).toEqual([a.id]);
});
it('rejects a cached request cancelled as its producer finishes', async () => {
  const {store,root}=await setup(); const b=gif(); const original=await store.render(upload(b));
  const controller=new AbortController(); let sent=false;
  const stream:AsyncIterable<Uint8Array>={ [Symbol.asyncIterator]:()=>({
    next:async()=>sent ? {done:true,value:undefined} : (sent=true,{done:false,value:b}),
    return:async()=>{controller.abort();return {done:true,value:undefined};},
  }) };
  await expect(store.render(stream,{signal:controller.signal})).rejects.toMatchObject({code:'cancelled'});
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect((await store.render(upload(b))).id).toBe(original.id);
});
it('separates identities by transform and complete profile and preserves existing files on rejection', async () => {
  const {store,root}=await setup(); const b=gif();
  const a=await store.render(upload(b));
  const crop=await store.render(upload(b),{transform:{...DEFAULT_TRANSFORM,fit:'crop'}});
  const smooth=await store.render(upload(b),{transform:{...DEFAULT_TRANSFORM,scaling:'smooth'}});
  const profile=await store.render(upload(b),{profile:{...SIMULATOR_PROFILE,name:'simulator-alternate'}});
  expect(new Set([a.id,crop.id,smooth.id,profile.id]).size).toBe(4);
  await expect(store.render(upload(Buffer.from('broken')))).rejects.toMatchObject({code:'unsupported'});
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect(await readFile(join(root,'originals',a.sourceHash))).toEqual(b);
});
it('rejects corrupt cached bytes rather than overwriting a referenced rendition', async () => {
  const {store,root}=await setup(); const a=await store.render(upload(gif()));
  const file=join(root,'renditions',a.id,'0.rgb'); await writeFile(file,Buffer.alloc(12288));
  await expect(store.render(upload(gif()))).rejects.toMatchObject({code:'cache-corrupt'});
  expect(await readFile(file)).toEqual(Buffer.alloc(12288));
  await expect(store.readFrame('../escape',0,'rgb')).rejects.toMatchObject({code:'invalid-input'});
});
it('enforces streamed byte and cached source pixel limits', async () => {
  const {store,root}=await setup(); await store.render(upload(gif()));
  const small=new MediaStore({directory:root,limits:{maxUploadBytes:5}});
  await expect(small.render(upload(gif()))).rejects.toMatchObject({code:'upload-limit'});
  const large=gifFixture(2,2,[{width:2,height:2,pixels:[1,1,1,1]}]);
  await store.render(upload(large));
  await expect(new MediaStore({directory:root,limits:{maxSourcePixels:3}}).render(upload(large))).rejects.toMatchObject({code:'pixel-limit'});
  expect(await readdir(join(root,'staging'))).toEqual([]);
});
it('bounds admission, cancels a queued job and cleans a cancelled upload', async () => {
  const {root}=await setup(); const store=new MediaStore({directory:root,limits:{concurrency:1,maxQueued:1}});
  const active=new AbortController(), queued=new AbortController();
  let entered!:()=>void; const started=new Promise<void>(resolve=>{entered=resolve;});
  const stream:AsyncIterable<Uint8Array>={ [Symbol.asyncIterator]:()=>({next:()=>{entered();return new Promise(()=>{});},return:async()=>({done:true,value:undefined})}) };
  const first=store.render(stream,{signal:active.signal}); const firstCheck=expect(first).rejects.toMatchObject({code:'cancelled'});
  await started;
  const second=store.render(upload(gif()),{signal:queued.signal}); const secondCheck=expect(second).rejects.toMatchObject({code:'cancelled'});
  await expect(store.render(upload(gif()))).rejects.toMatchObject({code:'busy'});
  queued.abort(); await secondCheck; active.abort(); await firstCheck;
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect((await store.render(upload(gif()))).frames.length).toBe(1);
});
it('times out a stalled producer and can then process another request', async () => {
  const {root}=await setup(); const store=new MediaStore({directory:root,limits:{timeoutMs:50}});
  const stream:AsyncIterable<Uint8Array>={ [Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{}),return:async()=>({done:true,value:undefined})}) };
  await expect(store.render(stream)).rejects.toMatchObject({code:'timeout'});
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect((await new MediaStore({directory:root}).render(upload(gif()))).frames.length).toBe(1);
});
it('reaps a stalled child before returning its timeout', async () => {
  const {root}=await setup(); const entry=join(root,'stalled.cjs');
  await writeFile(entry,'process.on("message",()=>{setInterval(()=>{},1000)});');
  const req={input:'unused',output:'unused',sourceHash:'unused',id:'unused',transform:DEFAULT_TRANSFORM,profile:SIMULATOR_PROFILE,limits:{maxUploadBytes:100,maxSourcePixels:100,concurrency:1,maxQueued:1,timeoutMs:100}};
  await expect(runWorker(req,AbortSignal.timeout(100),pathToFileURL(entry))).rejects.toMatchObject({code:'timeout'});
});
