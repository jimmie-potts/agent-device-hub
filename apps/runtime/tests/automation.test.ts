import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {AutomationError, createAutomation, DEFAULT_SETTINGS, DEFAULT_INTERRUPT_SET, parseEvent} from '../src/core/automation.js';
import {AutomationStore} from '../src/core/automation-store.js';

const rule = {name:'Turn complete',kind:'event',enabled:true,trigger:{source:'core',kind:'turn-ended'},
  action:{mood:'celebrate',priorityClass:'flourish',durationMs:1000,targets:['lines']}};
const event = {id:'occurrence-1',source:'core',kind:'turn-ended',delivery:'live',agent:'agent-1',task:'turn-1'};
function world(db = new DatabaseSync(':memory:'), uncertain=false,presentation:'status'|'content'='content') {
  const sent: {target:string; moment:unknown}[] = [];
  const store = new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const automation = createAutomation({store,routed:()=>['lines'],targets:()=>Promise.resolve({presentation,alert:'none',moments:'supported'}),
    clock:()=>1700000000000,monotonic:()=>1700000000000,active:()=>true,
    sender:(target,moment)=>{sent.push({target,moment});return Promise.resolve(uncertain?{kind:'uncertain',momentId:moment.momentId,requestId:'req-one'}:{kind:'receipt',momentId:moment.momentId,requestId:'req-one',status:'accepted'});}});
  return {db,sent,automation};
}

void test('queued trace context is validated, copied per event and excluded from public event and moment data',async()=>{
  const db=new DatabaseSync(':memory:');
  const store=new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const sent:{moment:unknown;parent:string|undefined}[]=[];
  let release:()=>void=()=>{},reads=0;
  const target={presentation:'content',alert:'none',moments:'supported'} as const;
  const pending=new Promise<typeof target>(resolve=>{release=()=>{resolve(target);};});
  const automation=createAutomation({store,routed:()=>['lines'],targets:()=>++reads===1?pending:Promise.resolve(target),
    clock:()=>1700000000000,monotonic:()=>1700000000000,active:()=>true,sender:(_target,moment,parent)=>{
      sent.push({moment,parent:parent?.traceparent});return Promise.resolve({kind:'receipt',momentId:moment.momentId,status:'accepted',requestId:`req-${sent.length}`});
    }});
  const first={traceparent:'00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'};
  const second={traceparent:'00-123456789abcdef0123456789abcdef0-123456789abcdef0-01'},secondTrace=second.traceparent;
  try {
    automation.create({...rule,action:{...rule.action,priorityClass:'event'}},true);
    assert.equal(automation.submit(event,first).accepted,true);
    assert.equal(automation.submit({...event,id:'queued-two'},second).accepted,true);
    second.traceparent='invalid';
    assert.equal(automation.submit({...event,id:'queued-invalid'},{traceparent:'invalid'}).accepted,true);
    release();await automation.settled();
    assert.deepEqual(sent.map(item=>item.parent),[first.traceparent,secondTrace,undefined]);
    assert.equal(JSON.stringify(sent.map(item=>item.moment)).includes(first.traceparent),false);
    assert.equal(JSON.stringify(automation.log(10)).includes(secondTrace),false);
    assert.equal(parseEvent({...event,traceparent:first.traceparent}),null,'trace metadata does not extend the event contract');
  }finally {release();await automation.close();db.close();}
});

void test('one matching rule dispatches once, keeps acceptance distinct, and restart/replay cannot redispatch',async()=>{
  const w=world();
  try {
    w.automation.create(rule,true);
    assert.deepEqual(w.automation.submit(event),{accepted:true,matched:1});
    await w.automation.settled();
    assert.equal(w.sent.length,1);
    assert.equal(w.automation.log(10)[0]?.receipt?.status,'accepted');
    assert.equal(w.automation.log(10)[0]?.requestId,'req-one');
    await w.automation.close();
    const restarted=world(w.db);
    assert.deepEqual(restarted.automation.submit(event),{accepted:false,reason:'duplicate'});
    assert.deepEqual(restarted.automation.submit({...event,id:'sync-copy',delivery:'replay'}),{accepted:false,reason:'replay'});
    await restarted.automation.settled();assert.equal(restarted.sent.length,0);
    await restarted.automation.close();
  } finally {w.db.close();}
});

void test('policy retains quiet-hours and task budget, and non-owner rules start disabled',async()=>{
  const w=world();
  try {
    assert.equal(w.automation.create(rule,false).enabled,false);
    w.automation.create(rule,true);
    w.automation.replaceSettings({...DEFAULT_SETTINGS,quietHours:{enabled:true,start:'00:00',end:'00:00',timeZone:'UTC'}});
    w.automation.submit(event);await w.automation.settled();
    assert.equal(w.sent.length,0);assert.equal(w.automation.log(10)[0]?.reason,'quiet-hours');
    w.automation.replaceSettings(DEFAULT_SETTINGS);
    w.automation.submit({...event,id:'new-live'});await w.automation.settled();
    w.automation.submit({...event,id:'same-task'});await w.automation.settled();
    assert.equal(w.sent.length,1);assert.equal(w.automation.log(10)[0]?.reason,'agent-task-budget');
    await w.automation.close();
  }finally {w.db.close();}
});

import {InProcessBus, traceFields} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCoreModule,type CoreHandle} from '../src/core/core.js';
import {deviceRecord,deviceState} from './fixtures/device.js';
import {observation,sessionStarted,turnStarted,turnEnded} from './fixtures/agents.js';
import {manualClock,stateDir,flush} from './support.js';
import type {Message} from '@jimmie-potts/event-contracts/v2';

void test('automation controls can be captured before start and follow the current core lifecycle',async context=>{
  const directory=await stateDir(context),core=createCoreModule();
  // Hosts and fixtures copy a module before its start hook runs.
  const hosted={...core},controls=hosted.automation;
  const unavailable=(error:unknown):boolean=>error instanceof AutomationError && error.code==='unavailable' && error.status===503;
  assert.throws(()=>controls.rules(),unavailable);
  assert.throws(()=>controls.create(rule,true),unavailable);
  let harness=new ModuleHarness(hosted,{stateDir:directory,bus:new InProcessBus()});
  context.after(()=>harness.stop());
  await harness.start();
  hosted.setModeParticipants([{id:'lines',kind:'nanoleaf'}]);
  const created=controls.create(rule,true);
  controls.replaceSettings({...DEFAULT_SETTINGS,noFlourishes:true});
  assert.equal(controls.rule(created.id)?.name,rule.name);
  assert.equal(controls.settings().noFlourishes,true);
  await harness.stop();
  assert.throws(()=>controls.rules(),unavailable);
  assert.throws(()=>controls.replaceSettings(DEFAULT_SETTINGS),unavailable);
  harness=new ModuleHarness(hosted,{stateDir:directory,bus:new InProcessBus()});
  await harness.start();
  hosted.setModeParticipants([{id:'lines',kind:'nanoleaf'}]);
  assert.equal(controls.rule(created.id)?.name,rule.name);
  assert.equal(controls.settings().noFlourishes,true);
  controls.remove(created.id);
  assert.deepEqual(controls.rules(),[]);
});

void test('actual core commit and bus intake dispatch once; old publication, sync and restart remain inert',async context=>{
  const clock=manualClock(),directory=await stateDir(context),bus=new InProcessBus({now:clock.now});
  const nano=bus.connect('bunny/modules/nanoleaf'),hook=bus.connect('bunny/parts/hook'),watch=bus.connect('bunny/test/watch');
  const moments:Message[]=[];const occurrences:Message[]=[];
  await nano.respond('bunny.cmd.moment-play.wall',command=>{moments.push(command);return {status:'accepted'};});
  await watch.subscribe('bunny.event.turn-ended.*',message=>{occurrences.push(message);});
  let handle:CoreHandle|undefined;
  let core=createCoreModule({parts:[{start:value=>{handle=value;return Promise.resolve();}}]});
  let refuseOccurrence=false;
  const initialCore=core;
  let harness=new ModuleHarness({manifest:core.manifest,stop:()=>initialCore.stop(),start:context=>initialCore.start({...context,sdk:{...context.sdk,
    publishMessage:async(key,message)=>{if(refuseOccurrence && message.type==='org.bunny.turn.ended') {refuseOccurrence=false;throw new Error('synthetic publish refusal');}return context.sdk.publishMessage(key,message);}}})},
    {bus,stateDir:directory,clock:{now:clock.now}});
  context.after(async()=>{await harness.stop();await hook.close();await nano.close();await watch.close();});
  await harness.start();core.setModeParticipants([{id:'wall',kind:'nanoleaf'}]);
  const device=deviceRecord('wall',1,'nanoleaf','available');
  device.desired.mode={status:'known',value:'work'};
  device.capabilities.moments={supported:true,moods:['celebrate','setback','reminder'],maxDurationMs:10000,coversStatus:true};
  await nano.publish('bunny.state.device.wall',{kind:'state',...deviceState(device)});await flush();
  core.automation.replaceInterruptSet({kinds:['turn-ended']});
  core.automation.create({...rule,action:{...rule.action,priorityClass:'event',targets:['wall']}},true);
  for(const event of [sessionStarted,turnStarted,turnEnded]) {
    clock.advance(10);const {key,draft}=observation(event,clock.now());await hook.publish(key,draft);await flush();
  }
  await core.automation.settled();await flush();
  assert.equal(moments.length,1);
  assert.equal(core.automation.log(10)[0]?.operation?.status,'accepted');
  const occurrence=occurrences[0];assert.ok(occurrence);assert.ok(handle);
  const dispatched=moments[0];assert.ok(dispatched);
  assert.equal(traceFields(dispatched)?.traceId,traceFields(occurrence)?.traceId,'the dispatched moment continues its live occurrence trace');
  await handle.sdk.publishMessage(`bunny.event.turn-ended.${occurrence.subject}`,occurrence);await flush();
  const synced=await watch.sync(['session'],()=>{}, {owner:harness.source,timeoutMs:1000});
  if(synced.status==='synced') await synced.copy.close();
  await core.automation.settled();assert.equal(moments.length,1);
  core.automation.replaceSettings({...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,deviceSpacingMs:0}});
  for(const event of [turnStarted,turnEnded]) {
    clock.advance(10);refuseOccurrence=event.kind==='turn-ended';const {key,draft}=observation(event,clock.now(),{turn:'turn-2'});await hook.publish(key,draft);await flush();
  }
  assert.equal(moments.length,1,'the refused live publication launched nothing');
  clock.advance(10);const fresh=observation(turnStarted,clock.now(),{turn:'turn-3'});await hook.publish(fresh.key,fresh.draft);await flush();
  await core.automation.settled();assert.equal(moments.length,1,'deferred republication cannot acquire live eligibility');
  await harness.stop();
  core=createCoreModule();harness=new ModuleHarness(core,{bus,stateDir:directory,clock:{now:clock.now}});
  await harness.start();core.setModeParticipants([{id:'wall',kind:'nanoleaf'}]);await flush();await core.automation.settled();
  assert.equal(moments.length,1);
});


void test('uncertain dispatch keeps its operation link and is never retried',async()=>{
  const w=world(new DatabaseSync(':memory:'),true);
  try {
    w.automation.create(rule,true);w.automation.submit(event);await w.automation.settled();
    const entry=w.automation.log(10)[0];assert.equal(entry?.outcome,'uncertain');assert.equal(entry?.requestId,'req-one');
    assert.equal(entry?.receipt,undefined);assert.equal(w.sent.length,1);
    assert.deepEqual(w.automation.submit(event),{accepted:false,reason:'duplicate'});await w.automation.settled();assert.equal(w.sent.length,1);
    await w.automation.close();
  }finally {w.db.close();}
});


void test('Work dispatch requires an owner-approved interrupt kind',async()=>{
  const w=world(new DatabaseSync(':memory:'),false,'status');
  try {
    w.automation.create({...rule,action:{...rule.action,priorityClass:'event'}},true);
    w.automation.submit(event);await w.automation.settled();assert.equal(w.sent.length,0);
    assert.equal(w.automation.log(10)[0]?.reason,'interrupt-set');
    w.automation.replaceInterruptSet({kinds:['turn-ended']});
    w.automation.submit({...event,id:'approved-live'});await w.automation.settled();assert.equal(w.sent.length,1);
    await w.automation.close();
  }finally {w.db.close();}
});
