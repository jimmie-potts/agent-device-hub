// Hub #483: private Hub-owned weekly power definitions. No device transport or replayable jobs.
import {randomUUID} from 'node:crypto';
import {validDisplayText} from '@jimmie-potts/agent-lifecycle-contracts';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {childOf,type TraceContext,type Cancel,type ModuleScheduler, Outcome} from '@jimmie-potts/sdk';
import {AutomationError, RULE_LIMIT} from './automation.js';
import type {AutomationStore, RuleRow} from './automation-store.js';

export type PowerScheduleInput = {name:string;target:string;days:number[];onTime:string;offTime:string;enabled?:boolean};
export type PowerBoundary = {atMs:number;on:boolean};
export type PowerSchedule = Omit<PowerScheduleInput,'enabled'> & {id:string;enabled:boolean;definitionId:string;createdAtMs:number;updatedAtMs:number;next?:PowerBoundary};
export type PowerSendResult = {outcome:'receipt'|'not-sent'|'uncertain';requestId:string;reason?:string};
export type PowerScheduleOptions = {
  store:AutomationStore; clock:()=>number; scheduler:ModuleScheduler; active:()=>boolean;
  /** Admitted identities with a declared power capability, regardless of moment/mode participation. */
  targets:()=>readonly string[];
  owner:(target:string)=>string|undefined;
  read:(target:string)=>Promise<DeviceRecord|undefined>;
  current:(target:string)=>DeviceRecord|undefined;
  refused?:(requestId:string,parent:TraceContext)=>void;
  failed?:(requestId:string,parent:TraceContext,target:string)=>void;
  send:(target:string,on:boolean,record:DeviceRecord,requestId:string,parent:TraceContext)=>Promise<PowerSendResult>;
};
const invalid = (code='invalid-power-schedule',status=400):never=>{throw new AutomationError(code,status);};
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v);
const time=(v:unknown):v is string=>typeof v==='string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
export function parsePowerSchedule(value:unknown,targets:readonly string[]|null,allowEnabled:boolean):PowerScheduleInput {
  const keys=['name','target','days','onTime','offTime'];
  if(!object(value) || !keys.every(key=>Object.hasOwn(value,key)) ||
      Object.keys(value).some(key=>!keys.includes(key) && !(allowEnabled && key==='enabled')) ||
      !validDisplayText(value.name,80) || typeof value.name!=='string' || value.name.trim().length===0 ||
      typeof value.target!=='string' || value.target.length>128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.target) ||
      !Array.isArray(value.days) || value.days.length<1 || value.days.length>7 ||
      !value.days.every(day=>Number.isInteger(day) && day>=0 && day<=6) || new Set(value.days).size!==value.days.length ||
      !time(value.onTime) || !time(value.offTime) || value.onTime>=value.offTime ||
      (Object.hasOwn(value,'enabled') && typeof value.enabled!=='boolean')) return invalid();
  if(targets!==null && !targets.includes(value.target)) return invalid('unknown-target');
  return {name:value.name,target:value.target,days:[...value.days as number[]].sort(),onTime:value.onTime,offTime:value.offTime,
    ...(value.enabled===undefined?{}:{enabled:value.enabled as boolean})};
}
function fromRow(row:RuleRow):PowerSchedule {
  try {
    const trigger:unknown=JSON.parse(row.trigger),action:unknown=JSON.parse(row.action);
    if(!/^[A-Za-z0-9_.-]{1,128}$/.test(row.id) || !object(trigger) || Object.keys(trigger).sort().join()!=='days,offTime,onTime,schema' || trigger.schema!=='power-window/1.0' ||
        !object(action) || Object.keys(action).sort().join()!=='definitionId,target' || typeof action.definitionId!=='string' ||
        !/^[A-Za-z0-9-]{1,128}$/.test(action.definitionId)) throw new Error();
    const input=parsePowerSchedule({name:row.name,target:action.target,days:trigger.days,onTime:trigger.onTime,offTime:trigger.offTime},null,false);
    return {...input,id:row.id,enabled:row.enabled,definitionId:action.definitionId,createdAtMs:row.createdAtMs,updatedAtMs:row.updatedAtMs};
  }catch {throw new Error('invalid-state');}
}
function row(schedule:PowerSchedule):RuleRow {
  return {id:schedule.id,name:schedule.name,kind:'routine',enabled:schedule.enabled,createdAtMs:schedule.createdAtMs,updatedAtMs:schedule.updatedAtMs,
    trigger:JSON.stringify({schema:'power-window/1.0',days:schedule.days,onTime:schedule.onTime,offTime:schedule.offTime}),
    action:JSON.stringify({target:schedule.target,definitionId:schedule.definitionId})};
}
/** Native host-local clock behavior; strict future selection, including after restart or enabling mid-window. */
export function nextPowerBoundary(schedule:Pick<PowerSchedule,'days'|'onTime'|'offTime'>,afterMs:number):PowerBoundary {
  const candidates:PowerBoundary[]=[];
  for(let offset=0;offset<=7;offset++) {
    const day=new Date(afterMs);day.setDate(day.getDate()+offset);
    if(!schedule.days.includes(day.getDay())) continue;
    for(const [value,on] of [[schedule.onTime,true],[schedule.offTime,false]] as const) {
      const at=new Date(day);at.setHours(Number(value.slice(0,2)),Number(value.slice(3)),0,0);
      if(at.getTime()>afterMs) candidates.push({atMs:at.getTime(),on});
    }
  }
  const result=candidates.sort((a,b)=>a.atMs-b.atMs)[0];
  if(result===undefined) throw new Error('invalid-state');
  return result;
}

export function createPowerSchedules(options:PowerScheduleOptions) {
  const {store}=options;
  let schedules=store.rules().filter(saved=>saved.kind==='routine').map(fromRow),closed=false;
  let cancel:Cancel|undefined;
  const pending=new Set<Promise<void>>();
  const find=(id:string)=>schedules.find(saved=>saved.id===id)??invalid('unknown-rule',404);
  const view=(saved:PowerSchedule):PowerSchedule=>structuredClone({...saved,...(saved.enabled?{next:nextPowerBoundary(saved,Math.max(options.clock(),store.powerBoundary(saved.id)??0))}:{})});
  let timerIdentity=0;
  const planned=new Map<string,{definitionId:string;boundary:PowerBoundary}>();
  const stopped=()=>closed || !options.active();
  const current=(saved:PowerSchedule)=>!stopped() && schedules.some(item=>item.id===saved.id && item.enabled && item.definitionId===saved.definitionId);
  const inWindow=(boundary:PowerBoundary)=>options.clock()>=boundary.atMs && options.clock()<boundary.atMs+60000;
  const record=(saved:PowerSchedule,boundary:PowerBoundary,result:PowerSendResult|{outcome:'blocked'|'uncertain';reason:string;requestId?:string})=>{
    if(stopped()) return;
    const requestId='requestId' in result?result.requestId:undefined;
    store.appendLog([{atMs:options.clock(),ruleId:saved.id,eventSource:'core',eventId:`${saved.id}-${boundary.atMs}`,
      eventKind:boundary.on?'scheduled-power-on':'scheduled-power-off',eventAlias:null,agent:null,task:null,
      momentId:`${saved.id}-${boundary.atMs}`,priorityClass:'power',coversStatus:false,target:saved.target,
      outcome:result.outcome,reason:result.reason??null,detail:JSON.stringify({family:'power-set',...(requestId===undefined?{}:{requestId}),
        ...(result.outcome==='receipt'?{receipt:{status:'accepted',requestId}}:{})})}]);
  };
  async function fire(saved:PowerSchedule,boundary:PowerBoundary,requestId:string,parent:TraceContext):Promise<void> {
    if(!current(saved) || !inWindow(boundary)) return;
    const owner=options.owner(saved.target);
    let device:DeviceRecord|undefined;
    try {device=await options.read(saved.target);} catch {/* A read failure is unavailable evidence. */}
    if(!current(saved) || !inWindow(boundary)) return;
    const latest=options.current(saved.target);
    // Evidence must still belong to the same configuration/generation after the asynchronous read.
    const valid=owner!==undefined && owner===options.owner(saved.target) && device!==undefined && latest!==undefined && device.id===saved.target && latest.id===saved.target &&
      device.configurationRevision===latest.configurationRevision && device.generation.epoch===latest.generation.epoch &&
      device.generation.sequence===latest.generation.sequence;
    if(!store.claimPowerBoundary(saved.id,saved.definitionId,boundary.atMs)) return;
    if(!options.targets().includes(saved.target) || !valid || latest.availability!=='available' || latest.held!==undefined ||
        !latest.capabilities.power.supported || (latest.externalControl.status==='known' && latest.externalControl.owner==='external')) {
      try {options.refused?.(requestId,parent);} catch {/* Diagnostics cannot alter device admission. */}
      record(saved,boundary,{outcome:'blocked',reason:'unavailable',requestId});return;
    }
    let result:PowerSendResult;
    try {result=await options.send(saved.target,boundary.on,structuredClone(latest),requestId,parent);}
    catch {record(saved,boundary,{outcome:Outcome.uncertain,reason:'uncertain-result',requestId});return;}
    record(saved,boundary,result);
  }
  const rearm=():void=>{
    cancel?.();cancel=undefined;const identity=++timerIdentity;
    if(closed) return;
    for(const id of planned.keys()) if(!schedules.some(saved=>saved.id===id && saved.enabled)) planned.delete(id);
    const now=options.clock(),next=schedules.filter(saved=>saved.enabled).map(saved=>{
      const previous=planned.get(saved.id);
      // Preserve another definition's waiting callback even if an edit arrives after its due time.
      const boundary=previous?.definitionId===saved.definitionId?previous.boundary:
        nextPowerBoundary(saved,Math.max(now,store.powerBoundary(saved.id)??0));
      planned.set(saved.id,{definitionId:saved.definitionId,boundary});return {saved,boundary};
    });
    const atMs=Math.min(...next.map(item=>item.boundary.atMs));
    if(!Number.isFinite(atMs)) return;
    cancel=options.scheduler.after(Math.max(0,atMs-now),()=>{
      if(closed || identity!==timerIdentity) return;
      const due=next.filter(item=>item.boundary.atMs===atMs);
      for(const {saved} of due) planned.delete(saved.id);
      rearm();
      for(const {saved,boundary} of due) {
        const requestId=`schedule-${randomUUID()}`,parent=childOf(undefined);
        const task=fire(saved,boundary,requestId,parent).catch(()=>{try {options.failed?.(requestId,parent,saved.target);} catch {/* Diagnostics fail open; the callback is never retried. */}});
        pending.add(task);void task.finally(()=>{pending.delete(task);});
      }
    });
  };
  const save=(saved:PowerSchedule):PowerSchedule=>{
    if(!store.replaceRule(row(saved))) return invalid('unknown-rule',404);
    schedules=store.rules().filter(item=>item.kind==='routine').map(fromRow);rearm();return view(saved);
  };
  rearm();
  return {
    list:()=>schedules.map(view),
    get:(id:string)=>view(find(id)),
    create(value:unknown,owner=true) {
      const input=parsePowerSchedule(value,options.targets(),true),now=options.clock();
      const saved:PowerSchedule={...input,id:`power-${randomUUID()}`,definitionId:randomUUID(),enabled:owner && (input.enabled??false),createdAtMs:now,updatedAtMs:now};
      if(!store.insertRule(row(saved),RULE_LIMIT)) return invalid('capacity',429);
      schedules.push(saved);rearm();return view(saved);
    },
    update(id:string,value:unknown) {
      const input=parsePowerSchedule(value,options.targets(),false),saved=find(id);
      return save({...saved,...input,definitionId:randomUUID(),updatedAtMs:options.clock()});
    },
    setEnabled(id:string,enabled:boolean) {return save({...find(id),enabled,definitionId:randomUUID(),updatedAtMs:options.clock()});},
    remove(id:string) {find(id);store.deleteRule(id);schedules=schedules.filter(saved=>saved.id!==id);rearm();},
    async settled(){await Promise.all(pending);},
    async close(){
      closed=true;cancel?.();let timer:NodeJS.Timeout|undefined;
      try {await Promise.race([Promise.all(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,10000);})]);}
      finally {clearTimeout(timer);}
    },
  };
}
export type PowerSchedules=ReturnType<typeof createPowerSchedules>;
