import {constants,openSync,closeSync,fstatSync,readSync} from 'node:fs';

export type BuildIdentity = Readonly<{sourceRevision:string;version:string}>;
const unknown = ():BuildIdentity => Object.freeze({sourceRevision:'unknown',version:'unknown'});
const revision = /^[0-9a-f]{40}(?![\s\S])/;
const version = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?:\+[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?![\s\S])/;

/** Read only this executing package's metadata. Call once per Hub startup. */
export function readBuild(manifest = new URL('../manifest.json',import.meta.url)):BuildIdentity {
 let descriptor:number|undefined;
 try {
  // Reject linked metadata and avoid blocking on a special file before its type check.
  descriptor=openSync(manifest,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(!fstatSync(descriptor).isFile())return unknown();
  // Match the installer limit: packaged dependency inventories exceed 256 KiB.
  const bytes=Buffer.alloc(8*1024*1024+1),length=readSync(descriptor,bytes,0,bytes.length,0);
  if(length===bytes.length)return unknown();
  const value:unknown=JSON.parse(bytes.subarray(0,length).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))return unknown();
  const fields=value as Record<string,unknown>;
  if(fields.artifact!=='@jimmie-potts/hub')return unknown();
  return Object.freeze({
   sourceRevision:typeof fields.sourceRevision==='string'&&revision.test(fields.sourceRevision)?fields.sourceRevision:'unknown',
   version:typeof fields.version==='string'&&fields.version.length<=128&&version.test(fields.version)?fields.version:'unknown'
  });
 }catch{return unknown();}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
