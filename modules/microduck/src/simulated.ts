import {randomUUID} from 'node:crypto';
import type {Observer, MicroDuckTransport} from './transport.js';
import type {Observation} from './contracts.js';
import type {SimulationOptions,Cancel} from '@jimmie-potts/sdk';
export class SimulatedMicroDuck implements MicroDuckTransport {
  readonly effects:{yaw:number;atNs:string}[]=[];
  observer:Observer|undefined;
  online=true;
  mismatch=false;
  coasting=false;
  loseReply=false;
  session=randomUUID();
  #head=0;
  #sensor=0n;
  constructor(readonly clock?:SimulationOptions) {}
  nowNs():bigint {return this.clock===undefined?process.hrtime.bigint():BigInt(this.clock.now())*1000000n;}
  guard():string {if(!this.online||this.mismatch)throw new Error('Synthetic MicroDuck unavailable');return this.session;}
  observation():Observation {
    if(!this.coasting)this.#sensor=this.nowNs();
    return {backend:{kind:'fake-io'},session:this.session,sensorNs:String(this.#sensor),head:[0,0,this.#head,0],targets:Array<number>(15).fill(0),joints:Array<number>(15).fill(0),syntheticJointIndices:[9],daemonUptimeSeconds:1,loopHz:50,policy:'walk',healthy:true,zeroVelocity:true};
  }
  state():{online:boolean;mismatch:boolean;moves:number;head:number;session:string;observation:Observation} {return {online:this.online,mismatch:this.mismatch,moves:this.effects.length,head:this.#head,session:this.session,observation:this.observation()};}
  act(action:string):void {if(action==='offline')this.online=false;else if(action==='online')this.online=true;else if(action==='coast')this.coasting=true;else if(action==='fresh')this.coasting=false;else throw new Error('Unsupported MicroDuck simulation action');if(!this.online)this.observer?.lost();}
  async connect(observer:Observer,signal:AbortSignal):Promise<()=>void> {
    await Promise.resolve();signal.throwIfAborted();this.guard();this.observer=observer;observer.state(this.observation());
    let closed=false,cancel:Cancel=()=>{};
    const after=(callback:()=>void):Cancel=>{if(this.clock!==undefined)return this.clock.scheduler.after(50,callback);const timer=setTimeout(callback,50);return ()=>{clearTimeout(timer);};};
    const tick=():void=>{if(closed)return;if(!this.online||this.mismatch)observer.lost(this.mismatch);else observer.state(this.observation());if(!closed)cancel=after(tick);};
    cancel=after(tick);
    const close=():void=>{closed=true;cancel();signal.removeEventListener('abort',close);if(this.observer===observer)this.observer=undefined;};
    signal.addEventListener('abort',close,{once:true});return close;
  }
  async head(yaw:number,signal:AbortSignal,beforeEffect:()=>void):Promise<void> {
    await Promise.resolve();signal.throwIfAborted();this.guard();beforeEffect();this.#head=yaw;this.effects.push({yaw,atNs:String(this.nowNs())});
    this.observer?.state(this.observation());if(this.loseReply)throw new Error('Synthetic MicroDuck lost reply');
  }
}
