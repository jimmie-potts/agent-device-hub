import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Match a native executable's size without retaining a binary or allocating it.
export const executableBytes=286844264;
let expected;
export async function largeTrustedFile(directory){
 const path=join(directory,'large-trusted-file');
 const file=await open(path,'wx',0o600);
 try{await file.truncate(executableBytes);}finally{await file.close();}
 if(!expected){
  const hash=createHash('sha256'),zeros=Buffer.alloc(64*1024);
  for(let remaining=executableBytes;remaining>0;remaining-=zeros.length)hash.update(zeros.subarray(0,Math.min(remaining,zeros.length)));
  expected=hash.digest('hex');
 }
 return {path,sha256:expected};
}
