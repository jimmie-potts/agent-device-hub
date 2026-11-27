import { expect } from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Library} from '../../src/library/index.js';
import {gifFixture} from '../helpers/media-fixtures.js';
import { mediaTest } from '../helpers/media-test.js';
// Each test forks a media worker to import its fixture, and that import is nearly all of the test's time (#2062).
// Measured on one CPU (taskset -c 0), over two sets of runs: idle, the first test's median was 155-579 ms and its max
// 774 ms in 100 runs; with 8 busy loops sharing the CPU, its median was 2.4-4.7 s and its max 5,490 ms in 40 runs, past
// Vitest's 5 s default. A 20 s budget is more than three times that loaded max and stays below the media store's own 30 s
// render timeout.
const MEDIA_TEST_TIMEOUT_MS=20_000;
mediaTest('captures immutable context and retains renditions after playlist deletion and reopen', async resources => {
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));resources.roots.push(directory);
 const library=await Library.open({directory});resources.libraries.push(library);
 async function* source(){yield Promise.resolve(gifFixture(1,1,[{width:1,height:1,pixels:[1]}]));}
 const {asset,rendition}=await library.importMedia(source(),'still.gif');
 const p=await library.createPlaylist('Snapshot');
 const edited=await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);
 const checkpoint=await library.createPlaybackCheckpoint(p.id);
 expect(checkpoint.snapshot).toEqual(edited);
 await library.deletePlaylist(p.id,edited.revision);
 await expect(library.deleteAsset(asset.id)).rejects.toMatchObject({code:'asset-referenced'});
 await library.close();
 const reopened=await Library.open({directory});resources.libraries.push(reopened);
 expect(await reopened.getPlaybackCheckpoint()).toEqual(checkpoint);
}, MEDIA_TEST_TIMEOUT_MS);

mediaTest('rejects stale or mutated checkpoints and protects owned retention until explicit clear', async resources => {
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));resources.roots.push(directory);
 const library=await Library.open({directory});resources.libraries.push(library);
 async function* source(){yield Promise.resolve(gifFixture(1,1,[{width:1,height:1,pixels:[1]}]));}
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
}, MEDIA_TEST_TIMEOUT_MS);

mediaTest('rejects a checkpoint whose payload no longer matches retained session ownership', async resources => {
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));resources.roots.push(directory);
 const library=await Library.open({directory});resources.libraries.push(library);
 async function* source(){yield Promise.resolve(gifFixture(1,1,[{width:1,height:1,pixels:[1]}]));}
 const {rendition}=await library.importMedia(source(),'still.gif');
 const p=await library.createPlaylist('Corruption');await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);
 const record=await library.createPlaybackCheckpoint(p.id);
 const db=new DatabaseSync(join(directory,'catalog.sqlite'));
 try{db.prepare('UPDATE playback_checkpoint SET payload=?').run(JSON.stringify({...record,sessionId:randomUUID()}));}
 finally{db.close();}
 await expect(library.getPlaybackCheckpoint()).rejects.toMatchObject({code:'catalog-corrupt'});
}, MEDIA_TEST_TIMEOUT_MS);

mediaTest('rolls back failed snapshot replacement with the previous retention intact', async resources => {
 const directory=await mkdtemp(join(tmpdir(),'pixoo-checkpoint-'));resources.roots.push(directory);
 const library=await Library.open({directory});resources.libraries.push(library);
 async function* source(){yield Promise.resolve(gifFixture(1,1,[{width:1,height:1,pixels:[1]}]));}
 const {rendition}=await library.importMedia(source(),'still.gif');const p=await library.createPlaylist('Atomic');
 await library.replaceItems(p.id,1,[{renditionId:rendition.id}]);const record=await library.createPlaybackCheckpoint(p.id);
 const db=new DatabaseSync(join(directory,'catalog.sqlite'));
 try{db.exec("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON playback_checkpoint BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await expect(library.createPlaybackCheckpoint(p.id)).rejects.toMatchObject({code:'database-error'});
 }finally{db.close();}
 expect(await library.getPlaybackCheckpoint()).toEqual(record);
 expect((await library.listSessions()).map(s=>s.id)).toEqual([record.sessionId]);
}, MEDIA_TEST_TIMEOUT_MS);
