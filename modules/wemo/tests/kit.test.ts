import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createWemoModule} from '../src/module.js';
import {wemoSchemas} from '../src/families.js';
import {registration,WEMO_SIMULATED_SECTION} from '../src/registration.js';
moduleConformance({
  // The generic kit requests immediately after start. Its online fixture waits for the real first observation;
  // the offline policy-A check below uses the production module's nonblocking start unchanged.
  create:()=>{const module=registration.simulate();return {...module,start:async context=>{
    let ready=()=>{};const observed=new Promise<void>(resolve=>{ready=resolve;});
    const watch=await context.sdk.subscribe('bunny.state.device.desk-lamp',message=>{if((message.data as {availability?:string}).availability==='available')ready();});
    let timer:NodeJS.Timeout|undefined;
    try{await module.start(context);await Promise.race([observed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('synthetic observation missing')),1000);})]);}
    finally{clearTimeout(timer);await watch.close();}
  }};},config:WEMO_SIMULATED_SECTION,schemas:{...Object.fromEntries(deviceFamilies.map(family=>[family.dataschema,family.schema])),...wemoSchemas},serves:['device'],
  accepted:{key:'bunny.cmd.power-set.desk-lamp',draft:{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}}},
  refused:{key:'bunny.cmd.power-set.desk-lamp',draft:{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true,expectedConfigurationRevision:9999}},code:'revision-conflict'},
  offline:{create:()=>createWemoModule({transport:()=>({read:()=>Promise.resolve(undefined),setPower:()=>Promise.reject(new Error('unexpected write'))})}),unavailable:message=>message.type==='org.bunny.device.updated'&&message.data.availability==='unavailable'},
});
