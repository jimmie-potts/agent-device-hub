// Hub #925: a bounded curated Lines moment, executed only by the existing locked worker.
// Uses effects.ts' recipes/frame encoder and controls.ts' journaled Execution; never retries a device write.
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import {Cancelled, Execution, Refused, savedGeometry} from './controls.js';
import {DEFAULT} from './devices.js';
import {PRESETS, Rejected, render, type Display} from './effects.js';
import {finish, held, journal, journalRow, type JournalRow, type Transact} from './journal.js';
import type {Indication} from './line-projection.js';
import type {RenderConfig} from './renderer.js';
import {execute, first, type Db} from './sqlite.js';
import {controlState, overrides, type Overrides} from './store.js';
import type {LightRequest} from './transport.js';
import {isObject} from './compat.js';

export const MOMENT = 'moment.play';
export const MOMENT_MOODS = ['celebrate','setback','reminder'];
const RECIPES={celebrate:PRESETS.celebration,setback:PRESETS.rain,reminder:PRESETS.focus};
export const MOMENT_DURATION_MS = 10_000;
export type FreeBase = {name:string;brightness:number};
export type MomentCommand = MomentPlayRequest & {kind:typeof MOMENT;configurationRevision:number;freeBase?:FreeBase};
export const momentRevision=(db:Db,device:string):number=>Number(first(db,'SELECT configuration_revision FROM nanoleaf_devices WHERE device=?',device)?.[0]??0);

/** One device read: the effect list (`/effects`) or the state (`/state`). */
export type DeviceRead=(endpoint:'/effects'|'/state')=>Promise<unknown>;
/**
 * The Free base a moment or a Music session returns to (#925, #1272): the listed named scene the device shows and its
 * integer brightness. Undefined when the device shows no such scene, such as an effect write or an animation. A failed
 * read rejects.
 */
export async function readFreeBase(read:DeviceRead):Promise<FreeBase|undefined> {
  const listing=await read('/effects');
  const state=await read('/state');
  if(!isObject(listing) || typeof listing.select!=='string' || listing.select.startsWith('*') || !Array.isArray(listing.effectsList) || !listing.effectsList.includes(listing.select) ||
      !isObject(state) || !isObject(state.brightness) || typeof state.brightness.value!=='number' || !Number.isInteger(state.brightness.value) ||
      state.brightness.value<0 || state.brightness.value>100) return undefined;
  return {name:listing.select,brightness:state.brightness.value};
}
export const sameBrightness=async(read:DeviceRead,base:FreeBase):Promise<boolean>=>
  (await read('/state') as {brightness?:{value?:unknown}}).brightness?.value===base.brightness;

/** A blocked or question indication: an alert a bounded effect yields to. */
export const alerting=(snapshot:readonly Indication[]):boolean=>snapshot.some(item=>item!==null && (item[0]==='blocked' || item[0]==='question'));

/** What a bounded effect started over: its journal position, the mode and configuration revisions, and the overrides. */
export type Admitted={seq:number;revision:number;configurationRevision:number;overrides:Overrides};
/** The newer choices a moment yields to; a Music session also yields to a newer moment. */
export const NEWER_CHOICES=['scene.activate','animation.play','power.set','brightness.set'] as const;
/** A newer explicit choice took over the device since `since`: a mode, configuration or override change, or a newer row of `kinds`. */
export function newerChoice(db:Db,device:string,since:Admitted,kinds:readonly string[]=NEWER_CHOICES):boolean {
  return controlState(db,device).revision!==since.revision || momentRevision(db,device)!==since.configurationRevision ||
    JSON.stringify(overrides(db,device))!==JSON.stringify(since.overrides) ||
    journal(db,device,`AND seq>? AND kind IN (${kinds.map(()=>'?').join(',')})`,since.seq,...kinds).length>0;
}
/**
 * Returns a Free light to its named base only while it still shows `shown`, the base is listed, its brightness is
 * unchanged and nothing newer took over; then brightness, then the scene, each through `write`, which guards it. False:
 * skipped without a write. A guard that finds a newer choice between the writes throws `Cancelled`.
 */
export async function restoreFreeBase(read:DeviceRead,base:FreeBase,shown:string,stale:()=>boolean,
  write:(endpoint:string,payload:unknown)=>Promise<unknown>):Promise<boolean> {
  const listing=await read('/effects') as {select?:unknown;effectsList?:unknown};
  if(listing.select!==shown || !Array.isArray(listing.effectsList) || !listing.effectsList.includes(base.name) || !await sameBrightness(read,base)) return false;
  if(stale()) return false;
  await write('/state',{brightness:{value:base.brightness,duration:0}});
  await write('/effects',{select:base.name});
  return true;
}
export function initMoments(db:Db):void {
  db.exec('CREATE TABLE IF NOT EXISTS nanoleaf_moments (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE)');
}
export function admitMoment(db:Db,directory:string,device:string,command:MomentCommand,nowMs:number):void {
  const control=controlState(db,device);
  if(device!==DEFAULT || control.mode==='quiet' || (control.mode==='work' && !command.coversStatus) || (control.mode==='free' && command.freeBase===undefined)) throw new Refused('unsupported-capability','A moment needs Work or a named Free base on Lines.');
  if(held(db,control.revision,device)) throw new Refused('unavailable','A moment cannot release an uncertain device hold.');
  if(!MOMENT_MOODS.includes(command.mood) || command.durationMs<1000 || command.durationMs>MOMENT_DURATION_MS) throw new Refused('unsupported-capability','This moment is outside the bounded Lines capability.');
  if(nowMs>command.startAtMs+command.toleranceMs) throw new Refused('expired','The moment start window has passed.');
  if(journal(db,device,'AND kind IN (?,?)',MOMENT,'animation.play').length>0) throw new Refused('capacity','Content already waits on Lines.');
  if(first(db,'SELECT 1 FROM nanoleaf_moments WHERE id=?',command.momentId)!==undefined) throw new Refused('invalid-state','This moment was already admitted.');
  const {groups,positions}=savedGeometry(directory);
  momentPayload(command,{line_groups:groups,line_positions:positions??undefined} as RenderConfig);
  execute(db,'INSERT INTO nanoleaf_moments(id) VALUES (?)',command.momentId);
  execute(db,'DELETE FROM nanoleaf_moments WHERE seq <= (SELECT MAX(seq) FROM nanoleaf_moments)-4096');
  execute(db,"INSERT INTO control_journal(id,device,kind,command,mode_revision,phase,accepted,expires) VALUES (?,?,?,?,?,'queued',?,?)",
    command.requestId,device,MOMENT,JSON.stringify(command),control.revision,nowMs/1000,(command.startAtMs+command.toleranceMs+1)/1000);
}

/** Reuse the existing curated effect renderer and its frame/byte bounds. */
export function momentPayload(command:MomentCommand,config:RenderConfig):Display {
  const recipe=RECIPES[command.mood as keyof typeof RECIPES];
  try {
    return render({kind:'animation.play',...recipe,...(command.palette===undefined?{}:{colors:command.palette})},
      config.line_groups,config.line_positions??null);
  }catch(error) {
    if(error instanceof Rejected) throw new Refused(error.code,'The Lines cannot render this bounded moment.');
    throw error;
  }
}

export type MomentPlayback = {
  db:Db;device:string;row:JournalRow;config:RenderConfig;transact:Transact;request:LightRequest;
  taken:()=>void;
  now:()=>number;sleep:(seconds:number)=>Promise<void>;
  /** Recompute from the current store, including current alert/status and rendering preferences. */
  current:()=>readonly Indication[];
  restore:(snapshot:readonly Indication[],execution:Execution)=>Promise<void>;
};
export async function playMoment(options:MomentPlayback):Promise<void> {
  const {db,device,row,config,transact,request,now,sleep,current,restore}=options;
  const command=row.command as MomentCommand;
  const target={ip:config.ip??'',token:config.token??''};
  const since:Admitted={seq:row.seq,revision:row.revision,configurationRevision:command.configurationRevision,overrides:overrides(db,device)};
  const stale=()=>journalRow(db,row.id)===undefined || newerChoice(db,device,since);
  const read:DeviceRead=endpoint=>request(target,'GET',endpoint);
  const end=async(kind:'retired'|'expired'|'refused',code:'unsupported-capability'='unsupported-capability'):Promise<void>=>{
    await transact(report=>{const live=journalRow(db,row.id);if(live!==undefined) finish(db,live,kind==='refused'?{kind,code}:{kind},report);});
  };
  const alerts=alerting;
  while(now()<command.startAtMs) {if(stale()) {await end('retired');return;}await sleep(Math.min(.25,(command.startAtMs-now())/1000));}
  if(stale()) {await end('retired');return;}
  if(now()>command.startAtMs+command.toleranceMs) {await end('expired');return;}
  const snapshot=current();
  if(controlState(db,device).mode==='quiet' || (controlState(db,device).mode==='work' && !command.coversStatus) || overrides(db,device).power===false || alerts(snapshot)) {await end('refused');return;}
  if(command.freeBase!==undefined) {
    const listing=await request(target,'GET','/effects') as {select?:unknown;effectsList?:unknown};
    if(listing.select!==command.freeBase.name || !Array.isArray(listing.effectsList) || !listing.effectsList.includes(command.freeBase.name) || !await sameBrightness(read,command.freeBase)) {await end('refused');return;}
  }
  if(stale()) {await end('retired');return;}
  if(now()>command.startAtMs+command.toleranceMs) {await end('expired');return;}
  let restoring=false;
  const execution=new class extends Execution {
    override async call<T>(send:()=>Promise<T>|T):Promise<T> {
      // Work restoration uses this same execution inside the renderer; guard each write, not just its outer call.
      if(restoring && stale()) throw new Cancelled();
      const result=await super.call(send);
      if(restoring && stale()) throw new Cancelled();
      return result;
    }
  }(db,row.revision,row.id,device,transact,now);
  await execution.call(()=>request(target,'PUT','/effects',momentPayload(command,config)));
  options.taken();
  const until=now()+command.durationMs;
  let interrupted=false;
  while(now()<until) {
    await sleep(Math.min(.25,(until-now())/1000));
    if(stale()) {await end('retired');return;}
    if(alerts(current())) {interrupted=true;break;}
    if(command.freeBase!==undefined) {
      const listing=await request(target,'GET','/effects') as {select?:unknown};
      if(listing.select!=='*Dynamic*' || !await sameBrightness(read,command.freeBase)) {await end('retired');return;}
    }
  }
  if(stale()) {await end('retired');return;}
  const freeBase=command.freeBase;
  restoring=true;
  try {
    if(freeBase!==undefined) {
      if(!await restoreFreeBase(read,freeBase,'*Dynamic*',stale,(endpoint,payload)=>execution.call(()=>request(target,'PUT',endpoint,payload)))) {await end('retired');return;}
    } else {
      // The worker supplies a current Work rendering, and routes every restoration write through this execution.
      await restore(current(),execution);
    }
  }catch(error) {
    if(error instanceof Cancelled && stale()) {await end('retired');return;}
    throw error;
  }
  if(interrupted) {await end('retired');return;}
  await execution.complete();
}
