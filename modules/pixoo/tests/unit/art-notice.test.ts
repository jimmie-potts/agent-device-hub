import {expect,it} from 'vitest';
import {rainNoticeLines,type RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import {artNoticeFrames} from '../../src/presentation/art-notice.js';

const notice:RainNotice={kind:'rain-forecast',likelihood:'chance',forecastStartAtMs:new Date(2030,0,1,14,0).getTime(),forecastEndAtMs:new Date(2030,0,1,15,0).getTime(),forecastUpdatedAtMs:1,observedAtMs:1,staleAtMs:1000,weatherRevision:1};
it('fits every frame without changing originals and keeps likelihood separate from fictional pixels',()=>{
 const originals=[new Uint8Array(12288).fill(23),new Uint8Array(12288).fill(23),new Uint8Array(12288).fill(42)];
 const before=originals.map(frame=>new Uint8Array(frame));
 const frames=artNoticeFrames(originals,notice),likely=artNoticeFrames(originals,{...notice,likelihood:'likely'});
 expect(originals).toEqual(before);expect(frames).toHaveLength(3);expect(frames[0]).toEqual(frames[1]);expect(frames[0]).not.toEqual(frames[2]);
 expect(rainNoticeLines(notice)).toEqual(['RAIN FORECAST','CHANCE 14:00']);
 for(const [index,frame] of frames.entries()){
  expect(frame).toHaveLength(12288);
  expect(Array.from(frame.subarray((24*64+32)*3,(24*64+32)*3+3))).toEqual(Array(3).fill(index===2?42:23));
  expect(frame.subarray(48*64*3,50*64*3).every(value=>value===0)).toBe(true);
  expect([...new Set(frame.subarray(50*64*3))].sort((a,b)=>a-b)).toEqual([0,255]);
  expect(frame.subarray(0,57*64*3)).toEqual(likely[index]?.subarray(0,57*64*3));
  expect(frame.subarray(57*64*3)).not.toEqual(likely[index]?.subarray(57*64*3));
 }
});
it('rejects unbounded frames before drawing',()=>{
 expect(()=>artNoticeFrames([],notice)).toThrow();
 expect(()=>artNoticeFrames([new Uint8Array(3)],notice)).toThrow();
 expect(()=>artNoticeFrames(Array.from({length:21},()=>new Uint8Array(12288)),notice)).toThrow();
});
