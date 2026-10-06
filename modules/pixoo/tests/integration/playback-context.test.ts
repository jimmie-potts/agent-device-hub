import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Library} from '../../packages/library/src/index.js';
import {gifFixture} from '../helpers/media-fixtures.js';
const roots:string[]=[];const libraries:Library[]=[];
afterEach(async()=>{for(const library of libraries)await library.close();libraries.length=0;for(const root of roots)await rm(root,{recursive:true,force:true});roots.length=0;});
it('captures immutable context and retains renditions after playlist deletion and reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));roots.push(directory);
 const library=await Library.open({directory});libraries.push(library);
 async function* source(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);}
 const {asset,rendition}=await library.importMedia(source(),'still.gif');
 const p=await library.createPlaylist('Snapshot');
 const edited=await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);
 const checkpoint=await library.createPlaybackCheckpoint(p.id);
 expect(checkpoint.snapshot).toEqual(edited);
 await library.deletePlaylist(p.id,edited.revision);
 await expect(library.deleteAsset(asset.id)).rejects.toMatchObject({code:'asset-referenced'});
 await library.close();
 const reopened=await Library.open({directory});libraries.push(reopened);
 expect(await reopened.getPlaybackCheckpoint()).toEqual(checkpoint);
});

it('rejects stale or mutated checkpoints and protects owned retention until explicit clear',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));roots.push(directory);
 const library=await Library.open({directory});libraries.push(library);
 async function* source(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);}
 const {asset,rendition}=await library.importMedia(source(),'still.gif');
 const p=await library.createPlaylist('Saved');await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);
 const first=await library.createPlaybackCheckpoint(p.id);
 await expect(library.releaseSession(first.sessionId)).rejects.toMatchObject({code:'checkpoint-owned'});
 const mutated=structuredClone(first);mutated.snapshot.name='Unexpected edit';
 await expect(library.savePlaybackCheckpoint(mutated)).rejects.toMatchObject({code:'invalid-input'});
 await expect(library.savePlaybackCheckpoint({...first,dwellDeadlineMs:100} as typeof first)).rejects.toMatchObject({code:'invalid-input'});
 const second=await library.createPlaybackCheckpoint(p.id);
 expect(second.sessionId).not.toBe(first.sessionId);
 await expect(library.savePlaybackCheckpoint(first)).rejects.toMatchObject({code:'revision-conflict'});
 expect((await library.listSessions()).map(session=>session.id)).toEqual([second.sessionId]);
 await library.clearPlaybackCheckpoint();await library.clearPlaybackCheckpoint();
 expect(await library.getPlaybackCheckpoint()).toBeUndefined();
 await library.deletePlaylist(p.id,2);await library.deleteAsset(asset.id);
});

it('rejects a checkpoint whose payload no longer matches retained session ownership',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));roots.push(directory);
 const library=await Library.open({directory});libraries.push(library);
 async function* source(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);}
 const {rendition}=await library.importMedia(source(),'still.gif');
 const p=await library.createPlaylist('Corruption');await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);
 const record=await library.createPlaybackCheckpoint(p.id);
 const db=new DatabaseSync(join(directory,'catalog.sqlite'));
 try{db.prepare('UPDATE playback_checkpoint SET payload=?').run(JSON.stringify({...record,sessionId:randomUUID()}));}
 finally{db.close();}
 await expect(library.getPlaybackCheckpoint()).rejects.toMatchObject({code:'catalog-corrupt'});
});

it('rolls back failed snapshot replacement with the previous retention intact',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));roots.push(directory);
 const library=await Library.open({directory});libraries.push(library);
 async function* source(){yield gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);}
 const {rendition}=await library.importMedia(source(),'still.gif');const p=await library.createPlaylist('Atomic');
 await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);const record=await library.createPlaybackCheckpoint(p.id);
 const db=new DatabaseSync(join(directory,'catalog.sqlite'));
 try{db.exec("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON playback_checkpoint BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await expect(library.createPlaybackCheckpoint(p.id)).rejects.toMatchObject({code:'database-error'});
 }finally{db.close();}
 expect(await library.getPlaybackCheckpoint()).toEqual(record);
 expect((await library.listSessions()).map(s=>s.id)).toEqual([record.sessionId]);
});
