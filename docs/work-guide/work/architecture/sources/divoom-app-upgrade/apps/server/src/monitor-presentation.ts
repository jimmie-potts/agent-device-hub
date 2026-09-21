import type {Player} from '@pixoo/playback';
import {presentationConfiguration,type PresentationConfiguration,type PresentationStatus,type IntegrationAction} from '@pixoo/core';
import {DashboardService} from './dashboard-service.js';
import type {MonitorView} from './monitor-source.js';
import {ApiError} from './security.js';
export const defaultPresentation:PresentationConfiguration={version:1,mode:'media',filter:{},cadenceMs:1000};
interface Options {configuration?:PresentationConfiguration;save:(value:PresentationConfiguration)=>Promise<void>;clock?:()=>number;renderCadenceMs?:number}
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
 private lastRendition=0;
 private lastOutcome:PresentationStatus['lastOutcome']=null;
 private tail:Promise<unknown>=Promise.resolve();
 private closed=false;
 private clock:()=>number;
 private unsubscribe:()=>void;
 onChange=()=>{};
 constructor(private player:Player,private options:Options){
  this.configuration=presentationConfiguration.parse(options.configuration??defaultPresentation);
  this.clock=options.clock??(()=>performance.now());this.dashboard=new DashboardService({clock:this.clock,cadenceMs:options.renderCadenceMs??1000});
  this.unsubscribe=player.subscribe(()=>{
   if(this.active&&(player.getState().generation!==this.playerGeneration||!player.getState().requestedScreenOn)){this.suspend();}
  });
 }
 status():PresentationStatus{return {configuration:structuredClone(this.configuration),sourceRevision:this.view?.snapshot?.revision??null,sourceConnection:this.view?.connection??'unavailable',renditionGeneration:this.dashboard.status().rendition?.generation??null,generation:this.generation,pendingMode:this.pendingMode,participating:this.active,inFlight:this.inFlight?1:0,lastOutcome:structuredClone(this.lastOutcome)};}
 rendition(){return this.dashboard.status();}
 submit(view:MonitorView){if(this.closed)return;this.view=structuredClone(view);this.dashboard.submit(view,this.configuration.filter);this.onChange();}
 suspend(){this.active=false;this.generation++;this.lastRendition=0;this.onChange();}
 private enqueue<T>(work:()=>Promise<T>):Promise<T>{
  if(this.closed)return Promise.reject(new ApiError('closed',503));
  const result=this.tail.then(()=>{if(this.closed)throw new ApiError('closed',503);return work();});this.tail=result.catch(()=>{});return result;
 }
 async configure(action:IntegrationAction,admit:()=>void=()=>{}):Promise<void>{
  return this.enqueue(async()=>{
   admit();const wasActive=this.active;
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
 async media<T>(action:()=>Promise<T>,starts:boolean):Promise<T>{
  return this.enqueue(async()=>{
   if(this.configuration.mode==='monitor'){
    this.suspend();await this.player.pause();
    if(starts){const next={...this.configuration,mode:'media' as const};await this.options.save(next);this.configuration=next;this.onChange();}
   }
   return action();
  });
 }
 tick(){
  if(this.closed)return;
  this.dashboard.tick();
  const rendition=this.dashboard.status().rendition;
  this.onChange();
  if(!this.active||this.inFlight||!rendition||rendition.generation===this.lastRendition||this.clock()-this.lastStart<this.configuration.cadenceMs)return;
  const generation=this.generation,playerGeneration=this.playerGeneration;
  this.inFlight=true;this.lastStart=this.clock();this.lastRendition=rendition.generation;this.onChange();
  void this.player.uploadDashboard(new Uint8Array(rendition.rgb),playerGeneration).then(result=>{
   this.lastOutcome={generation,renditionGeneration:rendition.generation,status:result?.ok?'sent':result&&!result.ok&&result.priorEffects==='possible'?'uncertain':!result||result.code==='cancelled'||result.code==='stale-generation'?'cancelled':'failed',...(result&&!result.ok?{code:result.code}:{})};
   if(generation===this.generation&&!result?.ok)this.suspend();
  }).catch(()=>{this.lastOutcome={generation,renditionGeneration:rendition.generation,status:'failed',code:'operation-failed'};if(generation===this.generation)this.suspend();})
   .finally(()=>{this.inFlight=false;this.onChange();});
 }
 async close(){if(this.closed)return;this.closed=true;this.suspend();this.unsubscribe();this.dashboard.close();await this.tail;}
}
