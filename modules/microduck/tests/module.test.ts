import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {SimulatedMicroDuck} from '../src/simulated.js';
import type {MicroDuckTransport} from '../src/transport.js';
import {TestClock,advanceUntil,fixture,until} from './support.js';
function adapter(robot:SimulatedMicroDuck,head:MicroDuckTransport['head']):MicroDuckTransport{return {connect:(...a)=>robot.connect(...a),guard:()=>robot.guard(),nowNs:()=>robot.nowNs(),head};}
/**
 * A gesture's return must be sent 800 to 900 ms after its first move (#1491). On the real clock, a host stall of more
 * than 100 ms across the end of the 800 ms hold made the module rightly refuse the late return, so the outcome was
 * `uncertain` and only one move was written (#1720). These tests check what a gesture writes, not how a loaded host
 * keeps time, so the module, the bus and the simulator share a test clock that moves only when the test moves it.
 */
for(const gesture of ['notice','attention','neutral'] as const)void test(`passive startup and finite manual ${gesture}`,{timeout:10000},async t=>{
  const clock=new TestClock(),robot=new SimulatedMicroDuck(clock),f=await fixture(t,robot,clock);assert.equal(robot.state().moves,0);assert.equal(f.state().enabled,false);
  assert.equal('error'in await f.command('microduck-gesture',{gesture}),true);
  await f.control('takeover');const id=crypto.randomUUID();assert.equal((await f.command('microduck-gesture',{gesture},id)).status,'accepted');await advanceUntil(clock,()=>f.outcome(id)!==undefined);
  assert.equal(f.outcome(id)?.result,'succeeded');assert.deepEqual(robot.effects.map(x=>x.yaw),gesture==='neutral'?[0]:[gesture==='notice'?.1:-.1,0]);
  if(robot.effects.length===2){const first=robot.effects[0],second=robot.effects[1];assert.ok(first&&second);const delta=BigInt(second.atNs)-BigInt(first.atNs);assert.ok(delta>=800000000n&&delta<=900000000n);}
  const duplicate=await f.command('microduck-gesture',{gesture},id);assert.equal('error'in duplicate&&duplicate.error.error.code,'duplicate-conflict');
});
/**
 * Stop must not wait on the vendor's reply, the hold or any module timer. The module, the bus and the simulator share
 * a test clock that stands still from the Stop to both outcomes, so a Stop that waited on the reply or on any timer
 * of the module's scheduler, however short, never finishes and fails at `until`'s limit. The earlier bound was 500 ms
 * of real time, which a host stall after the Stop broke although the module waited on nothing (#2095). A wait on a
 * timer outside the scheduler is caught only past `until`'s 4 s.
 */
void test('Stop completes while a vendor reply is pending and never writes neutral',{timeout:10000},async t=>{
  const clock=new TestClock(),robot=new SimulatedMicroDuck(clock);const f=await fixture(t,adapter(robot,async(yaw,signal,before)=>{await robot.head(yaw,signal,before);await new Promise<void>((_resolve,reject)=>{signal.addEventListener('abort',()=>{reject(new Error('synthetic reply ended'));},{once:true});});}),clock);
  await f.control('takeover');const id='pending-head';await f.command('microduck-gesture',{gesture:'notice'},id);await until(()=>robot.effects.length===1);
  const start=clock.now(),stop='priority-stop';assert.equal((await f.command('microduck-stop',{},stop)).status,'accepted');await until(()=>f.outcome(stop)!==undefined&&f.outcome(id)!==undefined);
  assert.equal(clock.now(),start,'Stop finished without the clock moving');assert.equal(f.outcome(stop)?.result,'succeeded');assert.equal(f.outcome(id)?.result,'uncertain');assert.equal(f.state().latched,true);assert.deepEqual(robot.effects.map(x=>x.yaw),[.1]);
});
/**
 * Recovery needs two advancing zero-input samples within 800 ms of its send, and the sensor freshness limit is 500 ms.
 * On the real clock a host stall after the recovery's send aged the samples past either bound (#2095), so the module,
 * the bus and the simulator share a test clock.
 */
void test('lost reply is held; only a new exact acknowledged neutral clears it',{timeout:10000},async t=>{
  const clock=new TestClock(),robot=new SimulatedMicroDuck(clock),f=await fixture(t,robot,clock);await f.control('takeover');robot.loseReply=true;
  await f.command('microduck-gesture',{gesture:'neutral'},'lost-one');await until(()=>f.state().held?.requestId==='lost-one');assert.equal(f.outcome('lost-one')?.result,'uncertain');
  await f.control('takeover');await f.control('disable-auto');assert.equal(f.state().held?.requestId,'lost-one');
  for(const data of [{gesture:'neutral'},{gesture:'notice',recovered:true,heldRequestId:'lost-one'},{gesture:'neutral',recovered:true,heldRequestId:'other'},{gesture:'neutral',recovered:true,heldRequestId:'lost-one',expectedConfigurationRevision:0}])assert.equal('error'in await f.command('microduck-gesture',data),true);
  await f.command('microduck-gesture',{gesture:'neutral',recovered:true,heldRequestId:'lost-one'},'lost-two');await until(()=>f.state().held?.requestId==='lost-two');
  robot.loseReply=false;await f.command('microduck-gesture',{gesture:'neutral',recovered:true,heldRequestId:'lost-two'},'recover');await advanceUntil(clock,()=>f.outcome('recover')!==undefined);
  assert.equal(f.state().held,null);assert.deepEqual(f.state().lastRecovery,{requestId:'recover',heldRequestId:'lost-two'});assert.equal(f.outcome('lost-one')?.result,'uncertain');assert.equal(f.outcome('lost-two')?.result,'uncertain');assert.equal(f.state().latched,true);
});
/**
 * Staleness and reconnection run on the module's 500 ms freshness timer and its reconnect backoff, and the check that
 * no write follows the revoked gesture waits 700 ms. On a shared test clock a host stall neither ages the sensor
 * evidence nor shortens that wait (#2095).
 */
void test('coasted timestamps and changed sessions revoke admission without replay',{timeout:10000},async t=>{
  const clock=new TestClock(),robot=new SimulatedMicroDuck(clock),f=await fixture(t,robot,clock);robot.coasting=true;await advanceUntil(clock,()=>f.state().connection!=='available');assert.equal('error'in await f.command('microduck-control',{action:'resume-auto'}),true);
  robot.coasting=false;await advanceUntil(clock,()=>f.state().connection==='available');await f.control('takeover');await f.command('microduck-gesture',{gesture:'attention'},'session-change');await until(()=>robot.effects.length===1);robot.session=crypto.randomUUID();
  await advanceUntil(clock,()=>f.outcome('session-change')!==undefined);assert.equal(f.outcome('session-change')?.result,'uncertain');await clock.advance(700);assert.equal(robot.effects.length,1);
});
/**
 * Each fence must land after a first move is sent and before its 800 ms return (#1471): Quiet, and the 100 ms deadline
 * of the 'expired' command. On the real clock, a host stall between that command and its send passed the deadline
 * first, so the module rightly refused the send and the outcome was `failed`. Here the module, the bus and the
 * simulator share a clock that stands still until the test sees each send, and only then moves past the fence.
 */
void test('Quiet, expiry and stale generation fence the return rather than clean up',{timeout:15000},async t=>{
  const clock=new TestClock(),robot=new SimulatedMicroDuck(clock),f=await fixture(t,robot,clock);await f.control('takeover');await f.command('microduck-gesture',{gesture:'notice'},'quiet');await until(()=>robot.effects.length===1);await f.mode('quiet');await until(()=>f.outcome('quiet')!==undefined);assert.equal(f.outcome('quiet')?.result,'uncertain');assert.equal(robot.effects.length,1);
  await f.mode('work');assert.equal('error'in await f.command('microduck-gesture',{gesture:'neutral',expectedGeneration:{epoch:'old',sequence:0}}),true);
  await f.command('microduck-gesture',{gesture:'neutral',recovered:true,heldRequestId:'quiet'},'recovery');await advanceUntil(clock,()=>f.outcome('recovery')!==undefined);
  await clock.advance(2100);assert.equal((await f.command('microduck-gesture',{gesture:'attention'},'expired',100)).status,'accepted');await until(()=>robot.effects.length===3||f.outcome('expired')!==undefined);await advanceUntil(clock,()=>f.outcome('expired')!==undefined);assert.equal(f.outcome('expired')?.result,'uncertain');assert.equal(robot.effects.at(-1)?.yaw,-.1);
});
/** On the test clock for the same reason as the manual gestures: the accepted gesture's return counts as the second write. */
void test('concurrent admission, cooldown and forbidden operations do not add writes',{timeout:10000},async t=>{
  const clock=new TestClock(),robot=new SimulatedMicroDuck(clock),f=await fixture(t,robot,clock);await f.control('takeover');
  const answers=await Promise.all([f.command('microduck-gesture',{gesture:'notice'},'a'),f.command('microduck-gesture',{gesture:'attention'},'b')]);assert.equal(answers.filter(x=>x.status==='accepted').length,1);await advanceUntil(clock,()=>f.state().active===null);
  assert.equal('error'in await f.command('microduck-gesture',{gesture:'attention'}),true);
  for(const data of [{gesture:'walk'},{gesture:'neutral',yaw:1},{gesture:'neutral',endpoint:'/tmp/socket'}])assert.equal('error'in await f.command('microduck-gesture',data),true);
  assert.equal('error'in await f.command('microduck-auto',{gesture:'notice',opportunityId:'a'.repeat(64),validUntilMs:clock.now()+5000}),true);assert.equal(robot.effects.length,2);
});
void test('failed persistence refuses before effects and restart reports possible writes only',{timeout:10000},async t=>{
  const robot=new SimulatedMicroDuck(),f=await fixture(t,robot);await f.control('takeover');const db=f.host.moduleDatabase();assert.ok(db);
  db.prepare('INSERT INTO microduck_requests VALUES(?,?)').run('unfinished',JSON.stringify({requestId:'unfinished',family:'microduck-gesture',digest:'a'.repeat(64),traceparent:'00-11111111111111111111111111111111-1111111111111111-01',started:true}));
  await f.restart();await until(()=>f.state().held?.requestId==='unfinished');assert.equal(f.outcome('unfinished')?.result,'uncertain');assert.equal(robot.effects.length,0);
  f.host.moduleDatabase()?.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON microduck_requests BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.equal('error'in await f.command('microduck-stop'),true);assert.equal(robot.effects.length,0);
});
void test('Stop and stale Resume cannot clear the latch; enable-auto selects only preference',{timeout:10000},async t=>{
  const robot=new SimulatedMicroDuck(),f=await fixture(t,robot),generation=structuredClone(f.state().generation);
  const answers=await Promise.all([f.command('microduck-stop',{},'stop'),f.command('microduck-control',{action:'resume-auto',expectedGeneration:generation},'resume')]);
  await until(()=>f.outcome('stop')!==undefined&&(answers[1]?.status!=='accepted'||f.outcome('resume')!==undefined));assert.equal(f.state().latched,true);assert.equal(f.state().takeover,true);
  await f.control('enable-auto');assert.equal(f.state().latched,true);assert.equal(f.state().takeover,true);await f.control('resume-auto');assert.equal(f.state().latched,false);assert.equal(f.state().takeover,false);assert.equal(robot.effects.length,0);
});
void test('a missed return window becomes held instead of sending late cleanup',{timeout:10000},async t=>{
  const robot=new SimulatedMicroDuck();let first=true;
  const f=await fixture(t,adapter(robot,async(yaw,signal,before)=>{await robot.head(yaw,signal,before);if(first){first=false;await pause(950);}}));
  await f.control('takeover');await f.command('microduck-gesture',{gesture:'notice'},'late-return');await until(()=>f.outcome('late-return')!==undefined);
  assert.equal(f.outcome('late-return')?.result,'uncertain');assert.deepEqual(robot.effects.map(x=>x.yaw),[.1]);assert.equal(f.state().held?.requestId,'late-return');
});
