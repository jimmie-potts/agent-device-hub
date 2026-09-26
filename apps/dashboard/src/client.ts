import type {Snapshot, Request, Command} from '../../../packages/contracts/src/types';
export type {Snapshot, Command};
export type Component = {id:string;kind:string;controllerId:string;deviceId:string;health:string;pending:number;editorUrl?:string};
/** playback names the configured source only when the caller's credential grants it. */
export type Context = {apiVersion:'1.0';control:boolean;consumers:string[];components:Component[];playback?:{sourceId:string}};
export type PlaybackAction='play'|'pause'|'next'|'previous';
export type PlaybackSnapshot={apiVersion:'1.0';sourceId:string;availability:'available'|'stale'|'unavailable';observedAtMs:number|null;ageMs:number|null;
 playback:null|{status:'playing'|'paused'|'stopped'|'inactive'|'unknown';title?:string;artist?:string;album?:string;controls:PlaybackAction[]}};
export type PlaybackReceipt={requestId:string;sourceId:string;action:PlaybackAction;outcome:'sent'|'failed'|'uncertain'};
const PLAYBACK_ACTIONS:PlaybackAction[]=['play','pause','next','previous'];
/** Buttons appear only for declared actions that a control-scoped caller can send to an available source. Otherwise one reason says why none appear; undeclared names the actions the source does not offer now. */
export function playbackControls(snapshot:PlaybackSnapshot|undefined,control:boolean):{actions:PlaybackAction[];reason?:string;undeclared?:PlaybackAction[]} {
 const none=(reason:string)=>({actions:[],reason});
 if(!snapshot)return none('B.U.N.N.Y. couldn’t read the playback source');
 if(!control)return none('Your credential is read-only');
 if(snapshot.availability==='unavailable'||!snapshot.playback)return none('The source is unavailable');
 if(snapshot.availability==='stale')return none('The source’s last read is stale; controls return when it answers again');
 const {status,controls}=snapshot.playback;
 if(!controls.length)return none(status==='inactive'?'AirPlay isn’t the receiver’s current input':`The source declares no controls while ${status}`);
 return {actions:PLAYBACK_ACTIONS.filter(a=>controls.includes(a)),undeclared:PLAYBACK_ACTIONS.filter(a=>!controls.includes(a))};
}
/** The hub's playback receipt in the shared lifecycle's terms: sent was transmitted, a refusal changed nothing, and an unanswered call may have taken effect. */
export function playbackEvidence(receipt:PlaybackReceipt):ReceiptEvidence {
 return receipt.outcome==='sent'?{outcome:'sent'}:receipt.outcome==='failed'?{outcome:'failed',priorEffects:'none',failure:{code:'receiver-refused'}}:{outcome:'uncertain',failure:{code:'uncertain-result'}};
}
/** Builds one command bound to the displayed source from a read taken just before sending, or names why nothing is sent. A failed read keeps its last snapshot for display but never authorizes a command. */
export function playbackRequest(read:{snapshot?:PlaybackSnapshot;error?:string},{sourceId,action,control,requestId}:{sourceId:string;action:PlaybackAction;control:boolean;requestId:string}):{request:{requestId:string;sourceId:string;action:PlaybackAction}}|{blocked:string} {
 if(read.error||!read.snapshot)return {blocked:'B.U.N.N.Y. couldn’t read the playback source'};
 if(read.snapshot.sourceId!==sourceId)return {blocked:'the hub now reports a different playback source'};
 const available=playbackControls(read.snapshot,control);
 if(available.reason)return {blocked:available.reason};
 return available.actions.includes(action)?{request:{requestId,sourceId,action}}:{blocked:`this source no longer offers ${action}`};
}
export const isPlaybackReceipt=(value:unknown):value is PlaybackReceipt=>!!value&&typeof value==='object'&&['sent','failed','uncertain'].includes((value as PlaybackReceipt).outcome)&&typeof (value as PlaybackReceipt).sourceId==='string';
export function safeEditorUrl(value:unknown):string|undefined {
 try {if(typeof value!=='string')return;const u=new URL(value);if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&!u.search&&!u.hash)return u.href;}catch{}
}
export function makeCommand(snapshot:Snapshot,command:Command):Request {
 return {apiVersion:'1.0',controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,requestId:structuredClone(snapshot.nextRequestId),expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:structuredClone(snapshot.generation),command};
}
/** A LIFX color or color-temperature command in the owner's `lifx-light` 1.0.0 profile. */
export type LightingCommand={kind:'lifx.color.set';hue:number;saturation:number}|{kind:'lifx.temperature.set';kelvin:number};
/** The LIFX owner's lighting snapshot through the hub: its controller v1 snapshot and the lighting section. Colors are LIFX wire units. */
export type Lighting={profile:{profileId:'lifx-light';profileVersion:'1.0.0'};controller:Snapshot;lighting:{capabilities:{color:boolean;temperature:{minimum:number;maximum:number}|null;effects:false};
 pending:{requestId:{epoch:string;sequence:number};command:LightingCommand}[];observation:{status:'unknown'}|{status:'known';color:{hue:number;saturation:number;brightness:number;kelvin:number};evidenceAgeMs:number};visible:{status:'unknown'}}};
/** One lighting request carrying the guards of the controller v1 snapshot read with it. */
export function lightingCommand(snapshot:Snapshot,command:LightingCommand){
 const {command:_placeholder,...envelope}=makeCommand(snapshot,{kind:'power.set',on:true});
 return {...envelope,profile:{profileId:'lifx-light',profileVersion:'1.0.0'},command};
}
/** The last color the bulb reported, in degrees, percent and kelvin. It is read evidence, not the bulb's visible color. */
export function observedColor(lighting:Lighting['lighting']):{hue:number;saturation:number;kelvin:number;ageMs:number}|undefined {
 const o=lighting.observation;if(o.status!=='known')return;
 return {hue:Math.round(o.color.hue*360/65535),saturation:Math.round(o.color.saturation*100/65535),kelvin:o.color.kelvin,ageMs:o.evidenceAgeMs};
}
/** This bulb presents agent status in Work and Quiet (ADR 0005). Color and temperature wait for
 * the observed Free mode from the same controller v1 snapshot that guards the lighting command. */
export function lifxContentReason(snapshot:Pick<Snapshot,'state'>):string|undefined {
 const pending=snapshot.state.pending.find(p=>p.command.kind==='mode.set');
 if(pending&&pending.command.kind==='mode.set')return `This bulb is switching to ${pending.command.mode}; wait for the observed mode`;
 const mode=snapshot.state.desired.mode;
 if(mode.status!=='known')return 'This bulb’s mode is unknown; color and temperature need an observed Free mode';
 return mode.value==='Free'?undefined:`This bulb is in ${mode.value} and presents agent status; color and temperature need Free`;
}
/** A missing lighting capability is named before scope, stale evidence or mode gating, like the general controls. */
export function lightingReasons(lighting:Lighting|undefined,disabled?:string):{color?:string;temperature?:string}{
 if(!lighting)return {color:'No lighting snapshot',temperature:'No lighting snapshot'};
 const {color,temperature}=lighting.lighting.capabilities;
 const gate=disabled??lifxContentReason(lighting.controller);
 return {color:color?gate:'Color is not declared for this bulb’s qualified model',temperature:temperature?gate:'Color temperature is not declared for this bulb’s qualified model'};
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
  // Playback has its own channel, so a playback command never supersedes an in-flight monitor read.
  return device?this.schedule(device,body!==undefined,()=>this.perform<T>(path,body,signal,device),signal):this.perform<T>(path,body,signal,path.startsWith('/api/playback/')?'playback':'monitor');
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
 /** Ends this browser session as the page unloads. The request outlives the page, so its result is never observed. */
 release(){void fetch('/api/dashboard/v1/logout',{method:'POST',keepalive:true,cache:'no-store',redirect:'error',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','x-pixoo-request':'1'},body:'{}'}).catch(()=>{});}
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

export type ReceiptEvidence={outcome?:string;priorEffects?:string;completedOperations?:string[];uncertainOperations?:string[];failure?:{code:string}};
/** accepted: the command was taken or is already in effect. rejected: nothing changed, so a draft stays editable. locked: effects are unknown or partial, so the control waits for an explicit reload. */
export type Settled='accepted'|'rejected'|'locked';
const reasons:Record<string,string>={
 'revision-conflict':'another client changed this device first','stale-generation':'the device moved on before this arrived','unsupported-capability':'the device doesn’t accept this in its current state',
 capacity:'too many commands are waiting','external-control':'the device is controlled elsewhere','transport-failure':'the controller couldn’t reach the device',
 'request-conflict':'this request was already used','request-expired':'this request expired','request-order':'this request arrived out of order',
 forbidden:'your credential doesn’t allow this',unauthenticated:'your sign-in is no longer valid','invalid-request':'the request wasn’t valid','invalid-input':'the request wasn’t valid',
 cancelled:'it was cancelled before it ran','receiver-refused':'the receiver refused it','unsupported-control':'the source doesn’t offer this right now','source-unavailable':'the source isn’t answering','unknown-source':'the hub doesn’t know this source','owner-quiesced':'the hub is paused for a migration','unknown-device':'the hub doesn’t know this device','controller-unavailable':'the controller isn’t responding','monitor-unavailable':'the controller isn’t responding',
};
const reason=(code:string)=>`${reasons[code]??'the controller refused it'} (${code})`;
const unknown=(code:string)=>`Result unknown: this may have reached the device (${code}). Check the device, then reload current values before trying again.`;
/** Plain status for a command result. Transport success and saved settings are never a physical result, so accepted results ask the user to check the device. */
export type ResultMessage={message:string;locked:boolean;settled:Settled;code?:string};
/** sameMode marks a command that sends the active mode again; only then does a cancel with no code and no effects mean nothing needed reapplying. */
export function resultMessage(receipt:ReceiptEvidence|undefined,{device=true,sameMode=false}:{device?:boolean;sameMode?:boolean}={}):ResultMessage{
 const check=device?' B.U.N.N.Y. can’t see the device, so check it to confirm.':'';
 const outcome=receipt?.outcome,code=receipt?.failure?.code,named=code?{code}:{};
 const accepted=(message:string):ResultMessage=>({message,locked:false,settled:'accepted'}),locked=(message:string):ResultMessage=>({message,locked:true,settled:'locked',...named});
 if(outcome===undefined||outcome==='applied')return accepted('Saved.'+check);
 if(outcome==='queued')return accepted('Queued. The device hasn’t received it yet.');
 if(outcome==='sent')return accepted('Sent to the device.'+check);
 if(receipt?.priorEffects==='confirmed-transmission'||outcome==='partially-applied'){
  const sent=receipt?.completedOperations?.length?`${receipt.completedOperations.join(', ')} was sent`:'part of it was sent',open=receipt?.uncertainOperations?.length?`; ${receipt.uncertainOperations.join(', ')} is unknown`:'';
  return locked(`Partly applied: ${sent}${open}${code?` (${code})`:''}. Check the device, then reload current values before trying again.`);
 }
 if((outcome==='failed'||outcome==='cancelled')&&receipt?.priorEffects==='none'){
  if(!code&&outcome==='cancelled'&&sameMode)return accepted('Already in effect. Nothing was sent.');
  const named=code??(outcome==='cancelled'?'cancelled':'unavailable');
  return {message:`Not applied: ${reason(named)}. Nothing changed.`,locked:false,settled:'rejected',code:named};
 }
 return locked(unknown(code??'uncertain-result'));
}
/** A transport error must never erase a controller's explicit effect evidence. A lost response without a receipt is uncertain; a typed error without a receipt had no effect. */
export function failureMessage(error:unknown,options?:{device?:boolean;sameMode?:boolean}):ResultMessage{
 const code=error instanceof ApiError?error.code:'uncertain-result';
 const detail=error instanceof ApiError?error.detail:undefined;
 if(detail&&typeof detail==='object'&&'outcome' in detail){const receipt=detail as ReceiptEvidence;return resultMessage({...receipt,failure:receipt.failure??{code}},options);}
 if(code==='uncertain-result')return {message:unknown(code),locked:true,settled:'locked',code};
 return {message:`Not applied: ${reason(code)}. Nothing changed.`,locked:false,settled:'rejected',code};
}
