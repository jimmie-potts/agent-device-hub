// The module's command handling (Hub #843): each request's completion follows ADR 0012's "Errors, effects and outcomes".
import {expect,it} from 'vitest';
import {FakeDeviceAdapter,HttpDeviceAdapter,SPIKE_PROFILE,type OperationResult} from '../../src/device/index.js';
import {LibraryError} from '../../src/library/index.js';
import {MediaError} from '../../src/media/index.js';
import {PlaybackError,Player} from '../../src/playback/index.js';
import {MonitorPresentation} from '../../src/presentation/monitor-presentation.js';
import type {PlaybackSourceStatus} from '../../src/presentation/sources.js';
import {PixooControl,deviceCompletion,errorCompletion} from '../../src/module/control.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';

async function flush(clock?:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock?.advance(0);}}
async function setup(options:{online?:boolean;latencyMs?:number}={}){
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:options.latencyMs??0});device.setOnline(options.online??true);
 const player=await Player.open({store,device,clock}),monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 const control=new PixooControl({player,monitor});
 const close=async()=>{control.close();await monitor.close();await player.close();};
 /** Runs a command while the manual clock lets the fake device's scheduled work finish. */
 const settle=async<T>(pending:Promise<T>):Promise<T>=>{let done=false;void pending.finally(()=>{done=true;});for(let i=0;i<50&&!done;i++)await flush(clock);return pending;};
 return {clock,store,device,player,monitor,control,close,settle};
}
const result=(patch:Partial<Extract<OperationResult<unknown>,{ok:false}>>):OperationResult<unknown>=>({ok:false,code:'offline',priorEffects:'none',generation:0,timing:{submittedAtMs:0,startedAtMs:0,completedAtMs:5,queueMs:0,serviceMs:5},...patch});

it('completes a playlist start with its first upload, transmitted, and names the media operation',async()=>{
 const s=await setup();
 try{
  const completion=await s.settle(s.control.start(s.store.playlist.id));
  expect(completion).toMatchObject({result:'succeeded',evidence:'transmitted',transmission:{operationIds:['media']}});
  expect(s.device.operations.filter(o=>o.kind==='uploadAnimation'&&o.outcome==='success')).toHaveLength(1);
 }finally{await s.close();}
});
it('fails a start whose upload cannot reach an offline device, with no evidence and the retryable unavailable code',async()=>{
 const s=await setup({online:false});
 try{
  const completion=await s.settle(s.control.start(s.store.playlist.id));
  expect(completion).toMatchObject({result:'failed',evidence:'none',error:{code:'unavailable',retryable:true}});
 }finally{await s.close();}
});
it('completes pause, stop and clear as observed module state, with nothing sent',async()=>{
 const s=await setup();
 try{
  await s.settle(s.control.start(s.store.playlist.id));const uploads=s.device.operations.length;
  for(const action of ['pause','stop','clear'] as const)expect(await s.settle(s.control.control(action)),action).toEqual({result:'succeeded',evidence:'observed'});
  expect(s.device.operations).toHaveLength(uploads);expect(s.player.getSession()).toBeNull();
 }finally{await s.close();}
});
it('attributes each upload to the command that launched it while another command runs',async()=>{
 const s=await setup();
 try{
  await s.settle(s.control.start(s.store.playlist.id));
  const next=s.control.control('next'),previous=s.control.control('previous');
  const [a,b]=await s.settle(Promise.all([next,previous]));
  // The newer command supersedes the older one's upload: the older fails as cancelled or completes; it never takes the newer one's.
  expect(b).toMatchObject({result:'succeeded',evidence:'transmitted'});
  expect(['succeeded','failed']).toContain(a.result);
  if(a.result==='failed')expect(a.error?.code).toBe('cancelled');
 }finally{await s.close();}
});
const song:PlaybackSourceStatus={source:'current',view:{card:true,status:'playing',title:'HARVEST MOON',artist:'NEIL YOUNG',stale:false}};
const uploaded=(s:Awaited<ReturnType<typeof setup>>)=>s.device.operations.filter(o=>o.kind==='uploadAnimation'&&o.outcome==='success').length;
it('completes a start that a whole Now Playing takeover pauses for the card as observed, and plays it once the song ends',async()=>{
 // Each upload takes 50 ms at the device, so the takeover pauses the start before its first picture goes out.
 const s=await setup({latencyMs:50});
 try{
  await s.monitor.setNowPlaying('whole');s.monitor.submitPlayback(song);
  expect(await s.settle(s.control.start(s.store.playlist.id))).toEqual({result:'succeeded',evidence:'observed'});
  expect(s.monitor.nowPlayingSummary().takeover).toBe('whole');
  expect(s.player.getState()).toMatchObject({intent:'paused',playlistId:s.store.playlist.id});
  expect(uploaded(s)).toBe(0);
  // The song ends: the takeover gives the display back, and the start's selection plays.
  s.monitor.submitPlayback({source:'current',view:{card:false}});
  for(let i=0;i<5;i++){await flush(s.clock);s.clock.advance(50);}
  expect(s.player.getState().intent).toBe('active');
  expect(uploaded(s)).toBe(1);
 }finally{await s.close();}
});
it('keeps a start that a newer command superseded cancelled, though a takeover then pauses the newer one',async()=>{
 const s=await setup({latencyMs:50});
 try{
  await s.monitor.setNowPlaying('whole');
  const start=s.control.start(s.store.playlist.id);
  await flush();
  // The start's upload waits at the device. Next supersedes it, and the song that starts at once pauses next for the card.
  const next=s.control.control('next');s.monitor.submitPlayback(song);
  expect(await s.settle(start)).toMatchObject({result:'failed',evidence:'none',error:{code:'cancelled'}});
  expect(await s.settle(next)).toEqual({result:'succeeded',evidence:'observed'});
  expect(s.monitor.nowPlayingSummary().takeover).toBe('whole');
 }finally{await s.close();}
});
it('refuses resume without a context as invalid-state, proving no effect',async()=>{
 const s=await setup();
 try{
  expect(await s.settle(s.control.control('resume'))).toMatchObject({result:'failed',evidence:'none',error:{code:'invalid-state'}});
  expect(s.device.operations).toHaveLength(0);
 }finally{await s.close();}
});
it('completes brightness and screen writes with the device write, and an offline write as failed',async()=>{
 const s=await setup();
 try{
  expect(await s.settle(s.control.brightness(40))).toMatchObject({result:'succeeded',evidence:'transmitted',transmission:{operationIds:['display']}});
  s.device.setOnline(false);
  expect(await s.settle(s.control.power(false))).toMatchObject({result:'failed',evidence:'none',error:{code:'unavailable'}});
 }finally{await s.close();}
});
it('reports a device write that may have reached the device as uncertain, never as a refusal',async()=>{
 let release:(value:Record<string,unknown>)=>void=()=>{};
 // The device takes the write and never answers; the transport ends the request when the writer's deadline aborts it.
 const device=new HttpDeviceAdapter({ip:'192.168.1.2',profile:SPIKE_PROFILE},(_body,signal)=>new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>{reject(new Error('aborted'));},{once:true});}));
 const player=await Player.open({store:new MemoryPlaybackStore(),device,operationTimeoutMs:50}),monitor=new MonitorPresentation(player,{save:async()=>{}});
 const control=new PixooControl({player,monitor});
 try{
  expect(await control.brightness(30)).toMatchObject({result:'uncertain',evidence:'none',error:{code:'uncertain-result'}});
 }finally{release({error_code:0});control.close();await monitor.close();await player.close();await device.close();}
});
it('reports a write the Pixoo refused with an error code as failed and transmitted, since it reached the device',async()=>{
 const {DeviceRequestError}=await import('../../src/device/http-transport.js');
 const device=new HttpDeviceAdapter({ip:'192.168.1.2',profile:SPIKE_PROFILE},()=>Promise.reject(new DeviceRequestError('device-error',{deviceCode:1})));
 const player=await Player.open({store:new MemoryPlaybackStore(),device}),monitor=new MonitorPresentation(player,{save:async()=>{}});
 const control=new PixooControl({player,monitor});
 try{
  expect(await control.brightness(30)).toMatchObject({result:'failed',evidence:'transmitted',error:{code:'invalid-state'},transmission:{operationIds:['display']}});
 }finally{control.close();await monitor.close();await player.close();await device.close();}
});
it('maps device results and errors by what they prove about effects',()=>{
 expect(deviceCompletion(undefined,'display')).toMatchObject({result:'failed',evidence:'none',error:{code:'cancelled'}});
 expect(deviceCompletion(result({code:'timeout',priorEffects:'possible'}),'media')).toMatchObject({result:'uncertain',evidence:'none',error:{code:'uncertain-result'}});
 expect(deviceCompletion(result({code:'stale-generation'}),'media')).toMatchObject({result:'failed',error:{code:'cancelled'}});
 // A failure the Pixoo answered reached it: its evidence is transmitted, never none, and the send is the device's last
 // transmission, as for a confirmed send.
 expect(deviceCompletion(result({code:'device-error',priorEffects:'possible'}),'display')).toMatchObject({result:'failed',evidence:'transmitted',error:{code:'invalid-state'},transmission:{transmittedAtMs:5,operationIds:['display']}});
 expect(deviceCompletion(result({code:'http-error',priorEffects:'possible'}),'display')).toMatchObject({result:'failed',evidence:'transmitted',error:{code:'unavailable'},transmission:{transmittedAtMs:5,operationIds:['display']}});
 expect(deviceCompletion(result({code:'protocol-error',priorEffects:'possible'}),'media')).toMatchObject({result:'uncertain',evidence:'transmitted',error:{code:'uncertain-result'},transmission:{transmittedAtMs:5,operationIds:['media']}});
 // A failure it did not answer was never a transmission.
 expect(deviceCompletion(result({code:'timeout',priorEffects:'possible'}),'media')).not.toHaveProperty('transmission');
 expect(deviceCompletion(result({code:'offline'}),'display')).toMatchObject({result:'failed',evidence:'none',error:{code:'unavailable'}});
 expect(deviceCompletion({ok:true,value:undefined,generation:0,timing:{submittedAtMs:0,startedAtMs:0,completedAtMs:7,queueMs:0,serviceMs:7}},'media'))
  .toEqual({result:'succeeded',evidence:'transmitted',transmission:{transmittedAtMs:7,operationIds:['media']}});
 expect(errorCompletion(new LibraryError('not-found'))).toMatchObject({result:'failed',error:{code:'not-found'}});
 expect(errorCompletion(new LibraryError('revision-conflict'))).toMatchObject({result:'failed',error:{code:'revision-conflict'}});
 expect(errorCompletion(new MediaError('pixel-limit'))).toMatchObject({result:'failed',error:{code:'too-large'}});
 expect(errorCompletion(new MediaError('decode-failed'))).toMatchObject({result:'failed',error:{code:'invalid-request'}});
 expect(errorCompletion(new PlaybackError('storage-error'))).toMatchObject({result:'uncertain',error:{code:'uncertain-result'}});
 expect(errorCompletion(new LibraryError('database-error'))).toMatchObject({result:'uncertain'});
 expect(errorCompletion(new Error('anything'))).toMatchObject({result:'uncertain',evidence:'none',error:{code:'uncertain-result'}});
 expect(errorCompletion(Object.assign(new Error('superseded'),{code:'cancelled'}))).toMatchObject({result:'failed',error:{code:'cancelled'}});
 // A detail never repeats an exception's text.
 expect(JSON.stringify(errorCompletion(new Error('secret text')))).not.toContain('secret text');
});
