import type {Envelope,Identity} from '@jimmie-potts/agent-lifecycle-contracts';

export const MAX_NORMALIZED_EVENT_BYTES=2048;
export const MAX_PENDING_EVENTS=128;
export const MAX_PENDING_BYTES=262144;
export const MAX_TIMEOUT_MS=3000;
export type SourceConfiguration=Readonly<{provider:'codex'|'claude';client:'cli'|'desktop'|'code';hostId:string;sourceId:string;hook:string}>;
export type EmitterOptions=Readonly<{source:SourceConfiguration;send:(event:Readonly<Envelope>,signal:AbortSignal)=>Promise<void>;
  enabled?:boolean;qualified?:boolean;clock?:()=>number;timeoutMs?:number;maxPending?:number;maxPendingBytes?:number}>;
export class EmitterConfigurationError extends Error {
  constructor(readonly code:string){super(code);this.name='EmitterConfigurationError';Object.freeze(this);}
}
type Field={state:'missing'}|{state:'invalid'}|{state:'value';value:unknown};
const identifier=/^[A-Za-z0-9_.-]{1,128}(?![\s\S])/;
function plain(value:unknown):object|null {
  try{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype?value:null;}
  catch{return null;}
}
function field(record:object,key:string):Field {
  try{
    const descriptor=Object.getOwnPropertyDescriptor(record,key);
    if(!descriptor)return {state:'missing'};
    return descriptor.enumerable&&'value' in descriptor?{state:'value',value:descriptor.value}:{state:'invalid'};
  }catch{return {state:'invalid'};}
}
function string(record:object,key:string):string|null {
  const value=field(record,key);return value.state==='value'&&typeof value.value==='string'?value.value:null;
}
function supported(provider:string,hook:string):boolean {
  return ['SessionStart','UserPromptSubmit','PermissionRequest','Stop','SessionEnd','SubagentStart','SubagentStop'].includes(hook)||(provider==='codex'&&hook==='Interrupt');
}
function parseSource(input:unknown):SourceConfiguration|null {
  const record=plain(input);if(!record)return null;
  const provider=string(record,'provider'),client=string(record,'client'),hostId=string(record,'hostId'),sourceId=string(record,'sourceId'),hook=string(record,'hook');
  if((provider!=='codex'&&provider!=='claude')||(client!=='cli'&&client!=='desktop'&&client!=='code')||
    !hostId||!sourceId||!hook||!identifier.test(hostId)||!identifier.test(sourceId)||!supported(provider,hook)||
    (provider==='codex'?client==='code':client!=='code'))return null;
  return Object.freeze({provider,client,hostId,sourceId,hook});
}
function selectIdentity(source:SourceConfiguration,sessionId:string):Identity {
  return Object.freeze({provider:source.provider,client:source.client,hostId:source.hostId,sourceId:source.sourceId,sessionId});
}
export function normalizeHook(raw:unknown,source:SourceConfiguration,nowMs:number):Envelope|null {
  try{
    if(!Number.isSafeInteger(nowMs)||nowMs<0)return null;
    const selected=parseSource(source),record=plain(raw);if(!selected||!record)return null;
    const sessionId=string(record,'session_id');if(!sessionId||!identifier.test(sessionId))return null;
    const childHook=selected.hook==='SubagentStart'||selected.hook==='SubagentStop';
    let identity:Identity,parent:Envelope['parent'],turn:Envelope['turn']=Object.freeze({status:'unknown'});
    if(childHook){
      const childId=string(record,'agent_id');
      if(!childId||!identifier.test(childId)||childId===sessionId)return null;
      identity=selectIdentity(selected,childId);parent=Object.freeze({status:'known',identity:selectIdentity(selected,sessionId)});
      // Common prompt/turn fields describe the parent invocation, not a child turn.
    }else{
      identity=selectIdentity(selected,sessionId);parent=Object.freeze({status:'unknown'});
      const supplied=field(record,selected.provider==='codex'?'turn_id':'prompt_id');
      if(supplied.state!=='missing'){
        if(supplied.state!=='value'||typeof supplied.value!=='string'||!identifier.test(supplied.value))return null;
        turn=Object.freeze({status:'known',id:supplied.value});
      }
    }
    let event:Envelope['event'];
    switch(selected.hook){
      case 'SessionStart':case 'SubagentStart':event={kind:'session.started'};break;
      case 'UserPromptSubmit':event={kind:'turn.started'};break;
      case 'PermissionRequest':event={kind:'attention.approval',attention:Object.freeze({status:'unknown'})};break;
      case 'Stop':case 'SubagentStop':event={kind:'turn.ended'};break;
      case 'Interrupt':event={kind:'turn.interrupted'};break;
      case 'SessionEnd':event={kind:'runtime.ended'};break;
      default:return null;
    }
    const envelope:Envelope={apiVersion:'1.0',identity,turn,parent,event:Object.freeze(event),observedAtMs:nowMs,ordering:Object.freeze({status:'unknown'})};
    if(Buffer.byteLength(JSON.stringify(envelope))>MAX_NORMALIZED_EVENT_BYTES)return null;
    return Object.freeze(envelope);
  }catch{return null;}
}

type Item={envelope:Envelope;bytes:number;deadlineMs:number;resolve:()=>void;resolved:boolean;released:boolean};
type Active={item:Item;controller:AbortController;timer:ReturnType<typeof setTimeout>|undefined;logicalDone:boolean};
type Counters=Record<'accepted'|'delivered'|'droppedInvalid'|'droppedInactive'|'droppedSaturated'|'droppedFaulted'|'droppedClosed'|'failed'|'timedOut'|'cancelled'|'loss',number>;
export type EmitterStats=Readonly<Counters&{resyncNeeded:boolean;pending:number;pendingBytes:number;queued:number;inFlight:boolean;faulted:boolean;closed:boolean}>;
function fail(code:string):never{throw new EmitterConfigurationError(code);}
function option(record:object,key:string,fallback:unknown,code:string):unknown {
  const value=field(record,key);if(value.state==='missing')return fallback;if(value.state==='invalid')fail(code);return value.value;
}
function limit(value:unknown,maximum:number,code:string):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>maximum)fail(code);return value;
}
export function createEmitter(options:EmitterOptions){
  const record=plain(options);if(!record)fail('invalid-options');
  const rawSource=field(record,'source'),source=rawSource.state==='value'?parseSource(rawSource.value):null;
  if(!source)fail('invalid-source');
  const sendField=field(record,'send');if(sendField.state!=='value'||typeof sendField.value!=='function')fail('invalid-send');
  const send=sendField.value as EmitterOptions['send'];
  const enabled=option(record,'enabled',false,'invalid-enabled'),qualified=option(record,'qualified',false,'invalid-qualified');
  if(typeof enabled!=='boolean')fail('invalid-enabled');if(typeof qualified!=='boolean')fail('invalid-qualified');
  const clockOption=option(record,'clock',Date.now,'invalid-clock');if(typeof clockOption!=='function')fail('invalid-clock');
  const clock=clockOption as ()=>number;
  const timeoutMs=limit(option(record,'timeoutMs',MAX_TIMEOUT_MS,'invalid-timeout'),MAX_TIMEOUT_MS,'invalid-timeout');
  const maxPending=limit(option(record,'maxPending',MAX_PENDING_EVENTS,'invalid-max-pending'),MAX_PENDING_EVENTS,'invalid-max-pending');
  const maxBytes=limit(option(record,'maxPendingBytes',MAX_PENDING_BYTES,'invalid-max-pending-bytes'),MAX_PENDING_BYTES,'invalid-max-pending-bytes');
  const queue:Item[]=[],counters:Counters={accepted:0,delivered:0,droppedInvalid:0,droppedInactive:0,droppedSaturated:0,droppedFaulted:0,droppedClosed:0,failed:0,timedOut:0,cancelled:0,loss:0};
  let active:Active|null=null,pending=0,pendingBytes=0,resyncNeeded=false,faulted=false,closed=false;
  const increment=(key:keyof Counters)=>{counters[key]=Math.min(Number.MAX_SAFE_INTEGER,counters[key]+1);};
  const loss=(key:keyof Counters)=>{increment(key);increment('loss');resyncNeeded=true;};
  const resolve=(item:Item)=>{if(!item.resolved){item.resolved=true;item.resolve();}};
  const release=(item:Item)=>{if(!item.released){item.released=true;pending--;pendingBytes-=item.bytes;}};
  function abandon(counter:'droppedFaulted'|'cancelled'){
    while(queue.length){const item=queue.shift()!;loss(counter);release(item);resolve(item);}
  }
  function finish(current:Active,succeeded:boolean){
    if(active!==current)return;
    clearTimeout(current.timer);current.timer=undefined;
    if(!current.logicalDone){current.logicalDone=true;if(succeeded)increment('delivered');else loss('failed');resolve(current.item);}
    release(current.item);active=null;faulted=false;pump();
  }
  function timeOut(current:Active){
    if(active!==current||current.logicalDone)return;
    current.logicalDone=true;current.timer=undefined;faulted=true;loss('timedOut');resolve(current.item);
    try{current.controller.abort();}catch{}
    abandon('droppedFaulted');
  }
  function pump(){
    if(closed||faulted||active)return;
    while(queue.length){
      const item=queue.shift()!;
      if(item.deadlineMs<=performance.now()){loss('timedOut');release(item);resolve(item);continue;}
      const current:Active={item,controller:new AbortController(),timer:undefined,logicalDone:false};active=current;
      let underlying:Promise<void>;
      try{underlying=Promise.resolve(send(item.envelope,current.controller.signal));}catch{finish(current,false);return;}
      underlying.then(()=>finish(current,true),()=>finish(current,false));
      if(active===current&&!current.logicalDone)current.timer=setTimeout(()=>timeOut(current),Math.max(1,Math.ceil(item.deadlineMs-performance.now())));
      return;
    }
  }
  function emit(raw:unknown):Promise<void>{
    if(closed){loss('droppedClosed');return Promise.resolve();}
    if(!enabled||!qualified){increment('droppedInactive');return Promise.resolve();}
    if(faulted){loss('droppedFaulted');return Promise.resolve();}
    let observedAtMs:number;
    try{observedAtMs=clock();}catch{increment('droppedInvalid');return Promise.resolve();}
    const envelope=normalizeHook(raw,source!,observedAtMs);
    if(!envelope){increment('droppedInvalid');return Promise.resolve();}
    const bytes=Buffer.byteLength(JSON.stringify(envelope));
    if(pending>=maxPending||bytes>maxBytes-pendingBytes){loss('droppedSaturated');return Promise.resolve();}
    increment('accepted');pending++;pendingBytes+=bytes;
    return new Promise(resolve=>{queue.push({envelope,bytes,deadlineMs:performance.now()+timeoutMs,resolve,resolved:false,released:false});pump();});
  }
  function close():Promise<void>{
    if(closed)return Promise.resolve();closed=true;abandon('cancelled');
    const current=active;
    if(current&&!current.logicalDone){
      clearTimeout(current.timer);current.timer=undefined;current.logicalDone=true;faulted=true;loss('cancelled');resolve(current.item);
      try{current.controller.abort();}catch{}
    }
    return Promise.resolve();
  }
  function stats():EmitterStats{return Object.freeze({...counters,resyncNeeded,pending,pendingBytes,queued:queue.length,inFlight:active!==null,faulted,closed});}
  return Object.freeze({emit,close,stats});
}
