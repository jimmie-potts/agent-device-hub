import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createReachyModule} from '../src/module.js';
import {SimulatedReachy} from '../src/simulated.js';
import {reachySchemas} from '../src/families.js';
import {schemaOf,typeOf} from '../src/contracts.js';
import {REACHY_SIMULATED_SECTION as config} from '../src/registration.js';
moduleConformance({create:()=>createReachyModule({transport:new SimulatedReachy()}),schemas:{...Object.fromEntries(deviceFamilies.map(f=>[f.dataschema,f.schema])),...reachySchemas},config,serves:['device','reachy-state'],
 accepted:{key:'bunny.cmd.reachy-control.reachy-sim',draft:{type:typeOf('reachy-control'),subject:'reachy-sim',dataschema:schemaOf('reachy-control'),data:{action:'takeover'}}},
 refused:{key:'bunny.cmd.reachy-control.other',draft:{type:typeOf('reachy-control'),subject:'other',dataschema:schemaOf('reachy-control'),data:{action:'takeover'}},code:'not-found'},
 offline:{create:()=>{const t=new SimulatedReachy();t.online=false;return createReachyModule({transport:t});},unavailable:m=>m.type==='org.bunny.device.updated'&&m.data.availability==='unavailable'},
});
