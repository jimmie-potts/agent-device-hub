import {constants} from 'node:fs';
import {open,lstat,realpath,rename,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export async function privateDirectory(path:string):Promise<void>{
 if(process.platform!=='linux'||resolve(path)!==path||path==='/mnt'||path.startsWith('/mnt/')||await realpath(path)!==path)throw new Error('invalid-private-path');
 const info=await lstat(path);if(!info.isDirectory()||info.uid!==process.getuid!()||(info.mode&0o077)!==0)throw new Error('invalid-private-directory');
 for(let parent=path;;parent=dirname(parent)){
  try{const marker=await lstat(join(parent,'.git'));if(marker.isFile())throw new Error('private-path-in-checkout');await lstat(join(parent,'.git','HEAD'));throw new Error('private-path-in-checkout');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(parent===dirname(parent))break;
 }
}
export async function readPrivate(path:string,optional=false):Promise<string|null>{
 await privateDirectory(dirname(path));
 let file;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(optional&&(e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0||stat.size>4194304)throw new Error('invalid-private-file');
 const bytes=Buffer.alloc(4194305);let size=0;while(size<bytes.length){const r=await file.read(bytes,size,bytes.length-size,null);size+=r.bytesRead;if(!r.bytesRead)break;}if(size>4194304)throw new Error('private-file-limit');return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));
 }finally{await file.close();}
}
export async function replacePrivate(path:string,before:string|null,after:string):Promise<void>{
 if(Buffer.byteLength(after)>4194304)throw new Error('private-file-limit');
 if(await readPrivate(path,true)!==before)throw new Error('configuration-changed');
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(after);await file.sync();}finally{await file.close();}
 if(await readPrivate(path,true)!==before)throw new Error('configuration-changed');
 await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }finally{await rm(temporary,{force:true});}
}
