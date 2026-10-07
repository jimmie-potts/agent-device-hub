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
it('retains paused context and renders only after explicit Monitor activation',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const saved:unknown[]=[];const monitor=new MonitorPresentation(player,{save:value=>{saved.push(value);return Promise.resolve();},clock:()=>clock.now()});
 try{
  const view=present(syntheticDashboardViews()[0]).view;monitor.submit(view);await flush(clock);monitor.tick();await flush(clock);expect(device.effects).toHaveLength(0);
  await player.start(store.playlist.id);await flush(clock);await monitor.configure({operation:'mode',mode:'monitor'});await flush(clock);monitor.tick();await flush(clock);
  expect(player.getState().intent).toBe('paused');expect(monitor.status().participating).toBe(true);
  const frames=device.effects.filter(e=>e.kind==='frame'),rendition=present(monitor.rendition().rendition);expect(rendition.frames).toHaveLength(2);
  expect(frames.slice(-2).map(e=>e.frame)).toEqual(rendition.frames.map(rgb=>({rgb:new Uint8Array(rgb),delayMs:500})));
  const uploads=()=>device.operations.filter(o=>o.kind==='uploadAnimation').length,sent=uploads();
  // The device loops the pulse; an unchanged rendition is not uploaded again.
  clock.advance(5000);monitor.tick();await flush(clock);expect(uploads()).toBe(sent);
  await monitor.configure({operation:'mode',mode:'media'});expect(player.getState().intent).toBe('paused');
  const count=device.effects.length;clock.advance(11000);monitor.submit(view);await flush(clock);monitor.tick();await flush(clock);expect(device.effects).toHaveLength(count);
  expect(saved).toHaveLength(2);
 }finally{await monitor.close();await player.close();}
});
it('bounds bursts by latest rendition and cadence without submitting missed pages',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:100});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),renderCadenceMs:1});
 try{
  // One-frame pictures keep the fake's per-frame latency to one 100 ms step per upload.
  const view=present(syntheticDashboardViews()[0]).view;for(const session of present(view.snapshot).sessions)session.attention=[];
  monitor.submit(view);await flush(clock);await monitor.configure({operation:'mode',mode:'monitor'});monitor.tick();
  for(let i=0;i<20;i++){present(view.snapshot).revision++;present(present(view.snapshot).sessions[0]).label=`Burst ${i}`;monitor.submit(view);await flush(clock);}
  expect(monitor.status().inFlight).toBe(1);clock.advance(100);await flush(clock);monitor.tick();await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  clock.advance(900);monitor.tick();await flush(clock);monitor.tick();clock.advance(100);await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(2);
  expect(device.effects.filter(e=>e.kind==='frame').at(-1)?.frame.rgb).toEqual(new Uint8Array(present(present(monitor.rendition().rendition).frames.at(-1))));
  expect(device.operations.filter(o=>o.kind==='uploadAnimation').map(o=>o.timing.submittedAtMs)).toEqual([0,1000]);
 }finally{await monitor.close();await player.close();}
});
it('suspends after failure and never retries on later ticks without explicit activation',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);device.setOnline(false);
  await monitor.configure({operation:'mode',mode:'monitor'});monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(false);expect(monitor.status().lastOutcome?.status).toBe('failed');
  device.setOnline(true);clock.advance(30000);monitor.tick();await flush(clock);expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  await monitor.configure({operation:'mode',mode:'monitor'});monitor.tick();await flush(clock);monitor.tick();await flush(clock);expect(monitor.status().participating).toBe(true);
 }finally{await monitor.close();await player.close();}
});
it('persistence failure and a concurrent screen-off cannot activate a pending mode',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store:new MemoryPlaybackStore(),device,clock});
 let release=()=>{};const monitor=new MonitorPresentation(player,{save:()=>new Promise<void>(resolve=>{release=resolve;}),clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);
  const activate=monitor.configure({operation:'mode',mode:'monitor'});await flush(clock);expect(monitor.status().pendingMode).toBe('monitor');
  const off=player.setScreen(false);await flush(clock);await off;release();await activate;
  const on=player.setScreen(true);await flush(clock);await on;clock.advance(2000);monitor.tick();await flush(clock);
  expect(monitor.status().participating).toBe(false);expect(device.effects.filter(e=>e.kind==='frame')).toHaveLength(0);
 }finally{await monitor.close();await player.close();}
 const retryPlayer=await Player.open({store:new MemoryPlaybackStore(),device:new FakeDeviceAdapter()});
 const failure=new MonitorPresentation(retryPlayer,{save:()=>Promise.reject(new Error('disk'))});
 await expect(failure.configure({operation:'mode',mode:'monitor'})).rejects.toThrow();expect(failure.status().participating).toBe(false);await failure.close();await retryPlayer.close();
});
it('a late retired upload cannot reclaim Monitor from Media or change the paused context',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock,latencyMs:100}),store=new MemoryPlaybackStore(),player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);await monitor.configure({operation:'mode',mode:'monitor'});monitor.tick();
  await monitor.media(()=>player.start(store.playlist.id),true);clock.advance(100);await flush(clock);clock.advance(100);await flush(clock);
  expect(monitor.status()).toMatchObject({configuration:{mode:'media'},participating:false});
  const count=device.operations.filter(o=>o.kind==='uploadAnimation').length;clock.advance(1000);monitor.tick();await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(count);expect(player.getSession()?.playlist.id).toBe(store.playlist.id);
 }finally{await monitor.close();await player.close();}
});
it('keeps Media playing while filters and attention change, then resumes explicitly from Monitor',async()=>{
 const clock=new ManualClock(),device=new FakeDeviceAdapter({clock}),store=new MemoryPlaybackStore(),player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  await player.start(store.playlist.id);await flush(clock);const generation=player.getState().generation;
  await monitor.configure({operation:'view',filter:{provider:'codex'},cadenceMs:2000});
  monitor.submit(present(syntheticDashboardViews()[0]).view);await flush(clock);monitor.tick();await flush(clock);
  expect(player.getState()).toMatchObject({intent:'active',generation});expect(monitor.status().participating).toBe(false);
  await monitor.configure({operation:'mode',mode:'monitor'});expect(player.getState().intent).toBe('paused');
  await monitor.media(()=>player.resume(),true);await flush(clock);
  expect(player.getState().intent).toBe('active');expect(monitor.status()).toMatchObject({configuration:{mode:'media'},participating:false});
 }finally{await monitor.close();await player.close();}
});
it('holds the sole HTTP writer through an uncertain retired picture without replay',async()=>{
 const {HttpDeviceAdapter,SPIKE_PROFILE}=await import('../../src/device/http-adapter.js');
 const commands:string[]=[];let release:(value:Record<string,unknown>)=>void=()=>{};
 const device=new HttpDeviceAdapter({ip:'192.168.1.2',profile:SPIKE_PROFILE},async body=>{
  commands.push(String(body.Command));if(body.Command==='Draw/GetHttpGifId')return {error_code:0,PicId:1};
  if(body.Command==='Draw/SendHttpGif')return new Promise<Record<string,unknown>>(resolve=>{release=resolve;});
  return {error_code:0};
 });
 const player=await Player.open({store:new MemoryPlaybackStore(),device});const monitor=new MonitorPresentation(player,{save:async()=>{}});
 try{
  monitor.submit(present(syntheticDashboardViews()[0]).view);for(let i=0;i<100;i++)await Promise.resolve();await monitor.configure({operation:'mode',mode:'monitor'});monitor.tick();
  for(let i=0;i<100;i++)await Promise.resolve();expect(commands).toEqual(['Draw/GetHttpGifId','Draw/SendHttpGif']);
  await monitor.configure({operation:'mode',mode:'media'});const off=player.setScreen(false);
  for(let i=0;i<100;i++)await Promise.resolve();expect(commands).toHaveLength(2);
  release({error_code:0});await off;for(let i=0;i<100;i++)await Promise.resolve();monitor.tick();
  expect(commands).toEqual(['Draw/GetHttpGifId','Draw/SendHttpGif','Channel/OnOffScreen']);
  expect(monitor.status()).toMatchObject({configuration:{mode:'media'},participating:false,lastOutcome:{status:'uncertain'}});
 }finally{release({error_code:0});await monitor.close();await player.close();await device.close();}
});
it.each(['stop','screen-off/on'] as const)('%s during pending Media persistence cancels the deferred start',async control=>{
 const player=await Player.open({store:new MemoryPlaybackStore(),device:new FakeDeviceAdapter()});let hold=false,release=()=>{};
 const monitor=new MonitorPresentation(player,{save:async()=>{if(hold)await new Promise<void>(resolve=>{release=resolve;});}});
 try{
  await monitor.configure({operation:'mode',mode:'monitor'});hold=true;
  let started=false;const media=monitor.media(()=>{started=true;return Promise.resolve();},true).then(()=>null,(error:unknown)=>(error as {code?:unknown}).code);
  for(let i=0;i<100;i++)await Promise.resolve();
  if(control==='stop')await monitor.media(()=>player.stop(),false);else{await player.setScreen(false);await player.setScreen(true);}
  release();
  expect(await media).toBe('cancelled');expect(started).toBe(false);expect(monitor.status().participating).toBe(false);
 }finally{release();await monitor.close();await player.close();}
});
// Restored from divoom-app-upgrade@0777479 tests/unit/monitor-presentation.test.ts, where these cases drove
// ControlService; the module's command handling (PixooControl) replaces it and must make the same promise (Hub #843).
it.each(['stop','pause','clear'] as const)('immediately cancels a pending Media selection on %s with monitoring enabled',async command=>{
 const store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter(),player=await Player.open({store,device});
 const monitor=new MonitorPresentation(player,{save:async()=>{}}),control=new PixooControl({player,monitor});
 const capture=store.capture.bind(store);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 store.capture=async(...args)=>{await gate;return capture(...args);};
 try{
  const starting=control.start(store.playlist.id);
  for(let i=0;i<100;i++)await Promise.resolve();const stopping=control.control(command);for(let i=0;i<100;i++)await Promise.resolve();
  release();expect(await starting).toMatchObject({result:'failed',evidence:'none',error:{code:'cancelled'}});
  expect(await stopping).toEqual({result:'succeeded',evidence:'observed'});for(let i=0;i<100;i++)await Promise.resolve();
  expect(player.getSession()).toBeNull();expect(device.operations.filter(x=>x.kind==='uploadAnimation')).toHaveLength(0);
 }finally{release();control.close();await monitor.close();await player.close();}
});
it('renders the dashboard only while Monitor participates, though its layout stays current',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 let renders=0;
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now(),renderDashboard:layout=>{renders++;return renderDashboard(layout);}});
 try{
  const view=present(syntheticDashboardViews()[0]).view;
  // In Media, a session's every change updates the layout and renders nothing.
  for(let i=0;i<5;i++){present(view.snapshot).revision++;present(present(view.snapshot).sessions[0]).label=`Media ${i}`;monitor.submit(view);clock.advance(1000);monitor.tick();await flush(clock);}
  expect(renders).toBe(0);expect(monitor.layout()?.rows[0]?.label).toBe('Media 4');
  // Selecting Monitor renders the current layout at once, and its upload follows on the next tick.
  await monitor.configure({operation:'mode',mode:'monitor'});await flush(clock);expect(renders).toBe(1);
  monitor.tick();await flush(clock);expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  present(view.snapshot).revision++;present(present(view.snapshot).sessions[0]).label='Monitor';monitor.submit(view);clock.advance(1000);monitor.tick();await flush(clock);
  expect(renders).toBe(2);
 }finally{await monitor.close();await player.close();}
});
it('reports a change only when something it shows changed, not at every tick',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 const monitor=new MonitorPresentation(player,{save:async()=>{},clock:()=>clock.now()});
 try{
  // One session, so the dashboard has one page and never pages on its own.
  const view=present(syntheticDashboardViews()[0]).view;present(view.snapshot).sessions.splice(1);monitor.submit(view);await monitor.configure({operation:'mode',mode:'monitor'});
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
