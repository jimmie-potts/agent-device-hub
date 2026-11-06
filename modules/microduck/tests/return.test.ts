import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {createMicroDuckModule} from '../src/module.js';
import {SimulatedMicroDuck} from '../src/simulated.js';
import {MICRODUCK_SIMULATED_SECTION as section} from '../src/registration.js';
import {schemaOf,typeOf,type MicroDuckState} from '../src/contracts.js';
import {TestClock} from './support.js';
/**
 * The return move must leave 800 to 900 ms after the first. A state commit that runs after the 800 ms timer spends
 * part of that 100 ms window (#1491), so the module saves the return phase before the wait. Here the commit that
 * saves the return phase costs 150 ms of the clock the test moves, as a slow disk or a stalled host would.
 */
void test('a slow return-phase commit is absorbed by the 800 ms hold, not the 100 ms return window',{timeout:10000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'microduck-return-')),clock=new TestClock(),bus=new InProcessBus({now:clock.now,scheduler:clock.scheduler}),core=bus.connect('bunny/core'),robot=new SimulatedMicroDuck(clock);
 const pause=(ms:number):Promise<void>=>clock.advance(ms),until=async(check:()=>boolean):Promise<void>=>{for(let n=0;n<800;n++){if(check())return;await pause(5);}assert.fail('missing evidence');};
 const mode:ModeState={id:'hub',revision:1,mode:'work',selectedAtMs:clock.now()},states:MicroDuckState[]=[];
 await core.serveSync(['session','mode'],()=>({revision:1,states:[{type:'org.bunny.mode.updated',subject:'hub',dataschema:schemaOf('mode'),data:mode}]}));
 await core.subscribe<MicroDuckState>('bunny.state.microduck-state.*',m=>{states.push(m.data);});
 const host=new ModuleHarness(createMicroDuckModule({transport:robot}),{bus,stateDir:dir,section,clock,scheduler:clock.scheduler});
 t.after(async()=>{await host.stop();await core.close();await rm(dir,{recursive:true,force:true});});await host.start();
 const state=():MicroDuckState|undefined=>states.at(-1),outcome=(id:string)=>[...states].reverse().find(s=>s.lastOutcome?.requestId===id)?.lastOutcome;
 const command=async(family:'microduck-control'|'microduck-gesture',data:object,requestId:string):Promise<void>=>{
  const answer=await core.request(`bunny.cmd.${family}.${section.id}`,{type:typeOf(family),subject:section.id,dataschema:schemaOf(family),data:{expectedConfigurationRevision:state()?.configurationRevision,expectedGeneration:state()?.generation,...data}},{requestId,timeoutMs:3000});
  assert.equal(answer.status,'accepted');await until(()=>outcome(requestId)!==undefined);
 };
 await until(()=>state()?.connection==='available');await pause(30);await command('microduck-control',{action:'takeover'},'takeover');
 const db=host.moduleDatabase();assert.ok(db);let slowCommits=0;
 db.function('slow_return_phase_commit',()=>{if(slowCommits++===0)clock.ms+=150;return null;});
 db.exec("CREATE TRIGGER slow_return_phase AFTER UPDATE ON microduck_state WHEN json_extract(new.record,'$.active.phase')='return' BEGIN SELECT slow_return_phase_commit(); END");
 await command('microduck-gesture',{gesture:'notice'},'slow-commit');
 assert.equal(slowCommits>0,true,'the return phase was saved through the slowed commit');
 assert.equal(outcome('slow-commit')?.result,'succeeded');assert.equal(outcome('slow-commit')?.evidence,'transmitted');assert.equal(state()?.held,null);
 assert.deepEqual(robot.effects.map(x=>x.yaw),[.1,0]);
 const [first,second]=robot.effects;assert.ok(first&&second);const delta=BigInt(second.atNs)-BigInt(first.atNs);
 assert.ok(delta>=800000000n&&delta<=900000000n,`return sent ${delta} ns after the first move`);
 assert.deepEqual(host.failures,[]);
});
