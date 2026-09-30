import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validate} from '@jimmie-potts/device-contracts';
import {startHub} from '../dist/server.js';
import {startFakeController} from './fake-controller.mjs';

// Hub #336: the owner moment route. One explicit press sends one moment to one device through the #335 sender, over
// loopback HTTP against the shared fake controller, and answers inside the hub's 3 s response cap.
const hash=value=>createHash('sha256').update(value).digest('hex');
const operator='o'.repeat(43),reader='r'.repeat(43),other='x'.repeat(43);
async function hubWith(t,fake){
  const directory=await mkdtemp(join(tmpdir(),'hub-moment-route-'));
  const hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[fake.config({id:'wall'})],credentials:[
    {id:'operator',digest:hash(operator),scopes:['read','control'],devices:['wall']},
    {id:'reader',digest:hash(reader),scopes:['read'],devices:['wall']},
    {id:'other',digest:hash(other),scopes:['read','control'],devices:[]}]});
  t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
  return hub;
}
async function fakeFor(t,options={}){
  const fake=await startFakeController({serves:'1.1',...options});
  t.after(fake.close);
  return fake;
}
const post=(hub,body,{bearer=operator,header=true,path='/api/controllers/v1/wall/moment'}={})=>fetch(hub.url+path,{method:'POST',
  headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json',...(header?{'x-pixoo-request':'1'}:{})},body:typeof body==='string'?body:JSON.stringify(body)});
const valid={mood:'celebrate',durationMs:10000,coversStatus:true};

test('a valid owner press sends exactly one event moment with a fresh ID and answers the typed receipt',{timeout:20000},async t=>{
  const fake=await fakeFor(t);
  const hub=await hubWith(t,fake);
  const response=await post(hub,valid);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.kind,'receipt');
  assert.ok(validate('receiptV1_1',result.receipt));assert.equal(result.receipt.outcome,'queued');
  assert.match(result.momentId,/^bunny-[0-9a-f-]{36}$/);
  assert.equal(fake.moments().length,1);assert.equal(fake.commands.length,1);
  const [request]=fake.moments();
  assert.ok(validate('requestV1_1',request));
  assert.deepEqual(Object.keys(request.command).sort(),['coversStatus','durationMs','kind','momentId','mood','priorityClass','start']);
  assert.equal(request.command.momentId,result.momentId);
  assert.equal(request.command.priorityClass,'event');assert.equal(request.command.mood,'celebrate');
  assert.equal(request.command.durationMs,10000);assert.equal(request.command.coversStatus,true);
  assert.equal('palette' in request.command,false);
  assert.deepEqual(result.start,request.command.start);assert.equal(request.command.start.toleranceMs,10000);
  // A second press is a new moment with a new ID; the hub keeps nothing to replay.
  const second=await (await post(hub,{...valid,mood:'setback',coversStatus:false})).json();
  assert.notEqual(second.momentId,result.momentId);
  assert.equal(fake.moments().length,2);assert.equal(fake.moments()[1].command.coversStatus,false);
});

test('read scope, another device grant and a missing mutation header are forbidden before any controller contact',{timeout:20000},async t=>{
  const fake=await fakeFor(t);
  const hub=await hubWith(t,fake);
  for(const options of [{bearer:reader},{bearer:other},{header:false}]){
    const response=await post(hub,valid,options);
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:{code:'forbidden'}});
  }
  const anonymous=await fetch(hub.url+'/api/controllers/v1/wall/moment',{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify(valid)});
  assert.equal(anonymous.status,401);
  assert.equal(fake.requests.length,0);
});

test('an invalid body, a query string, another method or an unknown alias is refused with a typed error and no controller request',{timeout:20000},async t=>{
  const fake=await fakeFor(t);
  const hub=await hubWith(t,fake);
  const invalid=[{...valid,palette:['#ff0000']},{...valid,momentId:'mine'},{...valid,priorityClass:'flourish'},{mood:'celebrate',durationMs:10000},
    {...valid,mood:'Big win!'},{...valid,mood:''},{...valid,mood:7},{...valid,durationMs:999},{...valid,durationMs:300001},{...valid,durationMs:5000.5},
    {...valid,durationMs:'10000'},{...valid,coversStatus:'yes'},[],null];
  for(const body of invalid){
    const response=await post(hub,body);
    assert.equal(response.status,400,JSON.stringify(body));assert.deepEqual(await response.json(),{error:{code:'invalid-request'}});
  }
  const malformed=await post(hub,'{"mood":');
  assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{error:{code:'invalid-input'}});
  assert.equal((await post(hub,valid,{path:'/api/controllers/v1/wall/moment?now=1'})).status,404);
  assert.equal((await fetch(hub.url+'/api/controllers/v1/wall/moment',{headers:{authorization:`Bearer ${operator}`}})).status,404);
  assert.equal((await post(hub,valid,{path:'/api/controllers/v1/elsewhere/moment'})).status,403);
  assert.equal(fake.requests.length,0);
});

test('an undeclared mood or a duration above the device limit is not sent, after one read and no command',{timeout:20000},async t=>{
  const fake=await fakeFor(t,{moments:{supported:true,moods:['celebrate','setback','reminder'],maxDurationMs:20000,coversStatus:true}});
  const hub=await hubWith(t,fake);
  for(const body of [{...valid,mood:'cozy'},{...valid,durationMs:30000}]){
    const response=await post(hub,body);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.kind,'not-sent');assert.equal(result.reason,'unsupported-capability');assert.equal('failure' in result,false);
  }
  assert.equal(fake.commands.length,0);
});

test('a 1.0-only controller and a controller without moments get their not-sent reasons and no command',{timeout:20000},async t=>{
  const legacy=await fakeFor(t,{serves:'1.0'});
  const hub=await hubWith(t,legacy);
  const result=await (await post(hub,valid)).json();
  assert.equal(result.kind,'not-sent');assert.equal(result.reason,'1.0-only');
  assert.equal(legacy.commands.length,0);
  const bare=await fakeFor(t,{moments:{supported:false}});
  const hub2=await hubWith(t,bare);
  assert.equal((await (await post(hub2,valid)).json()).reason,'moments-unsupported');
  assert.equal(bare.commands.length,0);
});

test('a device failure receipt, a lost answer and a typed refusal come back as the sender typed them, after one POST',{timeout:20000},async t=>{
  const fake=await fakeFor(t);
  const hub=await hubWith(t,fake);
  fake.answerNext({receipt:{outcome:'failed',failure:{code:'moment-blocked'}},status:200});
  const blocked=await (await post(hub,valid)).json();
  assert.equal(blocked.kind,'receipt');assert.equal(blocked.receipt.outcome,'failed');assert.deepEqual(blocked.receipt.failure,{code:'moment-blocked'});
  fake.answerNext({mode:'drop'});
  const lost=await (await post(hub,valid)).json();
  assert.equal(lost.kind,'uncertain');assert.ok(lost.start);
  fake.answerNext({failure:'capacity'});
  const busy=await (await post(hub,valid)).json();
  assert.deepEqual([busy.kind,busy.reason,busy.failure],['not-sent','capacity','capacity']);
  assert.equal(fake.moments().length,3);
});

test('a controller that stalls past the route bound answers uncertain within the response cap and still receives exactly one request',{timeout:20000},async t=>{
  const fake=await fakeFor(t);
  const hub=await hubWith(t,fake);
  // Each controller call has its own 2 s limit, so only a slow read followed by a slow POST outlasts the route's bound.
  const read=fake.hold({method:'GET'}),posted=fake.hold({method:'POST'});
  const started=performance.now();
  const answer=post(hub,valid);
  await read.reached;
  await new Promise(resolve=>setTimeout(resolve,1500));
  read.release();
  await posted.reached;
  const response=await answer;
  const elapsed=performance.now()-started;
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(Object.keys(result).sort(),['kind','momentId','start']);
  assert.equal(result.kind,'uncertain');assert.equal(result.start,null);assert.match(result.momentId,/^bunny-/);
  assert.ok(elapsed>=2400&&elapsed<3000,`answered after ${Math.round(elapsed)} ms`);
  posted.release();
  // The one sender call finishes on its own; nothing is resent.
  await new Promise(resolve=>setTimeout(resolve,2500));
  assert.equal(fake.moments().length,1);assert.equal(fake.moments()[0].command.momentId,result.momentId);
});

test('a press that waits for the device slot is answered inside the cap and each moment is sent once',{timeout:20000},async t=>{
  const fake=await fakeFor(t);
  const hub=await hubWith(t,fake);
  const held=fake.hold({method:'POST'});
  const first=post(hub,valid);
  await held.reached;
  // The second press waits for the device's one slot, which the first moment holds until its POST times out.
  const started=performance.now();
  const second=await (await post(hub,{...valid,mood:'reminder'})).json();
  assert.ok(performance.now()-started<3000);
  assert.equal(second.kind,'receipt');
  assert.equal((await (await first).json()).kind,'uncertain');
  held.release();
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.deepEqual(fake.moments().map(m=>m.command.mood).sort(),['celebrate','reminder']);
  assert.equal(new Set(fake.moments().map(m=>m.command.momentId)).size,2,'no moment is sent twice');
});
