// Current-source format/restart proof only; these phase names do not select historical release artifacts.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createWemoModule,WEMO_SIMULATED_SECTION} from '@jimmie-potts/wemo';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {createPowerLimits,PowerLimitStore} from '../../src/core/power-limits.js';
const [directory,phase]=process.argv.slice(2);assert.ok(directory!==undefined&&directory!==''&&phase!==undefined&&phase!=='');
const bus=new InProcessBus(),operator=bus.connect('bunny/parts/qualification');let effects=0,record:DeviceRecord|undefined;
await operator.subscribe<DeviceRecord>('bunny.state.device.desk-lamp',message=>{record=message.data;});
const host=new ModuleHarness(createWemoModule({transport:()=>({read:()=>Promise.resolve({power:true,firmware:'synthetic-firmware'}),setPower:(_on,_signal,before)=>{const code=before();if(code!==undefined)return Promise.resolve({result:'failed',evidence:'none',code,connection:'unknown'});effects++;return Promise.resolve({result:'uncertain',evidence:'none',code:'uncertain-result',connection:'available'});}})}),{bus,stateDir:directory,section:{plugs:[WEMO_SIMULATED_SECTION.plugs[0]]}});
const db=new DatabaseSync(join(directory,'limits.sqlite'));
const store=new PowerLimitStore(db);let limitSends=0;
const limits=createPowerLimits({store,clock:()=>Date.now(),scheduler:{after:()=>()=>{}},active:()=>true,targets:()=>['desk-lamp'],owner:()=> 'bunny/modules/wemo',read:()=>Promise.resolve(record),current:()=>record,
 send:(_target,_on,_record,requestId)=>{limitSends++;return Promise.resolve({requestId,outcome:'uncertain'});}});
const until=async(check:()=>boolean)=>{const end=Date.now()+3000;while(!check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(check());};
try{
 await host.start();await until(()=>record?.observed.status==='known');
 if(phase==='baseline'){
  await limits.save('desk-lamp',{enabled:true,durationMs:4000});await limits.tick();assert.equal(limitSends,1);
  const answer=await operator.request('bunny.cmd.power-set.desk-lamp',{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:false}},{requestId:'retained-uncertain',timeoutMs:1000});assert.equal(answer.status,'accepted');await until(()=>record?.held!==undefined);
 }else{
  assert.equal(record?.held?.requestId,'retained-uncertain');await limits.tick();assert.equal(limitSends,0);if(phase==='candidate')await limits.save('desk-lamp',{enabled:true,durationMs:6000,expectedSettingsRevision:1});
 }
 const moduleDb=host.moduleDatabase();assert.ok(moduleDb);
 process.stdout.write(JSON.stringify({phase,pid:process.pid,effects,limitSends,settings:limits.get('desk-lamp'),requests:moduleDb.prepare('SELECT record FROM wemo_requests ORDER BY request_id').all(),outcomes:moduleDb.prepare("SELECT id,message FROM bunny_outbox WHERE kind='outcome' ORDER BY seq").all()}));
}finally{await limits.close();db.close();await host.stop();await operator.close();assert.deepEqual(host.failures,[]);}
