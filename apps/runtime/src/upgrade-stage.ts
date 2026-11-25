// Provenance (#839): the release primitives apps/runtime/UPGRADE.md runs, copied from apps/hub/src/install/plan.ts
// (optionalStat, privateRoot) and stage.ts (syncDirectory, switchCurrent) at main 79ac721b. Only the strict-profile
// rewrite listed in tests/upgrade-files-provenance.test.ts differs; that test checks the copy while the Hub exists.
import {randomUUID} from 'node:crypto';
import {lstat,open,realpath,rename,rm,symlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';

async function optionalStat(path:string){try{return await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export async function privateRoot(path:string,allowMissing=false):Promise<void>{
 const info=await optionalStat(path);
 if(!info&&allowMissing){let parent=dirname(resolve(path));while(!await optionalStat(parent)){if(parent===dirname(parent))throw new Error('unsafe-install-root');parent=dirname(parent);}if(await realpath(parent)!==parent)throw new Error('unsafe-install-root');return;}
 if(!info||!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path)||info.uid!==(process.getuid as ()=>number)()||(info.mode&0o077)!==0)throw new Error('unsafe-install-root');
}
export async function syncDirectory(path:string):Promise<void>{const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
export async function switchCurrent(root:string,target:string):Promise<void>{
 await privateRoot(root);
 if(await realpath(target)!==target||!target.startsWith(root+'/')||!/^((releases\/[a-f0-9]{40})|(legacy\/legacy-[a-f0-9]{64}))$/.test(target.slice(root.length+1)))throw new Error('unknown-install-target');
 const anchor=join(root,'current');try{if(!(await lstat(anchor)).isSymbolicLink())throw new Error('unknown-install-anchor');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const next=join(root,'current.next-'+randomUUID());await symlink(target,next);
 try{await rename(next,anchor);await syncDirectory(root);}finally{await rm(next,{force:true});}
}
