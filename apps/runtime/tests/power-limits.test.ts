import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {createPowerLimits,PowerLimitStore} from '../src/core/power-limits.js';
const unknown={status:'unknown'} as const,unsupported={supported:false} as const;
function device(at:number,on:boolean):DeviceRecord{return {id:'desk-lamp',kind:'wemo',revision:1,configurationRevision:1,generation:{epoch:'00000000-0000-4000-8000-000000000001',sequence:0},availability:'available',capabilities:{power:{supported:true},brightness:unsupported,modes:unsupported,moments:unsupported,media:unsupported,scenes:unsupported,zones:unsupported,preview:unsupported},desired:{power:unknown,brightness:unknown,mode:unknown},observed:{status:'known',observedAtMs:at,power:{status:'known',value:on},brightness:unknown},pending:0,pendingKinds:[],lastOutcome:unknown,lastTransmission:unknown,externalControl:unknown};}
void test('an enabled unknown-elapsed on run requests off once and does not receive a new duration',async t=>{
  const db=new DatabaseSync(':memory:');let now=1800000000000;const record=device(now,true),sent:boolean[]=[];
  const limits=createPowerLimits({store:new PowerLimitStore(db),clock:()=>now,scheduler:{after:()=>()=>{}},active:()=>true,targets:()=>['desk-lamp'],owner:()=> 'bunny/modules/wemo',read:()=>Promise.resolve(record),current:()=>record,send:(_target,on,_record,requestId)=>{sent.push(on);return Promise.resolve({outcome:'receipt',requestId});}});
  t.after(async()=>{await limits.close();db.close();});
  await limits.save('desk-lamp',{enabled:true,durationMs:14400000});await limits.tick();
  assert.deepEqual(sent,[false]);now+=1000;await limits.tick();assert.deepEqual(sent,[false]);
});

function world(t:import('node:test').TestContext){
  const db=new DatabaseSync(':memory:');let now=1800000000000,record:DeviceRecord|undefined=device(now,false),owner='bunny/modules/wemo';const sent:boolean[]=[];
  const store=new PowerLimitStore(db);
  const options={store,clock:()=>now,scheduler:{after:()=>()=>{}},active:()=>true,targets:()=>['desk-lamp'],owner:()=>owner,read:()=>Promise.resolve(record),current:()=>record,
    send:(_target:string,on:boolean,_record:DeviceRecord,requestId:string)=>{sent.push(on);return Promise.resolve({outcome:'receipt' as const,requestId});}};
  let limits=createPowerLimits(options);
  t.after(async()=>{await limits.close();db.close();});
  return {sent,store,get limits(){return limits;},async restart(){await limits.close();limits=createPowerLimits(options);},async observe(on:boolean,advance=1000){now+=advance;record=device(now,on);await limits.tick();},advance(ms:number){now+=ms;},unavailable(){record=undefined;},held(){record={...device(now,true),held:{requestId:'other',heldAtMs:now}};},binding(){owner='bunny/modules/other';},current:()=>record};
}
void test('an observed off-to-on transition has one original deadline through repeat-on, duration edits and restart',async t=>{
  const w=world(t);await w.limits.save('desk-lamp',{enabled:true,durationMs:5000});await w.limits.tick();
  await w.observe(true);const start=w.limits.get('desk-lamp')?.startedAtMs;assert.equal(typeof start,'number');
  await w.observe(true);assert.equal(w.limits.get('desk-lamp')?.startedAtMs,start);
  await w.limits.save('desk-lamp',{enabled:true,durationMs:4000,expectedSettingsRevision:1});
  assert.equal(w.limits.get('desk-lamp')?.deadlineMs,(start as number)+4000);
  await w.restart();await w.observe(true);assert.deepEqual(w.sent,[]);
  await w.observe(true);assert.deepEqual(w.sent,[false]);await w.restart();await w.observe(true);assert.deepEqual(w.sent,[false]);
  await w.observe(false);await w.observe(true);assert.equal(w.limits.get('desk-lamp')?.lastAttempt,null);
});
void test('disabled definitions send nothing; enabling an unknown run requests off and edits never reset its attempt',async t=>{
  const w=world(t);await w.limits.save('desk-lamp',{enabled:false,durationMs:5000});await w.observe(true);assert.deepEqual(w.sent,[]);
  await w.limits.save('desk-lamp',{enabled:true,durationMs:1000});await w.limits.tick();assert.deepEqual(w.sent,[false]);
  await w.limits.save('desk-lamp',{enabled:true,durationMs:9000});await w.observe(true);assert.deepEqual(w.sent,[false]);
  await assert.rejects(w.limits.save('desk-lamp',{enabled:false,durationMs:1000,expectedSettingsRevision:1}),/revision-conflict/);
});
void test('restart after an off observation cannot establish a subsequently observed on start',async t=>{
  const w=world(t);await w.limits.save('desk-lamp',{enabled:true,durationMs:5000});await w.limits.tick();await w.restart();
  await w.observe(true);assert.deepEqual(w.sent,[false]);
});
void test('offline evidence never means off or sends; reconnect unknown-on is conservative',async t=>{
  const w=world(t);await w.limits.save('desk-lamp',{enabled:true,durationMs:5000});await w.limits.tick();
  w.unavailable();await w.limits.tick();assert.equal(w.limits.get('desk-lamp')?.status,'unavailable');assert.deepEqual(w.sent,[]);
  await w.observe(true);assert.deepEqual(w.sent,[false]);
});
void test('held and rebound devices cannot be written and their blocked run is not replayed',async t=>{
  const w=world(t);await w.limits.save('desk-lamp',{enabled:true,durationMs:1000});w.held();await w.limits.tick();
  assert.equal(w.limits.get('desk-lamp')?.status,'blocked');await w.observe(true);assert.deepEqual(w.sent,[]);
  await w.observe(false);w.binding();await w.observe(true);assert.deepEqual(w.sent,[]);
});
void test('intent persists before dispatch and uncertainty survives an engine restart',async t=>{
 const db=new DatabaseSync(':memory:'),record=device(1800000000000,true),store=new PowerLimitStore(db);let sends=0;
 const options={store,clock:()=>1800000000000,scheduler:{after:()=>()=>{}},active:()=>true,targets:()=>['desk-lamp'],owner:()=> 'bunny/modules/wemo',read:()=>Promise.resolve(record),current:()=>record,
  send:(_target:string,_on:boolean,_record:DeviceRecord,requestId:string)=>{assert.equal(store.get('desk-lamp')?.attempt?.outcome,'intent');sends++;return Promise.resolve({requestId,outcome:'uncertain' as const});}};
 let limits=createPowerLimits(options);t.after(async()=>{await limits.close();db.close();});await limits.save('desk-lamp',{enabled:true,durationMs:1000});await limits.tick();assert.equal(sends,1);await limits.close();limits=createPowerLimits(options);await limits.tick();assert.equal(sends,1);assert.equal(limits.get('desk-lamp')?.lastAttempt?.outcome,'uncertain');
});
void test('a definition edit during a suspended observation invalidates the obsolete intent',async t=>{
 const db=new DatabaseSync(':memory:'),record=device(1800000000000,true);let release=()=>{},sends=0;const gate=new Promise<void>(resolve=>{release=resolve;});
 const limits=createPowerLimits({store:new PowerLimitStore(db),clock:()=>1800000000000,scheduler:{after:()=>()=>{}},active:()=>true,targets:()=>['desk-lamp'],owner:()=> 'bunny/modules/wemo',read:async()=>{await gate;return record;},current:()=>record,send:(_target,_on,_record,requestId)=>{sends++;return Promise.resolve({requestId,outcome:'receipt'});}});
 t.after(async()=>{release();await limits.close();db.close();});await limits.save('desk-lamp',{enabled:true,durationMs:1000});const evaluation=limits.tick();await limits.save('desk-lamp',{enabled:false,durationMs:1000});release();await evaluation;assert.equal(sends,0);assert.equal(limits.get('desk-lamp')?.enabled,false);
});
void test('corrupt persisted limit rows refuse rather than inventing settings or a run',()=>{
 const db=new DatabaseSync(':memory:');try{new PowerLimitStore(db);db.prepare('INSERT INTO automation_power_limits VALUES(?,?)').run('desk-lamp',JSON.stringify({enabled:'yes',durationMs:1000}));assert.throws(()=>new PowerLimitStore(db),/invalid-state/);}finally{db.close();}
});
void test('a failed attempt write preserves its request and trace identity and sends nothing',async t=>{
 const db=new DatabaseSync(':memory:'),record=device(1800000000000,true),store=new PowerLimitStore(db);let sends=0,attempt:string|undefined,attemptTrace:string|undefined;
 const reports:Array<{id:string;trace:string}>=[];
 const limits=createPowerLimits({store,clock:()=>1800000000000,scheduler:{after:()=>()=>{}},active:()=>true,targets:()=>['desk-lamp'],owner:()=> 'bunny/modules/wemo',read:()=>Promise.resolve(record),current:()=>record,
  send:(_target,_on,_record,requestId)=>{sends++;return Promise.resolve({requestId,outcome:'receipt'});},failed:(id,parent)=>{reports.push({id,trace:parent.traceparent});}});
 t.after(async()=>{await limits.close();db.close();});await limits.save('desk-lamp',{enabled:true,durationMs:1000});
 const original=store.save.bind(store);store.save=async(entry,view,expected,parent,revision)=>{if(entry.attempt!==null){attempt=entry.attempt.requestId;attemptTrace=parent.traceparent;throw new Error('synthetic storage failure');}await original(entry,view,expected,parent,revision);};
 await limits.tick();assert.equal(sends,0);assert.equal(reports[0]?.id,attempt);assert.equal(reports[0]?.trace,attemptTrace);assert.match(reports[0]?.trace??'',/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
});
