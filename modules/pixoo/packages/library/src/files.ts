import { lstat, open, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashSchema, idSchema, LibraryError, validate } from './contracts.js';
const errno=(e:unknown)=>(e as NodeJS.ErrnoException)?.code;
export async function databaseFile(path:string):Promise<void> {
  for(const suffix of ['', '-wal','-shm','-journal']) {
    try {if(!(await lstat(path+suffix)).isFile())throw new LibraryError('storage-error');}
    catch(e) {if(errno(e)!=='ENOENT')throw e;}
  }
  try {const file=await open(path,'wx',0o600);await file.close();} catch(e) {if(errno(e)!=='EEXIST')throw e;}
}
export async function acquireOwner(path:string):Promise<DatabaseSync> {
  await databaseFile(path);
  let owner:DatabaseSync|undefined;
  try {
    owner=new DatabaseSync(path,{timeout:0});
    owner.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
    return owner;
  } catch(e) {owner?.close();if(String((e as Error).message).includes('locked'))throw new LibraryError('busy');throw new LibraryError('storage-error');}
}
export async function recoverStaging(mediaDirectory:string):Promise<void> {
  const root=join(mediaDirectory,'staging');
  for(const entry of await readdir(root,{withFileTypes:true}))
    if(entry.isDirectory() && /^request-[a-zA-Z0-9]{6}$/.test(entry.name)) await rm(join(root,entry.name),{recursive:true,force:true});
}
async function orphanNeedsOriginal(db:DatabaseSync,mediaDirectory:string,contentHash:string):Promise<boolean> {
  const root = join(mediaDirectory,'renditions');
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(!hashSchema.safeParse(entry.name).success || db.prepare('SELECT id FROM renditions WHERE id=?').get(entry.name)) continue;
    // An unregistered renderer output can still own this original. Unknown or damaged
    // manifests cannot prove otherwise, so retain rather than destroy their source.
    if(!entry.isDirectory()) return true;
    try {
      const path = join(root,entry.name,'manifest.json'), info = await lstat(path);
      if(!info.isFile() || info.size>1024*1024) return true;
      const manifest = JSON.parse(await readFile(path,'utf8')) as {sourceHash?:unknown};
      if(!hashSchema.safeParse(manifest.sourceHash).success || manifest.sourceHash===contentHash) return true;
    } catch {return true;}
  }
  return false;
}
export async function cleanup(db:DatabaseSync,mediaDirectory:string):Promise<void> {
  for(const row of db.prepare('SELECT * FROM cleanup_jobs ORDER BY asset_id').all()) {
    const assetId=String(row.asset_id);
    try {
      validate(idSchema,assetId); const contentHash=validate(hashSchema,row.content_hash);
      const ids=JSON.parse(String(row.rendition_ids)) as unknown;
      if(!Array.isArray(ids))throw new Error();
      // Never process a stale journal entry that now has live catalog ownership.
      if(db.prepare('SELECT id FROM assets WHERE content_hash=?').get(contentHash))throw new Error();
      for(const id of ids) {
        const path=join(mediaDirectory,'renditions',validate(hashSchema,id));
        if(db.prepare('SELECT id FROM renditions WHERE id=?').get(String(id)))throw new Error();
        try {if(!(await lstat(path)).isDirectory())throw new Error();await rm(path,{recursive:true,force:true});}
        catch(e) {if(errno(e)!=='ENOENT')throw e;}
      }
      const original=join(mediaDirectory,'originals',contentHash);
      if(!await orphanNeedsOriginal(db,mediaDirectory,contentHash)) {
        try {if(!(await lstat(original)).isFile())throw new Error();await rm(original);}
        catch(e) {if(errno(e)!=='ENOENT')throw e;}
      }
      db.prepare('DELETE FROM cleanup_jobs WHERE asset_id=?').run(assetId);
    } catch {throw new LibraryError('cleanup-pending',{assetId});}
  }
}
