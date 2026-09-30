import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../dist/server.js';
import {startFakeController} from './fake-controller.mjs';
import {DatabaseSync} from 'node:sqlite';

// Hub #358: event rules, the interrupt set, intake, arbitration, hand-off and the automation log.
const token='a'.repeat(43),readToken='b'.repeat(43),wallToken='c'.repeat(43),ingestToken='d'.repeat(43);
const hash=value=>createHash('sha256').update(value).digest('hex');
const credentials=[{id:'owner-cli',digest:hash(token),scopes:['read','control'],devices:['wall','panel','cube','lamp']},
 {id:'reader',digest:hash(readToken),scopes:['read'],devices:['wall','panel','cube']},
 {id:'wall-only',digest:hash(wallToken),scopes:['read','control'],devices:['wall']},
 {id:'producer',digest:hash(ingestToken),scopes:['ingest'],devices:[]}];
// Unreachable endpoints: these tests inject the target reader and the sender, so nothing contacts a controller.
const controller=(id,kind,port)=>({id,kind,controllerId:'c-'+id,deviceId:'d-'+id,endpoint:`http://127.0.0.1:${port}/controller/v1`,token:'t'.repeat(43)});
const controllers=[controller('wall','nanoleaf',9),controller('panel','pixoo',9),controller('cube','nanoleaf',9)];
const fixtures=JSON.parse(await readFile(new URL('../fixtures/controller-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
// The shared 1.1 receipt fixture is a failed moment; a queued receipt carries no failure.
const {failure:_,...validReceipt}=structuredClone(fixtures.schemaCases.find(c=>c.definition==='receiptV1_1'&&c.valid).value);
const DEFAULT_SETTINGS={noFlourishes:false,quietHours:{enabled:false,start:'22:00',end:'07:00',timeZone:null},
 budgets:{perAgentTask:1,perAgentHour:2,globalHour:6,deviceSpacingMs:300000}};
const DEFAULT_KINDS=['ci.failed','meeting.reminder','pull-request.merged'];

/** A fake of the #335 single-device sender: one call, one moment, one target, one typed result. */
function fakeSender(answer=()=>({kind:'receipt',receipt:{...validReceipt,outcome:'queued'}})){
 const calls=[];
 return {calls,send:async input=>{calls.push(structuredClone(input));const value=await answer(input);return value && typeof value==='object' ? {momentId:input.moment.momentId,start:null,...value} : value;}};
}
async function open({sender,targets,clock,monotonic,directory}={}){
 directory??=await mkdtemp(join(tmpdir(),'hub-automation-'));
 const hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers,...(clock?{clock}:{})},undefined,undefined,
  {...(sender?{sender:sender.send}:{}),targets:targets??(async()=>({presentation:'content',alert:'none'})),...(monotonic?{monotonic}:{})});
 const call=async(method,path,body,credential=token,headers={})=>{
  const response=await fetch(hub.url+path,{method,headers:{authorization:`Bearer ${credential}`,...(method==='GET'?{}:{'x-pixoo-request':'1'}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
 };
 return {hub,directory,call};
}
const rule=(overrides={})=>({name:'Merged pull request',kind:'event',enabled:true,trigger:{source:'github',kind:'pull-request.merged'},
 action:{mood:'celebrate',priorityClass:'event',durationMs:5000,palette:['#10b981'],targets:['wall','panel']},...overrides});
const live=(id,overrides={})=>({id,source:'github',kind:'pull-request.merged',delivery:'live',...overrides});
const log=async call=>(await call('GET','/api/automation/v1/log')).body.entries;

test('rules, the interrupt set and settings persist across a restart and defaults seed exactly once (AC1)',async()=>{
 let opened=await open();const {directory}=opened;
 try{
  let {call}=opened;
  assert.deepEqual((await call('GET','/api/automation/v1/interrupt-set')).body,{kinds:DEFAULT_KINDS});
  assert.deepEqual((await call('GET','/api/automation/v1/settings')).body,DEFAULT_SETTINGS);
  const created=await call('POST','/api/automation/v1/rules',rule());
  assert.equal(created.status,201);
  assert.match(created.body.id,/^rule-[0-9a-f-]{36}$/);
  assert.equal(created.body.enabled,true);assert.equal(created.body.createdAtMs,created.body.updatedAtMs);
  assert.equal((await call('PUT','/api/automation/v1/interrupt-set',{kinds:[]})).status,200);
  const settings={...DEFAULT_SETTINGS,noFlourishes:true,quietHours:{enabled:true,start:'23:30',end:'06:15',timeZone:'UTC'}};
  assert.deepEqual((await call('PUT','/api/automation/v1/settings',settings)).body,settings);
  const rules=(await call('GET','/api/automation/v1/rules')).body;
  await opened.hub.close();
  // Reopen the same store: an owner's empty interrupt set is not re-seeded.
  opened=await open({directory});({call}=opened);
  assert.deepEqual((await call('GET','/api/automation/v1/rules')).body,rules);
  assert.deepEqual((await call('GET','/api/automation/v1/interrupt-set')).body,{kinds:[]});
  assert.deepEqual((await call('GET','/api/automation/v1/settings')).body,settings);
  assert.deepEqual((await call('GET',`/api/automation/v1/rules/${created.body.id}`)).body,created.body);
 }finally{await opened.hub.close();await rm(directory,{recursive:true,force:true});}
});

test('routes enforce scopes, the write header, device grants and typed errors (AC1)',async()=>{
 const {hub,directory,call}=await open();
 try{
  assert.equal((await fetch(hub.url+'/api/automation/v1/rules')).status,401);
  assert.equal((await call('GET','/api/automation/v1/rules',undefined,ingestToken)).status,403);
  assert.equal((await call('POST','/api/automation/v1/rules',rule(),readToken)).status,403);
  assert.equal((await call('POST','/api/automation/v1/rules',rule(),token,{'x-pixoo-request':'0'})).status,403);
  assert.equal((await call('PUT','/api/automation/v1/interrupt-set',{kinds:[]},readToken)).status,403);
  // A token may automate only devices it can command.
  assert.deepEqual(await call('POST','/api/automation/v1/rules',rule(),wallToken),{status:403,body:{error:{code:'forbidden'}}});
  const own=await call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['wall']}}),wallToken);
  assert.equal(own.status,201);
  const shared=(await call('POST','/api/automation/v1/rules',rule({enabled:false}))).body;
  assert.equal((await call('POST',`/api/automation/v1/rules/${shared.id}/enable`,{},wallToken)).status,403);
  assert.equal((await call('PUT',`/api/automation/v1/rules/${shared.id}`,{name:'x',kind:'event',trigger:rule().trigger,action:rule().action},wallToken)).status,403);
  assert.equal((await call('POST',`/api/automation/v1/rules/${shared.id}/disable`,{},wallToken)).status,200);
  const bad=async(body,code)=>assert.deepEqual(await call('POST','/api/automation/v1/rules',body),{status:400,body:{error:{code}}},code+' '+JSON.stringify(body));
  await bad({...rule(),extra:1},'invalid-rule');
  await bad({...rule(),kind:'routine'},'invalid-rule');
  await bad({...rule(),name:''},'invalid-rule');
  await bad({...rule(),name:'Deploy Bearer abcdefghijklmnopqrstuvwxyz'},'invalid-rule');
  await bad({...rule(),enabled:'yes'},'invalid-rule');
  await bad({...rule(),trigger:{source:'github'}},'invalid-trigger');
  await bad({...rule(),trigger:{source:'github',kind:'Pull Request!'}},'invalid-trigger');
  await bad({...rule(),trigger:{source:'github',kind:'ci.failed',alias:'a b'}},'invalid-trigger');
  await bad({...rule(),trigger:{source:'github',kind:'ci.failed',extra:true}},'invalid-trigger');
  await bad({...rule(),action:{...rule().action,durationMs:999}},'invalid-action');
  await bad({...rule(),action:{...rule().action,durationMs:300001}},'invalid-action');
  await bad({...rule(),action:{...rule().action,palette:['red']}},'invalid-action');
  await bad({...rule(),action:{...rule().action,palette:[]}},'invalid-action');
  await bad({...rule(),action:{...rule().action,priorityClass:'urgent'}},'invalid-action');
  await bad({...rule(),action:{...rule().action,targets:['wall','wall']}},'invalid-action');
  await bad({...rule(),action:{...rule().action,targets:[]}},'invalid-action');
  await bad({...rule(),action:{...rule().action,coversStatus:true}},'invalid-action');
  await bad({...rule(),action:{...rule().action,targets:['wall','attic']}},'unknown-target');
  // Owner-chosen IDs pass the lifecycle contract's credential screen too.
  await bad({...rule(),action:{...rule().action,mood:'ghp_'+'a'.repeat(36)}},'invalid-action');
  await bad({...rule(),trigger:{source:'github',kind:'ci.failed',alias:'ghp_'+'a'.repeat(36)}},'invalid-trigger');
  assert.deepEqual(hub.automation.submit(live('ghp_'+'a'.repeat(36))),{accepted:false,reason:'invalid-event'});
  // The screen looks for token prefixes at word starts only: ordinary hyphenated IDs stay valid.
  const hyphenated=await call('POST','/api/automation/v1/rules',rule({enabled:false,trigger:{source:'github',kind:'ci.failed',alias:'disk-usage-analyzer-tool'},action:{...rule().action,mood:'desk-lamp-glow-effect'}}));
  assert.equal(hyphenated.status,201);
  assert.equal((await call('DELETE',`/api/automation/v1/rules/${hyphenated.body.id}`)).status,200);
  assert.deepEqual(hub.automation.submit(live('task-complete-sparkle-long',{kind:'nothing.matches'})),{accepted:true,matched:0});
  const widest=Array.from({length:64},(_,index)=>'k'+String(index).padStart(2,'0')+'.'+'a'.repeat(60));
  assert.equal((await call('PUT','/api/automation/v1/interrupt-set',{kinds:widest})).status,200,'the largest valid interrupt set fits the body limit');
  assert.deepEqual(await call('PUT','/api/automation/v1/interrupt-set',{kinds:['ci.failed','ci.failed']}),{status:400,body:{error:{code:'invalid-interrupt-set'}}});
  assert.deepEqual(await call('PUT','/api/automation/v1/interrupt-set',{kinds:['CI failed']}),{status:400,body:{error:{code:'invalid-interrupt-set'}}});
  for(const settings of [{...DEFAULT_SETTINGS,noFlourishes:1},{...DEFAULT_SETTINGS,quietHours:{...DEFAULT_SETTINGS.quietHours,start:'24:00'}},
   {...DEFAULT_SETTINGS,quietHours:{...DEFAULT_SETTINGS.quietHours,timeZone:'Mars/Olympus'}},{...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,globalHour:-1}},{...DEFAULT_SETTINGS,extra:true}])
   assert.deepEqual(await call('PUT','/api/automation/v1/settings',settings),{status:400,body:{error:{code:'invalid-settings'}}});
  assert.deepEqual(await call('GET','/api/automation/v1/rules/rule-missing'),{status:404,body:{error:{code:'unknown-rule'}}});
  assert.deepEqual(await call('DELETE','/api/automation/v1/rules/rule-missing'),{status:404,body:{error:{code:'unknown-rule'}}});
  assert.equal((await call('GET','/api/automation/v1/rules?all=1')).status,400);
  assert.equal((await call('GET','/api/automation/v1/log?limit=501')).status,400);
  assert.equal((await call('POST','/api/automation/v1/settings',DEFAULT_SETTINGS)).status,404);
  // Updates replace the definition and keep the enabled flag; delete removes the rule.
  const updated=await call('PUT',`/api/automation/v1/rules/${own.body.id}`,{name:'CI failed',kind:'event',trigger:{source:'github',kind:'ci.failed',alias:'hub-repo'},action:{mood:'setback',priorityClass:'event',durationMs:4000,targets:['wall']}},wallToken);
  assert.equal(updated.status,200);assert.equal(updated.body.enabled,true);assert.equal(updated.body.trigger.alias,'hub-repo');assert.equal(updated.body.createdAtMs,own.body.createdAtMs);
  assert.deepEqual(await call('DELETE',`/api/automation/v1/rules/${own.body.id}`),{status:200,body:{deleted:true,id:own.body.id}});
  assert.equal((await call('GET','/api/automation/v1/rules')).body.rules.length,1);
  // Rule capacity is bounded.
  for(let index=1;index<64;index++)assert.equal((await call('POST','/api/automation/v1/rules',rule({enabled:false}))).status,201);
  assert.deepEqual(await call('POST','/api/automation/v1/rules',rule()),{status:429,body:{error:{code:'capacity'}}});
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('an event produces one moment per target with the derived coversStatus; disabled rules and duplicate IDs produce nothing (AC2)',async()=>{
 const sender=fakeSender();let mono=5000;
 const {hub,directory,call}=await open({sender,monotonic:()=>mono});
 try{
  const merged=(await call('POST','/api/automation/v1/rules',rule())).body;
  const review=(await call('POST','/api/automation/v1/rules',rule({name:'Review requested',trigger:{source:'github',kind:'review.requested'},action:{mood:'reminder',priorityClass:'event',durationMs:3000,targets:['cube']}}))).body;
  await call('POST','/api/automation/v1/rules',rule({name:'Disabled',enabled:false,trigger:{source:'github',kind:'ci.failed'}}));
  assert.deepEqual(hub.automation.submit(live('pr-1')),{accepted:true,matched:1});
  await hub.automation.settled();
  assert.equal(sender.calls.length,2);
  const [first,second]=sender.calls;
  assert.deepEqual(first.moment,second.moment,'the same moment reaches every target');
  assert.deepEqual(first.moment,{momentId:first.moment.momentId,mood:'celebrate',palette:['#10b981'],durationMs:5000,priorityClass:'event',coversStatus:true});
  assert.match(first.moment.momentId,/^m-[0-9a-f]{40}$/);
  assert.deepEqual(sender.calls.map(c=>c.target).sort(),['panel','wall']);
  assert.equal(first.startAt,6000,'one hub-monotonic start instant with the lead');assert.equal(second.startAt,6000);
  // A kind outside the interrupt set still produces the moment, without status cover.
  assert.deepEqual(hub.automation.submit(live('rr-1',{kind:'review.requested'})),{accepted:true,matched:1});
  await hub.automation.settled();
  assert.equal(sender.calls.length,3);assert.equal(sender.calls[2].moment.coversStatus,false);assert.equal(sender.calls[2].target,'cube');
  assert.notEqual(sender.calls[2].moment.momentId,first.moment.momentId);
  // Disabled rule, duplicate ID and a trigger alias that does not match all produce nothing.
  assert.deepEqual(hub.automation.submit(live('ci-1',{kind:'ci.failed'})),{accepted:true,matched:0});
  assert.deepEqual(hub.automation.submit(live('pr-1')),{accepted:false,reason:'duplicate'});
  await call('PUT',`/api/automation/v1/rules/${review.id}`,{name:'Review on hub',kind:'event',trigger:{source:'github',kind:'review.requested',alias:'hub-repo'},action:{mood:'reminder',priorityClass:'event',durationMs:3000,targets:['cube']}});
  assert.deepEqual(hub.automation.submit(live('rr-2',{kind:'review.requested',alias:'other-repo'})),{accepted:true,matched:0});
  assert.deepEqual(hub.automation.submit(live('rr-3',{kind:'review.requested',alias:'hub-repo'})),{accepted:true,matched:1});
  // The same kind from another source is a different trigger.
  assert.deepEqual(hub.automation.submit(live('pr-1',{source:'forge'})),{accepted:true,matched:0});
  await hub.automation.settled();
  assert.equal(sender.calls.length,4);
  assert.deepEqual(hub.automation.submit({id:'x',source:'github',kind:'pull-request.merged'}),{accepted:false,reason:'invalid-event'});
  assert.deepEqual(hub.automation.submit({...live('y'),title:'free text'}),{accepted:false,reason:'invalid-event'});
  const entries=await log(call);
  assert.equal(entries.length,4);
  assert.deepEqual(entries.map(e=>e.outcome),['receipt','receipt','receipt','receipt']);
  const wall=entries.find(e=>e.target==='wall');
  assert.deepEqual(Object.keys(wall).sort(),['atMs','coversStatus','event','momentId','outcome','priorityClass','receipt','ruleId','seq','target']);
  assert.deepEqual(wall.event,{source:'github',id:'pr-1',kind:'pull-request.merged'});
  assert.equal(wall.ruleId,merged.id);assert.equal(wall.coversStatus,true);
  assert.deepEqual(wall.receipt,{apiVersion:validReceipt.apiVersion,requestId:validReceipt.requestId,outcome:'queued',priorEffects:validReceipt.priorEffects});
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('events handled before shutdown are not reprocessed after a restart, and a replay stream reaches no rule (AC5)',async()=>{
 let sender=fakeSender();
 let opened=await open({sender});const {directory}=opened;
 try{
  await opened.call('POST','/api/automation/v1/rules',rule());
  // An event that matches no rule yet is still remembered across the restart.
  assert.deepEqual(opened.hub.automation.submit(live('rr-7',{kind:'review.requested'})),{accepted:true,matched:0});
  assert.equal(opened.hub.automation.submit(live('pr-7')).accepted,true);
  await opened.hub.automation.settled();assert.equal(sender.calls.length,2);
  await opened.hub.close();
  sender=fakeSender();opened=await open({sender,directory});
  assert.deepEqual(opened.hub.automation.submit(live('pr-7')),{accepted:false,reason:'duplicate'});
  await opened.call('POST','/api/automation/v1/rules',rule({name:'Review requested',trigger:{source:'github',kind:'review.requested'}}));
  assert.deepEqual(opened.hub.automation.submit(live('rr-7',{kind:'review.requested'})),{accepted:false,reason:'duplicate'});
  for(let index=0;index<5;index++)assert.deepEqual(opened.hub.automation.submit(live('history-'+index,{delivery:'replay'})),{accepted:false,reason:'replay'});
  await opened.hub.automation.settled();
  assert.equal(sender.calls.length,0);
  assert.equal((await log(opened.call)).length,2,'only the two entries from before the restart');
  // A replayed ID was not consumed; a later live delivery of it is evaluated once.
  assert.deepEqual(opened.hub.automation.submit(live('history-0')),{accepted:true,matched:1});
  await opened.hub.automation.settled();assert.equal(sender.calls.length,2);
 }finally{await opened.hub.close();await rm(directory,{recursive:true,force:true});}
});

test('rules created by anything other than the owner route are stored disabled',async()=>{
 const sender=fakeSender();
 const {hub,directory,call}=await open({sender});
 try{
  const proposed=hub.automation.propose(rule());
  assert.equal(proposed.enabled,false);
  assert.deepEqual((await call('GET',`/api/automation/v1/rules/${proposed.id}`)).body,proposed);
  assert.deepEqual(hub.automation.submit(live('pr-2')),{accepted:true,matched:0});
  await call('POST',`/api/automation/v1/rules/${proposed.id}/enable`,{});
  assert.deepEqual(hub.automation.submit(live('pr-3')),{accepted:true,matched:1});
  await hub.automation.settled();assert.equal(sender.calls.length,2);
  assert.throws(()=>hub.automation.propose({...rule(),kind:'routine'}),/invalid-rule/);
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('arbitration blocks in order with the stated reason and hands nothing over (AC3)',async()=>{
 const sender=fakeSender();
 // 2026-09-29T12:00:00Z; quiet hours below are set around it in UTC.
 let now=Date.parse('2026-09-29T12:00:00Z');
 const states={wall:{presentation:'content',alert:'none'},panel:{presentation:'content',alert:'none'},cube:{presentation:'content',alert:'none'}};
 const {hub,directory,call}=await open({sender,clock:()=>now,targets:async alias=>states[alias]});
 // The newest `count` entries as sorted target:outcome:reason triples.
 const reasons=async count=>(await log(call)).slice(0,count).map(e=>`${e.target}:${e.outcome}:${e.reason ?? ''}`).sort();
 const flourish=(targets=['wall'])=>rule({name:'Agent done',trigger:{source:'agent-lifecycle',kind:'agent.turn.ended'},action:{mood:'celebrate',priorityClass:'flourish',durationMs:2000,targets}});
 let sequence=0;const agentEvent=(agent='agent-a',task='task-'+(++sequence))=>live('e-'+(++sequence),{source:'agent-lifecycle',kind:'agent.turn.ended',agent,task});
 const settings=async patch=>assert.equal((await call('PUT','/api/automation/v1/settings',{...DEFAULT_SETTINGS,...patch,budgets:{...DEFAULT_SETTINGS.budgets,...patch.budgets}})).status,200);
 const clear=async()=>{for(const r of (await call('GET','/api/automation/v1/rules')).body.rules)await call('DELETE',`/api/automation/v1/rules/${r.id}`);};
 try{
  // The global switch applies to flourishes only and wins over quiet hours.
  await call('POST','/api/automation/v1/rules',flourish(['wall','panel']));
  await settings({noFlourishes:true,quietHours:{enabled:true,start:'11:00',end:'13:00',timeZone:'UTC'}});
  hub.automation.submit(agentEvent());await hub.automation.settled();
  assert.deepEqual(await reasons(2),['panel:blocked:no-flourishes','wall:blocked:no-flourishes']);
  // Quiet hours apply to every class, including a window that crosses midnight.
  await settings({quietHours:{enabled:true,start:'11:00',end:'13:00',timeZone:'UTC'}});
  hub.automation.submit(agentEvent());await hub.automation.settled();
  assert.deepEqual(await reasons(2),['panel:blocked:quiet-hours','wall:blocked:quiet-hours']);
  await clear();await call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['cube']}}));
  await settings({quietHours:{enabled:true,start:'22:00',end:'12:30',timeZone:'UTC'}});
  hub.automation.submit(live('pr-q'));await hub.automation.settled();
  assert.deepEqual(await reasons(1),['cube:blocked:quiet-hours']);
  // The same instant is 21:00 in Tokyo, outside the window, so the event goes through.
  await settings({quietHours:{enabled:true,start:'22:00',end:'12:30',timeZone:'Asia/Tokyo'}});
  hub.automation.submit(live('pr-q2'));await hub.automation.settled();
  assert.equal(sender.calls.length,1);
  // Budgets: one flourish per agent task, two per agent per hour, three (lowered) overall per hour.
  await clear();await settings({budgets:{globalHour:3,deviceSpacingMs:0}});
  await call('POST','/api/automation/v1/rules',flourish(['wall']));
  hub.automation.submit(agentEvent('agent-a','task-1'));await hub.automation.settled();
  hub.automation.submit(agentEvent('agent-a','task-1'));await hub.automation.settled();
  assert.equal((await log(call))[0].reason,'agent-task-budget');
  hub.automation.submit(agentEvent('agent-a','task-2'));await hub.automation.settled();
  hub.automation.submit(agentEvent('agent-a','task-3'));await hub.automation.settled();
  assert.equal((await log(call))[0].reason,'agent-hourly-budget');
  hub.automation.submit(agentEvent('agent-b','task-1'));await hub.automation.settled();
  hub.automation.submit(agentEvent('agent-c','task-1'));await hub.automation.settled();
  assert.equal((await log(call))[0].reason,'global-hourly-budget');
  assert.equal(sender.calls.length,4,'three flourishes plus the earlier event moment');
  // An hour later the budgets have room again; the per-device spacing now applies per target.
  now+=60*60*1000+1;await settings({budgets:{deviceSpacingMs:300000}});
  await clear();await call('POST','/api/automation/v1/rules',flourish(['wall','panel']));
  hub.automation.submit(agentEvent('agent-d'));await hub.automation.settled();
  assert.equal(sender.calls.length,6);
  now+=60000;hub.automation.submit(agentEvent('agent-e'));await hub.automation.settled();
  assert.deepEqual(await reasons(2),['panel:blocked:device-spacing','wall:blocked:device-spacing']);
  // Event moments are not budgeted; a Quiet target and an alert on status block per target.
  await clear();await call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['wall','panel','cube']}}));
  states.wall={presentation:'quiet',alert:'none'};states.panel={presentation:'status',alert:'active'};states.cube={presentation:'content',alert:'active'};
  hub.automation.submit(live('pr-9'));await hub.automation.settled();
  assert.deepEqual(await reasons(3),['cube:receipt:','panel:blocked:alert','wall:blocked:quiet']);
  assert.equal(sender.calls.length,7);assert.equal(sender.calls.at(-1).target,'cube','an alert over content does not block');
  // Unknown evidence does not block at the hub.
  states.wall={presentation:'unknown',alert:'unknown',moments:'unknown'};states.panel={presentation:'status',alert:'unknown'};
  hub.automation.submit(live('pr-10'));await hub.automation.settled();
  assert.equal(sender.calls.length,10);
  // A target that cannot play moments is blocked before any other target check.
  states.wall={presentation:'quiet',alert:'none',moments:'1.0-only'};states.panel={presentation:'content',alert:'none',moments:'unsupported'};states.cube={presentation:'content',alert:'none',moments:'supported'};
  hub.automation.submit(live('pr-11'));await hub.automation.settled();
  assert.deepEqual(await reasons(3),['cube:receipt:','panel:blocked:moments-unsupported','wall:blocked:1.0-only']);
  assert.equal(sender.calls.length,11);
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('each target is handed the moment once; failures are logged per target and nothing retries (AC4)',async()=>{
 const sender=fakeSender(({target,moment})=>{
  if(target==='wall')throw new Error('PRIVATE_CANARY socket reset');
  if(target==='panel')return {kind:'receipt',receipt:{...validReceipt,outcome:'failed',failure:{code:'moment-blocked'}},note:'PRIVATE_CANARY'};
  return {kind:'receipt',receipt:{...validReceipt,outcome:'queued'}};
 });
 const {hub,directory,call}=await open({sender});
 try{
  await call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['wall','panel','cube']}}));
  hub.automation.submit(live('pr-1'));await hub.automation.settled();
  assert.deepEqual(sender.calls.map(c=>c.target).sort(),['cube','panel','wall']);
  let entries=await log(call);
  const by=target=>entries.find(e=>e.target===target);
  assert.deepEqual([by('wall').outcome,by('wall').reason],['uncertain','sender-error']);
  assert.deepEqual([by('panel').outcome,by('panel').reason,by('panel').receipt.failure],['receipt','moment-blocked',{code:'moment-blocked'}]);
  assert.equal(by('cube').outcome,'receipt');
  assert.ok(!JSON.stringify(entries).includes('PRIVATE_CANARY'));
  // Every typed sender result is logged for its own target.
  const start={domain:'controller-monotonic',epoch:'runtime-1',atMs:4000,toleranceMs:10000};
  const answers={wall:{kind:'receipt',start,receipt:{...validReceipt,outcome:'failed',failure:{code:'moment-missed'}}},panel:{kind:'receipt',receipt:{...validReceipt,outcome:'failed',failure:{code:'unsupported-capability'}}},cube:{kind:'not-sent',reason:'1.0-only'}};
  sender.calls.length=0;
  const second=fakeSender(({target})=>answers[target]);
  const reopened=await (async()=>{await hub.close();return open({sender:second,directory});})();
  try{
   reopened.hub.automation.submit(live('pr-2'));await reopened.hub.automation.settled();
   entries=await log(reopened.call);
   assert.deepEqual(entries.slice(0,3).map(e=>`${e.target}:${e.outcome}:${e.reason}`).sort(),['cube:not-sent:1.0-only','panel:receipt:unsupported-capability','wall:receipt:moment-missed']);
   assert.deepEqual(entries.find(e=>e.target==='wall').start,start,'a valid controller start is kept');
   assert.equal(entries.find(e=>e.target==='cube').start,undefined);
   // A receipt outside the contract is not stored; its content never reaches the log.
   answers.wall={kind:'uncertain',start:{...start,extra:'PRIVATE_CANARY'}};answers.panel={kind:'receipt',receipt:{...validReceipt,outcome:'queued',token:'PRIVATE_CANARY'}};answers.cube={kind:'not-sent',reason:'capacity'};
   reopened.hub.automation.submit(live('pr-3'));await reopened.hub.automation.settled();
   entries=await log(reopened.call);
   assert.deepEqual(entries.slice(0,3).map(e=>`${e.target}:${e.outcome}:${e.reason ?? ''}`).sort(),['cube:not-sent:capacity','panel:uncertain:invalid-result','wall:uncertain:']);
   assert.ok(!JSON.stringify(entries).includes('PRIVATE_CANARY'));
   assert.equal(second.calls.length,6,'one call per target per event, no retries');
   // Paging reads newest first with a cursor.
   const page=(await reopened.call('GET','/api/automation/v1/log?limit=2')).body;
   assert.equal(page.entries.length,2);assert.ok(page.entries[0].seq>page.entries[1].seq);
   const next=(await reopened.call('GET',`/api/automation/v1/log?limit=2&before=${page.next}`)).body;
   assert.ok(next.entries[0].seq<page.entries[1].seq);
  }finally{await reopened.hub.close();}
  // Without a composed sender nothing is handed over and the log says why.
  const bare=await open({directory});
  try{
   bare.hub.automation.submit(live('pr-4'));await bare.hub.automation.settled();
   assert.deepEqual((await log(bare.call)).slice(0,3).map(e=>`${e.target}:${e.outcome}:${e.reason}`).sort(),['cube:blocked:sender-unavailable','panel:blocked:sender-unavailable','wall:blocked:sender-unavailable']);
  }finally{await bare.hub.close();}
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('newly applied lifecycle events reach the rules once and never delay ingest',async()=>{
 const sender=fakeSender();
 const {hub,directory,call}=await open({sender});
 try{
  await call('POST','/api/automation/v1/rules',rule({name:'Turn ended',trigger:{source:'agent-lifecycle',kind:'agent.turn.ended'},action:{mood:'celebrate',priorityClass:'event',durationMs:2000,targets:['wall']}}));
  const identity={provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'};
  const envelope=kind=>({apiVersion:'1.0',identity,turn:{status:'known',id:'turn-1'},parent:{status:'unknown'},event:{kind},observedAtMs:Date.now(),ordering:{status:'unknown'}});
  const ingest=body=>call('POST','/api/monitor/v1/events',body,ingestToken);
  assert.equal((await ingest(envelope('session.started'))).status,200);
  const ended=envelope('turn.ended');
  assert.equal((await ingest(ended)).body.outcome,'applied');
  assert.equal((await ingest(ended)).body.outcome,'duplicate');
  await hub.automation.settled();
  assert.equal(sender.calls.length,1);
  const [entry]=await log(call);
  assert.equal(entry.event.source,'agent-lifecycle');assert.equal(entry.event.kind,'agent.turn.ended');assert.match(entry.event.id,/^[0-9a-f]{64}$/);
  assert.equal(entry.priorityClass,'event');assert.equal(entry.coversStatus,false);
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('against the shared fake controllers, the composed reader blocks 1.0-only, Quiet and alerted status targets with no controller command (AC2 to AC4)',async t=>{
 // Hub #576 fakes: 1.1 controllers in Work, Quiet and Free, and a 1.0-only controller.
 const work=await startFakeController({serves:'1.1',controllerId:'c-wall',deviceId:'d-wall'});t.after(work.close);
 const quiet=await startFakeController({serves:'1.1',controllerId:'c-panel',deviceId:'d-panel',mode:'Quiet'});t.after(quiet.close);
 const free=await startFakeController({serves:'1.1',controllerId:'c-cube',deviceId:'d-cube',mode:'Free'});t.after(free.close);
 const legacy=await startFakeController({serves:'1.0',controllerId:'c-lamp',deviceId:'d-lamp'});t.after(legacy.close);
 const fakes=[work,quiet,free,legacy];
 const directory=await mkdtemp(join(tmpdir(),'hub-automation-fakes-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const configs=[work.config({id:'wall'}),quiet.config({id:'panel'}),free.config({id:'cube'}),legacy.config({id:'lamp'})];
 const start=async sender=>{
  const hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:configs},undefined,undefined,sender?{sender:sender.send}:undefined);
  const call=async(method,path,body,credential=token)=>{const response=await fetch(hub.url+path,{method,headers:{authorization:`Bearer ${credential}`,'x-pixoo-request':'1','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
  return {hub,call};
 };
 const sender=fakeSender();
 let {hub,call}=await start(sender);
 try{
  await call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['wall','panel','cube','lamp']}}));
  hub.automation.submit(live('pr-1'));await hub.automation.settled();
  const latest=async count=>(await log(call)).slice(0,count).map(e=>`${e.target}:${e.outcome}:${e.reason ?? ''}`).sort();
  assert.deepEqual(await latest(4),['cube:receipt:','lamp:blocked:1.0-only','panel:blocked:quiet','wall:receipt:']);
  assert.equal(legacy.reads.versioned(),1,'the 1.0-only fake was probed once at 1.1');
  assert.deepEqual(sender.calls.map(c=>`${c.target}:${c.moment.coversStatus}`).sort(),['cube:true','wall:true']);
  // Outstanding attention in the hub's agent state is an active alert: it blocks the status target, not the content one.
  const identity={provider:'claude',client:'code',hostId:'h',sourceId:'s',sessionId:'asks'};
  const ingest=kind=>call('POST','/api/monitor/v1/events',{apiVersion:'1.0',identity,turn:{status:'known',id:'t'},parent:{status:'unknown'},event:{kind,...(kind.startsWith('attention')?{attention:{status:'known',id:'q1'}}:{})},observedAtMs:Date.now(),ordering:{status:'unknown'}},ingestToken);
  assert.equal((await ingest('session.started')).status,200);assert.equal((await ingest('attention.input')).body.outcome,'applied');
  hub.automation.submit(live('pr-2'));await hub.automation.settled();
  assert.deepEqual(await latest(4),['cube:receipt:','lamp:blocked:1.0-only','panel:blocked:quiet','wall:blocked:alert']);
  assert.equal(sender.calls.length,3);
  assert.equal(legacy.reads.versioned(),1,'the 1.0-only verdict holds for its epoch');
  assert.ok(fakes.every(fake=>fake.reads()>0),'the composed reader read every target');
  await hub.close();
  // Without a composed sender every unblocked target is logged and nothing is sent. The stored attention still blocks the wall.
  ({hub,call}=await start());
  hub.automation.submit(live('pr-3'));await hub.automation.settled();
  assert.deepEqual(await latest(4),['cube:blocked:sender-unavailable','lamp:blocked:1.0-only','panel:blocked:quiet','wall:blocked:alert']);
  assert.deepEqual(fakes.map(fake=>fake.commands.length),[0,0,0,0],'no controller command from any path');
 }finally{await hub?.close();}
});

test('a staged migration destination refuses automation writes and intake',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-automation-staged-'));
 const hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers},{staged:true});
 try{
  const headers={authorization:`Bearer ${token}`,'x-pixoo-request':'1','content-type':'application/json'};
  assert.equal((await fetch(hub.url+'/api/automation/v1/rules',{headers})).status,200);
  const write=await fetch(hub.url+'/api/automation/v1/interrupt-set',{method:'PUT',headers,body:JSON.stringify({kinds:[]})});
  assert.deepEqual([write.status,await write.json()],[503,{error:{code:'owner-quiesced'}}]);
  assert.deepEqual(hub.automation.submit(live('pr-1')),{accepted:false,reason:'unavailable'});
 }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('a target removed from configuration is logged, and a full evaluation queue logs capacity',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;});
 const sender=fakeSender(async()=>{await held;return {kind:'receipt',receipt:{...validReceipt,outcome:'queued'}};});
 let opened=await open({sender});const {directory}=opened;
 try{
  await opened.call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['wall','cube']}}));
  await opened.hub.close();
  // Reconfigured without `cube`: the stored rule still loads, and its moment reaches `wall` only.
  opened={...opened,hub:await startHub({directory,ownerId:'owner',consumers:[],credentials:credentials.map(c=>({...c,devices:c.devices.filter(d=>d!=='cube')})),controllers:controllers.filter(c=>c.id!=='cube')},undefined,undefined,
   {sender:sender.send,targets:async()=>({presentation:'content',alert:'none'})})};
  const call=async path=>(await fetch(opened.hub.url+path,{headers:{authorization:`Bearer ${token}`}})).json();
  // The first event holds the sender; 32 more fill the queue and the next one is logged as capacity.
  for(let index=0;index<34;index++)assert.equal(opened.hub.automation.submit(live('burst-'+index)).accepted,true);
  await new Promise(resolve=>setImmediate(resolve));
  const blocked=(await call('/api/automation/v1/log')).entries;
  assert.deepEqual(blocked.filter(e=>e.reason==='capacity').map(e=>`${e.event.id}:${e.target}`).sort(),['burst-33:cube','burst-33:wall']);
  release();await opened.hub.automation.settled();
  const entries=(await call('/api/automation/v1/log?limit=500')).entries;
  assert.equal(entries.filter(e=>e.reason==='unknown-target'&&e.target==='cube').length,33);
  assert.equal(sender.calls.length,33);assert.ok(sender.calls.every(c=>c.target==='wall'));
 }finally{release();await opened.hub.close();await rm(directory,{recursive:true,force:true});}
});

test('disabling a rule stops events already waiting in the queue',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;});
 const sender=fakeSender(async()=>{await held;return {kind:'receipt',receipt:{...validReceipt,outcome:'queued'}};});
 const {hub,directory,call}=await open({sender});
 try{
  const created=(await call('POST','/api/automation/v1/rules',rule({action:{...rule().action,targets:['wall']}}))).body;
  assert.equal(hub.automation.submit(live('first')).accepted,true);
  assert.equal(hub.automation.submit(live('second')).accepted,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call('POST',`/api/automation/v1/rules/${created.id}/disable`,{})).body.enabled,false);
  release();await hub.automation.settled();
  assert.deepEqual(sender.calls.map(c=>c.target),['wall'],'only the event already in evaluation is handed over');
  assert.deepEqual((await log(call)).map(e=>e.event.id),['first']);
 }finally{release();await hub.close();await rm(directory,{recursive:true,force:true});}
});

test('a stored rule that no longer validates stops startup with invalid-state',async()=>{
 const opened=await open();const {directory}=opened;
 try{
  await opened.call('POST','/api/automation/v1/rules',rule());
  await opened.hub.close();
  const db=new DatabaseSync(join(directory,'state.sqlite'));
  try{db.prepare("UPDATE rules SET action='{}'").run();}finally{db.close();}
  await assert.rejects(startHub({directory,ownerId:'owner',consumers:[],credentials,controllers}),/invalid-state/);
 }finally{await opened.hub.close();await rm(directory,{recursive:true,force:true});}
});
