// Presentation only: the runtime core and dashboard helpers own the meaning.
import {chipOf,sessionName,clientName} from '../sessions.ts';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {THREAD_ID} from '../../../../chompi-bridge/src/windows/uri.ts';
export type Binding={sessionId:string;bunnyId:number};
export type HabitatSettings={version:2;automatic:boolean;bindings:Binding[]};
export const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
export function json(raw:string|null):unknown{try{return JSON.parse(raw??'null') as unknown;}catch{return null;}}
export function bindingValue(value:unknown):Binding|null{
 if(!object(value))return null;const id=value['sessionId'],bunny=value['bunnyId'];
 return typeof id==='string'&&id.length>0&&id.length<=2048&&typeof bunny==='number'&&Number.isInteger(bunny)&&bunny>=0&&bunny<10?{sessionId:id,bunnyId:bunny}:null;
}
export function bindingFrom(raw:string|null):Binding|null{return bindingValue(json(raw));}
export function settingsFrom(raw:string|null,legacy:string|null=null):HabitatSettings{
 const value=json(raw);
 if(object(value)&&value['version']===2&&Array.isArray(value['bindings'])){
  const bindings:Binding[]=[],sessions=new Set<string>(),bunnies=new Set<number>();
  for(const item of (value['bindings'] as unknown[]).slice(0,100)){
   const binding=bindingValue(item);
   if(binding!==null&&!sessions.has(binding.sessionId)&&!bunnies.has(binding.bunnyId)){bindings.push(binding);sessions.add(binding.sessionId);bunnies.add(binding.bunnyId);}
  }
  return {version:2,automatic:value['automatic']!==false,bindings:bindings.sort((a,b)=>a.bunnyId-b.bunnyId)};
 }
 const binding=bindingFrom(legacy);return {version:2,automatic:true,bindings:binding===null?[]:[binding]};
}
export function eligibleSessions(records:readonly SessionRecord[]):SessionRecord[]{return records.filter(r=>r.parent.status!=='known');}
export function reconcileBindings(bindings:readonly Binding[],records:readonly SessionRecord[]):Binding[]{
 const eligible=eligibleSessions(records),available=new Map(eligible.map(r=>[r.id,r]));
 const next=bindings.filter(b=>available.has(b.sessionId)).map(b=>({...b}));
 const occupied=new Set(next.map(b=>b.bunnyId)),assigned=new Set(next.map(b=>b.sessionId));
 const waiting=eligible.filter(r=>!assigned.has(r.id)).sort((a,b)=>b.lastEvidenceAtMs!==a.lastEvidenceAtMs?b.lastEvidenceAtMs-a.lastEvidenceAtMs:a.id.localeCompare(b.id));
 for(let bunnyId=0;bunnyId<10;bunnyId++)if(!occupied.has(bunnyId)&&waiting.length>0){const first=waiting.shift();if(first!==undefined)next.push({bunnyId,sessionId:first.id});}
 return next.sort((a,b)=>a.bunnyId-b.bunnyId);
}
export function assignSession(bindings:readonly Binding[],sessionId:string,bunnyId:number):Binding[]{
 const previous=bindings.find(b=>b.sessionId===sessionId),displaced=bindings.find(b=>b.bunnyId===bunnyId);
 const next=bindings.filter(b=>b.sessionId!==sessionId&&b.bunnyId!==bunnyId).map(b=>({...b}));
 next.push({sessionId,bunnyId});
 if(previous&&displaced&&displaced.sessionId!==sessionId)next.push({sessionId:displaced.sessionId,bunnyId:previous.bunnyId});
 return next.sort((a,b)=>a.bunnyId-b.bunnyId);
}
export function presentation(record:SessionRecord,synced:boolean){
 return {state:chipOf(record),name:sessionName(record),client:clientName(record.identity),uncertain:!synced||record.freshness!=='current'||record.restartUncertain};
}
export type ConversationDestination={href?:string;key?:string;reason:string};
export function conversationFor(record:SessionRecord,platform:string):ConversationDestination{
 if(record.identity.provider!=='codex'||record.identity.client!=='desktop')return {reason:'Opening this provider’s conversation is not connected yet.'};
 if(!/^Win/i.test(platform))return {reason:'Conversation opening is available on Windows. Mobile links are not connected yet.'};
 if(record.parent.status==='known'||!THREAD_ID.test(record.identity.sessionId))return {reason:'No verified desktop chat destination for this session.'};
 return {href:`codex://threads/${record.identity.sessionId}`,key:JSON.stringify([record.id,record.identity]),reason:'Open this conversation in Codex on Windows.'};
}
