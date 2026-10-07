import {createRequire} from 'node:module';
const {GIFEncoder}=createRequire(import.meta.url)('gifenc') as typeof import('gifenc');
import {MediaError} from './contracts.js';
interface Frame {readonly rgb:Uint8Array;readonly delayMs:number}
/** Exact effective RGB colors, never a quantizer. Repeated frames stay distinct. */
export function hostedPalette(frames:readonly Frame[]):number[][] {
 if(frames.length===0||frames.length>500)throw new MediaError('profile-limit');
 const colors=new Map<number,number[]>();
 for(const frame of frames){
  if(frame.rgb.length!==12288||!Number.isInteger(frame.delayMs)||frame.delayMs<50||frame.delayMs>800||frame.delayMs%10!==0||frame.delayMs!==frames[0]?.delayMs)throw new MediaError('profile-limit');
  for(let p=0;p<frame.rgb.length;p+=3){
   const r=frame.rgb[p]??0,g=frame.rgb[p+1]??0,b=frame.rgb[p+2]??0,key=(r<<16)|(g<<8)|b;
   if(!colors.has(key)){if(colors.size===256)throw new MediaError('profile-limit');colors.set(key,[r,g,b]);}
  }
 }
 return [...colors.values()];
}
export function encodeHostedGif(frames:readonly Frame[]):Buffer {
 const palette=hostedPalette(frames),indices=new Map(palette.map(([r=0,g=0,b=0],i)=>[((r<<16)|(g<<8)|b),i]));
 const gif=GIFEncoder();
 for(const [i,frame] of frames.entries()){
  const pixels=new Uint8Array(4096);
  for(let p=0;p<pixels.length;p++){const o=p*3;pixels[p]=indices.get(((frame.rgb[o]??0)<<16)|((frame.rgb[o+1]??0)<<8)|(frame.rgb[o+2]??0))??0;}
  gif.writeFrame(pixels,64,64,{...(i===0?{palette}:{}),delay:frame.delayMs,dispose:1,transparent:false,repeat:0});
 }
 gif.finish();return Buffer.from(gif.bytes());
}
