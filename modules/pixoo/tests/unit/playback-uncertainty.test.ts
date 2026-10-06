import {expect,it} from 'vitest';
import {Player} from '../../packages/playback/src/index.js';
import {FakeDeviceAdapter} from '../../packages/device/src/index.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
async function flush(clock:ManualClock){for(let i=0;i<80;i++){await Promise.resolve();clock.advance(0);}}

it('pauses a partial device upload without retry or skip until explicit resume',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});
 device.failNextUpload(1);
 const options={store,device,clock,pauseOnUncertain:true};const player=await Player.open(options);
 try{
  await player.start(store.playlist.id);await flush(clock);
  expect(player.getState()).toMatchObject({state:'paused',intent:'paused',itemId:store.playlist.items[0]!.id,lastError:{code:'upload-failed',priorEffects:'possible'}});
  clock.advance(100000);await flush(clock);
  expect(device.operations.filter(op=>op.kind==='uploadAnimation')).toHaveLength(1);
  expect(device.operations.filter(op=>op.kind==='probe')).toHaveLength(0);
  expect(clock.pendingTimers).toBe(0);
  await player.resume();await flush(clock);
  expect(player.getState()).toMatchObject({state:'playing',lastError:null,itemId:store.playlist.items[0]!.id});
  expect(device.operations.filter(op=>op.kind==='uploadAnimation')).toHaveLength(2);
 }finally{await player.close();}
});

class UncertainControl extends FakeDeviceAdapter {
 override async setBrightness(...args:Parameters<FakeDeviceAdapter['setBrightness']>){
  const result=await super.setBrightness(...args);
  return result.ok?{...result,ok:false as const,code:'timeout' as const,priorEffects:'possible' as const}:result;
 }
}
it('persists uncertain control context and restores it paused without output',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new UncertainControl({clock});
 const options={store,device,clock,pauseOnUncertain:true};let player=await Player.open(options);
 try{
  await player.start(store.playlist.id);await flush(clock);
  const control=player.setBrightness(40);await flush(clock);await control;
  expect(player.getState()).toMatchObject({state:'paused',intent:'paused',dwellDeadlineMs:null,lastError:{code:'timeout',priorEffects:'possible'}});
  const count=device.effects.length;clock.advance(100000);await flush(clock);expect(device.effects).toHaveLength(count);
  await player.close();const fresh=new FakeDeviceAdapter({clock});
  player=await Player.open({...options,device:fresh});
  expect(player.getState()).toMatchObject({state:'paused',intent:'paused',lastError:{code:'timeout',priorEffects:'possible'}});
  expect(fresh.effects).toEqual([]);
 }finally{await player.close();}
});
it('retains simulator recovery after a partial upload',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});device.failNextUpload(1);
 const player=await Player.open({store,device,clock});
 try{await player.start(store.playlist.id);await flush(clock);expect(player.getState()).toMatchObject({state:'playing',itemId:store.playlist.items[1]!.id});}
 finally{await player.close();}
});
