import {expect,it} from 'vitest';
import {Player} from '../../packages/playback/src/index.js';
import {FakeDeviceAdapter} from '../../packages/device/src/index.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
async function flush(clock:ManualClock){for(let i=0;i<80;i++){await Promise.resolve();clock.advance(0);}}
it('charges three effective loops only after upload and estimated readiness',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();
 const device=new FakeDeviceAdapter({clock,latencyMs:10,readyDelayMs:50});
 const player=await Player.open({store,device,clock});
 try {
  await player.start(store.playlist.id);await flush(clock);
  expect(player.getState().state).toBe('loading');
  clock.advance(20);await flush(clock);
  expect(player.getState().state).toBe('loading');
  clock.advance(49);await flush(clock);expect(player.getState().state).toBe('loading');
  clock.advance(1);await flush(clock);expect(player.getState().state).toBe('playing');
  expect(player.getState().dwellDeadlineMs).toBe(2170);
  expect(store.loads).toContain(store.playlist.items[1]!.renditionId);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  clock.advance(2099);await flush(clock);expect(player.getState().itemId).toBe(store.playlist.items[0]!.id);
  clock.advance(1);await flush(clock);expect(player.getState().itemId).toBe(store.playlist.items[1]!.id);
 }finally{await player.close();}
});

it('keeps brightness serialized through an automatic transition with a short dwell',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();
 store.playlist.items[0]!.playback={mode:'duration',durationMs:1};
 const device=new FakeDeviceAdapter({clock,latencyMs:10});const player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);
  const brightness=player.setBrightness(42);
  clock.advance(20);await flush(clock);clock.advance(1);await flush(clock);
  clock.advance(9);await flush(clock);
  expect(await brightness).toMatchObject({ok:true});
  expect(device.effects.filter(e=>e.kind==='brightness')).toMatchObject([{percent:42,atMs:30}]);
  clock.advance(20);await flush(clock);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')[1]!.timing.startedAtMs).toBe(30);
 }finally{await player.close();}
});

it('does not submit a superseded screen-off command after stop',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();const device=new FakeDeviceAdapter({clock});
 const player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);
  const off=player.setScreen(false),stop=player.stop();await flush(clock);await Promise.all([off,stop]);
  expect(device.effects.some(e=>e.kind==='screen')).toBe(false);
  expect(player.getState().state).toBe('idle');
 }finally{await player.close();}
});

it('pause holds context and resume reuploads with the full policy',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});const player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);clock.advance(1000);await flush(clock);
  await player.pause();clock.advance(100000);await flush(clock);
  expect(player.getState()).toMatchObject({state:'paused',intent:'paused',dwellDeadlineMs:null,itemId:store.playlist.items[0]!.id});
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
  await player.resume();await flush(clock);
  expect(player.getState().dwellDeadlineMs).toBe(clock.now()+2100);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(2);
 }finally{await player.close();}
});

it('stop during a partial upload leaves prior effects and no future transitions',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:10});const player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);clock.advance(10);await flush(clock);
  await player.stop();clock.advance(100000);await flush(clock);
  expect(device.effects).toHaveLength(1);expect(device.operations[0]).toMatchObject({priorEffects:'possible'});
  expect(player.getState()).toMatchObject({state:'idle',intent:'stopped',dwellDeadlineMs:null});expect(clock.pendingTimers).toBe(0);
 }finally{await player.close();}
});

it('command spam retires pending uploads and previous follows only started items',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();store.playlist.repeat=true;
 const device=new FakeDeviceAdapter({clock,latencyMs:10}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);clock.advance(20);await flush(clock);
  const commands=Array.from({length:5},()=>player.next());await Promise.all(commands);await flush(clock);
  expect(player.getState().itemId).toBe(store.playlist.items[1]!.id);
  // Skip back before B finishes: it has not entered playback history.
  await player.previous();await flush(clock);clock.advance(20);await flush(clock);
  expect(player.getState().itemId).toBe(store.playlist.items[0]!.id);
  expect(store.record!.history).toEqual([store.playlist.items[0]!.id]);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation'&&o.outcome==='success')).toHaveLength(2);
 }finally{await player.close();}
});

it('finishes repeat-off idle and never bursts through missed intervals',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);clock.advance(100000);await flush(clock);
  expect(player.getState()).toMatchObject({state:'playing',itemId:store.playlist.items[1]!.id,dwellDeadlineMs:101000});
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(2);
  clock.advance(1000);await flush(clock);expect(player.getState()).toMatchObject({state:'idle',intent:'stopped'});
  expect(device.effects).toHaveLength(4);
 }finally{await player.close();}
});

it('shuffle covers each cycle without adjacent repeats and preserves actual history',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();store.playlist.repeat=true;store.playlist.shuffle=true;
 store.playlist.items.push({...structuredClone(store.playlist.items[1]!),id:'00000000-0000-4000-8000-000000000004'});
 for(const item of store.playlist.items)item.playback={mode:'duration',durationMs:10};
 const device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock,random:()=>0});
 try{
  await player.start(store.playlist.id);await flush(clock);const visits=[player.getState().itemId];
  for(let i=0;i<5;i++){clock.advance(10);await flush(clock);visits.push(player.getState().itemId);}
  expect(new Set(visits.slice(0,3)).size).toBe(3);expect(new Set(visits.slice(3,6)).size).toBe(3);expect(visits[2]).not.toBe(visits[3]);
  await player.previous();await flush(clock);expect(player.getState().itemId).toBe(visits[4]);
  await player.previous();await flush(clock);expect(player.getState().itemId).toBe(visits[3]);
  await player.next();await flush(clock);expect(player.getState().itemId).toBe(visits[4]);
 }finally{await player.close();}
});

it('saved edits apply only to explicit restart-with-changes',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);const session=player.getState().sessionId;
  store.playlist.revision=2;store.playlist.items[0]!.playback={mode:'duration',durationMs:10};
  await player.pause();await player.resume();await flush(clock);
  expect(player.getState()).toMatchObject({sessionId:session,playlistRevision:1,dwellDeadlineMs:2100});
  await player.restartWithChanges();await flush(clock);
  expect(player.getState().sessionId).not.toBe(session);expect(player.getState()).toMatchObject({playlistRevision:2,dwellDeadlineMs:10});
 }finally{await player.close();}
});

it('screen off pauses and screen on does not resume',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);
  const off=player.setScreen(false);await flush(clock);await off;expect(player.getState()).toMatchObject({state:'paused',requestedScreenOn:false});
  await expect(player.resume()).rejects.toMatchObject({code:'screen-off'});
  const on=player.setScreen(true);await flush(clock);await on;clock.advance(10000);await flush(clock);
  expect(player.getState()).toMatchObject({state:'paused',requestedScreenOn:true});
  expect(device.effects.filter(e=>e.kind==='screen')).toMatchObject([{on:false},{on:true}]);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(1);
 }finally{await player.close();}
});

it('reconnect restarts the intended item but stop retires an outstanding probe',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock,latencyMs:10});device.setOnline(false);
 const player=await Player.open({store,device,clock,retryBaseMs:10});
 try{
  await player.start(store.playlist.id);await flush(clock);clock.advance(10);await flush(clock);
  expect(player.getState()).toMatchObject({state:'reconnecting',intent:'active',availability:'offline'});
  clock.advance(10);await flush(clock);device.setOnline(true);await player.stop();clock.advance(10000);await flush(clock);
  expect(device.effects.filter(e=>e.kind==='frame')).toHaveLength(0);expect(player.getState().state).toBe('idle');
  await player.resume();await flush(clock);clock.advance(20);await flush(clock);
  expect(player.getState()).toMatchObject({state:'playing',itemId:store.playlist.items[0]!.id,dwellDeadlineMs:clock.now()+2100});
 }finally{await player.close();}
});

it('exhausts a bounded reconnect budget without timers or uploads after error',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});device.setOnline(false);
 const player=await Player.open({store,device,clock,retryBaseMs:10,maxRetries:3});
 try{
  await player.start(store.playlist.id);await flush(clock);
  for(const delay of [10,20,40]){clock.advance(delay);await flush(clock);}
  expect(player.getState()).toMatchObject({state:'error',intent:'paused'});
  expect(device.operations.filter(o=>o.kind==='probe')).toHaveLength(3);expect(clock.pendingTimers).toBe(0);
  device.setOnline(true);clock.advance(100000);await flush(clock);expect(player.getState().state).toBe('error');
 }finally{await player.close();}
});

it('ends all-item failures and pauses on external takeover without reclaim attempts',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();store.playlist.repeat=true;
 store.playlist.items.forEach(item=>store.unavailable.add(item.renditionId));
 const device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);expect(player.getState().state).toBe('error');expect(store.loads).toHaveLength(2);
  store.unavailable.clear();await player.resume();await flush(clock);await player.takeover();clock.advance(100000);await flush(clock);
  expect(player.getState()).toMatchObject({state:'paused',intent:'paused',lastError:{code:'external-control'}});
  expect(device.operations.filter(o=>o.kind==='probe')).toHaveLength(0);
 }finally{await player.close();}
});

it('restores paused without old deadlines and rejects duplicate owners',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 await player.start(store.playlist.id);await flush(clock);clock.advance(500);await flush(clock);
 await expect(Player.open({store,device,clock})).rejects.toMatchObject({code:'busy'});
 await expect(Player.open({store,device:new FakeDeviceAdapter({clock}),clock})).rejects.toMatchObject({code:'busy'});
 await player.close();
 expect(JSON.stringify(store.record)).not.toMatch(/deadline|ReadyAt|startedAt/);
 const freshClock=new ManualClock(),freshDevice=new FakeDeviceAdapter({clock:freshClock}),restored=await Player.open({store,device:freshDevice,clock:freshClock});
 try{
  expect(restored.getState()).toMatchObject({state:'paused',intent:'paused',dwellDeadlineMs:null});expect(freshDevice.effects).toEqual([]);
  await restored.resume();await flush(freshClock);expect(restored.getState().dwellDeadlineMs).toBe(2100);
 }finally{await restored.close();}
});

it('stop wins while initial checkpoint capture is pending',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock});
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});const capture=store.capture.bind(store);
 store.capture=async(id,hooks)=>{await wait;return capture(id,hooks);};
 const player=await Player.open({store,device,clock});
 try{
  const start=player.start(store.playlist.id);await flush(clock);const stop=player.stop();
  const rejected=expect(start).rejects.toMatchObject({code:'cancelled'});
  expect(player.getState().intent).toBe('stopped');release();await rejected;await stop;await flush(clock);
  expect(device.effects).toEqual([]);expect(store.record).toBeUndefined();expect(player.getState().state).toBe('idle');
 }finally{await player.close();}
});

it('keeps one retry budget when successful probes are followed by failed uploads',async()=>{
 class FlappingDevice extends FakeDeviceAdapter {
  override probe(...args:Parameters<FakeDeviceAdapter['probe']>){this.setOnline(true);return super.probe(...args);}
  override uploadAnimation(...args:Parameters<FakeDeviceAdapter['uploadAnimation']>){this.setOnline(false);return super.uploadAnimation(...args);}
 }
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FlappingDevice({clock}),player=await Player.open({store,device,clock,retryBaseMs:10});
 try{
  await player.start(store.playlist.id);await flush(clock);
  for(const delay of [10,20,40]){clock.advance(delay);await flush(clock);}
  expect(player.getState()).toMatchObject({state:'error',intent:'paused'});
  expect(device.operations.filter(o=>o.kind==='probe')).toHaveLength(3);
  expect(device.operations.filter(o=>o.kind==='uploadAnimation')).toHaveLength(4);expect(clock.pendingTimers).toBe(0);
 }finally{await player.close();}
});

it('rejects overflowing total-play dwell without device output',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();store.playlist.items=store.playlist.items.slice(0,1);store.playlist.items[0]!.playback={mode:'plays',totalPlays:Number.MAX_SAFE_INTEGER};
 const device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);expect(player.getState()).toMatchObject({state:'error',lastError:{code:'invalid-input'}});
  expect(device.effects).toEqual([]);
 }finally{await player.close();}
});

it('keeps the latest requested screen state when off and on arrive together',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);
  const off=player.setScreen(false),on=player.setScreen(true);await flush(clock);await Promise.all([off,on]);
  const screens=device.effects.filter(e=>e.kind==='screen');expect(screens.at(-1)).toMatchObject({on:true});
  expect(player.getState()).toMatchObject({requestedScreenOn:true,state:'paused'});
 }finally{await player.close();}
});

it('suspends dwell as soon as a display control observes connectivity loss',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);device.setOnline(false);
  const brightness=player.setBrightness(42);await flush(clock);expect(await brightness).toMatchObject({ok:false,code:'offline'});
  expect(player.getState()).toMatchObject({state:'reconnecting',intent:'active',availability:'offline',dwellDeadlineMs:null});
 }finally{await player.close();}
});

it('uses still duration independently from its positive transport placeholder',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore();store.playlist.items=store.playlist.items.slice(0,1);store.playlist.items[0]!.playback={mode:'duration',durationMs:50};
 store.load=async()=>({frames:[{rgb:new Uint8Array(12288),delayMs:100}]});
 const device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{await player.start(store.playlist.id);await flush(clock);expect(player.getState().dwellDeadlineMs).toBe(50);clock.advance(50);await flush(clock);expect(player.getState().state).toBe('idle');}
 finally{await player.close();}
});

it('does not retain completed preparation promises beyond the two-rendition cache',async()=>{
 class RejectingDevice extends FakeDeviceAdapter {
  override uploadAnimation(...args:Parameters<FakeDeviceAdapter['uploadAnimation']>){this.failNextUpload();return super.uploadAnimation(...args);}
 }
 const clock=new ManualClock(),store=new MemoryPlaybackStore();
 store.playlist.items.push({...structuredClone(store.playlist.items[1]!),id:'00000000-0000-4000-8000-000000000004',renditionId:'c'.repeat(64)},
  {...structuredClone(store.playlist.items[0]!),id:'00000000-0000-4000-8000-000000000005'});
 const device=new RejectingDevice({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);
  expect(player.getState().state).toBe('error');
  expect(store.loads.filter(id=>id==='a'.repeat(64))).toHaveLength(2);
 }finally{await player.close();}
});

it('does not upload an uncommitted transition after checkpoint persistence fails',async()=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 const save=store.save.bind(store);
 try{
  await player.start(store.playlist.id);await flush(clock);const effects=device.effects.length;
  store.save=async()=>{throw Object.assign(new Error('storage failed'),{code:'database-error'});};
  await expect(player.next()).rejects.toMatchObject({code:'database-error'});await flush(clock);clock.advance(100000);await flush(clock);
  expect(player.getState()).toMatchObject({state:'error',intent:'paused',dwellDeadlineMs:null});expect(device.effects).toHaveLength(effects);
 }finally{store.save=save;await player.close();}
});

it.each([false,true])('rejects resume after queued clear with subsequent previous=%s',async navigate=>{
 const clock=new ManualClock(),store=new MemoryPlaybackStore(),device=new FakeDeviceAdapter({clock}),player=await Player.open({store,device,clock});
 try{
  await player.start(store.playlist.id);await flush(clock);
  const uploads=device.operations.filter(operation=>operation.kind==='uploadAnimation').length;
  const commands=[player.clear(),player.resume()];if(navigate)commands.push(player.previous());
  const [cleared,resumed]=await Promise.allSettled(commands);
  expect(cleared!.status).toBe('fulfilled');
  expect(resumed).toMatchObject({status:'rejected',reason:{code:'no-context'}});
  await flush(clock);clock.advance(100000);await flush(clock);
  expect(player.getState()).toMatchObject({state:'idle',intent:'stopped',sessionId:null,itemId:null,dwellDeadlineMs:null});
  expect(player.getState().intent).not.toBe('active');
  expect(store.record).toBeUndefined();expect(clock.pendingTimers).toBe(0);
  expect(device.operations.filter(operation=>operation.kind==='uploadAnimation')).toHaveLength(uploads);
 }finally{await player.close();}
});
