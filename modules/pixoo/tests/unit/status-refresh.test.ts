// Hub #1765, the owner's option A: the unchanged status picture is sent once more STATUS_REFRESH_MS after its last
// acknowledged send, so a Pixoo restart no probe sees is repaired, and never over anything that is not the status picture.
import {expect,it} from 'vitest';
import {present} from '../helpers/present.js';
import {Player} from '../../src/playback/index.js';
import {FakeDeviceAdapter} from '../../src/device/index.js';
import {MonitorPresentation,STATUS_REFRESH_MS,type MomentResult} from '../../src/presentation/monitor-presentation.js';
import type {PlaybackSourceStatus} from '../../src/presentation/sources.js';
import {renderDashboard} from '../../src/presentation/dashboard-pixels.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {syntheticDashboardViews} from '../../src/presentation/dashboard-examples.js';

async function flush(clock:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock.advance(0);}}
const song:PlaybackSourceStatus={source:'current',view:{card:true,status:'playing',title:'HARVEST MOON',artist:'NEIL YOUNG',stale:false}};

async function setup(){
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 // One session, so the dashboard has one page and never pages on its own, and no attention, so a moment may play.
 const view=present(syntheticDashboardViews()[0]).view;present(view.snapshot).sessions.splice(1);present(present(view.snapshot).sessions[0]).attention=[];
 const tick=async()=>{monitor.tick();await flush(clock);};
 /** Moves the clock `ms` in steps of `step`, ticking after each, so a deadline on the step grid is met exactly. */
 const run=async(ms:number,step=100)=>{for(let t=0;t<ms;t+=step){clock.advance(Math.min(step,ms-t));await tick();}};
 const uploads=()=>device.operations.filter(o=>o.kind==='uploadAnimation');
 const shown=()=>device.effects.filter(e=>e.kind==='frame').at(-1)?.frame.rgb;
 const dashboard=()=>new Uint8Array(present(present(monitor.rendition().rendition).frames.at(-1)));
 const close=async()=>{await monitor.close();await player.close();};
 return {clock,store,device,player,monitor,view,tick,run,uploads,shown,dashboard,close};
}
type Setup=Awaited<ReturnType<typeof setup>>;
/** Draws the status base and returns the time of its acknowledged send: the fake device answers at once. */
async function drawn(s:Setup):Promise<number>{
 s.monitor.submit(s.view);await flush(s.clock);
 for(let i=0;i<30&&s.uploads().length===0;i++){s.clock.advance(100);await s.tick();}
 const at=s.uploads().at(-1)?.timing.completedAtMs;
 expect(at).toBeDefined();expect(s.shown()).toEqual(s.dashboard());
 return present(at);
}
const status=(s:Setup)=>[s.monitor.status().participating,s.monitor.nowPlayingSummary().showing,s.monitor.status().renditionGeneration];

it('sends nothing for 5 minutes minus 1 ms, then the unchanged status picture exactly once, with no change to what the record reports',async()=>{
 const s=await setup();
 try{
  const sentAt=await drawn(s),sent=s.uploads().length,before=status(s);
  expect(STATUS_REFRESH_MS).toBe(300_000);
  s.clock.advance(sentAt+STATUS_REFRESH_MS-1-s.clock.now());await s.tick();
  expect(s.uploads()).toHaveLength(sent);
  s.clock.advance(1);await s.tick();
  expect(s.uploads()).toHaveLength(sent+1);expect(s.uploads().at(-1)?.timing.submittedAtMs).toBe(sentAt+STATUS_REFRESH_MS);
  expect(s.shown()).toEqual(s.dashboard());
  await s.run(1000);
  expect(s.uploads()).toHaveLength(sent+1);expect(status(s)).toEqual(before);
 }finally{await s.close();}
});
it('counts from the last send of a changed picture, not from the one before it',async()=>{
 const s=await setup();
 try{
  await drawn(s);
  await s.run(3*60_000,1000);
  present(present(s.view.snapshot).sessions[0]).label='Changed';present(s.view.snapshot).revision++;s.monitor.submit(s.view);await flush(s.clock);
  await s.run(2000);
  const changed=present(s.uploads().at(-1)).timing.completedAtMs,sent=s.uploads().length;
  // Five minutes after the first picture passes with nothing sent: the changed picture was sent two minutes into them.
  await s.run(changed+STATUS_REFRESH_MS-1-s.clock.now(),1000);
  expect(s.uploads()).toHaveLength(sent);
  s.clock.advance(1);await s.tick();
  expect(s.uploads()).toHaveLength(sent+1);expect(s.shown()).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('sends the unchanged picture 12 times in an hour of steady state: at 5, 10, ... and 60 minutes after its first send',async()=>{
 const s=await setup();
 try{
  const sentAt=await drawn(s),sent=s.uploads().length;
  s.clock.advance(sentAt-s.clock.now());
  await s.run(60*60_000,1000);
  const refreshes=s.uploads().slice(sent);
  expect(refreshes).toHaveLength(12);
  expect(refreshes.map(o=>o.timing.submittedAtMs-sentAt)).toEqual(Array.from({length:12},(_,i)=>(i+1)*STATUS_REFRESH_MS));
 }finally{await s.close();}
});
it('repairs a restart no probe sees at the next refresh',async()=>{
 const s=await setup();
 try{
  const sentAt=await drawn(s);
  // The Pixoo restarts and shows its own picture; every probe still answers.
  const own=new Uint8Array(12288).fill(9);
  const replaced=s.device.uploadAnimation({frames:[{rgb:own,delayMs:500}]},{generation:s.device.generation});await flush(s.clock);await replaced;
  for(let i=0;i<3;i++){const probe=s.player.probe();await flush(s.clock);await probe;}
  expect(s.shown()).toEqual(own);expect(s.player.probeRecoveries()).toBe(0);
  await s.run(sentAt+STATUS_REFRESH_MS-s.clock.now(),1000);
  expect(s.shown()).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('sends no refresh under external control',async()=>{
 const s=await setup();
 try{
  await drawn(s);await s.player.takeover();await flush(s.clock);
  const sent=s.uploads().length;
  await s.run(3*STATUS_REFRESH_MS,1000);
  expect(s.uploads()).toHaveLength(sent);expect(s.monitor.status().participating).toBe(false);
 }finally{await s.close();}
});
it('sends no status picture while Media plays',async()=>{
 const s=await setup();
 try{
  await drawn(s);const dashboard=renderDashboard(present(s.monitor.layout()))[0];
  s.store.playlist.repeat=true;await s.monitor.media(()=>s.player.start(s.store.playlist.id),true);await flush(s.clock);
  const from=s.device.effects.length;
  await s.run(3*STATUS_REFRESH_MS,1000);
  expect(s.device.effects.slice(from).filter(e=>e.kind==='frame').some(e=>e.frame.rgb.every((value,index)=>value===dashboard?.[index]))).toBe(false);
  expect(s.monitor.status()).toMatchObject({base:'playback',participating:false});
 }finally{await s.close();}
});
it('does not refresh during a moment or extend it, and counts the next refresh from the status picture sent after it',async()=>{
 const s=await setup();
 try{
  const sentAt=await drawn(s);
  s.clock.advance(sentAt+STATUS_REFRESH_MS-2000-s.clock.now());await s.tick();
  const results:MomentResult[]=[];
  void s.monitor.playMoment({momentId:'m1',coversStatus:true,durationMs:5000,startAtMs:s.clock.now(),toleranceMs:10000,frames:()=>Promise.resolve([new Uint8Array(12288).fill(7)])}).then(result=>results.push(result));
  await s.run(1000);
  expect(s.monitor.nowPlayingSummary().showing).toBe('moment');
  const momentAt=present(s.uploads().at(-1)).timing.completedAtMs,during=s.uploads().length;
  await s.run(momentAt+5000-1-s.clock.now(),100);
  expect(s.uploads()).toHaveLength(during);expect(results).toEqual([]);
  await s.run(2000);
  expect(results.map(result=>result.ending)).toEqual(['completed']);
  expect(s.uploads()).toHaveLength(during+1);expect(s.shown()).toEqual(s.dashboard());
  const back=present(s.uploads().at(-1)).timing.completedAtMs;
  expect(back).toBeGreaterThanOrEqual(momentAt+5000);
  await s.run(back+STATUS_REFRESH_MS-1-s.clock.now(),1000);
  expect(s.uploads()).toHaveLength(during+1);
  s.clock.advance(back+STATUS_REFRESH_MS-s.clock.now());await s.tick();
  expect(s.uploads()).toHaveLength(during+2);
 }finally{await s.close();}
});
it('does not refresh during a Now Playing pop-up, and counts the next refresh from the status picture sent after it',async()=>{
 const s=await setup();
 try{
  const sentAt=await drawn(s);
  s.clock.advance(sentAt+STATUS_REFRESH_MS-2000-s.clock.now());await s.tick();
  const popupAt=s.clock.now();s.monitor.submitPlayback(song);await s.run(500);
  expect(s.monitor.nowPlayingSummary().showing).toBe('card');
  const during=s.uploads().length;
  await s.run(popupAt+10_000-100-s.clock.now(),100);
  expect(s.uploads()).toHaveLength(during);
  await s.run(2000);
  expect(s.uploads()).toHaveLength(during+1);expect(s.shown()).toEqual(s.dashboard());
  const back=present(s.uploads().at(-1)).timing.completedAtMs;
  await s.run(back+STATUS_REFRESH_MS-1-s.clock.now(),1000);
  expect(s.uploads()).toHaveLength(during+1);
  s.clock.advance(back+STATUS_REFRESH_MS-s.clock.now());await s.tick();
  expect(s.uploads()).toHaveLength(during+2);
 }finally{await s.close();}
});
it('sends no refresh while a failed write holds the status base, or with the screen off',async()=>{
 const s=await setup();
 try{
  await drawn(s);
  // A failed status write holds the status base until a command asks for it again.
  s.device.setOnline(false);present(present(s.view.snapshot).sessions[0]).label='Failed';present(s.view.snapshot).revision++;s.monitor.submit(s.view);
  await s.run(2000);s.device.setOnline(true);
  expect(s.monitor.status()).toMatchObject({participating:false,lastOutcome:{status:'failed'}});
  const held=s.uploads().length;
  await s.run(2*STATUS_REFRESH_MS,1000);
  expect(s.uploads()).toHaveLength(held);
 }finally{await s.close();}
 const t=await setup();
 try{
  await drawn(t);const off_=t.monitor.media(()=>t.player.setScreen(false),false);await flush(t.clock);await off_;await flush(t.clock);
  const off=t.uploads().length;
  await t.run(2*STATUS_REFRESH_MS,1000);
  expect(t.uploads()).toHaveLength(off);
 }finally{await t.close();}
});
