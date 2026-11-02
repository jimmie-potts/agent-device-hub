import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createMicroDuckModule} from '../src/module.js';
import {SimulatedMicroDuck} from '../src/simulated.js';
import {microduckSchemas} from '../src/families.js';
import {schemaOf,typeOf} from '../src/contracts.js';
import {MICRODUCK_SIMULATED_SECTION as config} from '../src/registration.js';
moduleConformance({create:()=>createMicroDuckModule({transport:new SimulatedMicroDuck()}),schemas:{...Object.fromEntries(deviceFamilies.map(f=>[f.dataschema,f.schema])),...microduckSchemas},config,serves:['device','microduck-state'],requestSource:'bunny/core',
  accepted:{key:'bunny.cmd.microduck-stop.microduck-sim',draft:{type:typeOf('microduck-stop'),subject:'microduck-sim',dataschema:schemaOf('microduck-stop'),data:{}}},
  refused:{key:'bunny.cmd.microduck-stop.other',draft:{type:typeOf('microduck-stop'),subject:'other',dataschema:schemaOf('microduck-stop'),data:{}},code:'not-found'},
  offline:{create:()=>{const t=new SimulatedMicroDuck();t.online=false;return createMicroDuckModule({transport:t});},unavailable:m=>m.type==='org.bunny.device.updated'&&m.data.availability==='unavailable'},
});
