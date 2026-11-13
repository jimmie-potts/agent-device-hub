// Hub #483, #1297, ADR 0014: the core's private weekly routines. A routine runs an ordered list of typed device commands at one
// local-clock time on chosen weekdays, or on an explicit Run now. It generalizes the one on/off power window of #483,
// whose `power-window/1.0` rows are migrated forward once into two routines. No device transport, no replayable jobs.
import {randomUUID} from 'node:crypto';
import {validDisplayText} from '@jimmie-potts/agent-lifecycle-contracts';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {commandSupported, type DeviceCommand, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {childOf,type TraceContext,type Cancel,type ModuleScheduler, Outcome} from '@jimmie-potts/sdk';
import {AutomationError, RULE_LIMIT} from './automation.js';
import {applyDefinition, type DefinitionCommit, type AutomationStore, type NewLogRow, type RuleRow} from './automation-store.js';

/** The tracked command families a routine action may use: the general device families, and the module families a target's module declares. */
export const ROUTINE_FAMILIES = ['power-set','brightness-set','scene-activate','media-start','media-control','device-mode-set','pixoo-media-show','lifx-color-set'] as const;
export type RoutineFamily = (typeof ROUTINE_FAMILIES)[number];
/** Content families, which only the device kinds that show content declare. */
export const CONTENT_FAMILIES: readonly RoutineFamily[] = ['scene-activate','media-start','media-control','pixoo-media-show'];
/** The device kinds whose modules declare content families: a content action on any other kind is refused before storage. */
const CONTENT_KINDS: readonly string[] = ['pixoo','nanoleaf'];
/** The Hub's modes: an action may run only while its device reports one of them as its desired mode (ADR 0014). */
export const HUB_MODES = ['work','free','quiet'] as const;
export type HubMode = (typeof HUB_MODES)[number];
const isHubMode=(v:unknown):v is HubMode=>typeof v==='string' && (HUB_MODES as readonly string[]).includes(v);
/**
 * A stored action's retired `requireMode` (#1276, #1297), a device's native mode, read as the Hub mode it stood for: the
 * Pixoo's Media was Free and its Monitor first Work, and the Hub's own values keep their meaning. Nothing writes it again.
 */
const LEGACY_MODE: Readonly<Record<string,HubMode>> = Object.freeze({work:'work',free:'free',quiet:'quiet',media:'free',monitor:'work'});
/** The module kind that declares each module family. */
const MODULE_FAMILIES: Readonly<Record<string,string>> = Object.freeze({'pixoo-media-show':'pixoo','lifx-color-set':'lifx'});
const MEDIA_ACTIONS = ['pause','resume','stop','next','previous','restart-with-changes','clear'];
/** How many actions one routine may run. */
export const ACTION_LIMIT = 16;

/** One action. `runsOnlyIn` is the Hub mode the target must report as its desired mode for the action to run, checked by the core. */
export type RoutineAction = {target:string;family:RoutineFamily;data:Record<string,unknown>;runsOnlyIn?:HubMode};
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
  /** A storage failure around one request: its real request ID, trace, target and, for a routine action, its family. */
  failed?:(requestId:string,parent:TraceContext,target:string,family?:string)=>void;
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
/** The contract's enum value, as a native mode is spelled: lowercase, starting with a letter. */
const enumValue=(v:unknown):v is string=>typeof v==='string' && v.length<=64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v);
const blockId=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9_.-]{1,128}$/.test(v);
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
    case 'scene-activate': return exact(value,['sceneId']) && blockId(value.sceneId)?{sceneId:value.sceneId}:invalid();
    case 'media-start': return exact(value,['playlistId']) && blockId(value.playlistId)?{playlistId:value.playlistId}:invalid();
    case 'media-control': return exact(value,['action']) && typeof value.action==='string' && MEDIA_ACTIONS.includes(value.action)?{action:value.action}:invalid();
    case 'device-mode-set': return exact(value,['mode']) && enumValue(value.mode)?{mode:value.mode}:invalid();
    case 'pixoo-media-show': return exact(value,['renditionId']) && typeof value.renditionId==='string' && /^[a-f0-9]{64}$/.test(value.renditionId)?{renditionId:value.renditionId}:invalid();
    case 'lifx-color-set': return exact(value,['hue','saturation']) && integer(value.hue,0,360) && integer(value.saturation,0,100)?{hue:value.hue,saturation:value.saturation}:invalid();
  }
}
/**
 * One action: a configured target, a family the target's module declares, the family's payload and, optionally for any
 * action, the Hub mode (`runsOnlyIn`) the target must report for it to run (ADR 0014). No action is forced into a mode:
 * what a mode admits is the owning module's decision, such as the Pixoo's refusal of playback starts in Work. A stored row
 * (`targets` null) may still carry the retired `requireMode`, read as the Hub mode it stood for, so it keeps opening.
 */
function parseAction(value:unknown,targets:readonly string[]|null,kindOf:(target:string)=>string|undefined):RoutineAction {
  const legacy=targets===null && object(value) && Object.hasOwn(value,'requireMode') && !Object.hasOwn(value,'runsOnlyIn');
  if(!object(value) || !['target','family','data'].every(key=>Object.hasOwn(value,key)) ||
      Object.keys(value).some(key=>!['target','family','data','runsOnlyIn',...(legacy?['requireMode']:[])].includes(key)) ||
      !routingId(value.target) || !isRoutineFamily(value.family) || (Object.hasOwn(value,'runsOnlyIn') && !isHubMode(value.runsOnlyIn)) ||
      (legacy && (!enumValue(value.requireMode) || !Object.hasOwn(LEGACY_MODE,value.requireMode)))) return invalid();
  if(targets!==null && !targets.includes(value.target)) return invalid('unknown-target');
  const kind=kindOf(value.target),moduleKind=MODULE_FAMILIES[value.family];
  if(moduleKind!==undefined && kind!==undefined && kind!==moduleKind) return invalid('unknown-target');
  if(targets!==null && CONTENT_FAMILIES.includes(value.family) && (kind===undefined || !CONTENT_KINDS.includes(kind))) return invalid();
  const data=parseActionData(value.family,value.data);
  const runsOnlyIn=legacy?LEGACY_MODE[value.requireMode as string]:value.runsOnlyIn as HubMode|undefined;
  return {target:value.target,family:value.family,data,...(runsOnlyIn===undefined?{}:{runsOnlyIn})};
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
/**
 * Whether the current record offers the action: the shared capability rule the modules apply at admission for the general
 * families, and the declaring module's kind for a module family (the module still refuses what its device cannot do).
 */
export function actionSupported(record:DeviceRecord,action:RoutineAction,kind:string|undefined):boolean {
  if(action.family==='pixoo-media-show') return record.capabilities.media.supported && kind==='pixoo';
  if(action.family==='lifx-color-set') return kind==='lifx';
  return commandSupported(record.capabilities,{family:action.family,data:{requestId:'routine',...action.data}} as DeviceCommand);
}

/** Why one action may not be sent now: a closed list of reply fields, not error codes (#1586). */
export const ROUTINE_BLOCK_DETAILS=['not-configured','no-evidence','stale','not-available','held','unsupported','external','pending-mode','mode-unknown','wrong-mode','in-flight'] as const;
export type RoutineBlockDetail=(typeof ROUTINE_BLOCK_DETAILS)[number];
/** One action's guard result: sendable with the current record, or blocked with the reason the log records and the guard that failed. */
export type ActionCheck={ok:true;record:DeviceRecord}|{ok:false;reason:'unavailable'|'unsupported-capability'|'mode';detail:Exclude<RoutineBlockDetail,'in-flight'>};
export type ActionEvidence={
  action:RoutineAction;
  /** The target is an admitted configured identity whose record the core holds. */
  configured:boolean;
  /** The owner before the asynchronous read, and again after it. */
  owner:string|undefined;ownerNow:string|undefined;
  /** The record the read returned (undefined when it failed), and the current record after it. */
  read:DeviceRecord|undefined;current:DeviceRecord|undefined;
};
/**
 * The guards one action passes immediately before its send, in one place so a run and a preview cannot drift: fresh evidence
 * from the same configuration and generation after the read, availability, hold, external control and capability, then the
 * Hub-mode precondition against the desired mode and pending mode changes (ADR 0014). An available device that does not offer
 * the action, such as a stored `device-mode-set monitor` on a Pixoo that takes the Hub's modes, answers the capability code
 * the module would refuse it with. The owning module's own admission stays decisive.
 */
export function checkAction({action,configured,owner,ownerNow,read,current}:ActionEvidence):ActionCheck {
  const unavailable=(detail:Exclude<RoutineBlockDetail,'in-flight'>):ActionCheck=>({ok:false,reason:'unavailable',detail});
  if(!configured || owner===undefined) return unavailable('not-configured');
  if(read===undefined || current===undefined) return unavailable('no-evidence');
  if(owner!==ownerNow || read.id!==action.target || current.id!==action.target || read.configurationRevision!==current.configurationRevision ||
      read.generation.epoch!==current.generation.epoch || read.generation.sequence!==current.generation.sequence) return unavailable('stale');
  if(current.availability!=='available') return unavailable('not-available');
  if(current.held!==undefined) return unavailable('held');
  if(current.externalControl.status==='known' && current.externalControl.owner==='external') return unavailable('external');
  if(!actionSupported(current,action,kindOfOwner(ownerNow))) return {ok:false,reason:'unsupported-capability',detail:'unsupported'};
  if(action.runsOnlyIn!==undefined) {
    if(current.pendingKinds.includes('device-mode-set')) return {ok:false,reason:'mode',detail:'pending-mode'};
    if(current.desired.mode.status!=='known') return {ok:false,reason:'mode',detail:'mode-unknown'};
    if(current.desired.mode.value!==action.runsOnlyIn) return {ok:false,reason:'mode',detail:'wrong-mode'};
  }
  return {ok:true,record:current};
}
/** One action as a preview reads it now: would send, or blocked with the reason a run would log (#1586). */
export type ActionPreview={index:number;target:string;family:RoutineFamily;runsOnlyIn?:HubMode}&({verdict:'would-send'}|{verdict:'blocked';reason:'unavailable'|'unsupported-capability'|'mode'|'busy';detail:RoutineBlockDetail});
export type RoutinePreview={id:string;atMs:number;enabled:boolean;next?:RoutineOccurrence;actions:ActionPreview[]};

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
/**
 * A migrated window's name with its suffix, within the display bound and cut by code points only when it must be. A name the
 * routine reader would refuse once suffixed (the display text's credential pattern) takes a neutral one instead.
 */
function suffixed(name:string,suffix:string):string {
  const limit=80-suffix.length-1,points=[...name.trim()];
  const candidate=`${(points.length>limit?points.slice(0,limit).join(''):name.trim()).trimEnd()} ${suffix}`;
  return validDisplayText(candidate,80)?candidate:`Power window ${suffix}`;
}
/**
 * The one forward migration of `power-window/1.0` rows (#483) into routines (#1297): the on boundary keeps the row's id,
 * definition identity and occurrence watermark with a `power-set on` action; the off boundary becomes a second routine
 * with its own id and a copy of the watermark. Every replacement is read back through the routine reader before anything
 * is written, and every split commits in one transaction, so a legacy row the migration cannot read, or a replacement
 * the reader would refuse, leaves every row as it was.
 */
export function migratePowerWindows(store:AutomationStore,nowMs:number):number {
  const pairs:{replacement:RuleRow;added:RuleRow}[]=[];
  for(const saved of store.rules().filter(item=>item.kind==='routine')) {
    let trigger:unknown,action:unknown;
    try {trigger=JSON.parse(saved.trigger);action=JSON.parse(saved.action);} catch {throw new Error('invalid-state');}
    if(!object(trigger) || trigger.schema!==LEGACY_SCHEMA) continue;
    if(!object(action) || !routingId(action.target) || typeof action.definitionId!=='string' || !Array.isArray(trigger.days) || !time(trigger.onTime) || !time(trigger.offTime)) throw new Error('invalid-state');
    const target=action.target,days=[...trigger.days as number[]].sort(),power=(on:boolean):RoutineAction=>({target,family:'power-set',data:{on}});
    const onRoutine:Routine={id:saved.id,name:suffixed(saved.name,'on'),days,time:trigger.onTime,actions:[power(true)],enabled:saved.enabled,definitionId:action.definitionId,createdAtMs:saved.createdAtMs,updatedAtMs:nowMs};
    const offRoutine:Routine={...onRoutine,id:`routine-${randomUUID()}`,name:suffixed(saved.name,'off'),time:trigger.offTime,actions:[power(false)],definitionId:randomUUID()};
    const pair={replacement:row(onRoutine),added:row(offRoutine)};
    // The reader this release opens with must accept both rows, or nothing is written.
    fromRow(pair.replacement);fromRow(pair.added);
    pairs.push(pair);
  }
  if(pairs.length>0) store.splitRules(pairs);
  return pairs.length;
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
/** How a Run now ended: its occurrence ran (each action answered, was skipped or failed), or an occurrence was already in flight. */
export type RunResult={id:string;atMs:number;outcome:'ran'|'busy'};
/** How one occurrence ended: ran, dropped as busy, or (scheduled only) skipped before any action because it was obsolete, late or already claimed. */
type FireOutcome=RunResult['outcome']|'skipped';
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
  const report=(requestId:string,parent:TraceContext,action:RoutineAction)=>{try {options.failed?.(requestId,parent,action.target,action.family);} catch {/* Diagnostics fail open; nothing is retried. */}};
  const logRow=(saved:Routine,occurrence:RoutineOccurrence,fire:Fire,target:string,moment:string,outcome:NewLogRow['outcome'],reason:string|null,detail:object):NewLogRow=>({
    atMs:options.clock(),ruleId:saved.id,eventSource:'core',eventId:`${saved.id}-${occurrence.atMs}`,eventKind:fire==='run'?'routine-run':'routine-scheduled',
    eventAlias:null,agent:null,task:null,momentId:moment,priorityClass:'routine',coversStatus:false,target,outcome,reason,detail:JSON.stringify(detail)});
  const record=(saved:Routine,occurrence:RoutineOccurrence,fire:Fire,action:RoutineAction,index:number,result:RoutineSendResult|{outcome:'blocked'|'uncertain';reason:string;requestId?:string})=>{
    if(stopped()) return;
    const requestId='requestId' in result?result.requestId:undefined;
    store.appendLog([logRow(saved,occurrence,fire,action.target,`${saved.id}-${occurrence.atMs}-${index}`,result.outcome,result.reason??null,
      {family:action.family,index,...(action.runsOnlyIn===undefined?{}:{runsOnlyIn:action.runsOnlyIn}),...(requestId===undefined?{}:{requestId}),
        ...(result.outcome==='receipt'?{receipt:{status:'accepted',requestId}}:{})})]);
  };
  /** The guard result for one action's evidence, read now from the same sources a run uses. */
  const evidence=(action:RoutineAction,owner:string|undefined,read:DeviceRecord|undefined):ActionCheck=>checkAction({action,
    configured:options.targets().includes(action.target),owner,ownerNow:options.owner(action.target),read,current:options.current(action.target)});
  /**
   * One action: fresh evidence, the same configuration and generation after the read, the capability and the mode, then one
   * tracked dispatch. A storage failure around it is reported once under the action's own request identity, never retried.
   */
  async function step(saved:Routine,occurrence:RoutineOccurrence,fire:Fire,action:RoutineAction,index:number,parent:TraceContext):Promise<void> {
    const requestId=`routine-${randomUUID()}`,trace=childOf(parent);
    try {
      const owner=options.owner(action.target);
      let device:DeviceRecord|undefined;
      try {device=await options.read(action.target);} catch {/* A read failure is unavailable evidence. */}
      if(!current(saved,fire)) return;
      // Evidence arriving after the occurrence's tolerance authorizes nothing, and the skip is on record; an explicit run has no window.
      if(fire==='scheduled' && !inWindow(occurrence)) {record(saved,occurrence,fire,action,index,{outcome:'blocked',reason:'expired',requestId});return;}
      // Evidence must still belong to the same configuration/generation after the asynchronous read.
      const check=evidence(action,owner,device);
      if(!check.ok) {
        if(check.reason!=='mode') try {options.refused?.(requestId,trace);} catch {/* Diagnostics cannot alter device admission. */}
        record(saved,occurrence,fire,action,index,{outcome:'blocked',reason:check.reason,requestId});return;
      }
      let result:RoutineSendResult;
      try {result=await options.send(action,structuredClone(check.record),requestId,trace);}
      catch {record(saved,occurrence,fire,action,index,{outcome:Outcome.uncertain,reason:'uncertain-result',requestId});return;}
      record(saved,occurrence,fire,action,index,result);
    } catch {
      report(requestId,trace,action);
    }
  }
  /**
   * One occurrence: the actions in order, each with fresh identity; a refused, failed, skipped or uncertain action does not
   * stop the next. One occurrence of a routine runs at a time: an overlap is recorded once and dropped.
   */
  async function fire(saved:Routine,occurrence:RoutineOccurrence,kind:Fire,parent:TraceContext):Promise<FireOutcome> {
    const first=saved.actions[0];
    if(first===undefined) return 'skipped';
    if(kind==='scheduled') {
      if(!current(saved,kind) || !inWindow(occurrence)) return 'skipped';
      if(!store.claimPowerBoundary(saved.id,saved.definitionId,occurrence.atMs)) return 'skipped';
    }
    if(inFlight.has(saved.id)) {
      try {if(!stopped()) store.appendLog([logRow(saved,occurrence,kind,first.target,`${saved.id}-${occurrence.atMs}-busy`,'blocked','busy',{family:first.family})]);}
      catch {report(`routine-${saved.id}-${occurrence.atMs}`,parent,first);}
      return 'busy';
    }
    inFlight.add(saved.id);
    try {
      for(const [index,action] of saved.actions.entries()) {
        if(!current(saved,kind)) break;
        await step(saved,occurrence,kind,action,index,parent);
      }
    } finally {inFlight.delete(saved.id);}
    return 'ran';
  }
  const rearm=():void=>{
    const identity=++timerIdentity, previousCancel=cancel;
    cancel=undefined;previousCancel?.();
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
        const parent=childOf(undefined),first=saved.actions[0];
        // Storage can refuse the claim itself: report it once under the occurrence's identity; the callback is never retried.
        const task=fire(saved,occurrence,'scheduled',parent).then(()=>undefined,()=>{if(first!==undefined) report(`routine-${saved.id}-${occurrence.atMs}`,parent,first);});
        pending.add(task);void task.finally(()=>{pending.delete(task);});
      }
    });
  };
  const save=(saved:Routine,commit:DefinitionCommit):Routine=>{
    if(!store.replaceRule(row(saved))) return invalid('unknown-rule',404);
    const next = store.rules().filter(item => item.kind === 'routine').map(fromRow);
    commit(() => { routines = next; rearm(); });
    return view(saved);
  };
  rearm();
  return {
    list:()=>routines.map(view),
    definitions:()=>structuredClone(routines),
    get:(id:string)=>view(find(id)),
    create(value:unknown,owner=true,commit=applyDefinition) {
      const input=parseRoutine(value,options.targets(),true,kindOf),now=options.clock();
      const saved:Routine={...input,id:`routine-${randomUUID()}`,definitionId:randomUUID(),enabled:owner && (input.enabled??false),createdAtMs:now,updatedAtMs:now};
      if(!store.insertRule(row(saved),RULE_LIMIT)) return invalid('capacity',429);
      commit(()=>{routines.push(saved);rearm();});return view(saved);
    },
    update(id:string,value:unknown,commit=applyDefinition) {
      const input=parseRoutine(value,options.targets(),false,kindOf),saved=find(id);
      return save({...saved,...input,definitionId:randomUUID(),updatedAtMs:options.clock()},commit);
    },
    setEnabled(id:string,enabled:boolean,commit=applyDefinition) {return save({...find(id),enabled,definitionId:randomUUID(),updatedAtMs:options.clock()},commit);},
    remove(id:string,commit=applyDefinition) {
      find(id);
      if (!store.deleteRule(id)) throw new Error('automation routine was not deleted');
      commit(() => { routines = routines.filter(saved => saved.id !== id); rearm(); });
    },
    /** Runs one occurrence now, enabled or not, and settles once each action's dispatch has answered. Nothing is claimed or scheduled. */
    async run(id:string,parent?:TraceContext):Promise<RunResult> {
      const saved=find(id),atMs=options.clock();
      let outcome:RunResult['outcome']='busy';
      const task=fire(saved,{atMs},'run',childOf(parent)).then(result=>{outcome=result==='busy'?'busy':'ran';});
      pending.add(task);
      try {await task;} finally {pending.delete(task);}
      return {id,atMs,outcome};
    },
    /**
     * What a run would do now, from the current records, with nothing sent, logged, claimed or scheduled (#1586). Each action
     * is read as `step` reads it and checked by the same guards; a routine already in flight answers busy for every action.
     */
    async preview(id:string):Promise<RoutinePreview> {
      const saved=find(id),atMs=options.clock(),busy=inFlight.has(saved.id),{next}=view(saved);
      const actions:ActionPreview[]=[];
      for(const [index,action] of saved.actions.entries()) {
        const head={index,target:action.target,family:action.family,...(action.runsOnlyIn===undefined?{}:{runsOnlyIn:action.runsOnlyIn})};
        if(busy) {actions.push({...head,verdict:'blocked',reason:'busy',detail:'in-flight'});continue;}
        const owner=options.owner(action.target);
        let device:DeviceRecord|undefined;
        try {device=await options.read(action.target);} catch {/* A read failure is unavailable evidence. */}
        const check=evidence(action,owner,device);
        actions.push(check.ok?{...head,verdict:'would-send'}:{...head,verdict:'blocked',reason:check.reason,detail:check.detail});
      }
      return structuredClone({id:saved.id,atMs,enabled:saved.enabled,...(next===undefined?{}:{next}),actions});
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
