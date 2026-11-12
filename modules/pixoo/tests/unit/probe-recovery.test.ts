// Hub #1765: a probe that fails with any code and then answers again may follow a restart of the Pixoo that never left
// availability `available`. The status base then sends its current picture once again, and only its own picture.
import {expect,it} from 'vitest';
import {present} from '../helpers/present.js';
import {Player} from '../../src/playback/index.js';
import {FakeDeviceAdapter} from '../../src/device/index.js';
import type {FailureCode,OperationOptions,OperationResult,ProbeResult} from '../../src/device/contracts.js';
import {MonitorPresentation,type MomentResult} from '../../src/presentation/monitor-presentation.js';
import {renderDashboard} from '../../src/presentation/dashboard-pixels.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {syntheticDashboardViews} from '../../src/presentation/dashboard-examples.js';

/** The fake device, whose next probes can answer with a failure instead, as a Pixoo's device error or bad answer would. */
class ProbeFailures extends FakeDeviceAdapter {
 readonly failures:FailureCode[]=[];
 override probe(options:OperationOptions):Promise<OperationResult<ProbeResult>>{
  const code=this.failures.shift();
  if(code===undefined)return super.probe(options);
  const atMs=this.clock_.now();
  return Promise.resolve({ok:false,code,priorEffects:'none',generation:options.generation,timing:{submittedAtMs:atMs,startedAtMs:atMs,completedAtMs:atMs,queueMs:0,serviceMs:0}});
 }
 constructor(private readonly clock_:ManualClock){super({clock:clock_});}
}
async function flush(clock:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock.advance(0);}}
const uploads=(device:FakeDeviceAdapter)=>device.operations.filter(o=>o.kind==='uploadAnimation').length;

async function setup(){
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new ProbeFailures(clock);const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 // One session, so the dashboard has one page and never pages on its own, and no attention, so a moment may play.
 const view=present(syntheticDashboardViews()[0]).view;present(view.snapshot).sessions.splice(1);present(present(view.snapshot).sessions[0]).attention=[];
 const run=async(ms:number)=>{for(let t=0;t<ms;t+=100){clock.advance(100);monitor.tick();await flush(clock);}};
 const probe=async(...codes:FailureCode[])=>{device.failures.push(...codes);for(let i=0;i<=codes.length;i++){const pending=player.probe();await flush(clock);await pending;}await run(2000);};
 /** A session update that moves only its observation times, so the picture stays the same. */
 const observe=async()=>{
  const session=present(present(view.snapshot).sessions[0]);session.observedAtMs+=1000;session.lastEvidenceAtMs+=1000;present(view.snapshot).revision++;
  monitor.submit(view);await run(2000);
 };
 const close=async()=>{await monitor.close();await player.close();};
 return {clock,store,device,player,monitor,view,run,probe,observe,close};
}
type Setup=Awaited<ReturnType<typeof setup>>;
async function drawn(s:Setup){
 s.monitor.submit(s.view);await s.run(3000);
 expect([s.monitor.status().participating,s.monitor.nowPlayingSummary().showing]).toEqual([true,'dashboard']);
}
const lastFrame=(s:Setup)=>s.device.effects.filter(e=>e.kind==='frame').at(-1)?.frame.rgb;
const dashboardPixels=(s:Setup)=>new Uint8Array(present(present(s.monitor.rendition().rendition).frames.at(-1)));

for(const code of ['device-error','protocol-error','invalid-input'] as const){
 it(`sends the status picture once after a probe that failed with ${code} answers again, and not for later observation-only updates`,async()=>{
  const s=await setup();
  try{
   await drawn(s);const sent=uploads(s.device);
   await s.probe(code);
   expect(s.player.getState().availability).toBe('available');
   expect(uploads(s.device)).toBe(sent+1);expect(lastFrame(s)).toEqual(dashboardPixels(s));
   await s.observe();await s.observe();await s.probe();
   expect(uploads(s.device)).toBe(sent+1);
   expect([s.monitor.status().participating,s.monitor.nowPlayingSummary().showing]).toEqual([true,'dashboard']);
  }finally{await s.close();}
 });
}
it('sends the status picture once after several failed probes in a row, whatever their codes',async()=>{
 const s=await setup();
 try{
  await drawn(s);const sent=uploads(s.device);
  await s.probe('device-error','protocol-error','device-error');
  expect(uploads(s.device)).toBe(sent+1);
 }finally{await s.close();}
});
it('sends nothing in steady state: probes that answer, and a first probe at the start',async()=>{
 const s=await setup();
 try{
  await drawn(s);const sent=uploads(s.device);
  for(let i=0;i<5;i++)await s.probe();
  await s.observe();
  expect(uploads(s.device)).toBe(sent);expect(s.player.probeRecoveries()).toBe(0);
 }finally{await s.close();}
});
it('keeps a cancelled or stale-generation probe meaning external control, and sends no dashboard picture over it',async()=>{
 for(const code of ['cancelled','stale-generation'] as const){
  const s=await setup();
  try{
   await drawn(s);const sent=uploads(s.device);
   await s.probe(code);
   expect(s.player.getState().lastError?.code).toBe('external-control');
   await s.observe();
   expect(uploads(s.device)).toBe(sent);expect(s.monitor.status().participating).toBe(false);expect(s.player.probeRecoveries()).toBe(0);
  }finally{await s.close();}
 }
});
it('sends no dashboard picture under external control when a failed probe answers again',async()=>{
 const s=await setup();
 try{
  await drawn(s);await s.player.takeover();await flush(s.clock);await s.run(2000);
  const sent=uploads(s.device);
  await s.probe('device-error');await s.observe();
  expect(s.player.probeRecoveries()).toBe(1);expect(uploads(s.device)).toBe(sent);expect(s.monitor.status().participating).toBe(false);
 }finally{await s.close();}
});
it('sends no dashboard picture while Media plays when a failed probe answers again',async()=>{
 const s=await setup();
 try{
  await drawn(s);s.store.playlist.repeat=true;
  await s.monitor.media(()=>s.player.start(s.store.playlist.id),true);await flush(s.clock);await s.run(1000);
  expect(s.monitor.status()).toMatchObject({base:'playback',participating:false});
  const from=s.device.effects.length,dashboard=renderDashboard(present(s.monitor.layout()))[0];
  await s.probe('device-error');await s.observe();
  expect(s.player.probeRecoveries()).toBe(1);
  expect(s.device.effects.slice(from).filter(e=>e.kind==='frame').some(e=>e.frame.rgb.every((value,index)=>value===dashboard?.[index]))).toBe(false);
  expect(s.monitor.status().participating).toBe(false);
 }finally{await s.close();}
});
it('does not send a moment over the status base again when a failed probe answers during it',async()=>{
 const s=await setup();
 try{
  await drawn(s);
  const results:MomentResult[]=[];
  void s.monitor.playMoment({momentId:'m1',coversStatus:true,durationMs:5000,startAtMs:s.clock.now(),toleranceMs:10000,frames:()=>Promise.resolve([new Uint8Array(12288).fill(7)])}).then(result=>results.push(result));
  await s.run(1500);
  expect(s.monitor.nowPlayingSummary().showing).toBe('moment');
  const sent=uploads(s.device);
  await s.probe('device-error');
  expect(uploads(s.device)).toBe(sent);expect(s.monitor.nowPlayingSummary().showing).toBe('moment');
  await s.run(5000);
  expect(results.map(result=>result.ending)).toEqual(['completed']);
 }finally{await s.close();}
});
