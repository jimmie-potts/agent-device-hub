import {createHash} from 'node:crypto';
import {validateEvent} from '@jimmie-potts/agent-lifecycle-contracts';
import {forgetRetiredApprovals,reduceSession,retiredApproval} from './reducer.js';
import {Feeds} from './subscriptions.js';
import {validateExport} from './validation.js';
import {identityKey} from './memory-storage.js';
import {childCounts} from './children.js';
import {LIMITS, type Consumer, type DurableState, type Envelope, type Identity, type Outcome,
  type Session, type Snapshot, type Storage, type StorageLease, type Commit} from './types.js';
export * from './types.js';
export {MemoryStorage} from './memory-storage.js';
export {validateSnapshot,validateExport,migrateExport} from './validation.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const recoveryJournalKey=(identity:Identity,turnId:string)=>hash(['approval-recovery',identityKey(identity),turnId]);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,128}(?![\s\S])/.test(value);
function freeze<T>(value:T):T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
}
export type Options = {storage:Storage; ownerId:string; consumers:Consumer[]; clock?:()=>number; storageTimeoutMs?:number; importState?:unknown};

export async function createAgentState(options:Options) {
  if(!id(options.ownerId)||!Array.isArray(options.consumers)||options.consumers.length>LIMITS.consumers||
    options.consumers.some(c=>!id(c.id)||typeof c.clearOnNewTurn!=='boolean')||
    new Set(options.consumers.map(c=>c.id)).size!==options.consumers.length)throw new Error('invalid-options');
  const timeout=options.storageTimeoutMs??LIMITS.deadlineMs;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>LIMITS.deadlineMs)throw new Error('invalid-options');
  const clock=options.clock??Date.now;
  const consumers=structuredClone(options.consumers);
  let collector:Snapshot['collector']='running',lossCount=0, pending=0;
  let tail:Promise<unknown>=Promise.resolve(),inFlight:Promise<unknown>|null=null;
  let activeAbort:AbortController|null=null;
  async function io<T>(operation:(signal:AbortSignal)=>Promise<T>):Promise<T> {
    const controller=new AbortController();activeAbort=controller;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const work=Promise.resolve().then(()=>operation(controller.signal));inFlight=work;
    work.then(()=>{if(inFlight===work)inFlight=null;},()=>{if(inFlight===work)inFlight=null;});
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('storage-failed'));},timeout);})]);}
    finally{clearTimeout(timer);if(activeAbort===controller)activeAbort=null;}
  }
  let lease:StorageLease;
  try{lease=await io(async signal=>{
    const acquired=await options.storage.acquire(options.ownerId,signal);
    if(signal.aborted){await acquired.release();throw new Error('storage-unavailable');}
    return acquired;
  });}
  catch{throw new Error('storage-unavailable');}
  let data:DurableState;
  try{
    const stored=await io(signal=>lease.load(signal));
    if(stored!==null&&options.importState!==undefined)throw new Error('occupied-destination');
    if(stored===null){
      const at=clock();
      if(!Number.isSafeInteger(at)||at<0)throw new Error('invalid-clock');
      if(options.importState===undefined)data={formatVersion:'1.0',ownerId:options.ownerId,revision:0,lastCommitAtMs:at,consumers,sessions:[],journal:[]};
      else{const imported=validateExport(options.importState);if(!imported.ok)throw new Error('invalid-import');data=imported.value;}
      if(data.ownerId!==options.ownerId||JSON.stringify(data.consumers)!==JSON.stringify(consumers))throw new Error('incompatible-state');
      data.journal=data.journal.filter(row=>row.atMs>at-LIMITS.journalAgeMs);
      await io(signal=>lease.commit({expectedRevision:null,revision:data.revision,atMs:data.lastCommitAtMs,pruneBeforeMs:at-LIMITS.journalAgeMs,replace:data},signal));
    }else{
      const checked=validateExport(stored);if(!checked.ok)throw new Error('invalid-state');data=checked.value;
      if(data.formatVersion!=='1.0'||data.ownerId!==options.ownerId||JSON.stringify(data.consumers)!==JSON.stringify(consumers))throw new Error('incompatible-state');
    }
  }catch{
    // A timed-out write may still settle. Keep its lease until then, including
    // when initialization failed before a caller could obtain a shutdown handle.
    const outstanding=inFlight as Promise<unknown>|null;
    if(outstanding)void outstanding.then(()=>lease.release(),()=>lease.release()).catch(()=>{});
    else await io(()=>lease.release()).catch(()=>{});
    throw new Error('invalid-storage');
  }
  const restarted=new Set(data.sessions.map(session=>identityKey(session.identity)));
  const feeds=new Feeds(data.revision);
  const wall=()=>{
    let value:number;
    try{value=clock();}catch{throw new Error('invalid-clock');}
    if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid-clock');
    return value;
  };
  const now=()=>Math.max(wall(),data.lastCommitAtMs);
  const loss=()=>{lossCount=Math.min(Number.MAX_SAFE_INTEGER,lossCount+1);};
  let maintenanceTimer:ReturnType<typeof setTimeout>|undefined;
  function scheduleMaintenance(retry=false){
    clearTimeout(maintenanceTimer);
    const due=Math.min(...data.journal.slice(0,1).map(row=>row.atMs+LIMITS.journalAgeMs),
      ...data.sessions.map(session=>session.lastEvidenceAtMs+LIMITS.sessionAgeMs));
    if(collector!=='running'||due===Infinity)return;
    const delay=Math.max(retry?50:1,due-now());
    maintenanceTimer=setTimeout(()=>{void queue(maintenance).then(()=>scheduleMaintenance(true));},Math.min(delay,LIMITS.journalAgeMs));
    maintenanceTimer.unref();
  }
  function queue(operation:()=>Promise<Outcome>):Promise<Outcome> {
    if(collector!=='running')return Promise.resolve({ok:false,code:'unavailable'});
    if(pending>=LIMITS.pendingEvents){loss();return Promise.resolve({ok:false,code:'capacity'});}
    pending++;
    const result=tail.then(async():Promise<Outcome>=>{
      try{if(collector==='faulted'||collector==='closed')return {ok:false,code:'unavailable'};return await operation();}catch{collector='faulted';clearTimeout(maintenanceTimer);loss();return {ok:false,code:'storage-failed'};}
      finally{pending--;}
    });
    tail=result;return result;
  }
  async function commit(session:Session|undefined,kind:string,outcome:'applied'|'ambiguous'='applied',journalKey?:string):Promise<Outcome> {
    if(data.revision>=Number.MAX_SAFE_INTEGER){loss();return {ok:false,code:'capacity'};}
    const at=now(),revision=data.revision+1;
    const journal=session?{revision,atMs:at,sessionKey:journalKey??hash(session.identity),kind,outcome}:undefined;
    const change:Commit={expectedRevision:data.revision,revision,atMs:at,pruneBeforeMs:at-LIMITS.journalAgeMs,
      ...(session?{session}:{}),...(journal?{journal}:{})};
    await io(signal=>lease.commit(freeze(structuredClone(change)),signal));
    if(session){const key=identityKey(session.identity),index=data.sessions.findIndex(s=>identityKey(s.identity)===key);if(index<0)data.sessions.push(session);else data.sessions[index]=session;}
    if(journal)data.journal.push(journal);
    data.journal=data.journal.filter(item=>item.atMs>change.pruneBeforeMs).slice(-LIMITS.journalEvents);
    data.revision=revision;data.lastCommitAtMs=at;feeds.publish(revision);scheduleMaintenance();
    return {ok:true,revision,outcome};
  }
  // Retention forgets monitoring state after a day without lifecycle evidence. It is not
  // acknowledgment, readership, success or cancellation, and it records no journal entry.
  const expired=(at:number)=>data.sessions.filter(session=>session.lastEvidenceAtMs<=at-LIMITS.sessionAgeMs);
  async function replaceSessions(sessions:Session[],at:number):Promise<Outcome> {
    if(data.revision>=Number.MAX_SAFE_INTEGER){loss();return {ok:false,code:'capacity'};}
    const revision=data.revision+1,pruneBeforeMs=at-LIMITS.journalAgeMs;
    const next:DurableState={...data,revision,lastCommitAtMs:at,sessions,
      journal:data.journal.filter(row=>row.atMs>pruneBeforeMs).slice(-LIMITS.journalEvents)};
    await io(signal=>lease.commit(freeze(structuredClone({expectedRevision:data.revision,revision,atMs:at,pruneBeforeMs,replace:next})),signal));
    data=next;feeds.publish(revision);scheduleMaintenance();
    return {ok:true,revision,outcome:'applied'};
  }
  async function expire():Promise<Outcome|undefined> {
    const at=now(),gone=expired(at);
    if(!gone.length)return undefined;
    const result=await replaceSessions(data.sessions.filter(session=>!gone.includes(session)),at);
    if(result.ok)for(const session of gone)restarted.delete(identityKey(session.identity));
    return result;
  }
  // Stores written before retired-turn approvals were forgotten are settled in one revision.
  const unsettled=(session:Session)=>session.attention.some(item=>retiredApproval(session,item));
  async function settleApprovals():Promise<Outcome|undefined> {
    if(!data.sessions.some(unsettled))return undefined;
    return replaceSessions(data.sessions.map(session=>{
      if(!unsettled(session))return session;
      const next=structuredClone(session);forgetRetiredApprovals(next);return next;
    }),now());
  }
  async function maintenance():Promise<Outcome> {
    const expiry=await expire();if(expiry&&!expiry.ok)return expiry;
    const settled=await settleApprovals();if(settled)return settled;
    if(expiry)return expiry;
    return data.journal.some(row=>row.atMs<=now()-LIMITS.journalAgeMs)?commit(undefined,'maintenance'):{ok:true,revision:data.revision,outcome:'duplicate'};
  }
  const get=(identity:Identity)=>data.sessions.find(session=>identityKey(session.identity)===identityKey(identity));
  function identify(identity:unknown):identity is Identity {
    return validateEvent({apiVersion:'1.0',identity,turn:{status:'unknown'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:0,ordering:{status:'unknown'}}).ok;
  }
  if(expired(now()).length||data.sessions.some(unsettled)||data.journal.some(row=>row.atMs<=now()-LIMITS.journalAgeMs)){
    const result=await queue(maintenance);
    if(!result.ok){
      const outstanding=inFlight as Promise<unknown>|null;
      if(outstanding)void outstanding.then(()=>lease.release(),()=>lease.release()).catch(()=>{});
      else await io(()=>lease.release()).catch(()=>{});
      throw new Error('invalid-storage');
    }
  }
  scheduleMaintenance();
  return {
    subscribe(consumerId:string,cursor?:number){
      if(!consumers.some(c=>c.id===consumerId))throw new Error('invalid-consumer');
      if(collector==='closed'||collector==='faulted')throw new Error('unavailable');
      return feeds.subscribe(consumerId,data.revision,cursor);
    },
    ingest(input:unknown):Promise<Outcome>{
      const checked=validateEvent(input);
      if(!checked.ok||Buffer.byteLength(JSON.stringify(checked.value))>LIMITS.eventBytes)return Promise.resolve({ok:false,code:'invalid-event'});
      const event=checked.value;
      return queue(async()=>{
        // Expire before admission so a freed slot or a fresh record replaces the expired one.
        const expiry=await expire();if(expiry&&!expiry.ok)return expiry;
        const previous=get(event.identity);
        // Read evidence and a runtime end describe a known session; alone they cannot establish one.
        if(!previous&&(event.event.kind==='read.observed'||event.event.kind==='runtime.ended'))return {ok:true,revision:data.revision,outcome:'stale'};
        // An observation older than the retention window is not new activity. Compare with the
        // wall clock, not the commit-time floor, so a corrected clock jump cannot strand producers.
        if(event.observedAtMs<=wall()-LIMITS.sessionAgeMs)return {ok:true,revision:data.revision,outcome:'stale'};
        if(!previous&&data.sessions.length>=LIMITS.sessions){loss();return {ok:false,code:'capacity'};}
        const reduced=reduceSession(previous,event,now(),consumers);
        if(reduced.capacity){loss();return {ok:false,code:'capacity'};}
        if(!reduced.session)return {ok:true,revision:data.revision,outcome:reduced.outcome};
        const result=await commit(reduced.session,event.event.kind,reduced.outcome==='ambiguous'?'ambiguous':'applied');
        if(result.ok&&reduced.fresh)restarted.delete(identityKey(event.identity));return result;
      });
    },
    setLabel(identity:Identity,label:string|null):Promise<Outcome>{
      if(!identify(identity)||(label!==null&&!validateEvent({apiVersion:'1.0',identity,turn:{status:'unknown'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:0,ordering:{status:'unknown'},label:{origin:'user',value:label}}).ok))return Promise.resolve({ok:false,code:'invalid-operation'});
      const selected=structuredClone(identity);
      return queue(async()=>{const old=get(selected);if(!old)return {ok:false,code:'invalid-operation'};const next=structuredClone(old);if(label===null)delete next.label;else next.label=label;return commit(next,'label');});
    },
    acknowledge(identity:Identity,noticeId:string,consumerId:string):Promise<Outcome>{
      if(!identify(identity)||!id(noticeId)||!consumers.some(c=>c.id===consumerId))return Promise.resolve({ok:false,code:'invalid-operation'});
      const selected=structuredClone(identity);
      return queue(async()=>{
        const previous=get(selected);if(!previous)return {ok:false,code:'invalid-operation'};
        const session=structuredClone(previous),notice=session.notices.find(item=>item.id===noticeId);
        if(!notice)return {ok:false,code:'invalid-operation'};
        if(notice.acknowledgedBy.includes(consumerId))return {ok:true,revision:data.revision,outcome:'duplicate'};
        notice.acknowledgedBy.push(consumerId);return commit(session,'notice.acknowledged');
      });
    },
    recoverApproval(identity:Identity,turnId:string,expectedRevision:number):Promise<Outcome>{
      if(!identify(identity)||!id(turnId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
        return Promise.resolve({ok:false,code:'invalid-operation'});
      const selected=structuredClone(identity);
      return queue(async()=>{
        if(data.revision!==expectedRevision)return {ok:false,code:'revision-conflict'};
        const previous=get(selected);
        if(!previous||previous.turn.status!=='known'||previous.turn.id!==turnId||
          !(restarted.has(identityKey(selected))||now()-previous.lastEvidenceAtMs>=LIMITS.staleMs))
          return {ok:false,code:'invalid-operation'};
        const targets=previous.attention.filter(item=>item.kind==='approval'&&item.id.status==='unknown'&&
          item.turn.status==='known'&&item.turn.id===turnId);
        if(targets.length!==1)return {ok:false,code:'invalid-operation'};
        const next=structuredClone(previous);
        next.attention.splice(next.attention.findIndex(item=>item.kind==='approval'&&item.id.status==='unknown'&&
          item.turn.status==='known'&&item.turn.id===turnId),1);
        // The distinct hash records explicit recovery in the existing version 1.0
        // journal shape without claiming provider resolution or breaking rollback.
        return commit(next,'attention.resolved','ambiguous',recoveryJournalKey(selected,turnId));
      });
    },
    snapshot():Snapshot{
      const at=now();
      const sessions:Snapshot['sessions']=data.sessions.map(session=>{
        const {seen,watermarks,retiredTurns,...visible}=structuredClone(session);
        const age=Math.max(0,at-session.lastEvidenceAtMs),restartUncertain=restarted.has(identityKey(session.identity));
        return {...visible,observationAgeMs:age,freshness:restartUncertain||age>=LIMITS.staleMs?'uncertain':'current',restartUncertain,children:{active:0,uncertain:0}};
      });
      for(const session of sessions)session.children=childCounts(sessions,session.identity);
      return freeze({apiVersion:'1.0',revision:data.revision,asOfMs:at,collector,lossCount,sessions});
    },
    journal(){const at=now();return freeze(structuredClone(data.journal.filter(row=>row.atMs>at-LIMITS.journalAgeMs).slice(-LIMITS.journalEvents)));},
    maintain(){return queue(maintenance);},
    async exportState():Promise<DurableState>{
      if(collector==='faulted'||collector==='closed')throw new Error('unavailable');
      collector='quiesced';clearTimeout(maintenanceTimer);await tail;
      if((collector as Snapshot['collector'])==='faulted'||inFlight)throw new Error('unavailable');
      const exported=validateExport(data);if(!exported.ok)throw new Error('invalid-state');
      return freeze(exported.value);
    },
    async shutdown():Promise<void>{
      if(collector==='closed')return;
      if(collector!=='faulted')collector='quiesced';clearTimeout(maintenanceTimer);await tail;
      if(inFlight){const outstanding=inFlight;activeAbort?.abort();try{await io(()=>outstanding);}catch{collector='faulted';throw new Error('storage-unavailable');}}
      try{await io(()=>lease.release());collector='closed';feeds.close();}
      catch{collector='faulted';throw new Error('storage-unavailable');}
    }
  };
}
