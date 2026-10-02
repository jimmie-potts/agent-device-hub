import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {constants} from 'node:fs';
import {lstat,open,readdir,readlink,realpath,mkdir,rm} from 'node:fs/promises';
import {isAbsolute,join,dirname,resolve,sep} from 'node:path';

export const sha256 = (bytes: string|Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',') + '}';
  const result=JSON.stringify(value);if(result===undefined)throw new Error('invalid-install-value');return result;
}
export type ReleaseIdentity={kind:'release';sourceRevision:string;version:string;archiveSha256:string;manifestSha256:string};
export type LegacyIdentity={kind:'legacy';legacyId:string;sourceRevision:'unknown';contentSha256:string;manifestSha256:string};
export type Identity=ReleaseIdentity|LegacyIdentity;
export type InventoryEntry={path:string;kind:'file'|'directory'|'link';mode:number;sha256?:string;target?:string};
export type Inventory={entries:InventoryEntry[];sha256:string};
export const fullRevision=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inside=(root:string,path:string)=>path===root||path.startsWith(root+sep);
export function safeRelative(path:string):boolean{return !!path&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');}

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

/** Sorted relative names, types, permission modes, bytes and link targets form the legacy digest. */
export async function inventory(directory:string):Promise<Inventory>{
 const root=resolve(directory);const stat=await lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)throw new Error('unsafe-install-root');
 const entries:InventoryEntry[]=[];let total=0;
 async function visit(prefix:string):Promise<void>{
  for(const name of (await readdir(join(root,prefix))).sort()){
   const path=prefix?prefix+'/'+name:name;if(!safeRelative(path)||path.length>4096||entries.length>=100000)throw new Error('install-inventory-capacity');
   const absolute=join(root,path),info=await lstat(absolute),mode=info.mode&0o777;
   if(info.isSymbolicLink()){
    const target=await readlink(absolute);
    if(isAbsolute(target)||!inside(root,resolve(absolute,'..',target))||!inside(root,await realpath(absolute)))throw new Error('unsafe-install-link');
    entries.push({path,kind:'link',mode,target});
   }else if(info.isDirectory()){
    entries.push({path,kind:'directory',mode});await visit(path);
   }else if(info.isFile()){
    total+=info.size;if(total>512*1024*1024)throw new Error('install-inventory-capacity');
    entries.push({path,kind:'file',mode,sha256:sha256(await readRegular(absolute))});
   }else throw new Error('unsafe-install-entry');
  }
 }
 await visit('');return {entries,sha256:sha256(canonical(entries))};
}

/** Expected hashes come from the clean build receipt, never from untrusted archive metadata alone. */
export async function verifyRelease(directory:string,expected:ReleaseIdentity):Promise<{identity:ReleaseIdentity;inventory:Inventory}>{
 if(expected.kind!=='release'||!fullRevision(expected.sourceRevision)||!digest(expected.archiveSha256)||!digest(expected.manifestSha256))throw new Error('install-source-identity');
 const bytes=await readRegular(join(directory,'manifest.json'),8*1024*1024);
 if(sha256(bytes)!==expected.manifestSha256)throw new Error('install-manifest-hash');
 const manifest=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;
 if(manifest.artifact!=='@jimmie-potts/hub'||manifest.sourceRevision!==expected.sourceRevision||manifest.version!==expected.version)throw new Error('install-source-identity');
 const hashes:Record<string,string>={};
 for(const [name,isDependency] of [['files',false],['dependencyFiles',true]] as const){
  const map=manifest[name];if(!map||typeof map!=='object'||Array.isArray(map))throw new Error('install-file-inventory');
  for(const [path,value] of Object.entries(map)){
   if(!safeRelative(path)||path==='manifest.json'||path.startsWith('node_modules/')!==isDependency||!digest(value)||Object.hasOwn(hashes,path))throw new Error('install-file-inventory');
   hashes[path]=value;
  }
 }
 const actual=await inventory(directory);
 if(actual.entries.some(entry=>entry.kind==='link'))throw new Error('unsafe-install-link');
 const files=actual.entries.filter(entry=>entry.kind==='file'&&entry.path!=='manifest.json');
 if(files.length!==Object.keys(hashes).length||files.some(entry=>!Object.hasOwn(hashes,entry.path)))throw new Error('install-file-inventory');
 if(files.some(entry=>entry.sha256!==hashes[entry.path]))throw new Error('install-file-hash');
 return {identity:structuredClone(expected),inventory:actual};
}

/** Accept the bounded regular-file ustar subset emitted by the pinned npm pack producer. */
export async function extractArchive(bytes:Buffer,destination:string,expectedSha256:string):Promise<void>{
 if(!digest(expectedSha256)||sha256(bytes)!==expectedSha256)throw new Error('install-archive-hash');
 const fail=():never=>{throw new Error('unsafe-install-archive');};
 let tar:Buffer;try{tar=gunzipSync(bytes,{maxOutputLength:128*1024*1024});}catch{return fail();}
 const entries:{path:string;mode:number;bytes:Buffer;directory:boolean}[]=[];const names=new Set<string>();
 const text=(buffer:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(buffer).replace(/\0.*$/s,'');
 const number=(buffer:Buffer):number=>{const value=text(buffer).trim();if(!/^[0-7]+$/.test(value))return fail();const result=parseInt(value,8);if(!Number.isSafeInteger(result))return fail();return result;};
 let offset=0,ended=false;
 while(offset+512<=tar.length){
  const header=tar.subarray(offset,offset+512);offset+=512;
  if(header.every(value=>value===0)){if(tar.length-offset<512||tar.subarray(offset).some(value=>value!==0))return fail();ended=true;break;}
  const checksum=header.reduce((sum,value,index)=>sum+(index>=148&&index<156?32:value),0);if(checksum!==number(header.subarray(148,156)))return fail();
  if(text(header.subarray(257,263))!=='ustar')return fail();
  const prefix=text(header.subarray(345,500)),name=text(header.subarray(0,100));let path=(prefix?prefix+'/':'')+name;
  const type=header[156],directory=type===53;if(type!==0&&type!==48&&!directory)return fail();
  if(directory)path=path.replace(/\/$/,'');
  const size=number(header.subarray(124,136));if(directory&&size!==0)return fail();
  if(path==='package'&&directory)continue;
  if(!path.startsWith('package/'))return fail();path=path.slice(8);
  if(!safeRelative(path)||names.has(path)||entries.length>=100000||offset+size>tar.length)return fail();
  names.add(path);const mode=number(header.subarray(100,108));if(mode&0o7000)return fail();
  entries.push({path,mode:mode&0o777,bytes:tar.subarray(offset,offset+size),directory});offset+=Math.ceil(size/512)*512;
 }
 if(!ended||!entries.length||offset>tar.length)return fail();
 const kinds=new Map(entries.map(entry=>[entry.path,entry.directory]));
 for(const entry of entries){for(let parent=dirname(entry.path);parent!=='.';parent=dirname(parent)){if(kinds.get(parent)===false)return fail();}}
 const parent=dirname(resolve(destination));if(await realpath(parent)!==parent)throw new Error('unsafe-install-root');
 await mkdir(destination,{mode:0o700});
 try{
  for(const entry of entries){
   const path=join(destination,entry.path);await mkdir(entry.directory?path:dirname(path),{recursive:true,mode:0o755});
   if(entry.directory)continue;
   const file=await open(path,'wx',entry.mode);try{await file.writeFile(entry.bytes);await file.sync();}finally{await file.close();}
  }
 }catch(error){await rm(destination,{recursive:true,force:true});throw error;}
}
