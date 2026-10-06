import {expect,it} from 'vitest';
import {FakeDeviceAdapter} from '../../packages/device/src/index.js';
import {ManualClock} from '../helpers/manual-clock.js';
it('can simulate repeated uploads without retaining frame or operation history',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock,recordHistory:false});
 for(let i=0;i<200;i++){
  const result=device.uploadAnimation({frames:[{rgb:new Uint8Array(12288),delayMs:100}]},{generation:device.generation});clock.advance(0);
  expect((await result).ok).toBe(true);
 }
 expect(device.effects.length).toBe(0);expect(device.operations.length).toBe(0);
});
