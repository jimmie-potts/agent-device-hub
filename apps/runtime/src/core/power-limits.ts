import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {childOf,type TraceContext} from '@jimmie-potts/sdk';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle} from './core.js';
import {AutomationError} from './automation.js';
import type {PowerScheduleOptions} from './power-schedules.js';
export const LIMIT_SCHEMA='https://bunny.invalid/events/power-limit/2.0';
const FRESH_MS=15000;
type Entry={target:string;owner:string;configurationRevision:number;definitionId:string;settingsRevision:number;enabled:boolean;durationMs:number;lastPower:boolean|null;startedAtMs:number|null;observedAtMs:number|null;runId:string|null;attempt:PowerLimitRecord['lastAttempt'];record?:PowerLimitRecord};
const invalid=(code='invalid-request',status=400):never=>{throw new AutomationError(code,status);};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function decode(payload:string):Entry {
  const value:unknown=JSON.parse(payload);
  const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
  const nullableTime=(v:unknown)=>v===null||integer(v);
  if(!object(value)||Object.keys(value).sort().join()!=='attempt,configurationRevision,definitionId,durationMs,enabled,lastPower,observedAtMs,owner,record,runId,settingsRevision,startedAtMs,target'||
    typeof value.target!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.target)||typeof value.owner!=='string'||!/^bunny\/modules\/[a-z0-9-]+$/.test(value.owner)||
    !integer(value.configurationRevision)||typeof value.definitionId!=='string'||!integer(value.settingsRevision,1)||typeof value.enabled!=='boolean'||!integer(value.durationMs,1000)||value.durationMs>604800000||
    ![true,false,null].includes(value.lastPower as boolean|null)||!nullableTime(value.startedAtMs)||!nullableTime(value.observedAtMs)||!(value.runId===null||typeof value.runId==='string')||!object(value.record))throw new Error('invalid-state');
  const r=value.record;
  if(r.id!==value.target||!integer(r.revision)||r.settingsRevision!==value.settingsRevision||r.enabled!==value.enabled||r.durationMs!==value.durationMs||r.enforcement!=='hub-dependent'||
    r.startedAtMs!==value.startedAtMs||r.observedAtMs!==value.observedAtMs||r.deadlineMs!==(value.startedAtMs===null?null:Number(value.startedAtMs)+value.durationMs)||!integer(r.updatedAtMs)||
    typeof r.status!=='string'||!['disabled','unavailable','off','armed','elapsed-unknown','due','attempted','blocked'].includes(r.status)||JSON.stringify(r.lastAttempt)!==JSON.stringify(value.attempt)||
    !(value.attempt===null||object(value.attempt)&&typeof value.attempt.requestId==='string'&&['intent','receipt','not-sent','uncertain'].includes(String(value.attempt.outcome))))throw new Error('invalid-state');
  return value as Entry;
}
export class PowerLimitStore {
  constructor(readonly db:DatabaseSync,readonly commit?:CoreHandle['transaction']){db.exec('CREATE TABLE IF NOT EXISTS automation_power_limits(target TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT');this.all();}
  get(target:string):Entry|undefined {const row=this.db.prepare('SELECT payload FROM automation_power_limits WHERE target=?').get(target) as {payload:string}|undefined;if(row===undefined)return undefined;const entry=decode(row.payload);if(entry.target!==target)throw new Error('invalid-state');return entry;}
  all():Entry[]{const rows=this.db.prepare('SELECT target,payload FROM automation_power_limits ORDER BY target').all() as {target:string;payload:string}[];if(rows.length>64)throw new Error('invalid-state');return rows.map(row=>{const entry=decode(row.payload);if(entry.target!==row.target)throw new Error('invalid-state');return entry;});}
  async save(entry:Entry,view:Omit<PowerLimitRecord,'revision'>,expected:string,parent:TraceContext,expectedRevision=entry.record?.revision??0):Promise<void>{
    const work=(revision:number)=>{
      const current=this.get(entry.target);if((current?.definitionId??'none')!==expected||(current?.record?.revision??0)!==expectedRevision)invalid('revision-conflict',409);
      if(current===undefined&&Number(this.db.prepare('SELECT count(*) AS n FROM automation_power_limits').get()?.n)>=64)invalid('capacity',429);
      entry.record={...view,revision};
      this.db.prepare('INSERT INTO automation_power_limits VALUES(?,?) ON CONFLICT(target) DO UPDATE SET payload=excluded.payload').run(entry.target,JSON.stringify(entry));
    };
    if(this.commit!==undefined){await this.commit(tx=>{work(tx.revision());tx.add(`bunny.state.power-limit.${entry.target}`,{kind:'state',type:'org.bunny.power-limit.updated',subject:entry.target,dataschema:LIMIT_SCHEMA,data:entry.record as PowerLimitRecord},{parent});});return;}
    this.db.exec('BEGIN IMMEDIATE');try{work((this.get(entry.target)?.record?.revision??0)+1);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
export type PowerLimitOptions=Omit<PowerScheduleOptions,'store'>&{store:PowerLimitStore};
export function createPowerLimits(options:PowerLimitOptions){
  const store=options.store,pending=new Set<Promise<void>>(),offSeen=new Map<string,number>(),reportedFailure=new Map<string,number>();let closed=false,running=false,cancel:(()=>void)|undefined;
  const stopped=()=>closed||!options.active();
  const fresh=(record:DeviceRecord|undefined):record is DeviceRecord & {observed:Extract<DeviceRecord['observed'],{status:'known'}>}=>record!==undefined&&record.observed.status==='known'&&record.observed.power.status==='known'&&record.observed.observedAtMs<=options.clock()&&options.clock()-record.observed.observedAtMs<=FRESH_MS;
  const bound=(entry:Entry,record:DeviceRecord|undefined)=>record!==undefined&&options.owner(entry.target)===entry.owner&&record.configurationRevision===entry.configurationRevision;
  const view=(entry:Entry):Omit<PowerLimitRecord,'revision'>=>{
    const record=options.current(entry.target),valid=fresh(record)&&bound(entry,record);
    const deadlineMs=entry.startedAtMs===null?null:entry.startedAtMs+entry.durationMs;
    const status:PowerLimitRecord['status']=!entry.enabled?'disabled':entry.attempt!==null?entry.attempt.outcome==='not-sent'?'blocked':'attempted':!valid?'unavailable':entry.lastPower===false?'off':entry.startedAtMs===null?'elapsed-unknown':deadlineMs!==null&&options.clock()>=deadlineMs?'due':'armed';
    return {id:entry.target,settingsRevision:entry.settingsRevision,enabled:entry.enabled,durationMs:entry.durationMs,enforcement:'hub-dependent',status,startedAtMs:entry.startedAtMs,deadlineMs,observedAtMs:entry.observedAtMs,lastAttempt:entry.attempt,updatedAtMs:options.clock()};
  };
  const persist=(entry:Entry,expected=entry.definitionId,parent=childOf(undefined))=>store.save(entry,view(entry),expected,parent);
  async function evaluate(target:string,requestId:string,parent:TraceContext):Promise<void>{
    let saved=store.get(target);if(saved===undefined||stopped())return;
    const definition=saved.definitionId,owner=options.owner(target);let record:DeviceRecord|undefined;
    try{record=await options.read(target);}catch{/* No fresh evidence means no off claim. */}
    if(stopped())return;
    saved=store.get(target);if(saved===undefined||saved.definitionId!==definition)return;
    const current=options.current(target);
    if(!fresh(record)||!fresh(current)||!bound(saved,current)||owner!==options.owner(target)||record.configurationRevision!==current.configurationRevision||record.generation.epoch!==current.generation.epoch||record.generation.sequence!==current.generation.sequence){
      offSeen.delete(target);if(saved.record?.status!=='unavailable'&&saved.enabled&&saved.attempt===null)await persist(saved);return;
    }
    const power=current.observed.power.status==='known'&&current.observed.power.value,at=current.observed.observedAtMs;
    if(saved.observedAtMs!==null&&at<saved.observedAtMs){saved.startedAtMs=null;offSeen.delete(target);}
    if(!power){saved.lastPower=false;saved.startedAtMs=null;saved.runId=null;saved.attempt=null;offSeen.set(target,at);}
    else if(saved.lastPower!==true){
      const off=offSeen.get(target);saved.startedAtMs=off!==undefined&&at>=off&&at-off<=FRESH_MS?off:null;saved.runId=randomUUID();saved.lastPower=true;saved.attempt=null;offSeen.delete(target);
    }
    saved.observedAtMs=at;
    if(saved.record===undefined||saved.record.observedAtMs!==at||saved.record.status!==view(saved).status)await persist(saved);
    if(!saved.enabled||!power||saved.attempt!==null||saved.startedAtMs!==null&&options.clock()<saved.startedAtMs+saved.durationMs||stopped())return;
    const latest=store.get(target),live=options.current(target);
    if(latest===undefined||latest.definitionId!==definition||latest.runId!==saved.runId||!latest.enabled||latest.attempt!==null||!fresh(live)||!bound(latest,live))return;
    saved=latest;
    if(live.availability!=='available'||live.held!==undefined||!live.capabilities.power.supported||live.externalControl.status==='known'&&live.externalControl.owner==='external'){
      saved.attempt={requestId,outcome:'not-sent',reason:'unavailable'};await persist(saved,definition,parent);try{options.refused?.(requestId,parent);}catch{/* Diagnostics fail open. */}return;
    }
    saved.attempt={requestId,outcome:'intent'};await persist(saved,definition,parent);
    // Definition edits and shutdown can race the transactional publication. Never send an obsolete intent.
    const admitted=store.get(target);
    if(stopped()||admitted?.definitionId!==definition||!admitted.enabled||admitted.attempt?.requestId!==requestId)return;
    // Once handed to the tracked dispatcher it is live admitted work, never a replayable timer job.
    let result:NonNullable<Entry['attempt']>;
    try{result=await options.send(target,false,structuredClone(live),requestId,parent);}catch{result={requestId,outcome:'uncertain',reason:'uncertain-result'};}
    if(stopped())return;
    const after=store.get(target);if(after===undefined||after.attempt?.requestId!==requestId)return;
    after.attempt=result;await persist(after,after.definitionId,parent);
  }
  const tick=async():Promise<void>=>{
    if(stopped()||running)return;running=true;
    try{await Promise.all(store.all().map(async saved=>{const requestId=`limit-${randomUUID()}`,parent=childOf(undefined);try{await evaluate(saved.target,requestId,parent);}catch(error){if(!(error instanceof AutomationError&&error.code==='revision-conflict')&&(reportedFailure.get(saved.target)===undefined||options.clock()-(reportedFailure.get(saved.target)??0)>=60000)){reportedFailure.set(saved.target,options.clock());try{options.failed?.(requestId,parent,saved.target);}catch{/* Diagnostics fail open. */}}}}));}
    finally{running=false;}
  };
  const schedule=():void=>{if(closed)return;cancel=options.scheduler.after(1000,()=>{const task=tick().finally(schedule);pending.add(task);void task.finally(()=>pending.delete(task));});};
  schedule();
  return {
    records:():PowerLimitRecord[]=>store.all().flatMap(entry=>entry.record===undefined?[]:[structuredClone(entry.record)]),
    list:()=>store.all().map(entry=>structuredClone(entry.record as PowerLimitRecord)),
    get:(target:string)=>{const entry=store.get(target);return entry?.record===undefined?undefined:structuredClone(entry.record);},
    async save(target:string,value:unknown):Promise<PowerLimitRecord>{
      if(stopped())invalid('unavailable',503);
      if(!options.targets().includes(target))invalid('unknown-target');
      if(!object(value)||Object.keys(value).some(k=>!['enabled','durationMs','expectedSettingsRevision'].includes(k))||typeof value.enabled!=='boolean'||typeof value.durationMs!=='number'||!Number.isSafeInteger(value.durationMs)||value.durationMs<1000||value.durationMs>604800000)return invalid();
      const previous=store.get(target),record=options.current(target),owner=options.owner(target);
      if(record===undefined||owner===undefined)return invalid('unavailable',503);
      if(value.expectedSettingsRevision!==undefined&&(typeof value.expectedSettingsRevision!=='number'||!Number.isSafeInteger(value.expectedSettingsRevision)||value.expectedSettingsRevision<0))return invalid();
      if(value.expectedSettingsRevision!==undefined&&value.expectedSettingsRevision!==(previous?.settingsRevision??0))invalid('revision-conflict',409);
      const preserve=previous!==undefined&&bound(previous,record);
      const entry:Entry={target,owner,configurationRevision:record.configurationRevision,definitionId:randomUUID(),settingsRevision:(previous?.settingsRevision??0)+1,enabled:value.enabled,durationMs:value.durationMs,
        lastPower:preserve?previous.lastPower:null,startedAtMs:preserve?previous.startedAtMs:null,observedAtMs:preserve?previous.observedAtMs:null,runId:preserve?previous.runId:null,attempt:preserve?previous.attempt:null};
      await store.save(entry,view(entry),previous?.definitionId??'none',childOf(undefined),previous?.record?.revision??0);return structuredClone(entry.record as PowerLimitRecord);
    },tick,
    async settled(){await Promise.all(pending);},
    async close(){closed=true;cancel?.();let timer:NodeJS.Timeout|undefined;try{await Promise.race([Promise.all(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,10000);})]);}finally{clearTimeout(timer);}},
  };
}
export type PowerLimits=ReturnType<typeof createPowerLimits>;
