import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';
import {validateEvent} from '@jimmie-potts/agent-lifecycle-contracts';
import {identityKey} from './memory-storage.js';
import {childCounts} from './children.js';
import type {DurableState,Session,Snapshot} from './types.js';

const MAX_BYTES=16*1024*1024,MAX_NODES=1000000;
const ajv=new Ajv2020({strict:true,allErrors:false});
const durableCheck=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/durable-v1.schema.json',import.meta.url),'utf8')));
const snapshotCheck=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/snapshot-v1.schema.json',import.meta.url),'utf8')));
const durableV2Check=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/durable-v2.schema.json',import.meta.url),'utf8')));
const snapshotV11Check=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/snapshot-v1.1.schema.json',import.meta.url),'utf8')));

// Reject accessors and non-JSON input before serialization, schema traversal or cloning.
function bounded(value:unknown,depth=0,budget={nodes:0,bytes:0}):boolean {
  if(depth>20||++budget.nodes>MAX_NODES)return false;
  if(typeof value==='string'){
    budget.bytes+=Buffer.byteLength(value);
    return budget.bytes<=MAX_BYTES&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  }
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value!=='object')return false;
  const isArray=Array.isArray(value);
  if(!isArray&&Object.getPrototypeOf(value)!==Object.prototype)return false;
  const keys=Reflect.ownKeys(value);if(keys.length>10001)return false;
  for(const key of keys){
    if(isArray&&key==='length')continue;
    if(typeof key!=='string'||!bounded(key,depth+1,budget))return false;
    const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
    if(!descriptor.enumerable||!('value' in descriptor)||!bounded(descriptor.value,depth+1,budget))return false;
  }
  return true;
}
const unique=(values:string[])=>new Set(values).size===values.length;
function sessionSemantics(sessions:Snapshot['sessions']|Session[]):boolean {
  if(!unique(sessions.map(s=>identityKey(s.identity))))return false;
  for(const session of sessions){
    if(!validateEvent({apiVersion:'1.0',identity:session.identity,turn:session.turn,parent:session.parent,event:{kind:'session.started'},observedAtMs:session.observedAtMs,ordering:session.ordering}).ok)return false;
    if(session.read!=='unknown'&&(session.identity.provider!=='codex'||session.identity.client!=='desktop'))return false;
    if(!unique(session.notices.map(n=>n.id))||!unique(session.unavailable.map(u=>u.dimension)))return false;
    if('seen' in session&&(!unique(session.seen.map(s=>s.key))||!unique(session.watermarks.map(w=>JSON.stringify([w.dimension,w.epoch])))))return false;
  }
  return true;
}
type Validation<T>={ok:true;value:T}|{ok:false;code:'invalid-state'};
function validate<T>(input:unknown,check:(value:unknown)=>boolean,semantics:(value:T)=>boolean):Validation<T>{
  try{
    if(!bounded(input))return {ok:false,code:'invalid-state'};
    const encoded=JSON.stringify(input);
    if(Buffer.byteLength(encoded)>MAX_BYTES||!check(input))return {ok:false,code:'invalid-state'};
    const value=JSON.parse(encoded) as T;
    return semantics(value)?{ok:true,value}:{ok:false,code:'invalid-state'};
  }catch{return {ok:false,code:'invalid-state'};}
}
export function validateExport(input:unknown):Validation<DurableState>{
  return validate(input,value=>durableCheck(value)||durableV2Check(value),state=>{
    if(!sessionSemantics(state.sessions)||!unique(state.consumers.map(c=>c.id)))return false;
    const consumers=new Set(state.consumers.map(c=>c.id));
    for(const session of state.sessions){
      if((session.generation??0)>state.revision||session.lastEvidenceAtMs>state.lastCommitAtMs||session.notices.some(n=>n.acknowledgedBy.some(id=>!consumers.has(id))))return false;
    }
    const retirements=state.retirements??[];
    if(!unique(retirements.map(item=>identityKey(item.identity))))return false;
    let retiredAt=-1;
    for(const item of retirements){
      if(item.atMs<retiredAt||item.atMs>state.lastCommitAtMs||!unique(item.ordering.map(order=>order.epoch))||
        item.identity.provider!=='codex'||item.identity.client!=='desktop')return false;
      retiredAt=item.atMs;
    }
    let lastRevision=-1,lastTime=-1;
    for(const row of state.journal){
      if(row.revision<=lastRevision||row.revision>state.revision||row.atMs<lastTime||row.atMs>state.lastCommitAtMs)return false;
      lastRevision=row.revision;lastTime=row.atMs;
    }
    return true;
  });
}
export function validateSnapshot(input:unknown):Validation<Snapshot>{
  return validate(input,value=>snapshotCheck(value)||snapshotV11Check(value),snapshot=>sessionSemantics(snapshot.sessions)&&snapshot.sessions.every(session=>
    (session.generation??0)<=snapshot.revision&&
    session.lastEvidenceAtMs<=snapshot.asOfMs&&session.observationAgeMs===snapshot.asOfMs-session.lastEvidenceAtMs&&
    session.freshness===(session.restartUncertain||session.observationAgeMs>=300000?'uncertain':'current')&&
    (['active','uncertain'] as const).every(kind=>session.children[kind]===childCounts(snapshot.sessions,session.identity)[kind])));
}
/** V1 exports migrate without rewriting identity; unsupported versions fail closed. */
export const migrateExport=validateExport;
