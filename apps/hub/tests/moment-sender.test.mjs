import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validate} from '@jimmie-potts/device-contracts';
import {ControllerClient} from '../dist/controllers.js';
import {sendMoment,DEFAULT_MOMENT_TOLERANCE_MS} from '../dist/moment-sender.js';
import {startHub} from '../dist/server.js';
import {startFakeController} from './fake-controller.mjs';

// Hub #335: the moment sender, over loopback HTTP against the shared fake controller, with an injected hub-monotonic clock.
// Each AC refers to the acceptance criteria in the issue.
async function target(t,options={},timeoutMs){
  const fake=await startFakeController(options),client=new ControllerClient(fake.config(),timeoutMs);
  t.after(async()=>{client.close();await fake.close();});
  return {fake,client};
}
/** A hub-monotonic clock that moves only when a test advances it. */
function manualClock(at=50000){const now=()=>at;now.advance=ms=>{at+=ms;};return now;}
const merged={momentId:'evt-merge-42',mood:'celebrate',palette:['#00ff88','#0044ff'],durationMs:8000,priorityClass:'event',coversStatus:true};
const settle=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('AC1: a send waits for a dashboard read that holds the slot, then sends once, while other reads never wait',async t=>{
  const {fake,client}=await target(t);
  const stall=fake.hold({method:'GET'});
  const dashboard=client.snapshot();await stall.reached;
  const sending=sendMoment(client,merged);
  await assert.rejects(client.snapshot(),error=>error.code==='capacity'&&error.status===429);
  await settle(100);assert.equal(fake.commands.length,0);
  stall.release();
  assert.equal((await dashboard).apiVersion,'1.0');
  const result=await sending;
  assert.equal(result.kind,'receipt');assert.equal(result.receipt.outcome,'queued');assert.equal(fake.moments().length,1);
});

test('AC1: a slot still held after the bound returns capacity with no read and no POST',async t=>{
  const {fake,client}=await target(t);
  let finish;const holder=client.hold(0,()=>new Promise(resolve=>{finish=resolve;}));
  const started=performance.now();
  const result=await sendMoment(client,merged);
  assert.ok(performance.now()-started>=2400,'the send waited for the bound');
  assert.deepEqual(result,{kind:'not-sent',momentId:'evt-merge-42',start:null,reason:'capacity'});
  finish();await holder;
  assert.equal(fake.requests.length,0);
});

test('AC2: one POST carries a requestV1_1 built from the snapshot read just before it',async t=>{
  const {fake,client}=await target(t,{sampleClock:{epoch:'clock-wall',sampledAtMs:1000}});
  const now=manualClock();
  // The hub clock moves 700 ms while the snapshot is in flight, so the start is measured from its arrival.
  const stall=fake.hold({method:'GET'});
  const before=fake.snapshot11();
  const sending=sendMoment(client,{...merged,startAtHubMs:now()+1500},{now});
  await stall.reached;now.advance(700);stall.release();
  const result=await sending;
  assert.equal(fake.commands.length,1);
  const [request]=fake.moments();
  assert.ok(validate('requestV1_1',request));
  assert.deepEqual(request.requestId,before.nextRequestId);
  assert.equal(request.expectedConfigurationRevision,before.configurationRevision);
  assert.deepEqual(request.expectedGeneration,before.generation);
  assert.deepEqual(request.command.start,{domain:'controller-monotonic',epoch:'clock-wall',atMs:1000+800,toleranceMs:DEFAULT_MOMENT_TOLERANCE_MS});
  assert.equal(DEFAULT_MOMENT_TOLERANCE_MS,10000);
  // Caller fields arrive unchanged.
  const {kind,start,...fields}=request.command;
  assert.equal(kind,'moment');assert.deepEqual(fields,merged);
  assert.deepEqual(result,{kind:'receipt',momentId:'evt-merge-42',start:request.command.start,receipt:result.receipt});
  assert.deepEqual(result.receipt.requestId,request.requestId);
  // The default start is the snapshot's arrival, so the wait and the read never eat into the start window.
  const again=await sendMoment(client,{...merged,momentId:'evt-merge-43'},{now});
  assert.equal(again.start.atMs,1000);assert.equal(fake.moments()[1].requestId.sequence,request.requestId.sequence+1);
});

test('AC2: one hub instant becomes the same instant in two controllers with different clocks',async t=>{
  const a=await target(t,{sampleClock:{epoch:'clock-a',sampledAtMs:1000}}),b=await target(t,{sampleClock:{epoch:'clock-b',sampledAtMs:987654.5}});
  const now=manualClock(),at=now()+2500;
  const [left,right]=await Promise.all([sendMoment(a.client,{...merged,startAtHubMs:at},{now}),sendMoment(b.client,{...merged,startAtHubMs:at},{now})]);
  assert.deepEqual(left.start,{domain:'controller-monotonic',epoch:'clock-a',atMs:3500,toleranceMs:10000});
  assert.deepEqual(right.start,{domain:'controller-monotonic',epoch:'clock-b',atMs:990154.5,toleranceMs:10000});
  assert.deepEqual(a.fake.moments()[0].command.start,left.start);assert.deepEqual(b.fake.moments()[0].command.start,right.start);
});

test('AC2: a past start that precedes the controller clock keeps its deadline',async t=>{
  const {fake,client}=await target(t,{sampleClock:{epoch:'clock-young',sampledAtMs:500}});
  const now=manualClock();
  const late=await sendMoment(client,{...merged,startAtHubMs:now()-2000},{now});
  assert.deepEqual(late.start,{domain:'controller-monotonic',epoch:'clock-young',atMs:0,toleranceMs:8500});
  const missed=await sendMoment(client,{...merged,momentId:'evt-late',startAtHubMs:now()-20000},{now});
  assert.deepEqual(missed.start,{domain:'controller-monotonic',epoch:'clock-young',atMs:0,toleranceMs:0});
  assert.equal(fake.moments().length,2);
});

test('AC2: invalid input is rejected before any read',async t=>{
  const {fake,client}=await target(t);
  const now=manualClock();
  const invalid=[
    {...merged,toleranceMs:60001},{...merged,toleranceMs:-1},{...merged,toleranceMs:1.5},
    {...merged,startAtHubMs:now()+60001},{...merged,startAtHubMs:Number.NaN},
    {...merged,priorityClass:'flourish',coversStatus:true},
    {...merged,durationMs:999},{...merged,durationMs:300001},{...merged,palette:[]},{...merged,palette:['green']},{...merged,mood:'a mood'},
    {...merged,title:'Merged: add moments'},{...merged,frames:[]},(({momentId:_,...rest})=>rest)(merged),null,
  ];
  for(const input of invalid)await assert.rejects(sendMoment(client,input,{now}),error=>error.code==='invalid-request'&&error.status===400,JSON.stringify(input));
  assert.equal(fake.requests.length,0);
  // The bounds themselves are accepted: 60,000 ms ahead and a 60,000 ms tolerance, and a flourish that does not cover status.
  const edge=await sendMoment(client,{...merged,priorityClass:'flourish',coversStatus:false,startAtHubMs:now()+60000,toleranceMs:60000},{now});
  assert.equal(edge.kind,'receipt');assert.deepEqual(edge.start,{domain:'controller-monotonic',epoch:'clock-1',atMs:61000,toleranceMs:60000});
  assert.equal(fake.moments()[0].command.priorityClass,'flourish');assert.equal(fake.moments()[0].command.coversStatus,false);
});

test('AC3: a target that cannot take the moment gets a typed not-sent reason and no POST',async t=>{
  const cases=[
    [{serves:'1.0'},merged,'1.0-only'],
    [{serves:'1.0-negotiating'},merged,'1.0-only'],
    [{moments:{supported:false}},merged,'moments-unsupported'],
    [{},{...merged,mood:'party'},'unsupported-capability'],
    [{},{...merged,durationMs:60001},'unsupported-capability'],
  ];
  for(const [options,input,reason] of cases){
    const {fake,client}=await target(t,options);
    const result=await sendMoment(client,input);
    assert.equal(result.kind,'not-sent',reason);assert.equal(result.reason,reason);assert.equal(result.momentId,input.momentId);
    assert.equal(result.failure,undefined);
    // A snapshot was read, so the start the moment would have had is reported.
    assert.equal(result.start.epoch,'clock-1');
    assert.equal(fake.commands.length,0,reason);assert.ok(fake.reads()>=1);
  }
  // An offline controller is unavailable before any snapshot, so there is no start.
  const {fake,client}=await target(t);await fake.close();
  assert.deepEqual(await sendMoment(client,merged),{kind:'not-sent',momentId:'evt-merge-42',start:null,reason:'unavailable'});
});

test('AC4: a lost response or timeout is uncertain after exactly one POST, and nothing is resent',async t=>{
  const {fake,client}=await target(t,{},80);
  for(const mode of ['timeout','drop']){
    fake.answerNext({mode});const before=fake.commands.length;
    const result=await sendMoment(client,{...merged,momentId:`evt-${mode}`});
    assert.equal(result.kind,'uncertain',mode);assert.equal(result.momentId,`evt-${mode}`);assert.equal(result.start.epoch,'clock-1');
    await settle(150);assert.equal(fake.commands.length,before+1,mode);
  }
  // A receipt for another ticket is not this moment's answer.
  const next=fake.snapshot11().nextRequestId;
  fake.answerNext({body:{apiVersion:'1.1',controllerId:'controller',deviceId:'light',requestId:{...next,sequence:next.sequence+5},configurationRevision:4,
    generation:fake.snapshot11().generation,outcome:'queued',priorEffects:'none',completedOperations:[],uncertainOperations:[]},status:202});
  assert.equal((await sendMoment(client,{...merged,momentId:'evt-mismatch'})).kind,'uncertain');
});

test('AC4: device receipts and typed refusals return typed with no resend',async t=>{
  const {fake,client}=await target(t);
  for(const code of ['moment-missed','moment-blocked','moment-duplicate','revision-conflict','stale-generation']){
    fake.answerNext({receipt:{outcome:'failed',failure:{code}}});const before=fake.commands.length;
    const result=await sendMoment(client,{...merged,momentId:`evt-${code}`});
    assert.equal(result.kind,'receipt',code);assert.equal(result.receipt.outcome,'failed');assert.deepEqual(result.receipt.failure,{code});
    assert.ok(validate('receiptV1_1',result.receipt));
    await settle(20);assert.equal(fake.commands.length,before+1,code);
  }
  // A refusal without a receipt admitted nothing, so the moment is not sent, with the controller's code.
  for(const [code,reason] of [['request-order','unavailable'],['request-expired','unavailable'],['request-conflict','unavailable'],
    ['capacity','capacity'],['unsupported-capability','unsupported-capability'],['unauthenticated','unavailable']]){
    fake.answerNext({failure:code});const before=fake.commands.length;
    const result=await sendMoment(client,{...merged,momentId:`evt-${code}`});
    assert.equal(result.kind,'not-sent',code);assert.equal(result.reason,reason,code);assert.equal(result.failure,code);
    assert.equal(result.start.epoch,'clock-1');
    await settle(20);assert.equal(fake.commands.length,before+1,code);
  }
});

test('AC5: three concurrent single-device sends with one target offline each return their own result',async t=>{
  const wall=await target(t,{controllerId:'wall-owner',sampleClock:{epoch:'clock-wall',sampledAtMs:1000}});
  const desk=await target(t,{controllerId:'desk-owner',sampleClock:{epoch:'clock-desk',sampledAtMs:40000}});
  const gone=await target(t,{controllerId:'gone-owner'});await gone.fake.close();
  const stalled=await target(t,{controllerId:'slow-owner'},200);const stall=stalled.fake.hold({method:'GET'});
  const now=manualClock(),at=now();
  const results=await Promise.allSettled([wall,desk,gone,stalled].map(({client})=>sendMoment(client,{...merged,startAtHubMs:at},{now})));
  stall.release();
  assert.ok(results.every(r=>r.status==='fulfilled'));
  const [w,d,g,s]=results.map(r=>r.value);
  assert.equal(w.kind,'receipt');assert.equal(d.kind,'receipt');
  assert.deepEqual(g,{kind:'not-sent',momentId:'evt-merge-42',start:null,reason:'unavailable'});
  assert.deepEqual(s,{kind:'not-sent',momentId:'evt-merge-42',start:null,reason:'unavailable'});
  assert.equal(w.start.atMs,1000);assert.equal(d.start.atMs,40000);
  assert.equal(wall.fake.moments().length,1);assert.equal(desk.fake.moments().length,1);assert.equal(stalled.fake.commands.length,0);
  assert.equal(wall.fake.moments()[0].command.momentId,desk.fake.moments()[0].command.momentId);
});

test('AC6: hub restarts, reconnects, reads and dashboard polls send nothing, and the sender keeps no state',async t=>{
  const fake=await startFakeController({controllerId:'wall-owner'});t.after(fake.close);
  const token='a'.repeat(43),digest=createHash('sha256').update(token).digest('hex');
  const directory=await mkdtemp(join(tmpdir(),'hub-moments-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const options={directory,ownerId:'owner',consumers:[],credentials:[{id:'operator',digest,scopes:['read','control'],devices:['wall']}],controllers:[fake.config({id:'wall'})]};
  const poll=async hub=>{
    for(const path of ['/api/dashboard/v1/context','/api/controllers/v1/wall/snapshot','/api/controllers/v1/wall/snapshot?apiVersion=1.1'])
      assert.equal((await fetch(hub.url+path,{headers:{authorization:`Bearer ${token}`,'x-pixoo-request':'1'}})).status,200,path);
  };
  // A moment sent before the restart is never sent again by a later hub, reconnect or read.
  const sender=new ControllerClient(fake.config());t.after(()=>sender.close());
  assert.equal((await sendMoment(sender,merged)).kind,'receipt');assert.equal(fake.commands.length,1);
  let hub=await startHub(options);await poll(hub);await hub.close();
  hub=await startHub(options);await poll(hub);await settle(100);await hub.close();
  const reconnected=new ControllerClient(fake.config());t.after(()=>reconnected.close());
  await reconnected.snapshot('1.1');await reconnected.snapshot();
  assert.equal(fake.commands.length,1);
  // The sender imports no storage, file system or timer module: it has nowhere to keep a moment.
  const source=await readFile(new URL('../dist/moment-sender.js',import.meta.url),'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m=>m[1]).sort(),['./common.js','./controllers.js','@jimmie-potts/device-contracts']);
});
