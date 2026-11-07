import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SimulatedMicroDuck} from '../src/simulated.js';
import type {MicroDuckState} from '../src/contracts.js';
import {TestClock,advanceUntil,fixture} from './support.js';
/** A stored state without the parts that only observation commits change. */
const program=(record:string):string=>{const {observation:_observation,revision:_revision,...rest}=JSON.parse(record) as MicroDuckState;return JSON.stringify(rest);};
/**
 * The return move must leave 800 to 900 ms after the first. A state commit that runs after the 800 ms timer spends
 * part of that 100 ms window (#1491), so the module saves the pending return before the hold and makes no commit
 * before the return is sent. Here every commit the gesture itself makes while only its first move is out costs 150 ms
 * of the clock the test moves, as a slow disk or a stalled host would. Observation commits keep their cost, so the
 * test times the program's own commits only.
 */
void test('slow program commits are absorbed by the 800 ms hold, which stays outbound, not by the 100 ms return window',{timeout:10000},async t=>{
 const clock=new TestClock(),robot=new SimulatedMicroDuck(clock),f=await fixture(t,robot,clock);await f.control('takeover');
 const db=f.host.moduleDatabase();assert.ok(db);let slowCommits=0;
 db.function('slow_program_commit',(before:unknown,after:unknown)=>{
  if(robot.effects.length===1&&typeof before==='string'&&typeof after==='string'&&program(before)!==program(after)){slowCommits++;clock.ms+=150;}
  return null;
 });
 db.exec('CREATE TRIGGER slow_program AFTER UPDATE ON microduck_state BEGIN SELECT slow_program_commit(old.record,new.record); END');
 const id='slow-commit';assert.equal((await f.command('microduck-gesture',{gesture:'notice'},id)).status,'accepted');
 await advanceUntil(clock,()=>f.outcome(id)!==undefined,4000);
 assert.equal(slowCommits>0,true,'a program commit ran while the first move was out');
 assert.equal(f.outcome(id)?.result,'succeeded');assert.equal(f.outcome(id)?.evidence,'transmitted');assert.equal(f.state().held,null);
 assert.deepEqual(robot.effects.map(x=>x.yaw),[.1,0]);
 const [first,second]=robot.effects;assert.ok(first&&second);const delta=BigInt(second.atNs)-BigInt(first.atNs);
 assert.ok(delta>=800000000n&&delta<=900000000n,`return sent ${delta} ns after the first move`);
 const mine=f.states.filter(s=>s.active?.requestId===id),returnSentMs=Number(BigInt(second.atNs)/1000000n);
 assert.ok(mine.some(s=>s.active?.phase==='outbound'&&s.lastTransmission.status==='known'&&s.lastTransmission.requestId===id),'the hold after the first move is published as outbound');
 const returning=mine.filter(s=>s.active?.phase==='return');assert.ok(returning.length>0,'the return phase is published');
 for(const s of returning)assert.ok(s.lastTransmission.status==='known'&&s.lastTransmission.requestId===id&&s.lastTransmission.transmittedAtMs>=returnSentMs,'the return phase is published only once the return is sent');
 assert.deepEqual(f.host.failures,[]);
});
