import type {ArtRecord} from '@jimmie-potts/event-contracts/v2/art-state';
import type {ArtSchedulePolicy} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {WeatherState,WeatherChanged} from '@jimmie-potts/weather';
import type {Cancel,ModuleScheduler,Subscription,SyncedCopy,TraceContext} from '@jimmie-potts/sdk';
import type {CoreHandle} from './core.js';

/** The schedule follows only its enabled sources. Existing module-owned consumers keep their own permissions. */
export class ArtScheduleInputs {
  #art:Following<ArtRecord>|undefined;
  #weather:Following<WeatherState>|undefined;
  #events:Promise<Subscription>|undefined;
  #epoch=0;
  #weatherBaseline=0;
  #closed=false;
  constructor(readonly core:Pick<CoreHandle,'clock'|'sdk'>,readonly scheduler:ModuleScheduler,readonly active:()=>boolean,
    readonly changed:()=>void,readonly weatherChanged:(revision:number,parent:TraceContext)=>void,readonly weatherSynced:(revision:number)=>void=()=>{}){}
  set(policy:ArtSchedulePolicy):void {
    if(this.#closed)return;
    if(policy.enabled && this.#art===undefined)this.#art=new Following(this.core,this.scheduler,this.active,'art','bunny/modules/art',this.changed);
    if(!policy.enabled && this.#art!==undefined){void this.#art.close();this.#art=undefined;}
    const weather=policy.enabled&&policy.weather;
    if(weather && this.#weather===undefined) {
      const epoch=++this.#epoch;
      this.#weather=new Following(this.core,this.scheduler,this.active,'weather-state','bunny/modules/weather',this.changed,()=>{
        const current=this.weather();if(current===undefined)return;this.#weatherBaseline=current.revision;this.weatherSynced(current.revision);
      });
      this.#events=this.core.sdk.subscribe<WeatherChanged>('bunny.event.weather-changed.local',message=>{
        if(this.#closed||!this.active()||epoch!==this.#epoch||message.source!=='bunny/modules/weather')return;
        const current=this.weather();
        if(current?.status==='available'&&current.observedAtMs<=this.core.clock.now()&&current.staleAtMs>this.core.clock.now()
          &&current.revision>this.#weatherBaseline&&current.revision===message.data.revision&&current.observedAtMs===message.data.observedAtMs)
          this.weatherChanged(current.revision,{traceparent:message.traceparent});
      });
      void this.#events.catch(()=>{this.changed();});
    }
    if(!weather && this.#weather!==undefined){++this.#epoch;this.#weatherBaseline=0;void this.#weather.close();this.#weather=undefined;
      const events=this.#events;this.#events=undefined;void events?.then(value=>value.close(),()=>{});}
  }
  art():ArtRecord|undefined{return this.#art?.get('art');}
  weather():WeatherState|undefined{return this.#weather?.get('local');}
  async close():Promise<void>{this.#closed=true;++this.#epoch;await Promise.all([this.#art?.close(),this.#weather?.close(),this.#events?.then(value=>value.close(),()=>{})]);}
}
class Following<T extends object> {
  #copy:SyncedCopy<T>|undefined;
  #fresh=false;
  #closed=false;
  #cancel:Cancel|undefined;
  #pending:Promise<void>=Promise.resolve();
  #delay=1000;
  constructor(readonly core:Pick<CoreHandle,'sdk'>,readonly scheduler:ModuleScheduler,readonly active:()=>boolean,
    readonly family:string,readonly owner:string,readonly changed:()=>void,readonly synced:()=>void=()=>{}){this.#start();}
  get(id:string):T|undefined {if(!this.#fresh||this.#closed||!this.active())return undefined;const message=this.#copy?.get({family:this.family,id});return message?.source===this.owner?message.data:undefined;}
  #retry():void {
    this.#fresh=false;this.changed();if(this.#closed||!this.active()||this.#cancel!==undefined)return;
    this.#cancel=this.scheduler.after(this.#delay,()=>{this.#cancel=undefined;this.#start();});this.#delay=Math.min(30_000,this.#delay*2);
  }
  #start():void {
    if(this.#closed||!this.active())return;
    this.#pending=this.core.sdk.sync<T>([this.family],change=>{
      if(this.#closed||!this.active())return;
      if(change.type==='failed')this.#retry();
      else if(change.type==='updated'&&this.#fresh)this.changed();
      else if(change.type==='synced'){this.#fresh=true;if(this.#copy!==undefined)this.synced();this.changed();}
    },{owner:this.owner,timeoutMs:5000,onRestarted:()=>{this.#fresh=false;this.changed();}}).then(async result=>{
      if(result.status!=='synced'){this.#retry();return;}
      if(this.#closed||!this.active()){await result.copy.close();return;}
      this.#copy=result.copy;this.#fresh=true;this.#delay=1000;this.synced();this.changed();
    },()=>{this.#retry();});
  }
  async close():Promise<void>{this.#closed=true;this.#fresh=false;this.#cancel?.();await this.#pending;await this.#copy?.close();}
}
