import {constants} from 'node:fs';
import {open,lstat,mkdir,readdir,rename,unlink} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hashRegular} from '../../hub/dist/install/files.js';

// Trusted native executables can exceed the separate private-content read bound.
export const fingerprintRegular=(path:string):Promise<string>=>hashRegular(path,512*1024*1024);

export function requireValue(value:unknown,reason:string):asserts value {if(!value)throw new Error(reason);}
export async function privateDirectory(path:string):Promise<void> {
  requireValue(isAbsolute(path)&&resolve(path)===path,'unsafe-directory');
  await mkdir(path,{recursive:true,mode:0o700});
  let current=path;
  while(true){
    const info=await lstat(current);
    requireValue(info.isDirectory()&&!info.isSymbolicLink(),'unsafe-directory');
    if(current===path)requireValue(info.uid===process.getuid?.()&&(info.mode&0o077)===0,'unsafe-directory');
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
}
export async function readRegular(path:string,maxBytes:number,privateOnly=false):Promise<Buffer> {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK).catch(error=>{if(error.code==='ENOENT')throw error;throw new Error('unsafe-file');});
  try{
    const info=await file.stat();
    requireValue(info.isFile()&&info.size<=maxBytes&&(!privateOnly||(info.uid===process.getuid?.()&&(info.mode&0o077)===0)),'unsafe-file');
    const buffer=Buffer.alloc(info.size+1);let total=0;
    while(total<buffer.length){const {bytesRead}=await file.read(buffer,total,buffer.length-total,total);if(!bytesRead)break;total+=bytesRead;}
    requireValue(total===info.size,'unsafe-file');return buffer.subarray(0,total);
  }finally{await file.close();}
}
// The shared supervisor holds the one writer claim. This is durable storage,
// not a second scheduling/locking service. No retention is implied by capacity.
export class PrivateStore {
  constructor(readonly root:string,readonly maxBytes:number){}
  async open(){await privateDirectory(this.root);}
  path(name:string){requireValue(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/.test(name),'unsafe-name');return join(this.root,name);}
  async usage():Promise<number>{
    let total=0;const names=await readdir(this.root);requireValue(names.length<100000,'evidence-capacity');
    for(const name of names){const info=await lstat(join(this.root,name));requireValue(info.isFile()&&!info.isSymbolicLink(),'unsafe-evidence-entry');total+=info.size;}
    return total;
  }
  async capacity(bytes:number){requireValue(await this.usage()+bytes<=this.maxBytes,'evidence-capacity');}
  async read(name:string):Promise<any>{
    try{return JSON.parse((await readRegular(this.path(name),Math.min(this.maxBytes,128*1024*1024),true)).toString('utf8'));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  }
  async save(name:string,value:unknown){
    const bytes=Buffer.from(JSON.stringify(value)+'\n');await this.capacity(bytes.length);
    const destination=this.path(name),temporary=this.path('pending-'+randomUUID());
    const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    try{
      await rename(temporary,destination);
      const directory=await open(this.root,constants.O_RDONLY|constants.O_DIRECTORY);
      try{await directory.sync();}finally{await directory.close();}
    }catch(error){await unlink(temporary).catch(()=>{});throw error;}
  }
}
