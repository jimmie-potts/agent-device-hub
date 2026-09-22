import type {Snapshot, Request, Command} from '../../../packages/contracts/src/types';
export type {Snapshot, Command};
export type Component = {id:string;kind:string;controllerId:string;deviceId:string;health:string;pending:number;editorUrl?:string};
export type Context = {apiVersion:'1.0';control:boolean;consumers:string[];components:Component[]};
export function safeEditorUrl(value:unknown):string|undefined {
 try {if(typeof value!=='string')return;const u=new URL(value);if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&!u.search&&!u.hash)return u.href;}catch{}
}
export function makeCommand(snapshot:Snapshot,command:Command):Request {
 return {apiVersion:'1.0',controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,requestId:structuredClone(snapshot.nextRequestId),expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:structuredClone(snapshot.generation),command};
}
export type GeneralReasons={power?:string;brightness?:string;media?:string;scenes?:string};
/** Availability is declared capability times control scope. A missing capability is named before scope, stale evidence or mode gating. Content gating applies to media and scenes only. */
export function generalReasons({snapshot,control,common,content}:{snapshot:Pick<Snapshot,'capabilities'>|undefined;control:boolean;common?:string;content?:string}):GeneralReasons {
 const reason=(name:'power'|'brightness'|'media'|'scenes',label:string,gate?:string)=>{
  if(!snapshot)return 'No controller snapshot';
  if(!snapshot.capabilities[name].supported)return `${label} not declared by this controller`;
  if(!control)return 'Your credential is read-only';
  return common??gate;
 };
 return {power:reason('power','Power is'),brightness:reason('brightness','Brightness is'),media:reason('media','Media is',content),scenes:reason('scenes','Scenes are',content)};
}
/** Scenes come only from the controller v1 declaration. A user-chosen name from the integration snapshot labels a scene when supplied; nothing else is copied. */
export function sceneOptions(snapshot:Pick<Snapshot,'capabilities'>,integration:{scenes?:{id:string;name?:string}[]}|undefined):{value:string;label:string}[] {
 const scenes=snapshot.capabilities.scenes;if(!scenes.supported)return [];
 const names=new Map((integration?.scenes??[]).filter(s=>typeof s.name==='string').map(s=>[s.id,s.name as string]));
 return scenes.sceneIds.map(id=>({value:id,label:names.get(id)??id}));
}
/** Nanoleaf presents agent status in Work and Quiet. Scenes wait for an observed Free mode with no pending mode change; nothing switches or restores on its own. */
export function nanoleafContentReason(snapshot:Pick<Snapshot,'state'>):string|undefined {
 const pending=snapshot.state.pending.find(p=>p.command.kind==='mode.set');
 if(pending&&pending.command.kind==='mode.set')return `Nanoleaf is switching to ${pending.command.mode}; wait for the observed mode`;
 const mode=snapshot.state.desired.mode;
 if(mode.status!=='known')return 'Nanoleaf mode is unknown; scene activation needs an observed Free mode';
 return mode.value==='Free'?undefined:`Nanoleaf is in ${mode.value} and presents agent status; scene activation needs Free`;
}
/** The brightness draft starts from desired evidence, then observed evidence; missing evidence stays visibly unknown. */
export function brightnessDraft(snapshot:Pick<Snapshot,'state'|'capabilities'>):{value:number;source:'desired'|'observed'|'unknown'} {
 const desired=snapshot.state.desired.brightness,observation=snapshot.state.observation;
 if(desired.status==='known')return {value:desired.value,source:'desired'};
 if(observation.status==='known'&&observation.brightness.status==='known')return {value:observation.brightness.value,source:'observed'};
 const range=snapshot.capabilities.brightness;
 return {value:range.supported?Math.round((range.minimum+range.maximum)/2):50,source:'unknown'};
}
export class ApiError extends Error {constructor(public code:string,public status=0,public detail:unknown=undefined){super(code);}}
export class Api {
 private mutations=new Map<string,number>();
 private queues=new Map<string,{running:boolean;pending:{write:boolean;start:()=>void}[]}>();
 private schedule<T>(key:string,write:boolean,job:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  let queue=this.queues.get(key);if(!queue){queue={running:false,pending:[]};this.queues.set(key,queue);}
  const selected=queue;
  if(selected.pending.length>=4)return Promise.reject(new ApiError('capacity',429));
  return new Promise<T>((resolve,reject)=>{
   let started=false;
   const remove=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);const i=selected.pending.indexOf(entry);if(i>=0)selected.pending.splice(i,1);};
   const cancel=()=>{if(!started){remove();reject(new ApiError('request-cancelled'));}};
   const next=()=>{selected.running=false;const index=selected.pending.findIndex(item=>item.write);const item=selected.pending.splice(index<0?0:index,1)[0];if(item)item.start();else this.queues.delete(key);};
   const entry={write,start:()=>{started=true;remove();selected.running=true;void job().then(resolve,reject).finally(next);}};
   const timer=setTimeout(()=>{if(!started){remove();reject(new ApiError('capacity',429));}},5000);
   if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
   if(selected.running)selected.pending.push(entry);else entry.start();
  });
 }

 constructor(private token:string){}
 request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const device=/^\/api\/controllers\/v1\/([^/]+)\//.exec(path)?.[1];
  return device?this.schedule(device,body!==undefined,()=>this.perform<T>(path,body,signal,device),signal):this.perform<T>(path,body,signal,'monitor');
 }
 private async perform<T>(path:string,body:unknown,signal:AbortSignal|undefined,channel:string):Promise<T> {
  if(body!==undefined)this.mutations.set(channel,(this.mutations.get(channel)??0)+1);const generation=this.mutations.get(channel)??0;
  try {
   const response=await fetch(path,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','x-pixoo-request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
   const value=await response.json();
   if(body===undefined&&generation!==(this.mutations.get(channel)??0))throw new ApiError('snapshot-superseded');
   if(!response.ok)throw new ApiError(value.error?.code??value.failure?.code??'unavailable',response.status,value);
   if(value.ok===false)throw new ApiError(value.code??'unavailable',503,value);
   return value as T;
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(body===undefined?'connection-unavailable':'uncertain-result');}finally{if(body!==undefined)this.mutations.set(channel,(this.mutations.get(channel)??0)+1);}
 }
 async feed(signal:AbortSignal,onChange:()=>void,onStatus:(connected:boolean)=>void){
  let cursor='',delay=500;
  while(!signal.aborted){
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   const timeout=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>timeout.abort(),8000);};
   try {
    touch();const response=await fetch('/api/monitor/v1/changes',{headers:{authorization:`Bearer ${this.token}`,...(cursor?{'last-event-id':cursor}:{})},signal:AbortSignal.any([signal,timeout.signal]),cache:'no-store',redirect:'error'});
    if(!response.ok||!response.body)throw new Error('feed-unavailable');
    onStatus(true);delay=500;reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();
    while(!signal.aborted){const chunk=await reader.read();if(chunk.done)break;touch();buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>65536)throw new Error('feed-capacity');let end;
     while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const id=/^id: (.+)$/m.exec(event)?.[1];if(id)cursor=id;if(/^event: (state|resync)$/m.test(event))onChange();}
    }
   }catch{}finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
   if(signal.aborted)return;onStatus(false);
   await new Promise<void>(resolve=>{const done=()=>{clearTimeout(t);signal.removeEventListener('abort',done);resolve();};const t=setTimeout(done,delay);signal.addEventListener('abort',done,{once:true});});delay=Math.min(delay*2,10000);
  }
 }
}

export type ReceiptEvidence={priorEffects?:string;completedOperations?:string[];uncertainOperations?:string[]};
export function receiptEvidence(receipt:ReceiptEvidence):string {
 return `Prior effects: ${receipt.priorEffects??'unknown'}. Completed: ${receipt.completedOperations?.join(', ')||'none recorded'}. Uncertain operations: ${receipt.uncertainOperations?.join(', ')||'none recorded'}.`;
}

/** A transport error must never erase a controller's explicit effect evidence. */
export function failureMessage(error:unknown):{message:string;locked:boolean}{
 const code=error instanceof ApiError?error.code:'uncertain-result';
 const detail=error instanceof ApiError?error.detail:undefined;
 if(detail&&typeof detail==='object'&&'outcome' in detail){
  const receipt=detail as {outcome:string;priorEffects?:string;completedOperations?:string[];uncertainOperations?:string[]};
  return {message:`${receipt.outcome}. ${receiptEvidence(receipt)} ${code}. Your edit is retained.`,locked:receipt.priorEffects!=='none'||['uncertain','partially-applied'].includes(receipt.outcome)};
 }
 if(code==='uncertain-result')return {message:'Uncertain result. Do not repeat this command. Refresh observations before starting a new edit.',locked:true};
 return {message:`Not applied: ${code}. Your edit is retained.`,locked:false};
}
