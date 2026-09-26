import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-lifecycle-'));
try {
 // One bundle, so the test's ApiError is the class the lifecycle checks.
 await build({stdin:{contents:"export * from './lifecycle';export {ApiError} from './client';",resolveDir:'apps/dashboard/src',loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:join(dir,'lifecycle.mjs')});
 const {actionWording,formWording,commandTransition,initialCommand,runCommand,unreadable,ApiError}=await import(join(dir,'lifecycle.mjs'));
 const check='B.U.N.N.Y. can’t see the device, so check it to confirm.';
 const ticket={epoch:'e',sequence:4};
 // Both consumers drive the same lifecycle; they differ only in wording.
 const consumers=[
  {name:'form',wording:formWording,prefix:'',kept:'',retry:' Change it again to try with current values.'},
  {name:'action',wording:actionWording('Pause'),prefix:'Pause: ',kept:'',retry:' Press Pause to try again with current values.'},
 ];
 /** A consumer harness: the reducer state, every request sent and every refresh requested. */
 function harness(consumer,{prepare=async()=>({request:{requestId:ticket,command:'x'}}),send=async()=>({outcome:'queued',priorEffects:'none'}),refresh=async()=>{},options={}}={}){
  const h={state:initialCommand,sent:[],refreshes:0,settled:[]};
  h.dispatch=event=>{h.state=commandTransition(h.state,event);};
  h.run=()=>runCommand({wording:consumer.wording,options,prepare,send:async request=>{h.sent.push(request);return send(request);},refresh:async()=>{h.refreshes++;return refresh();},settled:outcome=>h.settled.push(outcome)},h.dispatch).finally(()=>h.dispatch({type:'finish'}));
  h.observe=(source,observeOptions=options)=>h.dispatch({type:'observed',source,options:observeOptions});
  return h;
 }
 const receipt=(requestId,outcome,extra={})=>({state:{lastOutcome:{status:'known',receipt:{requestId,outcome,...extra}}}});

 for(const consumer of consumers){
  test(`${consumer.name}: a blocked or failed preparation sends nothing and frees the control`,async()=>{
   const blockedRun=harness(consumer,{prepare:async()=>({blocked:'Pixoo is switching to Media'})});
   assert.equal(await blockedRun.run(),'blocked');
   assert.deepEqual(blockedRun.state,{status:`${consumer.prefix}Not sent: Pixoo is switching to Media. Nothing changed.${consumer.kept}`,tone:'rejected',busy:false,locked:false});
   assert.equal(blockedRun.sent.length,0);assert.equal(blockedRun.refreshes,0);assert.deepEqual(blockedRun.settled,['blocked']);
   // A controlled rejected read, such as a failed fresh device read.
   const failed=harness(consumer,{prepare:()=>Promise.reject(new Error('read failed'))});
   assert.equal(await failed.run(),'blocked');
   assert.equal(failed.state.status,`${consumer.prefix}Not sent: ${unreadable}. Nothing changed.${consumer.kept}`);
   assert.equal(failed.state.busy,false);assert.equal(failed.state.locked,false);assert.equal(failed.sent.length,0);
   const sessions=harness(consumer,{prepare:()=>Promise.reject(new Error('build failed')),options:{device:false}});await sessions.run();
   assert.equal(sessions.state.status,`${consumer.prefix}Not sent: B.U.N.N.Y. couldn’t read the current sessions. Nothing changed.${consumer.kept}`);
   // A consumer that is neither a device nor the session monitor, such as playback, names what it could not read.
   const named=harness(consumer,{prepare:()=>Promise.reject(new Error('read failed')),options:{device:false,unreadable:'B.U.N.N.Y. couldn’t read the playback source'}});await named.run();
   assert.equal(named.state.status,`${consumer.prefix}Not sent: B.U.N.N.Y. couldn’t read the playback source. Nothing changed.${consumer.kept}`);
  });

  test(`${consumer.name}: an accepted ticket is watched until its terminal receipt`,async()=>{
   const h=harness(consumer);
   const states=[];const dispatch=h.dispatch;h.dispatch=event=>{dispatch(event);states.push(h.state);};
   assert.equal(await h.run(),'accepted');
   assert.deepEqual(states[0],{status:`${consumer.prefix}Sending…`,tone:'pending',busy:true,locked:false},'busy with no watched ticket while sending');
   assert.equal(states.at(-2).busy,true,'still busy after the result until the refreshed view returns');
   assert.deepEqual(h.state,{status:`${consumer.prefix}Queued. The device hasn’t received it yet.`,tone:'accepted',busy:false,locked:false,watching:{ticket,prefix:consumer.prefix}});
   assert.equal(h.sent.length,1);assert.equal(h.refreshes,1);assert.deepEqual(h.settled,['accepted']);
   h.observe(receipt({...ticket},'queued'));
   assert.equal(h.state.status,`${consumer.prefix}Queued. The device hasn’t received it yet.`,'a queued receipt is not terminal');
   h.observe(receipt({epoch:'e',sequence:5},'failed',{priorEffects:'none',failure:{code:'cancelled'}}));
   assert.equal(h.state.tone,'accepted','another ticket’s receipt is ignored');
   h.observe(receipt({...ticket},'sent',{priorEffects:'confirmed-transmission'}));
   assert.deepEqual(h.state,{status:`${consumer.prefix}Sent to the device. ${check}`,tone:'accepted',busy:false,locked:false,watching:{ticket,prefix:consumer.prefix}});
   assert.equal(h.sent.length,1,'observing sends nothing');
  });

  test(`${consumer.name}: a definite rejection stays editable and never adopts another client’s receipt`,async()=>{
   const h=harness(consumer,{send:()=>Promise.reject(new ApiError('revision-conflict',409))});
   assert.equal(await h.run(),'rejected');
   assert.deepEqual(h.state,{status:`${consumer.prefix}Not applied: another client changed this device first (revision-conflict). Nothing changed.${consumer.retry}`,tone:'rejected',busy:false,locked:false,watching:undefined});
   // Another client consumed the same ticket; its receipt later appears in the refreshed snapshot.
   h.observe(receipt({...ticket},'sent',{priorEffects:'confirmed-transmission'}));
   assert.equal(h.state.tone,'rejected');assert.doesNotMatch(h.state.status,/Sent to the device/);
   assert.equal(h.sent.length,1,'a rejection is never resubmitted');
   const typed=harness(consumer,{send:()=>Promise.reject(new ApiError('unsupported-capability',409,{outcome:'failed',priorEffects:'none',failure:{code:'unsupported-capability'}}))});
   await typed.run();assert.equal(typed.state.status,`${consumer.prefix}Not applied: the device doesn’t accept this in its current state (unsupported-capability). Nothing changed.${consumer.kept}`);
  });

  test(`${consumer.name}: uncertain and partial results lock until an explicit reload, with no retry`,async()=>{
   const uncertain=harness(consumer,{send:()=>Promise.reject(new TypeError('network lost'))});
   assert.equal(await uncertain.run(),'locked');
   assert.deepEqual(uncertain.state,{status:`${consumer.prefix}Result unknown: this may have reached the device (uncertain-result). Check the device, then reload current values before trying again.`,tone:'locked',busy:false,locked:true,watching:undefined});
   assert.deepEqual(uncertain.settled,['locked']);
   const partial=harness(consumer,{send:()=>Promise.reject(new ApiError('transport-failure',503,{outcome:'partially-applied',priorEffects:'confirmed-transmission',completedOperations:['mode'],uncertainOperations:['refresh']}))});
   await partial.run();
   assert.equal(partial.state.status,`${consumer.prefix}Partly applied: mode was sent; refresh is unknown (transport-failure). Check the device, then reload current values before trying again.`);
   assert.equal(partial.state.locked,true);
   partial.dispatch({type:'dismiss'});assert.equal(partial.state.locked,true,'dismissing a message does not unlock');
   partial.dispatch({type:'reload'});
   assert.deepEqual(partial.state,{status:'',busy:false,locked:false},'only an explicit reload unlocks');
   assert.equal(uncertain.sent.length+partial.sent.length,2,'nothing is resubmitted');
  });

  test(`${consumer.name}: a later uncertain terminal receipt locks the control`,async()=>{
   const h=harness(consumer,{send:async()=>({outcome:'sent',priorEffects:'confirmed-transmission'})});
   await h.run();assert.equal(h.state.locked,false);
   h.observe(receipt({...ticket},'uncertain',{priorEffects:'possible',failure:{code:'uncertain-result'}}));
   assert.equal(h.state.locked,true);assert.equal(h.state.tone,'locked');
   assert.equal(h.state.status,`${consumer.prefix}Result unknown: this may have reached the device (uncertain-result). Check the device, then reload current values before trying again.`);
  });

  test(`${consumer.name}: a failed refresh keeps the command’s receipt and resends nothing`,async()=>{
   for(const [send,status] of [
    [async()=>({outcome:'sent',priorEffects:'confirmed-transmission'}),`Sent to the device. ${check}`],
    [()=>Promise.reject(new ApiError('stale-generation',409,{outcome:'cancelled',priorEffects:'none',failure:{code:'stale-generation'}})),`Not applied: the device moved on before this arrived (stale-generation). Nothing changed.${consumer.retry}`],
    [()=>Promise.reject(new ApiError('uncertain-result')),'Result unknown: this may have reached the device (uncertain-result). Check the device, then reload current values before trying again.'],
   ]){
    const h=harness(consumer,{send,refresh:()=>Promise.reject(new Error('snapshot-superseded'))});
    const outcome=await h.run();
    assert.equal(h.state.status,consumer.prefix+status,'the result is not replaced by the refresh failure');
    assert.equal(h.state.busy,false);assert.equal(h.sent.length,1);assert.deepEqual(h.settled,[outcome]);
   }
  });

  test(`${consumer.name}: a stale read reaches the controller once and is shown, not retried`,async()=>{
   // The fresh read returns guards that the controller has already retired.
   const stale={requestId:ticket,expectedGeneration:{epoch:'g',sequence:1}};
   const h=harness(consumer,{prepare:async()=>({request:stale}),send:()=>Promise.reject(new ApiError('stale-generation',409,{outcome:'failed',priorEffects:'none',failure:{code:'stale-generation'}}))});
   assert.equal(await h.run(),'rejected');
   assert.deepEqual(h.sent,[stale]);
   assert.equal(h.state.status,`${consumer.prefix}Not applied: the device moved on before this arrived (stale-generation). Nothing changed.${consumer.retry}`);
   assert.equal(h.state.locked,false,'the next explicit activation prepares again with current guards');
  });
 }

 test('a new activation clears the previous watched ticket before sending',async()=>{
  let state=commandTransition(initialCommand,{type:'result',wording:formWording,result:{message:'Saved.',settled:'accepted',locked:false},ticket});
  assert.deepEqual(state.watching,{ticket,prefix:''});
  state=commandTransition(state,{type:'start',wording:formWording});
  assert.equal(state.watching,undefined);
  state=commandTransition(state,{type:'observed',source:receipt({...ticket},'uncertain',{priorEffects:'possible'}),options:{}});
  assert.equal(state.locked,false,'an earlier ticket’s later receipt cannot lock the new command');
 });
} finally {await rm(dir,{recursive:true,force:true});}
