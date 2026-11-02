import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {fixture} from './support.js';
import {SimulatedMicroDuck} from '../src/simulated.js';
void test('two fresh sessions suppress a live opportunity without a second status reducer',{timeout:10000},async t=>{
  const robot=new SimulatedMicroDuck(),f=await fixture(t,robot),now=Date.now();
  const session:SessionRecord={id:'one',revision:1,generation:1,identity:{provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',sessionId:'one'},parent:{status:'top-level'},turn:{status:'unknown'},activity:'active',attention:[{id:{status:'known',id:'question'},kind:'question',turn:{status:'unknown'}}],notices:[],read:'unknown',unavailable:[],ordering:{status:'unknown'},observedAtMs:now,lastEvidenceAtMs:now,freshness:'current',restartUncertain:false,children:{active:0,uncertain:0}};
  await f.sessions([session,{...session,id:'two',identity:{...session.identity,sessionId:'two'}}]);await f.control('enable-auto');
  let dispatches=0;await f.core.respond('bunny.cmd.microduck-dispatch.microduck',()=>{dispatches++;return {status:'accepted'};});
  const event:CompanionOpportunity={origin:{id:'two-sessions',source:'bunny/core',type:'org.bunny.attention.raised'},sourceKind:'coding',context:'live',category:'coding-attention',cue:'question',revision:1,generation:1,session:session.id,identity:session.identity,turn:session.turn,attention:session.attention[0]??null,noticeId:null,evidence:'lifecycle-metadata',occurredAtMs:now,observedAtMs:now,validUntilMs:now+5000,busy:null,media:null,visitor:null,location:null};
  await f.core.publish('bunny.event.companion-opportunity.reachy',{kind:'occurrence',type:'org.bunny.companion-opportunity.raised',subject:'reachy',dataschema:'https://bunny.invalid/events/companion-opportunity/2.0',data:event});await pause(100);
  assert.equal(dispatches,0);assert.equal(robot.effects.length,0);
});
