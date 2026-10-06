import {expect,it} from 'vitest';
import {Player} from '@pixoo/playback';
import {FakeDeviceAdapter} from '../../packages/device/src/index.js';
import {MonitorPresentation} from '../../apps/server/src/monitor-presentation.js';
import {renderNowPlaying,type NowPlayingView} from '../../apps/server/src/now-playing.js';
import type {PlaybackSourceStatus} from '../../apps/server/src/now-playing-source.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {syntheticDashboardViews} from '../../apps/server/src/dashboard-examples.js';

type Media='off'|'popup'|'whole';
const views=syntheticDashboardViews(),attentionView=views[0]!.view,quietView=views[3]!.view;
const playing=(title='HARVEST MOON',patch:Partial<Extract<NowPlayingView,{card:true}>>={}):PlaybackSourceStatus=>({source:'current',view:{card:true,status:'playing',title,artist:'NEIL YOUNG',stale:false,...patch}});
const nothing:PlaybackSourceStatus={source:'current',view:{card:false}};
async function flush(clock:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock.advance(0);}}

async function setup(media:Media='off'){
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 store.playlist.repeat=true;
 const saved:unknown[]=[];
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),nowPlaying:{version:1,media},saveNowPlaying:async value=>{saved.push(value);}});
 const frames=()=>device.effects.filter(e=>e.kind==='frame').map(e=>Array.from(e.frame.rgb));
 const card=(status:PlaybackSourceStatus)=>Array.from(renderNowPlaying(status.view));
 const dashboard=()=>monitor.rendition().rendition!.frames.at(-1)!;
 /** Advance in 100 ms ticks, as the backend's render timer does. */
 const run=async(ms:number)=>{for(let t=0;t<ms;t+=100){clock.advance(100);monitor.tick();await flush(clock);}};
 /** Let the fake device's scheduled work complete while a player operation settles. */
 const settle=async(operation:Promise<unknown>)=>{await flush(clock);await operation;await flush(clock);};
 const close=async()=>{await monitor.close();await player.close();};
 return {clock,store,device,player,monitor,saved,frames,card,dashboard,run,settle,close};
}
async function monitorMode(s:Awaited<ReturnType<typeof setup>>,view=quietView){
 s.monitor.submit(view);await flush(s.clock);await s.monitor.configure({operation:'mode',mode:'monitor'});await s.run(1100);
 expect(s.frames().at(-1)).toEqual(s.dashboard());
}

it('pops the card up for 10 seconds on a new track in Monitor, then returns to the dashboard',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);
  s.monitor.submitPlayback(playing());await s.run(1000);
  expect(s.frames().at(-1)).toEqual(s.card(playing()));expect(s.monitor.nowPlayingStatus()).toMatchObject({showing:'card',takeover:null});
  await s.run(8000);expect(s.frames().at(-1)).toEqual(s.card(playing()));
  await s.run(2000);expect(s.frames().at(-1)).toEqual(s.dashboard());expect(s.monitor.nowPlayingStatus().showing).toBe('dashboard');
  s.monitor.submitPlayback(playing());await s.run(2000);expect(s.frames().at(-1)).toEqual(s.dashboard());
  s.monitor.submitPlayback(playing('OLD KING'));await s.run(1000);expect(s.frames().at(-1)).toEqual(s.card(playing('OLD KING')));
 }finally{await s.close();}
});
it('redraws a pop-up that pauses or goes stale, and ends it when the card disappears',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);s.monitor.submitPlayback(playing());await s.run(1000);
  const paused=playing('HARVEST MOON',{status:'paused'});s.monitor.submitPlayback(paused);await s.run(1000);expect(s.frames().at(-1)).toEqual(s.card(paused));
  const stale=playing('HARVEST MOON',{status:'paused',stale:true});s.monitor.submitPlayback(stale);await s.run(1000);expect(s.frames().at(-1)).toEqual(s.card(stale));
  s.monitor.submitPlayback(nothing);await s.run(1000);expect(s.frames().at(-1)).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('drops the pop-up for attention, present or arriving, without replaying it',async()=>{
 const s=await setup();
 try{
  await monitorMode(s,attentionView);const before=s.frames().length;
  s.monitor.submitPlayback(playing());await s.run(3000);
  expect(s.frames().slice(before).some(frame=>JSON.stringify(frame)===JSON.stringify(s.card(playing())))).toBe(false);
  s.monitor.submit(quietView);await s.run(1100);expect(s.frames().at(-1)).toEqual(s.dashboard());
  s.monitor.submitPlayback(playing('OLD KING'));await s.run(1000);expect(s.frames().at(-1)).toEqual(s.card(playing('OLD KING')));
  s.monitor.submit(attentionView);await s.run(1100);expect(s.frames().at(-1)).toEqual(s.dashboard());
  const cut=s.frames().length;s.monitor.submit(quietView);await s.run(12000);
  expect(s.frames().slice(cut).some(frame=>JSON.stringify(frame)===JSON.stringify(s.card(playing('OLD KING'))))).toBe(false);
  expect(s.frames().at(-1)).toEqual(s.dashboard());
 }finally{await s.close();}
});
it('never starts a pop-up from a stale read or from the same track after a hub hiccup',async()=>{
 const s=await setup();
 try{
  s.monitor.submitPlayback(playing());await monitorMode(s);const count=s.frames().length;
  s.monitor.submitPlayback(playing('HARVEST MOON',{stale:true}));await s.run(1000);
  s.monitor.submitPlayback(playing());await s.run(1000);
  s.monitor.submitPlayback(playing('OLD KING',{stale:true}));await s.run(1000);
  expect(s.frames().length).toBe(count);
 }finally{await s.close();}
});
it('leaves Media alone when the setting is Off',async()=>{
 const s=await setup('off');
 try{
  await s.settle(s.player.start(s.store.playlist.id));const count=s.frames().length;
  s.monitor.submitPlayback(playing());await s.run(12000);
  expect(s.player.getState().intent).toBe('active');expect(s.monitor.nowPlayingStatus()).toMatchObject({showing:'none',takeover:null,lastTakeover:null});expect(s.frames().slice(count).some(f=>JSON.stringify(f)===JSON.stringify(s.card(playing())))).toBe(false);
 }finally{await s.close();}
});
it('pauses the playlist for a 10 second pop-up in Media, then resumes it',async()=>{
 const s=await setup('popup');
 try{
  await s.settle(s.player.start(s.store.playlist.id));
  s.monitor.submitPlayback(playing());await s.run(1000);
  expect(s.player.getState().intent).toBe('paused');expect(s.frames().at(-1)).toEqual(s.card(playing()));
  expect(s.monitor.nowPlayingStatus()).toMatchObject({showing:'card',takeover:'popup'});
  await s.run(9500);expect(s.player.getState().intent).toBe('active');expect(s.monitor.nowPlayingStatus()).toMatchObject({takeover:null,lastTakeover:'resumed'});
  s.monitor.submitPlayback(playing());await s.run(2000);expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
it('drops a Media takeover without resuming after a manual action, screen-off or a mode change',async()=>{
 for(const act of ['pause','stop','screen','mode'] as const){
  const s=await setup('popup');
  try{
   await s.settle(s.player.start(s.store.playlist.id));s.monitor.submitPlayback(playing());await s.run(1000);
   expect(s.monitor.nowPlayingStatus().takeover).toBe('popup');
   if(act==='pause')await s.settle(s.monitor.media(()=>s.player.pause(),false));
   else if(act==='stop')await s.settle(s.monitor.media(()=>s.player.stop(),false));
   else if(act==='screen'){s.monitor.interrupt();await s.settle(s.player.setScreen(false));}
   else await s.settle(s.monitor.configure({operation:'mode',mode:'monitor'}));
   await flush(s.clock);const generation=s.player.getState().generation;
   await s.run(12000);
   expect(s.monitor.nowPlayingStatus().takeover,act).toBeNull();
   expect(s.player.getState().intent,act).not.toBe('active');
   if(act!=='mode')expect(s.player.getState().generation,act).toBe(generation);
  }finally{await s.close();}
 }
});
it('shows the card for the whole song and resumes when playback stops',async()=>{
 const s=await setup('whole');
 try{
  await s.settle(s.player.start(s.store.playlist.id));
  s.monitor.submitPlayback(playing());await s.run(1000);expect(s.player.getState().intent).toBe('paused');
  await s.run(20000);expect(s.monitor.nowPlayingStatus().takeover).toBe('whole');
  s.monitor.submitPlayback(playing('OLD KING'));await s.run(1000);expect(s.frames().at(-1)).toEqual(s.card(playing('OLD KING')));
  s.monitor.submitPlayback(playing('OLD KING',{stale:true}));await s.run(1000);expect(s.monitor.nowPlayingStatus().takeover).toBe('whole');
  s.monitor.submitPlayback(nothing);await s.run(500);expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
it('does nothing in Media when no playlist is playing or the screen is off',async()=>{
 for(const state of ['idle','paused','screen-off'] as const){
  const s=await setup('popup');
  try{
   if(state!=='idle'){await s.settle(s.player.start(s.store.playlist.id));}
   if(state==='paused')await s.settle(s.player.pause());
   if(state==='screen-off')await s.settle(s.player.setScreen(false));
   const before={...s.player.getState()},uploads=()=>s.device.operations.filter(o=>o.kind==='uploadAnimation'&&JSON.stringify(Array.from((o as {animation?:{frames:{rgb:Uint8Array}[]}}).animation?.frames[0]?.rgb??[]))===JSON.stringify(s.card(playing()))).length;
   s.monitor.submitPlayback(playing());await s.run(12000);
   expect(s.player.getState().generation,state).toBe(before.generation);expect(s.player.getState().intent,state).toBe(before.intent);
   expect(s.frames().some(frame=>JSON.stringify(frame)===JSON.stringify(s.card(playing()))),state).toBe(false);expect(uploads(),state).toBe(0);
  }finally{await s.close();}
 }
});
it('drops the takeover without resuming when the card upload fails',async()=>{
 const s=await setup('popup');
 try{
  await s.settle(s.player.start(s.store.playlist.id));s.device.setOnline(false);
  s.monitor.submitPlayback(playing());await s.run(12000);
  expect(s.monitor.nowPlayingStatus()).toMatchObject({takeover:null,lastTakeover:'dropped'});expect(s.player.getState().intent).not.toBe('active');
 }finally{await s.close();}
});
it('persists a setting change and ends a takeover the new setting no longer wants',async()=>{
 const s=await setup('whole');
 try{
  await s.settle(s.player.start(s.store.playlist.id));s.monitor.submitPlayback(playing());await s.run(1000);
  await s.monitor.setNowPlaying('off');await s.run(500);
  expect(s.saved).toEqual([{version:1,media:'off'}]);expect(s.monitor.nowPlayingStatus()).toMatchObject({setting:{media:'off'},takeover:null});
  expect(s.player.getState().intent).toBe('active');
 }finally{await s.close();}
});
it('lets an explicit resume or start during a takeover win without a second automatic resume',async()=>{
 for(const act of ['resume','start'] as const){
  const s=await setup('popup');
  try{
   await s.settle(s.player.start(s.store.playlist.id));s.monitor.submitPlayback(playing());await s.run(1000);
   expect(s.monitor.nowPlayingStatus().takeover,act).toBe('popup');
   await s.settle(s.monitor.media(()=>act==='resume'?s.player.resume():s.player.start(s.store.playlist.id),true));
   expect(s.monitor.nowPlayingStatus(),act).toMatchObject({takeover:null,lastTakeover:'dropped'});
   // A second automatic resume after the pop-up deadline would record 'resumed'.
   await s.run(12000);expect(s.player.getState().intent,act).toBe('active');
   expect(s.monitor.nowPlayingStatus().lastTakeover,act).toBe('dropped');
  }finally{await s.close();}
 }
});
it('drops an active takeover without resuming when the presentation closes',async()=>{
 const s=await setup('whole');
 try{
  await s.settle(s.player.start(s.store.playlist.id));s.monitor.submitPlayback(playing());await s.run(1000);
  expect(s.monitor.nowPlayingStatus().takeover).toBe('whole');const generation=s.player.getState().generation;
  await s.monitor.close();await flush(s.clock);s.clock.advance(20000);await flush(s.clock);
  expect(s.player.getState()).toMatchObject({intent:'paused',generation});expect(s.monitor.nowPlayingStatus().takeover).toBeNull();
 }finally{await s.player.close();}
});
it('uploads a repeated identical card once, and a changed card once more',async()=>{
 const s=await setup();
 try{
  await monitorMode(s);const card=JSON.stringify(s.card(playing()));const cards=()=>s.frames().filter(frame=>JSON.stringify(frame)===card).length;
  s.monitor.submitPlayback(playing());await s.run(1000);
  for(let i=0;i<4;i++){s.monitor.submitPlayback(playing());await s.run(1000);}
  expect(cards()).toBe(1);
  const paused=playing('HARVEST MOON',{status:'paused'});s.monitor.submitPlayback(paused);await s.run(1000);s.monitor.submitPlayback(paused);await s.run(1000);
  expect(s.frames().filter(frame=>JSON.stringify(frame)===JSON.stringify(s.card(paused))).length).toBe(1);
 }finally{await s.close();}
});
