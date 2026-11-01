import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {privateHostDirectory} from './bunny.mjs';

export const operationRoot=()=>join(homedir(),'.local','state','bunny-operations');
const refuse=()=>{throw new Error('operation-refused');};
const absent=error=>{if(error.code==='ENOENT')return undefined;throw error;};
const validId=id=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id??'');
async function directory(path) {await mkdir(path,{recursive:true,mode:0o700});await privateHostDirectory(path);}
async function paths({root=operationRoot(),project}) {
  if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project??'')||resolve(root)!==root)refuse();
  await directory(root);
  return {root,coordination:join(root,project+'.operation'),pending:join(root,project+'.pending.json'),records:join(root,project+'.records')};
}
async function acquire(p) {
  const {takeLock}=await import('../apps/runtime/dist/src/core/lock.js');
  return takeLock(p.coordination,AbortSignal.abort());
}
async function syncDirectory(path) {const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
export async function privateJson(path) {
  const before=await lstat(path).catch(absent);if(before===undefined)return undefined;
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>1024*1024||before.uid!==process.getuid?.()
    ||(before.mode&0o7777)!==0o600||await realpath(path)!==path)refuse();
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();if(info.dev!==before.dev||info.ino!==before.ino||info.size!==before.size||info.mtimeMs!==before.mtimeMs)refuse();
    const value=JSON.parse(await file.readFile('utf8'));
    const after=await file.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)refuse();return value;
  } finally {await file.close();}
}
export async function writeNewPrivateJson(path,value) {
  const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
  await syncDirectory(resolve(path,'..'));
}
export async function writePrivateJson(path,value) {
  const temp=path+'.'+randomUUID()+'.tmp';await writeNewPrivateJson(temp,value);
  await rename(temp,path);await syncDirectory(resolve(path,'..'));
}
async function pending(p) {
  const value=await privateJson(p.pending);
  if(value!==undefined&&(!validId(value.id)||typeof value.phase!=='string'||value.phase.length>100))refuse();
  return value;
}
export async function readPending(plan) {return pending(await paths(plan));}
async function removePending(p,current) {
  const actual=await pending(p);
  if(actual?.id!==current.id||actual.ownerProcess?.token!==current.ownerProcess?.token)refuse();
  await unlink(p.pending);await syncDirectory(p.root);
}
export async function withOperation(plan,work) {
  const p=await paths(plan),lock=await acquire(p);
  const owner={pid:process.pid,host:hostname(),token:randomUUID()};
  let current,recordPath,completed=false,result;
  try {
    if(await pending(p)!==undefined)refuse();
    result=await work({
      record:async record=>{
        if(!validId(record.id)||current!==undefined&&record.id!==current.id)refuse();
        await directory(p.records);recordPath=join(p.records,record.id+'.json');
        if(current===undefined&&await privateJson(recordPath)!==undefined)refuse();
        const existing=await pending(p);
        if(existing!==undefined&&(existing.id!==current?.id||existing.ownerProcess?.token!==owner.token))refuse();
        current={...record,ownerProcess:owner,writerReleasedAt:null};
        await writePrivateJson(recordPath,current);await writePrivateJson(p.pending,current);
      },
      complete:async record=>{
        if(current===undefined||record.id!==current.id)refuse();
        current={...record,ownerProcess:owner,writerReleasedAt:null};
        await writePrivateJson(recordPath,current);await writePrivateJson(p.pending,current);completed=true;
      },
    });
    if(completed)await removePending(p,current);
  } finally {lock.release();}
  // Only this operation's unique record may change after release. Pending metadata stays under the shared lease.
  if(completed)await writePrivateJson(recordPath,{...current,writerReleasedAt:new Date().toISOString()});
  return result;
}
export async function reconcileOperation(plan,inspect) {
  const p=await paths(plan),lock=await acquire(p);
  let result,recordPath;
  try {
    const current=await pending(p);if(current===undefined)refuse();
    const observation=await inspect(current);
    result={...current,outcome:'reconciled',phase:'reconciled',observation,reconciledAt:new Date().toISOString(),writerReleasedAt:null};
    await directory(p.records);recordPath=join(p.records,current.id+'.json');
    await writePrivateJson(recordPath,result);await removePending(p,current);
  } finally {lock.release();}
  result.writerReleasedAt=new Date().toISOString();await writePrivateJson(recordPath,result);return result;
}
