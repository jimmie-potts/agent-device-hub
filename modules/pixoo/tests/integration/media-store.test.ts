import { afterEach, expect, it } from 'vitest';
import fs, { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStore, DEFAULT_TRANSFORM, DEFAULT_LIMITS, SIMULATOR_PROFILE, DEVICE_PROFILES } from '../../src/media/index.js';
import { runWorker } from '../../src/media/worker-client.js';
import { pathToFileURL } from 'node:url';
import { gifFixture } from '../helpers/media-fixtures.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map(p=>rm(p,{recursive:true,force:true}))); roots.length=0; });
async function setup() { const root = await mkdtemp(join(tmpdir(),'pixoo-media-test-')); roots.push(root); return {root,store:new MediaStore({directory:root,limits:{concurrency:2}})}; }
async function* upload(b: Buffer) { yield Promise.resolve(b.subarray(0,10)); yield Promise.resolve(b.subarray(10)); }
const gif = () => gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:4}]);
it('preserves streamed originals and deduplicates complete immutable renditions', async () => {
  const {store,root} = await setup(); const original=gif();
  const [a,b] = await Promise.all([store.render(upload(original)),store.render(upload(original))]);
  expect(a.id).toBe(b.id);
  expect(await readFile(join(root,'originals',a.sourceHash))).toEqual(original);
  expect(a.frames[0]?.delayMs).toBe(40);
  const rgb = await store.readFrame(a.id,0,'rgb'); expect(rgb.length).toBe(12288);
  rgb.fill(0); expect((await store.readFrame(a.id,0,'rgb'))[0]).toBe(255);
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect(await readdir(join(root,'renditions'))).toEqual([a.id]);
});
it('rejects a cached request cancelled as its producer finishes', async () => {
  const {store,root}=await setup(); const b=gif(); const original=await store.render(upload(b));
  const controller=new AbortController(); let sent=false;
  const stream:AsyncIterable<Uint8Array>={ [Symbol.asyncIterator]:()=>({
    next:()=>Promise.resolve(sent ? {done:true,value:undefined} : (sent=true,{done:false,value:b})),
    return:()=>{controller.abort();return Promise.resolve({done:true,value:undefined});},
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
  const stream:AsyncIterable<Uint8Array>={ [Symbol.asyncIterator]:()=>({next:()=>{entered();return new Promise(()=>{});},return:()=>Promise.resolve({done:true,value:undefined})}) };
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
  const stream:AsyncIterable<Uint8Array>={ [Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{}),return:()=>Promise.resolve({done:true,value:undefined})}) };
  await expect(store.render(stream)).rejects.toMatchObject({code:'timeout'});
  expect(await readdir(join(root,'staging'))).toEqual([]);
  expect((await new MediaStore({directory:root}).render(upload(gif()))).frames.length).toBe(1);
});
it('reaps a stalled child before returning its timeout', async () => {
  const {root}=await setup(); const entry=join(root,'stalled.cjs');
  await writeFile(entry,'process.on("message",()=>{setInterval(()=>{},1000)});');
  const req={input:'unused',output:'unused',sourceHash:'unused',id:'unused',transform:DEFAULT_TRANSFORM,profile:SIMULATOR_PROFILE,limits:{...DEFAULT_LIMITS,maxUploadBytes:100,maxSourcePixels:100,maxGifCanvasPixels:100,concurrency:1,maxQueued:1,timeoutMs:100}};
  await expect(runWorker(req,AbortSignal.timeout(100),pathToFileURL(entry))).rejects.toMatchObject({code:'timeout'});
});

it('imports 1001 frames and reads the final PNG with its original delay', async () => {
  const {store, root} = await setup();
  const delays = Array.from({length: 1001}, (_, i) => i === 1000 ? 65535 : 1 + i % 17);
  const original = gifFixture(1, 1, delays.map((delay, i) => ({width: 1, height: 1, pixels: [i % 4], delay})));
  const rendition = await store.render(upload(original));
  expect(rendition.frames.map(frame => frame.delayMs)).toEqual(delays.map(delay => delay * 10));
  expect(rendition.source.delaysMs).toEqual(delays.map(delay => delay * 10));
  expect(await readFile(join(root, 'originals', rendition.sourceHash))).toEqual(original);
  const selected = await store.readPreview(rendition, 1000);
  expect(selected.bytes).toEqual(await readFile(join(root, 'renditions', rendition.id, '1000.png')));
}, 30_000);

it('reads all four historical profiles using their prechange rendition IDs', async () => {
  const {root, store} = await setup();
  const original = gifFixture(1, 1, [{width: 1, height: 1, pixels: [1], delay: 50}]);
  // Captured from 6d18ffbc. Hashing the expected values with today's renderer would miss an identity break.
  const ids = [
    '0a7c8e68b00f8c188ca37fd5b3ef1ce9ac944c6620d345b1c59390cc212b3838',
    '64eaa9282af91a6ac1325585fb4ff9166262b995cc99ed536c23a14d83cb810d',
    '290c9b15f9cc81ba7ec6994700f01336226c570ea9ac08f39657c84e8a2f7eb1',
    'ae0cfb5abdd66d392effc272f202ea7f064adb0100a1480471775b3d006620e0',
  ];
  for (const [index, profile] of [SIMULATOR_PROFILE, ...DEVICE_PROFILES].entries()) {
    const rendition = await store.render(upload(original), {profile});
    expect(rendition.id).toBe(ids[index]);
    const reopened = new MediaStore({directory: root});
    expect(await reopened.getRendition(rendition.id)).toEqual(rendition);
    expect((await reopened.readPreview(rendition, 0)).bytes).toBeInstanceOf(Buffer);
  }
  const current = await store.render(upload(original));
  expect(ids).not.toContain(current.id);
});

it('rejects a tiny GIF that exceeds the scaled pixel budget, including a cache hit', async () => {
  const {store, root} = await setup();
  const input = gifFixture(1, 1, [0, 1].map(i => ({width: 1, height: 1, pixels: [i]})));
  const limited = new MediaStore({directory: root, limits: {maxSourcePixels: 2 * 64 * 64 - 1}});
  await expect(limited.render(upload(input))).rejects.toMatchObject({code: 'pixel-limit'});
  expect(await readdir(join(root, 'originals'))).toEqual([]);
  expect(await readdir(join(root, 'renditions'))).toEqual([]);
  const retained = await store.render(upload(input));
  await expect(limited.render(upload(input))).rejects.toMatchObject({code: 'pixel-limit'});
  expect(await store.getRendition(retained.id)).toEqual(retained);
});

it('refuses an oversized immutable manifest before publishing any files', async () => {
  const {root} = await setup();
  const limits = {maxManifestBytes: 128, maxQueued: 0};
  const limited = new MediaStore({directory: root, limits});
  await expect(limited.render(upload(gif()))).rejects.toMatchObject({code: 'storage-limit'});
  for (const directory of ['staging', 'originals', 'renditions']) {
    expect(await readdir(join(root, directory))).toEqual([]);
  }
});

it.each(['ENOSPC', 'EDQUOT'])('reports %s during a parent frame write as capacity and keeps existing media readable', async code => {
  const {root, store} = await setup();
  const existing = await store.render(upload(gif()));
  const originalWrite = fs.writeFile;
  fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
    if (typeof args[0] === 'string' && args[0].endsWith('0.png')) throw Object.assign(new Error('private filesystem failure'), {code});
    await originalWrite(...args);
  };
  syncBuiltinESMExports();
  try {
    const different = gifFixture(1, 1, [{width: 1, height: 1, pixels: [2]}]);
    await expect(store.render(upload(different))).rejects.toMatchObject({code: 'storage-capacity', message: 'storage-capacity'});
    expect(await readdir(join(root, 'originals'))).toEqual([existing.sourceHash]);
    expect(await readdir(join(root, 'renditions'))).toEqual([existing.id]);
    expect(await readdir(join(root, 'staging'))).toEqual([]);
    expect(await store.getRendition(existing.id)).toEqual(existing);
  } finally {
    fs.writeFile = originalWrite;
    syncBuiltinESMExports();
  }
});
