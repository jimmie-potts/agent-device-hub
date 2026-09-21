import type {startHub,Credential} from './server.js';
import type {SetupAuthority} from './setup.js';
import {readPrivate,replacePrivate,digest} from './setup-files.js';
import {object,canonical} from './common.js';

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
 return {grant:(id,token)=>change(id,token,false),revoke:(id,token)=>change(id,token,true)};
}
