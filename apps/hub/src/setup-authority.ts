import type {startHub,Credential} from './server.js';
import type {SetupAuthority} from './setup.js';
import {readPrivate,replacePrivate,digest,privateDirectory} from './setup-files.js';
import {mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {object,canonical,loopbackEndpoint} from './common.js';

async function ownedChange(directory:string,id:string,token:string,receiptDirectory:string,remove:boolean,change:()=>Promise<void>){
 if(!/^hub-[a-f0-9]{32}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid-owned-credential');
 await privateDirectory(directory);await privateDirectory(receiptDirectory);
 const path=join(directory,'setup-'+id+'.json'),lock=join(directory,'setup-authority.lock');
 try{await mkdir(lock,{mode:0o700});}catch{throw new Error('credential-owner-or-recovery-required');}
 try{
  const raw=await readPrivate(path,true),record=raw===null?null:JSON.parse(raw),identity={receiptDirectory,digest:digest(token)};
  if(record&&record.state!=='revoked'&&(record.receiptDirectory!==receiptDirectory||record.digest!==identity.digest))throw new Error('source-ownership-conflict');
  if(remove&&record?.state==='revoked'&&(record.receiptDirectory!==receiptDirectory||record.digest!==identity.digest))throw new Error('source-ownership-conflict');
  const next=JSON.stringify({...identity,state:'active'})+'\n';await replacePrivate(path,raw,next);
  await change();
  if(remove)await replacePrivate(path,next,JSON.stringify({...identity,state:'revoked'})+'\n');
 }finally{await rm(lock,{recursive:true});}
}

/** Compose with the exact live host started from this private configuration.
 * The caller owns the host lifetime; this adapter never starts or signals services.
 */
export function hubSetupAuthority(hub:Awaited<ReturnType<typeof startHub>>,configuration:string):SetupAuthority{
 let busy=false;
 async function change(id:string,token:string,remove:boolean){
  if(busy)throw new Error('credential-update-in-progress');busy=true;
  try{
   if(!/^hub-[a-f0-9]{32}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid-owned-credential');
   const raw=(await readPrivate(configuration))!,value=JSON.parse(raw);
   if(!object(value)||!Array.isArray(value.credentials)||value.ownerId!==hub.ownerId)throw new Error('wrong-host-configuration');
   // Validate the entire persisted configuration belongs to this host before editing.
   if(value.directory!==hub.directory)throw new Error('wrong-host-configuration');
   const owned:Credential={id,digest:digest(token),scopes:['ingest'],devices:[]};
   const existing=value.credentials.find((c:Credential)=>c.id===id);
   if(existing&&canonical(existing)!==canonical(owned))throw new Error('credential-ownership-conflict');
   const next=value.credentials.filter((c:Credential)=>c.id!==id) as Credential[];
   if(!remove)next.push(owned);
   // Reject bad proposals before changing the file or the running host.
   hub.validateCredentials(next);
   await replacePrivate(configuration,raw,JSON.stringify({...value,credentials:next},null,2)+'\n');
   hub.replaceCredentials(next);
   const response=await fetch(hub.url+'/api/hub/v1/authority?scope=ingest',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(2000)});
   await response.body?.cancel();
   if(response.status!==(remove?401:200))throw new Error('credential-state-unverified');
  }finally{busy=false;}
 }
 return {grant:(id,token,owner)=>ownedChange(hub.directory,id,token,owner,false,()=>change(id,token,false)),revoke:(id,token,owner)=>ownedChange(hub.directory,id,token,owner,true,()=>change(id,token,true))};
}

/** Adopt an explicitly preprovisioned Pixoo monitor principal. The owning CLI
 * creates/revokes credentials; Hub only verifies its documented digest record.
 */
export function pixooSetupAuthority(input:{dataDirectory:string;endpoint:string;node:string;managementEntrypoint:string}):SetupAuthority{
 const check=async(id:string,token:string)=>{
  if(!/^hub-[a-f0-9]{32}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid-owned-credential');
  const value=JSON.parse((await readPrivate(join(input.dataDirectory,'agent-monitor','mcp-credentials.json')))!);
  const principal=value.principals?.find((p:{id:string})=>p.id===id);
  if(value.version!==1||!principal||principal.digest!==digest(token)||canonical(principal.scopes)!==canonical(['read','control']))throw new Error('credential-ownership-conflict');
  return principal;
 };
 const verify=async(token:string,expected:number)=>{const response=await fetch(input.endpoint+'/sessions',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(2500)});await response.body?.cancel();if(response.status!==expected)throw new Error('credential-state-unverified');};
 if(loopbackEndpoint(input.endpoint).pathname!=='/api/monitor/v1'||resolve(input.node)!==input.node||resolve(input.managementEntrypoint)!==input.managementEntrypoint)throw new Error('invalid-authority');
 return {
  async grant(id,token,owner){await ownedChange(join(input.dataDirectory,'agent-monitor'),id,token,owner,false,async()=>{const principal=await check(id,token);if(principal.enabled!==true)throw new Error('credential-revoked');await verify(token,200);});},
  async revoke(id,token,owner){await ownedChange(join(input.dataDirectory,'agent-monitor'),id,token,owner,true,async()=>{const principal=await check(id,token);if(principal.enabled){await new Promise<void>((done,reject)=>{
   const child=spawn(input.node,[input.managementEntrypoint,'revoke',input.dataDirectory,id],{env:{},stdio:'ignore'});const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
   child.once('error',()=>{clearTimeout(timer);reject(new Error('credential-revocation-failed'));});child.once('close',code=>{clearTimeout(timer);code===0?done():reject(new Error('credential-revocation-failed'));});
  });}if((await check(id,token)).enabled!==false)throw new Error('credential-state-unverified');await verify(token,401);});}
 };
}
