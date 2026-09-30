import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Hub #336: the Moments card's pure rules and its use of the shared command lifecycle.
const dir=await mkdtemp(join(tmpdir(),'dashboard-moments-'));
try {
 await build({stdin:{contents:"export * from './client';export * from './lifecycle';export * from './moments';",resolveDir:'apps/dashboard/src',loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:join(dir,'moments.mjs')});
 const {declaredMoments,moodLabel,moodChoices,durationPresets,undeclaredLine,momentMessage,momentReceiptMessage,momentLine,runCommand,commandTransition,initialCommand,momentWording,ApiError}=await import(join(dir,'moments.mjs'));
 const corpus=JSON.parse(await readFile('packages/contracts/fixtures/controller-v1.json','utf8'));
 const v10=structuredClone(corpus.schemaCases.find(c=>c.definition==='snapshot'&&c.valid).value);
 const v11=structuredClone(corpus.schemaCases.find(c=>c.id==='snapshot-v1.1-valid-playing').value);
 const capabilities=(snapshot,moments)=>({...snapshot,capabilities:{...snapshot.capabilities,moments}});
 const context={device:'wall',mood:'celebrate'};

 test('only a 1.1 snapshot that declares moments supported shows the card',()=>{
  assert.deepEqual(declaredMoments(v11),{moods:['celebrate','setback','reminder','cozy'],maxDurationMs:60000,coversStatus:true});
  assert.equal(declaredMoments(v10),undefined);
  assert.equal(declaredMoments(capabilities(v11,{supported:false})),undefined);
  assert.equal(declaredMoments(undefined),undefined);
  // A 1.0 snapshot never carries moments, even if a field says so.
  assert.equal(declaredMoments({...capabilities(v10,v11.capabilities.moments),apiVersion:'1.0'}),undefined);
 });

 test('moods are title-cased IDs, core moods get buttons and only extra moods fill the menu',()=>{
  assert.equal(moodLabel('celebrate'),'Celebrate');assert.equal(moodLabel('big-win'),'Big win');assert.equal(moodLabel('late_night.calm'),'Late night calm');
  assert.deepEqual(moodChoices({moods:['reminder','cozy','celebrate','setback','storm'],maxDurationMs:30000,coversStatus:true}),{core:['celebrate','setback','reminder'],more:['cozy','storm']});
  assert.deepEqual(moodChoices({moods:['celebrate','setback','reminder'],maxDurationMs:30000,coversStatus:true}).more,[]);
 });

 test('duration presets stay within the device limit',()=>{
  assert.deepEqual(durationPresets(20000),[5000,10000]);
  assert.deepEqual(durationPresets(30000),[5000,10000,30000]);
  assert.deepEqual(durationPresets(300000),[5000,10000,30000]);
  assert.deepEqual(durationPresets(4000),[]);
 });

 test('the undeclared line names moments without changing which general capabilities are named',()=>{
  const general=(snapshot,declared)=>({...snapshot,capabilities:{...snapshot.capabilities,...Object.fromEntries(['power','brightness','media','scenes'].map(name=>[name,declared.includes(name)?(name==='brightness'?{supported:true,minimum:0,maximum:100}:name==='media'?{supported:true,actions:[],playlistIds:[],renditionIds:[]}:name==='scenes'?{supported:true,sceneIds:[]}:{supported:true}):{supported:false}]))}});
  assert.equal(undeclaredLine(general(v10,['power','brightness','media'])),'Not declared by this controller: scenes and moments.');
  assert.equal(undeclaredLine(general(v11,['power','brightness','scenes'])),'Not declared by this controller: media.');
  assert.equal(undeclaredLine(general(v11,['power','brightness','media','scenes'])),undefined);
  assert.equal(undeclaredLine(general(v10,['power','brightness','media','scenes'])),'Not declared by this controller: moments.');
  assert.equal(undeclaredLine(general(v10,[])),'No general controls or moments: this controller declares no power, brightness, media, scenes or moments.');
  assert.equal(undeclaredLine(general(v11,[])),'No general controls: this controller declares no power, brightness, media or scenes.');
  assert.equal(undeclaredLine(general(capabilities(v11,{supported:false}),['power'])),'Not declared by this controller: brightness, media, scenes and moments.');
 });

 test('each route result has its line, and only a queued or sent receipt is watched',()=>{
  const receipt=(outcome,code)=>({kind:'receipt',momentId:'m',start:null,receipt:{requestId:{epoch:'e',sequence:3},outcome,priorEffects:outcome==='sent'?'confirmed-transmission':'none',completedOperations:[],uncertainOperations:[],...(code?{failure:{code}}:{})}});
  const queued=momentMessage(receipt('queued'),context);
  assert.deepEqual(queued,{result:{message:'Celebrate: Scheduled on wall.',locked:false,settled:'accepted'},ticket:{epoch:'e',sequence:3}});
  assert.equal(momentMessage(receipt('sent'),context).result.message,'Celebrate: Sent to wall.');
  const quiet=momentMessage(receipt('failed','moment-blocked'),{...context,mode:'Quiet'});
  assert.deepEqual(quiet,{result:{message:'Not played: wall is in Quiet.',locked:false,settled:'rejected',code:'moment-blocked'}});
  assert.equal(momentMessage(receipt('failed','moment-blocked'),{...context,mode:'Work'}).result.message,'Not played: wall is in Work.');
  assert.equal(momentMessage(receipt('failed','moment-blocked'),context).result.message,'Not played: wall didn’t allow it now.');
  assert.equal(momentMessage(receipt('failed','moment-missed'),context).result.message,'Not played: it missed its start window.');
  assert.equal(momentMessage(receipt('failed','moment-duplicate'),context).result.message,'Not played: wall already had this moment.');
  assert.equal(momentMessage(receipt('failed','revision-conflict'),context).result.message,'Not applied: another client changed this device first (revision-conflict). Nothing changed.');
  const notSent=reason=>momentMessage({kind:'not-sent',momentId:'m',start:null,reason},context).result;
  assert.deepEqual(notSent('1.0-only'),{message:'Not sent: this controller serves API 1.0.',locked:false,settled:'rejected',code:'1.0-only'});
  assert.equal(notSent('moments-unsupported').message,'Not sent: this device doesn’t declare moments.');
  assert.equal(notSent('unsupported-capability').message,'Not sent: this device doesn’t accept this mood or duration now.');
  assert.equal(notSent('capacity').message,'Not sent: too many commands are waiting.');
  assert.equal(notSent('unavailable').message,'Not sent: the controller isn’t responding.');
  for(const answer of [{kind:'uncertain',momentId:'m',start:null},{kind:'something-new'},undefined,null]){
   const {result,ticket}=momentMessage(answer,context);
   assert.equal(result.locked,true);assert.equal(result.settled,'locked');assert.equal(ticket,undefined);
   assert.match(result.message,/^Result unknown: this may have reached the device \(uncertain-result\)\./);
  }
 });

 test('a later receipt for the watched ticket reads in the card’s own words',()=>{
  assert.equal(momentReceiptMessage({outcome:'failed',priorEffects:'none',failure:{code:'moment-blocked'}},{...context,mode:'Quiet'}).message,'Not played: wall is in Quiet.');
  assert.equal(momentReceiptMessage({outcome:'cancelled',priorEffects:'none'},context).message,'Celebrate: Ended before it started.');
  assert.equal(momentReceiptMessage({outcome:'uncertain',priorEffects:'possible'},context).locked,true);
 });

 test('the live line follows state.moment in the controller clock and names only this page’s moods',()=>{
  const at=atMs=>({domain:'controller-monotonic',epoch:'clock-1',atMs});
  const snapshot=moment=>({...v11,sampleClock:{domain:'controller-monotonic',epoch:'clock-1',sampledAtMs:10000},state:{...v11.state,moment}});
  const ticket={epoch:'e',sequence:1},none={status:'none'};
  const named=id=>id==='mine'?'celebrate':undefined;
  assert.equal(momentLine(snapshot({current:none,last:none}),0,named),'No moment yet.');
  assert.equal(momentLine(snapshot({current:{status:'scheduled',momentId:'mine',requestId:ticket,mood:'celebrate',priorityClass:'event',coversStatus:true,startAt:at(12000),toleranceMs:10000,durationMs:5000},last:none}),0,named),'Scheduled: Celebrate');
  const playing={status:'playing',momentId:'mine',requestId:ticket,mood:'celebrate',priorityClass:'event',coversStatus:true,endAt:at(17000)};
  assert.equal(momentLine(snapshot({current:playing,last:none}),0,named),'Playing Celebrate, 7 s left');
  assert.equal(momentLine(snapshot({current:playing,last:none}),6500,named),'Playing Celebrate, 1 s left');
  assert.equal(momentLine(snapshot({current:playing,last:none}),9000,named),'Playing Celebrate, 0 s left');
  assert.equal(momentLine(snapshot({current:{...playing,endAt:{...at(17000),epoch:'clock-0'}},last:none}),0,named),'Playing Celebrate');
  const last=(momentId,ending,endedAt=6000)=>({status:'known',momentId,requestId:ticket,ending,endedAt:at(endedAt)});
  assert.equal(momentLine(snapshot({current:none,last:last('mine','completed')}),0,named),'Last: Celebrate, completed 4 s ago');
  assert.equal(momentLine(snapshot({current:none,last:last('theirs','completed')}),0,named),'Last moment: completed 4 s ago');
  assert.equal(momentLine(snapshot({current:none,last:last('mine','preempted',9500)}),0,named),'Last: Celebrate, pre-empted by an alert just now');
  assert.equal(momentLine(snapshot({current:none,last:last('theirs','interrupted',10000)}),125000,named),'Last moment: interrupted 2 min ago');
  assert.equal(momentLine(snapshot({current:{...playing,momentId:'next',mood:'setback'},last:last('mine','superseded',9800)}),0,named),'Playing Setback, 7 s left · Last: Celebrate, superseded just now');
  assert.equal(momentLine(snapshot({current:none,last:{...last('mine','completed'),endedAt:{...at(6000),epoch:'clock-0'}}}),0,named),'Last: Celebrate, completed');
 });

 test('the lifecycle sends once, words the route answer through interpret and a later receipt through describe',async()=>{
  const wording=momentWording('Celebrate');
  let state=initialCommand;const dispatch=event=>{state=commandTransition(state,event);};
  const sent=[];
  const describe=receipt=>momentReceiptMessage(receipt,{...context,mode:'Work'});
  const answer={kind:'receipt',momentId:'m',start:null,receipt:{requestId:{epoch:'e',sequence:9},outcome:'queued',priorEffects:'none',completedOperations:[],uncertainOperations:[]}};
  const pending=runCommand({wording,options:{describe},prepare:async()=>({request:{mood:'celebrate',durationMs:10000,coversStatus:true}}),
   send:async request=>{sent.push(request);assert.equal(state.status,'Celebrate: Sending…');return answer;},refresh:async()=>{},interpret:response=>momentMessage(response,context)},dispatch);
  assert.equal(await pending,'accepted');dispatch({type:'finish'});
  assert.equal(sent.length,1);assert.equal(state.status,'Celebrate: Scheduled on wall.');assert.deepEqual(state.watching,{ticket:{epoch:'e',sequence:9},prefix:''});
  // A queued receipt is not terminal; a later failed one for this ticket replaces the line.
  dispatch({type:'observed',source:{state:{lastOutcome:{status:'known',receipt:{requestId:{epoch:'e',sequence:9},outcome:'queued',priorEffects:'none'}}}},options:{describe}});
  assert.equal(state.status,'Celebrate: Scheduled on wall.');
  dispatch({type:'observed',source:{state:{lastOutcome:{status:'known',receipt:{requestId:{epoch:'e',sequence:9},outcome:'failed',priorEffects:'none',failure:{code:'moment-blocked'}}}}},options:{describe}});
  assert.equal(state.status,'Not played: wall is in Work.');assert.equal(state.tone,'rejected');
  // Another ticket's receipt is never adopted.
  dispatch({type:'observed',source:{state:{lastOutcome:{status:'known',receipt:{requestId:{epoch:'e',sequence:10},outcome:'sent',priorEffects:'confirmed-transmission'}}}},options:{describe}});
  assert.equal(state.status,'Not played: wall is in Work.');
 });

 test('a lost answer locks without a ticket and is never resent; a typed refusal says nothing changed',async()=>{
  const wording=momentWording('Setback');
  for(const [error,locked] of [[new ApiError('uncertain-result'),true],[new ApiError('forbidden',403),false]]){
   let state=initialCommand;const dispatch=event=>{state=commandTransition(state,event);};let sends=0;
   await runCommand({wording,options:{},prepare:async()=>({request:{}}),send:async()=>{sends++;throw error;},refresh:async()=>{},interpret:response=>momentMessage(response,context)},dispatch);
   assert.equal(sends,1);assert.equal(state.locked,locked);assert.equal(state.watching,undefined);
   if(!locked)assert.equal(state.status,'Not applied: your credential doesn’t allow this (forbidden). Nothing changed.');
  }
 });
}finally{await rm(dir,{recursive:true,force:true});}
