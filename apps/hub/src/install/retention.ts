import {lstat,readdir,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {canonical,readRegular,inventory,verifyRelease,type Identity,type ReleaseIdentity} from './files.js';
import {privateRoot} from './plan.js';
import {syncDirectory} from './stage.js';
import type {Receipt} from './operation.js';

async function receipts(root:string){
 await privateRoot(root);const values:{path:string;receipt:Receipt;modified:bigint}[]=[];
 for(const name of await readdir(join(root,'receipts'))){
  if(!/^op-[a-f0-9-]+\.json$/.test(name))continue;
  const path=join(root,'receipts',name),receipt=JSON.parse((await readRegular(path)).toString()) as Receipt;
  if(!validateInstallReceipt(receipt)||!['succeeded','failed-rolled-back','refused'].includes(receipt.outcome))throw new Error('install-operation-unresolved');
  values.push({path,receipt,modified:(await lstat(path,{bigint:true})).mtimeNs});
 }
 return values.sort((a,b)=>b.receipt.updatedAt.localeCompare(a.receipt.updatedAt)||(a.modified>b.modified?-1:a.modified<b.modified?1:a.path.localeCompare(b.path)));
}
async function verified(root:string,identity:Identity){
 const path=identity.kind==='release'?join(root,'releases',identity.sourceRevision):join(root,'legacy',identity.legacyId);
 if(identity.kind==='release'){
  const provenance=JSON.parse((await readRegular(join(root,'provenance',identity.sourceRevision+'.json'))).toString());
  if(canonical(provenance)!==canonical(identity))throw new Error('install-source-identity');await verifyRelease(path,identity);
 }else if((await inventory(path)).sha256!==identity.contentSha256)throw new Error('install-legacy-hash');
 return {path,identity};
}
export async function selectRollback(root:string,current:Identity,request?:string):Promise<{path:string;identity:Identity}>{
 const history=await receipts(root);
 if(request){
  if(!/^[a-f0-9]{40}$/.test(request))throw new Error('invalid-install-target');
  const identity=JSON.parse((await readRegular(join(root,'provenance',request+'.json'))).toString()) as ReleaseIdentity;
  if(identity.kind!=='release'||identity.sourceRevision!==request)throw new Error('install-source-identity');
  return verified(root,identity);
 }
 const previous=history.find(row=>row.receipt.outcome==='succeeded'&&canonical(row.receipt.target)===canonical(current))?.receipt.previous;
 if(!previous)throw new Error('install-recovery-target-unknown');return verified(root,previous);
}
/** Called under the operation lock, only after the successful receipt is durable and read back. */
export async function pruneReleases(root:string,successPath:string,protectedIdentities:Identity[]):Promise<{removed:string[];retained:string[]}>{
 await privateRoot(join(root,'install.lock'));
 const history=await receipts(root),success=history.find(row=>row.path===successPath)?.receipt;
 if(!success||success.outcome!=='succeeded'||!success.target)throw new Error('install-retention-before-success');
 const current=await realpath(join(root,'current'));
 const selected=await verified(root,success.target);if(current!==selected.path)throw new Error('install-current-changed');
 const keep=new Set<string>();
 if(success.target.kind==='release')keep.add(success.target.sourceRevision);
 let previous=0;
 for(const row of history){
  const identity=row.receipt.target;
  if(row.receipt.outcome!=='succeeded'||identity?.kind!=='release'||keep.has(identity.sourceRevision))continue;
  if(previous++<3)keep.add(identity.sourceRevision);
 }
 for(const identity of protectedIdentities)if(identity.kind==='release')keep.add(identity.sourceRevision);
 const removed:string[]=[],retained:string[]=[];
 for(const name of await readdir(join(root,'releases'))){
  if(!/^[a-f0-9]{40}$/.test(name))continue;
  const path=join(root,'releases',name),stat=await lstat(path);
  if(keep.has(name)||!stat.isDirectory()||stat.isSymbolicLink()){retained.push(name);continue;}
  const identity=history.find(row=>row.receipt.outcome==='succeeded'&&row.receipt.target?.kind==='release'&&row.receipt.target.sourceRevision===name)?.receipt.target;
  if(!identity){retained.push(name);continue;}
  try{await verified(root,identity);}catch{retained.push(name);continue;}
  await rm(path,{recursive:true});await syncDirectory(join(root,'releases'));removed.push(name);
 }
 return {removed,retained};
}
