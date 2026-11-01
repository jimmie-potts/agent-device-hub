import {mkdir,lstat,realpath,open,readFile,rename,unlink,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {privateHostDirectory} from './bunny.mjs';

export const operationRoot=()=>join(homedir(),'.local','state','bunny-operations');
const refuse=()=>{throw new Error('operation-refused');};
const absent=error=>{if(error.code==='ENOENT')return undefined;throw error;};
async function directory(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  await privateHostDirectory(path);
}
async function paths({root=operationRoot(),project}) {
  if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project??'') || resolve(root)!==root)refuse();
  await directory(root);
  return {root,lock:join(root,project+'.lock'),pending:join(root,project+'.pending.json'),records:join(root,project+'.records')};
}
async function syncDirectory(path) {const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
export async function privateJson(path) {
  const info=await lstat(path).catch(absent);if(info===undefined)return undefined;
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o7777)!==0o600||await realpath(path)!==path)refuse();
  return JSON.parse(await readFile(path,'utf8'));
}
export async function writePrivateJson(path,value) {
  const temp=path+'.'+randomUUID()+'.tmp';
  const file=await open(temp,'wx',0o600);
  try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
  await rename(temp,path);await syncDirectory(resolve(path,'..'));
}
export async function readPending(plan) {const p=await paths(plan);return privateJson(p.pending);}
export async function withOperation(plan,work) {
  const p=await paths(plan);
  if(await privateJson(p.pending)!==undefined)refuse();
  await mkdir(p.lock,{mode:0o700});
  const owner={pid:process.pid,host:hostname(),token:randomUUID()};
  await writePrivateJson(join(p.lock,'owner.json'),owner);
  let current,recordPath,completed=false;
  try {
    if(await privateJson(p.pending)!==undefined)refuse();
    return await work({
      record:async record=>{
        if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(record.id??''))refuse();
        if(current!==undefined&&record.id!==current.id)refuse();
        await directory(p.records);recordPath=join(p.records,record.id+'.json');
        if(current===undefined&&await privateJson(recordPath)!==undefined)refuse();
        current={...record,ownerProcess:owner,writerReleasedAt:null};
        await writePrivateJson(recordPath,current);await writePrivateJson(p.pending,current);
      },
      complete:async record=>{
        if(current===undefined||record.id!==current.id)refuse();
        current={...record,ownerProcess:owner,writerReleasedAt:null};
        await writePrivateJson(recordPath,current);await writePrivateJson(p.pending,current);completed=true;
      },
    });
  } finally {
    const actual=await privateJson(join(p.lock,'owner.json'));
    if(actual?.token!==owner.token)refuse();
    await unlink(join(p.lock,'owner.json'));await rmdir(p.lock);await syncDirectory(p.root);
    if(completed){await writePrivateJson(recordPath,{...current,writerReleasedAt:new Date().toISOString()});await unlink(p.pending);await syncDirectory(p.root);}
  }
}
export async function reconcileOperation(plan,inspect) {
  const p=await paths(plan);
  const gate=p.lock+'.reconcile';await mkdir(gate,{mode:0o700});
  try {
    const owner=await privateJson(join(p.lock,'owner.json'));
    if(owner!==undefined) {
      if(owner.host!==hostname()||!Number.isSafeInteger(owner.pid)||owner.pid<1)refuse();
      try{process.kill(owner.pid,0);refuse();}catch(error){if(error.code!=='ESRCH')throw error;}
    } else if(await lstat(p.lock).catch(absent)!==undefined)refuse();
    const pending=await privateJson(p.pending);
    if(pending===undefined&&owner===undefined)refuse();
    const observation=await inspect(pending);
    const result={...pending,outcome:'reconciled',phase:'reconciled',observation,reconciledAt:new Date().toISOString(),writerReleasedAt:null};
    await directory(p.records);
    const recordPath=join(p.records,(pending?.id??'abandoned-'+randomUUID())+'.json');
    await writePrivateJson(recordPath,result);
    await writePrivateJson(p.pending,result);
    if(owner!==undefined){await unlink(join(p.lock,'owner.json'));await rmdir(p.lock);}
    await syncDirectory(p.root);
    result.writerReleasedAt=new Date().toISOString();await writePrivateJson(recordPath,result);await unlink(p.pending);await syncDirectory(p.root);return result;
  } finally {await rmdir(gate);}
}
