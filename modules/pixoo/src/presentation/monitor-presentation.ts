import {artworkKey, type CardContext} from './card-context.js';
import type {Player,PlayerState} from '../playback/index.js';
import {presentationConfiguration,type MomentSetting,type PresentationConfiguration,type PresentationStatus,type IntegrationAction,type NowPlayingMedia,type NowPlayingSetting,type NowPlayingState} from '../core/index.js';
import type {OperationResult,UploadResult} from '../device/index.js';
import {DashboardService} from './dashboard-service.js';
import type {MonitorView} from './sources.js';
import {renderNowPlaying,trackKey,type NowPlayingView} from './now-playing.js';
import type {DashboardLayout} from './agent-dashboard.js';
import type {PlaybackSourceStatus} from './sources.js';
import {ApiError} from './errors.js';
import {rainNoticeRefusal,type RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
export const defaultPresentation:PresentationConfiguration={version:1,mode:'media',filter:{},cadenceMs:1000};
export const defaultNowPlaying:NowPlayingSetting={version:1,media:'off'};
export const defaultMoments:MomentSetting={version:1,overMonitor:true};
/** Everything the browser shows except whether a reader is configured, which the backend adds. */
export type NowPlayingStatus=Omit<NowPlayingState,'configured'>;
/** How long a now-playing pop-up stays up, in Monitor and in Media. */
export const POPUP_MS=10000;
type Card=Extract<NowPlayingView,{card:true}>;
/** How long a card whose render failed waits before it is rendered again. */
export const CARD_RETRY_MS=5000;
/** The shortest wait between the writes that start and end a moment, whatever Monitor's cadence: they are bounded by its duration. */
const MOMENT_WRITE_GAP_MS=1000;
/** What replaces a moment's picture when no base follows it. */
const BLANK=new Uint8Array(12288);
/** One moment, as the module hands it over: its time box, and how to get its frames. */
export interface MomentPlay {
 momentId:string;coversStatus:boolean;durationMs:number;startAtMs:number;toleranceMs:number;
 frames:()=>Promise<readonly Uint8Array[]>;
 /** Staged exact art has uniform timing checked against the selected device profile. Mood frames use 500 ms. */
 delayMs?:number;
 /** Exact art also uses stopped Media, while explicit pauses and later player changes retain precedence. */
 exactArt?:true;
 notice?:RainNotice;
}
/**
 * How a moment ended. A moment that reached the display carries its `ending` and its upload. One that never did has no
 * ending: `refused` says why it did not start, and an `upload` beside it is the write that failed.
 */
export type MomentResult={ending:MomentEnding;upload:OperationResult<UploadResult>;endedAtMs:number}
 |{ending:null;refused:MomentRefusal;upload?:OperationResult<UploadResult>|undefined};
export type MomentEnding='completed'|'preempted'|'interrupted';
export type MomentRefusal='expired'|'blocked'|'cancelled'|'content'|'upload'|'unknown'|'notice';
type Moment=MomentPlay&{
 /** `preparing` gets its frames, `waiting` waits for its start, `holding` waits for the player's pause, and `showing` owns the display. */
 phase:'preparing'|'waiting'|'holding'|'showing';
 /** The base it covers, chosen at its start. */
 over:'monitor'|'media'|'idle'|'stopped-media';
 rgb:readonly Uint8Array[];generation:number;until:number;resolve:(result:MomentResult)=>void;
 upload?:OperationResult<UploadResult>|undefined;writing?:Promise<void>|undefined;writtenAt?:number;missed?:boolean;rejected?:boolean;
 noticeRefused?:boolean;noticeShortened?:boolean;
};
interface Options {
 configuration?:PresentationConfiguration;save:(value:PresentationConfiguration)=>Promise<void>;clock?:()=>number;renderCadenceMs?:number;
 nowPlaying?:NowPlayingSetting;saveNowPlaying?:(value:NowPlayingSetting)=>Promise<void>;
 moments?:MomentSetting;saveMoments?:(value:MomentSetting)=>Promise<void>;
 /** Renders the dashboard's frames, such as in a worker thread. Defaults to rendering in this thread. */
 renderDashboard?:(layout:DashboardLayout)=>Uint8Array[]|Promise<Uint8Array[]>;
 /** Renders a card's frame, such as in a worker thread. Defaults to rendering in this thread. */
 renderCard?:(view:Card,context?:CardContext)=>Uint8Array|Promise<Uint8Array>;
}
type Takeover={kind:'popup'|'whole'|'moment';generation:number;until:number};
type Frame={key:string;frames:ReadonlyArray<Uint8Array|number[]>;generation:number;card:boolean;retained?:boolean;moment?:Moment};
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
 private cardContext:CardContext|undefined;
 private cardWrite:{abort:AbortController;current:()=>boolean;key:string}|null=null;
 private nowPlaying:NowPlayingSetting;
 /** The last fresh track, and whether it was playing; stale reads never change it. */
 private heard:{key:string|null;playing:boolean}={key:null,playing:false};
 private popupUntil=0;
 private takeover:Takeover|null=null;
 private takeoverPending=false;
 private lastTakeover:NowPlayingStatus['lastTakeover']=null;
 /** The player generation the last takeover's pause retired, so a command whose upload that pause cancelled is known. */
 private heldFrom:number|null=null;
 private lastOutcome:PresentationStatus['lastOutcome']=null;
 /** The current card's frame: null while it renders, or after a failed render until `retryAt`. */
 private card:{key:string;observation:string;rgb:Uint8Array|null;retryAt:number}|null=null;
 /** The last card that finished rendering, which stays on the display while a changed card renders. */
 private previousCard:{key:string;rgb:Uint8Array}|null=null;
 private moments:MomentSetting;
 /** The one moment this presentation plays, from its admission until its ending. */
 private moment:Moment|null=null;
 /** The next write starts or ends a moment, so Monitor's cadence does not hold it back. */
 private momentWrite=false;
 /** A moment's picture is known to be on the display, and nothing has replaced it yet. */
 private artShown=false;
 private tail:Promise<unknown>=Promise.resolve();
 private closed=false;
 private interrupts=0;
 private clock:()=>number;
 private unsubscribe:()=>void;
 onChange=()=>{};
 constructor(private player:Player,private options:Options){
  this.configuration=presentationConfiguration.parse(options.configuration??defaultPresentation);
  this.clock=options.clock??(()=>performance.now());
  this.dashboard=new DashboardService({clock:this.clock,cadenceMs:options.renderCadenceMs??1000,onChange:()=>{this.onChange();},...(options.renderDashboard===undefined?{}:{render:options.renderDashboard})});
  this.nowPlaying=structuredClone(options.nowPlaying??defaultNowPlaying);
  this.moments=structuredClone(options.moments??defaultMoments);
  this.unsubscribe=player.subscribe(()=>{
   const state=player.getState();
   if(this.active&&(state.generation!==this.playerGeneration||!state.requestedScreenOn)){this.suspend();}
   // Any player change the takeover did not make, or screen-off, is the user's: never resume over it.
   if(this.takeover&&(state.generation!==this.takeover.generation||!state.requestedScreenOn))this.dropTakeover();
   // Nothing held for a moment over an idle player, so any player change or screen-off is what ends it.
   if(this.moment?.phase==='showing'&&this.moment.over==='idle'&&(state.generation!==this.moment.generation||!state.requestedScreenOn))this.endMoment('interrupted');
   if(this.moment?.phase==='showing'&&this.moment.over==='stopped-media'
    &&(state.generation!==this.moment.generation||!this.stoppedMedia()||!state.requestedScreenOn))this.endMoment('interrupted',false);
  });
 }
 status():PresentationStatus{return {configuration:structuredClone(this.configuration),sourceRevision:this.view?.snapshot?.revision??null,sourceConnection:this.view?.connection??'unavailable',renditionGeneration:this.dashboard.current()?.generation??null,generation:this.generation,pendingMode:this.pendingMode,participating:this.active,inFlight:this.inFlight?1:0,lastOutcome:structuredClone(this.lastOutcome)};}
 rendition(){return this.dashboard.status();}
 /** Current cached card only. Reading never starts a render or substitutes the previous track's pixels. */
 cachedCard():Uint8Array|null{
  const card=this.card;
  return this.playback.view.card&&card?.key===this.cardKey(this.playback.view)&&card.observation===this.observation()&&card.rgb!==null?card.rgb.slice():null;
 }
 /** The dashboard's latest layout, rendered or not, not copied: the sessions, matches and page the display record reports. */
 layout():Readonly<DashboardLayout>|null{return this.dashboard.layout();}
 /** The dashboard renders only while Monitor participates; its layout follows every input. */
 submit(view:MonitorView){if(this.closed)return;this.view=structuredClone(view);this.dashboard.submit(view,this.configuration.filter,this.active);if(this.attention())this.popupUntil=0;if(this.attentionEnds())this.endMoment('preempted');this.invalidateCardWrite();this.onChange();}
 interrupt(){this.interrupts++;this.dropTakeover();this.suspend();}
 suspend(){this.cancelCardWrite();this.active=false;this.generation++;this.lastFrame='';this.popupUntil=0;if(this.moment?.phase==='showing'&&this.moment.over!=='media')this.endMoment('interrupted');this.onChange();}
 private attention():boolean{return this.view?.snapshot?.sessions.some(session=>session.attention.some(item=>blocking.has(item.kind)))??false;}
 /** Latest playback evidence. A new fresh track, or playback starting, is a start; stale reads are never one. */
 submitPlayback(status:PlaybackSourceStatus,context?:CardContext){
  if(this.closed)return;
  this.playback=structuredClone(status);this.cardContext=context===undefined?undefined:structuredClone(context);
  this.invalidateCardWrite();
  const view=status.view;let started=false;
  if(view.card&&!view.stale){const key=trackKey(view);started=view.status==='playing'&&(!this.heard.playing||key!==this.heard.key);this.heard={key,playing:view.status==='playing'};}
  else if(!view.card)this.heard={...this.heard,playing:false};
  if(started&&this.active&&!this.attention())this.popupUntil=this.clock()+POPUP_MS;
  if(started&&this.nowPlaying.media==='popup')this.beginTakeover('popup');
  if(this.nowPlaying.media==='whole'&&view.card)this.beginTakeover('whole');
  this.settleTakeover();this.invalidateCardWrite();this.onChange();
 }
 /** What the display record reports of Now Playing, without the card's pixels. */
 nowPlayingSummary():Omit<NowPlayingStatus,'card'|'lastTakeover'|'source'>{
  const frame=this.frame();
  return {setting:this.nowPlaying,view:this.playback.view,showing:showingOf(frame),takeover:this.cardTakeover()};
 }
 nowPlayingStatus():NowPlayingStatus{
  const frame=this.frame(),card=this.cardFrame(this.playback.view);
  return {setting:structuredClone(this.nowPlaying),source:this.playback.source,view:structuredClone(this.playback.view),
   showing:showingOf(frame),takeover:this.cardTakeover(),lastTakeover:this.lastTakeover,
   card:card===null?null:Array.from(card)};
 }
 private cardTakeover():NowPlayingStatus['takeover']{return this.takeover===null||this.takeover.kind==='moment'?null:this.takeover.kind;}
 /** The moment setting and the moment on the display, as the display record reports them. */
 momentSummary():{overMonitor:boolean;playing:string|null}{return {overMonitor:this.moments.overMonitor,playing:this.moment?.phase==='showing'?this.moment.momentId:null};}
 /**
  * Why a moment could not play now, or null when it could. Over Monitor it needs the hub's permission to cover status,
  * the owner's setting and evidence that nothing needs attention. Over Media it needs a playlist in play or an idle player,
  * since nothing could repaint a paused item. A takeover keeps the display, and known attention stops either one.
  */
 momentBlock(coversStatus:boolean,exactArt=false):string|null{
  const state=this.player.getState();
  if(this.closed)return 'the presentation is closed';
  if(this.pendingMode!==null)return 'a mode change is pending';
  if(!state.requestedScreenOn)return 'the screen is off';
  if(state.availability==='offline')return 'the Pixoo is offline';
  if(this.player.startPending())return 'a start is pending';
  if(this.attention())return 'a session needs attention';
  if(this.configuration.mode==='monitor'){
   if(!this.active)return 'Monitor is not on the display';
   if(!coversStatus)return 'this moment may not cover status';
   if(!this.moments.overMonitor)return 'moments over Monitor are off';
   if(this.view?.connection!=='current')return 'the session source is not current';
   if(this.dashboard.layout()===null)return 'Monitor has no picture to return to';
   return null;
  }
  if(this.takeover!==null||(this.takeoverPending&&this.moment?.phase!=='holding'))return 'Now Playing holds the display';
  if(state.intent==='active'||(exactArt?this.stoppedMedia():this.idle(state)))return null;
  return state.itemId===null||state.intent==='stopped'?'the display may show something else':'a held item could not be repainted';
 }
 /** Whether what the display shows may not be ours: after an uncertain write, or under external control. */
 private displayUnknown(state:PlayerState):boolean{return state.lastError?.priorEffects==='possible'||state.lastError?.code==='external-control';}
 /** Ordinary moments also allow the empty pause left by Monitor. */
 private idle(state:PlayerState):boolean{return (state.intent==='stopped'||state.intent==='paused'&&state.itemId===null)&&state.state!=='error'&&!this.displayUnknown(state);}
 /** Stopped Media may retain an item, but an explicit pause or unknown display still refuses exact art. */
 private stoppedMedia():boolean{
  const state=this.player.getState();
  return state.intent==='stopped'&&state.state!=='error'&&!this.displayUnknown(state);
 }
 /** Whether a moment holds a playlist paused, so that a manual next or previous still means to keep playing. */
 momentHoldsMedia():boolean{return this.takeover?.kind==='moment'||this.moment?.phase==='holding';}
 /**
  * Runs a manual next or previous that a moment's pause would otherwise leave paused, then resumes under the takeover's
  * guard: against the generation this action produced, so a later command is never resumed over.
  */
 keepPlaying(action:()=>Promise<void>):Promise<void>{
  const pending=action(),takeover:Takeover={kind:'moment',generation:this.player.getState().generation,until:Infinity};
  return pending.then(()=>this.giveBack(takeover)).then(()=>undefined);
 }
 /** Whether a moment is being prepared, waits for its start or plays. There is one at a time. */
 momentBusy():boolean{return this.moment!==null;}
 /**
  * Plays one moment over the current base without changing the mode, and settles when it ended and its base was given
  * back. The caller has checked `momentBusy` and `momentBlock`. The start checks again, since either may have changed.
  */
 playMoment(play:MomentPlay):Promise<MomentResult>{
  return new Promise<MomentResult>(resolve=>{
   const empty=play.exactArt===true&&this.configuration.mode==='media'&&this.stoppedMedia();
   const moment:Moment={...play,phase:'preparing',over:empty?'stopped-media':'media',rgb:[],generation:empty?this.player.getState().generation:0,until:Infinity,resolve};
   this.moment=moment;
   // A failed render reaches neither the player nor the device.
   void Promise.resolve().then(play.frames).then(rgb=>{if(this.moment===moment){moment.rgb=rgb;moment.phase='waiting';}},()=>{this.refuseMoment(moment,'content');});
  });
 }
 /** Persist whether moments may cover Monitor. Turning it off ends the one over Monitor now. */
 async setMoments(overMonitor:boolean):Promise<void>{
  return this.enqueue(async()=>{
   const next:MomentSetting={version:1,overMonitor};
   await this.options.saveMoments?.(next);this.moments=next;
   if(!overMonitor&&this.moment?.phase==='showing'&&this.moment.over==='monitor')this.endMoment('interrupted');
   this.onChange();
  });
 }
 /** Whether the session source now ends the moment on the display: known attention anywhere, or lost evidence over Monitor. */
 private attentionEnds():boolean{
  if(this.moment?.phase!=='showing')return false;
  return this.attention()||(this.moment.over==='monitor'&&this.view?.connection!=='current');
 }
 private refuseMoment(moment:Moment,refused:MomentRefusal){
  if(this.moment!==moment)return;
  this.moment=null;moment.resolve({ending:null,refused});this.onChange();
 }
 /**
  * One tick of the moment's life. It starts within its window on the current base: over Monitor at once, under Monitor's
  * own player generation, and over Media through a pause that the takeover's resume guard gives back. Its duration
  * counts from the write the Pixoo acknowledged.
  */
 private tickMoment(){
  const moment=this.moment;if(moment===null)return;
  const now=this.clock();
  if(moment.phase==='showing'){if(this.attentionEnds())this.endMoment('preempted');else if(now>=moment.until)this.endMoment(moment.noticeShortened===true?'interrupted':'completed');return;}
  if(moment.phase!=='waiting'||now<moment.startAtMs)return;
  if(now>moment.startAtMs+moment.toleranceMs){this.refuseMoment(moment,'expired');return;}
  if(this.momentBlock(moment.coversStatus,moment.exactArt)!==null){this.refuseMoment(moment,'blocked');return;}
  if(moment.over==='stopped-media'){
   if(this.configuration.mode!=='media'||!this.stoppedMedia()||this.player.getState().generation!==moment.generation){this.refuseMoment(moment,'cancelled');return;}
   moment.phase='showing';this.momentWrite=true;this.onChange();return;
  }
  if(this.configuration.mode==='monitor'){moment.over='monitor';moment.generation=this.playerGeneration;moment.phase='showing';this.momentWrite=true;this.onChange();return;}
  const state=this.player.getState();
  if(moment.exactArt!==true&&this.idle(state)){moment.over='idle';moment.generation=state.generation;moment.phase='showing';this.momentWrite=true;this.onChange();return;}
  moment.phase='holding';
  // A pause on a player that has since stopped would give the moment a playlist to resume over that stop.
  this.hold('moment',()=>Infinity,()=>this.moment===moment&&this.configuration.mode==='media'&&this.player.getState().intent==='active'&&this.momentBlock(moment.coversStatus,moment.exactArt)===null,held=>{
   if(held===null){this.refuseMoment(moment,'blocked');return;}
   moment.generation=held;moment.phase='showing';this.momentWrite=true;
  });
 }
 /**
  * Ends the moment on the display: the current base comes back, and a moment held over Media gives the playlist back
  * through the takeover's guard. It settles once its write has settled, so its result says what that write did. A song
  * that wants the whole display by then keeps the player paused and takes over from the moment, with no flash of the playlist.
  */
 private endMoment(ending:MomentEnding,resume=true){
  const moment=this.moment;if(moment===null||moment.phase!=='showing')return;
  // The moment does not abort a write on its way, and the base replaces it: an aborted write could end uncertain, which
  // pauses the player and would take Monitor away just as attention needs it. Over Media, the resume retires it as any resume does.
  this.moment=null;this.lastFrame='';this.momentWrite=true;
  const takeover=this.takeover?.kind==='moment'?this.takeover:null;
  let released:Promise<unknown>=Promise.resolve();
  if(takeover!==null){
   this.takeover=null;
   if(resume){
    if(this.nowPlaying.media==='whole'&&this.playback.view.card&&this.givenBack(takeover))this.takeover={kind:'whole',generation:takeover.generation,until:Infinity};
    else released=this.giveBack(takeover);
   }
  }
  void Promise.all([moment.writing,released]).then(()=>{
   const {upload}=moment;
   // Only while its write is still the latest: a base that followed it has already replaced the picture, or failed on its own terms.
   if(upload?.ok===true){if(this.lastStart===moment.writtenAt)this.artShown=true;moment.resolve({ending,upload,endedAtMs:this.clock()});return;}
   // Nothing it wrote is known to have shown, so it has no ending: its outcome says why.
   const superseded=upload===undefined||(upload.priorEffects==='none'&&(upload.code==='cancelled'||upload.code==='stale-generation'));
   moment.resolve({ending:null,refused:moment.rejected===true?'unknown':moment.missed===true?'expired':superseded&&moment.noticeRefused===true?'notice':superseded?'cancelled':'upload',upload});
  });
  this.onChange();
 }
 /** Records what the moment's write did. A failed write ends the moment and gives its base back; a sent one starts its duration. */
 private momentUploaded(moment:Moment,result:OperationResult<UploadResult>|undefined){
  moment.upload=result;
  const failed=result!==undefined&&!result.ok&&result.code!=='cancelled'&&result.code!=='stale-generation';
  if(moment.over==='monitor'&&failed)this.lastOutcome={generation:this.generation,renditionGeneration:this.dashboard.status().rendition?.generation??0,status:result.priorEffects==='possible'?'uncertain':'failed',code:result.code};
  if(this.moment!==moment)return;
  if(result?.ok===true){
   const normalUntil=this.clock()+moment.durationMs;
   moment.until=moment.notice===undefined?normalUntil:Math.min(normalUntil,moment.notice.staleAtMs,moment.notice.forecastEndAtMs);
   moment.noticeShortened=moment.until<normalUntil;
   if(this.clock()>=moment.until)this.endMoment('interrupted');
   return;
  }
  // Over Monitor a failed write is the device's failure, as a dashboard's is: Monitor stops until it is chosen again.
  if(moment.over==='monitor'&&failed)this.suspend();
  else this.endMoment('interrupted');
 }
 /**
  * The frame of the card `view` shows, or null while it renders or after its render failed. A new card starts its render;
  * a renderer that answers at once, as the default does, makes the frame ready at once.
  */
 private cardFrame(view:NowPlayingView):Uint8Array|null{
  if(!view.card)return null;
  const key=this.cardKey(view),observation=this.observation(),current=this.card;
  if(current?.key===key&&current.rgb!==null){current.observation=observation;return current.rgb;}
  if(current?.key===key&&current.observation===observation&&this.clock()<current.retryAt)return null;
  if(current!==null&&current.rgb!==null)this.previousCard={key:current.key,rgb:current.rgb};
  const render:NonNullable<Options['renderCard']>=this.options.renderCard??(view=>renderNowPlaying(view));
  let rendered:Uint8Array|Promise<Uint8Array>;
  try{rendered=render(view,this.cardContext);}catch{this.card={key,observation,rgb:null,retryAt:this.clock()+CARD_RETRY_MS};return null;}
  if(rendered instanceof Uint8Array){this.card={key,observation,rgb:rendered,retryAt:0};return rendered;}
  const pending={key,observation,rgb:null as Uint8Array|null,retryAt:Infinity};this.card=pending;
  void rendered.then(rgb=>{if(this.card!==pending||this.closed||pending.observation!==this.observation()||pending.key!==this.cardKey(this.playback.view))return;pending.rgb=rgb;this.onChange();},()=>{if(this.card===pending&&pending.observation===this.observation())pending.retryAt=this.clock()+CARD_RETRY_MS;});
  return null;
 }
 /** Persist a new Media setting, then end a takeover it no longer wants or start one it now does. */
 async setNowPlaying(media:NowPlayingMedia):Promise<void>{
  this.cancelCardWrite();
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
  this.hold(kind,()=>kind==='popup'?this.clock()+POPUP_MS:Infinity,()=>this.eligible(kind));
 }
 /**
  * Pauses the playing playlist for a takeover, remembering the generation its own pause produced, which is the only one
  * the takeover may resume. `held` hears that generation as the takeover begins, or null when it never does.
  */
 private hold(kind:Takeover['kind'],until:()=>number,eligible:()=>boolean,held:(generation:number|null)=>void=()=>{}){
  this.takeoverPending=true;
  let heard=false;
  void this.enqueue(async()=>{
   if(!eligible())return;
   const from=this.player.getState().generation;
   const paused=this.player.pause(),generation=this.player.getState().generation;
   await paused;
   const state=this.player.getState();
   if(this.closed||this.configuration.mode!=='media'||state.intent!=='paused'||!state.requestedScreenOn||(kind==='moment'&&state.generation!==generation))return;
   this.takeover={kind,generation:state.generation,until:until()};this.heldFrom=from;this.lastFrame='';heard=true;held(state.generation);this.onChange();
  }).catch(()=>{}).finally(()=>{this.takeoverPending=false;if(!heard)held(null);this.onChange();});
 }
 /** Whether the player still stands exactly where the takeover's own pause left it, so nothing else owns what comes next. */
 private givenBack(takeover:Takeover):boolean{
  const state=this.player.getState();
  return !this.closed&&this.configuration.mode==='media'&&state.generation===takeover.generation&&state.intent==='paused'&&state.requestedScreenOn&&!this.player.startPending();
 }
 /** Resume the playlist under the takeover's guard, as true when it did. */
 private giveBack(takeover:Takeover):Promise<boolean>{
  return this.enqueue(async()=>{
   if(!this.givenBack(takeover))return false;
   await this.player.resume();this.onChange();return true;
  }).catch(()=>false);
 }
 /** End a takeover whose card is gone, whose pop-up expired or whose setting changed. A moment's own takeover ends with the moment. */
 private settleTakeover(){
  const takeover=this.takeover;if(!takeover||takeover.kind==='moment')return;
  if(this.playback.view.card&&this.clock()<takeover.until&&this.nowPlaying.media===takeover.kind)return;
  this.cancelCardWrite();this.takeover=null;this.lastFrame='';this.onChange();
  void this.giveBack(takeover).then(resumed=>{this.lastTakeover=resumed?'resumed':'dropped';this.onChange();});
 }
 /** Starts a whole takeover now if Now Playing wants one, as the next tick would. */
 takeOverNow(){if(this.nowPlaying.media==='whole'&&this.playback.view.card)this.beginTakeover('whole');}
 /**
  * Whether a Now Playing takeover paused the player at `generation` and took the display: the selection made at that
  * generation stood until the card took over, and the takeover gives it back once the song ends.
  */
 heldBack(generation:number):boolean{return this.heldFrom===generation;}
 /** Settles once the presentation's queued work, such as a takeover's pause, has run. */
 settled():Promise<void>{return this.tail.then(()=>undefined);}
 /** Forget a takeover without resuming: the user, the screen or a failure owns what happens next. */
 private dropTakeover(){
  if(!this.takeover)return;
  if(this.takeover.kind==='moment'){this.endMoment('interrupted',false);return;}
  this.takeover=null;this.lastTakeover='dropped';this.lastFrame='';this.onChange();
 }
 /** The picture the display should show now, if the presentation owns it. A moment on the display comes before its base. */
 private frame():Frame|null{
  if(this.moment?.phase==='showing'){const moment=this.moment;return {key:'moment:'+moment.momentId,frames:moment.rgb,generation:moment.generation,card:false,moment};}
  const view=this.playback.view,ready=this.cardFrame(view);
  // While a changed card renders, the card the display already shows stays, under its own key, so nothing is sent again.
  const previous=this.previousCard;
  const card=ready!==null?{key:this.cardKey(view),rgb:ready,retained:false}:view.card&&previous!==null&&this.lastFrame===previous.key?{key:previous.key,rgb:previous.rgb,retained:true}:null;
  if(this.active){
   if(this.popupUntil!==0&&view.card)return card===null?null:{key:card.key,frames:[card.rgb],generation:this.playerGeneration,card:true,retained:card.retained};
   const rendition=this.dashboard.current();
   return rendition?{key:'dashboard:'+rendition.generation,frames:rendition.frames,generation:this.playerGeneration,card:false}:null;
  }
  if(this.takeover!==null&&card!==null)return {key:card.key,frames:[card.rgb],generation:this.takeover.generation,card:true,retained:card.retained};
  return null;
 }
 private observation():string{return this.cardContext?.observation??JSON.stringify(this.playback.view);}
 private cardKey(view:NowPlayingView):string{return 'card:'+JSON.stringify(view)+':'+artworkKey(this.cardContext?.artwork);}
 private cancelCardWrite():void{this.cardWrite?.abort.abort();}
 private invalidateCardWrite():void{if(this.cardWrite&&!this.cardWrite.current())this.cancelCardWrite();}
 private enqueue<T>(work:()=>Promise<T>):Promise<T>{
  if(this.closed)return Promise.reject(new ApiError('closed',503));
  const result=this.tail.then(()=>{if(this.closed)throw new ApiError('closed',503);return work();});this.tail=result.catch(()=>{});return result;
 }
 async configure(action:IntegrationAction,admit:()=>void=()=>{}):Promise<void>{
  const interrupts=this.interrupts;
  return this.enqueue(async()=>{
   if(interrupts!==this.interrupts)throw new ApiError('cancelled',409);
   admit();const wasActive=this.active;
   // A view change leaves Media as it is, so a moment over Media gives the playlist back rather than leaving it paused.
   if(action.operation==='view'&&this.moment!==null){
    if(this.moment.phase==='showing')this.endMoment('interrupted');
    else this.refuseMoment(this.moment,'cancelled');
   }
   this.dropTakeover();
   const next=presentationConfiguration.parse(action.operation==='mode'?{...this.configuration,mode:action.mode}:{...this.configuration,filter:action.filter,cadenceMs:action.cadenceMs});
   this.suspend();this.pendingMode=next.mode;this.onChange();
   const paused=action.operation==='mode'||wasActive?this.player.pause():Promise.resolve(),generation=this.player.getState().generation;
   try{
    await paused;await this.options.save(next);this.configuration=next;
    if(this.view)this.dashboard.submit(this.view,next.filter);
    this.playerGeneration=generation;
    this.active=!this.closed&&this.player.getState().generation===generation&&this.player.getState().requestedScreenOn&&next.mode==='monitor'&&(action.operation==='mode'||wasActive);
    // Monitor now shows the dashboard, so its current layout renders at once.
    if(this.active)this.dashboard.tick(true);
   }finally{this.pendingMode=null;this.onChange();}
  });
 }
 /**
  * Replaces a moment's picture when nothing else will: a manual pause, stop or mode change owns what comes next, and the
  * art must not stay on as if it were that choice. Whatever owns the display next replaces it instead, so this waits for
  * a dashboard or card still rendering. One write, never retried. It is dropped after an uncertain write of any kind,
  * since unknown artwork is not rolled back, and once the device was offline or under external control, since what it
  * shows by then may be the owner's.
  */
 private clearArt(frame:Frame|null,gap:number):boolean{
  if(!this.artShown)return false;
  const state=this.player.getState();
  if(frame!==null||state.intent==='active'||state.availability==='offline'||this.displayUnknown(state)){this.artShown=false;return false;}
  if(this.active||this.takeover!==null||this.takeoverPending||this.pendingMode!==null||this.player.startPending()||!state.requestedScreenOn||this.inFlight||this.clock()-this.lastStart<gap)return false;
  this.artShown=false;this.inFlight=true;this.lastStart=this.clock();this.lastFrame='';
  void this.player.uploadDashboard([BLANK],state.generation,{whileStopped:true}).catch(()=>{}).finally(()=>{this.inFlight=false;this.onChange();});
  return true;
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
   if(this.active)this.dashboard.tick(true);
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
 /** One render-timer step: pages, ends pop-ups and takeovers, and sends a changed picture. It reports only a change. */
 tick(){
  if(this.closed)return;
  let changed=this.dashboard.tick(this.active);
  if(this.popupUntil!==0&&(this.clock()>=this.popupUntil||!this.playback.view.card)){this.popupUntil=0;changed=true;}
  this.tickMoment();
  this.settleTakeover();
  // A song already playing when Media starts takes the display over too; the owner publishes nothing new to start it.
  this.takeOverNow();
  const frame=this.frame();
  if(changed)this.onChange();
  this.invalidateCardWrite();
  const gap=this.momentWrite?Math.min(MOMENT_WRITE_GAP_MS,this.configuration.cadenceMs):this.configuration.cadenceMs;
  if(this.clearArt(frame,gap))return;
  if(!frame||frame.retained===true||this.inFlight||frame.key===this.lastFrame||this.clock()-this.lastStart<gap)return;
  this.momentWrite=false;
  const {moment}=frame;
  if(moment!==undefined&&this.clock()>moment.startAtMs+moment.toleranceMs){moment.missed=true;this.endMoment('interrupted');return;}
  const generation=this.generation,playerGeneration=frame.generation,takeover=this.active?null:this.takeover;
  const renditionGeneration=this.dashboard.status().rendition?.generation??0;
  // Artwork can arrive while the current observation's fallback is already
  // being sent. Keep that upload valid; the changed render key schedules the
  // latest card afterward without cancelling a native write with possible effects.
  const observation=this.observation(),playback=JSON.stringify(this.playback),abort=new AbortController();
  // Stopped Media has no active base to resume: recheck its permission before each effect. Other moments retain their existing generation guard.
  const noticeCurrent=(priorEffects:'none'|'possible'):boolean=>{
   if(moment?.notice===undefined)return true;
   if(priorEffects==='none'&&rainNoticeRefusal(moment.notice,moment,this.clock())!==undefined){moment.noticeRefused=true;return false;}
   return this.clock()<Math.min(moment.notice.staleAtMs,moment.notice.forecastEndAtMs);
  };
  const current=moment!==undefined?(priorEffects:'none'|'possible'='none')=>!this.closed&&playerGeneration===this.player.getState().generation&&noticeCurrent(priorEffects)
    &&(moment.over!=='stopped-media'||this.moment===moment&&this.configuration.mode==='media'&&this.stoppedMedia()&&this.momentBlock(moment.coversStatus,true)===null)
   :()=>!this.closed&&generation===this.generation&&playerGeneration===this.player.getState().generation
   &&observation===this.observation()&&playback===JSON.stringify(this.playback)
   &&(this.active?this.popupUntil>this.clock()&&!this.attention():this.takeover===takeover&&takeover!==null&&this.clock()<takeover.until);
  const write=frame.card?{abort,current,key:frame.key}:null;this.cardWrite=write;
  this.inFlight=true;this.lastStart=this.clock();this.lastFrame=frame.key;this.onChange();
  const upload=this.player.uploadDashboard(frame.frames.map(rgb=>new Uint8Array(rgb)),playerGeneration,
   moment!==undefined?{current,whileStopped:moment.over==='idle'||moment.over==='stopped-media',...(moment.delayMs===undefined?{}:{artDelayMs:moment.delayMs})}:write===null?{}:{signal:abort.signal,current});
  if(moment!==undefined){
   moment.writtenAt=this.lastStart;
   moment.writing=upload.then(result=>{this.momentUploaded(moment,result);},()=>{moment.rejected=true;this.momentUploaded(moment,undefined);}).finally(()=>{this.inFlight=false;this.onChange();});
   return;
  }
  void upload.then(result=>{
   if(write!==null&&(abort.signal.aborted||!current())&&(result===undefined||!result.ok&&result.code==='cancelled'&&result.priorEffects==='none')){
    if(this.lastFrame===write.key)this.lastFrame='';return;
   }
   // A Media takeover reports through its own status; a failed or uncertain card upload ends it without resuming.
   const sent=result?.ok===true;
   if(takeover){if(!sent&&this.takeover===takeover)this.dropTakeover();return;}
   this.lastOutcome={generation,renditionGeneration,status:result===undefined?'cancelled':result.ok?'sent':result.priorEffects==='possible'?'uncertain':result.code==='cancelled'||result.code==='stale-generation'?'cancelled':'failed',...(result!==undefined&&!result.ok?{code:result.code}:{})};
   if(generation===this.generation&&!sent)this.suspend();
  }).catch(()=>{
   if(takeover){if(this.takeover===takeover)this.dropTakeover();return;}
   this.lastOutcome={generation,renditionGeneration,status:'failed',code:'operation-failed'};if(generation===this.generation)this.suspend();
  }).finally(()=>{if(this.cardWrite===write)this.cardWrite=null;this.inFlight=false;this.onChange();});
 }
 async close(){
  if(this.closed)return;
  this.closed=true;this.dropTakeover();this.suspend();
  if(this.moment!==null)this.refuseMoment(this.moment,'cancelled');
  this.unsubscribe();this.dashboard.close();await this.tail;
 }
}
const showingOf=(frame:Frame|null):NowPlayingState['showing']=>frame===null?'none':frame.moment!==undefined?'moment':frame.card?'card':'dashboard';
