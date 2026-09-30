import type {Snapshot, SnapshotV1_1, Ticket} from '../../../packages/contracts/src/types';
import {resultMessage,type ReceiptEvidence,type ResultMessage} from './client';

/** The Moments card's pure rules (Hub #336): what a device declares, how a press and its answer read, and the live line from `state.moment`. */

/** Every moment-capable device declares these; each gets a button. */
export const CORE_MOODS=['celebrate','setback','reminder'] as const;
/** The card's durations; a preset shows only within the device's own limit. */
export const MOMENT_PRESETS=[5000,10000,30000] as const;
export const DEFAULT_MOMENT_MS=10000;
export type DeclaredMoments={moods:string[];maxDurationMs:number;coversStatus:boolean};

/** The moments a 1.1 snapshot declares supported, else nothing: a 1.0 snapshot never has moments. */
export function declaredMoments(snapshot:Snapshot|SnapshotV1_1|undefined):DeclaredMoments|undefined{
 if(!snapshot||snapshot.apiVersion!=='1.1')return;
 const moments=snapshot.capabilities.moments;
 return moments?.supported?{moods:moments.moods,maxDurationMs:moments.maxDurationMs,coversStatus:moments.coversStatus}:undefined;
}
/** A mood ID as its label: separators become spaces and the first letter is capitalized ("big-win" is "Big win"). */
export const moodLabel=(id:string)=>{const words=id.replace(/[-_.]+/g,' ').trim();return words.charAt(0).toUpperCase()+words.slice(1);};
/** The core moods in their fixed order get buttons; the other declared moods, in declared order, fill the "More moods" menu. */
export function moodChoices(moments:DeclaredMoments):{core:string[];more:string[]}{
 const core:readonly string[]=CORE_MOODS;
 return {core:CORE_MOODS.filter(mood=>moments.moods.includes(mood)),more:moments.moods.filter(mood=>!core.includes(mood))};
}
export const durationPresets=(maxDurationMs:number)=>MOMENT_PRESETS.filter(ms=>ms<=maxDurationMs);

const listed=(items:readonly string[])=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items[items.length-1];
/** The one line naming what the controller does not declare. Moments join the general capabilities in the line; only the general ones decide whether general cards show. */
export function undeclaredLine(snapshot:Snapshot|SnapshotV1_1):string|undefined{
 const general=(['power','brightness','media','scenes'] as const).filter(name=>!snapshot.capabilities[name].supported);
 const moments=!declaredMoments(snapshot);
 if(general.length===4)return moments?'No general controls or moments: this controller declares no power, brightness, media, scenes or moments.':'No general controls: this controller declares no power, brightness, media or scenes.';
 const names=[...general,...(moments?['moments']:[])];
 return names.length?`Not declared by this controller: ${listed(names)}.`:undefined;
}

/** The hub's answer to one press: the sender's typed result, or `uncertain` with no start when the route's bound expired. */
export type OwnerMomentResult=
 |{kind:'receipt';momentId:string;start:unknown;receipt:ReceiptEvidence&{requestId:Ticket;outcome:string}}
 |{kind:'not-sent';momentId:string;start:unknown;reason:string;failure?:string}
 |{kind:'uncertain';momentId:string;start:unknown};
/** device names the component; mode is the device's mode from the read taken just before sending, when known. */
export type MomentContext={device:string;mood:string;mode?:string};

const accepted=(message:string):ResultMessage=>({message,locked:false,settled:'accepted'});
const notPlayed=(message:string,code:string):ResultMessage=>({message,locked:false,settled:'rejected',code});
const uncertain=()=>resultMessage({outcome:'uncertain',failure:{code:'uncertain-result'}});
/** A receipt for a moment, at the press or later for the watched ticket. Receipts keep their transmission-only meaning: none says the owner saw the moment. */
export function momentReceiptMessage(receipt:ReceiptEvidence,context:MomentContext):ResultMessage{
 const label=moodLabel(context.mood),code=receipt.failure?.code;
 if(receipt.outcome==='queued')return accepted(`${label}: Scheduled on ${context.device}.`);
 if(receipt.outcome==='sent')return accepted(`${label}: Sent to ${context.device}.`);
 if(receipt.outcome==='failed'&&code==='moment-blocked')return notPlayed(context.mode?`Not played: ${context.device} is in ${context.mode}.`:`Not played: ${context.device} didn’t allow it now.`,code);
 if(receipt.outcome==='failed'&&code==='moment-missed')return notPlayed('Not played: it missed its start window.',code);
 if(receipt.outcome==='failed'&&code==='moment-duplicate')return notPlayed(`Not played: ${context.device} already had this moment.`,code);
 // A scheduled moment that another moment or an explicit command ended before its start transmitted nothing.
 if(receipt.outcome==='cancelled'&&receipt.priorEffects==='none'&&!code)return notPlayed(`${label}: Ended before it started.`,'cancelled');
 return resultMessage(receipt);
}
const notSentReasons:Record<string,string>={'1.0-only':'this controller serves API 1.0','moments-unsupported':'this device doesn’t declare moments',
 'unsupported-capability':'this device doesn’t accept this mood or duration now',capacity:'too many commands are waiting',unavailable:'the controller isn’t responding'};
/** The route's answer in words, and the ticket to watch when the device accepted it. Anything unrecognized is treated as uncertain, never as nothing sent. */
export function momentMessage(answer:unknown,context:MomentContext):{result:ResultMessage;ticket?:unknown}{
 const value=answer as OwnerMomentResult|undefined|null;
 if(value?.kind==='receipt'&&value.receipt&&typeof value.receipt==='object'){
  const result=momentReceiptMessage(value.receipt,context);
  return result.settled==='accepted'?{result,ticket:value.receipt.requestId}:{result};
 }
 if(value?.kind==='not-sent'&&typeof value.reason==='string'){
  return {result:{message:`Not sent: ${notSentReasons[value.reason]??'the hub didn’t send it'}.`,locked:false,settled:'rejected',code:value.failure??value.reason}};
 }
 return {result:uncertain()};
}

const endings:Record<string,string>={completed:'completed',preempted:'pre-empted by an alert',superseded:'superseded',interrupted:'interrupted'};
const ago=(ms:number)=>ms<1000?' just now':ms<60000?` ${Math.floor(ms/1000)} s ago`:` ${Math.floor(ms/60000)} min ago`;
/**
 * The card's live line from the snapshot's `state.moment`. Times are in the controller's clock: the snapshot's sample plus the time since it
 * was received, and are left out when an instant is from another clock epoch. `named` returns the mood of a moment ID this page sent; the
 * snapshot's last moment has no mood, so any other reads "Last moment".
 */
export function momentLine(snapshot:SnapshotV1_1,elapsedMs:number,named:(momentId:string)=>string|undefined):string{
 const {current,last}=snapshot.state.moment,clock=snapshot.sampleClock,deviceNow=clock.sampledAtMs+Math.max(0,elapsedMs);
 const parts:string[]=[];
 if(current.status==='scheduled')parts.push(`Scheduled: ${moodLabel(current.mood)}`);
 else if(current.status==='playing')parts.push(`Playing ${moodLabel(current.mood)}${current.endAt.epoch===clock.epoch?`, ${Math.max(0,Math.ceil((current.endAt.atMs-deviceNow)/1000))} s left`:''}`);
 if(last.status==='known'){
  const mood=named(last.momentId),when=last.endedAt.epoch===clock.epoch?ago(Math.max(0,deviceNow-last.endedAt.atMs)):'';
  parts.push(`${mood?`Last: ${moodLabel(mood)}, `:'Last moment: '}${endings[last.ending]??last.ending}${when}`);
 }
 return parts.length?parts.join(' · '):'No moment yet.';
}
