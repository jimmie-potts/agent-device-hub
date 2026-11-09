// Weekly routines (#483, #1297): an ordered action list on the fake clock, the one forward migration of the power window,
// the Hub-mode precondition (ADR 0014), the busy guard, future-only scheduling and storage refusals before dispatch.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {AutomationStore} from '../src/core/automation-store.js';
import {AutomationError,createAutomation,DEFAULT_SETTINGS,DEFAULT_INTERRUPT_SET} from '../src/core/automation.js';
import {checkAction,createRoutines,migratePowerWindows,nextOccurrence,parseRoutine,routineCommand,type RoutineAction,type RoutineOptions} from '../src/core/power-schedules.js';
import {deviceRecord} from './fixtures/device.js';
import {manualClock} from './support.js';

const on:RoutineAction={target:'lamp-a',family:'power-set',data:{on:true}};
const off:RoutineAction={target:'lamp-a',family:'power-set',data:{on:false}};
const input={name:'Evening',days:[1,2,3,4,5],time:'17:00',actions:[on]};
const monday=(hour:number,minute=0)=>new Date(2026,9,12,hour,minute).getTime();
type Sent={action:RoutineAction;requestId:string};
function world(db=new DatabaseSync(':memory:'),clock=manualClock(monday(16))) {
  const store=new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const kinds:Record<string,string>={'pixoo-1':'pixoo','wall-1':'nanoleaf'};
  const records=new Map(['lamp-a','lamp-b','pixoo-1','wall-1'].map(id=>{
    const record=deviceRecord(id,1,kinds[id]??'test-power','available');record.capabilities.power={supported:true};
    if(id==='pixoo-1') {record.capabilities.media={supported:true,actions:['pause','resume','stop','next','previous','restart-with-changes','clear'],playlistIds:['list-1'],renditionIds:[]};record.capabilities.modes={supported:true,values:['work','free','quiet']};record.desired.mode={status:'known',value:'free'};}
    if(id==='wall-1') {record.capabilities.scenes={supported:true,sceneIds:['relax']};record.capabilities.modes={supported:true,values:['work','free','quiet']};record.desired.mode={status:'known',value:'free'};}
    return [id,record] as const;
  }));
  const sent:Sent[]=[];
  const options:RoutineOptions={store,clock:clock.now,scheduler:clock.scheduler,active:()=>true,targets:()=>[...records.keys()],
    owner:id=>id==='pixoo-1'?'bunny/modules/pixoo':id==='wall-1'?'bunny/modules/nanoleaf':id==='lamp-b'?'bunny/modules/lifx':'bunny/modules/test-power',
    read:id=>Promise.resolve(records.get(id)),current:id=>records.get(id),
    send:(action,_record,requestId)=>{sent.push({action,requestId});return Promise.resolve({outcome:'receipt',requestId});}};
  const routines=createRoutines(options);
  return {db,store,clock,records,sent,options,routines};
}
const log=(w:ReturnType<typeof world>)=>w.store.readLog(50).reverse().map(row=>`${row.target} ${row.outcome}${row.reason===null?'':` ${row.reason}`}`);

void test('definitions stay independent, disabled by default, keep their action order and read back beside the event rules',async()=>{
  const w=world();
  try {
    const first=w.routines.create(input),second=w.routines.create({...input,name:'Pixoo evening',actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'}},{target:'lamp-b',family:'brightness-set',data:{percent:40},runsOnlyIn:'quiet'}]});
    assert.equal(first.enabled,false);assert.equal(first.next,undefined);
    assert.deepEqual(second.actions.map(action=>action.family),['media-start','brightness-set']);
    assert.equal(second.actions[0]?.runsOnlyIn,undefined,'no action is forced into a mode (ADR 0014)');
    assert.equal(second.actions[1]?.runsOnlyIn,'quiet','any action may run only in a Hub mode');
    w.routines.setEnabled(first.id,true);
    w.routines.update(first.id,{...input,time:'18:00',actions:[on,off]});
    assert.equal(w.routines.get(first.id).enabled,true);assert.equal(w.routines.get(first.id).actions.length,2);
    assert.deepEqual(w.routines.get(second.id),second);
    await w.routines.close();
    const reopened=createRoutines(w.options);
    assert.equal(reopened.get(first.id).time,'18:00');assert.equal(reopened.get(first.id).enabled,true);
    const event=createAutomation({store:w.store,clock:w.clock.now,monotonic:w.clock.now,active:()=>true,routed:()=>[],targets:()=>Promise.resolve({presentation:'unknown',alert:'unknown'})});
    assert.deepEqual(event.rules(),[]);assert.deepEqual(event.settings(),DEFAULT_SETTINGS);
    await event.close();await reopened.close();
  }finally {w.db.close();}
});
void test('unknown fields, unconfigured targets, foreign module families, bad payloads, invalid weekdays or times and enabled edits are refused before storage',async()=>{
  const w=world();
  try {
    for(const patch of [{extra:1},{days:[]},{days:[1,1]},{days:[7]},{time:'24:00'},{time:'17:00:00'},{name:' '},{timeZone:'UTC'},{enabled:'yes'},{actions:[]},
      {actions:[{target:'unknown',family:'power-set',data:{on:true}}]},{actions:[{target:'lamp-a',family:'scene-activate',data:{sceneId:'x'}}]},
      {actions:[{target:'lamp-a',family:'power-set',data:{on:'yes'}}]},{actions:[{target:'lamp-a',family:'power-set',data:{on:true,extra:1}}]},
      {actions:[{target:'lamp-a',family:'brightness-set',data:{percent:101}}]},{actions:[{target:'lamp-a',family:'pixoo-media-show',data:{renditionId:'f'.repeat(64)}}]},
      {actions:[{target:'pixoo-1',family:'lifx-color-set',data:{hue:1,saturation:1}}]},{actions:[{target:'lamp-a',family:'media-start',data:{playlistId:'list-1'}}]},
      {actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'},runsOnlyIn:'Free'}]},{actions:[{target:'pixoo-1',family:'media-control',data:{action:'pause'},runsOnlyIn:'monitor'}]},
      {actions:[{target:'wall-1',family:'scene-activate',data:{sceneId:'relax'},runsOnlyIn:'media'}]},{actions:[{target:'pixoo-1',family:'device-mode-set',data:{mode:'1media'}}]},
      {actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'},requireMode:'free'}]},
      {actions:[{target:'wall-1',family:'scene-activate',data:{sceneId:'relax/x'}}]},{actions:Array.from({length:17},()=>on)}]) {
      assert.throws(()=>w.routines.create({...input,...patch}),AutomationError,JSON.stringify(patch));
    }
    assert.equal(w.routines.list().length,0);
    const saved=w.routines.create(input);
    assert.throws(()=>w.routines.update(saved.id,{...input,enabled:true}),AutomationError);
    assert.equal(w.routines.get(saved.id).enabled,false);assert.equal(w.sent.length,0);
  }finally {await w.routines.close();w.db.close();}
});
void test('one enabled routine fires once at its minute, runs its actions in order with fresh identities, and a refused action does not stop the next',async()=>{
  const w=world();
  try {
    const pixoo=w.records.get('pixoo-1');assert.ok(pixoo);pixoo.desired.mode={status:'known',value:'work'};
    const saved=w.routines.create({...input,enabled:true,actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'},runsOnlyIn:'free'},on,{target:'lamp-b',family:'lifx-color-set',data:{hue:120,saturation:50}}]});
    assert.deepEqual(saved.next,{atMs:monday(17)});
    w.clock.advance(60*60*1000);await w.routines.settled();
    // The Pixoo is in Work: its Free-only action is skipped on the core's own check; the lamp actions still run, in order.
    assert.deepEqual(w.sent.map(item=>item.action.family),['power-set','lifx-color-set']);
    assert.equal(new Set(w.sent.map(item=>item.requestId)).size,2);
    assert.deepEqual(log(w),['pixoo-1 blocked mode','lamp-a receipt','lamp-b receipt']);
    const rows=w.store.readLog(10).reverse();
    assert.deepEqual(rows.map(row=>(JSON.parse(row.detail??'{}') as {index:number}).index),[0,1,2]);
    assert.deepEqual(rows.map(row=>row.eventKind),['routine-scheduled','routine-scheduled','routine-scheduled']);
    assert.equal((JSON.parse(rows[0]?.detail??'{}') as {runsOnlyIn?:string}).runsOnlyIn,'free');
    w.clock.advance(60*60*1000);await w.routines.settled();assert.equal(w.sent.length,2,'no second occurrence the same day');
    assert.deepEqual(w.routines.get(saved.id).next,{atMs:monday(17)+24*60*60*1000});
  }finally {await w.routines.close();w.db.close();}
});
void test('the Hub-mode precondition is checked by the core and never sent, a pending mode change skips, and a lamp action needs no mode',async()=>{
  const w=world();
  try {
    const pixoo=w.records.get('pixoo-1');assert.ok(pixoo);
    const saved=w.routines.create({...input,enabled:true,actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'},runsOnlyIn:'free'},{target:'pixoo-1',family:'device-mode-set',data:{mode:'quiet'},runsOnlyIn:'work'},on]});
    const first=await w.routines.run(saved.id);
    assert.equal(first.outcome,'ran');
    assert.deepEqual(w.sent.map(item=>`${item.action.family} ${item.action.runsOnlyIn??'-'}`),['media-start free','power-set -']);
    assert.ok(w.sent.every(item=>!Object.hasOwn(item.action.data,'requireMode')),'no action carries requireMode to its module');
    assert.deepEqual(log(w),['pixoo-1 receipt','pixoo-1 blocked mode','lamp-a receipt']);
    pixoo.pendingKinds=['device-mode-set'];pixoo.pending=1;
    await w.routines.run(saved.id);
    assert.deepEqual(log(w).slice(3),['pixoo-1 blocked mode','pixoo-1 blocked mode','lamp-a receipt']);
    assert.deepEqual(routineCommand({target:'pixoo-1',family:'pixoo-media-show',data:{renditionId:'a'.repeat(64)}}),
      {key:'bunny.cmd.pixoo-media-show.pixoo-1',type:'org.bunny.pixoo-media.show.requested',dataschema:'https://bunny.invalid/events/pixoo-media-show/2.0'});
  }finally {await w.routines.close();w.db.close();}
});
void test('a stored routine from before ADR 0014 still opens: its content action runs only in Free, and its Monitor mode change is blocked before dispatch (AC5)',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const first=world(db);
    const saved=first.routines.create({...input,actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'}},{target:'pixoo-1',family:'device-mode-set',data:{mode:'work'}}]});
    await first.routines.close();
    // Rewrite the stored row as a routine saved before ADR 0014: the content action carried Media, and the mode change named Monitor.
    const row=db.prepare('SELECT action FROM rules WHERE id = ?').get(saved.id) as {action:string};
    const action=JSON.parse(row.action) as {actions:Record<string,unknown>[]};
    action.actions=[{...action.actions[0],requireMode:'media'},{...action.actions[1],data:{mode:'monitor'}}];
    db.prepare('UPDATE rules SET action = ? WHERE id = ?').run(JSON.stringify(action),saved.id);
    const w=world(db);
    try {
      assert.deepEqual(w.routines.get(saved.id).actions.map(item=>item.runsOnlyIn),['free',undefined]);
      await w.routines.run(saved.id);
      assert.deepEqual(w.sent.map(item=>item.action.family),['media-start'],'the Monitor mode change is never sent');
      assert.deepEqual(log(w),['pixoo-1 receipt','pixoo-1 blocked unsupported-capability'],'logged with the code the Pixoo would refuse it with');
    } finally {await w.routines.close();}
  } finally {db.close();}
});
void test('run now submits one occurrence, enabled or not, and an overlapping occurrence is logged busy and dropped',async()=>{
  const w=world();await w.routines.close();
  let release:()=>void=()=>{};
  w.options.send=(action,_record,requestId)=>new Promise(resolve=>{release=()=>{resolve({outcome:'receipt',requestId});};void action;});
  const routines=createRoutines(w.options);
  try {
    const saved=routines.create({...input,actions:[on,off]});
    const first=routines.run(saved.id);
    await new Promise(resolve=>{setTimeout(resolve,0);});
    const second=routines.run(saved.id);
    assert.equal((await second).outcome,'busy');
    assert.deepEqual(log(w),['lamp-a blocked busy']);
    assert.equal((JSON.parse(w.store.readLog(1)[0]?.detail??'{}') as {family:string}).family,'power-set','the busy row names the first action\'s family');
    release();await new Promise(resolve=>{setTimeout(resolve,0);});release();assert.equal((await first).outcome,'ran');
    assert.deepEqual(log(w),['lamp-a blocked busy','lamp-a receipt','lamp-a receipt']);
    assert.equal(w.store.readLog(10).find(row=>row.reason==='busy')?.eventKind,'routine-run');
    assert.equal(w.store.powerBoundary(saved.id),undefined,'run now claims no scheduled occurrence');
    await assert.rejects(routines.run('missing'),AutomationError);
  }finally {release();await routines.close();w.db.close();}
});
void test('restart and enabling after the minute select only the next future occurrence; late callbacks never catch up',async()=>{
  const w=world();
  try {
    const saved=w.routines.create({...input,enabled:true});
    w.clock.advance(2*60*60*1000);await w.routines.settled();assert.equal(w.sent.length,0,'a one-hour-late occurrence is discarded');
    await w.routines.close();const reopened=createRoutines(w.options);
    assert.deepEqual(reopened.get(saved.id).next,{atMs:monday(17)+24*60*60*1000});
    reopened.setEnabled(saved.id,false);reopened.setEnabled(saved.id,true);assert.equal(w.sent.length,0);
    w.clock.advance(23*60*60*1000);await reopened.settled();assert.deepEqual(w.sent.map(item=>item.action),[on]);
    await reopened.close();
    // Clock rollback cannot offer the claimed occurrence a second time, including after a restart.
    w.clock.advance(-3*60*60*1000);const again=createRoutines(w.options);
    assert.ok((again.get(saved.id).next?.atMs??0)>monday(17)+24*60*60*1000);await again.close();
  }finally {w.db.close();}
});
for(const mutation of ['disable','delete','edit'] as const) void test(`${mutation} during a pending read invalidates obsolete intent`,async()=>{
  const w=world();
  let release:()=>void=()=>{};
  const record=structuredClone(w.records.get('lamp-a'));
  w.options.read=()=>new Promise(resolve=>{release=()=>{resolve(record);};});
  await w.routines.close();const routines=createRoutines(w.options);
  try {
    const saved=routines.create({...input,enabled:true});w.clock.advance(60*60*1000);
    if(mutation==='disable') routines.setEnabled(saved.id,false);
    else if(mutation==='delete') routines.remove(saved.id);
    else routines.update(saved.id,{...input,time:'18:00'});
    release();await routines.settled();assert.equal(w.sent.length,0);
    assert.equal(w.store.readLog(10).length,0,'an obsolete occurrence records nothing');
  }finally {release();await routines.close();w.db.close();}
});
void test('changed configuration during read and evidence arriving after tolerance cannot authorize a command',async()=>{
  for(const change of ['configuration','generation','owner','late'] as const) {
    const w=world();let release:()=>void=()=>{};
    w.options.read=()=>{const record=structuredClone(w.records.get('lamp-a'));return new Promise(resolve=>{release=()=>{resolve(record);};});};
    await w.routines.close();const routines=createRoutines(w.options);
    try {
      routines.create({...input,enabled:true});w.clock.advance(60*60*1000);
      const record=w.records.get('lamp-a');assert.ok(record);
      if(change==='configuration') record.configurationRevision++;
      else if(change==='generation') record.generation.sequence++;
      else if(change==='owner') w.options.owner=()=> 'bunny/modules/other-power';
      else w.clock.advance(60000);
      release();await routines.settled();assert.equal(w.sent.length,0,change);
    }finally {release();await routines.close();w.db.close();}
  }
});
void test('unavailable, unsupported, externally controlled and held targets block only their own action',async()=>{
  for(const state of ['unavailable','unsupported','external','held'] as const) {
    const w=world();
    try {
      const first=w.records.get('lamp-a');assert.ok(first);
      if(state==='unavailable') first.availability='unavailable';
      else if(state==='unsupported') first.capabilities.power={supported:false};
      else if(state==='external') first.externalControl={status:'known',owner:'external',observedAtMs:w.clock.now()};
      else first.held={requestId:'held-request',heldAtMs:w.clock.now()};
      w.routines.create({...input,enabled:true,actions:[on,{target:'lamp-b',family:'power-set',data:{on:true}}]});
      w.clock.advance(60*60*1000);await w.routines.settled();
      assert.deepEqual(w.sent.map(item=>item.action.target),['lamp-b'],state);
      assert.deepEqual(log(w),[`lamp-a blocked ${state==='unsupported'?'unsupported-capability':'unavailable'}`,'lamp-b receipt'],state);
    }finally {await w.routines.close();w.db.close();}
  }
});
void test('failed or uncertain dispatch is never retried, and deleting a routine removes its bounded guard',async()=>{
  const w=world();await w.routines.close();
  let attempts=0;
  w.options.send=(_action,_record,requestId)=>{attempts++;return Promise.resolve({outcome:'uncertain',requestId});};
  const routines=createRoutines(w.options);
  try {
    const saved=routines.create({...input,enabled:true});w.clock.advance(60*60*1000);await routines.settled();
    assert.equal(attempts,1);assert.equal(w.store.readLog(1)[0]?.outcome,'uncertain');
    assert.equal(w.store.powerBoundary(saved.id),monday(17));
    routines.update(saved.id,input);routines.setEnabled(saved.id,true);await routines.settled();assert.equal(attempts,1);
    routines.remove(saved.id);assert.equal(w.store.powerBoundary(saved.id),undefined);
  }finally {await routines.close();w.db.close();}
});
void test('duplicate callback and durable claim never resend; a guard write failure prevents dispatch',async()=>{
  const w=world();await w.routines.close();
  const callbacks:(()=>void)[]=[];
  w.options.scheduler={after:(ms,callback)=>{callbacks.push(()=>{void callback();});return w.clock.scheduler.after(ms,()=>{void callback();});}};
  const routines=createRoutines(w.options);
  try {
    const saved=routines.create({...input,enabled:true});const original=callbacks[0];assert.ok(original);
    w.clock.advance(60*60*1000);original();await routines.settled();assert.equal(w.sent.length,1);
    assert.equal(w.store.claimPowerBoundary(saved.id,routines.get(saved.id).definitionId,monday(17)),false);
    w.db.exec("CREATE TRIGGER refuse_guard BEFORE UPDATE ON automation_power_guard BEGIN SELECT RAISE(ABORT,'synthetic storage refusal'); END");
    w.clock.advance(24*60*60*1000);await routines.settled();assert.equal(w.sent.length,1,'failed durable claim cannot dispatch');
  }finally {await routines.close();assert.equal(w.clock.pending(),0);w.db.close();}
});
void test('editing one definition cannot discard another routine whose timer callback is waiting',async()=>{
  const w=world();await w.routines.close();let now=monday(16);w.options.clock=()=>now;
  const routines=createRoutines(w.options);
  try {
    const first=routines.create({...input,enabled:true});routines.create({...input,enabled:true,actions:[{target:'lamp-b',family:'power-set',data:{on:true}}]});
    // The wall clock reaches the minute before the event loop runs the waiting timer.
    now=monday(17);routines.update(first.id,{...input,time:'18:00'});
    w.clock.advance(0);await routines.settled();
    assert.deepEqual(w.sent.map(item=>item.action.target),['lamp-b']);
  }finally {await routines.close();w.db.close();}
});
void test('the one forward migration turns each power window into an on routine and an off routine, keeping identity, state and the watermark',async()=>{
  const db=new DatabaseSync(':memory:'),clock=manualClock(monday(16));
  const store=new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const legacy={id:'power-legacy',name:'Reading light',kind:'routine',enabled:true,createdAtMs:monday(9),updatedAtMs:monday(9),
    trigger:JSON.stringify({schema:'power-window/1.0',days:[1,2,3,4,5],onTime:'17:00',offTime:'20:00'}),action:JSON.stringify({target:'lamp-a',definitionId:'definition-legacy'})};
  assert.equal(store.insertRule(legacy,64),true);
  assert.equal(store.claimPowerBoundary('power-legacy','definition-legacy',monday(17)-7*24*60*60*1000),true);
  const event={...legacy,id:'rule-event',kind:'event',trigger:JSON.stringify({source:'core',kind:'turn-ended'}),action:JSON.stringify({mood:'celebrate',priorityClass:'event',durationMs:1000,targets:['wall']})};
  assert.equal(store.insertRule(event,64),true);
  try {
    assert.equal(migratePowerWindows(store,clock.now()),1);
    assert.equal(migratePowerWindows(store,clock.now()),0,'the migration is one-way and idempotent');
    const w=world(db,clock);
    try {
      const routines=w.routines.list();
      assert.equal(routines.length,2);
      const onRoutine=routines.find(saved=>saved.id==='power-legacy'),offRoutine=routines.find(saved=>saved.id!=='power-legacy');
      assert.ok(onRoutine);assert.ok(offRoutine);
      assert.deepEqual([onRoutine.name,onRoutine.time,onRoutine.enabled,onRoutine.definitionId,onRoutine.createdAtMs,onRoutine.actions],['Reading light on','17:00',true,'definition-legacy',monday(9),[on]]);
      assert.deepEqual([offRoutine.name,offRoutine.time,offRoutine.enabled,offRoutine.createdAtMs,offRoutine.actions],['Reading light off','20:00',true,monday(9),[off]]);
      assert.notEqual(offRoutine.definitionId,'definition-legacy');
      assert.equal(w.store.powerBoundary(offRoutine.id),w.store.powerBoundary('power-legacy'),'the watermark is copied');
      assert.deepEqual(onRoutine.next,{atMs:monday(17)});assert.deepEqual(offRoutine.next,{atMs:monday(20)});
      assert.equal(w.store.rules().filter(row=>row.kind==='event').length,1,'event rules survive');
      w.clock.advance(60*60*1000);await w.routines.settled();
      w.clock.advance(3*60*60*1000);await w.routines.settled();
      assert.deepEqual(w.sent.map(item=>item.action),[on,off]);
    }finally {await w.routines.close();}
  }finally {db.close();}
});
void test('a window whose row cannot be read refuses to migrate and leaves every row unchanged',()=>{
  const db=new DatabaseSync(':memory:');
  const store=new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const broken={id:'power-broken',name:'Broken',kind:'routine',enabled:false,createdAtMs:1,updatedAtMs:1,
    trigger:JSON.stringify({schema:'power-window/1.0',days:[1],onTime:'17:00',offTime:'nope'}),action:JSON.stringify({target:'lamp-a',definitionId:'d'})};
  try {
    assert.equal(store.insertRule(broken,64),true);
    assert.throws(()=>migratePowerWindows(store,0),/invalid-state/);
    assert.deepEqual(store.rules().map(row=>row.trigger),[broken.trigger]);
    // The readable row sorts first (`rules()` orders by created_at_ms, id), so a per-row commit would have split it before the refusal.
    const fine={...broken,id:'power-fine',name:'Fine',createdAtMs:0,trigger:JSON.stringify({schema:'power-window/1.0',days:[1],onTime:'17:00',offTime:'20:00'})};
    assert.equal(store.insertRule(fine,64),true);
    assert.throws(()=>migratePowerWindows(store,0),/invalid-state/,'one unreadable row refuses the whole migration');
    assert.deepEqual(store.rules().map(row=>[row.id,row.trigger]),[['power-fine',fine.trigger],['power-broken',broken.trigger]],'the readable row is not split on its own');
    const malformed={...broken,id:'power-json',action:'{not json'};
    store.deleteRule('power-broken');assert.equal(store.insertRule(malformed,64),true);
    assert.throws(()=>migratePowerWindows(store,0),/invalid-state/,'malformed JSON is the same refusal');
    assert.deepEqual(store.rules().map(row=>[row.id,row.trigger]),[['power-fine',fine.trigger],['power-json',broken.trigger]],'nothing is written before the malformed row either');
  }finally {db.close();}
});
void test('migrated names stay valid display text: code-point truncation only when needed, and a neutral name when the suffix would be refused',async()=>{
  const db=new DatabaseSync(':memory:');
  const store=new AutomationStore(db,()=>{}, {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const window=(id:string,name:string)=>({id,name,kind:'routine',enabled:false,createdAtMs:1,updatedAtMs:1,
    trigger:JSON.stringify({schema:'power-window/1.0',days:[1],onTime:'17:00',offTime:'20:00'}),action:JSON.stringify({target:'lamp-a',definitionId:`d-${id}`})});
  const lamps='💡'.repeat(39),long=`${'a'.repeat(76)}💡bc`;
  try {
    assert.equal(store.insertRule(window('w-emoji',lamps),64),true);
    assert.equal(store.insertRule(window('w-long',long),64),true);
    assert.equal(store.insertRule(window('w-token',`ghp_${'A'.repeat(36)}`),64),true);
    assert.equal(store.insertRule(window('w-suffix','Desk token:'),64),true);
    assert.equal(migratePowerWindows(store,0),4);
    const names=new Map(store.rules().map(row=>[row.id,row.name]));
    assert.equal(names.get('w-emoji'),`${lamps} on`,'a valid name is not cut');
    assert.equal(names.get('w-long'),`${'a'.repeat(76)}💡 on`,'cut by code points, never through a surrogate pair');
    assert.equal(names.get('w-token'),'Power window on','a name the reader refuses takes the neutral one');
    assert.equal(names.get('w-suffix'),'Power window on','a valid legacy name that only the suffix turns into a credential pattern takes the neutral one');
    for(const row of store.rules()) assert.ok([...row.name].length<=80 && !row.name.includes('\uFFFD'),row.name);
    const w=world(db);
    try {assert.equal(w.routines.list().length,8,'every migrated row reads back');} finally {await w.routines.close();}
  }finally {db.close();}
});
void test('a scene action on a Nanoleaf runs in Free, and a scene the device no longer offers is blocked before dispatch',async()=>{
  const w=world();
  try {
    const wall=w.records.get('wall-1');assert.ok(wall);
    const saved=w.routines.create({...input,actions:[{target:'wall-1',family:'scene-activate',data:{sceneId:'relax'},runsOnlyIn:'free'},{target:'wall-1',family:'power-set',data:{on:true},runsOnlyIn:'work'}]});
    assert.equal(saved.actions[0]?.runsOnlyIn,'free');
    await w.routines.run(saved.id);
    assert.deepEqual(w.sent.map(item=>`${item.action.family} ${item.action.runsOnlyIn??'-'}`),['scene-activate free']);
    assert.deepEqual(log(w),['wall-1 receipt','wall-1 blocked mode']);
    wall.desired.mode={status:'known',value:'work'};
    await w.routines.run(saved.id);
    assert.deepEqual(log(w).slice(2),['wall-1 blocked mode','wall-1 receipt'],'in Work the Free-only scene is skipped and the Work-only action runs');
    wall.desired.mode={status:'known',value:'free'};wall.capabilities.scenes={supported:true,sceneIds:['focus']};
    await w.routines.run(saved.id);
    assert.deepEqual(log(w).slice(4),['wall-1 blocked unsupported-capability','wall-1 blocked mode']);
    assert.equal(w.sent.length,2);
  }finally {await w.routines.close();w.db.close();}
});
void test('a scheduled action whose turn comes after the minute\'s tolerance is logged expired, not dropped',async()=>{
  const w=world();await w.routines.close();
  w.options.send=(action,_record,requestId)=>{w.sent.push({action,requestId});w.clock.advance(61*1000);return Promise.resolve({outcome:'receipt',requestId});};
  const routines=createRoutines(w.options);
  try {
    routines.create({...input,enabled:true,actions:[on,off]});
    w.clock.advance(60*60*1000);await routines.settled();
    assert.deepEqual(log(w),['lamp-a receipt','lamp-a blocked expired']);
    assert.equal(w.sent.length,1);
    const row=w.store.readLog(1)[0];assert.equal(row?.eventKind,'routine-scheduled');
    assert.equal((JSON.parse(row?.detail??'{}') as {index:number}).index,1);
  }finally {await routines.close();w.db.close();}
});
void test('next occurrence and parsing follow the host clock and the shared shapes',()=>{
  assert.deepEqual(nextOccurrence({days:[1],time:'17:00'},monday(17)),{atMs:monday(17)+7*24*60*60*1000},'the minute itself is not a future occurrence');
  assert.deepEqual(nextOccurrence({days:[0,6],time:'09:30'},monday(17)),{atMs:new Date(2026,9,17,9,30).getTime()});
  const parsed=parseRoutine({name:'Evening',days:[5,1],time:'17:00',actions:[{target:'wall',family:'scene-activate',data:{sceneId:'relax'}}]},['wall'],true,()=>'nanoleaf');
  assert.deepEqual(parsed.days,[1,5]);assert.equal(parsed.actions[0]?.runsOnlyIn,undefined,'a scene takes no mode of its own');
  assert.equal(parseRoutine({name:'Evening',days:[1],time:'17:00',actions:[{target:'wall',family:'scene-activate',data:{sceneId:'relax'},runsOnlyIn:'free'}]},['wall'],true,()=>'nanoleaf').actions[0]?.runsOnlyIn,'free');
  assert.throws(()=>parseRoutine({name:'Evening',days:[1],time:'17:00',actions:[{target:'plug',family:'media-start',data:{playlistId:'p-1'}}]},['plug'],true,()=>'wemo'),AutomationError,'a content action on a kind that shows no content');
  // A stored row may carry the retired requireMode, a native mode: it reads as the Hub mode it stood for, so the core still opens.
  const stored=(requireMode:string)=>parseRoutine({name:'Old',days:[1],time:'17:00',actions:[{target:'pixoo',family:'media-start',data:{playlistId:'p-1'},requireMode}]},null,false).actions[0]?.runsOnlyIn;
  assert.deepEqual(['media','monitor','free','work','quiet'].map(stored),['free','work','free','work','quiet']);
  assert.throws(()=>stored('status'),AutomationError,'a native mode that never stood for a Hub mode');
  assert.throws(()=>parseRoutine({name:'Old',days:[1],time:'17:00',actions:[{target:'pixoo',family:'media-start',data:{playlistId:'p-1'},requireMode:'media'}]},['pixoo'],true),AutomationError,
    'a new definition cannot use the retired member');
});

import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {createCoreModule} from '../src/core/core.js';
import {deviceState} from './fixtures/device.js';
import {flush,stateDir} from './support.js';
import {automationDevices} from '../src/core/automation-devices.js';

void test('admitted generic devices use their SDK owner and the real tracked guarded dispatcher for each action in order',async context=>{
  const clock=manualClock(monday(16)),bus=new InProcessBus({now:clock.now,scheduler:clock.scheduler});
  const owner=bus.connect('bunny/modules/test-power'),core=createCoreModule(),commands:Message[]=[];
  const record=deviceRecord('lamp-a',4,'test-power','available');record.capabilities.power={supported:true};record.capabilities.brightness={supported:true,minimum:0,maximum:100};
  record.configurationRevision=7;record.generation={epoch:'test-power-epoch',sequence:9};
  await owner.serveSync(['device'],()=>({revision:record.revision,states:[deviceState(record)]}));
  await owner.respond('bunny.cmd.power-set.lamp-a',command=>{commands.push(command);return {status:'accepted'};});
  await owner.respond('bunny.cmd.brightness-set.lamp-a',command=>{commands.push(command);return {status:'accepted'};});
  const directory=await stateDir(context);
  const harness=new ModuleHarness(core,{bus,stateDir:directory,clock:{now:clock.now},scheduler:clock.scheduler});
  context.after(async()=>{await harness.stop();await owner.close();});
  await harness.start();
  core.setAutomationDevices(automationDevices([{name:'test-power',admitted:true,devices:['lamp-a']} ],bus.syncOwners('device')));
  await flush();
  const routines=core.automation.routines;assert.ok(routines);
  const saved=routines.create({...input,enabled:true,actions:[on,{target:'lamp-a',family:'brightness-set',data:{percent:40}}]});
  assert.deepEqual(core.automation.rules(),[]);
  clock.advance(60*60*1000);await flush();await routines.settled();
  assert.deepEqual(commands.map(command=>command.type),['org.bunny.power.set.requested','org.bunny.brightness.set.requested']);
  const command=commands[0];assert.ok(command);
  const data=command.data;
  assert.equal(data.on,true);assert.equal(data.expectedConfigurationRevision,7);
  assert.deepEqual(data.expectedGeneration,{epoch:'test-power-epoch',sequence:9});
  assert.equal(typeof data.requestId,'string');assert.match(command.traceparent,/^00-/);
  assert.equal((commands[1]?.data as {percent:number}).percent,40);
  const entries=core.automation.log(2).reverse();
  assert.equal(entries[0]?.ruleId,saved.id);assert.equal(entries[0]?.receipt?.status,'accepted');
  assert.equal(entries[0]?.operation?.family,'power-set');assert.equal(entries[0]?.operation?.status,'accepted');assert.equal(entries[0]?.family,'power-set');assert.equal(entries[0]?.index,0);
  assert.equal(entries[1]?.operation?.family,'brightness-set');assert.equal(entries[1]?.index,1);
  assert.equal(record.observed.status,'unknown','acceptance creates no observed state');
  await harness.stop();
  const restarted=new ModuleHarness(core,{bus,stateDir:directory,clock:{now:clock.now},scheduler:clock.scheduler});
  context.after(()=>restarted.stop());
  await restarted.start();core.setAutomationDevices([{id:'lamp-a',owner:owner.source}]);await flush();
  assert.equal(core.automation.routines?.get(saved.id).enabled,true);assert.equal(commands.length,2);
  clock.advance(24*60*60*1000);await flush();await core.automation.routines?.settled();
  assert.equal(commands.length,4);
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
    const routines=part.controls.routines;assert.ok(routines);routines.create({...input,enabled:true,actions:[on,off]});
    db.exec(`CREATE TRIGGER refuse_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic storage refusal'); END`);
    clock.advance(60*60*1000);await routines.settled();
    // A failed claim dispatches nothing; a failed log row after a dispatch is reported per action and does not stop the next action.
    const expected=table==='automation_power_guard'?0:2;
    assert.equal(actions.length,expected);assert.equal(errors.length,Math.max(1,expected));
    for(const [index,failure] of errors.entries()) {
      assert.equal(failure.event,'operation.failed');assert.equal(failure.fields?.['bunny.code'],'internal');
      assert.equal(failure.fields?.['bunny.routing.key'],'bunny.cmd.power-set.lamp-a');
      assert.ok(failure.trace,'storage failure retains its existing attempt context');
      const trace=traceFields(failure.trace);assert.ok(trace,'storage failure retains its existing attempt trace');
      if(table==='automation_log') {
        const action=actions[index];assert.ok(action?.parent);
        assert.equal(failure.fields?.['bunny.request.id'],action.requestId,'the diagnostic names the action\'s own request');
        assert.equal(trace.traceId,traceFields(action.parent)?.traceId);
      } else assert.match(String(failure.fields?.['bunny.request.id']),/^routine-/);
    }
    clock.advance(1000);await routines.settled();assert.equal(actions.length,expected);
  }finally {await part.close();await sdk.close();await owner.close();db.close();}
});

void test('a throwing storage-failure diagnostic cannot change admission or trigger a retry',async()=>{
  const w=world();await w.routines.close();let reports=0;
  w.options.failed=()=>{reports++;throw new Error('synthetic diagnostic sink refusal');};
  const routines=createRoutines(w.options);
  try {
    routines.create({...input,enabled:true});
    w.db.exec("CREATE TRIGGER refuse_guard_insert BEFORE INSERT ON automation_power_guard BEGIN SELECT RAISE(ABORT,'synthetic storage refusal'); END");
    w.clock.advance(60*60*1000);await routines.settled();
    w.clock.advance(1000);await routines.settled();assert.equal(reports,1);assert.equal(w.sent.length,0);
  }finally {await routines.close();w.db.close();}
});

// #1586: a preview reads each action with the run's own guards and sends, logs, claims and schedules nothing.
type World=ReturnType<typeof world>;
const media:RoutineAction={target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'},runsOnlyIn:'free'};
/** A preview that leaves no trace: no send, no log row, no claimed occurrence. */
async function quietPreview(w:World,id:string) {
  const rows=w.store.readLog(500).length,sent=w.sent.length,boundary=w.store.powerBoundary(id);
  const answer=await w.routines.preview(id);
  assert.equal(w.store.readLog(500).length,rows,'a preview writes no automation-log row');
  assert.equal(w.sent.length,sent,'a preview sends nothing');
  assert.equal(w.store.powerBoundary(id),boundary,'a preview claims no occurrence');
  return answer;
}
void test('each guard gives the preview the reason the run then logs for the same records, with the failing guard named',async()=>{
  const cases:{detail:string;action:RoutineAction;arrange:(w:World)=>void}[]=[
    {detail:'not-configured',action:on,arrange:w=>{w.options.targets=()=>['lamp-b','pixoo-1','wall-1'];}},
    {detail:'no-evidence',action:on,arrange:w=>{const read=w.options.read;w.options.read=id=>id==='lamp-a'?Promise.reject(new Error('synthetic read failure')):read(id);}},
    {detail:'no-evidence',action:on,arrange:w=>{const read=w.options.read;w.options.read=id=>id==='lamp-a'?Promise.resolve(undefined):read(id);}},
    {detail:'stale',action:on,arrange:w=>{w.options.read=id=>{const record=structuredClone(w.records.get(id));if(record!==undefined && id==='lamp-a') record.configurationRevision++;return Promise.resolve(record);};}},
    {detail:'not-available',action:on,arrange:w=>{const record=w.records.get('lamp-a');if(record!==undefined) record.availability='unavailable';}},
    {detail:'held',action:on,arrange:w=>{const record=w.records.get('lamp-a');if(record!==undefined) record.held={requestId:'held-request',heldAtMs:w.clock.now()};}},
    {detail:'unsupported',action:on,arrange:w=>{const record=w.records.get('lamp-a');if(record!==undefined) record.capabilities.power={supported:false};}},
    {detail:'external',action:on,arrange:w=>{const record=w.records.get('lamp-a');if(record!==undefined) record.externalControl={status:'known',owner:'external',observedAtMs:w.clock.now()};}},
    {detail:'pending-mode',action:media,arrange:w=>{const record=w.records.get('pixoo-1');if(record!==undefined) {record.pendingKinds=['device-mode-set'];record.pending=1;}}},
    {detail:'mode-unknown',action:media,arrange:w=>{const record=w.records.get('pixoo-1');if(record!==undefined) record.desired.mode={status:'unknown'};}},
    {detail:'wrong-mode',action:media,arrange:w=>{const record=w.records.get('pixoo-1');if(record!==undefined) record.desired.mode={status:'known',value:'work'};}},
  ];
  for(const {detail,action,arrange} of cases) {
    const w=world();let refusals=0;
    w.options.refused=()=>{refusals++;};
    try {
      const lamp={target:'lamp-b',family:'power-set',data:{on:true}} as const;
      const saved=w.routines.create({...input,actions:[action,lamp]});
      arrange(w);
      const answer=await quietPreview(w,saved.id);
      const [first,second]=answer.actions;
      assert.ok(first?.verdict==='blocked',detail);
      assert.equal(first.detail,detail);
      assert.deepEqual(second,{index:1,target:'lamp-b',family:'power-set',verdict:'would-send'},'one blocked action does not block the next');
      await w.routines.run(saved.id);
      const logged=w.store.readLog(50).reverse();
      assert.equal(logged[0]?.reason,first.reason,`${detail}: the run logs the preview's reason`);
      assert.equal(logged[1]?.outcome,'receipt',detail);
      assert.equal(refusals,first.reason==='mode'?0:1,`${detail}: the run reports a refusal for every block but a mode block, and the preview reports none`);
    }finally {await w.routines.close();w.db.close();}
  }
});
void test('a preview answers would-send from current records, names the next occurrence, and reads busy while an occurrence is in flight',async()=>{
  const w=world();await w.routines.close();
  let release:()=>void=()=>{};
  w.options.send=(action,_record,requestId)=>new Promise(resolve=>{w.sent.push({action,requestId});release=()=>{resolve({outcome:'receipt',requestId});};});
  const routines=createRoutines(w.options);
  try {
    const saved=routines.create({...input,enabled:true,actions:[media,on]});
    const ready=await routines.preview(saved.id);
    assert.deepEqual(ready,{id:saved.id,atMs:monday(16),enabled:true,next:{atMs:monday(17)},actions:[
      {index:0,target:'pixoo-1',family:'media-start',runsOnlyIn:'free',verdict:'would-send'},{index:1,target:'lamp-a',family:'power-set',verdict:'would-send'}]});
    const running=routines.run(saved.id);
    await new Promise(resolve=>{setTimeout(resolve,0);});
    const busy=await routines.preview(saved.id);
    assert.deepEqual(busy.actions.map(item=>item.verdict==='blocked'?`${item.reason} ${item.detail}`:item.verdict),['busy in-flight','busy in-flight']);
    assert.equal(w.sent.length,1,'the preview did not add a send to the running occurrence');
    release();await new Promise(resolve=>{setTimeout(resolve,0);});release();await running;
    assert.deepEqual(log(w),['pixoo-1 receipt','lamp-a receipt'],'only the run wrote rows');
    assert.equal((await routines.preview(saved.id)).actions.every(item=>item.verdict==='would-send'),true,'the in-flight mark cleared after the run, not by the preview');
    const disabled=routines.setEnabled(saved.id,false);
    assert.equal(Object.hasOwn(await routines.preview(disabled.id),'next'),false,'a disabled routine has no next occurrence');
    await assert.rejects(routines.preview('missing'),(error:unknown)=>error instanceof AutomationError && error.code==='unknown-rule' && error.status===404);
  }finally {release();await routines.close();w.db.close();}
});
void test('the shared guard returns the current record only when every guard passes',()=>{
  const record=deviceRecord('lamp-a',1,'test-power','available');record.capabilities.power={supported:true};
  const evidence={action:on,configured:true,owner:'bunny/modules/test-power',ownerNow:'bunny/modules/test-power',read:structuredClone(record),current:record};
  const check=checkAction(evidence);
  assert.ok(check.ok);assert.equal(check.record,record);
  assert.deepEqual(checkAction({...evidence,ownerNow:'bunny/modules/other-power'}),{ok:false,reason:'unavailable',detail:'stale'});
  assert.deepEqual(checkAction({...evidence,owner:undefined}),{ok:false,reason:'unavailable',detail:'not-configured'});
  assert.deepEqual(checkAction({...evidence,current:undefined}),{ok:false,reason:'unavailable',detail:'no-evidence'});
  // External control outranks a missing capability, as the run's capability code applies only to an otherwise usable device.
  const external=structuredClone(record);external.externalControl={status:'known',owner:'external',observedAtMs:1};external.capabilities.power={supported:false};
  assert.deepEqual(checkAction({...evidence,read:structuredClone(external),current:external}),{ok:false,reason:'unavailable',detail:'external'});
  const unsupported=structuredClone(record);unsupported.capabilities.power={supported:false};
  assert.deepEqual(checkAction({...evidence,read:structuredClone(unsupported),current:unsupported}),{ok:false,reason:'unsupported-capability',detail:'unsupported'});
});
