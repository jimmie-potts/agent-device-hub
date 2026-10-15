import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {AutomationStore} from '../src/core/automation-store.js';
import {AutomationError,createAutomation,DEFAULT_SETTINGS,DEFAULT_INTERRUPT_SET} from '../src/core/automation.js';
import {createPowerSchedules,type PowerScheduleOptions} from '../src/core/power-schedules.js';
import {deviceRecord} from './fixtures/device.js';
import {manualClock} from './support.js';

const input={name:'Desk light',target:'lamp-a',days:[1,2,3,4,5],onTime:'17:00',offTime:'20:00'};
const monday=(hour:number,minute=0)=>new Date(2026,9,12,hour,minute).getTime();
function world(db=new DatabaseSync(':memory:'),clock=manualClock(monday(16))) {
  const store=new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const records=new Map(['lamp-a','lamp-b'].map(id=>{
    const record=deviceRecord(id,1,'test-power','available');record.capabilities.power={supported:true};return [id,record] as const;
  }));
  const sent:{target:string;on:boolean}[]=[];
  const options:PowerScheduleOptions={store,clock:clock.now,scheduler:clock.scheduler,active:()=>true,targets:()=>[...records.keys()],owner:()=> 'bunny/modules/test-power',
    read:id=>Promise.resolve(records.get(id)),current:id=>records.get(id),
    send:(target,on)=>{sent.push({target,on});return Promise.resolve({outcome:'receipt',requestId:`request-${sent.length}`});}};
  const power=createPowerSchedules(options);
  return {db,store,clock,records,sent,options,power};
}
void test('shared definitions remain independent, disabled by default and readable with existing event settings',async()=>{
  const w=world();
  try {
    const first=w.power.create(input),second=w.power.create({...input,target:'lamp-b',days:[0,6]});
    assert.equal(first.enabled,false);assert.equal(first.next,undefined);
    w.power.setEnabled(first.id,true);
    w.power.update(first.id,{...input,onTime:'18:00'});
    assert.equal(w.power.get(first.id).enabled,true);
    assert.deepEqual(w.power.get(second.id),second);
    await w.power.close();
    const reopened=createPowerSchedules(w.options);
    assert.equal(reopened.get(first.id).onTime,'18:00');assert.equal(reopened.get(first.id).enabled,true);
    const event=createAutomation({store:w.store,clock:w.clock.now,monotonic:w.clock.now,active:()=>true,routed:()=>[],targets:()=>Promise.resolve({presentation:'unknown',alert:'unknown'})});
    assert.deepEqual(event.rules(),[]);assert.deepEqual(event.settings(),DEFAULT_SETTINGS);
    await event.close();await reopened.close();
  }finally {w.db.close();}
});
void test('unknown fields, unqualified targets, invalid weekdays/windows and enabled edits are refused before storage',async()=>{
  const w=world();
  try {
    for(const patch of [{extra:1},{target:'unknown'},{days:[]},{days:[1,1]},{days:[7]},{onTime:'24:00'},
      {offTime:'16:00'},{offTime:'17:00'},{name:' '},{timeZone:'UTC'},{enabled:'yes'}]) {
      assert.throws(()=>w.power.create({...input,...patch}),AutomationError);
    }
    assert.equal(w.power.list().length,0);
    const saved=w.power.create(input);
    assert.throws(()=>w.power.update(saved.id,{...input,enabled:true}),AutomationError);
    assert.equal(w.power.get(saved.id).enabled,false);assert.equal(w.sent.length,0);
  }finally {await w.power.close();w.db.close();}
});
void test('one enabled weekly window dispatches each future boundary once and never continually re-enforces on',async()=>{
  const w=world();
  try {
    const saved=w.power.create({...input,enabled:true});
    assert.deepEqual(saved.next,{atMs:monday(17),on:true});
    w.clock.advance(60*60*1000);await w.power.settled();
    assert.deepEqual(w.sent,[{target:'lamp-a',on:true}]);
    // A physical/manual off is an observation, not a reason to restore the on window.
    const record=w.records.get('lamp-a');assert.ok(record);record.desired.power={status:'known',value:false};
    w.clock.advance(2*60*60*1000);await w.power.settled();assert.equal(w.sent.length,1);
    w.clock.advance(60*60*1000);await w.power.settled();
    assert.deepEqual(w.sent,[{target:'lamp-a',on:true},{target:'lamp-a',on:false}]);
    assert.equal(w.store.readLog(10).length,2);
  }finally {await w.power.close();w.db.close();}
});

void test('restart and enabling mid-window select only future off; late callbacks never catch up',async()=>{
  const w=world();
  try {
    const saved=w.power.create({...input,enabled:true});
    w.clock.advance(2*60*60*1000);await w.power.settled();assert.equal(w.sent.length,0,'one-hour-late on is discarded');
    await w.power.close();const reopened=createPowerSchedules(w.options);
    assert.deepEqual(reopened.get(saved.id).next,{atMs:monday(20),on:false});
    reopened.setEnabled(saved.id,false);reopened.setEnabled(saved.id,true);assert.equal(w.sent.length,0);
    w.clock.advance(2*60*60*1000);await reopened.settled();assert.deepEqual(w.sent,[{target:'lamp-a',on:false}]);
    await reopened.close();
    // Clock rollback cannot offer the claimed boundary a second time, including after a restart.
    w.clock.advance(-3*60*60*1000);const again=createPowerSchedules(w.options);
    assert.ok((again.get(saved.id).next?.atMs??0)>monday(20));await again.close();
  }finally {w.db.close();}
});
for(const mutation of ['disable','delete','edit'] as const) void test(`${mutation} during a pending read invalidates obsolete intent`,async()=>{
  const w=world();
  let release:()=>void=()=>{};
  const record=structuredClone(w.records.get('lamp-a'));
  w.options.read=()=>new Promise(resolve=>{release=()=>{resolve(record);};});
  await w.power.close();const power=createPowerSchedules(w.options);
  try {
    const saved=power.create({...input,enabled:true});w.clock.advance(60*60*1000);
    if(mutation==='disable') power.setEnabled(saved.id,false);
    else if(mutation==='delete') power.remove(saved.id);
    else power.update(saved.id,{...input,onTime:'18:00'});
    release();await power.settled();assert.equal(w.sent.length,0);
    assert.equal(w.store.powerBoundary(saved.id),undefined,'obsolete intent never claims a boundary');
  }finally {release();await power.close();w.db.close();}
});
void test('changed configuration during read and evidence arriving after tolerance cannot authorize a command',async()=>{
  for(const change of ['configuration','generation','owner','late'] as const) {
    const w=world();let release:()=>void=()=>{};
    w.options.read=()=>{const record=structuredClone(w.records.get('lamp-a'));return new Promise(resolve=>{release=()=>{resolve(record);};});};
    await w.power.close();const power=createPowerSchedules(w.options);
    try {
      power.create({...input,enabled:true});w.clock.advance(60*60*1000);
      const record=w.records.get('lamp-a');assert.ok(record);
      if(change==='configuration') record.configurationRevision++;
      else if(change==='generation') record.generation.sequence++;
      else if(change==='owner') w.options.owner=()=> 'bunny/modules/other-power';
      else w.clock.advance(60000);
      release();await power.settled();assert.equal(w.sent.length,0);
    }finally {release();await power.close();w.db.close();}
  }
});
void test('unavailable, unsupported, externally controlled and held targets never block an independent schedule',async()=>{
  for(const state of ['unavailable','unsupported','external','held'] as const) {
    const w=world();
    try {
      const first=w.records.get('lamp-a');assert.ok(first);
      if(state==='unavailable') first.availability='unavailable';
      else if(state==='unsupported') first.capabilities.power={supported:false};
      else if(state==='external') first.externalControl={status:'known',owner:'external',observedAtMs:w.clock.now()};
      else first.held={requestId:'held-request',heldAtMs:w.clock.now()};
      w.power.create({...input,enabled:true});w.power.create({...input,target:'lamp-b',enabled:true});
      w.clock.advance(60*60*1000);await w.power.settled();
      assert.deepEqual(w.sent,[{target:'lamp-b',on:true}]);
      assert.equal(w.store.readLog(10).filter(entry=>entry.target==='lamp-a')[0]?.outcome,'blocked');
    }finally {await w.power.close();w.db.close();}
  }
});
void test('failed or uncertain dispatch is never retried, and deleting a schedule removes its bounded guard',async()=>{
  const w=world();await w.power.close();
  let attempts=0;
  w.options.send=()=>{attempts++;return Promise.resolve({outcome:'uncertain',requestId:'uncertain-request'});};
  const power=createPowerSchedules(w.options);
  try {
    const saved=power.create({...input,enabled:true});w.clock.advance(60*60*1000);await power.settled();
    assert.equal(attempts,1);assert.equal(w.store.readLog(1)[0]?.outcome,'uncertain');
    assert.equal(w.store.powerBoundary(saved.id),monday(17));
    power.update(saved.id,input);power.setEnabled(saved.id,true);await power.settled();assert.equal(attempts,1);
    power.remove(saved.id);assert.equal(w.store.powerBoundary(saved.id),undefined);
  }finally {await power.close();w.db.close();}
});

import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {createCoreModule} from '../src/core/core.js';
import {deviceState} from './fixtures/device.js';
import {flush,stateDir} from './support.js';
import {automationDevices} from '../src/core/automation-devices.js';

void test('admitted generic power devices use their SDK owner and real tracked guarded dispatcher, independently of mode participants',async context=>{
  const clock=manualClock(monday(16)),bus=new InProcessBus({now:clock.now,scheduler:clock.scheduler});
  const owner=bus.connect('bunny/modules/test-power'),core=createCoreModule(),commands:Message[]=[];
  const record=deviceRecord('lamp-a',4,'test-power','available');record.capabilities.power={supported:true};
  record.configurationRevision=7;record.generation={epoch:'test-power-epoch',sequence:9};
  await owner.serveSync(['device'],()=>({revision:record.revision,states:[deviceState(record)]}));
  await owner.respond('bunny.cmd.power-set.lamp-a',command=>{commands.push(command);return {status:'accepted'};});
  const directory=await stateDir(context);
  const harness=new ModuleHarness(core,{bus,stateDir:directory,clock:{now:clock.now},scheduler:clock.scheduler});
  context.after(async()=>{await harness.stop();await owner.close();});
  await harness.start();
  core.setAutomationDevices(automationDevices([{name:'test-power',admitted:true,devices:['lamp-a']} ]));
  await flush();
  const power=core.automation.power;assert.ok(power);
  const saved=power.create({...input,enabled:true});
  assert.deepEqual(core.automation.rules(),[]);
  clock.advance(60*60*1000);await flush();await power.settled();
  assert.equal(commands.length,1);
  const command=commands[0];assert.ok(command);
  const data=command.data;
  assert.equal(data.on,true);assert.equal(data.expectedConfigurationRevision,7);
  assert.deepEqual(data.expectedGeneration,{epoch:'test-power-epoch',sequence:9});
  assert.equal(typeof data.requestId,'string');assert.match(command.traceparent,/^00-/);
  const log=core.automation.log(1)[0];assert.equal(log?.ruleId,saved.id);assert.equal(log?.receipt?.status,'accepted');
  assert.equal(log?.operation?.family,'power-set');assert.equal(log?.operation?.status,'accepted');
  assert.equal(record.observed.status,'unknown','acceptance creates no observed state');
  await harness.stop();
  const restarted=new ModuleHarness(core,{bus,stateDir:directory,clock:{now:clock.now},scheduler:clock.scheduler});
  context.after(()=>restarted.stop());
  await restarted.start();core.setAutomationDevices([{id:'lamp-a',owner:owner.source}]);await flush();
  assert.equal(core.automation.power?.get(saved.id).enabled,true);assert.equal(commands.length,1);
  clock.advance(3*60*60*1000);await flush();await core.automation.power?.settled();
  assert.equal(commands.length,2);assert.equal((commands[1]?.data as {on:boolean}).on,false);
});

void test('duplicate callback and durable claim never resend; a guard write failure prevents dispatch',async()=>{
  const w=world();await w.power.close();
  const callbacks:(()=>void)[]=[];
  w.options.scheduler={after:(ms,callback)=>{callbacks.push(()=>{void callback();});return w.clock.scheduler.after(ms,()=>{void callback();});}};
  const power=createPowerSchedules(w.options);
  try {
    const saved=power.create({...input,enabled:true});const original=callbacks[0];assert.ok(original);
    w.clock.advance(60*60*1000);original();await power.settled();assert.equal(w.sent.length,1);
    assert.equal(w.store.claimPowerBoundary(saved.id,power.get(saved.id).definitionId,monday(17)),false);
    w.db.exec("CREATE TRIGGER refuse_guard BEFORE UPDATE ON automation_power_guard BEGIN SELECT RAISE(ABORT,'synthetic storage refusal'); END");
    w.clock.advance(3*60*60*1000);await power.settled();assert.equal(w.sent.length,1,'failed durable claim cannot dispatch');
  }finally {await power.close();assert.equal(w.clock.pending(),0);w.db.close();}
});

void test('editing one definition cannot discard another target boundary whose timer callback is waiting',async()=>{
  const w=world();await w.power.close();let now=monday(16);w.options.clock=()=>now;
  const power=createPowerSchedules(w.options);
  try {
    const first=power.create({...input,enabled:true});power.create({...input,target:'lamp-b',enabled:true});
    // The wall clock reaches the boundary before the event loop runs the waiting timer.
    now=monday(17);power.update(first.id,{...input,onTime:'18:00'});
    w.clock.advance(0);await power.settled();
    assert.deepEqual(w.sent,[{target:'lamp-b',on:true}]);
  }finally {await power.close();w.db.close();}
});

import {AutomationPart} from '../src/core/automation-part.js';
import type {LogFields,TraceContext} from '@jimmie-potts/sdk';
import {traceFields} from '@jimmie-potts/sdk';

for(const table of ['automation_power_guard','automation_log'] as const) void test(`storage failure in ${table} retains attempt correlation without retry`,async()=>{
  const clock=manualClock(monday(16)),db=new DatabaseSync(':memory:'),bus=new InProcessBus({now:clock.now,scheduler:clock.scheduler});
  const sdk=bus.connect('bunny/core'),owner=bus.connect('bunny/modules/test-power');
  const record=deviceRecord('lamp-a',1,'test-power','available');record.capabilities.power={supported:true};
  await owner.serveSync(['device'],()=>({revision:record.revision,states:[deviceState(record)]}));
  const actions:{requestId?:string;parent?:TraceContext}[]=[],errors:{event:string;fields:LogFields|undefined;trace:TraceContext|undefined}[]=[];
  const part=new AutomationPart(clock.scheduler,new AbortController().signal);
  await part.start({sdk,clock:{now:clock.now},ready:Promise.resolve(),received:()=> 'new',
    transaction:()=>Promise.reject(new Error('unexpected transaction')),operation:()=>undefined,
    log:{debug:()=>{},info:()=>{},warn:()=>{},error:(event,fields,trace)=>{errors.push({event,fields,trace});}},
    dispatch:action=>{actions.push(action);return Promise.resolve({requestId:action.requestId??'missing',status:'accepted'});}});
  part.open(db);part.setDevices([{id:'lamp-a',owner:owner.source}]);await flush();
  try {
    const power=part.controls.power;assert.ok(power);power.create({...input,enabled:true});
    db.exec(`CREATE TRIGGER refuse_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic storage refusal'); END`);
    clock.advance(60*60*1000);await power.settled();
    assert.equal(actions.length,table==='automation_power_guard'?0:1);
    assert.equal(errors.length,1);const failure=errors[0];assert.ok(failure);
    assert.equal(failure.event,'operation.failed');assert.equal(failure.fields?.['bunny.code'],'internal');
    assert.equal(typeof failure.fields?.['bunny.request.id'],'string');
    assert.equal(failure.fields?.['bunny.routing.key'],'bunny.cmd.power-set.lamp-a');
    assert.ok(failure.trace,'storage failure retains its existing attempt context');
    const trace=traceFields(failure.trace);assert.ok(trace,'storage failure retains its existing attempt trace');
    if(table==='automation_log') {
      assert.equal(failure.fields?.['bunny.request.id'],actions[0]?.requestId);
      const action=actions[0];assert.ok(action?.parent);
      assert.equal(trace.traceId,traceFields(action.parent)?.traceId);
    }
    clock.advance(1000);await power.settled();assert.equal(actions.length,table==='automation_power_guard'?0:1);
  }finally {await part.close();await sdk.close();await owner.close();db.close();}
});

void test('a throwing storage-failure diagnostic cannot change admission or trigger a retry',async()=>{
  const w=world();await w.power.close();let reports=0;
  w.options.failed=()=>{reports++;throw new Error('synthetic diagnostic sink refusal');};
  const power=createPowerSchedules(w.options);
  try {
    power.create({...input,enabled:true});
    w.db.exec("CREATE TRIGGER refuse_guard_insert BEFORE INSERT ON automation_power_guard BEGIN SELECT RAISE(ABORT,'synthetic storage refusal'); END");
    w.clock.advance(60*60*1000);await power.settled();
    w.clock.advance(1000);await power.settled();assert.equal(reports,1);assert.equal(w.sent.length,0);
  }finally {await power.close();w.db.close();}
});
