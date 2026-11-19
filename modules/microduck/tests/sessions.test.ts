// MicroDuck reads each session through the shared read function and adds only its own device conditions (Hub #1865,
// task 4.4). Other sessions do not matter: the blanket session-count rule is gone (owner decision 3 of 2026-11-16).
// Everything runs on the test clock, so no case waits on real time.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {sessionEntityId,type Identity,type ModeState,type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession,SESSION_SCHEMA} from '@jimmie-potts/event-contracts/v2/session';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {createMicroDuckModule} from '../src/module.js';
import {SimulatedMicroDuck} from '../src/simulated.js';
import {MICRODUCK_SIMULATED_SECTION as section} from '../src/registration.js';
import {schemaOf,type MicroDuckState} from '../src/contracts.js';
import {TestClock,advanceUntil} from './support.js';

const identity=(name:string):Identity=>({provider:'codex',client:'desktop',hostId:'synthetic-host',sourceId:'synthetic-source',sessionId:`synthetic-${name}`});
const record=(name:string,clock:TestClock,unconfirmed?:'restart'):Session30Record=>buildSession({...(unconfirmed===undefined?{}:{unconfirmed}),id:sessionEntityId(identity(name)),revision:1,generation:1,identity:identity(name),parent:{status:'top-level'},
  turn:{status:'known',id:`turn-${name}`},work:'active',attention:[{id:{status:'known',id:`question-${name}`},kind:'question',turn:{status:'known',id:`turn-${name}`}}],
  notices:[],read:'unknown',unavailable:[],ordering:{status:'unknown'},observedAtMs:clock.now(),lastEvidenceAtMs:clock.now(),children:{working:0,unconfirmed:0}});

void test('MicroDuck gestures for one matching session among several, and not for a mismatched generation, a cleared item, an expired opportunity, Quiet or takeover',{timeout:10000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'microduck-sessions-')),clock=new TestClock(),bus=new InProcessBus({now:clock.now,scheduler:clock.scheduler}),core=bus.connect('bunny/core'),robot=new SimulatedMicroDuck(clock);
  const sessions=['one','two','three'].map(name=>record(name,clock));
  // A second session's work is unconfirmed after a restart: other sessions' state never refuses a match.
  sessions[2]=record('three',clock,'restart');
  const target=sessions[1] as Session30Record;
  let mode:ModeState={id:'hub',revision:1,mode:'work',selectedAtMs:clock.now()},state:MicroDuckState|undefined,dispatches=0;
  await core.serveSync(['session','mode'],()=>({revision:mode.revision,states:[{type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode},
    ...sessions.map(s=>({type:'org.bunny.session.updated',subject:s.id,dataschema:SESSION_SCHEMA,data:s}))]}));
  await core.subscribe<MicroDuckState>('bunny.state.microduck-state.*',m=>{state=m.data;});
  await core.respond<Record<string,unknown>&{requestId:string;target:string}>('bunny.cmd.microduck-dispatch.microduck',async c=>{dispatches++;const {target:subject,...data}=c.data;
    const r=await core.request(`bunny.cmd.microduck-auto.${subject}`,{type:'org.bunny.microduck.auto.requested',subject,dataschema:'https://bunny.invalid/events/microduck-auto/2.0',data},{requestId:c.data.requestId,timeoutMs:3000});
    return r.status==='accepted'?{status:'accepted'}:{error:{code:'internal',retryable:false}};});
  const host=new ModuleHarness(createMicroDuckModule({transport:robot}),{bus,stateDir:dir,section,clock,scheduler:clock.scheduler});
  t.after(async()=>{await host.stop();await core.close();await rm(dir,{recursive:true,force:true});});
  await host.start();await advanceUntil(clock,()=>state?.connection==='available');await clock.advance(30);
  const control=async(action:string)=>{const id=crypto.randomUUID();
    const r=await core.request('bunny.cmd.microduck-control.microduck-sim',{type:'org.bunny.microduck.control.requested',subject:'microduck-sim',dataschema:'https://bunny.invalid/events/microduck-control/2.0',
      data:{action,expectedConfigurationRevision:state?.configurationRevision,expectedGeneration:state?.generation}},{requestId:id,timeoutMs:3000});
    assert.equal(r.status,'accepted');await advanceUntil(clock,()=>state?.lastOutcome?.requestId===id);};
  const setMode=async(value:ModeState['mode'])=>{mode={...mode,revision:mode.revision+1,mode:value};
    await core.publish('bunny.state.mode.hub',{kind:'state',type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode});await clock.advance(30);};
  const event=(name:string,patch:Partial<CompanionOpportunity>={}):CompanionOpportunity=>({origin:{id:name,source:'bunny/core',type:'org.bunny.attention.raised'},sourceKind:'coding',context:'live',
    category:'coding-attention',cue:'question',revision:target.revision,generation:target.generation,session:target.id,identity:target.identity,turn:target.turn,attention:target.attention.items[0]??null,
    noticeId:null,evidence:'lifecycle-metadata',occurredAtMs:null,observedAtMs:clock.now(),validUntilMs:clock.now()+30000,busy:null,media:null,visitor:null,location:null,...patch});
  const publish=async(data:CompanionOpportunity)=>{await core.publish('bunny.event.companion-opportunity.reachy',{kind:'occurrence',type:'org.bunny.companion-opportunity.raised',subject:'reachy',
    dataschema:'https://bunny.invalid/events/companion-opportunity/2.0',data});await clock.advance(60);};
  await control('enable-auto');
  await publish(event('other-generation',{generation:target.generation+1}));assert.equal(dispatches,0,'a mismatched generation');
  await publish(event('cleared-item',{attention:{id:{status:'known',id:'answered'},kind:'question',turn:target.turn}}));assert.equal(dispatches,0,'a cleared attention item');
  await publish(event('expired',{observedAtMs:clock.now()-31000,validUntilMs:clock.now()-1000}));assert.equal(dispatches,0,'an expired opportunity');
  await setMode('quiet');await publish(event('quiet'));assert.equal(dispatches,0,'Quiet');await setMode('work');
  await control('takeover');await publish(event('takeover'));assert.equal(dispatches,0,'takeover');await control('resume-auto');
  assert.equal(robot.state().moves,0);
  await publish(event('matching'));
  await advanceUntil(clock,()=>robot.state().moves>0);
  assert.equal(dispatches,1,'one matching session among several gestures');
  assert.deepEqual(host.failures,[]);
});
