import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Library} from '@pixoo/library';
import {Player,LibraryPlaybackStore} from '../../packages/playback/src/index.js';
import {SIMULATOR_PROFILE,PIXOO64_SMOKE_PROFILE} from '@pixoo/media';
import {FakeDeviceAdapter} from '../../packages/device/src/index.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {gifFixture} from '../helpers/media-fixtures.js';
const roots:string[]=[];const players:Player[]=[];const libraries:Library[]=[];
afterEach(async()=>{for(const p of players)await p.close();for(const l of libraries)await l.close();for(const r of roots)await rm(r,{recursive:true,force:true});players.length=0;libraries.length=0;roots.length=0;});
async function setup(clock?:ManualClock){const directory=await mkdtemp(join(tmpdir(),'pixoo-admit-'));roots.push(directory);const library=await Library.open({directory});libraries.push(library);async function* bytes(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);}const media=await library.importMedia(bytes(),'One');const p=await library.createPlaylist('Saved');const playlist=await library.replaceItems(p.id,1,[{renditionId:media.rendition.id}]);const device=new FakeDeviceAdapter(clock?{clock}:{});const player=await Player.open({store:new LibraryPlaybackStore(library),device,...(clock?{clock}:{})});players.push(player);return {library,player,playlist,device,...media};}
it('unknown start leaves the active session and writer generation untouched',async()=>{const {player,playlist,device}=await setup();await player.start(playlist.id);const state=player.getState(),session=player.getSession(),generation=device.generation;await expect(player.start(randomUUID())).rejects.toMatchObject({code:'not-found'});expect(device.generation).toBe(generation);expect(player.getState().intent).toBe(state.intent);expect(player.getSession()).toEqual(session);});
it('rejects stale revisions without replacing context',async()=>{const {player,playlist,library}=await setup();await player.start(playlist.id);const old=await library.getPlaybackCheckpoint();await expect(player.start(playlist.id,1)).rejects.toMatchObject({code:'revision-conflict',details:{expectedRevision:1,actualRevision:2}});expect(await library.getPlaybackCheckpoint()).toEqual(old);});
it('shows temporary media without saved rows and restores paused references',async()=>{const {player,library,rendition,asset}=await setup();const saved=await library.listPlaylists();await player.showMedia(rendition.id);expect(player.getSession()?.source).toEqual({kind:'media',assetId:asset.id,renditionId:rendition.id});expect(player.getState().playlistId).toBeNull();expect(player.getState().playlistRevision).toBeNull();expect(await library.listPlaylists()).toEqual(saved);const generation=player.getState().generation;await expect(player.restartWithChanges()).rejects.toMatchObject({code:'unsupported-operation'});expect(player.getState().generation).toBe(generation);await player.close();const reopened=await Player.open({store:new LibraryPlaybackStore(library),device:new FakeDeviceAdapter()});players.push(reopened);expect(reopened.getState().intent).toBe('paused');expect(reopened.getSession()?.source).toEqual({kind:'media',assetId:asset.id,renditionId:rendition.id});await expect(library.deleteAsset(asset.id)).rejects.toMatchObject({code:'asset-referenced'});});
it('rejects an invalid media policy before current playback changes',async()=>{const {player,rendition,playlist,device}=await setup();await player.start(playlist.id);const generation=device.generation;await expect(player.showMedia(rendition.id,{mode:'plays',totalPlays:2})).rejects.toMatchObject({code:'invalid-input'});expect(device.generation).toBe(generation);});

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
it('stop at pending library capture prevents late checkpoint replacement',async()=>{
 const {player,playlist,library}=await setup();await player.start(playlist.id);const old=await library.getPlaybackCheckpoint();
 const entered=deferred(),release=deferred(),capture=library.createPlaybackCheckpoint.bind(library);
 const mock=vi.spyOn(library,'createPlaybackCheckpoint').mockImplementation(async(id,options)=>{entered.resolve();await release.promise;return capture(id,options);});
 const start=player.start(playlist.id,playlist.revision);const rejected=expect(start).rejects.toMatchObject({code:'cancelled'});await entered.promise;
 const stop=player.stop();expect(player.getState().intent).toBe('stopped');release.resolve();await rejected;await stop;mock.mockRestore();
 expect((await library.getPlaybackCheckpoint())?.sessionId).toBe(old?.sessionId);expect((await library.listSessions()).map(s=>s.id)).toEqual([old!.sessionId]);expect(player.getState().intent).toBe('stopped');
});
it('newer start supersedes pending capture without leaking its references',async()=>{
 const {player,playlist,library,rendition}=await setup();await player.start(playlist.id);const entered=deferred(),release=deferred(),capture=library.createPlaybackCheckpoint.bind(library);
 const mock=vi.spyOn(library,'createPlaybackCheckpoint').mockImplementationOnce(async(id,options)=>{entered.resolve();await release.promise;return capture(id,options);});
 const old=player.start(playlist.id);const rejected=expect(old).rejects.toMatchObject({code:'cancelled'});await entered.promise;const next=player.showMedia(rendition.id);release.resolve();await rejected;await next;mock.mockRestore();
 expect(player.getSession()?.source?.kind).toBe('media');expect((await library.listSessions()).map(s=>s.id)).toEqual([player.getSession()!.id]);
});
it('close supersedes pending capture and preserves recovery context',async()=>{
 const {player,playlist,library}=await setup();await player.start(playlist.id);const before=player.getSession();const entered=deferred(),release=deferred(),capture=library.createPlaybackCheckpoint.bind(library);
 const mock=vi.spyOn(library,'createPlaybackCheckpoint').mockImplementationOnce(async(id,options)=>{entered.resolve();await release.promise;return capture(id,options);});
 const start=player.start(playlist.id);const rejected=expect(start).rejects.toMatchObject({code:'cancelled'});await entered.promise;const close=player.close();release.resolve();await rejected;await close;mock.mockRestore();expect((await library.getPlaybackCheckpoint())?.sessionId).toBe(before!.id);
});
it('stop immediately after committed adoption persists the adopted record',async()=>{
 const {player,playlist,library}=await setup();await player.start(playlist.id);const before=player.getSession()!.id;let stop:Promise<void>|undefined;
 const capture=library.createPlaybackCheckpoint.bind(library);const mock=vi.spyOn(library,'createPlaybackCheckpoint').mockImplementationOnce((id,options)=>capture(id,{...options,adopt:record=>{options?.adopt?.(record);stop=player.stop();}}));
 await player.start(playlist.id);await stop;mock.mockRestore();const record=await library.getPlaybackCheckpoint();expect(record!.sessionId).not.toBe(before);expect(record!.sessionId).toBe(player.getSession()!.id);expect(record!.intent).toBe('stopped');expect(player.getState().lastError).toBeNull();
});
it('capture checks an edit queued before commit and preserves snapshot after later edits',async()=>{
 const {player,playlist,library}=await setup();await player.start(playlist.id);const old=player.getSession()!.id;const entered=deferred(),release=deferred(),capture=library.createPlaybackCheckpoint.bind(library);
 const mock=vi.spyOn(library,'createPlaybackCheckpoint').mockImplementationOnce(async(id,options)=>{entered.resolve();await release.promise;return capture(id,options);});
 const start=player.start(playlist.id,playlist.revision);const failed=expect(start).rejects.toMatchObject({code:'revision-conflict'});await entered.promise;const edited=await library.renamePlaylist(playlist.id,playlist.revision,'Changed');release.resolve();await failed;mock.mockRestore();expect(player.getSession()!.id).toBe(old);
 await player.start(playlist.id,edited.revision);await library.renamePlaylist(playlist.id,edited.revision,'Later');expect(player.getSession()!.playlist.name).toBe('Changed');
});
it('temporary source is immutable and clearing releases only its references',async()=>{
 const {player,library,rendition,playlist}=await setup();await player.showMedia(rendition.id);const record=(await library.getPlaybackCheckpoint())!;
 await expect(library.savePlaybackCheckpoint({...record,source:{kind:'playlist'}})).rejects.toMatchObject({code:'invalid-input'});
 await library.deletePlaylist(playlist.id,playlist.revision);await player.clear();expect(await library.listSessions()).toEqual([]);
});
it('catalog pages distinguish repeated names and bound rendition summaries',async()=>{
 const {library}=await setup();await library.createPlaylist('Saved');const first=await library.queryPlaylists({q:'Saved',offset:0,limit:1});const second=await library.queryPlaylists({q:'Saved',offset:1,limit:1});expect(first.total).toBe(2);expect(first.items[0]!.id).not.toBe(second.items[0]!.id);expect(first.items[0]).not.toHaveProperty('items');
 const media=await library.queryMedia({q:'One',offset:0,limit:1});expect(media.total).toBe(1);expect(media.items).toHaveLength(1);expect(media.items[0]).not.toHaveProperty('sourceHash');await expect(library.queryMedia({q:'',offset:0,limit:101})).rejects.toMatchObject({code:'invalid-input'});
});

it('rejects incompatible existing media and overflowing plays before replacement',async()=>{
 const {library,player,playlist}=await setup();await player.start(playlist.id);const before=player.getSession();
 async function* animation(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:10},{width:1,height:1,pixels:[0],delay:10}]);}
 const imported=await library.importMedia(animation(),'Animation');
 await expect(player.showMedia(imported.rendition.id,{mode:'plays',totalPlays:Number.MAX_SAFE_INTEGER})).rejects.toMatchObject({code:'invalid-input'});expect(player.getSession()).toEqual(before);
 await player.close();const device=new FakeDeviceAdapter();const limited=await Player.open({store:new LibraryPlaybackStore(library,{profile:PIXOO64_SMOKE_PROFILE,stillDelayMs:500}),device});players.push(limited);
 const generation=device.generation;await expect(limited.showMedia(imported.rendition.id)).rejects.toMatchObject({code:'profile-limit'});expect(device.generation).toBe(generation);expect(limited.getSession()).toEqual(before);
 expect((await library.queryMedia({q:'Animation',offset:0,limit:1},PIXOO64_SMOKE_PROFILE,500)).items[0]!.compatible).toBe(false);
});
it('bounds multiple rendition rows and maximum-size playlist summaries',async()=>{
 const {library,asset,rendition,playlist}=await setup();
 for(const background of [[1,0,0],[2,0,0]] as const)await library.renderAsset(asset.id,{transform:{fit:'fit',scaling:'nearest',background},profile:SIMULATOR_PROFILE});
 const a=await library.queryMedia({q:'One',offset:0,limit:2}),b=await library.queryMedia({q:'One',offset:2,limit:2});
 expect(a.total).toBe(3);expect(a.items).toHaveLength(2);expect(b.items).toHaveLength(1);expect(new Set([...a.items,...b.items].map(r=>r.renditionId)).size).toBe(3);
 await library.replaceItems(playlist.id,playlist.revision,Array.from({length:1000},()=>({renditionId:rendition.id})));
 for(let i=0;i<100;i++)await library.createPlaylist('Saved');
 const page=await library.queryPlaylists({q:'Saved',offset:0,limit:100});expect(page.total).toBe(101);expect(page.items).toHaveLength(100);expect(page.items.some(p=>p.itemCount===1000)).toBe(true);expect(JSON.stringify(page).length).toBeLessThan(30000);
 const tail=await library.queryPlaylists({q:'Saved',offset:100,limit:100});expect(tail.items).toHaveLength(1);expect(page.items.some(p=>p.id===tail.items[0]!.id)).toBe(false);
});
it('offline verification accepts temporary source and legacy source-less recovery',async()=>{
 const {library,player,rendition,playlist}=await setup();await player.start(playlist.id);const legacy=(await library.getPlaybackCheckpoint())!;expect(legacy.source).toBeUndefined();await player.close();
 const reopened=await Player.open({store:new LibraryPlaybackStore(library),device:new FakeDeviceAdapter()});players.push(reopened);expect(reopened.getSession()!.playlist.id).toBe(playlist.id);
 await reopened.showMedia(rendition.id);expect(await library.verifyStorage()).toContain(`media/renditions/${rendition.id}/manifest.json`);
});
it('checks cancellation inside the real library queue behind a gated import',async()=>{
 // Hold playback timers so readiness persistence cannot get ahead of admission
 // and wait behind the same import that this test releases after capture queues.
 const {player,playlist,library}=await setup(new ManualClock());await player.start(playlist.id);const before=await library.getPlaybackCheckpoint();const entered=deferred(),release=deferred(),queued=deferred();
 async function* input(){entered.resolve();await release.promise;yield gifFixture(1,1,[{width:1,height:1,pixels:[0]}]);}
 const capture=library.createPlaybackCheckpoint.bind(library);
 const mock=vi.spyOn(library,'createPlaybackCheckpoint').mockImplementation((id,options)=>{const result=capture(id,options);queued.resolve();return result;});
 const importing=library.importMedia(input(),'Gated');let start:Promise<void>|undefined;
 try {
  await entered.promise;
  start=player.start(playlist.id,playlist.revision);
  const outcome=start.then(()=>({code:'unexpected-success'}),(error:unknown)=>error);await queued.promise;
  const stop=player.stop();expect(player.getState().intent).toBe('stopped');release.resolve();await importing;
  expect(await outcome).toMatchObject({code:'cancelled'});await stop;
  expect((await library.getPlaybackCheckpoint())!.sessionId).toBe(before!.sessionId);expect((await library.listSessions()).map(s=>s.id)).toEqual([before!.sessionId]);
 } finally {
  const stopping=player.stop();release.resolve();
  await Promise.allSettled([importing,start,stopping]);mock.mockRestore();
 }
});
