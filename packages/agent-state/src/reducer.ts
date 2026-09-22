import {createHash} from 'node:crypto';
import {deduplicationKey} from '@jimmie-potts/agent-lifecycle-contracts';
import {LIMITS, type Consumer, type Envelope, type KnownId, type Session, type Unavailable} from './types.js';
import {identityKey} from './memory-storage.js';

type Reduction = {outcome:'applied'|'duplicate'|'stale'|'ambiguous'; session?:Session; fresh:boolean; capacity?:boolean};
const sameTurn=(a:KnownId,b:KnownId)=>a.status==='known'&&b.status==='known'&&a.id===b.id;
const sameId=(a:KnownId,b:KnownId)=>a.status==='unknown'&&b.status==='unknown'||sameTurn(a,b);
export function unavailable(session:Session,dimension:Unavailable['dimension'],reason:Unavailable['reason']) {
  if(session.unavailable.some(item=>item.dimension===dimension&&item.reason==='ambiguous')&&reason!=='ambiguous')return;
  session.unavailable=session.unavailable.filter(item=>item.dimension!==dimension);
  session.unavailable.push({kind:'evidence.unavailable',dimension,reason});
}
function dimension(event:Envelope):string {
  if('attention' in event.event)return `attention:${event.event.attention.status==='known'?event.event.attention.id:event.event.kind}`;
  if(event.event.kind==='read.observed')return 'read';
  if(event.event.kind==='evidence.unavailable')return `unavailable:${event.event.dimension}`;
  return 'activity';
}
function retire(session:Session,turn:KnownId) {
  if(turn.status==='known'&&!session.retiredTurns.includes(turn.id)){
    session.retiredTurns.push(turn.id);
    session.retiredTurns=session.retiredTurns.slice(-LIMITS.retiredTurns);
  }
}
function selectTurn(session:Session,turn:KnownId,consumers:Consumer[],recover=false) {
  const oldTurn=session.turn;
  if(!sameTurn(oldTurn,turn))retire(session,oldTurn);
  for(const notice of session.notices){
    if(notice.turn.status==='unknown'||sameTurn(notice.turn,turn)||(!recover&&!sameTurn(notice.turn,oldTurn)))continue;
    retire(session,notice.turn);
    for(const consumer of consumers)if(consumer.clearOnNewTurn&&!notice.acknowledgedBy.includes(consumer.id))notice.acknowledgedBy.push(consumer.id);
  }
  session.turn=turn;
  if(recover)session.unavailable=session.unavailable.filter(item=>item.dimension!=='turn'&&item.dimension!=='activity');
}
export function reduceSession(previous:Session|undefined,event:Envelope,now:number,consumers:Consumer[]):Reduction {
  const key=deduplicationKey(event)!.key;
  const {eventId,...withoutId}=event;
  const content=deduplicationKey(withoutId)!.key;
  const collisionKey=createHash('sha256').update(JSON.stringify(['collision',key,content])).digest('hex');
  if(previous?.seen.some(entry=>entry.key===collisionKey))return {outcome:'duplicate',fresh:false};
  const seen=previous?.seen.find(entry=>entry.key===key);
  if(seen){
    if(seen.content===content)return {outcome:'duplicate',fresh:false};
    const session=structuredClone(previous!);unavailable(session,'ordering','ambiguous');
    session.seen.push({key:collisionKey,content});session.seen=session.seen.slice(-LIMITS.seen);
    return {session,outcome:'ambiguous',fresh:false};
  }
  const session:Session=previous?structuredClone(previous):{
    identity:event.identity,turn:event.turn,parent:event.parent,activity:'unknown',attention:[],notices:[],
    read:'unknown',unavailable:[],ordering:event.ordering,lastEvidenceAtMs:now,observedAtMs:event.observedAtMs,
    retiredTurns:[],seen:[],watermarks:[]};
  const remember=()=>{session.seen.push({key,content});session.seen=session.seen.slice(-LIMITS.seen);};
  if(event.event.kind==='notice.acknowledged'){
    const acknowledgment=event.event;
    const notice=session.notices.find(item=>item.id===acknowledgment.noticeId);
    if(!notice||!consumers.some(c=>c.id===acknowledgment.consumerId))return {outcome:'stale',fresh:false};
    if(!notice.acknowledgedBy.includes(acknowledgment.consumerId))notice.acknowledgedBy.push(acknowledgment.consumerId);
    remember();return {session,outcome:'applied',fresh:false};
  }
  const eventDimension=dimension(event);
  const order=event.ordering;
  const retired=event.turn.status==='known'&&session.retiredTurns.includes(event.turn.id);
  if(retired&&eventDimension==='activity')return {outcome:'stale',fresh:false};
  const completed=event.turn.status==='known'&&session.notices.some(notice=>sameTurn(notice.turn,event.turn));
  if(order.status==='unknown'&&eventDimension==='activity'){
    if(completed&&event.event.kind==='turn.ended')return {outcome:'duplicate',fresh:false};
    if(completed&&(event.event.kind==='turn.started'||event.event.kind==='activity.observed'))return {outcome:'stale',fresh:false};
    if(previous&&event.event.kind==='turn.started'&&sameTurn(previous.turn,event.turn)&&
      (previous.activity!=='unknown'||previous.unavailable.some(item=>item.dimension==='activity'&&item.reason==='ambiguous')))return {outcome:'duplicate',fresh:false};
  }
  const watermark=order.status==='known'?session.watermarks.find(item=>item.dimension===eventDimension&&item.epoch===order.epoch):undefined;
  if(order.status==='known'&&watermark&&order.sequence<=watermark.sequence)return {outcome:'stale',fresh:false};
  const orderedActivity=eventDimension==='activity'&&watermark!==undefined;
  const bestEffort=order.status==='unknown'&&!session.watermarks.some(item=>item.dimension==='activity')&&session.ordering.status==='unknown';
  const selectedStart=bestEffort&&event.event.kind==='turn.started'&&event.turn.status==='known';
  const matchingStop=bestEffort&&event.event.kind==='turn.ended'&&sameTurn(session.turn,event.turn)&&
    !session.unavailable.some(item=>item.dimension==='activity'&&item.reason==='ambiguous');
  const canSelect=!retired&&(eventDimension==='activity'||order.status==='known');
  let ambiguous=false;
  if(selectedStart)selectTurn(session,event.turn,consumers,true);
  else if(canSelect&&previous&&event.turn.status==='known'&&session.turn.status==='known'&&!sameTurn(event.turn,session.turn)){
    const comparable=order.status==='known'&&previous.ordering.status==='known'&&order.epoch===previous.ordering.epoch;
    if(comparable&&previous.ordering.status==='known'&&order.sequence<=previous.ordering.sequence)return {outcome:'stale',fresh:false};
    if(comparable){
      selectTurn(session,event.turn,consumers);
    }else{
      // Only an eligible start can select by receipt order. Other conflicts stay unknown.
      if(bestEffort)retire(session,session.turn);
      session.turn={status:'unknown'};ambiguous=true;
      unavailable(session,'turn','ambiguous');unavailable(session,'ordering','ambiguous');
    }
  }else if(canSelect&&session.turn.status==='unknown'&&event.turn.status==='known'){
    if(session.unavailable.some(item=>item.dimension==='turn'&&item.reason==='ambiguous'))ambiguous=true;
    else session.turn=event.turn;
  }
  if(event.turn.status==='unknown')unavailable(session,'turn','missing');
  if(order.status==='unknown'){if(!retired)session.ordering={status:'unknown'};unavailable(session,'ordering','missing');}
  else{
    if(!retired){
      if(previous?.ordering.status==='known'&&previous.ordering.epoch!==order.epoch){ambiguous=true;unavailable(session,'ordering','ambiguous');}
      if(session.ordering.status!=='known'||session.ordering.epoch!==order.epoch||session.ordering.sequence<order.sequence)session.ordering=order;
    }
    if(watermark)watermark.sequence=order.sequence;
    else session.watermarks.push({dimension:eventDimension,epoch:order.epoch,sequence:order.sequence});
  }
  if(event.parent.status!=='unknown'){
    if(session.unavailable.some(item=>item.dimension==='parent'&&item.reason==='ambiguous')){session.parent={status:'unknown'};ambiguous=true;}
    else if(session.parent.status!=='unknown'&&(session.parent.status!==event.parent.status||
      (session.parent.status==='known'&&event.parent.status==='known'&&identityKey(session.parent.identity)!==identityKey(event.parent.identity)))){
      session.parent={status:'unknown'};unavailable(session,'parent','ambiguous');ambiguous=true;
    }
    else session.parent=event.parent;
  }
  if(event.label)session.label=event.label.value;
  if(event.projectId)session.projectId=event.projectId;
  switch(event.event.kind){
    case 'session.started':
    case 'turn.started':
    case 'activity.observed':session.activity='active';break;
    case 'turn.ended':{
      session.activity='idle';
      const material=event.turn.status==='known'?[identityKey(event.identity),event.turn.id,'turn-ended']:[identityKey(event.identity),key];
      const noticeId=createHash('sha256').update(JSON.stringify(material)).digest('hex');
      if(!session.notices.some(notice=>notice.id===noticeId))session.notices.push({id:noticeId,kind:'turn-ended',turn:event.turn,acknowledgedBy:[]});
      break;
    }
    case 'turn.interrupted':session.activity='interrupted';break;
    case 'runtime.ended':session.activity='ended';break;
    case 'question.continuing':
    case 'attention.input':
    case 'attention.approval':{
      const attention=event.event.attention;
      const attentionKind=event.event.kind==='question.continuing'?'question':event.event.kind==='attention.input'?'input':'approval';
      if(!session.attention.some(item=>item.kind===attentionKind&&sameId(item.id,attention)&&sameId(item.turn,event.turn)))
        session.attention.push({id:attention,kind:attentionKind,turn:event.turn});
      if(attention.status==='unknown')unavailable(session,'attention','ambiguous');
      break;
    }
    case 'attention.resolved':{
      const attention=event.event.attention;
      if(attention.status==='known'&&event.turn.status==='known')session.attention=session.attention.filter(item=>!(item.id.status==='known'&&item.id.id===attention.id&&sameTurn(item.turn,event.turn)));
      else{unavailable(session,'attention','ambiguous');ambiguous=true;}
      break;
    }
    case 'read.observed':session.read=event.event.state;break;
    case 'evidence.unavailable':unavailable(session,event.event.dimension,event.event.reason);break;
  }
  if(eventDimension==='activity'){
    const conflict=previous&&previous.activity!=='unknown'&&previous.activity!==session.activity&&!orderedActivity&&!selectedStart&&!matchingStop;
    const missingStart=event.event.kind==='turn.started'&&event.turn.status==='unknown';
    if(conflict||missingStart||ambiguous||session.unavailable.some(item=>item.dimension==='activity'&&item.reason==='ambiguous')){
      session.activity='unknown';unavailable(session,'activity','ambiguous');ambiguous=true;
    }
  }
  if(session.notices.length>LIMITS.notices||session.attention.length>LIMITS.attention||session.watermarks.length>LIMITS.watermarks)return {outcome:'ambiguous',fresh:false,capacity:true};
  session.lastEvidenceAtMs=now;session.observedAtMs=event.observedAtMs;remember();
  return {session,outcome:ambiguous?'ambiguous':'applied',fresh:true};
}
