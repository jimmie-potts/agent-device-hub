import {createHash} from 'node:crypto';
import {systemClock,type Clock,type DeviceAdapter,type Animation,type OperationResult,type UploadResult} from './contracts.js';
import type {DeviceProfile} from './http-adapter.js';
import {parseDashboardArgs} from './dashboard-qualification.js';

export const GIF_EXPERIMENT_PROFILE:Readonly<DeviceProfile>=Object.freeze({name:'gif-qualification-unverified',evidence:'unverified',maxFrames:20,minDelayMs:100,maxDelayMs:800,uniformTiming:false,readyDelayMs:0});
export function parseGifQualificationArgs(args:string[],env:NodeJS.ProcessEnv){
 const allowed=new Set(['--device','--allow-display-change','--confirm-exclusive-writer','--preview','--owner','--model','--firmware','--source-revision']);
 for(const arg of args)if(arg.startsWith('--')&&!allowed.has(arg))throw new Error('Unknown GIF qualification option');
 const config=parseDashboardArgs(args,env),preview=config.preview?{preview:config.preview}:{};
 return config.mode==='fake'?{mode:'fake' as const,...preview}:{mode:'device' as const,...preview,ip:config.ip,owner:config.owner,model:config.model,firmware:config.firmware,sourceRevision:config.sourceRevision};
}
const digits=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001010010010','111101111101111','111101111001111'];
function numberedFrame(index:number):Uint8Array{
 const rgb=new Uint8Array(12288),color=index%2?[0,90,30]:[90,0,20];
 for(let i=0;i<4096;i++)rgb.set(color,i*3);
 const pixel=(x:number,y:number)=>rgb.set([200,200,200],(y*64+x)*3);
 for(const [n,char]of String(index+1).padStart(2,'0').split('').entries()){
  const glyph=digits[Number(char)]!;
  for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(glyph[y*3+x]==='1')for(let dy=0;dy<6;dy++)for(let dx=0;dx<6;dx++)pixel(10+n*24+x*6+dx,12+y*6+dy);
 }
 for(let y=52;y<59;y++)for(let x=2+index*3;x<4+index*3;x++)pixel(x,y);
 return rgb;
}
export interface GifQualificationCase{id:string;holdMs:number;animation:Animation}
export function gifQualificationCases():GifQualificationCase[]{
 return [{id:'A',delays:Array<number>(20).fill(500),holdMs:30000},{id:'B',delays:Array<number>(20).fill(100),holdMs:10000},
  {id:'C',delays:[200,800],holdMs:10000},{id:'D',delays:[800,200],holdMs:10000},{id:'E',delays:[500,500],holdMs:10000}]
 .map(({id,delays,holdMs})=>({id,holdMs,animation:{frames:delays.map((delayMs,index)=>({delayMs,rgb:numberedFrame(index)}))}}));
}
export function gifQualificationPreview(){
 const cases=JSON.stringify(gifQualificationCases().map(c=>({id:c.id,holdMs:c.holdMs,frames:c.animation.frames.map(f=>({delayMs:f.delayMs,rgb:Array.from(f.rgb)}))})));
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GIF qualification previews</title><style>body{font:16px system-ui;background:#161b22;color:#eee;margin:24px}main{display:flex;gap:24px;flex-wrap:wrap}canvas{width:256px;height:256px;image-rendering:pixelated}figure{margin:0;max-width:256px}button{padding:10px}</style><h1>GIF qualification sequence</h1><p>Exact 64×64 synthetic payloads. Browser cadence is illustrative; physical support is unverified.</p><p>A: 20 × 500 ms, B: 20 × 100 ms, C: 200/800 ms, D: 800/200 ms, E: 500/500 ms. Nothing on this page controls a device.</p><main></main><script>const cases=${cases};for(const item of cases){const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('p'),button=document.createElement('button');canvas.width=canvas.height=64;canvas.dataset.stage=item.id;const ctx=canvas.getContext('2d');let index=0,running=false,timer;function draw(){const frame=item.frames[index],image=ctx.createImageData(64,64);for(let i=0;i<4096;i++){image.data.set(frame.rgb.slice(i*3,i*3+3),i*4);image.data[i*4+3]=255}ctx.putImageData(image,0,0);caption.textContent=item.id+' · frame '+(index+1)+'/'+item.frames.length+' · '+frame.delayMs+' ms';if(running)timer=setTimeout(()=>{index=(index+1)%item.frames.length;draw()},frame.delayMs)}button.textContent='Animate preview';button.onclick=()=>{running=!running;clearTimeout(timer);button.textContent=running?'Pause preview':'Animate preview';draw()};figure.append(canvas,caption,button);document.querySelector('main').append(figure);draw()}</script></html>`;
}
export interface GifQualificationUpload{id:string;submittedAtMs:number;delaysMs:number[];sha256:string[];result:OperationResult<UploadResult>}
/** Fixed experiments only. The caller retains exclusive target ownership through adapter close. */
export async function runGifQualification(device:DeviceAdapter,signal?:AbortSignal,clock:Clock=systemClock){
 const start=clock.now(),deadline=start+180000,uploads:GifQualificationUpload[]=[];
 let status:'complete'|'failed'|'cancelled'|'bounded'='complete';
 const probe=await device.probe({generation:device.generation,timeoutMs:5000,...(signal?{signal}:{})});
 if(!probe.ok||probe.value.mode==='device'&&(probe.value.brightness===undefined||probe.value.screenOn!==true)){
  return {status:signal?.aborted?'cancelled':'failed',elapsedMs:clock.now()-start,probe,uploads,visibleMeasurements:'not-recorded'};
 }
 const wait=(ms:number)=>new Promise<void>(resolve=>{
  if(signal?.aborted){resolve();return;}
  const finish=()=>{cancel();signal?.removeEventListener('abort',finish);resolve();};
  const cancel=clock.schedule(ms,finish);signal?.addEventListener('abort',finish,{once:true});
 });
 for(const stage of gifQualificationCases()){
  if(signal?.aborted){status='cancelled';break;}
  if(clock.now()>=deadline){status='bounded';break;}
  const submittedAtMs=clock.now()-start;
  const result=await device.uploadAnimation(stage.animation,{generation:device.generation,timeoutMs:Math.min(15000,deadline-clock.now()),...(signal?{signal}:{})});
  uploads.push({id:stage.id,submittedAtMs,delaysMs:stage.animation.frames.map(f=>f.delayMs),sha256:stage.animation.frames.map(f=>createHash('sha256').update(f.rgb).digest('hex')),result});
  if(!result.ok){status=signal?.aborted?'cancelled':'failed';break;}
  await wait(Math.min(stage.holdMs,Math.max(0,deadline-clock.now())));
  if(signal?.aborted){status='cancelled';break;}
  if(clock.now()>=deadline){status='bounded';break;}
 }
 return {status,elapsedMs:clock.now()-start,probe,uploads,visibleMeasurements:'not-recorded'};
}
