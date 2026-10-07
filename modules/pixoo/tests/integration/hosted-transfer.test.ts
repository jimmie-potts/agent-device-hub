import {afterEach,expect,it,vi} from 'vitest';
import {startHostedFiles} from '../../src/device/hosted-files.js';
import {HttpDeviceAdapter} from '../../src/device/http-adapter.js';
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
