import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {createWemoModule} from '../src/module.js';
void test('a configured owner admits one power command through its designated writer',{timeout:10000},async t=>{
  const now=Date.now(),clock={now:()=>now};
  const dir=await mkdtemp(join(tmpdir(),'wemo-module-')),bus=new InProcessBus({now:clock.now}),operator=bus.connect('bunny/parts/operator');let sends=0,latest:DeviceRecord|undefined;
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),setPower:(on,_signal,before)=>{assert.equal(on,true);assert.equal(before(),undefined);sends++;return Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'});}})}),
    {bus,clock,stateDir:dir,section:{plugs:[{id:'desk-lamp',label:'Desk lamp',address:'192.0.2.60',port:49153,mac:'000000000001',model:'F7C063',firmware:'synthetic',configurationRevision:1}]}});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});
  await operator.subscribe<DeviceRecord>('bunny.state.device.desk-lamp',message=>{latest=message.data;});
  await host.start();await until(()=>latest?.availability==='available');
  const answer=await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'once',timeoutMs:100});
  assert.equal(answer.status,'accepted');await until(()=>latest?.lastOutcome.status==='known');assert.equal(sends,1);
  assert.ok(latest?.lastOutcome.status==='known');assert.equal(latest.lastOutcome.outcome.requestId,'once');
  assert.equal(latest.lastOutcome.outcome.result,'succeeded');assert.equal(latest.lastOutcome.outcome.evidence,'transmitted');
  assert.equal(latest.pending,0);assert.deepEqual(host.failures,[]);
});

const section={plugs:[{id:'desk-lamp',label:'Desk lamp',address:'192.0.2.60',port:49153,mac:'000000000001',model:'F7C063',firmware:'synthetic',configurationRevision:1},{id:'shelf-lamp',label:'Shelf lamp',address:'192.0.2.61',port:49153,mac:'000000000002',model:'F7C063',firmware:'synthetic',configurationRevision:1}]};
async function until(check:()=>boolean){const deadline=Date.now()+2000;while(!check()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(check(),true);}
void test('an admitted Wemo command expires at the final writer guard without a power send',{timeout:10000},async t=>{
  let now=Date.now(),sends=0,entered=false;const clock={now:()=>now};let finalGuard:ErrorCode|undefined,latest:DeviceRecord|undefined;
  const dir=await mkdtemp(join(tmpdir(),'wemo-expired-')),bus=new InProcessBus({now:clock.now}),operator=bus.connect('bunny/parts/operator');
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),setPower:(_on,_signal,before)=>{
    entered=true;now+=101;finalGuard=before();
    if(finalGuard!==undefined)return Promise.resolve({result:'failed',evidence:'none',code:finalGuard,connection:'available'});
    sends++;return Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'});
  }})}),{bus,clock,stateDir:dir,section:{plugs:[section.plugs[0]]}});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});
  await operator.subscribe<DeviceRecord>('bunny.state.device.desk-lamp',message=>{latest=message.data;});
  await host.start();await until(()=>latest?.availability==='available');
  const answer=await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'expires-before-effect',timeoutMs:100});
  assert.equal(answer.status,'accepted');await until(()=>latest?.lastOutcome.status==='known');
  assert.equal(entered,true);assert.equal(finalGuard,'expired');assert.equal(sends,0);
  assert.ok(latest?.lastOutcome.status==='known');assert.equal(latest.lastOutcome.outcome.requestId,'expires-before-effect');
  assert.equal(latest.lastOutcome.outcome.result,'failed');assert.equal(latest.lastOutcome.outcome.evidence,'none');assert.equal(latest.lastOutcome.outcome.error?.code,'expired');
  assert.equal(latest.pending,0);assert.deepEqual(host.failures,[]);
});
void test('two independent queues, duplicate fences, uncertain hold and explicit read-only release survive restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wemo-queues-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');let first=true,release:(()=>void)|undefined;
  const sends:string[]=[],records=new Map<string,import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>();
  await operator.subscribe<import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>('bunny.state.device.*',message=>{records.set(message.subject,message.data);});
  const make=()=>new ModuleHarness(createWemoModule({transport:plug=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),async setPower(_on,signal,before){const code=before();assert.equal(code,undefined);sends.push(plug.id);
    if(plug.id==='desk-lamp'&&first){first=false;await new Promise<void>(resolve=>{release=resolve;signal.addEventListener('abort',()=>resolve(),{once:true});});return {result:'uncertain',evidence:'none',code:'uncertain-result',connection:'unknown'};}
    return {result:'succeeded',evidence:'transmitted',connection:'available'};}})}),{bus,stateDir:dir,section});
  let host=make();t.after(async()=>{release?.();await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});
  const send=(id:string,requestId:string,on=true)=>operator.request(`bunny.cmd.power-set.${id}`,{type:'org.bunny.power.set.requested',subject:id,dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on}},{requestId,timeoutMs:1000});
  await host.start();await until(()=>records.get('desk-lamp')?.availability==='available'&&records.get('shelf-lamp')?.availability==='available');
  assert.equal((await send('desk-lamp','uncertain')).status,'accepted');await until(()=>sends.length===1);
  assert.equal((await send('shelf-lamp','independent')).status,'accepted');await until(()=>records.get('shelf-lamp')?.lastOutcome.status==='known');assert.equal(sends.length,2);
  assert.equal((await send('desk-lamp','uncertain')).status,'accepted');assert.equal(sends.length,2);
  const conflict=await send('desk-lamp','uncertain',false);assert.equal(conflict.status,'rejected');
  release?.();await until(()=>records.get('desk-lamp')?.held?.requestId==='uncertain');
  await host.stop();host=make();await host.start();await until(()=>records.get('desk-lamp')?.observed.status==='known');
  assert.equal(records.get('desk-lamp')?.held?.requestId,'uncertain');assert.equal((await send('desk-lamp','blocked')).status,'rejected');assert.equal(sends.length,2);
  const held=records.get('desk-lamp');assert.ok(held);
  const answer=await operator.request('bunny.cmd.wemo-hold-release.desk-lamp',{type:'org.bunny.wemo-hold.release.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/wemo-hold-release/2.0',data:{expectedConfigurationRevision:held.configurationRevision,expectedGeneration:held.generation,heldRequestId:'uncertain'}},{requestId:'release',timeoutMs:1000});
  assert.equal(answer.status,'accepted');await until(()=>records.get('desk-lamp')?.held===undefined);assert.equal(sends.length,2,'release only reads identity and power');
  assert.equal((await send('desk-lamp','after-release')).status,'accepted');await until(()=>sends.length===3);
});
void test('a durable admission failure sends no write',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wemo-storage-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');let sends=0,ready=false;
  await operator.subscribe<import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>('bunny.state.device.*',message=>{ready=message.data.availability==='available';});
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),setPower:()=>{sends++;return Promise.reject(new Error('unexpected'));}})}),{bus,stateDir:dir,section:{plugs:[section.plugs[0]]}});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();await until(()=>ready);
  host.moduleDatabase()?.exec("CREATE TRIGGER refuse_wemo BEFORE INSERT ON wemo_requests BEGIN SELECT RAISE(FAIL,'database or disk is full'); END");
  const answer=await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'disk-full',timeoutMs:1000});
  assert.equal(answer.status,'rejected');assert.equal(sends,0);
});
void test('the persisted request fence is checked again after transport preparation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wemo-final-fence-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');let prepared=false,ready=false,effects=0,release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await operator.subscribe<import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>('bunny.state.device.*',message=>{ready=message.data.availability==='available';});
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),async setPower(_on,_signal,before){prepared=true;await gate;const code=before();if(code!==undefined)return {result:'failed',evidence:'none',code,connection:'unknown'};effects++;return {result:'succeeded',evidence:'transmitted',connection:'available'};}})}),{bus,stateDir:dir,section:{plugs:[section.plugs[0]]}});
  t.after(async()=>{release();await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();await until(()=>ready);
  assert.equal((await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'fence',timeoutMs:1000})).status,'accepted');await until(()=>prepared);
  host.moduleDatabase()?.exec("UPDATE wemo_requests SET record=json_set(record,'$.digest','changed') WHERE request_id='fence'");release();await until(()=>Number(host.moduleDatabase()?.prepare("SELECT count(*) AS n FROM wemo_requests WHERE json_extract(record,'$.state')='done'").get()?.n)===1);assert.equal(effects,0);
});
void test('a silent read never blocks start or bounded shutdown and never invents off',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wemo-silent-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');let reading=false;
 const records:import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord[]=[];await operator.subscribe<import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>('bunny.state.device.*',message=>{records.push(message.data);});
 const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>{reading=true;return new Promise(()=>{});},setPower:()=>Promise.reject(new Error('unexpected write'))})}),{bus,stateDir:dir,section:{plugs:[section.plugs[0]]}});
 t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();await until(()=>reading);await host.stop();assert.deepEqual(host.failures,[]);assert.ok(records.every(record=>record.observed.status==='unknown'));
});

for(const triggerDelay of [5000,15000])void test(`a ${triggerDelay===5000?'polling':'stale-observation'} storage fault records one internal ERROR and fences writes without claiming a network failure`,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wemo-poll-storage-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');
  let ready=false,sends=0,reads=0;const polls=new Set<()=>void>();
  const scheduler={after:(ms:number,callback:()=>void)=>{if(ms===5000||ms===15000){const scheduled=()=>{if(ms===triggerDelay)callback();};polls.add(scheduled);return ()=>{polls.delete(scheduled);};}const timer=setTimeout(callback,ms);return ()=>clearTimeout(timer);}};
  await operator.subscribe<import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>('bunny.state.device.*',message=>{ready=message.data.availability==='available';});
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>{reads++;return Promise.resolve({power:false,firmware:'synthetic'});},setPower:()=>{sends++;return Promise.reject(new Error('unexpected write'));}})}),{bus,stateDir:dir,scheduler,section:{plugs:[section.plugs[0]]}});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();await until(()=>ready);
  host.moduleDatabase()?.exec("CREATE TRIGGER refuse_poll BEFORE INSERT ON wemo_devices BEGIN SELECT RAISE(FAIL,'private storage text'); END");
  assert.ok(polls.size>0);for(const poll of [...polls])poll();await new Promise(r=>setTimeout(r,30));
  const faults=host.logs.filter(log=>log.event==='operation.failed'&&log.fields['bunny.operation']==='storage');
  assert.equal(faults.length,1);assert.equal(faults[0]?.level,'error');assert.equal(faults[0]?.fields['bunny.code'],'internal');
  assert.ok(!JSON.stringify(host.logs).includes('private storage text'));
  host.moduleDatabase()?.exec('DROP TRIGGER refuse_poll');
  assert.equal((await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'after-storage-fault',timeoutMs:1000})).status,'rejected');
  for(const callback of [...polls])callback();await new Promise(r=>setTimeout(r,30));
  assert.equal(reads,triggerDelay===5000?2:1);assert.equal(sends,0);assert.equal(host.logs.filter(log=>log.event==='operation.failed'&&log.fields['bunny.operation']==='storage').length,1);
  assert.equal(host.logs.filter(log=>log.event==='device.unavailable').length,0);
});
void test('completion persistence faults are internal ERRORs correlated with the original command',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wemo-completion-storage-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');let ready=false,sends=0;
  await operator.subscribe<import('@jimmie-potts/event-contracts/v2/devices').DeviceRecord>('bunny.state.device.*',message=>{ready=message.data.availability==='available';});
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),setPower:()=>{sends++;return Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'});}})}),{bus,stateDir:dir,section:{plugs:[section.plugs[0]]}});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();await until(()=>ready);
  host.moduleDatabase()?.exec("CREATE TRIGGER refuse_done BEFORE INSERT ON wemo_requests WHEN json_extract(NEW.record,'$.state')='done' BEGIN SELECT RAISE(FAIL,'private storage text'); END");
  await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'completion-fault',timeoutMs:1000});
  await until(()=>sends===1);await new Promise(r=>setTimeout(r,30));
  const fault=host.logs.find(log=>log.event==='operation.failed'&&log.fields['bunny.operation']==='storage');
  assert.ok(fault);assert.equal(fault.level,'error');assert.equal(fault.fields['bunny.request.id'],'completion-fault');assert.ok(fault.trace);assert.ok(host.received.some(value=>value.traceparent===fault.trace?.traceparent));
  assert.equal(sends,1);assert.ok(!JSON.stringify(host.logs).includes('private storage text'));
});
