import assert from 'node:assert/strict';
import {test} from './support.js';
import {deviceCommand, ModuleWorld} from './module-support.js';
import {LINES_ADDRESS, SYNTHETIC_TOKEN} from '../src/index.js';
import {DatabaseSync} from 'node:sqlite';
import {admitCommand, discovered, sceneList} from '../src/controls.js';
import {initJournal, journalRow, type Outcome, type Transact} from '../src/journal.js';
import {playMoment, type MomentCommand} from '../src/moments.js';
import {transaction} from '../src/sqlite.js';
import {isObject} from '../src/compat.js';
import {initialize} from '../src/database.js';
import type {LightRequest} from '../src/transport.js';
const moment=(world:ModuleWorld,id:string,start=world.clock.now())=>deviceCommand('moment-play',
  {requestId:id,momentId:`moment-${id}`,mood:'celebrate',durationMs:1000,priorityClass:'flourish',coversStatus:false,startAtMs:start,toleranceMs:1000});

for(const choice of ['none','scene','configuration','mode','work-configuration'] as const) {
  test(`restoration rechecks a newer ${choice} choice between awaited writes`,async()=>{
    const db=new DatabaseSync(':memory:'),work=choice==='work-configuration';
    try {
      initialize(db,()=>10);
      db.exec(`INSERT OR REPLACE INTO meta VALUES('mode','${work?'work':'free'}');
        CREATE TABLE nanoleaf_devices(device TEXT PRIMARY KEY,configuration_revision INTEGER); INSERT INTO nanoleaf_devices VALUES('wall',0)`);
      initJournal(db);discovered(db,['Ocean','New scene'],'wall',()=>{});
      const newer=sceneList(db,'wall').find(scene=>scene.name==='New scene');assert.ok(newer);
      const command:MomentCommand={kind:'moment.play',requestId:'moment-one',momentId:'one',mood:'celebrate',durationMs:1000,
        priorityClass:'event',coversStatus:work,startAtMs:10000,toleranceMs:1000,configurationRevision:0,
        ...(work?{}:{freeBase:{name:'Ocean',brightness:50}})};
      db.prepare("INSERT INTO control_journal(id,device,kind,command,mode_revision,phase,accepted,expires) VALUES(?,?,?,?,0,'queued',10,11)")
        .run(command.requestId,'wall',command.kind,JSON.stringify(command));
      const outcomes:Outcome[]=[],writes:{endpoint:string;payload:unknown}[]=[];
      const transact:Transact=action=>Promise.resolve(transaction(db,()=>action(message=>{if(message.type==='outcome') outcomes.push(message);})));
      let now=10000,selected='Ocean';
      const request:LightRequest=(_target,method,endpoint,payload)=>{
        if(method==='GET') return Promise.resolve(endpoint==='/effects'?{select:selected,effectsList:['Ocean','New scene']}:{brightness:{value:50}});
        writes.push({endpoint:endpoint??'',payload});
        if(endpoint==='/effects' && isObject(payload)) selected=typeof payload.select==='string'?payload.select:'*Dynamic*';
        if(endpoint==='/state') {
          if(choice==='scene') transaction(db,()=>admitCommand(db,'unused',{id:'owner-new-scene',device:'wall',
            command:{kind:'scene.activate',sceneId:newer.id},instant:now/1000,expires:now/1000+5},()=>{}));
          if(choice==='configuration' || choice==='work-configuration') db.exec("UPDATE nanoleaf_devices SET configuration_revision=1 WHERE device='wall'");
          if(choice==='mode') transaction(db,()=>admitCommand(db,'unused',{id:'owner-mode',device:'wall',command:{kind:'mode.set',mode:'quiet'},
            instant:now/1000,expires:now/1000+5},message=>{if(message.type==='outcome') outcomes.push(message);}));
        }
        return Promise.resolve({});
      };
      const row=journalRow(db,'moment-one');assert.ok(row);
      await playMoment({db,device:'wall',row,config:{line_groups:[[1,2],[3,4]],line_positions:[[0,0],[1,0]]},transact,request,now:()=>now,
        sleep:seconds=>{now+=seconds*1000;return Promise.resolve();},current:()=>[],taken:()=>{},restore:async(_snapshot,execution)=>{
          await execution.call(()=>request({ip:'synthetic',token:'synthetic'},'PUT','/state',{brightness:{value:50,duration:0}}));
          await execution.call(()=>request({ip:'synthetic',token:'synthetic'},'PUT','/effects',{write:{animType:'static'}}));
        }});
      const restored=writes.filter(write=>write.endpoint==='/effects' && isObject(write.payload) &&
        (write.payload.select==='Ocean' || isObject(write.payload.write) && write.payload.write.animType==='static'));
      const outcome=outcomes.find(message=>message.requestId==='moment-one');assert.ok(outcome);
      assert.equal(restored.length,choice==='none'?1:0,'a newer choice prevents every remaining restoration write');
      assert.equal(outcome.result,choice==='none'?'succeeded':'failed');assert.equal(outcome.evidence,'transmitted');
      if(choice!=='none') assert.equal(outcome.error?.code,'cancelled');
      if(choice==='scene') assert.ok(journalRow(db,'owner-new-scene'),'the newer scene remains queued');
    }finally {db.close();}
  });
}

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
