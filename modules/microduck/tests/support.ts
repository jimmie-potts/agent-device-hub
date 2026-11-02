import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {ModeState,SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createMicroDuckModule} from '../src/module.js';
import {SimulatedMicroDuck} from '../src/simulated.js';
import {MICRODUCK_SIMULATED_SECTION as section} from '../src/registration.js';
import {schemaOf,typeOf,type Family,type MicroDuckState} from '../src/contracts.js';
import type {MicroDuckTransport} from '../src/transport.js';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
export async function until(check:()=>boolean,ms=4000):Promise<void>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)assert.fail('MicroDuck condition did not arrive');await pause(5);}}
export async function fixture(t:TestContext,transport:MicroDuckTransport=new SimulatedMicroDuck(),clock?:{now:()=>number}) {
  const dir=await mkdtemp(join(tmpdir(),'microduck-module-')),bus=new InProcessBus(clock===undefined?{}:{now:clock.now});
  const core=bus.connect('bunny/core'),operator=bus.connect('bunny/parts/operator'),states:MicroDuckState[]=[];
  let mode:ModeState={id:'hub',revision:1,mode:'work',selectedAtMs:Date.now()},sessions:SessionRecord[]=[];
  await core.serveSync(['session','mode'],()=>({revision:mode.revision,states:[{type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode},...sessions.map(s=>({type:'org.bunny.session.updated',subject:s.id,dataschema:schemaOf('session'),data:s}))]}));
  await operator.subscribe<MicroDuckState>('bunny.state.microduck-state.*',m=>{states.push(m.data);});
  let host=new ModuleHarness(createMicroDuckModule({transport}),{bus,stateDir:dir,section,...(clock===undefined?{}:{clock})});
  t.after(async()=>{await host.stop();await operator.close();await core.close();await rm(dir,{recursive:true,force:true});});await host.start();
  const state=():MicroDuckState=>{const v=states.at(-1);assert.ok(v);return v;};
  const command=(family:Family,data:object={},requestId:string=crypto.randomUUID(),timeoutMs=5000)=>core.request(`bunny.cmd.${family}.${section.id}`,{type:typeOf(family),subject:section.id,dataschema:schemaOf(family),data:family==='microduck-stop'?data:{expectedConfigurationRevision:state().configurationRevision,expectedGeneration:state().generation,...data}},{requestId,timeoutMs});
  const outcome=(id:string):CompletedOutcome|undefined=>[...states].reverse().find(s=>s.lastOutcome?.requestId===id)?.lastOutcome??undefined;
  const control=async(action:string)=>{const id=crypto.randomUUID();assert.equal((await command('microduck-control',{action},id)).status,'accepted');await until(()=>outcome(id)!==undefined);assert.equal(outcome(id)?.result,'succeeded');};
  await until(()=>state().connection==='available');await pause(30);
  return {bus,core,operator,command,state,outcome,control,states,get host(){return host;},async restart(){await host.stop();host=new ModuleHarness(createMicroDuckModule({transport}),{bus,stateDir:dir,section,...(clock===undefined?{}:{clock})});await host.start();await until(()=>state().connection==='available');},
    async mode(value:ModeState['mode']){mode={...mode,revision:mode.revision+1,mode:value};await core.publish('bunny.state.mode.hub',{kind:'state',type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode});await pause(20);},
    async sessions(value:SessionRecord[]){sessions=value;for(const s of value)await core.publish(`bunny.state.session.${s.id}`,{kind:'state',type:'org.bunny.session.updated',subject:s.id,dataschema:schemaOf('session'),data:s});await pause(20);},
  };
}
