import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Library} from '../../src/library/index.js';
import {MAX_HOSTED_GIF_BYTES, PIXOO64_HOSTED_PROFILE} from '../../src/media/contracts.js';
import {PixooStore} from '../../src/module/store.js';
import {oversizedHostedSourceGif} from '../helpers/media-fixtures.js';
import {startHostedFiles} from '../../src/device/hosted-files.js';
import {HttpDeviceAdapter} from '../../src/device/http-adapter.js';
import {inspectGif} from '../../src/media/gif.js';
import {DEFAULT_LIMITS, LIBRARY_PROFILE} from '../../src/media/contracts.js';
import {encodeHostedGif} from '../../src/media/hosted-gif.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {outsideInstalledPorts} from '../helpers/loopback.js';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function host(){const h=await outsideInstalledPorts(()=>startHostedFiles({bind:'127.0.0.1',port:0,origin:'http://127.0.0.1:0'}),opened=>opened.port,opened=>opened.close());cleanup.push(()=>h.close());return h;}
const frames=[{rgb:Buffer.alloc(12288),delayMs:50},{rgb:Buffer.alloc(12288,17),delayMs:50}];
const profile={name:'hosted-test',evidence:'observed' as const,maxFrames:500,minDelayMs:50,maxDelayMs:800,uniformTiming:true,readyDelayMs:1000};
it('serves only prepared bytes and requires a complete GET, then revokes access',async()=>{
 const h=await host(),abort=new AbortController(),bytes=encodeHostedGif(frames),file=h.publish(bytes,abort.signal);let transferred=false;
 void file.transferred.then(()=>{transferred=true;});
 expect((await fetch(`http://127.0.0.1:${h.port}/api/assets`)).status).toBe(404);
 expect((await fetch(file.url,{method:'POST'})).status).toBe(405);
 expect((await fetch(file.url,{headers:{range:'bytes=8-2'}})).status).toBe(416);
 expect((await fetch(file.url,{method:'HEAD'})).status).toBe(200);expect(transferred).toBe(false);
 const partial=await fetch(file.url,{headers:{range:'bytes=0-9'}});expect(partial.status).toBe(206);expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0,10));expect(transferred).toBe(false);
 const full=await fetch(file.url);expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);await file.transferred;
 file.revoke();expect((await fetch(file.url)).status).toBe(404);
});
it('retires an unfetched file and never exposes a replacement under the old URL',async()=>{
 const h=await host(),first=h.publish(Buffer.from('one'),new AbortController().signal);
 const failure=expect(first.transferred).rejects.toThrow('upload-failed');
 const controller=new AbortController(),second=h.publish(Buffer.from('two'),controller.signal);await failure;
 expect((await fetch(first.url)).status).toBe(404);
 const cancelled=expect(second.transferred).rejects.toThrow('upload-failed');controller.abort();await cancelled;
 expect((await fetch(second.url)).status).toBe(404);
});
it('keeps one writer through fetch and returns estimated readiness without retry',async()=>{
 const files=await host(),clock=new ManualClock(),commands:string[]=[];let url='';
 const device=new HttpDeviceAdapter({ip:'192.168.50.20',profile,clock,hosted:{files,encode:a=>encodeHostedGif(a.frames)}},body=>{commands.push(String(body.Command));url=String(body.FileName);return Promise.resolve({error_code:0});});cleanup.push(()=>device.close());
 const upload=device.uploadAnimation({frames},{generation:0}),brightness=device.setBrightness(30,{generation:0});
 await Promise.resolve();expect(commands).toEqual(['Device/PlayTFGif']);
 await (await fetch(url)).arrayBuffer();
 expect(await upload).toMatchObject({ok:true,value:{estimatedReadyAtMs:1000}});expect((await brightness).ok).toBe(true);
 expect(commands).toEqual(['Device/PlayTFGif','Channel/SetBrightness']);
});
it.each(['cancelled','stale-generation','timeout'] as const)('retires an unfetched command on %s with possible effects and no replay',async code=>{
 const files=await host(),clock=new ManualClock(),commands:string[]=[],abort=new AbortController();let url='';
 const device=new HttpDeviceAdapter({ip:'192.168.50.20',profile,clock,hosted:{files,encode:a=>encodeHostedGif(a.frames)}},body=>{commands.push(String(body.Command));url=String(body.FileName);return Promise.resolve({error_code:0});});cleanup.push(()=>device.close());
 const upload=device.uploadAnimation({frames},{generation:0,signal:abort.signal,timeoutMs:200});await Promise.resolve();
 if(code==='cancelled')abort.abort();else if(code==='stale-generation')device.invalidateGeneration();else clock.advance(200);
 expect(await upload).toMatchObject({ok:false,code,priorEffects:'possible'});
 expect(commands).toEqual(['Device/PlayTFGif']);expect((await fetch(url)).status).toBe(404);
});

it('expires access at fifteen seconds and bounds cumulative transfers',async()=>{
 const h=await host();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const file=h.publish(Buffer.from('bytes'),new AbortController().signal);
  const expired=expect(file.transferred).rejects.toThrow('upload-failed');
  vi.advanceTimersByTime(15000);await expired;vi.useRealTimers();
  expect((await fetch(file.url)).status).toBe(404);
 }finally{vi.useRealTimers();}
 const file=h.publish(Buffer.alloc(10),new AbortController().signal);
 for(let i=0;i<5;i++){const response=await fetch(file.url);expect(response.status).toBe(200);await response.arrayBuffer();}
 expect((await fetch(file.url)).status).toBe(429);expect((await fetch(file.url)).status).toBe(404);
});

it('transfers every frame of a long animation in one whole-GIF command with its original timing', async () => {
  const files = await host();
  const commands: string[] = [];
  let downloaded: Buffer | undefined;
  const adapter = new HttpDeviceAdapter({ip: '192.168.1.2', profile, hosted: {files, encode: value => encodeHostedGif(value.frames)}}, async body => {
    commands.push(String(body.Command));
    expect(body.FileType).toBe(2);
    const response = await fetch(String(body.FileName));
    downloaded = Buffer.from(await response.arrayBuffer());
    return {error_code: 0};
  });
  cleanup.push(() => adapter.close());
  const long = Array.from({length: 1001}, (_, index) => ({rgb: Buffer.alloc(12288, index % 2), delayMs: 10}));
  expect((await adapter.uploadAnimation({frames: long}, {generation: 0})).ok).toBe(true);
  expect(commands).toEqual(['Device/PlayTFGif']);
  expect(downloaded).toBeDefined();
  const gif = inspectGif(downloaded as Buffer, DEFAULT_LIMITS, LIBRARY_PROFILE);
  expect(gif.patches.map(patch => patch.delay)).toEqual(Array<number>(1001).fill(10));
});

it('rechecks legacy playback evidence against actual hosted bytes and keeps the refusal after reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pixoo-hosted-size-'));
  const db = new DatabaseSync(join(root, 'catalog.sqlite'));
  const open = () => {
    const store = new PixooStore(db);
    return Library.attach({database: db, directory: root, hostedChecks: {get: store.hostedCheck.bind(store), set: store.saveHostedCheck.bind(store)}});
  };
  let library = await open();
  try {
    const source = oversizedHostedSourceGif();
    expect(source.length).toBe(61409);
    const imported = await library.importMedia((async function* () {yield await Promise.resolve(source);})(), 'Hosted encoding exceeds the listener budget');
    const id = imported.rendition.id;
    expect(imported.rendition.frames.length).toBe(2200);
    const legacy = new PixooStore(db);
    legacy.saveHostedCheck(id, 'hosted-gif-protocol-v2', true);
    expect.soft((await library.catalogMedia(PIXOO64_HOSTED_PROFILE))[0]?.compatible).toBeUndefined();
    expect.soft(await library.playbackCompatible(id, PIXOO64_HOSTED_PROFILE)).toBe(false);
    const page = {q: '', offset: 0, limit: 1};
    expect.soft((await library.queryMedia(page, PIXOO64_HOSTED_PROFILE)).items[0]?.compatible).toBe(false);
    expect.soft((await library.queryMediaCached(page, PIXOO64_HOSTED_PROFILE)).items[0]?.compatible).toBe(false);
    expect(legacy.hostedCheck(id, 'hosted-gif-protocol-v2')).toBe(true);
    await library.close(); library = await open();
    const captured = await library.createMediaCheckpoint(id, undefined, {profile: PIXOO64_HOSTED_PROFILE}).catch((error: unknown) => error);
    expect.soft(captured).toMatchObject({code: 'storage-limit'});
    expect.soft((await library.queryMediaCached(page, PIXOO64_HOSTED_PROFILE)).items[0]?.compatible).toBe(false);
    expect((await library.preview(id, 2199)).bytes).toBeInstanceOf(Buffer);
    const loaded = await library.readRendition(id);
    const animation = {frames: loaded.frames.map(rgb => ({rgb, delayMs: 100}))};
    const files = await host(), transport = vi.fn();
    const device = new HttpDeviceAdapter({ip: '192.168.1.2', profile, hosted: {files, encode: value => encodeHostedGif(value.frames)}}, transport);
    try {
      const result = await device.uploadAnimation(animation, {generation: 0, timeoutMs: 15000});
      expect.soft(result).toMatchObject({ok: false, code: 'too-large', priorEffects: 'none'});
      expect(transport).not.toHaveBeenCalled();
    } finally { await device.close(); }
  } finally { await library.close(); db.close(); await rm(root, {recursive: true, force: true}); }
}, 30_000);

it('publishes exactly 10 MiB and preserves the existing file when a larger replacement is refused', async () => {
  const files = await host();
  expect(MAX_HOSTED_GIF_BYTES).toBe(10 * 1024 * 1024);
  const controller = new AbortController();
  const file = files.publish(Buffer.alloc(MAX_HOSTED_GIF_BYTES), controller.signal);
  try {
    expect(() => files.publish(Buffer.alloc(MAX_HOSTED_GIF_BYTES + 1), controller.signal)).toThrow('too-large');
    const response = await fetch(file.url, {method: 'HEAD'});
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(MAX_HOSTED_GIF_BYTES));
  } finally { file.revoke(); }
});
