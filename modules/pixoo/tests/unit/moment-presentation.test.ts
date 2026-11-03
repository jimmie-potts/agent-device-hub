// Hub #1287: a moment plays over the current base and gives it back, under the takeover's resume guard over Media.
import {expect,it,vi} from 'vitest';
import {present} from '../helpers/present.js';
import {Player} from '../../src/playback/index.js';
import {FakeDeviceAdapter} from '../../src/device/index.js';
import {PixooControl} from '../../src/module/control.js';
import {MonitorPresentation,type MomentPlay,type MomentResult} from '../../src/presentation/monitor-presentation.js';
import {MOMENT_MOODS,momentContent,renderMomentContent} from '../../src/presentation/moment-content.js';
import {renderNowPlaying} from '../../src/presentation/now-playing.js';
import type {PlaybackSourceStatus} from '../../src/presentation/sources.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {syntheticDashboardViews} from '../../src/presentation/dashboard-examples.js';

const views=syntheticDashboardViews(),attentionView=present(views[0]).view,quietView=present(views[3]).view;
const RGB=(value:number)=>new Uint8Array(12288).fill(value);
const song:PlaybackSourceStatus={source:'current',view:{card:true,status:'playing',title:'HARVEST MOON',artist:'NEIL YOUNG',stale:false}};
async function flush(clock:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock.advance(0);}}

async function setup(options:{media?:'off'|'popup'|'whole';overMonitor?:boolean;pauseOnUncertain?:boolean}={}){
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock,pauseOnUncertain:options.pauseOnUncertain??false});
 store.playlist.repeat=true;
 const saved:unknown[]=[];
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),nowPlaying:{version:1,media:options.media??'off'},
  moments:{version:1,overMonitor:options.overMonitor??true},saveMoments:value=>{saved.push(value);return Promise.resolve();}});
 const frames=()=>device.effects.filter(e=>e.kind==='frame').map(e=>Array.from(e.frame.rgb));
 const dashboard=()=>present(present(monitor.rendition().rendition).frames.at(-1));
 const run=async(ms:number)=>{for(let t=0;t<ms;t+=100){clock.advance(100);monitor.tick();await flush(clock);}};
 const settle=async(operation:Promise<unknown>)=>{await flush(clock);await operation;await flush(clock);};
 /** A moment that starts now, showing a flat frame unlike any other picture. */
 const play=(patch:Partial<MomentPlay>={})=>{
  const results:MomentResult[]=[];
  void monitor.playMoment({momentId:'m1',coversStatus:true,durationMs:3000,startAtMs:clock.now(),toleranceMs:10000,frames:()=>Promise.resolve([RGB(7)]),...patch}).then(result=>results.push(result));
  return results;
 };
 const close=async()=>{await monitor.close();await player.close();};
 return {clock,store,device,player,monitor,saved,frames,dashboard,run,settle,play,close};
}
type Setup=Awaited<ReturnType<typeof setup>>;
const art=Array.from(RGB(7)),blank=Array.from(RGB(0));
async function monitorMode(s:Setup,view=quietView){
 s.monitor.submit(view);await flush(s.clock);await s.monitor.configure({operation:'mode',mode:'monitor'});await s.run(1100);
 expect(s.frames().at(-1)).toEqual(s.dashboard());
}
async function mediaPlaying(s:Setup){
 await s.settle(s.player.start(s.store.playlist.id));await s.run(200);
 expect(s.player.getState()).toMatchObject({intent:'active',state:'playing'});
}
const ended=(results:MomentResult[],ending:string)=>expect(results).toEqual([expect.objectContaining({ending})]);

it('plays over Monitor for its duration, keeps the mode, and returns to the current dashboard',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const before=s.player.getState().generation,results=s.play();
  await s.run(200);
  expect(s.frames().at(-1)).toEqual(art);
  expect(s.monitor.status()).toMatchObject({participating:true,configuration:{mode:'monitor'}});
  expect(s.monitor.nowPlayingSummary().showing).toBe('moment');
  expect(s.monitor.momentSummary()).toEqual({overMonitor:true,playing:'m1'});
  await s.run(2500);expect(s.frames().at(-1)).toEqual(art);expect(results).toEqual([]);
  await s.run(1300);
  ended(results,'completed');
  expect(s.frames().at(-1)).toEqual(s.dashboard());
  expect(s.monitor.status()).toMatchObject({participating:true,lastOutcome:{status:'sent'}});
  expect(s.player.getState().generation).toBe(before);
  expect(s.monitor.momentBusy()).toBe(false);
 }finally{await s.close();}
});
it('returns to what Monitor shows now, not to the picture from before the moment',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);const before=s.dashboard();
  s.play();await s.run(200);
  s.monitor.submit(present(views[1]).view);await s.run(4000);
  expect(s.frames().at(-1)).toEqual(s.dashboard());expect(s.dashboard()).not.toEqual(before);
 }finally{await s.close();}
});
it('does not let a long Monitor cadence hold the moment, or its end, past its time box',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  await s.monitor.configure({operation:'view',filter:{},cadenceMs:10000});await s.run(1100);
  const results=s.play();await s.run(1100);expect(s.frames().at(-1)).toEqual(art);
  await s.run(3200);ended(results,'completed');expect(s.frames().at(-1)).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('attention over Monitor ends the moment at once and it never comes back',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const results=s.play();await s.run(200);expect(s.frames().at(-1)).toEqual(art);
  s.monitor.submit(attentionView);await flush(s.clock);
  ended(results,'preempted');expect(s.monitor.nowPlayingSummary().showing).toBe('dashboard');
  await s.run(1100);
  expect(s.frames().at(-1)).toEqual(s.dashboard());
  const count=s.frames().filter(frame=>frame[0]===7&&frame[1]===7).length;
  s.monitor.submit(quietView);await s.run(6000);
  expect(s.frames().filter(frame=>frame[0]===7&&frame[1]===7).length).toBe(count);
 }finally{await s.close();}
});
it('attention during the moment\'s write lets it finish, keeps Monitor on the display and then shows the dashboard',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:300}),player=await Player.open({store,device,clock,pauseOnUncertain:true});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 const run=async(ms:number)=>{for(let t=0;t<ms;t+=100){clock.advance(100);monitor.tick();await flush(clock);}};
 const shown=()=>device.effects.filter(e=>e.kind==='frame').map(e=>Array.from(e.frame.rgb));
 try{
  monitor.submit(quietView);await flush(clock);await monitor.configure({operation:'mode',mode:'monitor'});await run(2000);
  const results:MomentResult[]=[];
  void monitor.playMoment({momentId:'m1',coversStatus:true,durationMs:3000,startAtMs:clock.now(),toleranceMs:10000,frames:()=>Promise.resolve([RGB(7)])}).then(result=>results.push(result));
  await flush(clock);
  for(let t=0;t<2000&&monitor.momentSummary().playing===null;t+=100){clock.advance(100);monitor.tick();await flush(clock);}
  clock.advance(100);monitor.tick();await flush(clock);
  expect(monitor.momentSummary().playing).toBe('m1');
  monitor.submit(attentionView);await run(2000);
  ended(results,'preempted');
  expect(monitor.status().participating).toBe(true);
  expect(player.getState().lastError).toBeNull();
  expect(shown().at(-1)).toEqual(present(present(monitor.rendition().rendition).frames.at(-1)));
 }finally{await monitor.close();await player.close();}
});
it('over Monitor refuses attention, lost evidence, a moment the hub did not allow, and the setting off',async()=>{
 const s=await setup();
 try{
  await monitorMode(s,attentionView);
  expect(s.monitor.momentBlock(true)).toBe('a session needs attention');
  s.monitor.submit(quietView);await s.run(100);
  expect(s.monitor.momentBlock(true)).toBeNull();
  expect(s.monitor.momentBlock(false)).toBe('this moment may not cover status');
  await s.monitor.setMoments(false);expect(s.saved).toEqual([{version:1,overMonitor:false}]);
  expect(s.monitor.momentBlock(true)).toBe('moments over Monitor are off');
  await s.monitor.setMoments(true);
  s.monitor.submit({...quietView,connection:'stale'});
  expect(s.monitor.momentBlock(true)).toBe('the session source is not current');
 }finally{await s.close();}
});
it('ends the moment when the session source stops being current over Monitor',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const results=s.play();await s.run(200);
  s.monitor.submit({...quietView,connection:'stale'});await flush(s.clock);
  ended(results,'preempted');
 }finally{await s.close();}
});
it('turning the setting off ends the moment over Monitor',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const results=s.play();await s.run(200);
  await s.settle(s.monitor.setMoments(false));
  ended(results,'interrupted');
 }finally{await s.close();}
});
it('over Media pauses the playlist, shows the moment and resumes the same item',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const item=s.player.getState().itemId,results=s.play();
  await s.run(200);
  expect(s.player.getState()).toMatchObject({intent:'paused',itemId:item});
  await s.run(1000);
  expect(s.frames().at(-1)).toEqual(art);
  expect(s.monitor.nowPlayingSummary()).toMatchObject({showing:'moment',takeover:null});
  expect(s.monitor.status().configuration.mode).toBe('media');
  await s.run(3200);
  ended(results,'completed');
  expect(s.player.getState()).toMatchObject({intent:'active',itemId:item});
  expect(s.frames().at(-1)).not.toEqual(art);
  expect(s.monitor.nowPlayingStatus().lastTakeover).toBeNull();
 }finally{await s.close();}
});
it('over Media needs a playlist in play: a paused or stopped player has nothing to give back',async()=>{
 const s=await setup();
 try{
  expect(s.monitor.momentBlock(false)).toBe('no playlist is playing to return to');
  await mediaPlaying(s);
  expect(s.monitor.momentBlock(false)).toBeNull();
  await s.settle(s.player.pause());
  expect(s.monitor.momentBlock(false)).toBe('no playlist is playing to return to');
 }finally{await s.close();}
});
it('attention over Media ends the moment at once and gives the playlist back',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);expect(s.frames().at(-1)).toEqual(art);
  s.monitor.submit(attentionView);await flush(s.clock);await s.run(100);
  ended(results,'preempted');
  expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
for(const [name,act] of [['pause',(s:Setup)=>{s.monitor.interrupt();return s.player.pause();}],['stop',(s:Setup)=>{s.monitor.interrupt();return s.player.stop();}]] as const){
 it(`a manual ${name} during a moment over Media is never resumed over`,async()=>{
  const s=await setup();
  try{
   await mediaPlaying(s);
   const blanks=()=>s.frames().filter(frame=>frame.every(value=>value===0)).length;
   const results=s.play();await s.run(1300);
   const before=blanks();
   await s.settle(act(s));await s.run(4000);
   ended(results,'interrupted');
   expect(s.player.getState().intent).toBe(name==='pause'?'paused':'stopped');
   // The art does not stay on as if it were the owner's choice: one blank write replaces it.
   expect(s.frames().at(-1)).toEqual(blank);
   expect(blanks()).toBe(before+1);
  }finally{await s.close();}
 });
}
it('a new start during a moment over Media takes the display and nothing resumes over it',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);
  const resume=vi.spyOn(s.player,'resume');
  await s.settle(s.monitor.media(()=>s.player.start(s.store.playlist.id),true));await s.run(200);
  ended(results,'interrupted');
  await s.run(4000);
  expect(resume).not.toHaveBeenCalled();
  expect(s.player.getState().intent).toBe('active');
  expect(s.monitor.momentBusy()).toBe(false);
 }finally{await s.close();}
});
it('a mode change ends the moment, and Monitor stays the choice',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);
  s.monitor.submit(quietView);
  await s.settle(s.monitor.configure({operation:'mode',mode:'monitor'}));await s.run(1200);
  ended(results,'interrupted');
  expect(s.player.getState().intent).toBe('paused');
  expect(s.frames().at(-1)).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('a Monitor view change in Media gives the playlist back rather than leaving it paused under the art',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);
  await s.settle(s.monitor.configure({operation:'view',filter:{},cadenceMs:2000}));await s.run(200);
  ended(results,'interrupted');
  expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
it('a Now Playing takeover keeps the display: the moment is refused, and refused again at its start',async()=>{
 const s=await setup({media:'whole'});
 try{
  await mediaPlaying(s);
  const results=s.play({startAtMs:s.clock.now()+500});await flush(s.clock);
  s.monitor.submitPlayback(song);await s.run(100);
  expect(s.monitor.momentBlock(false)).toBe('Now Playing holds the display');
  await s.run(1000);
  expect(results).toEqual([{ending:null,refused:'blocked'}]);
  expect(s.frames().at(-1)).toEqual(Array.from(renderNowPlaying(song.view)));
 }finally{await s.close();}
});
it('a song that wants the whole display during a moment takes over from it with no flash of the playlist',async()=>{
 const s=await setup({media:'whole'});
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);
  const generation=s.player.getState().generation,uploads=s.frames().length;
  s.monitor.submitPlayback(song);await s.run(3000);
  ended(results,'completed');
  expect(s.monitor.nowPlayingSummary().takeover).toBe('whole');
  expect(s.player.getState().generation).toBe(generation);
  expect(s.frames().slice(uploads)).toEqual([Array.from(renderNowPlaying(song.view))]);
  s.monitor.submitPlayback({source:'current',view:{card:false}});await s.run(500);
  expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
it('waits for its start, and a start window it misses ends it with no write and no ending',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const count=s.frames().length;
  const results=s.play({startAtMs:s.clock.now()+2000,toleranceMs:0});await flush(s.clock);
  await s.run(1000);expect(results).toEqual([]);
  s.clock.advance(5000);s.monitor.tick();await flush(s.clock);
  expect(results).toEqual([{ending:null,refused:'expired'}]);
  expect(s.frames().length).toBe(count);
 }finally{await s.close();}
});
/** Holds the player's saves until `release`, as a busy library does. */
function slowSave(s:Setup){
 const save=s.store.save.bind(s.store);let release=()=>{};
 const gate=new Promise<void>(resolve=>{release=resolve;});
 s.store.save=async(...args:Parameters<typeof save>)=>{await gate;return save(...args);};
 return ()=>{s.store.save=save;release();};
}
/** Holds the next capture until `release`, as a busy library does. */
function slowCapture(s:Setup){
 const capture=s.store.capture.bind(s.store);let release=()=>{};
 const gate=new Promise<void>(resolve=>{release=resolve;});
 s.store.capture=async(...args:Parameters<typeof capture>)=>{await gate;return capture(...args);};
 return ()=>{s.store.capture=capture;release();};
}
it('a moment that ends while a manual start captures never cancels the start by resuming',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);
  const release=slowCapture(s),before=s.player.getState().sessionId;
  let failure:unknown;
  const start=s.player.start(s.store.playlist.id).catch((error:unknown)=>{failure=error;});
  await s.run(3200);
  ended(results,'completed');
  expect(s.player.getState().intent).toBe('paused');
  release();await s.settle(start);await s.run(200);
  expect(failure).toBeUndefined();
  expect(s.player.getState().intent).toBe('active');expect(s.player.getState().sessionId).not.toBe(before);
 }finally{await s.close();}
});
it('a moment does not pause over a manual start that is still capturing, so it cannot cancel it',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const release=slowCapture(s),before=s.player.getState().sessionId;
  let failure:unknown;
  const start=s.player.start(s.store.playlist.id).catch((error:unknown)=>{failure=error;});
  await flush(s.clock);
  expect(s.monitor.momentBlock(false)).toBe('a start is pending');
  const results=s.play();await s.run(300);
  expect(results).toEqual([{ending:null,refused:'blocked'}]);
  release();await s.settle(start);await s.run(200);
  expect(failure).toBeUndefined();
  expect(s.player.getState().sessionId).not.toBe(before);
 }finally{await s.close();}
});
it('a mode change queued ahead of the moment\'s hold keeps Monitor on the display',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);s.monitor.submit(quietView);await flush(s.clock);
  const results=s.play();await flush(s.clock);
  // The change is queued but has not begun, so the tick still sees Media and queues its hold behind it.
  const mode=s.monitor.configure({operation:'mode',mode:'monitor'});
  s.clock.advance(100);s.monitor.tick();
  await s.settle(mode);await s.run(1200);
  expect(results).toEqual([{ending:null,refused:'blocked'}]);
  expect(s.monitor.status()).toMatchObject({participating:true,configuration:{mode:'monitor'}});
 }finally{await s.close();}
});
it('a view change right after the moment\'s pause ends it and gives the playlist back',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await flush(s.clock);
  s.clock.advance(100);s.monitor.tick();
  const view=s.monitor.configure({operation:'view',filter:{},cadenceMs:2000});
  await s.settle(view);await s.run(300);
  expect(results).toHaveLength(1);
  expect(s.monitor.momentBusy()).toBe(false);
  expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
it('a moment that misses its window behind another write gives the playlist back with no art',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play({toleranceMs:100});await flush(s.clock);
  s.clock.advance(50);s.monitor.tick();await flush(s.clock);
  expect(s.player.getState().intent).toBe('paused');
  s.clock.advance(5000);s.monitor.tick();await flush(s.clock);await s.run(200);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'expired'})]);
  expect(s.player.getState().intent).toBe('active');expect(s.frames()).not.toContainEqual(art);
 }finally{await s.close();}
});
it('attention during the moment\'s hold never shows it and gives the playlist back',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const release=slowSave(s),results=s.play();await flush(s.clock);
  s.clock.advance(100);s.monitor.tick();await flush(s.clock);
  expect(s.monitor.momentHoldsMedia()).toBe(true);
  s.monitor.submit(attentionView);await flush(s.clock);
  release();await flush(s.clock);await s.run(1500);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'cancelled'})]);
  expect(s.player.getState().intent).toBe('active');expect(s.frames()).not.toContainEqual(art);
 }finally{await s.close();}
});
it('a pause right after next during a moment is never resumed over',async()=>{
 for(const later of ['pause','stop'] as const){
  const s=await setup();
  try{
   await mediaPlaying(s);
   const control=new PixooControl({player:s.player,monitor:s.monitor});
   const results=s.play();await s.run(1300);
   const release=slowSave(s);
   const next=control.control('next');await flush(s.clock);
   const manual=control.control(later);await flush(s.clock);
   release();await s.settle(Promise.all([next,manual]));await s.run(500);
   ended(results,'interrupted');
   expect(s.player.getState().intent).toBe(later==='pause'?'paused':'stopped');
   control.close();
  }finally{await s.close();}
 }
});
it('next during the moment\'s pause keeps the playlist playing',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const control=new PixooControl({player:s.player,monitor:s.monitor});
  const release=slowSave(s),results=s.play();await flush(s.clock);
  s.clock.advance(100);s.monitor.tick();await flush(s.clock);
  const next=control.control('next');await flush(s.clock);
  release();await s.settle(next);await s.run(500);
  expect(results).toEqual([{ending:null,refused:'blocked'}]);
  expect(s.player.getState().intent).toBe('active');
  control.close();
 }finally{await s.close();}
});
it('no blank follows a base write that failed uncertainly, even within one tick of the moment\'s end',async()=>{
 const s=await setup({pauseOnUncertain:true});
 try{
  await monitorMode(s);
  const results=s.play();await s.run(1300);
  s.device.failNextUpload(1);
  s.monitor.submit(attentionView);await s.run(2500);
  ended(results,'preempted');
  expect(s.player.getState().lastError).toMatchObject({priorEffects:'possible'});
  expect(s.frames()).not.toContainEqual(blank);
 }finally{await s.close();}
});
it('drops the blank once the device has been offline: what it shows by then may be the owner\'s',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(1300);
  s.device.setOnline(false);await s.settle(s.player.probe());
  s.monitor.interrupt();await s.settle(s.player.pause());await s.run(1200);
  ended(results,'interrupted');
  s.device.setOnline(true);await s.settle(s.player.probe());await s.run(1200);
  expect(s.frames().at(-1)).toEqual(art);
 }finally{await s.close();}
});
it('a rejected write is unknown, never reported as unsent',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  s.player.uploadDashboard=()=>Promise.reject(new Error('store failed'));
  const results=s.play();await s.run(1300);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'unknown'})]);
 }finally{await s.close();}
});
it('a manual pause over Monitor during a moment clears the art, and choosing Monitor again paints the dashboard',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const results=s.play();await s.run(1300);
  s.monitor.interrupt();await s.settle(s.player.pause());await s.run(1200);
  ended(results,'interrupted');
  expect(s.frames().at(-1)).toEqual(blank);
  await s.monitor.configure({operation:'mode',mode:'monitor'});await s.run(1200);
  expect(s.frames().at(-1)).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('an uncertain write is not rolled back: no blank follows it',async()=>{
 const s=await setup({pauseOnUncertain:true});
 try{
  await monitorMode(s);
  const results=s.play({frames:()=>Promise.resolve([RGB(7),RGB(8)])});
  s.device.failNextUpload(1);await s.run(1300);await s.run(2000);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'upload'})]);
  expect(results[0]).toMatchObject({upload:{ok:false,priorEffects:'possible'}});
  expect(s.frames()).toContainEqual(art);expect(s.frames().at(-1)).toEqual(art);
 }finally{await s.close();}
});
it('a Now Playing pop-up still lasts its full ten seconds from its pause',async()=>{
 const s=await setup({media:'popup'});
 try{
  await mediaPlaying(s);
  // A pause the library holds up for three seconds does not come out of the pop-up.
  const release=slowSave(s);
  s.monitor.submitPlayback(song);await s.run(3000);
  release();await flush(s.clock);
  expect(s.monitor.nowPlayingSummary().takeover).toBe('popup');
  await s.run(9500);
  expect(s.monitor.nowPlayingSummary().takeover).toBe('popup');
  await s.run(800);expect(s.monitor.nowPlayingSummary().takeover).toBeNull();
 }finally{await s.close();}
});
it('a failed render touches neither the player nor the device',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const uploads=s.frames().length,results=s.play({frames:()=>Promise.reject(new Error('no'))});
  await s.run(300);
  expect(results).toEqual([{ending:null,refused:'content'}]);
  expect(s.player.getState().intent).toBe('active');expect(s.frames().length).toBeLessThanOrEqual(uploads+1);
 }finally{await s.close();}
});
it('a failed write over Media leaves no art behind: the playlist comes back and the moment has no ending',async()=>{
 const s=await setup();
 try{
  await mediaPlaying(s);
  const results=s.play();await s.run(200);
  s.device.failNextUpload();
  await s.run(1200);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'upload'})]);
  await s.run(200);
  expect(s.player.getState().intent).toBe('active');
  expect(s.frames()).not.toContainEqual(art);
 }finally{await s.close();}
});
it('an uncertain write over Media pauses as the player does and is never resumed over',async()=>{
 const s=await setup({pauseOnUncertain:true});
 try{
  await mediaPlaying(s);
  const results=s.play({frames:()=>Promise.resolve([RGB(7),RGB(8)])});await s.run(200);
  s.device.failNextUpload(1);
  await s.run(1200);await s.run(4000);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'upload'})]);
  expect(s.player.getState().intent).toBe('paused');
  expect(s.player.getState().lastError).toMatchObject({priorEffects:'possible'});
 }finally{await s.close();}
});
it('a failed write over Monitor stops Monitor as a dashboard failure does',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  const results=s.play();
  s.device.failNextUpload();
  await s.run(1200);
  expect(results).toEqual([expect.objectContaining({ending:null,refused:'upload'})]);
  expect(s.monitor.status()).toMatchObject({participating:false,lastOutcome:{status:'failed',code:'upload-failed'}});
 }finally{await s.close();}
});
it('closing ends a moment without resuming, so a restart replays nothing',async()=>{
 const s=await setup();
 await mediaPlaying(s);
 const results=s.play();await s.run(1300);
 await s.close();await flush(s.clock);
 ended(results,'interrupted');
 expect(s.player.getState().intent).toBe('paused');
});
it('chooses mood content through one seam and draws two complete, distinct frames for each mood',()=>{
 expect(momentContent({mood:'celebrate',palette:['#102030']})).toEqual({kind:'mood',mood:'celebrate',palette:['#102030']});
 expect(momentContent({mood:'celebrate'})).toEqual({kind:'mood',mood:'celebrate'});
 for(const mood of MOMENT_MOODS){
  const [first,second]=renderMomentContent(momentContent({mood}));
  expect(first?.length).toBe(12288);expect(second?.length).toBe(12288);
  expect(first?.some(value=>value!==0)).toBe(true);expect(Array.from(first??[])).not.toEqual(Array.from(second??[]));
 }
 const tinted=renderMomentContent({kind:'mood',mood:'reminder',palette:['#102030']})[0];
 expect(Array.from(tinted??[]).filter(value=>![0,0x10,0x20,0x30].includes(value))).toEqual([]);
});
