import {expect,it} from 'vitest';
import {parseGIF,decompressFrames} from 'gifuct-js';
import * as media from '../../src/media/index.js';

it('encodes every effective pixel and repeated frame with only a global palette',()=>{
 const frames=Array.from({length:100},(_,i)=>{
  const rgb=Buffer.alloc(64*64*3);
  for(let p=0;p<4096;p++){rgb[p*3]=(p+Math.floor(i/5))%256;rgb[p*3+1]=17;rgb[p*3+2]=231;}
  return {rgb,delayMs:50};
 });
 expect(media).toHaveProperty('encodeHostedGif');
 const bytes=media.encodeHostedGif(frames);
 const parsed=parseGIF(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
 const decoded=decompressFrames(parsed,true);
 expect(decoded).toHaveLength(100);
 for(const [i,frame] of decoded.entries()){
  expect(frame.delay).toBe(50);expect(frame.disposalType).toBe(1);expect(frame.transparentIndex).toBeUndefined();
  const rgb=Buffer.alloc(12288);for(let p=0;p<4096;p++)rgb.set(frame.patch.subarray(p*4,p*4+3),p*3);
  expect(rgb).toEqual(frames[i]?.rgb);
 }
 for(const frame of parsed.frames)if('image' in frame)expect(frame.image.descriptor.lct.exists).toBe(false);
 expect(bytes.length).toBeLessThan(200000);
});
it('rejects mixed timing and more than 256 combined colors without quantizing',()=>{
 const rgb=Buffer.alloc(12288);for(let p=0;p<257;p++){rgb[p*3]=p%256;rgb[p*3+1]=Math.floor(p/256);}
 expect(()=>media.encodeHostedGif([{rgb,delayMs:50}])).toThrow('profile-limit');
 expect(()=>media.encodeHostedGif([{rgb:Buffer.alloc(12288),delayMs:50},{rgb:Buffer.alloc(12288),delayMs:60}])).toThrow('profile-limit');
});
