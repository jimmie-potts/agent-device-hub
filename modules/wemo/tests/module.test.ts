import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createWemoModule} from '../src/module.js';
void test('a configured owner admits one power command through its designated writer',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wemo-module-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator');let sends=0;
  const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:false,firmware:'synthetic'}),setPower:(_on,_signal,before)=>{assert.equal(before(),undefined);sends++;return Promise.resolve({result:'succeeded',evidence:'transmitted',connection:'available'});}})}),
    {bus,stateDir:dir,section:{plugs:[{id:'desk-lamp',label:'Desk lamp',address:'192.0.2.60',port:49153,mac:'000000000001',model:'F7C063',firmware:'synthetic',configurationRevision:1}]}});
  t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});
  await host.start();await new Promise(r=>setTimeout(r,30));
  const answer=await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}},{requestId:'once',timeoutMs:100});
  assert.equal(answer.status,'accepted');await new Promise(r=>setTimeout(r,30));assert.equal(sends,1);
});

const section={plugs:[{id:'desk-lamp',label:'Desk lamp',address:'192.0.2.60',port:49153,mac:'000000000001',model:'F7C063',firmware:'synthetic',configurationRevision:1},{id:'shelf-lamp',label:'Shelf lamp',address:'192.0.2.61',port:49153,mac:'000000000002',model:'F7C063',firmware:'synthetic',configurationRevision:1}]};
async function until(check:()=>boolean){const deadline=Date.now()+2000;while(!check()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(check(),true);}
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
