import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {createReachyModule} from './module.js';
import {reachySchemas, registerReachyFamilies} from './families.js';
import {SimulatedReachy} from './simulated.js';
export const REACHY_SIMULATED_SECTION = {id: 'reachy-sim', endpoint: 'http://127.0.0.1:18861', configurationRevision: 1, ownership: 'exclusive'} as const;
const simulation:DeviceSimulation<SimulatedReachy,SimulatedReachy>={
  actions:['online','offline'],
  memory:{create:()=>new SimulatedReachy(),state:d=>d.state(),act:(d,a)=>{d.act(a.action);},build:d=>createReachyModule({transport:d})},
  run:{create:()=>new SimulatedReachy(),state:d=>d.state(),act:(d,a)=>{d.act(a.action);},
    serve:(d,r)=>{
      if(r.method==='state')return d.state();
      if(r.method==='move'&&Array.isArray(r.args)&&r.args.length===2&&r.args.every(x=>typeof x==='number'&&Math.abs(x)<=.2))return d.move([Number(r.args[0]),Number(r.args[1])],r.signal);
      if(r.method==='cancel'&&typeof r.args==='string')return d.cancel(r.args,r.signal);
      throw new Error('invalid simulation request');
    },
    remote:link=>createReachyModule({transport:{
      async connect(observer,signal){
        let closed=false,index=0;const poll=async():Promise<void>=>{
          const answer=await link.call('state',{},signal);if(closed)return;
          if(answer.status!=='answered') {observer.lost();return;}
          const value=answer.value as ReturnType<SimulatedReachy['state']>;
          if(!value.online||value.mismatch){observer.lost(value.mismatch);return;}
          observer.state({antennas:[value.antennas[0]??0,value.antennas[1]??0]});
          const offset=Math.max(0,index-(value.eventCount-value.events.length));
          for(const event of value.events.slice(offset))observer.event(event);index=value.eventCount;
        };
        await poll();const timer=setInterval(()=>{void poll();},100);
        const close=():void=>{closed=true;clearInterval(timer);signal.removeEventListener('abort',close);};signal.addEventListener('abort',close,{once:true});return close;
      },
      async move(target,signal,beforeEffect){beforeEffect?.();const answer=await link.call('move',target,signal);if(answer.status!=='answered'||typeof answer.value!=='string')throw new Error('simulation task unanswered');return answer.value;},
      async cancel(id,signal,beforeEffect){beforeEffect?.();const answer=await link.call('cancel',id,signal);if(answer.status!=='answered')throw new Error('simulation cancellation unanswered');},
    }}),
  },
};
export const registration: ModuleRegistration = {
  name: 'reachy-mini', shipped: true, order: 650, create: () => createReachyModule(),
  simulate: () => createReachyModule({transport: new SimulatedReachy()}),
  schemas: reachySchemas, registerFamilies: registerReachyFamilies, simulatedSection: {config: REACHY_SIMULATED_SECTION},simulation,
};
