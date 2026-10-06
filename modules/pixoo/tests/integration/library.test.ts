import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { Library } from '../../packages/library/src/index.js';
import { gifFixture } from '../helpers/media-fixtures.js';
const roots:string[]=[]; const libraries:Library[]=[];
afterEach(async()=>{for(const library of libraries) await library.close(); libraries.length=0; for(const root of roots) await rm(root,{recursive:true,force:true}); roots.length=0;});
async function setup() {const directory=await mkdtemp(join(tmpdir(),'pixoo-library-'));roots.push(directory); const library=await Library.open({directory});libraries.push(library);return {directory,library};}
async function* upload() {yield gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:50},{width:1,height:1,pixels:[2],delay:50}]);}
it('persists immutable media and stable playlist items across reopen',async()=>{
  const {directory,library}=await setup();
  const imported=await library.importMedia(upload(),'sample.gif');
  const playlist=await library.createPlaylist('Evening');
  const updated=await library.replaceItems(playlist.id,playlist.revision,[{renditionId:imported.rendition.id},{renditionId:imported.rendition.id,playback:{mode:'duration',durationMs:1000}}]);
  expect(updated.items[0]!.playback).toEqual({mode:'plays',totalPlays:3});
  expect(updated.items[0]!.id).not.toBe(updated.items[1]!.id);
  await library.close();
  const reopened=await Library.open({directory});libraries.push(reopened);
  expect(await reopened.getPlaylist(playlist.id)).toEqual(updated);
  expect((await reopened.getAsset(imported.asset.id)).contentHash).toBe(imported.rendition.sourceHash);
  expect(await reopened.listRenditions(imported.asset.id)).toEqual([imported.rendition]);
});

it('keeps item identities and policies through reorder, edits and duplication',async()=>{
  const {library}=await setup();
  const {rendition}=await library.importMedia(upload(),'animation.gif');
  let playlist=await library.createPlaylist('  Night  ');
  expect(playlist).toMatchObject({name:'Night',revision:1,repeat:true,shuffle:false});
  playlist=await library.replaceItems(playlist.id,1,[{renditionId:rendition.id},{renditionId:rendition.id,playback:{mode:'duration',durationMs:1000}}]);
  const original=structuredClone(playlist);
  playlist=await library.reorderItems(playlist.id,2,playlist.items.map(i=>i.id).reverse());
  expect(playlist.items).toEqual(original.items.toReversed());
  playlist=await library.replaceItems(playlist.id,3,playlist.items.map(i=>({...i,playback:{mode:'duration',durationMs:2000}})));
  expect(playlist.items.map(i=>i.id)).toEqual(original.items.map(i=>i.id).reverse());
  playlist=await library.renamePlaylist(playlist.id,4,'Morning');
  playlist=await library.setPlaylistOptions(playlist.id,5,{shuffle:true,repeat:false});
  const copy=await library.duplicatePlaylist(playlist.id,6,'Copy');
  expect(copy).toMatchObject({name:'Copy',revision:1,shuffle:true,repeat:false});
  expect(copy.items.map(i=>i.renditionId)).toEqual(playlist.items.map(i=>i.renditionId));
  expect(copy.items.map(i=>i.playback)).toEqual(playlist.items.map(i=>i.playback));
  expect(copy.items.every(i=>!playlist.items.some(old=>i.id===old.id))).toBe(true);
  await expect(library.reorderItems(playlist.id,6,[playlist.items[0]!.id,playlist.items[0]!.id])).rejects.toMatchObject({code:'invalid-input'});
  await expect(library.replaceItems(playlist.id,6,[copy.items[0]!])).rejects.toMatchObject({code:'invalid-input'});
  expect(await library.getPlaylist(playlist.id)).toEqual(playlist);
  await library.deletePlaylist(copy.id,1);
  expect(await library.listPlaylists()).toEqual([playlist]);
});

it('rejects stale and competing writes without partial metadata changes',async()=>{
  const {library}=await setup();
  const p=await library.createPlaylist('Initial');
  const results=await Promise.allSettled([library.renamePlaylist(p.id,1,'First'),library.renamePlaylist(p.id,1,'Second')]);
  expect(results[0]!.status).toBe('fulfilled');
  expect(results[1]).toMatchObject({status:'rejected',reason:{code:'revision-conflict',details:{actualRevision:2,expectedRevision:1}}});
  for(const operation of [()=>library.deletePlaylist(p.id,1),()=>library.duplicatePlaylist(p.id,1,'Copy'),()=>library.setPlaylistOptions(p.id,1,{repeat:false}),()=>library.replaceItems(p.id,1,[]),()=>library.reorderItems(p.id,1,[])])
    await expect(operation()).rejects.toMatchObject({code:'revision-conflict'});
  expect(await library.getPlaylist(p.id)).toMatchObject({name:'First',revision:2});
});

it('validates policies atomically and treats a single-frame GIF as a still',async()=>{
  const {library}=await setup();
  const still=await library.importMedia(bytes(gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:50}])),'still.gif');
  const animated=await library.importMedia(upload(),'animated.gif');
  let p=await library.createPlaylist('Policies');
  p=await library.replaceItems(p.id,p.revision,[{renditionId:still.rendition.id}]);
  expect(p.items[0]!.playback).toEqual({mode:'duration',durationMs:30000});
  for(const value of [0,-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) {
    await expect(library.replaceItems(p.id,p.revision,[{renditionId:still.rendition.id,playback:{mode:'duration',durationMs:value}}])).rejects.toMatchObject({code:'invalid-input'});
    await expect(library.replaceItems(p.id,p.revision,[{renditionId:animated.rendition.id,playback:{mode:'plays',totalPlays:value}}])).rejects.toMatchObject({code:'invalid-input'});
  }
  await expect(library.replaceItems(p.id,p.revision,[{renditionId:still.rendition.id,playback:{mode:'plays',totalPlays:1}}])).rejects.toMatchObject({code:'invalid-input'});
  await expect(library.replaceItems(p.id,p.revision,[{renditionId:animated.rendition.id},{renditionId:'f'.repeat(64)}])).rejects.toMatchObject({code:'not-found'});
  expect(await library.getPlaylist(p.id)).toEqual(p);
});

it('preserves originals and old renditions when transforms change',async()=>{
  const {directory,library}=await setup();
  const original=gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:50}]);
  const first=await library.importMedia(bytes(original),'original.gif');
  const same=await library.importMedia(bytes(original),'renamed.gif');
  expect(same).toEqual(first);
  const p=await library.createPlaylist('Old rendering');
  await library.replaceItems(p.id,p.revision,[{renditionId:first.rendition.id}]);
  const second=await library.renderAsset(first.asset.id,{transform:{fit:'crop',scaling:'smooth',background:[1,2,3]}});
  expect(second.asset).toEqual(first.asset);
  expect(second.rendition.id).not.toBe(first.rendition.id);
  expect(await library.getRendition(first.rendition.id)).toEqual(first.rendition);
  expect((await library.getPlaylist(p.id)).items[0]!.renditionId).toBe(first.rendition.id);
  expect(await readFile(join(directory,'media','originals',first.asset.contentHash))).toEqual(original);
  expect(await library.readFrame(first.rendition.id,0,'rgb')).toHaveLength(64*64*3);
  expect(await library.listAssets()).toHaveLength(1);
  expect((await library.listRenditions(first.asset.id)).map(r=>r.id).sort()).toEqual([first.rendition.id,second.rendition.id].sort());
});

it('retains session references after playlist removal and restart until explicit release',async()=>{
  const {directory,library}=await setup();
  const {asset,rendition}=await library.importMedia(upload(),'active.gif');
  const empty=await library.createPlaylist('Playing');
  const p=await library.replaceItems(empty.id,1,[{renditionId:rendition.id}]);
  const session=await library.retainSession([rendition.id,rendition.id]);
  await expect(library.deleteAsset(asset.id)).rejects.toMatchObject({code:'asset-referenced',details:{assetId:asset.id,playlistIds:[p.id],sessionIds:[session.id]}});
  await library.deletePlaylist(p.id,p.revision);
  await library.close();
  const reopened=await Library.open({directory}); libraries.push(reopened);
  expect(await reopened.listSessions()).toEqual([session]);
  await expect(reopened.deleteAsset(asset.id)).rejects.toMatchObject({code:'asset-referenced',details:{playlistIds:[],sessionIds:[session.id]}});
  expect(await reopened.getRendition(rendition.id)).toEqual(rendition);
  await reopened.releaseSession(session.id);
  await reopened.releaseSession(session.id);
  await reopened.deleteAsset(asset.id);
  await expect(reopened.getAsset(asset.id)).rejects.toMatchObject({code:'not-found'});
  expect(await readdir(join(directory,'media','originals'))).toEqual([]);
  expect(await readdir(join(directory,'media','renditions'))).toEqual([]);
});

it('replays durable deletion after a file error and preserves unrelated files',async()=>{
  const {directory,library}=await setup();
  const {asset}=await library.importMedia(upload(),'delete.gif');
  const original=join(directory,'media','originals',asset.contentHash), saved=await readFile(original);
  await rm(original); await mkdir(original);
  await writeFile(join(directory,'media','originals','keep-me'),'unrelated');
  await expect(library.deleteAsset(asset.id)).rejects.toMatchObject({code:'cleanup-pending',details:{assetId:asset.id}});
  expect(await library.listAssets()).toEqual([]);
  await expect(library.importMedia(upload(),'retry.gif')).rejects.toMatchObject({code:'cleanup-pending'});
  await library.close();
  await expect(Library.open({directory})).rejects.toMatchObject({code:'cleanup-pending'});
  await rm(original,{recursive:true});await writeFile(original,saved);
  const reopened=await Library.open({directory});libraries.push(reopened);
  expect(await reopened.listAssets()).toEqual([]);
  expect(await readdir(join(directory,'media','originals'))).toEqual(['keep-me']);
  await reopened.retryCleanup();
  expect((await reopened.importMedia(upload(),'new.gif')).asset.id).not.toBe(asset.id);
});

it('allows one owner, cleans failed partials and recovers only owned staging directories',async()=>{
  const {directory,library}=await setup();
  await expect(Library.open({directory})).rejects.toMatchObject({code:'busy'});
  await expect(library.importMedia(bytes(Buffer.from('broken')),'bad.gif')).rejects.toBeDefined();
  expect(await readdir(join(directory,'media','staging'))).toEqual([]);
  const abandoned=join(directory,'media','staging','request-ABC123');
  await mkdir(abandoned);await writeFile(join(abandoned,'partial'),'incomplete');
  await mkdir(join(directory,'media','staging','user-directory'));
  await writeFile(join(directory,'media','staging','request-ZYX987'),'unrelated-file');
  await library.close();
  await expect(library.listAssets()).rejects.toMatchObject({code:'closed'});
  const reopened=await Library.open({directory});libraries.push(reopened);
  expect((await readdir(join(directory,'media','staging'))).sort()).toEqual(['request-ZYX987','user-directory']);
});

async function* bytes(value:Buffer) {yield value;}

it('releases ownership after abrupt process exit and retains committed metadata',async()=>{
  const {directory,library}=await setup();await library.close();
  const entry=pathToFileURL(resolve('packages/library/dist/index.js')).href;
  const child=spawn(process.execPath,['--expose-gc','--input-type=module','-e',`
    import {Library} from ${JSON.stringify(entry)};
    const library=await Library.open({directory:${JSON.stringify(directory)}});
    const playlist=await library.createPlaylist('Committed before crash');
    // Model a backend that retains its library for the whole process lifetime.
    globalThis.liveLibrary=library;
    setImmediate(()=>{global.gc();process.send(playlist);});
    setInterval(()=>{},1000);
  `],{stdio:['ignore','ignore','pipe','ipc']});
  try {
    const playlist=await new Promise<{id:string}>((resolve,reject)=>{
      child.once('message',value=>resolve(value as {id:string}));child.once('error',reject);
      child.once('exit',code=>reject(new Error(`Owner exited before readiness: ${code}`)));
    });
    const contention=await Library.open({directory}).then(async unexpected=>{
      await unexpected.close();return {code:'unexpected-open'};
    },(error:unknown)=>error);
    expect(contention).toMatchObject({code:'busy'});
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;
    const reopened=await Library.open({directory});libraries.push(reopened);
    expect(await reopened.getPlaylist(playlist.id)).toMatchObject({name:'Committed before crash',revision:1});
  } finally {if(child.exitCode===null && child.signalCode===null) {const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
},15000);

it('keeps an orphan rendition reusable after another transform is registered and deleted',async()=>{
  const {directory,library}=await setup();
  const db=new DatabaseSync(join(directory,'catalog.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    await expect(library.importMedia(upload(),'failed.gif')).rejects.toMatchObject({code:'database-error'});
    db.exec('DROP TRIGGER fail_registration');
  } finally {db.close();}
  const [orphan]=await readdir(join(directory,'media','renditions'));
  expect(orphan).toBeDefined();
  const different=await library.importMedia(upload(),'other.gif',{transform:{fit:'crop',scaling:'smooth',background:[1,2,3]}});
  await library.deleteAsset(different.asset.id);
  await library.close();
  const reopened=await Library.open({directory});libraries.push(reopened);
  const retried=await reopened.importMedia(upload(),'recovered.gif');
  expect(retried.rendition.id).toBe(orphan);
  expect(await reopened.getRendition(retried.rendition.id)).toEqual(retried.rendition);
  await reopened.deleteAsset(retried.asset.id);
  expect(await readdir(join(directory,'media','originals'))).toEqual([]);
  expect(await readdir(join(directory,'media','renditions'))).toEqual([]);
});
