import type {DeviceAction,DeviceSimulation,ModuleRegistration} from '@jimmie-potts/sdk';
import {createWemoModule} from './module.js';
import {registerWemoFamilies,wemoSchemas} from './families.js';
import type {Attempt,Observation,PlugTransport} from './transport.js';
import {Outcome} from '@jimmie-potts/sdk';
/** Supervisor-owned synthetic plugs retain physical state across a disposable runtime restart. */
export class SimulatedWemo {
  readonly plugs=new Map<string,{online:boolean;power:boolean;writes:number}>();
  #plug(id:string){let value=this.plugs.get(id);if(value===undefined){value={online:true,power:false,writes:0};this.plugs.set(id,value);}return value;}
  read(id:string):Observation|undefined {const value=this.#plug(id);return value.online?{power:value.power,firmware:'synthetic-firmware'}:undefined;}
  set(id:string,on:boolean):Attempt {const value=this.#plug(id);if(!value.online)return {result:Outcome.failed,evidence:Outcome.none,code:'unavailable',connection:'unavailable'};value.power=on;value.writes++;return {result:Outcome.succeeded,evidence:Outcome.transmitted,connection:'available'};}
  act(value:DeviceAction):void{const plug=this.#plug(String(value.id));if(value.action==='online'||value.action==='offline')plug.online=value.action==='online';else plug.power=value.action==='physical-on';}
  state(){return Object.fromEntries(this.plugs);}
  transport(id:string):PlugTransport{return {read:()=>Promise.resolve(this.read(id)),setPower:(on,_signal,before)=>{const code=before();return Promise.resolve(code===undefined?this.set(id,on):{result:Outcome.failed,evidence:Outcome.none,code,connection:'unknown'});}};}
}
export const WEMO_SIMULATED_SECTION=Object.freeze({plugs:[{id:'desk-lamp',label:'Desk lamp',address:'192.0.2.60',port:49153,mac:'000000000001',model:'F7C063',firmware:'synthetic-firmware',configurationRevision:1},{id:'shelf-lamp',label:'Shelf lamp',address:'192.0.2.61',port:49153,mac:'000000000002',model:'F7C063',firmware:'synthetic-firmware',configurationRevision:1}]});
const simulation:DeviceSimulation<SimulatedWemo,SimulatedWemo>={
  actions:['online','offline','physical-on','physical-off'],admits:(_action,{id,...rest})=>typeof id==='string'&&/^[a-z0-9-]{1,128}$/.test(id)&&Object.keys(rest).length===0,
  memory:{create:()=>new SimulatedWemo(),state:device=>device.state(),act:(device,value)=>device.act(value),build:device=>createWemoModule({transport:plug=>device.transport(plug.id)})},
  run:{create:()=>new SimulatedWemo(),state:device=>device.state(),act:(device,value)=>device.act(value),
    serve:(device,{method,args})=>{const value=args as {id:string;on?:boolean};return method==='set'?device.set(value.id,value.on===true):device.read(value.id)??null;},
    remote:link=>createWemoModule({transport:plug=>({
      async read(signal){const answer=await link.call('read',{id:plug.id},signal);return answer.status==='answered'&&answer.value!==null?answer.value as Observation:undefined;},
      async setPower(on,signal,before){const code=before();if(code!==undefined)return {result:Outcome.failed,evidence:Outcome.none,code,connection:'unknown'};const answer=await link.call('set',{id:plug.id,on},signal);return answer.status==='answered'?answer.value as Attempt:{result:Outcome.uncertain,evidence:Outcome.none,code:'uncertain-result',connection:'unknown'};},
    })}),},
};
export const registration:ModuleRegistration={name:'wemo',shipped:true,order:550,create:()=>createWemoModule(),simulate:()=>{const device=new SimulatedWemo();return createWemoModule({transport:plug=>device.transport(plug.id)});},schemas:wemoSchemas,registerFamilies:registerWemoFamilies,simulatedSection:{config:WEMO_SIMULATED_SECTION},simulation};
