import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {Ajv2020} from 'ajv/dist/2020.js';
import {createMicroDuckModule} from './module.js';
import {microduckSchemas, registerMicroDuckFamilies} from './families.js';
import {SimulatedMicroDuck} from './simulated.js';
const valid=new Ajv2020({strict:false}).compile<ReturnType<SimulatedMicroDuck['state']>>({type:'object',required:['online','mismatch','moves','head','session','observation'],properties:{online:{type:'boolean'},mismatch:{type:'boolean'},moves:{type:'integer'},head:{type:'number'},session:{type:'string'},observation:{type:'object',required:['session','sensorNs','head','targets','joints','daemonUptimeSeconds','loopHz','policy','healthy','zeroVelocity','syntheticJointIndices','backend'],properties:{backend:{type:'object',additionalProperties:false,required:['kind'],properties:{kind:{const:'fake-io'}}},syntheticJointIndices:{type:'array',minItems:1,maxItems:1,items:{const:9}},session:{type:'string'},sensorNs:{type:'string'},head:{type:'array',minItems:4,maxItems:4,items:{type:'number'}},targets:{type:'array',minItems:15,maxItems:15,items:{type:'number'}},joints:{type:'array',minItems:15,maxItems:15,items:{type:'number'}},daemonUptimeSeconds:{type:'number'},loopHz:{type:'number'},policy:{type:'string'},healthy:{type:'boolean'},zeroVelocity:{type:'boolean'}}}}});
export const MICRODUCK_SIMULATED_SECTION={id:'microduck-sim',fixtureRoot:'/tmp/bunny-md-simulated',configurationRevision:1} as const;
const simulation:DeviceSimulation<SimulatedMicroDuck,SimulatedMicroDuck>={
  actions:['online','offline','coast','fresh'],
  memory:{create:options=>new SimulatedMicroDuck(options),state:d=>d.state(),act:(d,a)=>{d.act(a.action);},build:d=>createMicroDuckModule({transport:d})},
  run:{create:()=>new SimulatedMicroDuck(),state:d=>d.state(),act:(d,a)=>{d.act(a.action);},serve:(d,r)=>{
    if(r.method==='state')return d.state();
    if(r.method==='head'&&typeof r.args==='number'&&[-.1,0,.1].includes(r.args))return d.head(r.args,r.signal,()=>{});
    throw new Error('Invalid MicroDuck simulation request');
  },remote:link=>{
    let current:ReturnType<SimulatedMicroDuck['state']>|undefined;
    return createMicroDuckModule({transport:{
      nowNs:()=>process.hrtime.bigint(),guard:()=>{if(current===undefined||!current.online||current.mismatch)throw new Error('Synthetic MicroDuck unavailable');return current.session;},
      async connect(observer,signal){
        let closed=false;
        const poll=async():Promise<void>=>{
          const answer=await link.call('state',{},signal);if(closed)return;
          if(answer.status!=='answered'||!valid(answer.value)){observer.lost();return;}
          current=answer.value;if(!current.online||current.mismatch){observer.lost(current.mismatch);return;}
          observer.state(current.observation);
        };
        await poll();const timer=setInterval(()=>{void poll();},100);
        const close=():void=>{closed=true;clearInterval(timer);signal.removeEventListener('abort',close);};signal.addEventListener('abort',close,{once:true});return close;
      },async head(yaw,signal,beforeEffect){beforeEffect();const answer=await link.call('head',yaw,signal);if(answer.status!=='answered')throw new Error('Synthetic MicroDuck input unanswered');},
    }});
  }},
};
export const registration:ModuleRegistration={name:'microduck',shipped:true,order:660,create:()=>createMicroDuckModule(),simulate:()=>createMicroDuckModule({transport:new SimulatedMicroDuck()}),schemas:microduckSchemas,registerFamilies:registerMicroDuckFamilies,simulatedSection:{config:MICRODUCK_SIMULATED_SECTION},simulation};
