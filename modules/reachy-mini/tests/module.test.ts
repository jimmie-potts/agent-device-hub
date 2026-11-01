import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createReachyModule} from '../src/module.js';
import {SimulatedReachy} from '../src/simulated.js';
import {REACHY_SIMULATED_SECTION as section} from '../src/registration.js';
import {schemaOf, typeOf, type Family, type ReachyState} from '../src/contracts.js';
import type {ReachyTransport} from '../src/transport.js';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
async function until(check: () => boolean): Promise<void> {const end=Date.now()+4000;while(!check()){if(Date.now()>end)assert.fail('condition did not arrive');await pause(5);}}
async function fixture(t: TestContext, transport: ReachyTransport = new SimulatedReachy(), clock?: {now:()=>number}) {
  const dir=await mkdtemp(join(tmpdir(),'reachy-module-')),bus=new InProcessBus(clock===undefined?{}:{now:clock.now}),operator=bus.connect('bunny/parts/operator');
  const states: ReachyState[]=[];await operator.subscribe<ReachyState>('bunny.state.reachy-state.*',m=>{states.push(m.data);});
  let host=new ModuleHarness(createReachyModule({transport}),{bus,stateDir:dir,section,...(clock===undefined?{}:{clock})});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();
  const state=():ReachyState=>{const value=states.at(-1);assert.ok(value);return value;};
  const command=(family:Family,data:object={},requestId:string=crypto.randomUUID(),timeoutMs=3000)=>operator.request(`bunny.cmd.${family}.${section.id}`,{type:typeOf(family),subject:section.id,dataschema:schemaOf(family),data:{expectedConfigurationRevision:state().configurationRevision,expectedGeneration:state().generation,...data}},{requestId,timeoutMs});
  const outcome=(id:string):CompletedOutcome|undefined=>{const value=host.moduleDatabase()?.prepare('SELECT record FROM reachy_requests WHERE id=?').get(id);if(!value||typeof value.record!=='string')return undefined;return (JSON.parse(value.record) as {outcome?:CompletedOutcome}).outcome;};
  const takeover=async()=>{const id=crypto.randomUUID();assert.equal((await command('reachy-control',{action:'takeover'},id)).status,'accepted');await until(()=>outcome(id)!==undefined);};
  return {bus,command,state,outcome,takeover,get host(){return host;},async restart(){await host.stop();host=new ModuleHarness(createReachyModule({transport}),{bus,stateDir:dir,section,...(clock===undefined?{}:{clock})});await host.start();}};
}
void test('startup is passive; takeover gates finite gestures and duplicates never resend',{timeout:10000},async t=>{
  const robot=new SimulatedReachy(),f=await fixture(t,robot);await until(()=>f.state().connection==='available');assert.equal(robot.effects.length,0);assert.equal(f.state().enabled,false);
  const denied=await f.command('reachy-gesture',{gesture:'notice'});assert.equal('error'in denied&&denied.error.error.code,'invalid-state');
  await f.takeover();const id=crypto.randomUUID();assert.equal((await f.command('reachy-gesture',{gesture:'notice'},id)).status,'accepted');await until(()=>f.outcome(id)!==undefined);
  assert.deepEqual(robot.effects.filter(x=>x.kind==='move').map(x=>x.target),[[.2,-.2],[0,0]]);assert.equal(f.outcome(id)?.result,'succeeded');
  const duplicate=await f.command('reachy-gesture',{gesture:'notice'},id);assert.equal('error'in duplicate&&duplicate.error.error.code,'duplicate-conflict');assert.equal(robot.effects.length,2);
});
void test('priority stop cancels one owned UUID and fences the neutral stage',{timeout:10000},async t=>{
  const robot=new SimulatedReachy();robot.autoComplete=false;const f=await fixture(t,robot);await until(()=>f.state().connection==='available');await f.takeover();
  const id=crypto.randomUUID();await f.command('reachy-gesture',{gesture:'attention'},id);await until(()=>f.state().active?.moveId!=null&&robot.effects.length===1);
  const stop=crypto.randomUUID();await f.command('reachy-stop',{},stop);await until(()=>f.outcome(id)!==undefined&&f.outcome(stop)!==undefined);
  assert.equal(f.outcome(id)?.result,'failed');assert.equal(f.outcome(id)?.error?.code,'cancelled');assert.deepEqual(robot.effects.map(x=>x.kind),['move','cancel']);assert.equal(f.state().enabled,false);assert.equal(f.state().takeover,true);
});
void test('ambiguous UUID is held; unrelated controls preserve it and guarded recovery is explicit',{timeout:10000},async t=>{
  const robot=new SimulatedReachy();let lose=true;
  const transport:ReachyTransport={connect:(...a)=>robot.connect(...a),cancel:(...a)=>robot.cancel(...a),move:async(...a)=>{const id=await robot.move(...a);if(lose)throw new Error('synthetic lost UUID');return id;}};
  const f=await fixture(t,transport);await until(()=>f.state().connection==='available');await f.takeover();const id=crypto.randomUUID();await f.command('reachy-gesture',{gesture:'neutral'},id);await until(()=>f.state().held?.requestId===id);
  assert.equal(f.outcome(id)?.result,'uncertain');assert.equal(f.outcome(id)?.evidence,'none');await f.takeover();const disable=crypto.randomUUID();await f.command('reachy-control',{action:'disable-auto'},disable);await until(()=>f.outcome(disable)!==undefined);assert.equal(f.state().held?.requestId,id);
  assert.equal('error'in await f.command('reachy-stop',{recovered:true,heldRequestId:id,expectedConfigurationRevision:1,expectedGeneration:f.state().generation}),true);
  assert.equal('error'in await f.command('reachy-gesture',{gesture:'neutral',recovered:true,heldRequestId:id,expectedConfigurationRevision:0,expectedGeneration:f.state().generation}),true);assert.equal(f.state().held?.requestId,id);
  lose=false;const recovery=crypto.randomUUID();await f.command('reachy-gesture',{gesture:'neutral',recovered:true,heldRequestId:id,expectedConfigurationRevision:1,expectedGeneration:f.state().generation},recovery);await until(()=>f.outcome(recovery)!==undefined);
  assert.equal(f.outcome(recovery)?.result,'succeeded');assert.equal(f.state().held,null);assert.deepEqual(f.state().lastRecovery,{requestId:recovery,heldRequestId:id});assert.equal(f.outcome(id)?.result,'uncertain');assert.equal(robot.effects.filter(x=>x.kind==='move').length,2);
});
void test('concurrent gestures admit one responsibility and restart never replays it',{timeout:10000},async t=>{
  const robot=new SimulatedReachy();robot.autoComplete=false;const f=await fixture(t,robot);await until(()=>f.state().connection==='available');await f.takeover();
  const answers=await Promise.all([f.command('reachy-gesture',{gesture:'notice'}),f.command('reachy-gesture',{gesture:'attention'})]);assert.equal(answers.filter(x=>x.status==='accepted').length,1);await until(()=>robot.effects.length===1);
  await f.restart();await until(()=>f.state().connection==='available');assert.equal(robot.effects.filter(x=>x.kind==='move').length,1);assert.equal(f.state().takeover,true);
});
void test('deadline during first stage cancels without sending the second stage',{timeout:10000},async t=>{
  const robot=new SimulatedReachy();robot.autoComplete=false;const f=await fixture(t,robot);await until(()=>f.state().connection==='available');await f.takeover();const id=crypto.randomUUID();await f.command('reachy-gesture',{gesture:'notice'},id,100);await until(()=>f.outcome(id)!==undefined);
  assert.equal(f.outcome(id)?.error?.code,'expired');assert.deepEqual(robot.effects.map(x=>x.kind),['move','cancel']);
});
void test('lost observation cancels work and reconnect never replays motion',{timeout:10000},async t=>{
  const robot=new SimulatedReachy();robot.autoComplete=false;const f=await fixture(t,robot);await until(()=>f.state().connection==='available');await f.takeover();const id=crypto.randomUUID();await f.command('reachy-gesture',{gesture:'notice'},id);await until(()=>robot.effects.length===1);robot.observer?.lost();await until(()=>f.outcome(id)!==undefined);
  assert.equal(robot.effects.filter(x=>x.kind==='move').length,1);assert.equal(robot.effects.filter(x=>x.kind==='cancel').length,1);await until(()=>f.state().connection==='available');assert.equal(robot.effects.filter(x=>x.kind==='move').length,1);
});
void test('external auto, raw poses and unknown controls refuse',{timeout:10000},async t=>{
  const robot=new SimulatedReachy(),f=await fixture(t,robot);await until(()=>f.state().connection==='available');
  for(const [family,data] of [['reachy-auto',{gesture:'notice',opportunityId:'a'.repeat(64)}],['reachy-gesture',{gesture:'neutral',antennas:[1,1]}],['reachy-control',{action:'wake'}]] as const)assert.equal('error'in await f.command(family,data),true);assert.equal(robot.effects.length,0);
});

void test('a fake clock expiring after a stage preserves its effect and fences the next stage',{timeout:10000},async t=>{
 let now=Date.now();const robot=new SimulatedReachy();
 const transport:ReachyTransport={connect:(...a)=>robot.connect(...a),cancel:(...a)=>robot.cancel(...a),move:async(...a)=>{const id=await robot.move(...a);now+=500;return id;}};
 const f=await fixture(t,transport,{now:()=>now});await until(()=>f.state().connection==='available');await f.takeover();const id=crypto.randomUUID();await f.command('reachy-gesture',{gesture:'notice'},id,200);await until(()=>f.outcome(id)!==undefined);
 assert.equal(f.outcome(id)?.error?.code,'expired');assert.equal(f.outcome(id)?.evidence,'transmitted');assert.equal(robot.state().moves,1);
});
void test('failed responsibility persistence refuses before transport effects',{timeout:10000},async t=>{
 const robot=new SimulatedReachy(),f=await fixture(t,robot);await until(()=>f.state().connection==='available');await f.takeover();
 f.host.moduleDatabase()?.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON reachy_requests BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
 const answer=await f.command('reachy-gesture',{gesture:'neutral'});assert.equal('error'in answer,true);assert.equal(robot.effects.length,0);
});
void test('unfinished durable write is classified uncertain on restart without reconstructing movement',{timeout:10000},async t=>{
 const robot=new SimulatedReachy(),f=await fixture(t,robot);await until(()=>f.state().connection==='available');
 const id='unfinished-write';f.host.moduleDatabase()?.prepare('INSERT INTO reachy_requests VALUES(?,?)').run(id,JSON.stringify({requestId:id,family:'reachy-gesture',digest:'a'.repeat(64),traceparent:'00-11111111111111111111111111111111-1111111111111111-01',started:true,moveId:null}));
 await f.restart();await until(()=>f.state().held?.requestId===id);assert.equal(f.outcome(id)?.result,'uncertain');assert.equal(robot.effects.length,0);
});

for(const gesture of ['attention','neutral'] as const)void test(`manual ${gesture} uses only its accepted catalog stages`,{timeout:10000},async t=>{
 const robot=new SimulatedReachy(),f=await fixture(t,robot);await until(()=>f.state().connection==='available');await f.takeover();const id=crypto.randomUUID();await f.command('reachy-gesture',{gesture},id);await until(()=>f.outcome(id)!==undefined);assert.equal(f.outcome(id)?.result,'succeeded');assert.deepEqual(robot.effects.map(x=>x.target),gesture==='attention'?[[.2,.2],[0,0]]:[[0,0]]);
});

void test('Stop and Resume with one old generation cannot clear the Stop latch',{timeout:10000},async t=>{
 const robot=new SimulatedReachy(),f=await fixture(t,robot),core=f.bus.connect('bunny/core');t.after(()=>core.close());
 await core.serveSync(['session','mode'],()=>({revision:1,states:[{type:'org.bunny.mode.updated',subject:'hub',dataschema:'https://bunny.invalid/events/mode/2.0',data:{id:'hub',revision:1,mode:'work',selectedAtMs:Date.now()}}]}));
 await until(()=>f.state().connection==='available');await pause(30);const generation=structuredClone(f.state().generation),stop='racing-stop',resume='racing-resume';
 const answers=await Promise.all([f.command('reachy-stop',{expectedGeneration:generation},stop),f.command('reachy-control',{action:'resume-auto',expectedGeneration:generation},resume)]);
 await until(()=>f.outcome(stop)!==undefined&&(answers[1]?.status!=='accepted'||f.outcome(resume)!==undefined));assert.equal(f.state().enabled,false);assert.equal(f.state().takeover,true);
});
void test('ordinary Takeover never sends to a stored held UUID without guarded recovery',{timeout:10000},async t=>{
 const robot=new SimulatedReachy(),f=await fixture(t,robot);await until(()=>f.state().connection==='available');const db=f.host.moduleDatabase();assert.ok(db);
 const saved=structuredClone(f.state());saved.held={requestId:'held-original',heldAtMs:Date.now(),moveId:'12345678-1234-1234-1234-123456789abc'};saved.takeover=true;saved.enabled=false;db.prepare('UPDATE reachy_state SET record=? WHERE id=1').run(JSON.stringify(saved));
 await f.restart();await until(()=>f.state().connection==='available'&&f.state().held?.requestId==='held-original');await f.takeover();assert.equal(robot.effects.length,0);assert.equal(f.state().held?.requestId,'held-original');
});
