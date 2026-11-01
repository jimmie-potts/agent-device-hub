import {createConnection, type Socket} from 'node:net';
import {Ajv2020} from 'ajv/dist/2020.js';
import type {Observation} from './contracts.js';
import {parseState, parseWire} from './protocol.js';
import {FixtureWitness, VENDOR} from './witness.js';
export type Observer = {state:(value:Observation)=>void;lost:(mismatch?:boolean)=>void};
export interface MicroDuckTransport {
  nowNs():bigint;
  guard():string;
  connect(observer:Observer,signal:AbortSignal):Promise<()=>void>;
  head(yaw:number,signal:AbortSignal,beforeEffect:()=>void):Promise<void>;
}
export class BeforeSendError extends Error {}
export class VendorRefusal extends Error {}
type Pending={resolve:(value:unknown)=>void;reject:(error:Error)=>void;clear:()=>void};
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const hello=new Ajv2020().compile({type:'object',required:['api_version','daemon_version','revision'],properties:{api_version:{const:VENDOR.api},daemon_version:{const:VENDOR.version},revision:{const:VENDOR.revision}}});
const policyCheck=new Ajv2020().compile<{slots:{slot:string;path:string|null;error:unknown;overridden:boolean}[]}>({type:'object',required:['slots'],properties:{slots:{type:'array',minItems:7,maxItems:7,items:{type:'object',required:['slot','path','error','overridden'],properties:{slot:{enum:['walk','stand','sitstand','ground_pick','kick_left','kick_right','roulade']},path:{type:['string','null']},error:{type:'null'},overridden:{const:true}}}}}});
function policyValid(value:unknown):boolean {
  return policyCheck(value)&&new Set(value.slots.map(x=>x.slot)).size===7&&value.slots.every(x=>x.path===(x.slot==='walk'?VENDOR.policy:null));
}
export class UnixMicroDuck implements MicroDuckTransport {
  #witness:Pick<FixtureWitness,'socket'|'guard'>|undefined;
  #socket:Socket|undefined;
  #observer:Observer|undefined;
  #session:string|undefined;
  #buffer=Buffer.alloc(0);
  #id=0;
  #pending=new Map<number,Pending>();
  constructor(readonly fixtureRoot:string,readonly witness:()=>Pick<FixtureWitness,'socket'|'guard'>=()=>new FixtureWitness(fixtureRoot)) {}
  nowNs():bigint {return process.hrtime.bigint();}
  guard():string {
    const session=this.#witness?.guard();
    if(session===undefined||session!==this.#session||this.#socket?.destroyed!==false)throw new BeforeSendError('MicroDuck fixture is unavailable');
    return session;
  }
  async connect(observer:Observer,signal:AbortSignal):Promise<()=>void> {
    this.#close();signal.throwIfAborted();
    this.#witness=this.witness();this.#session=this.#witness.guard();this.#observer=observer;
    const socket=createConnection(this.#witness.socket);this.#socket=socket;this.#buffer=Buffer.alloc(0);
    const close=():void=>{this.#close();};
    signal.addEventListener('abort',close,{once:true});
    socket.on('data',chunk=>{if(this.#socket===socket)this.#read(chunk);});
    socket.on('error',()=>{if(this.#socket===socket)this.#lost();});socket.on('close',()=>{if(this.#socket===socket)this.#lost();});
    try {
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{socket.destroy();reject(new Error('MicroDuck connection deadline'));},2000);
        socket.once('connect',()=>{clearTimeout(timer);resolve();});socket.once('error',()=>{clearTimeout(timer);reject(new Error('MicroDuck connection failed'));});
        socket.once('close',()=>{clearTimeout(timer);reject(new Error('MicroDuck connection closed'));});
      });
      if(!hello(await this.#call('hello',{api_version:47},signal))||!policyValid(await this.#call('robot.policies',{},signal))) {
        this.#lost(true);throw new BeforeSendError('MicroDuck vendor identity mismatch');
      }
      await this.#call('robot.subscribe',{hz:10},signal);
      return ()=>{signal.removeEventListener('abort',close);close();};
    } catch(error) {signal.removeEventListener('abort',close);this.#close();throw error;}
  }
  #read(chunk:Buffer):void {
    try {
      this.#buffer=Buffer.concat([this.#buffer,chunk]);
      let index=this.#buffer.indexOf(10);
      while(index>=0) {
        if(index>256*1024)throw new Error('MicroDuck frame limit');
        const line=this.#buffer.subarray(0,index).toString('utf8');this.#buffer=this.#buffer.subarray(index+1);
        const wire=parseWire(line);
        if(!record(wire)||wire.jsonrpc!=='2.0')throw new Error('MicroDuck RPC frame invalid');
        if(wire.method==='robot.state') {
          const session=this.guard();this.#observer?.state(parseState(line,session));
        } else {
          if(typeof wire.id!=='number'||!Number.isSafeInteger(wire.id))throw new Error('MicroDuck RPC identity invalid');
          const pending=this.#pending.get(wire.id);
          if(pending===undefined)throw new Error('MicroDuck unexpected RPC answer');
          this.#pending.delete(wire.id);pending.clear();
          if('error'in wire)pending.reject(new VendorRefusal('MicroDuck refused RPC'));
          else if('result'in wire)pending.resolve(wire.result);
          else {pending.reject(new Error('MicroDuck RPC result missing'));throw new Error('MicroDuck RPC answer invalid');}
        }
        index=this.#buffer.indexOf(10);
      }
      if(this.#buffer.length>256*1024)throw new Error('MicroDuck partial frame limit');
    }catch {this.#lost(true);}
  }
  #call(method:'hello'|'robot.health'|'robot.policies'|'robot.subscribe'|'robot.head',params:object,signal:AbortSignal,beforeEffect?:()=>void):Promise<unknown> {
    signal.throwIfAborted();
    if(this.#socket?.destroyed!==false||this.#pending.size>=4)throw new BeforeSendError('MicroDuck RPC unavailable');
    const socket=this.#socket,id=++this.#id;
    return new Promise((resolve,reject)=>{
      const end=(error:Error):void=>{const p=this.#pending.get(id);if(p===undefined)return;this.#pending.delete(id);p.clear();reject(error);this.#lost();};
      const abort=():void=>{end(new Error('MicroDuck RPC cancelled'));};
      const timer=setTimeout(()=>end(new Error('MicroDuck RPC deadline')),500);
      const clear=():void=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
      this.#pending.set(id,{resolve,reject,clear});signal.addEventListener('abort',abort,{once:true});
      try {signal.throwIfAborted();this.guard();beforeEffect?.();socket.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}
      catch(error) {this.#pending.delete(id);clear();reject(error instanceof Error?error:new BeforeSendError('MicroDuck presend refused'));}
    });
  }
  async head(yaw:number,signal:AbortSignal,beforeEffect:()=>void):Promise<void> {
    if(![-.1,0,.1].includes(yaw))throw new BeforeSendError('MicroDuck input is outside catalog');
    const health=await this.#call('robot.health',{},signal);
    if(!record(health)||health.healthy!==true||!policyValid(await this.#call('robot.policies',{},signal)))throw new BeforeSendError('MicroDuck policy is unhealthy');
    const reply=await this.#call('robot.head',{neck_pitch:0,head_pitch:0,head_yaw:yaw,head_roll:0},signal,beforeEffect);
    if(!record(reply)||reply.accepted!==true) {
      if(record(reply)&&reply.accepted===false)throw new VendorRefusal('MicroDuck input refused');
      throw new Error('MicroDuck input answer invalid');
    }
  }
  #close():void {
    this.#observer=undefined;const socket=this.#socket;this.#socket=undefined;socket?.destroy();
    for(const p of this.#pending.values()){p.clear();p.reject(new Error('MicroDuck connection ended'));}this.#pending.clear();
  }
  #lost(mismatch=false):void {const observer=this.#observer;if(observer===undefined)return;this.#close();observer.lost(mismatch);}
}
