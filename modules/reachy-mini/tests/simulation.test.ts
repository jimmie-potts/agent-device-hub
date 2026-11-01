import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {test} from 'node:test';
import {InProcessBus,type DeviceLink} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {registration,REACHY_SIMULATED_SECTION as section} from '../src/registration.js';
import type {ReachyState} from '../src/contracts.js';
void test('remote simulation still completes a gesture after its bounded event history rolls over',{timeout:10000},async t=>{
 const simulation=registration.simulation;assert.ok(simulation);const held=simulation.run.create({now:Date.now,scheduler:{after:(ms,cb)=>{const timer=setTimeout(cb,ms);return()=>clearTimeout(timer);}}}),signal=new AbortController().signal;
 for(let n=0;n<70;n++)await simulation.run.serve(held,{method:'move',args:[0,0],signal,current:true});
 const link:DeviceLink={handover:undefined,onPush(){},call:async(method,args,signal=new AbortController().signal)=>{try{return {status:'answered',value:await simulation.run.serve(held,{method,args,signal,current:true})};}catch{return {status:'failed'};}}};
 const dir=await mkdtemp(join(tmpdir(),'reachy-simulation-')),bus=new InProcessBus(),operator=bus.connect('bunny/parts/operator'),host=new ModuleHarness(simulation.run.remote(link),{bus,stateDir:dir,section});let state:ReachyState|undefined;
 const until=async(check:()=>boolean):Promise<void>=>{for(let n=0;n<600;n++){if(check())return;await pause(5);}assert.fail('missing remote simulation completion');};
 await operator.subscribe<ReachyState>('bunny.state.reachy-state.*',m=>{state=m.data;});t.after(async()=>{await host.stop();await operator.close();await rm(dir,{recursive:true,force:true});});await host.start();await until(()=>state?.connection==='available');
 for(const [family,data,id] of [['reachy-control',{action:'takeover'},'takeover'],['reachy-gesture',{gesture:'neutral'},'after-rollover']] as const){
  const reply=await operator.request(`bunny.cmd.${family}.reachy-sim`,{type:`org.bunny.reachy.${family.slice(7)}.requested`,subject:'reachy-sim',dataschema:`https://bunny.invalid/events/${family}/2.0`,data:{...data,expectedConfigurationRevision:state?.configurationRevision,expectedGeneration:state?.generation}},{requestId:id,timeoutMs:3000});assert.equal(reply.status,'accepted');await until(()=>state?.lastOutcome?.requestId===id);assert.equal(state?.lastOutcome?.result,'succeeded');
 }
});
