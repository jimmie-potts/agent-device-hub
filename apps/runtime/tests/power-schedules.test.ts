// Weekly routines (#483, #1297): an ordered action list on the fake clock, the one forward migration of the power window,
// the mode precondition, the busy guard, future-only scheduling and storage refusals before dispatch.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {AutomationStore} from '../src/core/automation-store.js';
import {AutomationError,createAutomation,DEFAULT_SETTINGS,DEFAULT_INTERRUPT_SET} from '../src/core/automation.js';
import {createRoutines,migratePowerWindows,nextOccurrence,parseRoutine,routineCommand,type RoutineAction,type RoutineOptions} from '../src/core/power-schedules.js';
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
    if(id==='pixoo-1') {record.capabilities.media={supported:true,actions:['pause','resume','stop','next','previous','restart-with-changes','clear'],playlistIds:['list-1'],renditionIds:[]};record.capabilities.modes={supported:true,values:['monitor','media']};record.desired.mode={status:'known',value:'media'};}
    if(id==='wall-1') {record.capabilities.scenes={supported:true,sceneIds:['relax']};record.capabilities.modes={supported:true,values:['status','free']};record.desired.mode={status:'known',value:'free'};}
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
    const first=w.routines.create(input),second=w.routines.create({...input,name:'Pixoo evening',actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'}},{target:'lamp-b',family:'brightness-set',data:{percent:40}}]});
    assert.equal(first.enabled,false);assert.equal(first.next,undefined);
    assert.deepEqual(second.actions.map(action=>action.family),['media-start','brightness-set']);
    assert.equal(second.actions[0]?.requireMode,'media','a content action on a Pixoo defaults to Media');
    assert.equal(second.actions[1]?.requireMode,undefined);
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
      {actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'},requireMode:'Media'}]},{actions:[{target:'pixoo-1',family:'media-control',data:{action:'pause'},requireMode:'monitor'}]},
      {actions:[{target:'wall-1',family:'scene-activate',data:{sceneId:'relax'},requireMode:'status'}]},{actions:[{target:'pixoo-1',family:'device-mode-set',data:{mode:'1media'}}]},
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
    const pixoo=w.records.get('pixoo-1');assert.ok(pixoo);pixoo.desired.mode={status:'known',value:'monitor'};
    const saved=w.routines.create({...input,enabled:true,actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'}},on,{target:'lamp-b',family:'lifx-color-set',data:{hue:120,saturation:50}}]});
    assert.deepEqual(saved.next,{atMs:monday(17)});
    w.clock.advance(60*60*1000);await w.routines.settled();
    // The Pixoo is in Monitor: its content action is skipped on the core's own check; the lamp actions still run, in order.
    assert.deepEqual(w.sent.map(item=>item.action.family),['power-set','lifx-color-set']);
    assert.equal(new Set(w.sent.map(item=>item.requestId)).size,2);
    assert.deepEqual(log(w),['pixoo-1 blocked mode','lamp-a receipt','lamp-b receipt']);
    const rows=w.store.readLog(10).reverse();
    assert.deepEqual(rows.map(row=>(JSON.parse(row.detail??'{}') as {index:number}).index),[0,1,2]);
    assert.deepEqual(rows.map(row=>row.eventKind),['routine-scheduled','routine-scheduled','routine-scheduled']);
    assert.equal((JSON.parse(rows[0]?.detail??'{}') as {requireMode?:string}).requireMode,'media');
    w.clock.advance(60*60*1000);await w.routines.settled();assert.equal(w.sent.length,2,'no second occurrence the same day');
    assert.deepEqual(w.routines.get(saved.id).next,{atMs:monday(17)+24*60*60*1000});
  }finally {await w.routines.close();w.db.close();}
});
void test('the mode precondition passes through to a mode-checked family, a pending mode change skips, and a lamp action needs no mode',async()=>{
  const w=world();
  try {
    const pixoo=w.records.get('pixoo-1');assert.ok(pixoo);
    const saved=w.routines.create({...input,enabled:true,actions:[{target:'pixoo-1',family:'media-start',data:{playlistId:'list-1'}},{target:'pixoo-1',family:'device-mode-set',data:{mode:'media'},requireMode:'monitor'},on]});
    const first=await w.routines.run(saved.id);
    assert.equal(first.outcome,'ran');
    assert.deepEqual(w.sent.map(item=>`${item.action.family} ${item.action.requireMode??'-'}`),['media-start media','power-set -']);
    assert.deepEqual(log(w),['pixoo-1 receipt','pixoo-1 blocked mode','lamp-a receipt']);
    pixoo.pendingKinds=['device-mode-set'];pixoo.pending=1;
    await w.routines.run(saved.id);
    assert.deepEqual(log(w).slice(3),['pixoo-1 blocked mode','pixoo-1 blocked mode','lamp-a receipt']);
    assert.deepEqual(routineCommand({target:'pixoo-1',family:'pixoo-media-show',data:{renditionId:'a'.repeat(64)}}),
      {key:'bunny.cmd.pixoo-media-show.pixoo-1',type:'org.bunny.pixoo-media.show.requested',dataschema:'https://bunny.invalid/events/pixoo-media-show/2.0'});
  }finally {await w.routines.close();w.db.close();}
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
      assert.deepEqual(log(w),['lamp-a blocked unavailable','lamp-b receipt'],state);
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
    const saved=w.routines.create({...input,actions:[{target:'wall-1',family:'scene-activate',data:{sceneId:'relax'}},{target:'wall-1',family:'power-set',data:{on:true},requireMode:'status'}]});
    assert.equal(saved.actions[0]?.requireMode,'free');
    await w.routines.run(saved.id);
    assert.deepEqual(w.sent.map(item=>`${item.action.family} ${item.action.requireMode??'-'}`),['scene-activate free']);
    assert.deepEqual(log(w),['wall-1 receipt','wall-1 blocked mode']);
    wall.desired.mode={status:'known',value:'status'};
    await w.routines.run(saved.id);
    assert.deepEqual(log(w).slice(2),['wall-1 blocked mode','wall-1 receipt'],'while the wall shows status the scene is skipped and the status-only action runs');
    wall.desired.mode={status:'known',value:'free'};wall.capabilities.scenes={supported:true,sceneIds:['focus']};
    await w.routines.run(saved.id);
    assert.deepEqual(log(w).slice(4),['wall-1 blocked unavailable','wall-1 blocked mode']);
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
  assert.deepEqual(parsed.days,[1,5]);assert.equal(parsed.actions[0]?.requireMode,'free','a Nanoleaf scene defaults to Free');
  assert.equal(parseRoutine({name:'Evening',days:[1],time:'17:00',actions:[{target:'wall',family:'scene-activate',data:{sceneId:'relax'},requireMode:'free'}]},['wall'],true,()=>'nanoleaf').actions[0]?.requireMode,'free');
  assert.throws(()=>parseRoutine({name:'Evening',days:[1],time:'17:00',actions:[{target:'plug',family:'media-start',data:{playlistId:'p-1'}}]},['plug'],true,()=>'wemo'),AutomationError,'a content action on a kind without a content mode');
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
