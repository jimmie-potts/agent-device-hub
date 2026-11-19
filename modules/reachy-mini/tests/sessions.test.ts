// Reachy reads each session through the shared read function and adds only its own device conditions (Hub #1865, task
// 4.4). Unconfirmed work alone does not refuse a waiting approval. The case runs on a test clock, with no real waits.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {setImmediate as turn} from 'node:timers/promises';
import {InProcessBus,type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {sessionEntityId,type Identity,type ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession,SESSION_SCHEMA} from '@jimmie-potts/event-contracts/v2/session';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {createReachyModule} from '../src/module.js';
import {SimulatedReachy} from '../src/simulated.js';
import {REACHY_SIMULATED_SECTION as section} from '../src/registration.js';
import type {ReachyState} from '../src/contracts.js';

/** Moved only by the test, 5 ms a turn, so the module's and the bus's timers run in order. */
class TestClock {
  ms=Date.parse('2026-11-18T12:00:00Z');
  readonly #timers=new Set<{at:number;callback:()=>void}>();
  readonly now=():number=>this.ms;
  readonly scheduler:Scheduler={after:(delayMs,callback)=>{const timer={at:this.ms+delayMs,callback};this.#timers.add(timer);return ()=>{this.#timers.delete(timer);};}};
  async advance(ms:number):Promise<void>{for(let moved=0;moved<ms;moved+=5){this.ms+=5;for(const timer of [...this.#timers].sort((a,b)=>a.at-b.at)){if(timer.at>this.ms)break;if(this.#timers.delete(timer))timer.callback();}await turn();}}
  async until(check:()=>boolean,ms=1500):Promise<void>{for(let moved=0;!check();moved+=5){if(moved>=ms)assert.fail('Reachy condition did not arrive');await this.advance(5);}}
}

void test('an approval from a session whose work is unconfirmed gestures; a superseded turn does not',{timeout:10000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'reachy-sessions-')),clock=new TestClock(),bus=new InProcessBus({now:clock.now,scheduler:clock.scheduler}),core=bus.connect('bunny/core'),robot=new SimulatedReachy();
  const identity:Identity={provider:'claude',client:'code',hostId:'synthetic-host',sourceId:'synthetic-source',sessionId:'synthetic-session'};
  const approval={id:{status:'known',id:'approval-1'},kind:'approval',turn:{status:'known',id:'turn-2'}} as const;
  // Work left unconfirmed by a restart, as the hub reports a running turn it has not heard from since.
  const session=buildSession({id:sessionEntityId(identity),revision:5,generation:2,identity,parent:{status:'unknown'},turn:{status:'known',id:'turn-2'},work:'active',attention:[approval],
    notices:[],read:'unknown',unavailable:[],ordering:{status:'unknown'},observedAtMs:clock.now(),lastEvidenceAtMs:clock.now()-360_000,unconfirmed:'restart',children:{working:0,unconfirmed:0}});
  const mode:ModeState={id:'hub',revision:1,mode:'work',selectedAtMs:clock.now()};
  let state:ReachyState|undefined,dispatches=0;
  await core.serveSync(['session','mode'],()=>({revision:10,states:[{type:'org.bunny.session.updated',subject:session.id,dataschema:SESSION_SCHEMA,data:session},
    {type:'org.bunny.mode.updated',subject:'hub',dataschema:'https://bunny.invalid/events/mode/2.0',data:mode}]}));
  await core.subscribe<ReachyState>('bunny.state.reachy-state.*',m=>{state=m.data;});
  await core.respond<Record<string,unknown>&{requestId:string;target:string}>('bunny.cmd.reachy-dispatch.reachy',async c=>{dispatches++;const {target,...data}=c.data;
    const r=await core.request(`bunny.cmd.reachy-auto.${target}`,{type:'org.bunny.reachy.auto.requested',subject:target,dataschema:'https://bunny.invalid/events/reachy-auto/2.0',data},{requestId:c.data.requestId,timeoutMs:3000});
    return r.status==='accepted'?{status:'accepted'}:{error:{code:'internal',retryable:false}};});
  const host=new ModuleHarness(createReachyModule({transport:robot}),{bus,stateDir:dir,section,clock,scheduler:clock.scheduler});
  t.after(async()=>{await host.stop();await core.close();await rm(dir,{recursive:true,force:true});});
  await host.start();await clock.until(()=>state?.connection==='available');
  const id=crypto.randomUUID();
  const enabled=await core.request('bunny.cmd.reachy-control.reachy-sim',{type:'org.bunny.reachy.control.requested',subject:'reachy-sim',dataschema:'https://bunny.invalid/events/reachy-control/2.0',
    data:{action:'enable-auto',expectedConfigurationRevision:state?.configurationRevision,expectedGeneration:state?.generation}},{requestId:id,timeoutMs:3000});
  assert.equal(enabled.status,'accepted');await clock.until(()=>state?.lastOutcome?.requestId===id);
  const event=(name:string,patch:Partial<CompanionOpportunity>={}):CompanionOpportunity=>({origin:{id:name,source:'bunny/core',type:'org.bunny.attention.raised'},sourceKind:'coding',context:'live',
    category:'coding-attention',cue:'approval',revision:session.revision,generation:session.generation,session:session.id,identity,turn:session.turn,attention:approval,noticeId:null,
    evidence:'lifecycle-metadata',occurredAtMs:null,observedAtMs:clock.now(),validUntilMs:clock.now()+30000,busy:null,media:null,visitor:null,location:null,...patch});
  const publish=async(data:CompanionOpportunity)=>{await core.publish('bunny.event.companion-opportunity.reachy',{kind:'occurrence',type:'org.bunny.companion-opportunity.raised',subject:'reachy',
    dataschema:'https://bunny.invalid/events/companion-opportunity/2.0',data});await clock.advance(30);};
  await publish(event('earlier-turn',{turn:{status:'known',id:'turn-1'},attention:{...approval,turn:{status:'known',id:'turn-1'}}}));
  assert.equal(dispatches,0,'an opportunity from a superseded turn no longer matches');
  await publish(event('waiting-approval'));
  await clock.until(()=>robot.state().moves>0);
  assert.equal(dispatches,1,'unconfirmed work alone does not refuse the waiting approval');
  assert.deepEqual(host.failures,[]);
});
