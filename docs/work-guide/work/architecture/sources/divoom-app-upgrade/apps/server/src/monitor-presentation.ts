import type {Player} from '@pixoo/playback';
import {presentationConfiguration,type PresentationConfiguration,type PresentationStatus,type IntegrationAction,type NowPlayingMedia,type NowPlayingSetting,type NowPlayingState} from '@pixoo/core';
import {DashboardService} from './dashboard-service.js';
import type {MonitorView} from './monitor-source.js';
import {renderNowPlaying,trackKey} from './now-playing.js';
import type {PlaybackSourceStatus} from './now-playing-source.js';
import {ApiError} from './security.js';
export const defaultPresentation:PresentationConfiguration={version:1,mode:'media',filter:{},cadenceMs:1000};
export const defaultNowPlaying:NowPlayingSetting={version:1,media:'off'};
/** Everything the browser shows except whether a reader is configured, which the backend adds. */
export type NowPlayingStatus=Omit<NowPlayingState,'configured'>;
/** How long a now-playing pop-up stays up, in Monitor and in Media. */
export const POPUP_MS=10000;
interface Options {
 configuration?:PresentationConfiguration;save:(value:PresentationConfiguration)=>Promise<void>;clock?:()=>number;renderCadenceMs?:number;
 nowPlaying?:NowPlayingSetting;saveNowPlaying?:(value:NowPlayingSetting)=>Promise<void>;
}
type Takeover={kind:'popup'|'whole';generation:number;until:number};
const blocking=new Set(['approval','input','question']);
export class MonitorPresentation {
 private configuration:PresentationConfiguration;
 private dashboard:DashboardService;
 private view:MonitorView|null=null;
 private generation=0;
 private playerGeneration=0;
 private active=false;
 private pendingMode:PresentationStatus['pendingMode']=null;
 private inFlight=false;
 private lastStart=-Infinity;
 /** The last submitted frame's source: a dashboard rendition or a card. */
 private lastFrame='';
 private playback:PlaybackSourceStatus={source:'unavailable',view:{card:false}};
 private nowPlaying:NowPlayingSetting;
 /** The last fresh track, and whether it was playing; stale reads never change it. */
 private heard:{key:string|null;playing:boolean}={key:null,playing:false};
 private popupUntil=0;
 private takeover:Takeover|null=null;
 private takeoverPending=false;
 private lastTakeover:NowPlayingStatus['lastTakeover']=null;
 private lastOutcome:PresentationStatus['lastOutcome']=null;
 private tail:Promise<unknown>=Promise.resolve();
 private closed=false;
 private interrupts=0;
 private clock:()=>number;
 private unsubscribe:()=>void;
 onChange=()=>{};
 constructor(private player:Player,private options:Options){
  this.configuration=presentationConfiguration.parse(options.configuration??defaultPresentation);
  this.clock=options.clock??(()=>performance.now());this.dashboard=new DashboardService({clock:this.clock,cadenceMs:options.renderCadenceMs??1000});
  this.nowPlaying=structuredClone(options.nowPlaying??defaultNowPlaying);
  this.unsubscribe=player.subscribe(()=>{
   const state=player.getState();
   if(this.active&&(state.generation!==this.playerGeneration||!state.requestedScreenOn)){this.suspend();}
   // Any player change the takeover did not make, or screen-off, is the user's: never resume over it.
   if(this.takeover&&(state.generation!==this.takeover.generation||!state.requestedScreenOn))this.dropTakeover();
  });
 }
 status():PresentationStatus{return {configuration:structuredClone(this.configuration),sourceRevision:this.view?.snapshot?.revision??null,sourceConnection:this.view?.connection??'unavailable',renditionGeneration:this.dashboard.status().rendition?.generation??null,generation:this.generation,pendingMode:this.pendingMode,participating:this.active,inFlight:this.inFlight?1:0,lastOutcome:structuredClone(this.lastOutcome)};}
 rendition(){return this.dashboard.status();}
 submit(view:MonitorView){if(this.closed)return;this.view=structuredClone(view);this.dashboard.submit(view,this.configuration.filter);if(this.attention())this.popupUntil=0;this.onChange();}
 interrupt(){this.interrupts++;this.dropTakeover();this.suspend();}
 suspend(){this.active=false;this.generation++;this.lastFrame='';this.popupUntil=0;this.onChange();}
 private attention():boolean{return this.view?.snapshot?.sessions.some(session=>session.attention.some(item=>blocking.has(item.kind)))??false;}
 /** Latest playback evidence. A new fresh track, or playback starting, is a start; stale reads are never one. */
 submitPlayback(status:PlaybackSourceStatus){
  if(this.closed)return;
  this.playback=structuredClone(status);
  const view=status.view;let started=false;
  if(view.card&&!view.stale){const key=trackKey(view);started=view.status==='playing'&&(!this.heard.playing||key!==this.heard.key);this.heard={key,playing:view.status==='playing'};}
  else if(!view.card)this.heard={...this.heard,playing:false};
  if(started&&this.active&&!this.attention())this.popupUntil=this.clock()+POPUP_MS;
  if(started&&this.nowPlaying.media==='popup')this.beginTakeover('popup');
  if(this.nowPlaying.media==='whole'&&view.card)this.beginTakeover('whole');
  this.settleTakeover();this.onChange();
 }
 nowPlayingStatus():NowPlayingStatus{
  const frame=this.frame();
  return {setting:structuredClone(this.nowPlaying),source:this.playback.source,view:structuredClone(this.playback.view),
   showing:frame?.card?'card':frame?'dashboard':'none',takeover:this.takeover?.kind??null,lastTakeover:this.lastTakeover,
   card:this.playback.view.card?Array.from(renderNowPlaying(this.playback.view)):null};
 }
 /** Persist a new Media setting, then end a takeover it no longer wants or start one it now does. */
 async setNowPlaying(media:NowPlayingMedia):Promise<void>{
  return this.enqueue(async()=>{
   const next:NowPlayingSetting={version:1,media};
   await this.options.saveNowPlaying?.(next);this.nowPlaying=next;
   this.settleTakeover();if(media==='whole'&&this.playback.view.card)this.beginTakeover('whole');this.onChange();
  });
 }
 private eligible(kind:Takeover['kind']):boolean{
  const state=this.player.getState();
  return !this.closed&&!this.active&&this.configuration.mode==='media'&&this.nowPlaying.media===kind&&this.playback.view.card&&state.intent==='active'&&state.requestedScreenOn;
 }
 /** Pause an actively playing playlist for the card, remembering the generation our pause produced. */
 private beginTakeover(kind:Takeover['kind']){
  if(this.takeover||this.takeoverPending||!this.eligible(kind))return;
  this.takeoverPending=true;
  void this.enqueue(async()=>{
   if(!this.eligible(kind))return;
   await this.player.pause();
   const state=this.player.getState();
   if(this.closed||this.configuration.mode!=='media'||state.intent!=='paused'||!state.requestedScreenOn)return;
   this.takeover={kind,generation:state.generation,until:kind==='popup'?this.clock()+POPUP_MS:Infinity};this.lastFrame='';this.onChange();
  }).catch(()=>{}).finally(()=>{this.takeoverPending=false;});
 }
 /** End a takeover whose card is gone, whose pop-up expired or whose setting changed. */
 private settleTakeover(){
  const takeover=this.takeover;if(!takeover)return;
  if(this.playback.view.card&&this.clock()<takeover.until&&this.nowPlaying.media===takeover.kind)return;
  this.takeover=null;this.lastFrame='';this.onChange();
  void this.enqueue(async()=>{
   const state=this.player.getState();
   if(this.closed||this.configuration.mode!=='media'||state.generation!==takeover.generation||state.intent!=='paused'||!state.requestedScreenOn){this.lastTakeover='dropped';return;}
   await this.player.resume();this.lastTakeover='resumed';this.onChange();
  }).catch(()=>{this.lastTakeover='dropped';});
 }
 /** Forget a takeover without resuming: the user, the screen or a failure owns what happens next. */
 private dropTakeover(){if(!this.takeover)return;this.takeover=null;this.lastTakeover='dropped';this.lastFrame='';this.onChange();}
 /** The picture the display should show now, if the presentation owns it. */
 private frame():{key:string;rgb:Uint8Array|number[];generation:number;card:boolean}|null{
  const view=this.playback.view;
  if(this.active){
   if(this.popupUntil&&view.card)return {key:'card:'+JSON.stringify(view),rgb:renderNowPlaying(view),generation:this.playerGeneration,card:true};
   const rendition=this.dashboard.status().rendition;
   return rendition?{key:'dashboard:'+rendition.generation,rgb:rendition.rgb,generation:this.playerGeneration,card:false}:null;
  }
  if(this.takeover&&view.card)return {key:'card:'+JSON.stringify(view),rgb:renderNowPlaying(view),generation:this.takeover.generation,card:true};
  return null;
 }
 private enqueue<T>(work:()=>Promise<T>):Promise<T>{
  if(this.closed)return Promise.reject(new ApiError('closed',503));
  const result=this.tail.then(()=>{if(this.closed)throw new ApiError('closed',503);return work();});this.tail=result.catch(()=>{});return result;
 }
 async configure(action:IntegrationAction,admit:()=>void=()=>{}):Promise<void>{
  const interrupts=this.interrupts;
  return this.enqueue(async()=>{
   if(interrupts!==this.interrupts)throw new ApiError('cancelled',409);
   admit();const wasActive=this.active;this.dropTakeover();
   const next=presentationConfiguration.parse(action.operation==='mode'?{...this.configuration,mode:action.mode}:{...this.configuration,filter:action.filter,cadenceMs:action.cadenceMs});
   this.suspend();this.pendingMode=next.mode;this.onChange();
   const paused=action.operation==='mode'||wasActive?this.player.pause():Promise.resolve(),generation=this.player.getState().generation;
   try{
    await paused;await this.options.save(next);this.configuration=next;
    if(this.view)this.dashboard.submit(this.view,next.filter);
    this.playerGeneration=generation;
    this.active=!this.closed&&this.player.getState().generation===generation&&this.player.getState().requestedScreenOn&&next.mode==='monitor'&&(action.operation==='mode'||wasActive);
   }finally{this.pendingMode=null;this.onChange();}
  });
 }
 // Startup restore of a saved Monitor selection, used only for device mode.
 // It reuses explicit activation's pause and guards without saving, and a
 // failed first upload suspends through tick() like any other transmission.
 async restore():Promise<void>{
  return this.enqueue(async()=>{
   if(this.configuration.mode!=='monitor')return;
   this.suspend();const paused=this.player.pause(),generation=this.player.getState().generation;
   await paused;this.playerGeneration=generation;
   this.active=!this.closed&&this.player.getState().generation===generation&&this.player.getState().requestedScreenOn;
   this.onChange();
  });
 }
 async media<T>(action:()=>Promise<T>,starts:boolean):Promise<T>{
  if(this.closed)throw new ApiError('closed',503);
  if(!starts){
   // Player cancels capture synchronously before its persistence queue drains.
   // Keep that boundary even while a presentation transition is awaiting I/O.
   this.interrupt();return action();
  }
  const interrupts=this.interrupts;
  const check=()=>{if(this.closed||interrupts!==this.interrupts)throw new ApiError('cancelled',409);};
  const pending=await this.enqueue(async()=>{
   check();
   if(this.configuration.mode==='monitor'){
    this.suspend();const paused=this.player.pause(),generation=this.player.getState().generation;
    const current=()=>{check();if(generation!==this.player.getState().generation)throw new ApiError('cancelled',409);};
    await paused;current();
    const next={...this.configuration,mode:'media' as const};await this.options.save(next);this.configuration=next;this.onChange();current();
   }
   // Release the presentation queue after invoking Player, not after its
   // asynchronous capture. Later mode/media intent must reach Player's guard.
   return {result:action()};
  });
  return pending.result;
 }
 tick(){
  if(this.closed)return;
  this.dashboard.tick();
  if(this.popupUntil&&(this.clock()>=this.popupUntil||!this.playback.view.card))this.popupUntil=0;
  this.settleTakeover();
  const frame=this.frame();
  this.onChange();
  if(!frame||this.inFlight||frame.key===this.lastFrame||this.clock()-this.lastStart<this.configuration.cadenceMs)return;
  const generation=this.generation,playerGeneration=frame.generation,takeover=this.active?null:this.takeover;
  const renditionGeneration=this.dashboard.status().rendition?.generation??0;
  this.inFlight=true;this.lastStart=this.clock();this.lastFrame=frame.key;this.onChange();
  void this.player.uploadDashboard(new Uint8Array(frame.rgb),playerGeneration).then(result=>{
   // A Media takeover reports through its own status; a failed or uncertain card upload ends it without resuming.
   if(takeover){if(!result?.ok&&this.takeover===takeover)this.dropTakeover();return;}
   this.lastOutcome={generation,renditionGeneration,status:result?.ok?'sent':result&&!result.ok&&result.priorEffects==='possible'?'uncertain':!result||result.code==='cancelled'||result.code==='stale-generation'?'cancelled':'failed',...(result&&!result.ok?{code:result.code}:{})};
   if(generation===this.generation&&!result?.ok)this.suspend();
  }).catch(()=>{
   if(takeover){if(this.takeover===takeover)this.dropTakeover();return;}
   this.lastOutcome={generation,renditionGeneration,status:'failed',code:'operation-failed'};if(generation===this.generation)this.suspend();
  }).finally(()=>{this.inFlight=false;this.onChange();});
 }
 async close(){if(this.closed)return;this.closed=true;this.dropTakeover();this.suspend();this.unsubscribe();this.dashboard.close();await this.tail;}
}
