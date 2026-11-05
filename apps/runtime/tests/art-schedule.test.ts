import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {DEFAULT_ART_POLICY,artPolicyWrite,initialArtRecord,nextArtStart,planArtDay,savedArtwork,wakingDay,rainForecast} from '../src/core/art-schedule-model.js';
import {ArtScheduleStore} from '../src/core/art-schedule-store.js';
import {AutomationStore} from '../src/core/automation-store.js';
import {DEFAULT_SETTINGS,DEFAULT_INTERRUPT_SET,createAutomation} from '../src/core/automation.js';
import type {ArtRecord,ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {WeatherState} from '@jimmie-potts/weather';
const local=(hour:number,minute=0)=>new Date(2026,10,5,hour,minute).getTime();
const policy={...DEFAULT_ART_POLICY,enabled:true};
const blank=()=>({...initialArtRecord(),policy:structuredClone(policy)});

void test('closed revisioned policy admits only configured targets and nonempty host-local windows',()=>{
  assert.deepEqual(artPolicyWrite({expectedSettingsRevision:0,policy},[]),{expectedSettingsRevision:0,policy});
  for(const value of [{expectedSettingsRevision:0,policy:{...policy,targets:['guessed']}},{expectedSettingsRevision:0,policy:{...policy,wakingEndMinute:policy.wakingStartMinute}},
    {expectedSettingsRevision:0,policy:{...policy,calendar:true}},{expectedSettingsRevision:-1,policy},{expectedSettingsRevision:0,policy:{...policy,appearances:9}}])assert.throws(()=>artPolicyWrite(value,[]));
});
void test('six/seven/eight bounded slots cover early middle late with spacing from prior latest start',()=>{
  const day=wakingDay(local(8),policy);assert.ok(day);
  for(const count of [6,7,8] as const){const starts=planArtDay(day,count,local(8),null,DEFAULT_SETTINGS.quietHours,()=>0.5);assert.equal(starts.length,count);
    assert.ok((starts[0]??Infinity)<local(12));assert.ok((starts.at(-1)??0)>local(18));
    for(let index=1;index<starts.length;index++)assert.ok((starts[index]??0)>=(starts[index-1]??0)+45*60_000+1000);}
  assert.equal(nextArtStart(local(9)+60_000),local(9,46));
  const narrowed=planArtDay({...day,startAtMs:local(9),endAtMs:local(10)},8,local(8),local(9)+60_000,DEFAULT_SETTINGS.quietHours,()=>0);
  assert.ok(narrowed.every(at=>at>=local(9,46)));assert.ok(narrowed.length<6);
  assert.deepEqual(planArtDay(day,7,local(8),null,{enabled:true,start:'00:00',end:'00:00',timeZone:null},()=>0.5),[]);
});
void test('crossing midnight belongs to its starting date, and planning remains future-only',()=>{
  const night={...policy,wakingStartMinute:20*60,wakingEndMinute:4*60};
  const evening=wakingDay(local(21),night),morning=wakingDay(local(27),night);assert.ok(evening);assert.deepEqual(morning,evening);
  assert.equal(wakingDay(local(12),night),undefined);
  const day=wakingDay(local(18),policy);assert.ok(day);assert.ok(planArtDay(day,7,local(18),null,DEFAULT_SETTINGS.quietHours,()=>0.5).every(at=>at>local(18)+45_000));
});
void test('private policy and durable claims reopen, reject invalid rows and roll back on persistence failure',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const store=new ArtScheduleStore(db);const opportunity={id:'synthetic-opportunity',kind:'appearance' as const,startAtMs:local(9),toleranceMs:60_000};
    await store.change(data=>{data.record=blank();data.record.settingsRevision=1;data.latestStartMs=opportunity.startAtMs+opportunity.toleranceMs;assert.equal(store.claim(opportunity),true);});
    const reopened=new ArtScheduleStore(db);assert.equal(reopened.get().record.settingsRevision,1);assert.equal(nextArtStart(reopened.get().latestStartMs??0),local(9,46));
    await reopened.change(()=>{assert.equal(reopened.claim(opportunity),false);});
    assert.equal(reopened.handoff(opportunity,'shelf-display'),true);assert.equal(new ArtScheduleStore(db).handoff(opportunity,'shelf-display'),false);
    const before=reopened.get();db.exec("CREATE TRIGGER refuse_art BEFORE UPDATE ON automation_art_schedule BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    await assert.rejects(reopened.change(data=>{data.record.settingsRevision++;assert.equal(reopened.claim({...opportunity,id:'never-committed'}),true);}));
    assert.deepEqual(reopened.get(),before);assert.equal(db.prepare('SELECT id FROM automation_art_claims WHERE id=?').get('never-committed'),undefined);
    db.exec('DROP TRIGGER refuse_art');db.prepare('UPDATE automation_art_schedule SET payload=?').run('{}');assert.throws(()=>new ArtScheduleStore(db),/invalid-state/);
  }finally{db.close();}
});
void test('pending art counts once across targets, survives reopen, and excludes only its own reservation',()=>{
  const db=new DatabaseSync(':memory:');try{
    const make=()=>new AutomationStore(db,()=>{},{settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});let store=make();
    store.reserveMoment('art-one',['shelf-display','desk-display'],local(9),local(9,1));store=make();
    assert.equal(store.handedFlourishes(local(8)),1);assert.equal(store.reservedUsage(local(8),'art-one'),0);assert.equal(store.reservedUsage(local(8),'other'),1);
    assert.equal(store.reservedLatest('shelf-display','art-one'),undefined);assert.equal(store.reservedLatest('shelf-display','other'),local(9,1));
    assert.equal(store.handedFlourishes(local(8),'imaginary-agent'),0);assert.equal(store.handedForTask('imaginary-agent','imaginary-task'),0);
  }finally{db.close();}
});
void test('ordinary flourish sees a competing art reservation made while its owner read waits',async()=>{
  const db=new DatabaseSync(':memory:');const store=new AutomationStore(db,()=>{},{settings:{...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1}},interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const target={presentation:'content',alert:'none',moments:'supported'} as const;let release:()=>void=()=>{};
  const held=new Promise<typeof target>(resolve=>{release=()=>{resolve(target);};});let writes=0;
  const engine=createAutomation({store,routed:()=>['desk-display'],targets:()=>held,clock:()=>local(9),monotonic:()=>local(9),active:()=>true,
    sender:(_target,moment)=>{writes++;return Promise.resolve({kind:'receipt',momentId:moment.momentId,requestId:'synthetic-write',status:'accepted'});}});
  try {engine.create({name:'Synthetic flourish',kind:'event',enabled:true,trigger:{source:'core',kind:'turn-ended'},action:{mood:'celebrate',priorityClass:'flourish',durationMs:1000,targets:['desk-display']}},true);
    engine.submit({id:'synthetic-event',source:'core',kind:'turn-ended',delivery:'live'});store.reserveMoment('reserved-art',['shelf-display'],local(9),local(9,1));release();await engine.settled();assert.equal(writes,0);
  }finally{release();await engine.close();db.close();}
});
void test('saved choice prefers favorite/positive usable art and excludes dismissed and missing composition',()=>{
  const art=(id:string):ArtworkSummary=>({artworkId:id,createdAtMs:0,favorite:false,feedback:null,variationOf:null,palette:['#112233'],provenance:{generatedBy:'local',factual:false},
    compositions:[{target:'ui',compositionId:'a'.repeat(64),outcome:'succeeded',motion:'still',renditions:[{renditionId:'b'.repeat(64),width:320,height:320,frames:1,durationMs:0,format:'png',bytes:1,ref:'rendition.test'}]}]});
  const ordinary=art('ordinary'),favorite={...art('favorite'),favorite:true},dismissed={...art('dismissed'),favorite:true,feedback:'dismiss' as const};
  const record={artworks:[ordinary,favorite,dismissed]} as ArtRecord;
  assert.equal(savedArtwork(record,()=>0)?.artworkId,'favorite');assert.equal(savedArtwork({...record,artworks:[dismissed,{...ordinary,compositions:[]}]},()=>0),undefined);
});
void test('rain facts require a future qualifying hour and cover the complete allowed start and hold',()=>{
  const hour={startAtMs:local(10),endAtMs:local(11),condition:'rain' as const,likely:false,temperatureF:60,precipitationPercent:40,windMph:0,isDaytime:true,dayPart:'morning' as const};
  const record:WeatherState={id:'local',revision:9,status:'available',observedAtMs:local(9),staleAtMs:local(9,45),ageMs:0,forecastUpdatedAtMs:local(9),current:hour,forecast:[hour],alerts:[],words:['rain']};
  const notice=rainForecast(record,local(9),local(9,1),1000);assert.equal(notice?.likelihood,'chance');assert.equal(notice?.weatherRevision,9);
  assert.equal(rainForecast(record,local(9,45),local(9,46),1000),undefined);
  assert.equal(rainForecast(record,local(9),local(9,44)+30_000,1000),undefined);
  assert.equal(rainForecast({...record,forecast:[{...hour,startAtMs:local(12),endAtMs:local(13)}]},local(9),local(9,1),1000),undefined);
});

import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCoreModule} from '../src/core/core.js';
import {manualClock,stateDir,flush} from './support.js';
void test('actual core exposes revisioned policy, publishes it, and reopens without resetting saved authority',async context=>{
  const directory=await stateDir(context),clock=manualClock(local(8)),bus=new InProcessBus();
  const make=()=>createCoreModule({artScheduleChoice:()=>0.5});let core=make();
  let harness=new ModuleHarness(core,{stateDir:directory,bus,clock:{now:clock.now},scheduler:clock.scheduler});context.after(()=>harness.stop());
  await harness.start();assert.ok(core.automation.artSchedule);const first=core.automation.artSchedule.get();assert.equal(first.settingsRevision,0);assert.equal(first.policy.enabled,false);
  const saved=await core.automation.artSchedule.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});await flush();
  assert.equal(saved.settingsRevision,1);assert.ok(saved.nextOpportunity);assert.equal(saved.weather,'disabled');
  await assert.rejects(core.automation.artSchedule.save({expectedSettingsRevision:0,policy}),error=>error instanceof Error&&error.message==='revision-conflict');
  core.automation.replaceSettings({...DEFAULT_SETTINGS,noFlourishes:true});assert.equal(core.automation.artSchedule.get().settingsRevision,1);
  await harness.stop();assert.deepEqual(harness.failures,[]);core=make();harness=new ModuleHarness(core,{stateDir:directory,bus,clock:{now:clock.now},scheduler:clock.scheduler});
  await harness.start();await flush();assert.ok(core.automation.artSchedule);assert.equal(core.automation.artSchedule.get().settingsRevision,1);assert.equal(core.automation.artSchedule.get().policy.enabled,true);
});
