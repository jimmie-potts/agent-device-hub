import assert from 'node:assert/strict';
import {test} from './support.js';
import {deviceCommand, ModuleWorld} from './module-support.js';
import {LINES_ADDRESS, SYNTHETIC_TOKEN} from '../src/index.js';
const moment=(world:ModuleWorld,id:string,start=world.clock.now())=>deviceCommand('moment-play',
  {requestId:id,momentId:`moment-${id}`,mood:'celebrate',durationMs:1000,priorityClass:'flourish',coversStatus:false,startAtMs:start,toleranceMs:1000});

test('bounded moment restores a named Free base and restart does not replay it',async context=>{
  const world=await ModuleWorld.open(context);await world.start();
  await world.until(()=>world.device_()?.availability==='available',10000,'available');
  let command=deviceCommand('device-mode-set',{requestId:'free',mode:'free'});
  await world.request(command.key,command.draft);await world.advance(2000);
  const before=world.writes().length;
  command=moment(world,'one');
  const reply=await world.request(command.key,command.draft);
  assert.equal(reply.status,'accepted');
  await world.until(()=>world.outcomes('one').length===1,15000,'moment completion');
  assert.equal(world.outcomes('one')[0]?.data.result,'succeeded');
  assert.equal(world.outcomes('one')[0]?.data.evidence,'transmitted');
  assert.ok(world.writes().slice(before).some(w=>w.animType==='custom'));
  assert.ok(world.writes().slice(before).some(w=>w.select!==undefined));
  await world.restart();await world.advance(2000);
  assert.equal(new Set(world.outcomes('one').map(m=>m.id)).size,1);
  assert.equal(world.writes().slice(before).filter(w=>w.animType==='custom').length,1);
  const repeated=moment(world,'one');repeated.draft.data={...repeated.draft.data,requestId:'one-again'};
  const unchanged=world.writes().length;const duplicate=await world.request(repeated.key,repeated.draft);
  assert.equal(duplicate.status,'rejected');
  if(duplicate.status==='rejected') assert.equal(duplicate.error.error.code,'invalid-state');
  assert.equal(world.writes().length,unchanged);
  world.verifyMessages();
});

test('unknown Free content and Quiet refuse before effect writes',async context=>{
  const world=await ModuleWorld.open(context);await world.start();await world.advance(2000);
  const unapproved=moment(world,'unapproved-work');assert.equal((await world.request(unapproved.key,unapproved.draft)).status,'rejected');
  assert.equal(world.outcomes('unapproved-work').length,0);
  let command=deviceCommand('device-mode-set',{requestId:'free',mode:'free'});
  await world.request(command.key,command.draft);await world.advance(2000);
  await world.device.request({ip:LINES_ADDRESS,token:SYNTHETIC_TOKEN},'PUT','/effects',{write:{command:'display',animType:'custom',animData:'1 1 1 1 1 1 0 1'}});
  const before=world.writes().length;
  command=moment(world,'unknown');const reply=await world.request(command.key,command.draft);
  assert.equal(reply.status,'rejected');
  if(reply.status==='rejected') assert.equal(reply.error.error.code,'unsupported-capability');
  assert.equal(world.writes().length,before);
  command=deviceCommand('device-mode-set',{requestId:'quiet',mode:'quiet'});await world.request(command.key,command.draft);
  command=moment(world,'quiet-moment');const quiet=await world.request(command.key,command.draft);
  assert.equal(quiet.status,'rejected');
  if(quiet.status==='rejected') assert.equal(quiet.error.error.code,'unsupported-capability');
  assert.equal(world.outcomes('unknown').length,0);world.verifyMessages();
});

test('Work restoration uses current sessions and an alert preempts the moment',async context=>{
  const world=await ModuleWorld.open(context);await world.core.set('alpha');await world.start();await world.advance(2000);
  const before=world.writes().length;
  const command=moment(world,'work');command.draft.data={...command.draft.data,durationMs:5000,priorityClass:'event',coversStatus:true};
  const reply=await world.request(command.key,command.draft);assert.equal(reply.status,'accepted');
  await world.until(()=>world.writes().length>before,5000,'moment write');
  await world.core.set('beta');await world.advance(250);
  await world.core.set('beta',{attention:[{kind:'approval',id:{status:'known',id:'approval-1'},turn:{status:'known',id:'t1'}}]});
  await world.until(()=>world.outcomes('work').length>0,10000,'alert preemption');
  assert.equal(world.outcomes('work')[0]?.data.result,'failed');
  assert.equal(world.outcomes('work')[0]?.data.evidence,'transmitted');
  await world.until(()=>world.wall()?.tasks.some(t=>t.status==='blocked')===true,5000,'current alert');
  assert.ok(world.writes().slice(before).filter(w=>w.animType==='custom').length>=2);
  world.verifyMessages();
});

test('an uncertain moment write holds the device and is never retried or replayed',async context=>{
  const world=await ModuleWorld.open(context);await world.start();await world.advance(2000);
  let command=deviceCommand('device-mode-set',{requestId:'free',mode:'free'});await world.request(command.key,command.draft);await world.advance(2000);
  world.device.loseNextAnswer('/effects');const before=world.writes().length;
  command=moment(world,'lost');assert.equal((await world.request(command.key,command.draft)).status,'accepted');
  await world.until(()=>world.outcomes('lost').length>0,15000,'uncertain write');
  assert.equal(world.outcomes('lost')[0]?.data.result,'uncertain');
  await world.until(()=>world.device_()?.held?.requestId==='lost',5000,'published hold');
  const count=world.writes().slice(before).filter(w=>w.animType==='custom').length;assert.equal(count,1);
  await world.restart();await world.advance(3000);
  assert.equal(world.writes().slice(before).filter(w=>w.animType==='custom').length,count);
  assert.equal(world.device_()?.held?.requestId,'lost');world.verifyMessages();
});

test('a newer explicit mode retires a running moment and no stale Free scene is restored',async context=>{
  const world=await ModuleWorld.open(context);await world.start();await world.advance(2000);
  let command=deviceCommand('device-mode-set',{requestId:'free',mode:'free'});await world.request(command.key,command.draft);await world.advance(2000);
  const before=world.writes().length;command=moment(world,'preempted');command.draft.data={...command.draft.data,durationMs:5000};
  await world.request(command.key,command.draft);await world.until(()=>world.writes().slice(before).some(w=>w.animType==='custom'),5000,'moment write');
  command=deviceCommand('device-mode-set',{requestId:'quiet-new',mode:'quiet'});await world.request(command.key,command.draft);
  await world.until(()=>world.outcomes('preempted').length>0,5000,'retired moment');
  assert.equal(world.outcomes('preempted')[0]?.data.result,'failed');
  const taken=world.writes().length;await world.advance(6000);
  const mode=world.device_()?.desired.mode;assert.equal(mode?.status==='known' && mode.value,'quiet');
  assert.equal(world.writes().slice(taken).filter(w=>w.brightness===50).length,0);
  assert.equal(world.device.state().devices[LINES_ADDRESS]?.brightness,10);
  world.verifyMessages();
});


test('an external Free brightness choice supersedes restoration',async context=>{
  const world=await ModuleWorld.open(context);await world.start();await world.advance(2000);
  let command=deviceCommand('device-mode-set',{requestId:'free',mode:'free'});await world.request(command.key,command.draft);await world.advance(2000);
  const before=world.writes().length;command=moment(world,'external-brightness');command.draft.data={...command.draft.data,durationMs:5000};
  assert.equal((await world.request(command.key,command.draft)).status,'accepted');
  await world.until(()=>world.writes().slice(before).some(w=>w.animType==='custom'),5000,'moment started');
  await world.device.request({ip:LINES_ADDRESS,token:SYNTHETIC_TOKEN},'PUT','/state',{brightness:{value:23,duration:0}});
  const changed=world.writes().length;
  await world.until(()=>world.outcomes('external-brightness').length>0,10000,'external choice preempts');
  assert.equal(world.outcomes('external-brightness')[0]?.data.result,'failed');
  assert.equal(world.device.state().devices[LINES_ADDRESS]?.brightness,23);
  assert.equal(world.writes().slice(changed).filter(w=>w.brightness===50 || w.select!==undefined).length,0);
  world.verifyMessages();
});
