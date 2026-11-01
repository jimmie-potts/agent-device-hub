import assert from 'node:assert/strict';
import type {Sdk} from '@jimmie-potts/sdk';
import {createReachyModule,SimulatedReachy,REACHY_SIMULATED_SECTION,type ReachyState} from '@jimmie-potts/reachy-mini';
import {createCoreModule} from '../src/index.js';
import {edgeConfig,it,run,waitFor} from './support.js';
it('core forwarding cannot extend an automatic Reachy deadline and another module cannot use its internal dispatch',async t=>{
 const robot=new SimulatedReachy(),module=createReachyModule({transport:robot});let sdk:Sdk|undefined,other:Sdk|undefined,state:ReachyState|undefined;
 const wrapped={...module,start:async(c:Parameters<typeof module.start>[0])=>{sdk=c.sdk;await c.sdk.subscribe<ReachyState>('bunny.state.reachy-state.*',m=>{state=m.data;});await module.start(c);}};
 const files=await edgeConfig(t,[],{modules:{'reachy-mini':REACHY_SIMULATED_SECTION}});
 await run(t,{configFile:files.config,modules:[createCoreModule(),wrapped,{manifest:{name:'other',apiVersion:'1.3'},start:c=>{other=c.sdk;},stop(){}}]});
 await waitFor(()=>state?.connection==='available');assert.ok(sdk);assert.ok(other);assert.ok(state);
 const draft={type:'org.bunny.reachy.dispatch.requested',subject:'reachy',dataschema:'https://bunny.invalid/events/reachy-dispatch/2.0',data:{target:'reachy-sim',gesture:'notice',opportunityId:'a'.repeat(64),validUntilMs:Date.now()-1,expectedConfigurationRevision:state.configurationRevision,expectedGeneration:state.generation}};
 const expired=await sdk.request('bunny.cmd.reachy-dispatch.reachy',draft,{requestId:'expired-candidate',timeoutMs:3000});assert.equal('error'in expired&&expired.error.error.code,'expired');
 const denied=await other.request('bunny.cmd.reachy-dispatch.reachy',draft,{requestId:'other-module',timeoutMs:3000});assert.equal('error'in denied&&denied.error.error.code,'forbidden');assert.equal(robot.effects.length,0);
});
