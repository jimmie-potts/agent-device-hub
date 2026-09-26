import {join,resolve,dirname} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createEmitter,type SourceConfiguration} from '@jimmie-potts/agent-state/providers';
import {object,loopbackEndpoint,canonical} from './common.js';
import {digest,privateDirectory,readPrivate,replacePrivate} from './setup-files.js';

export type SetupInput={directory:string;target:string;source:SourceConfiguration;endpoint:string;node:string;hook:string;owner:string;qualified:boolean;lifecycleVersion?:'1.1';windowsDistribution?:string;credentialFile?:string};
/** Implementations must persist grants/revocations and confirm the active owner's access state before resolving. */
export type SetupAuthority={grant:(id:string,token:string,receiptDirectory:string)=>Promise<void>;revoke:(id:string,token:string,receiptDirectory:string)=>Promise<void>};
type Entry={event:string;group:{hooks:{type:string;command:string;timeout:number;commandWindows?:string}[]}};
type Receipt={version:1;state:'applying'|'installed'|'removing'|'removed';input:SetupInput;id:string;token:string;entries:Entry[];before:string;after:string;removal?:{before:string;after:string}};
const encode=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
const quote=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'";
export function hookCommand(node:string,hook:string,config:string,distribution?:string):{command:string;commandWindows?:string}{
 for(const path of [node,hook,config])if(resolve(path)!==path||/[\r\n\0]/.test(path))throw new Error('invalid-command-path');
 const command=[node,hook,config].map(quote).join(' ');
 if(distribution===undefined)return {command};
 // cmd.exe metacharacters and expansion are forbidden, even inside double quotes.
 if(!/^[A-Za-z0-9_.-]{1,80}$/.test(distribution)||[node,hook,config].some(v=>!/^\/[A-Za-z0-9_./ -]+$/.test(v)))throw new Error('unsupported-windows-command');
 return {command,commandWindows:['wsl.exe','--distribution',distribution,'--exec',node,hook,config].map(v=>'"'+v+'"').join(' ')};
}
function validate(input:SetupInput){
 if(!object(input)||Object.keys(input).some(k=>!['directory','target','source','endpoint','node','hook','owner','qualified','windowsDistribution','credentialFile','lifecycleVersion'].includes(k))||input.lifecycleVersion!==undefined&&input.lifecycleVersion!=='1.1'||typeof input.qualified!=='boolean'||!input.owner||!/^[A-Za-z0-9_.-]{1,128}$/.test(input.owner))throw new Error('invalid-setup');
 if(input.windowsDistribution!==undefined&&input.source.provider!=='codex')throw new Error('unsupported-windows-client');
 const emitter=createEmitter({source:input.source,enabled:false,send:async()=>{}});emitter.close();
 if(loopbackEndpoint(input.endpoint).pathname!=='/api/monitor/v1/events')throw new Error('invalid-endpoint');
 if(input.target===join(input.directory,'receipt.json')||input.target===join(input.directory,'producer.json'))throw new Error('overlapping-setup');
 hookCommand(input.node,input.hook,join(input.directory,'producer.json'),input.windowsDistribution);
}
export function producerPrincipal(input:SetupInput){const {hook,...source}=input.source;return 'hub-'+digest(canonical(source)).slice(0,32);}
function entries(input:SetupInput):Entry[]{
 const command=hookCommand(input.node,input.hook,join(input.directory,'producer.json'),input.windowsDistribution);
 const events=['SessionStart','UserPromptSubmit','PermissionRequest','Stop','SessionEnd','SubagentStart','SubagentStop',...(input.source.provider==='codex'?['Interrupt']:[])];
 return events.map(event=>({event,group:{hooks:[{type:'command',...command,timeout:3}]}}));
}
function config(text:string){if(Buffer.byteLength(text)>262144)throw new Error('client-configuration-limit');const value=JSON.parse(text);
 const pending:[unknown,number][]=[[value,0]];let nodes=0;while(pending.length){const [item,depth]=pending.pop()!;if(++nodes>10000||depth>20)throw new Error('client-configuration-limit');if(item&&typeof item==='object')for(const child of Object.values(item))pending.push([child,depth+1]);}
if(!object(value)||value.hooks!==undefined&&!object(value.hooks))throw new Error('invalid-client-configuration');const hooks=(value.hooks??{}) as Record<string,unknown>;for(const groups of Object.values(hooks))if(!Array.isArray(groups))throw new Error('invalid-client-configuration');return {...value,hooks};}
async function receipt(directory:string):Promise<Receipt|null>{
 const raw=await readPrivate(join(directory,'receipt.json'),true);if(raw===null)return null;
 const value=JSON.parse(raw) as Receipt;
 if(value.version!==1||!['applying','installed','removing','removed'].includes(value.state)||typeof value.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.token))throw new Error('invalid-receipt');
 validate(value.input);if(value.input.directory!==directory||producerPrincipal(value.input)!==value.id||canonical(value.entries)!==canonical(entries(value.input)))throw new Error('invalid-receipt');return value;
}
async function save(record:Receipt){const path=join(record.input.directory,'receipt.json');await replacePrivate(path,await readPrivate(path,true),encode(record));}
function removeEntries(text:string,record:Receipt){
 const value=config(text);
 for(const {event,group} of record.entries){
  const groups=(value.hooks[event]??[]) as unknown[];
  if(groups.filter(candidate=>canonical(candidate)===canonical(group)).length!==1)throw new Error('owned-entry-changed');
  // An altered owned command must not be silently removed or replaced.
  for(const candidate of groups){if(canonical(candidate)===canonical(group))continue;
   if(JSON.stringify(candidate).includes(join(record.input.directory,'producer.json')))throw new Error('owned-entry-changed');
  }
  value.hooks[event]=groups.filter(candidate=>canonical(candidate)!==canonical(group));
  if((value.hooks[event] as unknown[]).length===0)delete value.hooks[event];
 }
 return encode(value);
}
export async function planSetup(input:SetupInput){
 validate(input);await privateDirectory(input.directory);
 const current=await readPrivate(input.target),record=await receipt(input.directory);if(current===null)throw new Error('missing-target');
 if(record&&canonical(record.input)!==canonical(input))throw new Error('setup-identity-conflict');
 if(record&&record.state==='installed')removeEntries(current,record);
 if(record&&record.state==='applying'&&current!==record.before&&current!==record.after)throw new Error('configuration-changed');
 const desired=entries(input),additions:Entry[]=[],value=config(current);
 for(const {event,group} of desired){const groups=(value.hooks[event]??[]) as unknown[];
  if(!record&&groups.some(g=>JSON.stringify(g).includes(input.hook)))throw new Error('unowned-producer-conflict');
  if(!groups.some(g=>canonical(g)===canonical(group))){value.hooks[event]=[...groups,group];additions.push({event,group});}
 }
 const after=encode(value);config(after);
 if(Buffer.byteLength(after)>262144)throw new Error('client-configuration-limit');
 return {digest:digest(canonical({input,current,record})),additions,removals:[],changed:current!==after,before:current,after};
}
async function locked<T>(directory:string,run:()=>Promise<T>):Promise<T>{
 await privateDirectory(directory);const lock=join(directory,'setup.lock');
 try{await mkdir(lock,{mode:0o700});}catch{throw new Error('setup-owner-or-recovery-required');}
 try{return await run();}finally{await rm(lock,{recursive:true});}
}
async function targetLocked<T>(target:string,run:()=>Promise<T>):Promise<T>{
 await privateDirectory(dirname(target));const lock=target+'.setup.lock';
 try{await mkdir(lock,{mode:0o700});}catch{throw new Error('target-owner-or-recovery-required');}
 try{return await run();}finally{await rm(lock,{recursive:true});}
}
export async function applySetup(input:SetupInput,expected:string,authority:SetupAuthority):Promise<void>{
 await locked(input.directory,()=>targetLocked(input.target,async()=>{
  const plan=await planSetup(input);if(plan.digest!==expected)throw new Error('configuration-changed');
  let record=await receipt(input.directory);
  if(record?.state==='installed')return;
  if(record?.state==='removing'||record?.state==='removed')throw new Error('setup-removal-record-retained');
  if(!record){record={version:1,state:'applying',input:structuredClone(input),id:producerPrincipal(input),token:input.credentialFile?(await readPrivate(input.credentialFile))!.trim():randomBytes(32).toString('base64url'),entries:entries(input),before:plan.before,after:plan.after};if(!/^[A-Za-z0-9_-]{43}$/.test(record.token))throw new Error('invalid-producer-token');if(Buffer.byteLength(encode(record))>4194304)throw new Error('receipt-limit');await save(record);}
  const current=(await readPrivate(input.target))!;
  if(current!==record.before&&current!==record.after)throw new Error('configuration-changed');
  const producerPath=join(input.directory,'producer.json');
  const producer={...(input.lifecycleVersion?{lifecycleVersion:input.lifecycleVersion}:{}),enabled:false,qualified:input.qualified,source:input.source,endpoint:input.endpoint,token:record.token};
  const existing=await readPrivate(producerPath,true);
  if(existing!==null&&canonical(JSON.parse(existing))!==canonical(producer)&&canonical(JSON.parse(existing))!==canonical({...producer,enabled:input.qualified}))throw new Error('producer-changed');
  await replacePrivate(producerPath,existing,encode(producer));
  // The original configuration is retained only for inspection, never whole-file rollback.
  const backup=join(input.directory,'configuration-backup.json');const saved=await readPrivate(backup,true);
  if(saved!==null&&saved!==record.before)throw new Error('backup-conflict');if(saved===null)await replacePrivate(backup,null,record.before);
  try{
  await authority.grant(record.id,record.token,input.directory);
  if(current!==record.after)await replacePrivate(input.target,current,record.after);
  await replacePrivate(producerPath,await readPrivate(producerPath),encode({...producer,enabled:input.qualified}));
  record.state='installed';await save(record);
  }catch(error){
   // Revoke emission, not another writer's changed configuration. The hook also
   // requires an installed receipt, covering process death before this recovery.
   record.state='applying';
   try{const raw=await readPrivate(producerPath);const current=JSON.parse(raw!);if(current.token===record.token&&canonical(current.source)===canonical(input.source))await replacePrivate(producerPath,raw,encode({...current,enabled:false}));}catch{/* Retain the original failure; receipt gating remains fail closed. */}
   try{await save(record);}catch{/* Owner must inspect retained durable intent. */}
   throw error;
  }
 }));
}
export async function planRemoval(directory:string){
 const record=await receipt(directory);if(!record||record.state==='removed')return {digest:digest('removed'),removals:[] as Entry[],additions:[],after:null};
 const current=(await readPrivate(record.input.target))!;
 const after=record.removal&&current===record.removal.after?current:record.state==='applying'&&current===record.before?current:removeEntries(current,record);
 return {digest:digest(canonical({record,current})),removals:after===current?[]:record.entries,additions:[],before:current,after};
}
export async function removeSetup(directory:string,expected:string,authority:SetupAuthority):Promise<void>{
 await locked(directory,async()=>{
  const existingRecord=await receipt(directory);if(!existingRecord)return;
  await targetLocked(existingRecord.input.target,async()=>{
  const plan=await planRemoval(directory);if(plan.digest!==expected)throw new Error('configuration-changed');
  const record=await receipt(directory);if(!record||record.state==='removed')return;
  record.removal={before:plan.before!,after:plan.after!};record.state='removing';await save(record);
  const producer=join(directory,'producer.json'),raw=await readPrivate(producer,true);
  if(raw!==null){const value=JSON.parse(raw);if(value.token!==record.token||canonical(value.source)!==canonical(record.input.source))throw new Error('producer-changed');await replacePrivate(producer,raw,encode({...value,enabled:false}));}
  await authority.revoke(record.id,record.token,directory);
  const latest=(await readPrivate(record.input.target))!;if(latest!==record.removal.before)throw new Error('configuration-changed');await replacePrivate(record.input.target,latest,record.removal.after);
  // Retain a disabled private producer and receipt for migration/revocation audit.
  record.state='removed';await save(record);
  });
 });
}
export async function inspectSetup(directory:string){
 const record=await receipt(directory);if(!record)return {state:'absent' as const};
 const {provider,client,hostId,sourceId}=record.input.source;
 const producer=await readPrivate(join(directory,'producer.json'),true);
 return {state:record.state,owner:record.input.owner,source:{provider,client,hostId,sourceId},qualified:record.input.qualified,enabled:record.state==='installed'&&producer!==null&&JSON.parse(producer).enabled===true};
}
