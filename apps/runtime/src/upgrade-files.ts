// Provenance (#839): the file helpers the runtime upgrade tools and apps/runtime/UPGRADE.md use, copied from
// apps/hub/src/install/files.ts at main 79ac721b so they no longer import the retained legacy Hub. Only the three
// strict-profile rewrites listed in tests/upgrade-files-provenance.test.ts differ; that test checks the copy while
// the Hub exists and is deleted with it.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,readlink,realpath} from 'node:fs/promises';
import {isAbsolute,join,resolve,sep} from 'node:path';

export const sha256 = (bytes: string|Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',') + '}';
  const result=JSON.stringify(value);if(result===undefined)throw new Error('invalid-install-value');return result;
}
export type InventoryEntry={path:string;kind:'file'|'directory'|'link';mode:number;sha256?:string;target?:string};
export type Inventory={entries:InventoryEntry[];sha256:string};
export const fullRevision=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inside=(root:string,path:string)=>path===root||path.startsWith(root+sep);
export function safeRelative(path:string):boolean{return Boolean(path)&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');}

/** Bounded no-follow read. Installation evidence must not silently follow changed files. */
export async function readRegular(path:string,maximum=64*1024*1024):Promise<Buffer>{
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();if(!before.isFile()||before.nlink!==1||before.size>maximum)throw new Error('unsafe-install-file');
  const bytes=await file.readFile();const after=await file.stat();
  if(bytes.length>maximum||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('install-file-changed');
  return bytes;
 }finally{await file.close();}
}

/** Shared executables exceed the release-file read bound; hash them with bounded memory. */
export async function hashRegular(path:string,maximum=256*1024*1024):Promise<string>{
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();if(!before.isFile()||before.nlink!==1||before.size>maximum)throw new Error('unsafe-install-file');
  const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024);let total=0;
  for(;;){const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(bytesRead===0)break;total+=bytesRead;if(total>maximum)throw new Error('install-file-changed');hash.update(buffer.subarray(0,bytesRead));}
  const after=await file.stat();
  if(total!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('install-file-changed');
  return hash.digest('hex');
 }finally{await file.close();}
}

/** Sorted relative names, types, permission modes, bytes and link targets form the legacy digest. */
export async function inventory(directory:string,maximumFileBytes=64*1024*1024):Promise<Inventory>{
 if(!Number.isSafeInteger(maximumFileBytes)||maximumFileBytes<1||maximumFileBytes>256*1024*1024)throw new Error('install-inventory-capacity');
 const root=resolve(directory);const stat=await lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)throw new Error('unsafe-install-root');
 const entries:InventoryEntry[]=[];let total=0;
 async function visit(prefix:string):Promise<void>{
  for(const name of (await readdir(join(root,prefix))).sort()){
   const path=prefix!==''?prefix+'/'+name:name;if(!safeRelative(path)||path.length>4096||entries.length>=100000)throw new Error('install-inventory-capacity');
   const absolute=join(root,path),info=await lstat(absolute),mode=info.mode&0o777;
   if(info.isSymbolicLink()){
    const target=await readlink(absolute);
    if(isAbsolute(target)||!inside(root,resolve(absolute,'..',target))||!inside(root,await realpath(absolute)))throw new Error('unsafe-install-link');
    entries.push({path,kind:'link',mode,target});
   }else if(info.isDirectory()){
    entries.push({path,kind:'directory',mode});await visit(path);
   }else if(info.isFile()){
    total+=info.size;if(total>512*1024*1024)throw new Error('install-inventory-capacity');
    entries.push({path,kind:'file',mode,sha256:await hashRegular(absolute,maximumFileBytes)});
   }else throw new Error('unsafe-install-entry');
  }
 }
 await visit('');return {entries,sha256:sha256(canonical(entries))};
}
