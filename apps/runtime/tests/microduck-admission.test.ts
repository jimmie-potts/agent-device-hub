import assert from 'node:assert/strict';
import type {Sdk,RequestResult} from '@jimmie-potts/sdk';
import {createMicroDuckModule,SimulatedMicroDuck,MICRODUCK_SIMULATED_SECTION,type MicroDuckState} from '@jimmie-potts/microduck';
import {createCoreModule} from '../src/index.js';
import {edgeConfig,it,run,waitFor} from './support.js';
it('core forwarding cannot extend an automatic MicroDuck deadline and another module cannot use its internal dispatch',async t=>{
 const robot=new SimulatedMicroDuck(),module=createMicroDuckModule({transport:robot});let sdk:Sdk|undefined,other:Sdk|undefined,state:MicroDuckState|undefined;
 const wrapped={...module,start:async(c:Parameters<typeof module.start>[0])=>{sdk=c.sdk;await c.sdk.subscribe<MicroDuckState>('bunny.state.microduck-state.*',m=>{state=m.data;});await module.start(c);}};
 const files=await edgeConfig(t,[],{modules:{'microduck':MICRODUCK_SIMULATED_SECTION}});
 await run(t,{configFile:files.config,modules:[createCoreModule(),wrapped,{manifest:{name:'other',apiVersion:'1.3'},start:c=>{other=c.sdk;},stop(){}}]});
 await waitFor(()=>state?.connection==='available');assert.ok(sdk);assert.ok(other);assert.ok(state);
 const draft={type:'org.bunny.microduck.dispatch.requested',subject:'microduck',dataschema:'https://bunny.invalid/events/microduck-dispatch/2.0',data:{target:'microduck-sim',gesture:'notice',opportunityId:'a'.repeat(64),validUntilMs:Date.now()-1,expectedConfigurationRevision:state.configurationRevision,expectedGeneration:state.generation}};
 const expired=await sdk.request('bunny.cmd.microduck-dispatch.microduck',draft,{requestId:'expired-candidate',timeoutMs:3000});assert.equal('error'in expired&&expired.error.error.code,'expired');
 const denied=await other.request('bunny.cmd.microduck-dispatch.microduck',draft,{requestId:'other-module',timeoutMs:3000});assert.equal('error'in denied&&denied.error.error.code,'forbidden');assert.equal(robot.effects.length,0);
});

it('non-core modules cannot directly mutate MicroDuck policy or actuate outside tracked dispatch',async t=>{
 const robot=new SimulatedMicroDuck(),module=createMicroDuckModule({transport:robot});let other:Sdk|undefined,state:MicroDuckState|undefined;const operations:unknown[]=[];
 const wrapped={...module,start:async(c:Parameters<typeof module.start>[0])=>{await c.sdk.subscribe<MicroDuckState>('bunny.state.microduck-state.*',m=>{state=m.data;});await module.start(c);}};
 const files=await edgeConfig(t,[],{modules:{microduck:MICRODUCK_SIMULATED_SECTION}});
 await run(t,{configFile:files.config,modules:[createCoreModule(),wrapped,{manifest:{name:'other',apiVersion:'1.3'},start:async c=>{other=c.sdk;await c.sdk.subscribe('bunny.state.operation.*',m=>{operations.push(m.data);});},stop(){}}]});
 await waitFor(()=>state?.connection==='available');assert.ok(other);assert.ok(state);
 const unchanged={takeover:state.takeover,enabled:state.enabled,latched:state.latched};
 const commands:[string,object][]=[['microduck-control',{action:'takeover'}],['microduck-control',{action:'resume-auto'}],['microduck-gesture',{gesture:'neutral'}],['microduck-stop',{}],['microduck-auto',{gesture:'notice',opportunityId:'a'.repeat(64),validUntilMs:Date.now()+4000}]];
 for(const [family,data] of commands){
  const answer:RequestResult=await other.request(`bunny.cmd.${family}.microduck-sim`,{type:`org.bunny.microduck.${family.slice(10)}.requested`,subject:'microduck-sim',dataschema:`https://bunny.invalid/events/${family}/2.0`,data:family==='microduck-stop'?data:{...data,expectedConfigurationRevision:state.configurationRevision,expectedGeneration:state.generation}},{requestId:crypto.randomUUID(),timeoutMs:3000});
  assert.equal('error'in answer&&answer.error.error.code,'forbidden');
 }
 assert.equal(robot.effects.length,0);assert.equal(operations.length,0);assert.deepEqual({takeover:state.takeover,enabled:state.enabled,latched:state.latched},unchanged);assert.equal(state.pending,0);
});
