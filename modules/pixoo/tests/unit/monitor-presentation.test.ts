// The status base and the playback base (ADR 0014): the status dashboard rests on the display whenever the player holds
// no item, a started item holds the display until it stops, and a Hub mode is policy only.
import {expect,it} from 'vitest';
import {present} from '../helpers/present.js';
import {Player} from '../../src/playback/index.js';
import {FakeDeviceAdapter} from '../../src/device/index.js';
import {MonitorPresentation} from '../../src/presentation/monitor-presentation.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {syntheticDashboardViews} from '../../src/presentation/dashboard-examples.js';
import {renderDashboard} from '../../src/presentation/dashboard-pixels.js';
import {PixooControl} from '../../src/module/control.js';
async function flush(clock:ManualClock){for(let i=0;i<100;i++){await Promise.resolve();clock.advance(0);}}
const uploads=(device:FakeDeviceAdapter)=>device.operations.filter(o=>o.kind==='uploadAnimation').length;
it('rests the status base on the display while the player holds no item, and gives it to a started playlist until it stops',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  const view=present(syntheticDashboardViews()[0]).view;monitor.submit(view);await flush(clock);monitor.tick();await flush(clock);monitor.tick();await flush(clock);
  expect(monitor.status()).toMatchObject({base:'status',participating:true,mode:'free'});expect(player.getState().intent).toBe('stopped');
  const frames=device.effects.filter(e=>e.kind==='frame'),rendition=present(monitor.rendition().rendition);expect(rendition.frames).toHaveLength(2);
  expect(frames.slice(-2).map(e=>e.frame)).toEqual(rendition.frames.map(rgb=>({rgb:new Uint8Array(rgb),delayMs:500})));
  const sent=uploads(device);
  // The device loops the pulse; an unchanged rendition is not uploaded again.
  clock.advance(5000);monitor.tick();await flush(clock);expect(uploads(device)).toBe(sent);
  // A start takes the display; the dashboard stops drawing while the playlist plays.
  await monitor.media(()=>player.start(store.playlist.id),true);await flush(clock);
  expect(monitor.status()).toMatchObject({base:'playback',participating:false});expect(player.getState().intent).toBe('active');
  const playing=uploads(device);clock.advance(11000);monitor.submit(view);await flush(clock);monitor.tick();await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation').slice(playing).every(o=>o.kind==='uploadAnimation')).toBe(true);
  expect(monitor.status().participating).toBe(false);
  // A pause keeps the paused item as the base; a stop gives the display back to the status base, the item kept behind it.
  await monitor.media(()=>player.pause(),false);clock.advance(1000);monitor.tick();await flush(clock);expect(monitor.status()).toMatchObject({base:'playback',participating:false});
  await monitor.media(()=>player.stop(),false);clock.advance(1000);monitor.tick();await flush(clock);monitor.tick();await flush(clock);
  expect(monitor.status()).toMatchObject({base:'status',participating:true});expect(player.getSession()?.playlist.id).toBe(store.playlist.id);
 }finally{await monitor.close();await player.close();}
});
it('takes a Hub mode as policy only: Free and Quiet change nothing, and Work stops a held item with no resume on Free',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const modes:string[]=[];const monitor=new MonitorPresentation(player,{save:async()=>{},saveMode:mode=>{modes.push(mode);return Promise.resolve();},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);monitor.tick();await flush(clock);
  const generation=player.getState().generation;
  for(const mode of ['free','quiet','work'] as const){
   expect(await monitor.setMode(mode)).toEqual({stopped:false});expect(monitor.status()).toMatchObject({mode,pendingMode:null,base:'status'});
  }
  expect(player.getState()).toMatchObject({intent:'stopped',generation});expect(modes).toEqual(['free','quiet','work']);
  await monitor.setMode('free');await monitor.media(()=>player.start(store.playlist.id),true);await flush(clock);expect(player.getState().intent).toBe('active');
  expect(await monitor.setMode('quiet')).toEqual({stopped:false});expect(player.getState().intent).toBe('active');
  expect(await monitor.setMode('work')).toEqual({stopped:true});
  expect(player.getState().intent).toBe('stopped');expect(player.getSession()?.playlist.id).toBe(store.playlist.id);
  monitor.tick();await flush(clock);expect(monitor.status()).toMatchObject({base:'status',participating:true});
  await monitor.setMode('free');clock.advance(5000);monitor.tick();await flush(clock);expect(player.getState().intent).toBe('stopped');
  // A paused item is held as well, and Work stops it too.
  await monitor.media(()=>player.resume(),true);await flush(clock);await monitor.media(()=>player.pause(),false);
  expect(await monitor.setMode('work')).toEqual({stopped:true});expect(player.getState().intent).toBe('stopped');
 }finally{await monitor.close();await player.close();}
});
it('bounds bursts by latest rendition and cadence without submitting missed pages',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:100});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),renderCadenceMs:1});
 try{
  // One-frame pictures keep the fake's per-frame latency to one 100 ms step per upload.
  const view=present(syntheticDashboardViews()[0]).view;for(const session of present(view.snapshot).sessions)session.attention=[];
  monitor.submit(view);await flush(clock);monitor.tick();
  // Every session is relabelled, so the one on the shown page changes its picture too: the same picture is not sent again (Hub #1757).
  for(let i=0;i<20;i++){present(view.snapshot).revision++;for(const session of present(view.snapshot).sessions)session.label=`Burst ${i}`;monitor.submit(view);await flush(clock);}
  expect(monitor.status().inFlight).toBe(1);clock.advance(100);await flush(clock);monitor.tick();await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  clock.advance(900);monitor.tick();await flush(clock);monitor.tick();clock.advance(100);await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(2);
  expect(device.effects.filter(e=>e.kind==='frame').at(-1)?.frame.rgb).toEqual(new Uint8Array(present(present(monitor.rendition().rendition).frames.at(-1))));
  expect(device.operations.filter(o=>o.kind==='uploadAnimation').map(o=>o.timing.submittedAtMs)).toEqual([0,1000]);
 }finally{await monitor.close();await player.close();}
});
it('holds the status base after a failed write and draws it again only after a command asks for it',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);device.setOnline(false);
  monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(false);expect(monitor.status().lastOutcome?.status).toBe('failed');
  device.setOnline(true);clock.advance(30000);monitor.tick();await flush(clock);monitor.tick();await flush(clock);expect(uploads(device)).toBe(1);
  // Any mode command, even the one already in force, lets it draw again.
  await monitor.setMode('free');monitor.tick();await flush(clock);monitor.tick();await flush(clock);expect(monitor.status().participating).toBe(true);
  expect(uploads(device)).toBe(2);
 }finally{await monitor.close();await player.close();}
});
it('a failed status write while the device is offline is released once the device answers again',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);device.setOnline(false);
  monitor.tick();await flush(clock);
  expect(monitor.status()).toMatchObject({participating:false,lastOutcome:{status:'failed'}});expect(player.getState().availability).toBe('offline');
  device.setOnline(true);clock.advance(30000);monitor.tick();await flush(clock);expect(uploads(device)).toBe(1);
  // The device answers a probe again: no command is needed for the status base to return.
  const probe=player.probe();await flush(clock);await probe;monitor.tick();await flush(clock);monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(true);expect(uploads(device)).toBe(2);
 }finally{await monitor.close();await player.close();}
});
it('external control holds the status base until a command, so it never paints over what may be the owner\'s',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);monitor.tick();await flush(clock);
  const sent=uploads(device);
  await player.takeover();await flush(clock);for(let i=0;i<5;i++){clock.advance(1000);monitor.tick();await flush(clock);}
  expect(monitor.status().participating).toBe(false);expect(uploads(device)).toBe(sent);
  await monitor.setMode('free');monitor.tick();await flush(clock);monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(true);expect(uploads(device)).toBe(sent+1);
 }finally{await monitor.close();await player.close();}
});
it('waits, at a passive start, for a command before it first draws the status base',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),passive:true,mode:'quiet'});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);for(let i=0;i<5;i++){clock.advance(1000);monitor.tick();await flush(clock);}
  expect(monitor.status()).toMatchObject({mode:'quiet',base:'status',participating:false});expect(device.effects).toHaveLength(0);
  // A view change does not end the wait; a mode command does.
  await monitor.configure({operation:'view',filter:{},cadenceMs:1000});monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(false);expect(device.effects).toHaveLength(0);
  await monitor.setMode('quiet');monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(true);expect(uploads(device)).toBe(1);
 }finally{await monitor.close();await player.close();}
});
it('a mode whose save fails changes nothing, and a screen-off keeps the status base from drawing',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},saveMode:()=>Promise.reject(new Error('disk')),clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);
  await expect(monitor.setMode('work')).rejects.toThrow();expect(monitor.status()).toMatchObject({mode:'free',pendingMode:null});
  const frames=device.effects.filter(e=>e.kind==='frame').length;
  const off=player.setScreen(false);await flush(clock);await off;clock.advance(2000);monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(false);expect(device.effects.filter(e=>e.kind==='frame')).toHaveLength(frames);
  const on=player.setScreen(true);await flush(clock);await on;clock.advance(2000);monitor.tick();await flush(clock);monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(true);
 }finally{await monitor.close();await player.close();}
});
it('a late retired upload cannot reclaim the display from a started playlist or change its context',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock,latencyMs:100}),store=new MemoryPlaybackStore(),player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);monitor.tick();
  await monitor.media(()=>player.start(store.playlist.id),true);clock.advance(100);await flush(clock);clock.advance(100);await flush(clock);
  expect(monitor.status()).toMatchObject({base:'playback',participating:false});
  const count=uploads(device);clock.advance(1000);monitor.tick();await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation').length-count).toBeLessThanOrEqual(1);expect(player.getSession()?.playlist.id).toBe(store.playlist.id);
  expect(monitor.status().participating).toBe(false);
 }finally{await monitor.close();await player.close();}
});
it('keeps a playlist playing while the view and attention change',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),store=new MemoryPlaybackStore(),player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  await monitor.media(()=>player.start(store.playlist.id),true);await flush(clock);const generation=player.getState().generation;
  await monitor.configure({operation:'view',filter:{provider:'codex'},cadenceMs:2000});
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);monitor.tick();await flush(clock);
  expect(player.getState()).toMatchObject({intent:'active',generation});expect(monitor.status()).toMatchObject({participating:false,base:'playback'});
 }finally{await monitor.close();await player.close();}
});
it('holds the sole HTTP writer through an uncertain status picture without replay',async()=>{
 const {HttpDeviceAdapter,SPIKE_PROFILE}=await import('../../src/device/http-adapter.js');
 const commands:string[]=[];let release:(value:Record<string,unknown>)=>void=()=>{};
 const device=new HttpDeviceAdapter({ip:'192.168.1.2',profile:SPIKE_PROFILE},async body=>{
  commands.push(String(body.Command));if(body.Command==='Draw/GetHttpGifId')return {error_code:0,PicId:1};
  if(body.Command==='Draw/SendHttpGif')return new Promise<Record<string,unknown>>(resolve=>{release=resolve;});
  return {error_code:0};
 });
 const player=await Player.open({store:new MemoryPlaybackStore(),device});const monitor=new MonitorPresentation(player,{save:async()=>{}});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);for(let i=0;i<100;i++)await Promise.resolve();monitor.tick();
  for(let i=0;i<100;i++)await Promise.resolve();expect(commands).toEqual(['Draw/GetHttpGifId','Draw/SendHttpGif']);
  const off=player.setScreen(false);
  for(let i=0;i<100;i++)await Promise.resolve();expect(commands).toHaveLength(2);
  release({error_code:0});await off;for(let i=0;i<100;i++)await Promise.resolve();monitor.tick();
  expect(commands).toEqual(['Draw/GetHttpGifId','Draw/SendHttpGif','Channel/OnOffScreen']);
  expect(monitor.status()).toMatchObject({participating:false});
 }finally{release({error_code:0});await monitor.close();await player.close();await device.close();}
});
it('a stop while a start waits behind a view change cancels the deferred start',async()=>{
 const player=await Player.open({store:new MemoryPlaybackStore(),device:new FakeDeviceAdapter()});let release=()=>{};
 const monitor=new MonitorPresentation(player,{save:()=>new Promise<void>(resolve=>{release=resolve;})});
 try{
  const view=monitor.configure({operation:'view',filter:{},cadenceMs:1000});
  let started=false;const media=monitor.media(()=>{started=true;return Promise.resolve();},true).then(()=>null,(error:unknown)=>(error as {code?:unknown}).code);
  for(let i=0;i<100;i++)await Promise.resolve();
  await monitor.media(()=>player.stop(),false);
  release();await view;
  expect(await media).toBe('cancelled');expect(started).toBe(false);
 }finally{release();await monitor.close();await player.close();}
});
// Restored from divoom-app-upgrade@0777479 tests/unit/monitor-presentation.test.ts, where these cases drove
// ControlService; the module's command handling (PixooControl) replaces it and must make the same promise (Hub #843).
it.each(['stop','pause','clear','work'] as const)('immediately cancels a pending playback selection on %s',async command=>{
 const store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter(),player=await Player.open({store,device});
 const monitor=new MonitorPresentation(player,{save:async()=>{}}),control=new PixooControl({player,monitor});
 const capture=store.capture.bind(store);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 store.capture=async(...args)=>{await gate;return capture(...args);};
 try{
  const starting=control.start(store.playlist.id);
  for(let i=0;i<100;i++)await Promise.resolve();const stopping=command==='work'?control.mode('work'):control.control(command);for(let i=0;i<100;i++)await Promise.resolve();
  release();expect(await starting).toMatchObject({result:'failed',evidence:'none',error:{code:'cancelled'}});
  expect(await stopping).toEqual({result:'succeeded',evidence:'observed'});for(let i=0;i<100;i++)await Promise.resolve();
  expect(player.getSession()).toBeNull();expect(device.operations.filter(x=>x.kind==='uploadAnimation')).toHaveLength(0);
 }finally{release();control.close();await monitor.close();await player.close();}
});
it('renders the dashboard only while the status base is drawn, though its layout stays current',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 let renders=0;
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),renderDashboard:layout=>{renders++;return renderDashboard(layout);}});
 try{
  store.playlist.repeat=true;await monitor.media(()=>player.start(store.playlist.id),true);await flush(clock);
  const view=present(syntheticDashboardViews()[0]).view;
  // While a playlist plays, a session's every change updates the layout and renders nothing.
  for(let i=0;i<5;i++){present(view.snapshot).revision++;present(present(view.snapshot).sessions[0]).label=`Playing ${i}`;monitor.submit(view);clock.advance(1000);monitor.tick();await flush(clock);}
  expect(renders).toBe(0);expect(monitor.layout()?.rows[0]?.label).toBe('Playing 4');
  // Once the playlist stops, the status base renders the current layout at once, and its upload follows on the next tick.
  await monitor.media(()=>player.stop(),false);monitor.tick();await flush(clock);expect(renders).toBe(1);
  monitor.tick();await flush(clock);expect(device.operations.filter(o=>o.kind==='uploadAnimation').at(-1)?.kind).toBe('uploadAnimation');
  present(view.snapshot).revision++;present(present(view.snapshot).sessions[0]).label='Status';monitor.submit(view);clock.advance(1000);monitor.tick();await flush(clock);
  expect(renders).toBe(2);
 }finally{await monitor.close();await player.close();}
});
it('reports a change only when something it shows changed, not at every tick',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  // One session, so the dashboard has one page and never pages on its own.
  const view=present(syntheticDashboardViews()[0]).view;present(view.snapshot).sessions.splice(1);monitor.submit(view);
  for(let i=0;i<30;i++){clock.advance(100);monitor.tick();await flush(clock);}
  let changes=0;monitor.onChange=()=>{changes++;};
  // Steady: the picture is on the device and nothing changes, so a hundred ticks report nothing.
  for(let i=0;i<100;i++){clock.advance(100);monitor.tick();await flush(clock);}
  expect(changes).toBe(0);
  present(present(view.snapshot).sessions[0]).label='Changed';present(view.snapshot).revision++;monitor.submit(view);
  for(let i=0;i<20;i++){clock.advance(100);monitor.tick();await flush(clock);}
  expect(changes).toBeGreaterThan(0);
 }finally{await monitor.close();await player.close();}
});
it('keeps the status picture on the display, and does not send it again, while a session changes only its observation times (Hub #1757)',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  // One session, so the dashboard has one page and never pages on its own.
  const view=present(syntheticDashboardViews()[0]).view;present(view.snapshot).sessions.splice(1);monitor.submit(view);
  for(let i=0;i<30;i++){clock.advance(100);monitor.tick();await flush(clock);}
  expect([monitor.status().participating,monitor.nowPlayingSummary().showing]).toEqual([true,'dashboard']);
  const sent=uploads(device),generation=monitor.status().renditionGeneration;
  for(let update=0;update<5;update++){
   const session=present(present(view.snapshot).sessions[0]);
   session.observedAtMs+=1000;session.lastEvidenceAtMs+=1000;present(view.snapshot).revision++;monitor.submit(view);
   // The new layout renders after this turn: until then the picture already on the display stays the status base's.
   expect([monitor.status().participating,monitor.nowPlayingSummary().showing]).toEqual([true,'dashboard']);
   for(let i=0;i<20;i++){clock.advance(100);monitor.tick();await flush(clock);}
   expect([monitor.status().participating,monitor.nowPlayingSummary().showing]).toEqual([true,'dashboard']);
  }
  expect(uploads(device)).toBe(sent);expect(monitor.status().renditionGeneration).toBe(generation);
  // A change the picture shows is still drawn and sent.
  present(present(view.snapshot).sessions[0]).label='Changed';present(view.snapshot).revision++;monitor.submit(view);
  for(let i=0;i<20;i++){clock.advance(100);monitor.tick();await flush(clock);}
  expect(uploads(device)).toBe(sent+1);
 }finally{await monitor.close();await player.close();}
});
