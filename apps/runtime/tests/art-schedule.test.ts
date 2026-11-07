import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {DEFAULT_ART_POLICY,START_TOLERANCE_MS,artPolicyWrite,initialArtRecord,nextArtStart,planArtDay,savedArtwork,wakingDay,rainForecast} from '../src/core/art-schedule-model.js';
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

import {InProcessBus,childOf,type TraceContext} from '@jimmie-potts/sdk';
import {ArtScheduleInputs} from '../src/core/art-schedule-inputs.js';
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

import {createArtPlans} from '../src/core/art-plans.js';
import {createArtSchedule} from '../src/core/art-schedule.js';
import type {Action} from '../src/core/tracker.js';
import {deviceRecord} from './fixtures/device.js';
import type {ArtAuto22} from '@jimmie-potts/event-contracts/v2/art';
const artwork=(id:string):ArtworkSummary=>({artworkId:id,createdAtMs:local(7),favorite:true,feedback:null,variationOf:null,palette:['#112233'],provenance:{generatedBy:'local',factual:false},
  compositions:[{target:'ui',compositionId:(id==='new-art'?'b':'a').repeat(64),outcome:'succeeded',motion:'still',renditions:[{renditionId:'c'.repeat(64),width:320,height:320,frames:1,durationMs:0,format:'png',bytes:1,ref:'rendition.synthetic'}]}]});
const syntheticWeather=(revision=9,observedAtMs=local(8),staleAtMs=local(8,45)):WeatherState=>{
  const hour={startAtMs:local(10),endAtMs:local(11),condition:'rain' as const,likely:true,temperatureF:60,precipitationPercent:80,windMph:0,isDaytime:true,dayPart:'morning' as const};
  return {id:'local',revision,status:'available',observedAtMs,staleAtMs,ageMs:0,forecastUpdatedAtMs:observedAtMs,current:hour,forecast:[hour],alerts:[],words:['rain']};
};
function scheduledWorld(withDisplay=false,choice:()=>number=()=>0.5,displayId='shelf-display',clock=manualClock(local(8))) {
  const db=new DatabaseSync(':memory:'),commands:Action[]=[],failures:string[]=[];
  const provider=(name:'openai'|'anthropic')=>({provider:name,available:false,ceilingMicros:0,paceMicros:0,spentMicros:0,reservedMicros:0,uncertainMicros:0,remainingMicros:0,todayMicros:0,excessMicros:0,earlierUncertainMicros:0});
  const catalog:ArtRecord={id:'art',revision:1,month:'2026-11',day:'2026-11-05',providers:[provider('openai'),provider('anthropic')],guard:{calls:0,limit:30,windowMs:3_600_000},
    gifs:{accepted:0,rejected:0},jobs:[],artworks:[artwork('saved-art')],candidates:[],retention:{recentLimit:24,recent:1,favorites:1,retained:[]}};
  let currentSettings={...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1}},attention=false;
  const shared=new AutomationStore(db,()=>{},{settings:currentSettings,interruptSet:[...DEFAULT_INTERRUPT_SET]});
  const store=new ArtScheduleStore(db),dispatch=(action:Action)=>{commands.push(structuredClone(action));return Promise.resolve({requestId:action.requestId??'synthetic',status:'accepted' as const});};
  const display=deviceRecord(displayId,1,'tidbyt','available');
  const targets=()=>withDisplay?[{target:displayId,kind:'tidbyt' as const}]:[];
  if(withDisplay)catalog.artworks[0]?.compositions.push({target:'tidbyt',compositionId:'d'.repeat(64),outcome:'succeeded',motion:'gif',renditions:[{renditionId:'e'.repeat(64),width:64,height:32,frames:8,durationMs:1600,format:'gif',bytes:100,ref:'rendition.synthetic-display'}]});
  const plans=createArtPlans({clock:clock.now,scheduler:clock.scheduler,active:()=>true,targets,current:()=>withDisplay?display:undefined,dispatch,operation:()=>undefined,claim:(id,digest)=>{assert.equal(shared.claimArtPlan(id,digest),true);return undefined;}});
  let enabled=false,artReads=0,weatherReads=0,weatherState:WeatherState|undefined;
  const inputs={set:(value:typeof policy)=>{enabled=value.enabled;},art:()=>{artReads++;return enabled?catalog:undefined;},weather:()=>{weatherReads++;return weatherState;}};
  const options={store,shared,core:{clock:{now:clock.now},dispatch,operation:()=>undefined},scheduler:clock.scheduler,active:()=>true,plans,current:()=>withDisplay?display:undefined,
    settings:()=>currentSettings,attention:()=>attention,inputs,choice,failed:()=>{failures.push('storage');}};
  let owner=createArtSchedule(options);
  return {db,clock,commands,catalog,store,shared,failures,setWeather:(value:WeatherState|undefined)=>{weatherState=value;},setAttention:(value:boolean)=>{attention=value;},setSettings:(settings:typeof currentSettings)=>{currentSettings=settings;},get owner(){return owner;},reads:()=>({artReads,weatherReads}),
    move:async(at:number)=>{clock.advance(at-clock.now());await flush();await owner.settled();await flush();},
    restart:async()=>{await owner.close();owner=createArtSchedule(options);await flush();await owner.settled();},
    close:async()=>{plans.close();await owner.close();db.close();}};
}
void test('saved browser appearance consumes its own last unit once, and disabled source performs zero reads',async()=>{
  const w=scheduledWorld();try{
    await w.owner.settled();assert.deepEqual(w.reads(),{artReads:0,weatherReads:0});
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-45_000);assert.equal(w.commands.length,0,'preparation does not select the browser early');
    assert.equal(w.shared.handedFlourishes(start-3_600_000),1);
    await w.move(start);assert.equal(w.commands.length,1);assert.equal((w.commands[0]?.draft.data as ArtAuto22).action,'present');
    assert.equal(w.reads().weatherReads,0);await w.restart();await w.move(start+1000);assert.equal(w.commands.length,1,'restart cannot replay selection');assert.deepEqual(w.failures,[]);
  }finally{await w.close();}
});
void test('a start timer that wakes late presents the browser within the tolerance and never after it', async () => {
  // A busy event loop can wake the start timer after the start: #1515 saw 1,017 ms on a loaded runner.
  for (const [lateMs, presented] of [[1_500, true], [START_TOLERANCE_MS, true], [START_TOLERANCE_MS + 1, false]] as const) {
    const w = scheduledWorld();
    try {
      const saved = await w.owner.save({expectedSettingsRevision: 0, policy: {...policy, ambient: false}});
      const start = saved.nextOpportunity?.startAtMs;assert.ok(start !== undefined);
      await w.move(start - 45_000);assert.equal(w.commands.length, 0);
      await w.move(start + lateMs);
      assert.equal(w.commands.length, presented ? 1 : 0, `a wake ${String(lateMs)} ms after the start`);
      if (presented) assert.equal((w.commands[0]?.draft.data as ArtAuto22).action, 'present');
      assert.deepEqual(w.failures, []);
    } finally {await w.close();}
  }
});

void test('preparation comes due between the tick and its next timer', async () => {
  const source = manualClock(local(8));
  let boundary: number | undefined, crossed = false, shortTimers = 0;
  const clock = {...source, now: () => {
    const at = source.now();
    if (!crossed && boundary !== undefined && at === boundary - 1) {crossed = true; source.advance(1);}
    return at;
  }, scheduler: {after: (delayMs: number, callback: () => void) => {
    if (delayMs <= 1) shortTimers++;
    return source.scheduler.after(delayMs, callback);
  }}};
  const w = scheduledWorld(false, () => 0.5, 'shelf-display', clock);
  try {
    const saved = await w.owner.save({expectedSettingsRevision: 0, policy: {...policy, ambient: false}});
    const start = saved.nextOpportunity?.startAtMs; assert.ok(start !== undefined);
    boundary = start - 45_000;
    await w.move(boundary - 1); // The tick reads the earlier instant; the next clock read is at the boundary.
    await w.move(boundary + 1);
    assert.equal(crossed, true);
    assert.equal(w.owner.get().lastOpportunity?.startAtMs, start, 'preparation claims the fixed start on its next timer turn');
    assert.equal(w.commands.length, 0, 'the browser still waits for the scheduled start');
    await w.move(start);
    assert.equal(w.commands.length, 1);
    const beforeIdle = shortTimers;
    for (let ms = 1; ms <= 5; ms++) await w.move(start + ms);
    assert.equal(shortTimers, beforeIdle, 'an idle schedule does not rearm an overdue or absent timer');
    assert.equal(w.commands.length, 1, 'the completed opportunity is never replayed');
  } finally {await w.close();}
});

void test('held generation falls back once at the fixed cutoff; late output and restart cannot trigger selection',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false,generation:true}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-300_000);assert.equal(w.commands.length,1);const request=w.commands[0]?.requestId;assert.ok(request!==undefined);
    assert.equal((w.commands[0]?.draft.data as ArtAuto22).action,'start');
    await w.move(start-45_000);await w.move(start);assert.equal(w.commands.length,2);const selected=w.commands[1]?.draft.data as ArtAuto22;assert.equal(selected.action,'present');if(selected.action==='present')assert.equal(selected.artworkId,'saved-art');
    w.catalog.artworks.unshift(artwork('new-art'));w.catalog.jobs.push({requestId:request,purpose:'appearance',admittedBy:'automatic',status:'finished',outcome:'succeeded',artworkId:'new-art',createdAtMs:start-300_000,finishedAtMs:start+1000,targets:[]});
    w.owner.changed();await w.owner.settled();await w.restart();await w.move(start+10_000);assert.equal(w.commands.length,2);assert.deepEqual(w.failures,[]);
  }finally{await w.close();}
});
void test('one scheduled opportunity carries its trace through generation and browser presentation',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false,generation:true}}),start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-300_000);await w.move(start-45_000);await w.move(start);
    assert.equal(w.commands.length,2);const traces=w.commands.map(command=>{assert.ok(command.parent);return command.parent.traceparent.split('-')[1];});
    assert.equal(new Set(traces).size,1,'generation and presentation remain in the same occurrence trace');
  }finally{await w.close();}
});
void test('a suppressed weather occurrence stays consumed through duplicate delivery and restart',async()=>{
  const w=scheduledWorld();try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,weather:true}});await flush();assert.equal(w.commands.length,1);
    await w.move(local(8,1));w.setSettings({...DEFAULT_SETTINGS,noFlourishes:true,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1}});
    w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1);
    w.setSettings({...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1}});
    w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1,'duplicate delivery cannot become catch-up');
    await w.restart();w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1,'restart retains the consumed occurrence');
    const source=childOf(undefined);w.setWeather(syntheticWeather(10));w.owner.weatherChanged(10,source);await w.owner.settled();await flush();assert.equal(w.commands.length,2);
    assert.equal(w.commands[1]?.parent?.traceparent.split('-')[1],source.traceparent.split('-')[1]);
  }finally{await w.close();}
});
for(const changed of ['stale','future','superseded'] as const)void test(`a queued weather occurrence stays consumed when its source becomes ${changed}`,async()=>{
  const w=scheduledWorld();try{
    w.setWeather(syntheticWeather(9,local(8,1)));await w.owner.save({expectedSettingsRevision:0,policy:{...policy,weather:true}});await flush();await w.move(local(8,1));assert.equal(w.commands.length,1);
    w.owner.weatherChanged(9);
    if(changed==='stale')w.clock.advance(local(8,46)-w.clock.now());
    if(changed==='future')w.clock.advance(-20_000);
    if(changed==='superseded')w.setWeather(syntheticWeather(10,local(8,1)));
    await w.owner.settled();await flush();assert.equal(w.commands.length,1,'invalidated source cannot authorize a queued ambient selection');assert.equal(w.store.get().weatherRevision,9);
    w.setWeather(syntheticWeather(9,w.clock.now(),w.clock.now()+45*60_000));w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1,'consumption is not refunded');
  }finally{await w.close();}
});
for(const changed of ['stale','superseded'] as const)void test(`a held weather ambient grant refuses a ${changed} source before its initial handoff`,async()=>{
  const w=scheduledWorld(true);try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,weather:true,targets:['shelf-display']}});await flush();await w.move(local(8,1));
    w.setWeather(syntheticWeather(9,w.clock.now(),w.clock.now()+5000));w.owner.weatherChanged(9);await w.owner.settled();await flush();
    assert.equal(w.commands.filter(value=>(value.draft.data as ArtAuto22).action==='ambient').length,2);
    const command=w.commands.filter(value=>(value.draft.data as ArtAuto22).action==='ambient').at(-1)?.draft.data as ArtAuto22;assert.equal(command.action,'ambient');if(command.action!=='ambient')throw new Error('ambient command missing');
    if(changed==='stale')await w.move(w.clock.now()+6000);else w.setWeather(syntheticWeather(10,w.clock.now()));
    assert.equal(w.owner.authorizeAmbient(command.authorization,command.target,command.compositionId)?.error.code,'invalid-state');
    assert.equal(w.owner.authorizeAmbient(command.authorization,command.target,command.compositionId)?.error.code,'forbidden','refused grant remains one-use');
  }finally{await w.close();}
});
void test('the live weather input refuses stale or future observations and carries only a current owner trace',async()=>{
  const clock=manualClock(local(9)),bus=new InProcessBus({now:clock.now}),sdk=bus.connect('bunny/core'),weather=bus.connect('bunny/modules/weather'),foreign=bus.connect('bunny/modules/art');
  const hour={startAtMs:local(10),endAtMs:local(11),condition:'rain' as const,likely:true,temperatureF:60,precipitationPercent:80,windMph:0,isDaytime:true,dayPart:'morning' as const};
  let record:WeatherState={id:'local',revision:8,status:'available',observedAtMs:local(8,55),staleAtMs:local(9,30),ageMs:0,forecastUpdatedAtMs:local(8),current:hour,forecast:[hour],alerts:[],words:['rain']};
  const state=()=>({type:'org.bunny.weather-state.updated',subject:'local',dataschema:'https://bunny.invalid/events/weather-state/2.0',data:record});
  const calls:{revision:number;parent:TraceContext}[]=[],baselines:number[]=[],inputs=new ArtScheduleInputs({clock:{now:clock.now},sdk},clock.scheduler,()=>true,()=>{},(revision,parent)=>{calls.push({revision,parent});},revision=>{baselines.push(revision);});
  const source=childOf(undefined),emit=(sender=weather)=>sender.publish('bunny.event.weather-changed.local',{kind:'occurrence',type:'org.bunny.weather.changed',subject:'local',dataschema:'https://bunny.invalid/events/weather-changed/2.0',data:{revision:record.revision,observedAtMs:record.observedAtMs,changes:['condition'],words:['rain']}},{parent:source});
  try{
    await weather.serveSync(['weather-state'],()=>({revision:record.revision,states:[state()]}));inputs.set({...policy,weather:true});await flush();
    assert.deepEqual(baselines,[8]);await emit();await flush();assert.equal(calls.length,0,'a synced revision is not a new live occurrence');
    record={...record,revision:9,observedAtMs:local(8),staleAtMs:local(8,45)};await weather.publish('bunny.state.weather-state.local',{kind:'state',...state()});await flush();
    await emit();await flush();assert.equal(calls.length,0,'a matching stale source is not a live trigger');
    record={...record,revision:10,observedAtMs:local(9)+1,staleAtMs:local(9,30)};await weather.publish('bunny.state.weather-state.local',{kind:'state',...state()});await flush();await emit();await flush();assert.equal(calls.length,0,'a future observation is not a live trigger');
    record={...record,revision:11,observedAtMs:local(8,55)};await weather.publish('bunny.state.weather-state.local',{kind:'state',...state()});await flush();await emit(foreign);await flush();assert.equal(calls.length,0);
    await emit();await flush();assert.equal(calls.length,1);assert.equal(calls[0]?.parent.traceparent.split('-')[1],source.traceparent.split('-')[1]);
    inputs.set({...policy,enabled:false,weather:true});await emit();await flush();assert.equal(calls.length,1,'closed source creates no trigger');
    inputs.set({...policy,weather:true});await flush();assert.equal(baselines.at(-1),11);await emit();await flush();assert.equal(calls.length,1,'re-enable seeds a baseline without replay');
  }finally{await inputs.close();await Promise.all([sdk.close(),weather.close(),foreign.close()]);}
});
for(const denied of ['attention','no-art','quiet','disabled','weather-disabled'] as const)void test(`weather received under ${denied} cannot become an enabled backlog`,async()=>{
  const w=scheduledWorld();try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,weather:true}});await flush();await w.move(local(8,1));assert.equal(w.commands.length,1);
    const held=w.catalog.artworks.slice();
    if(denied==='attention')w.setAttention(true);
    if(denied==='no-art')w.catalog.artworks=[];
    if(denied==='quiet')w.setSettings({...DEFAULT_SETTINGS,quietHours:{enabled:true,start:'08:00',end:'09:00',timeZone:null},budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1}});
    if(denied==='disabled'||denied==='weather-disabled')await w.owner.save({expectedSettingsRevision:1,policy:{...policy,enabled:denied!=='disabled',weather:denied!=='weather-disabled'}});
    w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1);assert.equal(w.store.get().weatherRevision,9);
    w.setAttention(false);w.catalog.artworks=held;w.setSettings({...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1}});
    if(denied==='disabled'||denied==='weather-disabled')await w.owner.save({expectedSettingsRevision:2,policy:{...policy,weather:true}});
    w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1);
    await w.restart();w.owner.weatherChanged(9);await w.owner.settled();await flush();assert.equal(w.commands.length,1);
  }finally{await w.close();}
});
void test('policy disable during preparation leaves the reserved opportunity spent and sends no browser selection',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-45_000);await w.owner.save({expectedSettingsRevision:1,policy:{...policy,enabled:false,ambient:false}});await w.move(start);assert.equal(w.commands.length,0);
    const count=w.store.get().day?.claimed;assert.equal(count,1);await w.owner.save({expectedSettingsRevision:2,policy:{...policy,ambient:false}});assert.equal(w.store.get().day?.claimed,count);
    assert.ok((w.owner.get().nextOpportunity?.startAtMs??Infinity)>=start+1000+45*60_000);
  }finally{await w.close();}
});
void test('failed opportunity commit launches neither automatic generation nor presentation',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false,generation:true}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    w.db.exec("CREATE TRIGGER refuse_claim BEFORE INSERT ON automation_art_claims BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    await w.move(start-300_000);assert.equal(w.commands.length,0);assert.equal(w.store.get().day?.claimed,0);assert.ok(w.failures.length>0);
  }finally{await w.close();}
});
void test('host-local DST skips a nonexistent waking boundary and keeps repeated hours in one day',()=>{
  const previous=process.env.TZ;try{process.env.TZ='America/New_York';
    assert.equal(wakingDay(new Date(2026,2,8,3,30).getTime(),{...policy,wakingStartMinute:150,wakingEndMinute:600}),undefined);
    const early=Date.parse('2026-11-01T01:30:00-04:00'),late=Date.parse('2026-11-01T01:30:00-05:00');
    const midnight={...policy,wakingStartMinute:0,wakingEndMinute:240};assert.deepEqual(wakingDay(early,midnight),wakingDay(late,midnight));
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
void test('ambient grant binds one exact target/composition and exposes separate tracked selection identities',async()=>{
  const w=scheduledWorld(true);try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,targets:['shelf-display']}});await flush();
    const ambient=w.commands.find(value=>(value.draft.data as ArtAuto22).action==='ambient'),browser=w.commands.find(value=>(value.draft.data as ArtAuto22).action==='present');assert.ok(ambient);assert.ok(browser);
    const data=ambient.draft.data as ArtAuto22;assert.equal(data.action,'ambient');if(data.action!=='ambient')return;
    const last=w.owner.get().lastOpportunity;assert.equal(last?.kind,'ambient');assert.equal(last?.displays[0]?.prepareRequestId,ambient.requestId);assert.equal(last?.displays[0]?.momentRequestId,null);assert.equal(last?.browserRequestId,browser.requestId);
    assert.equal(w.owner.authorizeAmbient(data.authorization,'shelf-display',data.compositionId),undefined);
    assert.equal(w.owner.authorizeAmbient(data.authorization,'shelf-display',data.compositionId)?.error.code,'forbidden');
    w.owner.weatherChanged(9);await w.move(w.clock.now()+31_000);assert.equal(w.commands.length,2,'disabled weather cannot add an ambient opportunity');
    assert.equal(w.shared.handedFlourishes(local(0)),0,'ambient does not acquire an appearance budget or moment');
    await w.restart();assert.equal(w.owner.authorizeAmbient(data.authorization,'shelf-display',data.compositionId)?.error.code,'forbidden');assert.equal(w.commands.length,2);
  }finally{await w.close();}
});
void test('ambient grant is revoked by policy edit or exact-target mismatch without being reusable',async()=>{
  for(const revoke of ['policy','target'] as const){const w=scheduledWorld(true);try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,browser:false,targets:['shelf-display']}});await flush();const command=w.commands[0];assert.ok(command);
    const data=command.draft.data as ArtAuto22;assert.equal(data.action,'ambient');if(data.action!=='ambient')continue;
    if(revoke==='policy')await w.owner.save({expectedSettingsRevision:1,policy:{...policy,enabled:false,browser:false,targets:['shelf-display']}});
    assert.equal(w.owner.authorizeAmbient(data.authorization,revoke==='target'?'other-target':'shelf-display',data.compositionId)?.error.code,'forbidden');
    assert.equal(w.owner.authorizeAmbient(data.authorization,'shelf-display',data.compositionId)?.error.code,'forbidden');assert.equal(w.commands.length,1);
  }finally{await w.close();}}
});
void test('waking edits extend readable accounting bounds without refilling claimed appearances',async()=>{
  const w=scheduledWorld();try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});
    await w.owner.save({expectedSettingsRevision:1,policy:{...policy,ambient:false,wakingEndMinute:1439}});
    const extended=new ArtScheduleStore(w.db).get();assert.equal(extended.day?.claimed,0);assert.equal(extended.day?.endAtMs,local(23,59));
    assert.ok(extended.day?.starts.every(at=>at<local(23,59)));assert.ok(extended.day?.starts.some(at=>at>local(22)));
    const start=w.owner.get().nextOpportunity?.startAtMs;assert.ok(start!==undefined);await w.move(start-45_000);assert.equal(w.store.get().day?.claimed,1);
    await w.owner.save({expectedSettingsRevision:2,policy:{...policy,ambient:false,enabled:false,wakingEndMinute:20*60}});
    await w.owner.save({expectedSettingsRevision:3,policy:{...policy,ambient:false,wakingEndMinute:20*60}});
    const shrunk=new ArtScheduleStore(w.db).get();assert.equal(shrunk.day?.claimed,1);assert.equal(shrunk.day?.endAtMs,local(23,59),'shrinking cannot shorten the spent accounting interval');
    assert.ok(shrunk.day?.starts.every(at=>at<local(20)));await w.restart();assert.equal(w.store.get().day?.claimed,1);assert.deepEqual(w.failures,[]);
  }finally{await w.close();}
});
void test('a quiet-hours edit after claim refuses an appearance whose full hold crosses the boundary',async()=>{
  const w=scheduledWorld(false,()=>0.52);try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-45_000);const boundary=Math.floor(start/60_000)*60_000+60_000;assert.ok(boundary<start+30_000);
    const time=(at:number)=>{const date=new Date(at);return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};
    w.setSettings({...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:1},quietHours:{enabled:true,start:time(boundary),end:time(boundary+3_600_000),timeZone:null}});
    await w.move(start);assert.equal(w.commands.length,0);assert.equal(w.store.get().day?.claimed,1);
  }finally{await w.close();}
});
for(const originalEnd of [9*60,22*60])void test(`a same-day future waking start replans from end ${originalEnd} without resetting a prior claim`,async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false,wakingEndMinute:originalEnd}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-45_000);assert.equal(w.store.get().day?.claimed,1);
    await w.owner.save({expectedSettingsRevision:1,policy:{...policy,ambient:false,wakingStartMinute:10*60}});assert.equal(w.owner.get().nextOpportunity,null);
    await w.move(local(10));const next=w.owner.get().nextOpportunity;assert.ok(next!==null);assert.ok(next.startAtMs>local(10)+45_000);
    assert.equal(w.store.get().day?.claimed,1);await w.restart();assert.equal(w.store.get().day?.claimed,1);assert.deepEqual(w.failures,[]);
  }finally{await w.close();}
});
void test('browser and an exact configured display named browser have separate one-use permits',async()=>{
  const w=scheduledWorld(true,()=>0.5,'browser');try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,targets:['browser']}});await flush();
    const selected=w.commands.find(command=>(command.draft.data as ArtAuto22).action==='ambient');assert.ok(selected);const data=selected.draft.data as ArtAuto22;
    assert.equal(data.action,'ambient');if(data.action!=='ambient')return;
    assert.equal(w.commands.filter(command=>(command.draft.data as ArtAuto22).action==='present').length,1);
    assert.equal(w.owner.authorizeAmbient(data.authorization,'browser',data.compositionId),undefined);
    assert.equal(w.owner.authorizeAmbient(data.authorization,'browser',data.compositionId)?.error.code,'forbidden');
  }finally{await w.close();}
});
void test('restart after a generation claim never replays it or presents its later completion',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false,generation:true}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-300_000);assert.equal(w.commands.length,1);const request=w.commands[0]?.requestId;assert.ok(request!==undefined);await w.restart();
    w.catalog.artworks.unshift(artwork('new-art'));w.catalog.jobs.push({requestId:request,purpose:'appearance',admittedBy:'automatic',status:'finished',outcome:'succeeded',artworkId:'new-art',createdAtMs:start-300_000,finishedAtMs:start-60_000,targets:[]});
    await w.move(start-45_000);await w.move(start);assert.equal(w.commands.length,1);assert.equal(w.store.get().day?.claimed,1);assert.deepEqual(w.failures,[]);
  }finally{await w.close();}
});
void test('failed final handoff persistence emits no selection and keeps the opportunity spent',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start-45_000);w.db.exec("CREATE TRIGGER refuse_handoff BEFORE INSERT ON automation_art_claims WHEN NEW.id LIKE '%-handoff-%' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    await w.move(start);assert.equal(w.commands.length,0);assert.equal(w.store.get().day?.claimed,1);assert.ok(w.failures.length>0);
    w.db.exec('DROP TRIGGER refuse_handoff');await w.restart();await w.move(start+1000);assert.equal(w.commands.length,0);
  }finally{await w.close();}
});
void test('a missed slot records expiration and cannot be refilled by a same-day policy replan',async()=>{
  const w=scheduledWorld();try{
    const saved=await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false,generation:true}});const start=saved.nextOpportunity?.startAtMs;assert.ok(start!==undefined);
    await w.move(start+1001);assert.equal(w.commands.length,0);assert.equal(w.store.get().day?.claimed,1);assert.equal(w.owner.get().lastOpportunity?.reason,'expired');
    assert.equal(w.shared.handedFlourishes(local(0)),0,'an expired unstarted opportunity reserves no provider or moment effect');
    await w.owner.save({expectedSettingsRevision:1,policy:{...policy,ambient:false,wakingStartMinute:9*60,wakingEndMinute:23*60}});
    assert.equal(w.store.get().day?.claimed,1);assert.equal(w.store.get().day?.starts.length,6);await w.restart();assert.equal(w.store.get().day?.claimed,1);assert.equal(w.commands.length,0);
  }finally{await w.close();}
});
void test('a complete saved-art waking day stays spent through backward clock movement and rolls forward once',async()=>{
  const w=scheduledWorld();try{
    await w.owner.save({expectedSettingsRevision:0,policy:{...policy,ambient:false}});
    const starts=w.store.get().day?.starts.slice();assert.ok(starts!==undefined);assert.equal(starts.length,7);
    for(const start of starts){await w.move(start-45_000);await w.move(start);}
    assert.equal(w.commands.length,7);assert.equal(w.store.get().day?.claimed,7);
    assert.ok(w.commands.every(command=>(command.draft.data as ArtAuto22).action==='present'));
    await w.move(local(8));await w.restart();await w.move(local(22));assert.equal(w.commands.length,7);assert.equal(w.store.get().day?.claimed,7);
    await w.move(new Date(2026,10,6,8).getTime());assert.equal(w.store.get().day?.claimed,0);assert.equal(w.store.get().day?.starts.length,7);
    const nextDay=w.store.get().day?.key;await w.move(local(8));await w.restart();assert.equal(w.store.get().day?.key,nextDay);assert.equal(w.commands.length,7);
    assert.deepEqual(w.failures,[]);
  }finally{await w.close();}
});
