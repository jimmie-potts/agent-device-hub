import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {errorBody,type ErrorBody,type ErrorCode,type MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {DEVICE_POWER_READBACK_SCHEMA, DEVICE_READBACK_TTL_MS, MAX_DEVICE_READBACKS, type CompletedOutcome, type DeviceRecord, type PowerReadback, type PowerSetRequest} from '@jimmie-potts/event-contracts/v2/devices';
import {recordLog, DeviceAvailability,fullDisk,Outbox,type AddMessage,type BunnyModule,type Cancel,type Command,type ModuleContext,type Reply,type TraceContext, Outcome} from '@jimmie-potts/sdk';
import {configureWemo,type WemoConfig} from './configuration.js';
import {wemoValidator,RELEASE,RELEASE_SCHEMA,RELEASE_TYPE} from './families.js';
import {acquireLease,type Lease} from './lease.js';
import {canonical,WemoStore,type Row} from './store.js';
import {WemoTransport,type Plug,type PlugTransport,type Observation,type Attempt} from './transport.js';
export const POLL_MS=5000,STALE_MS=15000,MAX_PENDING=8,ACTION_LIMIT_MS=5000;
const POWER_READBACK_MS = 2000;
const deviceDraft = (record: DeviceRecord) => ({type: 'org.bunny.device.updated', subject: record.id,
  dataschema: record.powerReadbacks === undefined ? 'https://bunny.invalid/events/device/2.1' : DEVICE_POWER_READBACK_SCHEMA, data: record});
const unknown={status:'unknown'} as const,unsupported={supported:false} as const;
type Input=PowerSetRequest&{heldRequestId?:string};
type Pending={command:Command<Input>;family:string};
type Target={config:Plug;transport:PlugTransport;record:DeviceRecord;lease?:Lease;pending:Map<string,Pending>;queue:Array<Pending|'poll'>;running?:Promise<void>;poll?:Cancel;stale?:Cancel;pollQueued:boolean;readbackAbort?: AbortController};
const isShutoff = (work: Pending | 'poll'): boolean => work !== 'poll' && work.family === 'power-set' && !work.command.data.on;
const completed=(id:string,code:ErrorCode,uncertain=false):CompletedOutcome=>({requestId:id,result:uncertain?Outcome.uncertain:Outcome.failed,evidence:Outcome.none,error:errorBody(code,{detail:uncertain?'the Wemo write is uncertain and will not be replayed':'Wemo work ended without a confirmed effect'}).error});
const typeOf=(family:string)=>family===RELEASE?RELEASE_TYPE:'org.bunny.power.set.requested';
export function createWemoModule(options:{transport?:(plug:Plug)=>PlugTransport}={}):BunnyModule<WemoConfig>{
  let owner:Owner|undefined;
  return {manifest:{name:'wemo',apiVersion:'1.3',configure:configureWemo},start:async context=>{owner=new Owner(context,options.transport);await owner.start();},stop:()=>owner?.stop()};
}
class Owner {
  readonly #context:ModuleContext<WemoConfig>;readonly #store:WemoStore;readonly #outbox:Outbox;readonly #validator:MessageValidator=wemoValidator();
  readonly #targets=new Map<string,Target>();readonly #stop=new AbortController();readonly #availability:DeviceAvailability;
  #committing:Promise<void>=Promise.resolve();#admitting:Promise<void>=Promise.resolve();#stopped=false;#storageDown=false;
  constructor(context:ModuleContext<WemoConfig>,factory:((plug:Plug)=>PlugTransport)|undefined){
    if(context.config===undefined)throw new Error('Wemo needs configuration');
    this.#context=context;this.#store=new WemoStore(context.database());this.#outbox=new Outbox({...context,database:context.database(),validator:this.#validator});this.#availability=new DeviceAvailability(context);
    for(const config of context.config.plugs){
      const previous=this.#store.device(config.id),locked=acquireLease(join(context.files(),'leases'),config.mac);
      const record:DeviceRecord={id:config.id,label:config.label,kind:'wemo',revision:this.#store.revision(),configurationRevision:config.configurationRevision,generation:{epoch:randomUUID(),sequence:0},
        availability:locked.status==='held'?previous?.held===undefined?'unknown':'degraded':'unavailable',...(previous?.held===undefined?{}:{held:previous.held}),
        capabilities:{power:{supported:true},brightness:unsupported,modes:unsupported,moments:unsupported,media:unsupported,scenes:unsupported,zones:unsupported,preview:unsupported},
        desired:previous?.desired??{power:unknown,brightness:unknown,mode:unknown},observed:unknown,pending:0,pendingKinds:[],lastOutcome:previous?.lastOutcome??unknown,lastTransmission:previous?.lastTransmission??unknown,externalControl:unknown};
      const retained = previous?.powerReadbacks?.filter(readback => readback.transmittedAtMs > context.clock.now() - DEVICE_READBACK_TTL_MS)
        .map(readback => readback.reading.status === 'pending' ? {...readback, reading: {status: 'unavailable' as const}} : readback);
      if (retained !== undefined && retained.length > 0) record.powerReadbacks = retained;
      this.#targets.set(config.id,{config,transport:factory?.(config)??new WemoTransport(config),record,...(locked.status==='held'?{lease:locked.lease}:{}),pending:new Map(),queue:[],pollQueued:false});
    }
  }
  async start():Promise<void>{
    for(const target of this.#targets.values())for(const family of ['power-set',RELEASE])await this.#context.sdk.respond<Input>(`bunny.cmd.${family}.${target.config.id}`,command=>{
      const work=this.#admitting.then(()=>this.#accept(family,command));this.#admitting=work.then(()=>{},()=>{});return work;
    });
    await this.#context.sdk.serveSync(['device'],()=>({revision:this.#store.revision(),states:[...this.#targets.values()].map(target => deviceDraft(structuredClone(target.record)))}));
    await this.#outbox.republish();
    for(const row of this.#store.unfinished()){
      const target=this.#targets.get(row.target);
      if(target!==undefined)await this.#finish(target,row,completed(row.requestId,row.state==='started'?'uncertain-result':'unavailable',row.state==='started'));
    }
    await this.#transaction(add=>{for(const target of this.#targets.values())this.#record(add,target);});
    for(const target of this.#targets.values())this.#schedule(target,0);
  }
  #record(add:AddMessage,target:Target,parent?:TraceContext):void{
    target.record.revision=this.#store.next();target.record.pending=target.pending.size;target.record.pendingKinds=[...new Set([...target.pending.values()].map(v=>v.family))];
    const retained = target.record.powerReadbacks?.filter(readback => readback.transmittedAtMs > this.#context.clock.now() - DEVICE_READBACK_TTL_MS);
    if (retained === undefined || retained.length === 0) delete target.record.powerReadbacks;
    else target.record.powerReadbacks = retained;
    this.#store.deviceSave(target.record);
    add(`bunny.state.device.${target.config.id}`, {kind: 'state', ...deviceDraft(target.record)}, parent === undefined ? {} : {parent});
  }
  #transaction(work:(add:AddMessage)=>void,target?:Target,parent?:TraceContext,requestId?:string):Promise<void>{
    const task=this.#committing.then(async()=>{
      const before=new Map([...this.#targets].map(([id,t])=>[id,structuredClone(t.record)]));
      try{await this.#outbox.transaction(work);}catch(error){for(const [id,value] of before){const target=this.#targets.get(id);if(target!==undefined)target.record=value;}this.#storageFailed(target,parent,requestId);throw error;}
    });this.#committing=task.then(()=>{},()=>{});return task;
  }
  #storageFailed(target?:Target,parent?:TraceContext,requestId?:string):void{
    if(this.#storageDown)return;
    this.#storageDown=true;
    for(const item of this.#targets.values()){item.poll?.();item.stale?.();}
    recordLog(this.#context.log, 'operation.failed',{'bunny.operation':'storage','bunny.outcome':Outcome.failed,'bunny.code':'internal',...(target===undefined?{}:{'bunny.device.id':target.config.id}),...(requestId===undefined?{}:{'bunny.request.id':requestId})},parent);
  }
  #guard(target:Target,command:Command<Input>,release:boolean):ErrorBody|undefined{
    const value=command.data,now=this.#context.clock.now(),record=target.record;
    if(this.#stopped||this.#stop.signal.aborted||this.#context.signal.aborted||target.lease===undefined||this.#storageDown)return errorBody('unavailable');
    if(command.expiresat===undefined||!Number.isFinite(Date.parse(command.expiresat)))return errorBody('invalid-message');
    if(Date.parse(command.expiresat)<=now)return errorBody('expired');
    if(value.expectedConfigurationRevision!==undefined&&value.expectedConfigurationRevision!==record.configurationRevision||value.expectedGeneration!==undefined&&canonical(value.expectedGeneration)!==canonical(record.generation))return errorBody('revision-conflict');
    if(release)return record.held?.requestId===value.heldRequestId?undefined:errorBody('revision-conflict');
    if(record.held!==undefined||record.availability!=='available'||record.observed.status!=='known'||now-record.observed.observedAtMs>STALE_MS||now<record.observed.observedAtMs)return errorBody('unavailable');
    return undefined;
  }
  async #accept(family:string,command:Command<Input>):Promise<Reply>{
    const checked=this.#validator.validate(command);
    if(!checked.ok||command.type!==typeOf(family)||command.dataschema!==(family===RELEASE?RELEASE_SCHEMA:'https://bunny.invalid/events/power-set/2.0'))return errorBody('invalid-message');
    const target=this.#targets.get(command.subject);if(target===undefined)return errorBody('not-found');
    const id=command.data.requestId,digest=createHash('sha256').update(canonical({source:command.source,target:command.subject,family,data:command.data})).digest('hex');let accepted=false;let answer:Reply=errorBody('internal');
    try{await this.#transaction(add=>{
      const previous=this.#store.get(id);if(previous!==undefined){answer=previous.digest===digest?{status:'accepted'}:errorBody('duplicate-conflict');return;}
      const guard=this.#guard(target,command,family===RELEASE);if(guard!==undefined){answer=guard;return;}
      if(target.pending.size>=MAX_PENDING){answer=errorBody('capacity');return;}
      this.#store.save({requestId:id,target:target.config.id,family,digest,traceparent:command.traceparent,state:'accepted'});
      target.pending.set(id,{family,command});this.#record(add,target,command);accepted=true;answer={status:'accepted'};
    },target,command,command.data.requestId);}catch(error){target.pending.delete(id);return errorBody(fullDisk(error)?'capacity':'internal');}
    if (accepted) {
      recordLog(this.#context.log, 'command.queued', {'bunny.device.id': target.config.id, 'bunny.request.id': id}, command);
      const work = {family, command};
      target.queue.push(work);
      if (isShutoff(work)) target.readbackAbort?.abort();
      this.#drain(target);
    }
    return answer;
  }
  #drain(target:Target):void{
    if(target.running!==undefined)return;
    target.running=(async()=>{await Promise.resolve();while(!this.#stopped){const next=target.queue.shift();if(next===undefined)break;if(next==='poll'){target.pollQueued=false;await this.#read(target);}else await this.#execute(target,next);}})().catch(()=>{this.#storageFailed(target);}).finally(()=>{delete target.running;});
  }
  #bounded<T>(work:(signal:AbortSignal)=>Promise<T>,ms:number, stop?: AbortSignal):Promise<T>{
    const controller=new AbortController(),cancel=this.#context.scheduler.after(ms,()=>controller.abort());
    const signal=AbortSignal.any([controller.signal,this.#context.signal,this.#stop.signal, ...(stop === undefined ? [] : [stop])]);
    return (async()=>{let abort:()=>void=()=>{};try{signal.throwIfAborted();return await Promise.race([work(signal),new Promise<never>((_,reject)=>{abort=()=>reject(new Error('Wemo deadline'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}finally{signal.removeEventListener('abort',abort);cancel();controller.abort();}})();
  }
  async #execute(target:Target,pending:Pending):Promise<void>{
    const {command,family}=pending,row=this.#store.get(command.data.requestId);if(row===undefined||row.state!=='accepted')return;
    const release=family===RELEASE,guard=this.#guard(target,command,release);if(guard!==undefined){await this.#finish(target,row,completed(row.requestId,guard.error.code));return;}
    try{await this.#transaction(()=>{const live=this.#store.get(row.requestId);if(live?.state!=='accepted'||live.digest!==row.digest)throw new Error('Wemo fence changed');this.#store.save({...row,state:'started'});},target,command,command.data.requestId);}
    catch(error){await this.#finish(target,row,completed(row.requestId,fullDisk(error)?'capacity':'internal'));return;}
    const trace=this.#context.trace.start('bunny.device.call',{parent:command,kind:'client',attributes:{'bunny.device.id':target.config.id,'bunny.operation':release?'snapshot':'power'}});
    recordLog(this.#context.log, 'command.executing',{'bunny.device.id':target.config.id,'bunny.request.id':row.requestId},command);
    let attempt:Attempt;
    try{
      const remaining=Math.min(ACTION_LIMIT_MS,Date.parse(command.expiresat??'')-this.#context.clock.now());
      if(release){
        const observation=await this.#bounded(signal=>target.transport.read(signal),remaining);
        const after=this.#guard(target,command,true);
        if(observation===undefined||after!==undefined)attempt={result:Outcome.failed,evidence:Outcome.none,code:after?.error.code??'unavailable',connection:observation===undefined?'unavailable':'available'};
        else {
          await this.#transaction(add=>{const current=this.#store.get(row.requestId);if(current?.state!=='started'||current.digest!==row.digest)throw new Error('Wemo fence changed');delete target.record.held;this.#observation(target,observation);this.#record(add,target,command);},target,command,command.data.requestId);
          attempt={result:Outcome.succeeded,evidence:Outcome.none,connection:'available'};
        }
      }else attempt=await this.#bounded(signal=>target.transport.setPower(command.data.on,signal,()=>{
        const last=this.#guard(target,command,false);if(last!==undefined)return last.error.code;
        try{const current=this.#store.get(row.requestId);return current?.state==='started'&&current.digest===row.digest?undefined:'internal';}catch{return 'internal';}
      }),remaining);
    }catch{attempt={result:release?Outcome.failed:Outcome.uncertain,evidence:Outcome.none,code:release?'unavailable':'uncertain-result',connection:'unknown'};}
    trace.end(attempt.result===Outcome.succeeded?'unset':'error');
    const outcome:CompletedOutcome={requestId:row.requestId,result:attempt.result,evidence:release&&attempt.result===Outcome.succeeded?Outcome.observed:attempt.evidence,...(attempt.code===undefined?{}:{error:errorBody(attempt.code).error})};
    const readback: PowerReadback | undefined = !release && command.source === 'bunny/core' &&
      outcome.result === Outcome.succeeded && outcome.evidence === Outcome.transmitted ? {
        requestId: row.requestId, requestedOn: command.data.on, transmittedAtMs: this.#context.clock.now(), reading: {status: target.queue.some(isShutoff) ? 'unavailable' : 'pending'},
        configurationRevision: command.data.expectedConfigurationRevision ?? target.record.configurationRevision,
        generation: command.data.expectedGeneration ?? structuredClone(target.record.generation),
      } : undefined;
    await this.#finish(target, row, outcome, attempt.connection, release ? undefined : command.data.on, readback);
    if (readback?.reading.status === 'pending') await this.#readback(target, row, readback);
  }
  async #readback(target: Target, row: Row, readback: PowerReadback): Promise<void> {
    if (this.#stopped || this.#storageDown) return;
    let observation: Observation | undefined;
    const remaining = POWER_READBACK_MS - (this.#context.clock.now() - readback.transmittedAtMs);
    // The original deadline of a queued shutoff takes priority over an optional read.
    if (remaining > 0 && !target.queue.some(isShutoff)) {
      const interrupt = target.readbackAbort = new AbortController();
      const probe = this.#context.trace.start('bunny.device.call', {parent: row, kind: 'client',
        attributes: {'bunny.device.id': target.config.id, 'bunny.operation': 'snapshot', 'bunny.request.id': row.requestId}});
      try {observation = await this.#bounded(signal => target.transport.read(signal), remaining, interrupt.signal);}
      catch { /* An unavailable read leaves the acknowledged transmission intact. */ }
      finally {
        delete target.readbackAbort;
        probe.end(observation === undefined ? 'error' : 'unset');
      }
    }
    if (this.#stopped || this.#storageDown) return;
    const now = this.#context.clock.now();
    const reading: PowerReadback['reading'] = observation === undefined ? {status: 'unavailable'}
      : {status: 'known', on: observation.power, observedAtMs: now};
    try {
      await this.#transaction(add => {
        if (observation !== undefined) this.#observation(target, observation, now);
        target.record.powerReadbacks = target.record.powerReadbacks?.map(value => value.requestId === row.requestId ? {...value, reading} : value) ?? [];
        this.#record(add, target, row);
      }, target, row, row.requestId);
    } catch { /* The storage fence is recorded and restart retires the pending read. */ }
  }
  async #finish(target:Target,row:Row,outcome:CompletedOutcome,connection?:Attempt['connection'],desired?:boolean, readback?: PowerReadback):Promise<void>{
    target.pending.delete(row.requestId);
    try{await this.#transaction(add=>{
      this.#store.save({...row,state:'done',outcome});target.record.lastOutcome={status:'known',outcome};
      if(outcome.result===Outcome.uncertain){target.record.held={requestId:row.requestId,heldAtMs:this.#context.clock.now()};target.record.observed=unknown;target.record.availability='degraded';}
      else if(connection==='unavailable'){target.record.observed=unknown;target.record.availability='unavailable';target.record.generation.sequence++;}
      if(outcome.result===Outcome.succeeded&&desired!==undefined)target.record.desired.power={status:'known',value:desired};
      if(outcome.evidence===Outcome.transmitted)target.record.lastTransmission={status:'known',requestId:row.requestId,transmittedAtMs:readback?.transmittedAtMs ?? this.#context.clock.now(),operationIds:[]};
      if (readback !== undefined) target.record.powerReadbacks = [readback, ...(target.record.powerReadbacks ?? [])].slice(0, MAX_DEVICE_READBACKS);
      this.#record(add,target,row);
      add(`bunny.event.${row.family}.${row.target}`,{kind:'outcome',type:typeOf(row.family).replace(/\.requested$/,'.completed'),subject:row.target,dataschema:'https://bunny.invalid/events/outcome/2.0',data:outcome},{parent:row});
    },target,row,row.requestId);}catch{/* The transaction recorded the storage fence; never replay. */}
  }
  #observation(target:Target,value:Observation|undefined, observedAtMs = this.#context.clock.now()):void{
    const before=target.record.availability,next=target.lease===undefined?'unavailable':value===undefined?'unavailable':target.record.held===undefined?'available':'degraded';
    if(before!==next)target.record.generation.sequence++;
    target.record.availability=next;
    target.record.observed=value===undefined?unknown:{status:'known',observedAtMs,power:{status:'known',value:value.power},brightness:unknown};
  }
  #schedule(target:Target,delay=POLL_MS):void{
    if(this.#stopped||this.#storageDown)return;target.poll=this.#context.scheduler.after(delay,()=>{if(this.#stopped||target.pollQueued)return;target.pollQueued=true;target.queue.push('poll');this.#drain(target);});
  }
  async #read(target:Target):Promise<void>{
    if(this.#storageDown)return;
    let value:Observation|undefined;
    if(target.lease!==undefined&&!this.#storageDown)try{value=await this.#bounded(signal=>target.transport.read(signal),ACTION_LIMIT_MS);}catch{/* Unavailable is not off. */}
    if(this.#stopped)return;
    if(value===undefined)this.#availability.unreachable(target.config.id,'unavailable');else this.#availability.reached(target.config.id);
    try{await this.#transaction(add=>{if(value===undefined&&target.record.availability==='unavailable'&&target.record.observed.status==='unknown')return;this.#observation(target,value);this.#record(add,target);},target);}catch{return;}
    target.stale?.();const observed=target.record.observed;
    if(observed.status==='known')target.stale=this.#context.scheduler.after(STALE_MS,()=>{
      if(this.#stopped||this.#storageDown||target.record.observed.status!=='known'||target.record.observed.observedAtMs!==observed.observedAtMs)return;
      void this.#transaction(add=>{target.record.availability='degraded';target.record.generation.sequence++;this.#record(add,target);},target).catch(()=>{/* The transaction recorded the storage fence. */});
    });
    this.#schedule(target);
  }
  async stop():Promise<void>{
    this.#stopped=true;this.#stop.abort();for(const target of this.#targets.values()){target.poll?.();target.stale?.();}
    await this.#admitting;await Promise.all([...this.#targets.values()].flatMap(t=>t.running===undefined?[]:[t.running]));
    for(const target of this.#targets.values()){
      for(const item of target.queue)if(item!=='poll'){const row=this.#store.get(item.command.data.requestId);if(row?.state==='accepted')await this.#finish(target,row,completed(row.requestId,'cancelled'));}
      target.queue.length=0;target.pending.clear();
    }
    await this.#committing;for(const target of this.#targets.values())target.lease?.release();
  }
}
