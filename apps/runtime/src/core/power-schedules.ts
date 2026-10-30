// Hub #483, #1297: the core's private weekly routines. A routine runs an ordered list of typed device commands at one
// local-clock time on chosen weekdays, or on an explicit Run now. It generalizes the one on/off power window of #483,
// whose `power-window/1.0` rows are migrated forward once into two routines. No device transport, no replayable jobs.
import {randomUUID} from 'node:crypto';
import {validDisplayText} from '@jimmie-potts/agent-lifecycle-contracts';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {childOf,type TraceContext,type Cancel,type ModuleScheduler, Outcome} from '@jimmie-potts/sdk';
import {AutomationError, RULE_LIMIT} from './automation.js';
import type {AutomationStore, NewLogRow, RuleRow} from './automation-store.js';

/** The tracked command families a routine action may use: the general device families, and the module families a target's module declares. */
export const ROUTINE_FAMILIES = ['power-set','brightness-set','media-start','media-control','device-mode-set','pixoo-media-show','lifx-color-set'] as const;
export type RoutineFamily = (typeof ROUTINE_FAMILIES)[number];
/** Content actions run only while the device is in a content mode: they always carry `requireMode`. */
export const CONTENT_FAMILIES: readonly RoutineFamily[] = ['media-start','media-control','pixoo-media-show'];
/** The content mode each participating device kind defaults to (owner direction, 2026-09-25): Media for Pixoo, Free for Nanoleaf. */
export const DEFAULT_CONTENT_MODE: Readonly<Record<string,string>> = Object.freeze({pixoo:'media',nanoleaf:'free'});
/** The families whose 2.0 schemas take `requireMode`, so the owning module checks it again at admission (#1276). */
export const MODE_FAMILIES: readonly RoutineFamily[] = ['media-start','media-control','pixoo-media-show'];
/** The module kind that declares each module family. */
const MODULE_FAMILIES: Readonly<Record<string,string>> = Object.freeze({'pixoo-media-show':'pixoo','lifx-color-set':'lifx'});
const MEDIA_ACTIONS = ['pause','resume','stop','next','previous','restart-with-changes','clear'];
/** How many actions one routine may run. */
export const ACTION_LIMIT = 16;

export type RoutineAction = {target:string;family:RoutineFamily;data:Record<string,unknown>;requireMode?:string};
export type RoutineInput = {name:string;days:number[];time:string;actions:RoutineAction[];enabled?:boolean};
export type RoutineOccurrence = {atMs:number};
export type Routine = Omit<RoutineInput,'enabled'> & {id:string;enabled:boolean;definitionId:string;createdAtMs:number;updatedAtMs:number;next?:RoutineOccurrence};
export type RoutineSendResult = {outcome:'receipt'|'not-sent'|'uncertain';requestId:string;reason?:string};
/** The power-only dispatch the maximum-on limits (#1176) keep using. */
export type PowerSendResult = RoutineSendResult;
export type PowerDispatchOptions = {
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
/** Kept for the maximum-on limits, which took the power schedules' options. */
export type PowerScheduleOptions = PowerDispatchOptions;
export type RoutineOptions = Omit<PowerDispatchOptions,'targets'|'send'> & {
  /** Admitted configured identities whose current record the core holds, whatever their capabilities. */
  targets:()=>readonly string[];
  /** One tracked dispatch of one action, with the fresh guards from `record`; never a transport call. */
  send:(action:RoutineAction,record:DeviceRecord,requestId:string,parent:TraceContext)=>Promise<RoutineSendResult>;
};

const invalid = (code='invalid-routine',status=400):never=>{throw new AutomationError(code,status);};
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v);
const time=(v:unknown):v is string=>typeof v==='string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
const routingId=(v:unknown):v is string=>typeof v==='string' && v.length<=128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const kebab=(v:unknown):v is string=>typeof v==='string' && v.length<=64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const integer=(v:unknown,minimum:number,maximum:number):v is number=>Number.isInteger(v) && (v as number)>=minimum && (v as number)<=maximum;
export const isRoutineFamily=(v:unknown):v is RoutineFamily=>typeof v==='string' && (ROUTINE_FAMILIES as readonly string[]).includes(v);
/** The module kind an owner source names: `bunny/modules/<kind>`. */
export const kindOfOwner=(owner:string|undefined):string|undefined=>owner?.startsWith('bunny/modules/')===true?owner.slice('bunny/modules/'.length):undefined;

/** One action's payload, by family: the fields the family's 2.0 schema requires, nothing else. */
function parseActionData(family:RoutineFamily,value:unknown):Record<string,unknown> {
  if(!object(value)) return invalid();
  switch(family) {
    case 'power-set': return exact(value,['on']) && typeof value.on==='boolean'?{on:value.on}:invalid();
    case 'brightness-set': return exact(value,['percent']) && integer(value.percent,0,100)?{percent:value.percent}:invalid();
    case 'media-start': return exact(value,['playlistId']) && typeof value.playlistId==='string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value.playlistId)?{playlistId:value.playlistId}:invalid();
    case 'media-control': return exact(value,['action']) && typeof value.action==='string' && MEDIA_ACTIONS.includes(value.action)?{action:value.action}:invalid();
    case 'device-mode-set': return exact(value,['mode']) && kebab(value.mode)?{mode:value.mode}:invalid();
    case 'pixoo-media-show': return exact(value,['renditionId']) && typeof value.renditionId==='string' && /^[a-f0-9]{64}$/.test(value.renditionId)?{renditionId:value.renditionId}:invalid();
    case 'lifx-color-set': return exact(value,['hue','saturation']) && integer(value.hue,0,360) && integer(value.saturation,0,100)?{hue:value.hue,saturation:value.saturation}:invalid();
  }
}
/**
 * One action: a configured target, a family the target's module declares, the family's payload and the mode precondition.
 * A content action without `requireMode` takes its target kind's default content mode; a kind without one is refused.
 */
function parseAction(value:unknown,targets:readonly string[]|null,kindOf:(target:string)=>string|undefined):RoutineAction {
  if(!object(value) || !['target','family','data'].every(key=>Object.hasOwn(value,key)) ||
      Object.keys(value).some(key=>!['target','family','data','requireMode'].includes(key)) ||
      !routingId(value.target) || !isRoutineFamily(value.family) || (Object.hasOwn(value,'requireMode') && !kebab(value.requireMode))) return invalid();
  if(targets!==null && !targets.includes(value.target)) return invalid('unknown-target');
  const kind=kindOf(value.target),moduleKind=MODULE_FAMILIES[value.family];
  if(moduleKind!==undefined && kind!==undefined && kind!==moduleKind) return invalid('unknown-target');
  const data=parseActionData(value.family,value.data);
  let requireMode=Object.hasOwn(value,'requireMode')?value.requireMode as string:undefined;
  if(requireMode===undefined && CONTENT_FAMILIES.includes(value.family)) {
    requireMode=kind===undefined?undefined:DEFAULT_CONTENT_MODE[kind];
    if(requireMode===undefined && targets!==null) return invalid('invalid-routine');
  }
  return {target:value.target,family:value.family,data,...(requireMode===undefined?{}:{requireMode})};
}
/**
 * A create (`enabled` allowed) or update body. `targets` lists the configured identities a new definition may name;
 * stored rows pass null, because a target removed from configuration is logged when the routine fires.
 */
export function parseRoutine(value:unknown,targets:readonly string[]|null,allowEnabled:boolean,kindOf:(target:string)=>string|undefined=()=>undefined):RoutineInput {
  const keys=['name','days','time','actions'];
  if(!object(value) || !keys.every(key=>Object.hasOwn(value,key)) ||
      Object.keys(value).some(key=>!keys.includes(key) && !(allowEnabled && key==='enabled')) ||
      !validDisplayText(value.name,80) || typeof value.name!=='string' || value.name.trim().length===0 ||
      !Array.isArray(value.days) || value.days.length<1 || value.days.length>7 ||
      !value.days.every(day=>Number.isInteger(day) && day>=0 && day<=6) || new Set(value.days).size!==value.days.length ||
      !time(value.time) || !Array.isArray(value.actions) || value.actions.length<1 || value.actions.length>ACTION_LIMIT ||
      (Object.hasOwn(value,'enabled') && typeof value.enabled!=='boolean')) return invalid();
  return {name:value.name,days:[...value.days as number[]].sort(),time:value.time,actions:value.actions.map(action=>parseAction(action,targets,kindOf)),
    ...(value.enabled===undefined?{}:{enabled:value.enabled as boolean})};
}

/** The command one action sends: its routing key, type and payload schema, by the shared family naming convention. */
export function routineCommand(action:RoutineAction):{key:string;type:string;dataschema:string} {
  return {key:`bunny.cmd.${action.family}.${action.target}`,type:`org.bunny.${action.family.replace(/-([a-z]+)$/,'.$1')}.requested`,dataschema:`${SCHEMA_BASE}${action.family}/2.0`};
}
/** Whether the current record offers the action, by the capability rule the modules apply at admission; module families need their kind's owner. */
export function actionSupported(record:DeviceRecord,action:RoutineAction,kind:string|undefined):boolean {
  const {power,brightness,media,modes}=record.capabilities;
  switch(action.family) {
    case 'power-set': return power.supported;
    case 'brightness-set': return brightness.supported;
    case 'media-start': return media.supported;
    case 'media-control': return media.supported && media.actions.includes(action.data.action as (typeof media.actions)[number]);
    case 'device-mode-set': return modes.supported && modes.values.includes(action.data.mode as string);
    case 'pixoo-media-show': return media.supported && kind==='pixoo';
    case 'lifx-color-set': return kind==='lifx';
  }
}

const ROUTINE_SCHEMA='routine/1.0',LEGACY_SCHEMA='power-window/1.0';
function fromRow(row:RuleRow):Routine {
  try {
    const trigger:unknown=JSON.parse(row.trigger),action:unknown=JSON.parse(row.action);
    if(!/^[A-Za-z0-9_.-]{1,128}$/.test(row.id) || !object(trigger) || Object.keys(trigger).sort().join()!=='days,schema,time' || trigger.schema!==ROUTINE_SCHEMA ||
        !object(action) || Object.keys(action).sort().join()!=='actions,definitionId' || typeof action.definitionId!=='string' ||
        !/^[A-Za-z0-9-]{1,128}$/.test(action.definitionId)) throw new Error();
    const input=parseRoutine({name:row.name,days:trigger.days,time:trigger.time,actions:action.actions},null,false);
    return {...input,id:row.id,enabled:row.enabled,definitionId:action.definitionId,createdAtMs:row.createdAtMs,updatedAtMs:row.updatedAtMs};
  }catch {throw new Error('invalid-state');}
}
function row(routine:Routine):RuleRow {
  return {id:routine.id,name:routine.name,kind:'routine',enabled:routine.enabled,createdAtMs:routine.createdAtMs,updatedAtMs:routine.updatedAtMs,
    trigger:JSON.stringify({schema:ROUTINE_SCHEMA,days:routine.days,time:routine.time}),
    action:JSON.stringify({definitionId:routine.definitionId,actions:routine.actions})};
}
/** A migrated window's names fit the display bound. */
const suffixed=(name:string,suffix:string)=>`${name.slice(0,80-suffix.length-1).trimEnd()} ${suffix}`;
/**
 * The one forward migration of `power-window/1.0` rows (#483) into routines (#1297): the on boundary keeps the row's id,
 * definition identity and occurrence watermark with a `power-set on` action; the off boundary becomes a second routine
 * with its own id and a copy of the watermark. One transaction: a failure leaves every old row as it was.
 */
export function migratePowerWindows(store:AutomationStore,nowMs:number):number {
  let migrated=0;
  for(const saved of store.rules().filter(item=>item.kind==='routine')) {
    const trigger:unknown=JSON.parse(saved.trigger),action:unknown=JSON.parse(saved.action);
    if(!object(trigger) || trigger.schema!==LEGACY_SCHEMA) continue;
    if(!object(action) || typeof action.target!=='string' || typeof action.definitionId!=='string' || !Array.isArray(trigger.days) || !time(trigger.onTime) || !time(trigger.offTime)) throw new Error('invalid-state');
    const days=[...trigger.days as number[]].sort(),power=(on:boolean):RoutineAction=>({target:action.target as string,family:'power-set',data:{on}});
    const onRoutine:Routine={id:saved.id,name:suffixed(saved.name,'on'),days,time:trigger.onTime,actions:[power(true)],enabled:saved.enabled,definitionId:action.definitionId,createdAtMs:saved.createdAtMs,updatedAtMs:nowMs};
    const offRoutine:Routine={...onRoutine,id:`routine-${randomUUID()}`,name:suffixed(saved.name,'off'),time:trigger.offTime,actions:[power(false)],definitionId:randomUUID()};
    store.splitRule(row(onRoutine),row(offRoutine));
    migrated+=1;
  }
  return migrated;
}
/** Native host-local clock behavior; strict future selection, including after restart or enabling right at the minute. */
export function nextOccurrence(routine:Pick<Routine,'days'|'time'>,afterMs:number):RoutineOccurrence {
  for(let offset=0;offset<=7;offset++) {
    const day=new Date(afterMs);day.setDate(day.getDate()+offset);
    if(!routine.days.includes(day.getDay())) continue;
    const at=new Date(day);at.setHours(Number(routine.time.slice(0,2)),Number(routine.time.slice(3)),0,0);
    if(at.getTime()>afterMs) return {atMs:at.getTime()};
  }
  throw new Error('invalid-state');
}

type Fire='scheduled'|'run';
export function createRoutines(options:RoutineOptions) {
  const {store}=options;
  migratePowerWindows(store,options.clock());
  let routines=store.rules().filter(saved=>saved.kind==='routine').map(fromRow),closed=false;
  let cancel:Cancel|undefined;
  const pending=new Set<Promise<void>>(),inFlight=new Set<string>();
  const find=(id:string)=>routines.find(saved=>saved.id===id)??invalid('unknown-rule',404);
  const kindOf=(target:string)=>kindOfOwner(options.owner(target));
  const view=(saved:Routine):Routine=>structuredClone({...saved,...(saved.enabled?{next:nextOccurrence(saved,Math.max(options.clock(),store.powerBoundary(saved.id)??0))}:{})});
  let timerIdentity=0;
  const planned=new Map<string,{definitionId:string;occurrence:RoutineOccurrence}>();
  const stopped=()=>closed || !options.active();
  /** The saved definition still stands: the same routine and definition, enabled for a scheduled fire. */
  const current=(saved:Routine,fire:Fire)=>!stopped() && routines.some(item=>item.id===saved.id && (fire==='run' || item.enabled) && item.definitionId===saved.definitionId);
  const inWindow=(occurrence:RoutineOccurrence)=>options.clock()>=occurrence.atMs && options.clock()<occurrence.atMs+60000;
  const logRow=(saved:Routine,occurrence:RoutineOccurrence,fire:Fire,target:string,moment:string,outcome:NewLogRow['outcome'],reason:string|null,detail:object):NewLogRow=>({
    atMs:options.clock(),ruleId:saved.id,eventSource:'core',eventId:`${saved.id}-${occurrence.atMs}`,eventKind:fire==='run'?'routine-run':'routine-scheduled',
    eventAlias:null,agent:null,task:null,momentId:moment,priorityClass:'routine',coversStatus:false,target,outcome,reason,detail:JSON.stringify(detail)});
  const record=(saved:Routine,occurrence:RoutineOccurrence,fire:Fire,action:RoutineAction,index:number,result:RoutineSendResult|{outcome:'blocked'|'uncertain';reason:string;requestId?:string})=>{
    if(stopped()) return;
    const requestId='requestId' in result?result.requestId:undefined;
    store.appendLog([logRow(saved,occurrence,fire,action.target,`${saved.id}-${occurrence.atMs}-${index}`,result.outcome,result.reason??null,
      {family:action.family,index,...(action.requireMode===undefined?{}:{requireMode:action.requireMode}),...(requestId===undefined?{}:{requestId}),
        ...(result.outcome==='receipt'?{receipt:{status:'accepted',requestId}}:{})})]);
  };
  /** One action: fresh evidence, the same configuration and generation after the read, the capability and the mode, then one tracked dispatch. */
  async function step(saved:Routine,occurrence:RoutineOccurrence,fire:Fire,action:RoutineAction,index:number,parent:TraceContext):Promise<void> {
    const requestId=`routine-${randomUUID()}`,trace=childOf(parent);
    const owner=options.owner(action.target);
    let device:DeviceRecord|undefined;
    try {device=await options.read(action.target);} catch {/* A read failure is unavailable evidence. */}
    // Evidence arriving after the occurrence's tolerance authorizes nothing; an explicit run has no window.
    if(!current(saved,fire) || (fire==='scheduled' && !inWindow(occurrence))) return;
    const latest=options.current(action.target);
    // Evidence must still belong to the same configuration/generation after the asynchronous read.
    const valid=owner!==undefined && owner===options.owner(action.target) && device!==undefined && latest!==undefined && device.id===action.target && latest.id===action.target &&
      device.configurationRevision===latest.configurationRevision && device.generation.epoch===latest.generation.epoch &&
      device.generation.sequence===latest.generation.sequence;
    if(!options.targets().includes(action.target) || !valid || latest.availability!=='available' || latest.held!==undefined ||
        !actionSupported(latest,action,kindOf(action.target)) || (latest.externalControl.status==='known' && latest.externalControl.owner==='external')) {
      try {options.refused?.(requestId,trace);} catch {/* Diagnostics cannot alter device admission. */}
      record(saved,occurrence,fire,action,index,{outcome:'blocked',reason:'unavailable',requestId});return;
    }
    // The content-mode precondition, on the record immediately before the send; the Pixoo checks it again at admission (#1276).
    if(action.requireMode!==undefined && (latest.desired.mode.status!=='known' || latest.desired.mode.value!==action.requireMode || latest.pendingKinds.includes('device-mode-set'))) {
      record(saved,occurrence,fire,action,index,{outcome:'blocked',reason:'mode',requestId});return;
    }
    let result:RoutineSendResult;
    try {result=await options.send(action,structuredClone(latest),requestId,trace);}
    catch {record(saved,occurrence,fire,action,index,{outcome:Outcome.uncertain,reason:'uncertain-result',requestId});return;}
    record(saved,occurrence,fire,action,index,result);
  }
  /** One occurrence: the actions in order, each with fresh identity; a refused, failed or uncertain action does not stop the next. */
  async function fire(saved:Routine,occurrence:RoutineOccurrence,kind:Fire,parent:TraceContext):Promise<void> {
    if(kind==='scheduled') {
      if(!current(saved,kind) || !inWindow(occurrence)) return;
      if(!store.claimPowerBoundary(saved.id,saved.definitionId,occurrence.atMs)) return;
    }
    const first=saved.actions[0];
    if(first===undefined) return;
    if(inFlight.has(saved.id)) {
      if(!stopped()) store.appendLog([logRow(saved,occurrence,kind,first.target,`${saved.id}-${occurrence.atMs}-busy`,'blocked','busy',{family:'routine'})]);
      return;
    }
    inFlight.add(saved.id);
    try {
      for(const [index,action] of saved.actions.entries()) {
        if(!current(saved,kind)) return;
        try {await step(saved,occurrence,kind,action,index,parent);}
        catch {
          // Storage refused the record or the claim: report once, never retry, go on to the next action.
          try {options.failed?.(`routine-${saved.id}-${index}`,parent,action.target);} catch {/* Diagnostics fail open. */}
        }
      }
    } finally {inFlight.delete(saved.id);}
  }
  const rearm=():void=>{
    cancel?.();cancel=undefined;const identity=++timerIdentity;
    if(closed) return;
    for(const id of planned.keys()) if(!routines.some(saved=>saved.id===id && saved.enabled)) planned.delete(id);
    const now=options.clock(),next=routines.filter(saved=>saved.enabled).map(saved=>{
      const previous=planned.get(saved.id);
      // Preserve another definition's waiting callback even if an edit arrives after its due time.
      const occurrence=previous?.definitionId===saved.definitionId?previous.occurrence:
        nextOccurrence(saved,Math.max(now,store.powerBoundary(saved.id)??0));
      planned.set(saved.id,{definitionId:saved.definitionId,occurrence});return {saved,occurrence};
    });
    const atMs=Math.min(...next.map(item=>item.occurrence.atMs));
    if(!Number.isFinite(atMs)) return;
    cancel=options.scheduler.after(Math.max(0,atMs-now),()=>{
      if(closed || identity!==timerIdentity) return;
      const due=next.filter(item=>item.occurrence.atMs===atMs);
      for(const {saved} of due) planned.delete(saved.id);
      rearm();
      for(const {saved,occurrence} of due) {
        const parent=childOf(undefined);
        const task=fire(saved,occurrence,'scheduled',parent).catch(()=>{try {options.failed?.(`routine-${saved.id}-${occurrence.atMs}`,parent,saved.actions[0]?.target??saved.id);} catch {/* Diagnostics fail open; the callback is never retried. */}});
        pending.add(task);void task.finally(()=>{pending.delete(task);});
      }
    });
  };
  const save=(saved:Routine):Routine=>{
    if(!store.replaceRule(row(saved))) return invalid('unknown-rule',404);
    routines=store.rules().filter(item=>item.kind==='routine').map(fromRow);rearm();return view(saved);
  };
  rearm();
  return {
    list:()=>routines.map(view),
    get:(id:string)=>view(find(id)),
    create(value:unknown,owner=true) {
      const input=parseRoutine(value,options.targets(),true,kindOf),now=options.clock();
      const saved:Routine={...input,id:`routine-${randomUUID()}`,definitionId:randomUUID(),enabled:owner && (input.enabled??false),createdAtMs:now,updatedAtMs:now};
      if(!store.insertRule(row(saved),RULE_LIMIT)) return invalid('capacity',429);
      routines.push(saved);rearm();return view(saved);
    },
    update(id:string,value:unknown) {
      const input=parseRoutine(value,options.targets(),false,kindOf),saved=find(id);
      return save({...saved,...input,definitionId:randomUUID(),updatedAtMs:options.clock()});
    },
    setEnabled(id:string,enabled:boolean) {return save({...find(id),enabled,definitionId:randomUUID(),updatedAtMs:options.clock()});},
    remove(id:string) {find(id);store.deleteRule(id);routines=routines.filter(saved=>saved.id!==id);rearm();},
    /** Runs one occurrence now, enabled or not, and settles once each action's dispatch has answered. Nothing is claimed or scheduled. */
    async run(id:string,parent?:TraceContext):Promise<{id:string;atMs:number}> {
      const saved=find(id),atMs=options.clock();
      const task=fire(saved,{atMs},'run',childOf(parent));
      pending.add(task);
      try {await task;} finally {pending.delete(task);}
      return {id,atMs};
    },
    async settled(){await Promise.all(pending);},
    async close(){
      closed=true;cancel?.();let timer:NodeJS.Timeout|undefined;
      try {await Promise.race([Promise.all(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,10000);})]);}
      finally {clearTimeout(timer);}
    },
  };
}
export type Routines=ReturnType<typeof createRoutines>;
