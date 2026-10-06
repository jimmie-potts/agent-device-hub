import {expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Library,type PlaybackCheckpoint} from '@pixoo/library';
import {Player,LibraryPlaybackStore} from '@pixoo/playback';
import {FakeDeviceAdapter} from '@pixoo/device';
import {ManualClock} from '../helpers/manual-clock.js';
import {gifFixture} from '../helpers/media-fixtures.js';

it.each([false,true])('recovers a killed process paused with retained media and a fresh full dwell; temporary=%s',async temporary=>{
 const directory=await mkdtemp(join(tmpdir(),'pixoo-player-restart-'));
 let library=await Library.open({directory});let player:Player|undefined;
 try{
  async function* bytes(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);}
  const imported=await library.importMedia(bytes(),'original.gif');
  const playlist=await library.createPlaylist('Persistent');await library.replaceItems(playlist.id,1,[{renditionId:imported.rendition.id}]);
  await library.close();
  const imports={library:pathToFileURL(resolve('packages/library/dist/index.js')).href,player:pathToFileURL(resolve('packages/playback/dist/index.js')).href,device:pathToFileURL(resolve('packages/device/dist/index.js')).href};
  const child=spawn(process.execPath,['--expose-gc','--input-type=module','-e',`
    import {Library} from ${JSON.stringify(imports.library)};
    import {Player,LibraryPlaybackStore} from ${JSON.stringify(imports.player)};
    import {FakeDeviceAdapter} from ${JSON.stringify(imports.device)};
    const library=await Library.open({directory:${JSON.stringify(directory)}});
    const player=await Player.open({store:new LibraryPlaybackStore(library),device:new FakeDeviceAdapter()});
    globalThis.runtime={library,player};
    await player.${temporary?'showMedia':'start'}(${JSON.stringify(temporary?imported.rendition.id:playlist.id)});
    const timer=setInterval(async()=>{
      if(player.getState().state!=='playing')return;
      clearInterval(timer);
      const record=await library.getPlaybackCheckpoint();
      await library.deletePlaylist(${JSON.stringify(playlist.id)},2);
      global.gc();process.send(record);
      setInterval(()=>{},1000);
    },10);
  `],{stdio:['ignore','ignore','pipe','ipc']});
  let record:PlaybackCheckpoint;
  try{
    record=await new Promise<PlaybackCheckpoint>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Player readiness deadline')),8000);
      child.once('message',message=>{clearTimeout(timer);resolve(message as PlaybackCheckpoint);});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Player exited early: ${code}`));});
    });
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
  expect(record.state).toBe('playing');expect(record.intent).toBe('active');
  if(temporary)expect(record.source).toEqual({kind:'media',assetId:imported.asset.id,renditionId:imported.rendition.id});
  expect(JSON.stringify(record)).not.toMatch(/deadline|ReadyAt|startedAt/);
  library=await Library.open({directory});const clock=new ManualClock(),device=new FakeDeviceAdapter({clock});
  player=await Player.open({store:new LibraryPlaybackStore(library),device,clock});
  expect(player.getState()).toMatchObject({state:'paused',intent:'paused',sessionId:record.sessionId,itemId:record.currentItemId,dwellDeadlineMs:null});
  expect(device.effects).toEqual([]);
  await expect(library.getPlaylist(playlist.id)).rejects.toMatchObject({code:'not-found'});
  await expect(library.deleteAsset(imported.asset.id)).rejects.toMatchObject({code:'asset-referenced'});
  await expect(Player.open({store:new LibraryPlaybackStore(library),device:new FakeDeviceAdapter({clock}),clock})).rejects.toMatchObject({code:'busy'});
  await player.resume();
  await vi.waitFor(()=>{clock.advance(0);expect(player!.getState().state).toBe('playing');},{timeout:5000,interval:10});
  expect(player.getState().dwellDeadlineMs).toBe(30000);
  await player.clear();await library.deleteAsset(imported.asset.id);
 }finally{await player?.close();await library.close();await rm(directory,{recursive:true,force:true});}
},20000);
