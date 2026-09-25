import {failureMessage,resultMessage,type ReceiptEvidence,type ResultMessage,type Settled} from './client';

/** One explicit command's lifecycle, shared by draft forms and one-click actions. It has no React or device knowledge: callers build requests and decide availability. */
export type Tone='pending'|Settled;
export type ResultOptions={device?:boolean;sameMode?:boolean};
/** A command built from a fresh read, or the reason nothing was sent. */
export type Prepared<T>=T|{blocked:string};
export const blocked=<T extends object>(value:Prepared<T>):value is {blocked:string}=>'blocked' in value;
export const unreadable='B.U.N.N.Y. couldn’t read the device’s current state';
const unprepared=(options:ResultOptions)=>options.device===false?'B.U.N.N.Y. couldn’t read the current sessions':unreadable;

type ObservedReceipt=ReceiptEvidence&{requestId:unknown;outcome:string};
/** A later snapshot can carry the terminal outcome for a submitted ticket; queued receipts are not terminal. */
export function observedResult(source:unknown,ticket:unknown,options:ResultOptions={}):ResultMessage|undefined{
 if(ticket===undefined||!source||typeof source!=='object')return;
 const observed=source as {outcomes?:ObservedReceipt[];state?:{lastOutcome?:{status:string;receipt?:ObservedReceipt}}};
 const records=[...(observed.outcomes??[]),...(observed.state?.lastOutcome?.status==='known'&&observed.state.lastOutcome.receipt?[observed.state.lastOutcome.receipt]:[])];
 const result=records.find(r=>JSON.stringify(r.requestId)===JSON.stringify(ticket));
 if(result&&result.outcome!=='queued')return resultMessage(result,options);
}

/** How a consumer words its status: actions name themselves; forms say that the draft is kept. */
export type Wording={prefix:string;blocked:string;result:(result:ResultMessage)=>string};
const retryable=['stale-generation','revision-conflict'];
export const actionWording=(label:string):Wording=>({prefix:`${label}: `,blocked:'',result:r=>r.settled==='rejected'&&r.code&&retryable.includes(r.code)?` Press ${label} to try again with current values.`:''});
export const formWording:Wording={prefix:'',blocked:' Your edit is kept.',result:r=>r.settled==='rejected'?' Your edit is kept.':''};

/** watching holds only an accepted ticket: a rejected ticket may be consumed by another client, whose receipt must never be shown as this command's outcome. */
export type CommandState={status:string;tone?:Tone;busy:boolean;locked:boolean;watching?:{ticket:unknown;prefix:string}};
export const initialCommand:CommandState={status:'',busy:false,locked:false};
export type CommandEvent=
 |{type:'start';wording:Wording}
 |{type:'blocked';wording:Wording;reason:string}
 |{type:'result';wording:Wording;result:ResultMessage;ticket:unknown}
 |{type:'observed';source:unknown;options:ResultOptions}
 |{type:'finish'}
 |{type:'reload'}
 |{type:'dismiss'};
/** Every state change a command makes. No transition sends anything; an uncertain or partial result, including one observed later, locks until an explicit reload. */
export function commandTransition(state:CommandState,event:CommandEvent):CommandState{
 switch(event.type){
  case 'start':return {status:`${event.wording.prefix}Sending…`,tone:'pending',busy:true,locked:false};
  case 'blocked':return {...state,tone:'rejected',status:`${event.wording.prefix}Not sent: ${event.reason}. Nothing changed.${event.wording.blocked}`};
  case 'result':{const {result,wording}=event;return {...state,tone:result.settled,locked:result.locked,status:`${wording.prefix}${result.message}${wording.result(result)}`,watching:result.settled==='accepted'?{ticket:event.ticket,prefix:wording.prefix}:undefined};}
  case 'observed':{
   const result=state.watching&&observedResult(event.source,state.watching.ticket,event.options);
   return result?{...state,status:`${state.watching!.prefix}${result.message}`,tone:result.settled,locked:state.locked||result.locked}:state;
  }
  case 'finish':return {...state,busy:false};
  case 'reload':return {...initialCommand,busy:state.busy};
  case 'dismiss':return {...state,status:'',tone:undefined};
 }
}

export type Attempt={
 wording:Wording;options:ResultOptions;
 /** Reads current guards and builds the request, or names why nothing is sent. */
 prepare:()=>Promise<Prepared<{request:unknown}>>;
 send:(request:unknown)=>Promise<ReceiptEvidence|undefined>;
 refresh:()=>Promise<unknown>;
 /** Runs once the refreshed view is back, before the control is released. */
 settled?:(outcome:Settled|'blocked')=>void;
};
/** Sends at most one request per call. A preparation failure sends nothing. A failed refresh after the result keeps that result and resends nothing; the next explicit activation reads current guards again. */
export async function runCommand(attempt:Attempt,dispatch:(event:CommandEvent)=>void):Promise<Settled|'blocked'>{
 const {wording,options}=attempt;
 dispatch({type:'start',wording});
 let prepared:Prepared<{request:unknown}>;
 try{prepared=await attempt.prepare();}catch{prepared={blocked:unprepared(options)};}
 if(blocked(prepared)){dispatch({type:'blocked',wording,reason:prepared.blocked});attempt.settled?.('blocked');return 'blocked';}
 let result:ResultMessage;
 try{result=resultMessage(await attempt.send(prepared.request),options);}catch(error){result=failureMessage(error,options);}
 dispatch({type:'result',wording,result,ticket:(prepared.request as {requestId?:unknown}).requestId});
 await attempt.refresh().catch(()=>{});
 attempt.settled?.(result.settled);
 return result.settled;
}
