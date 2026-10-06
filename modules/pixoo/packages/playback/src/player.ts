import {systemClock,type Animation,type Clock,type DeviceAdapter,type OperationResult,type UploadResult} from '@pixoo/device';
import {checkpointSchema,type PlaybackCheckpoint,type CaptureHooks,type PlaybackPolicy} from '@pixoo/library';
import {PlaybackError,type PlaybackStore,type PlayerState} from './contracts.js';
import {cycle,next,previous,started,upcoming} from './traversal.js';
const owners=new WeakSet<DeviceAdapter>();
const connectivityErrors=new Set(['offline','timeout','http-error']);
const codeOf=(error:unknown)=>typeof (error as {code?:unknown})?.code==='string'?String((error as {code:string}).code):'operation-failed';
interface Options {store:PlaybackStore;device:DeviceAdapter;clock?:Clock;random?:()=>number;retryBaseMs?:number;maxRetries?:number;operationTimeoutMs?:number;pauseOnUncertain?:boolean}

/** The Player operation that produced the latest transport evidence. Dashboard uploads stay distinct from media uploads. */
export type DisplayEvidenceSource = 'brightness'|'screen'|'probe'|'upload'|'dashboard';
export type MediaOperationEvent = {operationId:number;generation:number} & ({phase:'pending'}|{phase:'complete';result:OperationResult<UploadResult>});

export class Player {
  private mediaListeners=new Set<(event:MediaOperationEvent)=>void>();
  private mediaSequence=0;
  subscribeMediaOperations(listener:(event:MediaOperationEvent)=>void):()=>void {this.mediaListeners.add(listener);return ()=>{this.mediaListeners.delete(listener);};}
  private notifyMedia(event:MediaOperationEvent):void {for(const listener of this.mediaListeners){try{listener(event);}catch{/* Evidence observers cannot interrupt device work. */}}}
  private listeners=new Set<()=>void>();
  private published='';
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private notify():void {
    const state=JSON.stringify(this.getState());if(state===this.published)return;this.published=state;
    for(const listener of this.listeners){try{listener();}catch{/* Observers cannot interrupt the player. */}}
  }
  private record:PlaybackCheckpoint|undefined;
  private state:PlaybackCheckpoint['state']='idle';
  private intent:PlaybackCheckpoint['intent']='stopped';
  private availability:PlayerState['availability']='unknown';
  private epoch=0;
  private admission=0;
  private adapterGeneration:number;
  private abort=new AbortController();
  private cancelTimer=()=>{};
  private tail:Promise<void>=Promise.resolve();
  private closing=false;
  private closePromise:Promise<void>|undefined;
  private requestedScreenOn=true;
  private screenSequence=0;
  private requestedBrightness:number|null=null;
  private evidence:{brightness:{acknowledged:{value:number;atMs:number}|null;observed:{value:number;atMs:number}|null};screen:{acknowledged:{value:boolean;atMs:number}|null;observed:{value:boolean;atMs:number}|null};transport:{source:DisplayEvidenceSource;atMs:number;ok:boolean;priorEffects:'none'|'possible'}|null}={brightness:{acknowledged:null,observed:null},screen:{acknowledged:null,observed:null},transport:null};
  getDisplayEvidence(){return structuredClone({requestedBrightness:this.requestedBrightness,requestedScreenOn:this.requestedScreenOn,...this.evidence});}
  private observeResult<T>(result:OperationResult<T>,generation:number,source:DisplayEvidenceSource):void {
    if(generation!==this.adapterGeneration||this.closing)return;
    this.evidence.transport={source,atMs:result.timing.completedAtMs,ok:result.ok,priorEffects:result.ok?'none':result.priorEffects};
  }
  private observeProbe(result:Awaited<ReturnType<DeviceAdapter['probe']>>,generation:number):void{
    this.observeResult(result,generation,'probe');
    if(generation!==this.adapterGeneration||this.closing||!result.ok||result.value.mode!=='device')return;
    const atMs=result.timing.completedAtMs;
    this.evidence.brightness.observed=result.value.brightness===undefined?null:{value:result.value.brightness,atMs};
    this.evidence.screen.observed=result.value.screenOn===undefined?null:{value:result.value.screenOn,atMs};
  }
  private readyAt:number|null=null;
  private deadline:number|null=null;
  private lastError:PlaybackCheckpoint['lastError']=null;
  private retries=0;
  private failed=new Set<string>();
  private cache=new Map<string,Animation>();
  private preparing=new Map<string,Promise<Animation>>();
  private constructor(private store:PlaybackStore,private device:DeviceAdapter,private clock:Clock,private random:()=>number,
    private retryBaseMs:number,private maxRetries:number,private operationTimeoutMs:number,private release:()=>void,private pauseOnUncertain=false){this.adapterGeneration=device.generation;}

  static async open(options:Options):Promise<Player> {
    const {store,device}=options,clock=options.clock??systemClock;
    const retryBase=options.retryBaseMs??250,maxRetries=options.maxRetries??3,timeout=options.operationTimeoutMs??5000;
    if(!Number.isSafeInteger(retryBase)||retryBase<1||retryBase>1000 || !Number.isSafeInteger(maxRetries)||maxRetries<1||maxRetries>8 ||
      !Number.isSafeInteger(timeout)||timeout<1||timeout>120000 || (options.pauseOnUncertain!==undefined && typeof options.pauseOnUncertain!=='boolean') || !Number.isFinite(clock.now())||clock.now()<0)throw new PlaybackError('invalid-input');
    if(owners.has(device))throw new PlaybackError('busy');
    let release:()=>void;
    try{release=store.claim();}catch{throw new PlaybackError('busy');}
    owners.add(device);
    const player=new Player(store,device,clock,options.random??Math.random,retryBase,maxRetries,timeout,()=>{release();owners.delete(device);},options.pauseOnUncertain??false);
    try{
      const saved=await store.read();
      if(saved){player.record=checkpointSchema.parse(saved);player.intent='paused';player.state='paused';player.requestedScreenOn=saved.requestedScreenOn;player.lastError=saved.lastError;await player.persist();}
      return player;
    }catch{player.release();throw new PlaybackError('storage-error');}
  }
  getSession(){return this.record?structuredClone({id:this.record.sessionId,playlist:this.record.snapshot,...(this.record.source?{source:this.record.source}:{})}):null;}
  getState():PlayerState {
    return structuredClone({state:this.state,intent:this.intent,availability:this.availability,generation:this.epoch,
      sessionId:this.record?.sessionId??null,playlistId:this.record?.source?.kind==='media'?null:this.record?.snapshot.id??null,playlistRevision:this.record?.source?.kind==='media'?null:this.record?.snapshot.revision??null,
      itemId:this.record?.currentItemId??null,estimatedReadyAtMs:this.readyAt,dwellDeadlineMs:this.deadline,timing:'estimated',
      requestedScreenOn:this.requestedScreenOn,lastError:this.lastError});
  }
  private retire(cancelDevice=true):number {
    this.epoch++;this.cancelTimer();this.cancelTimer=()=>{};this.abort.abort();this.abort=new AbortController();
    if(cancelDevice)this.adapterGeneration=this.device.invalidateGeneration();this.readyAt=null;this.deadline=null;this.preparing.clear();return this.epoch;
  }
  private valid(token:number):boolean {return token===this.epoch && !this.closing && this.intent==='active';}
  private queue(action:()=>Promise<void>):Promise<void> {const work=this.tail.then(action);this.tail=work.catch(()=>{});return work;}
  private async persist():Promise<void> {
    if(!this.record){this.notify();return;}
    Object.assign(this.record,{state:this.state,intent:this.intent,requestedScreenOn:this.requestedScreenOn,lastError:this.lastError});
    await this.store.save(structuredClone(this.record));this.notify();
  }
  private fatal(code:string):void {this.retire();this.intent='paused';this.state='error';this.lastError={code};this.notify();}
  private background(token:number,action:()=>Promise<void>):void {
    void this.queue(async()=>{if(this.valid(token))await action();}).catch(()=>{if(token===this.epoch&&!this.closing)this.fatal('storage-error');});
  }
  private dispatch(action:()=>Promise<boolean|void>,intent?:PlaybackCheckpoint['intent'],cancelDevice=true):Promise<void> {
    if(this.closing)return Promise.reject(new PlaybackError('closed'));
    if(cancelDevice)this.admission++;
    const token=this.retire(cancelDevice);if(intent)this.intent=intent;
    this.state=this.intent==='active'?'loading':this.intent==='paused'?'paused':'idle';this.notify();
    return this.queue(async()=>{
      if(!cancelDevice&&token!==this.epoch)return;
      const proceed=await action();
      if(token!==this.epoch)return;
      if((proceed===false || !this.record) && this.intent==='active')this.intent='stopped';
      if(!this.requestedScreenOn && this.intent==='active')this.intent='paused';
      this.state=this.intent==='active'?'loading':this.intent==='paused'?'paused':'idle';
      await this.persist();
      if(this.valid(token)&&this.record)this.launch(token);
    }).catch(error=>{
      if(token===this.epoch&&!this.closing){
        if(error instanceof PlaybackError && error.code==='no-context' && !this.record){this.intent='stopped';this.state='idle';this.notify();}
        else this.fatal(codeOf(error));
      }
      throw error;
    });
  }
  start(playlistId:string,revision?:number):Promise<void> {return this.admit(hooks=>this.store.capture(playlistId,hooks,revision));}
  showMedia(renditionId:string,policy?:PlaybackPolicy):Promise<void> {
    if(!this.store.captureMedia)return Promise.reject(new PlaybackError('unsupported-operation'));
    return this.admit(hooks=>this.store.captureMedia!(renditionId,policy,hooks));
  }
  private admit(capture:(hooks:CaptureHooks)=>Promise<PlaybackCheckpoint>):Promise<void> {
    if(this.closing)return Promise.reject(new PlaybackError('closed'));
    const admission=++this.admission;
    return this.queue(async()=>{
      const guard=()=>!this.closing&&admission===this.admission;
      if(!guard())throw new PlaybackError('cancelled');
      let adopted=false,token=0;
      const prepare=(record:PlaybackCheckpoint)=>{record.order=cycle(record,this.random);record.currentItemId=record.order[0]!;};
      const adopt=(record:PlaybackCheckpoint)=>{
        token=this.retire();this.record=record;this.intent=this.requestedScreenOn?'active':'paused';this.state=this.intent==='active'?'loading':'paused';
        this.cache.clear();this.failed.clear();this.retries=0;this.lastError=null;adopted=true;
      };
      const record=await capture({guard,prepare,adopt});
      // In-memory test stores may not implement the optional synchronous hooks.
      if(!adopted){if(!guard())throw new PlaybackError('cancelled');const parsed=checkpointSchema.parse(record);prepare(parsed);adopt(parsed);}
      try{await this.persist();if(this.valid(token))this.launch(token);}catch(error){if(token===this.epoch&&!this.closing)this.fatal(codeOf(error));throw error;}
    });
  }
  restartWithChanges():Promise<void> {if(this.record?.source?.kind==='media')return Promise.reject(new PlaybackError('unsupported-operation'));return this.record?this.start(this.record.snapshot.id):Promise.reject(new PlaybackError('no-context'));}
  pause():Promise<void> {return this.dispatch(async()=>{},'paused');}
  /** Upload one monitor picture of one or two complete frames, played at 500 ms each. */
  async uploadDashboard(frames:readonly Uint8Array[],expectedGeneration:number):Promise<OperationResult<UploadResult>|undefined> {
    if(!Array.isArray(frames)||frames.length<1||frames.length>2||frames.some(rgb=>!(rgb instanceof Uint8Array)||rgb.length!==12288))throw new PlaybackError('invalid-input');
    if(this.closing||expectedGeneration!==this.epoch||this.intent!=='paused'||!this.requestedScreenOn)return undefined;
    const generation=this.adapterGeneration;
    const result=await this.device.uploadAnimation({frames:frames.map(rgb=>({rgb:new Uint8Array(rgb),delayMs:500}))},
      {generation,signal:this.abort.signal,timeoutMs:this.operationTimeoutMs});
    // Evidence from a retired write cannot alter the current player or revive it.
    if(expectedGeneration===this.epoch&&!this.closing){
      this.observeResult(result,generation,'dashboard');await this.observedControl(result,generation);
    }
    return result;
  }
  stop():Promise<void> {return this.dispatch(async()=>{},'stopped');}
  resume():Promise<void> {
    if(!this.record)return Promise.reject(new PlaybackError('no-context'));
    if(!this.requestedScreenOn)return Promise.reject(new PlaybackError('screen-off'));
    return this.dispatch(async()=>{
      if(!this.record)throw new PlaybackError('no-context');
      this.failed.clear();this.retries=0;this.lastError=null;
    },'active');
  }
  private advance(cancelDevice:boolean):Promise<void> {return this.dispatch(async()=>{this.retries=0;return this.record?next(this.record,this.random):false;},undefined,cancelDevice);}
  next():Promise<void> {return this.advance(true);}
  previous():Promise<void> {return this.dispatch(async()=>{this.retries=0;if(this.record)previous(this.record);});}
  clear():Promise<void> {return this.dispatch(async()=>{await this.store.clear();this.record=undefined;this.cache.clear();this.lastError=null;},'stopped');}
  takeover():Promise<void> {return this.dispatch(async()=>{this.lastError={code:'external-control'};},'paused');}

  private pauseUncertain(code:string):void {
    this.retire();this.intent='paused';this.state='paused';
    this.lastError={code,priorEffects:'possible',...(this.record?{itemId:this.record.currentItemId}:{})};
    if(connectivityErrors.has(code))this.availability='offline';
    this.notify();
  }
  private async observedControl<T>(result:OperationResult<T>,generation:number):Promise<void> {
    if(generation!==this.adapterGeneration||this.closing)return;
    if(result.ok){this.availability='available';this.notify();return;}
    if(this.pauseOnUncertain && result.priorEffects==='possible'){this.pauseUncertain(result.code);await this.queue(()=>this.persist());return;}
    this.lastError={code:result.code};
    if(connectivityErrors.has(result.code))await this.offline();
    else if(result.code==='stale-generation'||result.code==='cancelled')await this.takeover();
    if(generation===this.adapterGeneration)await this.queue(()=>this.persist());
  }
  async probe(){
    if(this.closing)throw new PlaybackError('closed');
    const generation=this.adapterGeneration;
    const result=await this.device.probe({generation,timeoutMs:this.operationTimeoutMs});
    this.observeProbe(result,generation);
    await this.observedControl(result,generation);return result;
  }
  async setBrightness(percent:number):Promise<OperationResult<void>> {
    if(!Number.isInteger(percent)||percent<0||percent>100)throw new PlaybackError('invalid-input');
    if(this.closing)throw new PlaybackError('closed');
    const generation=this.adapterGeneration;
    this.requestedBrightness=percent;
    const result=await this.device.setBrightness(percent,{generation,timeoutMs:this.operationTimeoutMs});
    this.observeResult(result,generation,'brightness');
    if(generation===this.adapterGeneration&&!this.closing&&result.ok)this.evidence.brightness.acknowledged={value:percent,atMs:result.timing.completedAtMs};
    await this.observedControl(result,generation);return result;
  }
  async setScreen(on:boolean):Promise<OperationResult<void>|undefined> {
    if(typeof on!=='boolean')throw new PlaybackError('invalid-input');
    if(this.closing)throw new PlaybackError('closed');
    const sequence=++this.screenSequence;this.requestedScreenOn=on;
    const pause=on?Promise.resolve():this.pause();
    const token=this.epoch,generation=this.adapterGeneration;
    await pause;
    if(token!==this.epoch || sequence!==this.screenSequence || this.closing)return undefined;
    await this.queue(async()=>{if(token===this.epoch)await this.persist();});
    if(token!==this.epoch || sequence!==this.screenSequence || this.closing)return undefined;
    const result=await this.device.setScreen(on,{generation,timeoutMs:this.operationTimeoutMs});
    this.observeResult(result,generation,'screen');
    if(generation===this.adapterGeneration&&!this.closing&&result.ok)this.evidence.screen.acknowledged={value:on,atMs:result.timing.completedAtMs};
    await this.observedControl(result,generation);
    return result;
  }
  offline():Promise<void> {
    if(this.closing)return Promise.reject(new PlaybackError('closed'));
    this.availability='offline';this.notify();
    if(this.intent!=='active'||this.state==='reconnecting')return Promise.resolve();
    const token=this.retire();
    return this.queue(()=>this.recover(token,'offline'));
  }
  close():Promise<void> {
    if(this.closePromise)return this.closePromise;
    this.closing=true;this.admission++;this.retire();this.intent='paused';this.state=this.record?'paused':'idle';
    this.closePromise=this.queue(()=>this.persist()).finally(()=>this.release());return this.closePromise;
  }

  private prepare(id:string,token:number):Promise<Animation> {
    const cached=this.cache.get(id);if(cached)return Promise.resolve(cached);
    const waiting=this.preparing.get(id);if(waiting)return waiting;
    const pending=this.store.load(id,this.abort.signal).then(animation=>{
      if(!animation.frames.length || animation.frames.length>1000 || animation.frames.some(frame=>frame.rgb.length!==12288 || !Number.isSafeInteger(frame.delayMs)||frame.delayMs<1))throw new PlaybackError('invalid-input');
      if(token===this.epoch){this.cache.set(id,animation);while(this.cache.size>2)this.cache.delete(this.cache.keys().next().value!);}
      return animation;
    });
    this.preparing.set(id,pending);
    const finished=()=>{if(this.preparing.get(id)===pending)this.preparing.delete(id);};
    void pending.then(finished,finished);return pending;
  }
  private dwell(animation:Animation):number {
    const item=this.record!.snapshot.items.find(item=>item.id===this.record!.currentItemId)!;
    const policy=item.playback;
    const duration=policy.mode==='duration'?policy.durationMs:policy.totalPlays*animation.frames.reduce((sum,frame)=>sum+frame.delayMs,0);
    if(!Number.isSafeInteger(duration)||duration<1 || policy.mode==='plays' && animation.frames.length<2)throw new PlaybackError('invalid-input');
    return duration;
  }
  private launch(token:number):void {
    if(!this.record||!this.valid(token))return;
    this.state='loading';
    const item=this.record.snapshot.items.find(item=>item.id===this.record!.currentItemId)!;
    const signal=this.abort.signal,generation=this.adapterGeneration;
    const operationId=++this.mediaSequence,submittedAtMs=this.clock.now();
    let completed=false,dispatched=false;
    const finish=(result:OperationResult<UploadResult>)=>{if(completed)return;completed=true;this.notifyMedia({operationId,generation:token,phase:'complete',result});};
    const beforeSendFailure=(code:'cancelled'|'upload-failed')=>{const completedAtMs=this.clock.now();finish({ok:false,code,priorEffects:dispatched?'possible':'none',generation,timing:{submittedAtMs,startedAtMs:null,completedAtMs,queueMs:completedAtMs-submittedAtMs,serviceMs:0}});};
    this.notifyMedia({operationId,generation:token,phase:'pending'});
    void this.prepare(item.renditionId,token).then(async animation=>{
      if(!this.valid(token)){beforeSendFailure('cancelled');return;}
      const duration=this.dwell(animation);
      dispatched=true;
      const result=await this.device.uploadAnimation(animation,{generation,signal,timeoutMs:this.operationTimeoutMs});
      // Retired generations still have transport evidence, even though they cannot update playback.
      finish(result);
      this.background(token,()=>this.uploaded(token,result,duration));
    }).catch(error=>{beforeSendFailure(this.valid(token)?'upload-failed':'cancelled');this.background(token,()=>this.failedItem(token,codeOf(error)));});
  }
  private async uploaded(token:number,result:OperationResult<UploadResult>,duration:number):Promise<void> {
    if(!this.valid(token))return;
    this.observeResult(result,this.adapterGeneration,'upload');
    if(!result.ok){
      if(this.pauseOnUncertain && result.priorEffects==='possible'){this.pauseUncertain(result.code);await this.persist();return;}
      if(connectivityErrors.has(result.code)){await this.recover(token,result.code);return;}
      if(result.code==='stale-generation'||result.code==='cancelled'){this.intent='paused';this.state='paused';this.lastError={code:'external-control'};await this.persist();return;}
      await this.failedItem(token,result.code);return;
    }
    const ready=Math.max(this.clock.now(),result.value.estimatedReadyAtMs);
    if(!Number.isFinite(ready)||ready<0||ready+duration>Number.MAX_SAFE_INTEGER){await this.failedItem(token,'invalid-timing');return;}
    this.availability='available';this.readyAt=ready;this.notify();
    this.cancelTimer=this.clock.schedule(Math.max(0,ready-this.clock.now()),()=>this.background(token,async()=>{
      this.state='playing';this.readyAt=this.clock.now();this.deadline=this.clock.now()+duration;
      started(this.record!);this.retries=0;this.failed.clear();await this.persist();
      if(!this.valid(token))return;
      this.cancelTimer=this.clock.schedule(Math.max(0,this.deadline!-this.clock.now()),()=>{
        if(this.valid(token))void this.advance(false).catch(()=>{});
      });
      const nextId=upcoming(this.record!);const item=this.record!.snapshot.items.find(item=>item.id===nextId);
      if(item)void this.prepare(item.renditionId,token).catch(()=>{});
    }));
  }
  private async failedItem(token:number,code:string):Promise<void> {
    if(!this.valid(token)||!this.record)return;
    this.lastError={code,itemId:this.record.currentItemId};this.failed.add(this.record.currentItemId);
    if(this.failed.size>=this.record.snapshot.items.length || !next(this.record,this.random)){
      this.state='error';this.intent='paused';await this.persist();return;
    }
    this.state='loading';try{await this.persist();if(this.valid(token))this.launch(token);}catch(error){if(token===this.epoch&&!this.closing)this.fatal(codeOf(error));throw error;}
  }
  private async recover(token:number,code:string):Promise<void> {
    if(!this.valid(token))return;
    this.state='reconnecting';this.availability='offline';this.lastError={code,...(this.record?{itemId:this.record.currentItemId}:{})};
    if(this.retries>=this.maxRetries){this.state='error';this.intent='paused';await this.persist();return;}
    const delay=this.retryBaseMs*2**this.retries++;
    await this.persist();if(!this.valid(token))return;
    this.cancelTimer=this.clock.schedule(delay,()=>{
      if(!this.valid(token))return;
      const signal=this.abort.signal,generation=this.adapterGeneration;
      void this.device.probe({generation,signal,timeoutMs:this.operationTimeoutMs}).then(result=>{
        this.background(token,async()=>{
          this.observeProbe(result,generation);
          if(result.ok){this.availability='available';this.state='loading';try{await this.persist();if(this.valid(token))this.launch(token);}catch(error){if(token===this.epoch&&!this.closing)this.fatal(codeOf(error));throw error;}}
          else if(result.code==='stale-generation'||result.code==='cancelled'){this.intent='paused';this.state='paused';this.lastError={code:'external-control'};await this.persist();}
          else await this.recover(token,result.code);
        });
      }).catch(()=>this.background(token,()=>this.recover(token,'probe-failed')));
    });
  }
}
