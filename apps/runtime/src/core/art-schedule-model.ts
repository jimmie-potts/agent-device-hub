import {Outcome} from '@jimmie-potts/sdk';
import {Ajv2020} from 'ajv/dist/2020.js';
import {schemas} from '@jimmie-potts/event-contracts/v2';
import {coreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {ART_SCHEDULE_SCHEMA, type ArtSchedulePolicy, type ArtScheduleRecord, type ArtScheduleWrite} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {ArtRecord, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {rainNoticeIssue, rainNoticeRefusal, type RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import type {WeatherState} from '@jimmie-potts/weather';
import {AutomationError, inQuietHours, type AutomationSettings} from './automation.js';
import {compileOnFirstUse} from './compile-on-first-use.js';

let validator: Ajv2020 | undefined;
function shared(): Ajv2020 {
  if (validator === undefined) {
    const created = new Ajv2020({strict: false});
    created.addSchema(schemas.blocks as object);
    for (const family of coreFamilies) created.addSchema(family.schema);
    validator = created;
  }
  return validator;
}
const writeValid = compileOnFirstUse(() => shared().compile<ArtScheduleWrite>({$ref: `${ART_SCHEDULE_SCHEMA}#/$defs/write`}));
export const recordValid = compileOnFirstUse(() => shared().compile<ArtScheduleRecord>({$ref: ART_SCHEDULE_SCHEMA}));
export const DEFAULT_ART_POLICY: Readonly<ArtSchedulePolicy> = Object.freeze({enabled:false,wakingStartMinute:480,wakingEndMinute:1320,
  appearances:7,targets:[],browser:true,ambient:true,generation:false,weather:false,coversStatus:false});
export const APPEARANCE_GAP_MS = 45 * 60_000;
export const PREPARATION_MS = 45_000;
export const GENERATION_MS = 300_000;
/**
 * How late a scheduled appearance may still start. The browser selection fires from a timer at the start, so a busy
 * event loop that wakes it a second late must not silently drop the browser while the prepared displays still play.
 */
export const START_TOLERANCE_MS = 5000;

export function artPolicyWrite(value: unknown, targets?: readonly string[]): ArtScheduleWrite {
  if (!writeValid(value) || value.policy.wakingStartMinute === value.policy.wakingEndMinute
    || (targets !== undefined && value.policy.targets.some(target => !targets.includes(target)))) throw new AutomationError('invalid-request',400);
  return structuredClone(value);
}
export function initialArtRecord(): ArtScheduleRecord {
  return {id:'art',revision:0,settingsRevision:0,policy:structuredClone(DEFAULT_ART_POLICY),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    status:'disabled',weather:'disabled',nextOpportunity:null,lastOpportunity:null,notice:null};
}
export type WakingDay = {key:string; startAtMs:number; endAtMs:number};
/** Crossing-midnight windows belong to their starting local date. DST is resolved by the existing host zone. */
export function wakingDay(nowMs: number, policy: ArtSchedulePolicy): WakingDay | undefined {
  const now = new Date(nowMs), minutes = now.getHours() * 60 + now.getMinutes();
  const crosses = policy.wakingEndMinute < policy.wakingStartMinute;
  const start = new Date(now);start.setHours(0,0,0,0);
  if (minutes < policy.wakingStartMinute && (!crosses || minutes < policy.wakingEndMinute)) start.setDate(start.getDate()-1);
  const end = new Date(start);if(crosses)end.setDate(end.getDate()+1);
  start.setHours(Math.floor(policy.wakingStartMinute/60),policy.wakingStartMinute%60,0,0);
  end.setHours(Math.floor(policy.wakingEndMinute/60),policy.wakingEndMinute%60,0,0);
  // A nonexistent local boundary is not silently moved into another waking window.
  if(start.getHours()*60+start.getMinutes()!==policy.wakingStartMinute || end.getHours()*60+end.getMinutes()!==policy.wakingEndMinute
    || nowMs<start.getTime() || nowMs>=end.getTime()) return undefined;
  return {key:`${start.getFullYear()}-${start.getMonth()+1}-${start.getDate()}`,startAtMs:start.getTime(),endAtMs:end.getTime()};
}
/** A prior permitted latest start is a conservative admission bound, never an observed physical start. */
export const nextArtStart = (priorLatestStartMs: number): number => priorLatestStartMs + APPEARANCE_GAP_MS;
/** One bounded choice per evenly distributed slice; quiet/short windows suppress slots rather than compressing gaps. */
export function planArtDay(day: WakingDay, count: 6|7|8, nowMs: number, latest: number | null,
  quiet: AutomationSettings['quietHours'], choice: () => number): number[] {
  const width=(day.endAtMs-day.startAtMs)/count, result:number[]=[];
  let earliest=latest===null?0:nextArtStart(latest);
  for(let index=0;index<count;index++) {
    const lower=Math.ceil(day.startAtMs+index*width+Math.min(60_000,width/10));
    const upper=Math.floor(day.startAtMs+(index+1)*width-31_000-START_TOLERANCE_MS);
    const random=choice();if(!Number.isFinite(random)||random<0||random>=1)throw new Error('invalid-state');
    const selected=Math.max(lower+Math.floor(Math.max(0,upper-lower)*random),earliest);
    if(selected>upper || selected<=nowMs+PREPARATION_MS || inQuietHours(quiet,selected) || inQuietHours(quiet,selected+START_TOLERANCE_MS+30_000))continue;
    result.push(selected);earliest=nextArtStart(selected+START_TOLERANCE_MS);
  }
  return result;
}
export function savedArtwork(state: ArtRecord | undefined, choice: () => number): ArtworkSummary | undefined {
  const usable=(state?.artworks??[]).filter(art=>art.feedback!=='dismiss' && art.feedback!=='less' && art.compositions.some(item=>
    item.outcome===Outcome.succeeded && item.compositionId!==null && item.renditions.length>0));
  const ranked=usable.sort((a,b)=>{const favorite=Number(b.favorite)-Number(a.favorite);return favorite!==0?favorite:Number(b.feedback==='more')-Number(a.feedback==='more');});
  const first=ranked[0];if(first===undefined)return undefined;
  const best=ranked.filter(item=>item.favorite===first.favorite && (item.feedback==='more')===(first.feedback==='more'));
  const random=choice();if(!Number.isFinite(random)||random<0||random>=1)throw new Error('invalid-state');
  return structuredClone(best[Math.floor(random*best.length)]);
}
export function rainForecast(state: WeatherState | undefined, nowMs:number, startAtMs:number, toleranceMs:number): RainNotice | undefined {
  if(state?.status!=='available' || state.id!=='local' || state.observedAtMs>nowMs || nowMs>=state.staleAtMs)return undefined;
  for(const hour of state.forecast) {
    if(hour.condition!=='rain' && hour.condition!=='thunderstorm')continue;
    const notice:RainNotice={kind:'rain-forecast',likelihood:hour.likely?'likely':'chance',forecastStartAtMs:hour.startAtMs,
      forecastEndAtMs:hour.endAtMs,forecastUpdatedAtMs:state.forecastUpdatedAtMs,observedAtMs:state.observedAtMs,staleAtMs:state.staleAtMs,weatherRevision:state.revision};
    if(rainNoticeIssue(notice,nowMs)===undefined && rainNoticeRefusal(notice,{startAtMs,toleranceMs,durationMs:30_000},nowMs)===undefined)return notice;
  }
  return undefined;
}
