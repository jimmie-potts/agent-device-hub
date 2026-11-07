import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {setImmediate as turn,setTimeout as pause} from 'node:timers/promises';
import {InProcessBus,type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {ModeState,SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createMicroDuckModule} from '../src/module.js';
import {SimulatedMicroDuck} from '../src/simulated.js';
import {MICRODUCK_SIMULATED_SECTION as section} from '../src/registration.js';
import {schemaOf,typeOf,type Family,type MicroDuckState} from '../src/contracts.js';
import type {MicroDuckTransport} from '../src/transport.js';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
/**
 * Moved only by the test, and shared by the module, the bus and the simulator. Automatic expression refuses sensor
 * evidence older than 500 ms, and its path to the first write runs eight synchronous commits with no observation between
 * them, so on the real clock a slow disk or a stalled host could refuse the reaction a test waits for. The return
 * window is 100 ms wide, so the same holds for a test that times a gesture's return.
 */
export class TestClock {
 ms=Date.now();
 readonly #timers=new Set<{at:number;callback:()=>void}>();
 readonly now=():number=>this.ms;
 readonly scheduler:Scheduler={after:(delayMs,callback)=>{const timer={at:this.ms+delayMs,callback};this.#timers.add(timer);return ()=>{this.#timers.delete(timer);};}};
 async advance(ms:number):Promise<void>{for(let moved=0;moved<ms;moved+=5){this.ms+=5;for(const timer of [...this.#timers].sort((a,b)=>a.at-b.at)){if(timer.at>this.ms)break;if(this.#timers.delete(timer))timer.callback();}await turn();}}
}
export async function until(check:()=>boolean,ms=4000):Promise<void>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)assert.fail('MicroDuck condition did not arrive');await pause(5);}}
/** Moves a test clock 5 ms a turn until `check` holds, so the module's timers run. `until` moves no test clock. */
export async function advanceUntil(clock:TestClock,check:()=>boolean,ms=4000):Promise<void>{for(let moved=0;!check();moved+=5){if(moved>=ms)assert.fail('MicroDuck condition did not arrive');await clock.advance(5);}}
export async function fixture(t:TestContext,transport:MicroDuckTransport=new SimulatedMicroDuck(),clock?:TestClock) {
  const dir=await mkdtemp(join(tmpdir(),'microduck-module-')),bus=new InProcessBus(clock===undefined?{}:{now:clock.now,scheduler:clock.scheduler}),timing=clock===undefined?{}:{clock,scheduler:clock.scheduler};
  const core=bus.connect('bunny/core'),operator=bus.connect('bunny/parts/operator'),states:MicroDuckState[]=[];
  let mode:ModeState={id:'hub',revision:1,mode:'work',selectedAtMs:Date.now()},sessions:SessionRecord[]=[];
  await core.serveSync(['session','mode'],()=>({revision:mode.revision,states:[{type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode},...sessions.map(s=>({type:'org.bunny.session.updated',subject:s.id,dataschema:schemaOf('session'),data:s}))]}));
  await operator.subscribe<MicroDuckState>('bunny.state.microduck-state.*',m=>{states.push(m.data);});
  let host=new ModuleHarness(createMicroDuckModule({transport}),{bus,stateDir:dir,section,...timing});
  t.after(async()=>{await host.stop();await operator.close();await core.close();await rm(dir,{recursive:true,force:true});});await host.start();
  const state=():MicroDuckState=>{const v=states.at(-1);assert.ok(v);return v;};
  const command=(family:Family,data:object={},requestId:string=crypto.randomUUID(),timeoutMs=5000)=>core.request(`bunny.cmd.${family}.${section.id}`,{type:typeOf(family),subject:section.id,dataschema:schemaOf(family),data:family==='microduck-stop'?data:{expectedConfigurationRevision:state().configurationRevision,expectedGeneration:state().generation,...data}},{requestId,timeoutMs});
  const outcome=(id:string):CompletedOutcome|undefined=>[...states].reverse().find(s=>s.lastOutcome?.requestId===id)?.lastOutcome??undefined;
  const control=async(action:string)=>{const id=crypto.randomUUID();assert.equal((await command('microduck-control',{action},id)).status,'accepted');await until(()=>outcome(id)!==undefined);assert.equal(outcome(id)?.result,'succeeded');};
  // On a test clock, the connection and its observations arrive only as the clock moves.
  const connected=():Promise<void>=>clock===undefined?until(()=>state().connection==='available'):advanceUntil(clock,()=>state().connection==='available');
  await connected();await (clock===undefined?pause(30):clock.advance(30));
  return {bus,core,operator,command,state,outcome,control,states,get host(){return host;},async restart(){await host.stop();host=new ModuleHarness(createMicroDuckModule({transport}),{bus,stateDir:dir,section,...timing});await host.start();await connected();},
    async mode(value:ModeState['mode']){mode={...mode,revision:mode.revision+1,mode:value};await core.publish('bunny.state.mode.hub',{kind:'state',type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode});await pause(20);},
    async sessions(value:SessionRecord[]){sessions=value;for(const s of value)await core.publish(`bunny.state.session.${s.id}`,{kind:'state',type:'org.bunny.session.updated',subject:s.id,dataschema:schemaOf('session'),data:s});await pause(20);},
  };
}
