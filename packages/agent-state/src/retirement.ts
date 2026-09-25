import {deduplicationKey} from '@jimmie-potts/agent-lifecycle-contracts';
import {identityKey} from './memory-storage.js';
import {LIMITS,type Envelope,type Identity,type Retirement,type Session} from './types.js';

export const desktop=(identity:Identity)=>identity.provider==='codex'&&identity.client==='desktop';
export const eligibleStart=(event:Envelope)=>event.event.kind==='session.started'||event.event.kind==='turn.started';
const recent=<T>(values:T[],maximum:number)=>[...new Set(values)].slice(-maximum);
const key=(event:Envelope)=>deduplicationKey(event)!.key;

function orders(values:{epoch:string;sequence:number}[]) {
  const result=new Map<string,number>();
  for(const value of values)result.set(value.epoch,Math.max(result.get(value.epoch)??0,value.sequence));
  return [...result].slice(-LIMITS.watermarks).map(([epoch,sequence])=>({epoch,sequence}));
}
const sessionOrders=(session:Session)=>[...session.watermarks,...(session.ordering.status==='known'?[session.ordering]:[])];
const priorSequence=(event:Envelope,values:{epoch:string;sequence:number}[])=>event.ordering.status==='known'&&
  values.some(value=>event.ordering.status==='known'&&value.epoch===event.ordering.epoch&&event.ordering.sequence<=value.sequence);

export function guarded(event:Envelope,retirement:Retirement|undefined):boolean {
  return retirement!==undefined&&(retirement.keys.includes(key(event))||
    event.turn.status==='known'&&retirement.turns.includes(event.turn.id)||priorSequence(event,retirement.ordering));
}

export function oldEnd(event:Envelope,session:Session):boolean {
  return event.turn.status==='known'&&session.retiredTurns.includes(event.turn.id)||
    priorSequence(event,sessionOrders(session));
}

/** `end` is absent when startup settles a stored accepted end; only the session's own end adds its turn, key and order. */
export function rememberRetirement(session:Session,old:Retirement|undefined,atMs:number,end?:Envelope):Retirement {
  const ownEnd=end!==undefined&&identityKey(session.identity)===identityKey(end.identity);
  const turns=[...session.retiredTurns,session.turn,...session.notices.map(n=>n.turn),...session.attention.map(a=>a.turn),
    ...(ownEnd?[end!.turn]:[])].flatMap(turn=>typeof turn==='string'?[turn]:turn.status==='known'?[turn.id]:[]);
  return {identity:session.identity,atMs,turns:recent([...(old?.turns??[]),...turns],LIMITS.retiredTurns),
    keys:recent([...(old?.keys??[]),...session.seen.map(entry=>entry.key),...(ownEnd?[key(end!)]:[])],LIMITS.seen),
    ordering:orders([...(old?.ordering??[]),...sessionOrders(session),...(ownEnd&&end!.ordering.status==='known'?[end!.ordering]:[])])};
}
