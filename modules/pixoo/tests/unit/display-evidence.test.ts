import {expect,it} from 'vitest';
import {Player} from '@pixoo/playback';
import {FakeDeviceAdapter,type OperationResult,type ProbeResult} from '@pixoo/device';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {ManualClock} from '../helpers/manual-clock.js';
async function flush(clock:ManualClock){for(let n=0;n<80;n++){await Promise.resolve();clock.advance(0);}}
class Telemetry extends FakeDeviceAdapter{
 override async probe(...args:Parameters<FakeDeviceAdapter['probe']>):Promise<OperationResult<ProbeResult>>{
  const result=await super.probe(...args);return result.ok?{...result,value:{mode:'device',connected:true,available:true,channel:3,brightness:25}}:result;
 }
}
it('dates partial probe telemetry without turning a later write into an observation',async()=>{
 const clock=new ManualClock(),device=new Telemetry({clock}),player=await Player.open({device,clock,store:new MemoryPlaybackStore()});
 try{
  const probe=player.probe();await flush(clock);await probe;
  expect(player.getDisplayEvidence()).toMatchObject({brightness:{observed:{value:25,atMs:0}},screen:{observed:null}});
  clock.advance(50);const write=player.setBrightness(60);await flush(clock);await write;
  expect(player.getDisplayEvidence()).toMatchObject({requestedBrightness:60,brightness:{observed:{value:25,atMs:0},acknowledged:{value:60,atMs:50}}});
  const before=player.getDisplayEvidence();clock.advance(1000);expect(player.getDisplayEvidence()).toEqual(before);
 }finally{await player.close();}
});
it('discards volatile evidence when reopening retained paused context',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});let player=await Player.open({device,clock,store});
 try{
  await player.start(store.playlist.id);await flush(clock);expect(player.getDisplayEvidence().transport?.source).toBe('upload');
  await player.close();const fresh=new FakeDeviceAdapter({clock});player=await Player.open({device:fresh,clock,store});
  expect(player.getDisplayEvidence()).toMatchObject({requestedBrightness:null,transport:null,brightness:{acknowledged:null,observed:null}});expect(fresh.effects).toEqual([]);
 }finally{await player.close();}
});
it('rejects retired probe telemetry after newer user intent',async()=>{
 const clock=new ManualClock();let release=()=>{};
 class Held extends Telemetry{override async probe(...args:Parameters<Telemetry['probe']>){const result=await super.probe(...args);await new Promise<void>(resolve=>{release=resolve;});return result;}}
 const device=new Held({clock}),player=await Player.open({device,clock,store:new MemoryPlaybackStore()});
 try{const pending=player.probe();await flush(clock);await player.stop();release();await pending;expect(player.getDisplayEvidence().transport).toBeNull();expect(player.getState().intent).toBe('stopped');}
 finally{release();await player.close();}
});
