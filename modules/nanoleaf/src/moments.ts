// Hub #925: a bounded curated Lines moment, executed only by the existing locked worker.
// Uses effects.ts' recipes/frame encoder and controls.ts' journaled Execution; never retries a device write.
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import {Execution, Refused, savedGeometry} from './controls.js';
import {DEFAULT} from './devices.js';
import {PRESETS, Rejected, render, type Display} from './effects.js';
import {finish, held, journal, journalRow, type JournalRow, type Transact} from './journal.js';
import type {Indication} from './line-projection.js';
import type {RenderConfig} from './renderer.js';
import {execute, first, type Db} from './sqlite.js';
import {controlState, overrides} from './store.js';
import type {LightRequest} from './transport.js';

export const MOMENT = 'moment.play';
export const MOMENT_MOODS = ['celebrate','setback','reminder'];
const RECIPES={celebrate:PRESETS.celebration,setback:PRESETS.rain,reminder:PRESETS.focus};
export const MOMENT_DURATION_MS = 10_000;
export type FreeBase = {name:string;brightness:number};
export type MomentCommand = MomentPlayRequest & {kind:typeof MOMENT;configurationRevision:number;freeBase?:FreeBase};
export const momentRevision=(db:Db,device:string):number=>Number(first(db,'SELECT configuration_revision FROM nanoleaf_devices WHERE device=?',device)?.[0]??0);
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
  const initialOverrides=overrides(db,device);
  const stale=()=>journalRow(db,row.id)===undefined || controlState(db,device).revision!==row.revision ||
    momentRevision(db,device)!==command.configurationRevision || JSON.stringify(overrides(db,device))!==JSON.stringify(initialOverrides) ||
    journal(db,device,'AND seq>? AND kind IN (?,?,?,?)',row.seq,'scene.activate','animation.play','power.set','brightness.set').length>0;
  const end=async(kind:'retired'|'expired'|'refused',code:'unsupported-capability'='unsupported-capability'):Promise<void>=>{
    await transact(report=>{const live=journalRow(db,row.id);if(live!==undefined) finish(db,live,kind==='refused'?{kind,code}:{kind},report);});
  };
  const alerts=(snapshot:readonly Indication[])=>snapshot.some(item=>item!==null && (item[0]==='blocked' || item[0]==='question'));
  while(now()<command.startAtMs) {if(stale()) {await end('retired');return;}await sleep(Math.min(.25,(command.startAtMs-now())/1000));}
  if(stale()) {await end('retired');return;}
  if(now()>command.startAtMs+command.toleranceMs) {await end('expired');return;}
  const sameBrightness=async():Promise<boolean>=>{
    const state=await request(target,'GET','/state') as {brightness?:{value?:unknown}};
    return state.brightness?.value===command.freeBase?.brightness;
  };
  const snapshot=current();
  if(controlState(db,device).mode==='quiet' || (controlState(db,device).mode==='work' && !command.coversStatus) || overrides(db,device).power===false || alerts(snapshot)) {await end('refused');return;}
  if(command.freeBase!==undefined) {
    const listing=await request(target,'GET','/effects') as {select?:unknown;effectsList?:unknown};
    if(listing.select!==command.freeBase.name || !Array.isArray(listing.effectsList) || !listing.effectsList.includes(command.freeBase.name) || !await sameBrightness()) {await end('refused');return;}
  }
  if(stale()) {await end('retired');return;}
  if(now()>command.startAtMs+command.toleranceMs) {await end('expired');return;}
  const execution=new Execution(db,row.revision,row.id,device,transact,now);
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
      if(listing.select!=='*Dynamic*' || !await sameBrightness()) {await end('retired');return;}
    }
  }
  if(stale()) {await end('retired');return;}
  const freeBase=command.freeBase;
  if(freeBase!==undefined) {
    const listing=await request(target,'GET','/effects') as {select?:unknown;effectsList?:unknown};
    if(listing.select!=='*Dynamic*' || !Array.isArray(listing.effectsList) || !listing.effectsList.includes(freeBase.name) || !await sameBrightness()) {await end('retired');return;}
    if(stale()) {await end('retired');return;}
    await execution.call(()=>request(target,'PUT','/state',{brightness:{value:freeBase.brightness,duration:0}}));
    await execution.call(()=>request(target,'PUT','/effects',{select:freeBase.name}));
  } else {
    // The worker supplies a current Work rendering, and routes every restoration write through this execution.
    await restore(current(),execution);
  }
  if(interrupted) {await end('retired');return;}
  await execution.complete();
}
