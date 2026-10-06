import {expect,it} from 'vitest';
import {Player} from '../../packages/playback/src/index.js';
import {FakeDeviceAdapter} from '../../packages/device/src/index.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
async function flush(clock:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock.advance(0);}}
it('uploads exact monitor pixels only for the paused current player generation',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});
 const player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);await player.pause();
  const context=player.getSession(),generation=player.getState().generation,rgb=new Uint8Array(12288).fill(17);
  const upload=player.uploadDashboard([rgb],generation);await flush(clock);expect((await upload)?.ok).toBe(true);
  expect(device.effects.filter(e=>e.kind==='frame').at(-1)).toMatchObject({frame:{rgb,delayMs:500}});
  expect(player.getSession()).toEqual(context);expect(player.getState().intent).toBe('paused');
  await player.resume();await flush(clock);const before=device.operations.length;
  expect(await player.uploadDashboard([rgb],generation)).toBeUndefined();
  expect(await player.uploadDashboard([rgb],player.getState().generation)).toBeUndefined();expect(device.operations).toHaveLength(before);
 }finally{await player.close();}
});
it('retires queued monitor writes on screen-off and cannot revive them on screen-on',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:100});
 const player=await Player.open({store,device,clock});
 try{
  await player.pause();const old=player.getState().generation;
  const upload=player.uploadDashboard([new Uint8Array(12288)],old);
  const off=player.setScreen(false);await flush(clock);clock.advance(100);await flush(clock);await off;
  expect(await upload).toMatchObject({ok:false});expect(device.effects.filter(e=>e.kind==='frame')).toHaveLength(0);
  const on=player.setScreen(true);await flush(clock);clock.advance(100);await flush(clock);await on;
  expect(await player.uploadDashboard([new Uint8Array(12288)],old)).toBeUndefined();
  expect(device.effects.filter(e=>e.kind==='frame')).toHaveLength(0);
 }finally{await player.close();}
});
it('keeps newer evidence and intent when a retired monitor upload completes late',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();let release=()=>{};
 class Held extends FakeDeviceAdapter{override async uploadAnimation(...args:Parameters<FakeDeviceAdapter['uploadAnimation']>){const result=await super.uploadAnimation(...args);await new Promise<void>(resolve=>{release=resolve;});return result;}}
 const device=new Held({clock}),player=await Player.open({store,device,clock});
 try{
  await player.pause();const upload=player.uploadDashboard([new Uint8Array(12288)],player.getState().generation);await flush(clock);
  clock.advance(50);const off=player.setScreen(false);await flush(clock);await off;
  const current=player.getDisplayEvidence().transport;expect(current).toMatchObject({source:'screen',atMs:50,ok:true});
  release();expect(await upload).toMatchObject({ok:true});
  expect(player.getDisplayEvidence().transport).toEqual(current);expect(player.getState()).toMatchObject({intent:'paused',requestedScreenOn:false});
 }finally{release();await player.close();}
});
it('uploads a two-frame monitor picture as one 500 ms animation and rejects other frame sets',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});
 const player=await Player.open({store,device,clock});
 try{
  await player.pause();const generation=player.getState().generation;
  const first=new Uint8Array(12288).fill(1),second=new Uint8Array(12288).fill(2);
  const before=device.operations.length;
  const upload=player.uploadDashboard([first,second],generation);await flush(clock);expect((await upload)?.ok).toBe(true);
  expect(device.operations.slice(before).filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  expect(device.effects.filter(e=>e.kind==='frame').slice(-2)).toMatchObject([{frame:{rgb:first,delayMs:500}},{frame:{rgb:second,delayMs:500}}]);
  for(const invalid of [[],[first,second,first],[new Uint8Array(12287)]])await expect(player.uploadDashboard(invalid,generation)).rejects.toThrow();
 }finally{await player.close();}
});
