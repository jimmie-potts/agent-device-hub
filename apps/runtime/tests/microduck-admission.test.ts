import assert from 'node:assert/strict';
import type {Sdk} from '@jimmie-potts/sdk';
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
