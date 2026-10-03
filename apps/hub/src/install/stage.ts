import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,open,lstat,rename,rm,readdir,cp,symlink,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {canonical,extractArchive,verifyRelease,readRegular,inventory,type Identity,type ReleaseIdentity} from './files.js';
import {privateRoot} from './plan.js';

export async function syncDirectory(path:string):Promise<void>{const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
export async function ownedDirectory(path:string):Promise<void>{await mkdir(path,{mode:0o700,recursive:true});await privateRoot(path);}
export async function writeDurable(path:string,value:unknown):Promise<void>{
 await privateRoot(dirname(path));
 try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==process.getuid!())throw new Error('unsafe-install-file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const temporary=path+'.next-'+randomUUID();
 const file=await open(temporary,'wx',0o600);
 try{await file.writeFile(canonical(value)+'\n');await file.sync();}finally{await file.close();}
 try{await rename(temporary,path);await syncDirectory(dirname(path));}finally{await rm(temporary,{force:true});}
}
async function syncTree(directory:string):Promise<void>{
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory())await syncTree(path);
  else if(entry.isFile()){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
 }
 await syncDirectory(directory);
}
export async function stageRelease(root:string,bytes:Buffer,identity:ReleaseIdentity):Promise<{path:string;identity:ReleaseIdentity}>{
 await privateRoot(root);await ownedDirectory(join(root,'releases'));await ownedDirectory(join(root,'provenance'));
 const path=join(root,'releases',identity.sourceRevision),receipt=join(root,'provenance',identity.sourceRevision+'.json');
 // The identity is validated before it is ever used as an on-disk child name.
 if(!/^[a-f0-9]{40}$/.test(identity.sourceRevision))throw new Error('install-source-identity');
 let existing=false;try{await lstat(path);existing=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(existing){
  const saved=JSON.parse((await readRegular(receipt)).toString());if(canonical(saved)!==canonical(identity))throw new Error('conflicting-install-release');
  await verifyRelease(path,identity);return {path,identity};
 }
 const scratch=await mkdtemp(join(root,'stage-'));
 try{
  const staged=join(scratch,'release');await extractArchive(bytes,staged,identity.archiveSha256);await verifyRelease(staged,identity);await syncTree(staged);
  // An interrupted publication without provenance is deliberately not reusable.
  await rename(staged,path);await syncDirectory(join(root,'releases'));await writeDurable(receipt,identity);
  return {path,identity};
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function retainLegacy(root:string,source:string,identity:Identity):Promise<string>{
 if(identity.kind!=='legacy')throw new Error('not-legacy-identity');
 if(identity.legacyId!=='legacy-'+identity.contentSha256)throw new Error('install-legacy-hash');
 if((await inventory(source)).sha256!==identity.contentSha256)throw new Error('install-baseline-changed');
 await ownedDirectory(join(root,'legacy'));const path=join(root,'legacy',identity.legacyId);
 try{await lstat(path);if((await inventory(path)).sha256!==identity.contentSha256)throw new Error('install-legacy-hash');return path;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const scratch=await mkdtemp(join(root,'legacy-stage-'));
 try{
  const copy=join(scratch,'copy');await cp(source,copy,{recursive:true,verbatimSymlinks:true,preserveTimestamps:true});
  if((await inventory(copy)).sha256!==identity.contentSha256)throw new Error('install-legacy-hash');
  await syncTree(copy);await rename(copy,path);await syncDirectory(join(root,'legacy'));return path;
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function retainRelease(root:string,source:string,identity:ReleaseIdentity):Promise<string>{
 const verified=await verifyRelease(source,identity);
 await ownedDirectory(join(root,'releases'));await ownedDirectory(join(root,'provenance'));
 const path=join(root,'releases',identity.sourceRevision),receipt=join(root,'provenance',identity.sourceRevision+'.json');
 let exists=false;try{await lstat(path);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(exists){if(canonical(JSON.parse((await readRegular(receipt)).toString()))!==canonical(identity))throw new Error('conflicting-install-release');await verifyRelease(path,identity);return path;}
 const scratch=await mkdtemp(join(root,'adoption-stage-'));
 try{
  const copy=join(scratch,'copy');await cp(source,copy,{recursive:true,verbatimSymlinks:true,preserveTimestamps:true});
  if((await verifyRelease(copy,identity)).inventory.sha256!==verified.inventory.sha256)throw new Error('install-baseline-changed');
  await syncTree(copy);await rename(copy,path);await syncDirectory(join(root,'releases'));await writeDurable(receipt,identity);return path;
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function switchCurrent(root:string,target:string):Promise<void>{
 await privateRoot(root);
 if(await realpath(target)!==target||!target.startsWith(root+'/')||!/^((releases\/[a-f0-9]{40})|(legacy\/legacy-[a-f0-9]{64}))$/.test(target.slice(root.length+1)))throw new Error('unknown-install-target');
 const anchor=join(root,'current');try{if(!(await lstat(anchor)).isSymbolicLink())throw new Error('unknown-install-anchor');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const next=join(root,'current.next-'+randomUUID());await symlink(target,next);
 try{await rename(next,anchor);await syncDirectory(root);}finally{await rm(next,{force:true});}
}
