// Shared scheduling management over the actual gateway and durable core, with a simulated LIFX consumer.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {LIFX_SIMULATED_SECTION} from '@jimmie-potts/lifx';
import {StepFailure,act,bodyOf,expect,holds,running,type Harness,type Scenario,type GatewayCall} from './framework.js';

type Saved={id:string;name:string;target:string;enabled:boolean;days:number[];onTime:string;offTime:string;next?:{atMs:number;on:boolean}};
const saved=new WeakMap<Harness,Saved>();
async function control(h:Harness,method:GatewayCall['method'],path:string,body?:object,status=200):Promise<Saved> {
  const answer=await h.gateway({as:'operator',method,path:`/api/v2/automation/power-schedules${path}`,headers:{'bunny-request':'1'},...(body===undefined?{}:{body})});
  const value=bodyOf<Saved & {schema:string}>(answer);
  if(answer.status!==status || value?.schema!=='automation/2.0') throw new StepFailure('power schedule control was refused');
  return value;
}
const definition=(h:Harness)=>({name:'Reading light',target:'pendant-1',days:[(new Date(h.now()).getDay()+1)%7],onTime:'17:00',offTime:'20:00'});
const commands=(h:Harness)=>h.logs().filter(({record})=>record.event_name==='runtime.command.admitted' &&
  record.attributes['bunny.routing.key']==='bunny.cmd.power-set.pendant-1' && record.attributes['bunny.participant']==='bunny/core').length;
export const powerScheduleScenarios:readonly Scenario[]=[{
  id:'weekly-power-schedules',title:'shared power schedule controls persist without catch-up or page-driven writes',
  seed:{modules:['core','lifx'],config:{lifx:LIFX_SIMULATED_SECTION},follows:[{owner:'bunny/core',families:['operation']},{owner:'bunny/modules/lifx',families:['device']}]},
  steps:[
    expect('the configured generic power consumer is available',async h=>{
      const ready=await running(h,['core','lifx']);
      return ready===true?h.reader.states<DeviceRecord>('device','bunny/modules/lifx').some(state=>state.data.id==='pendant-1' && state.data.capabilities.power.supported) || 'power capability has not synced':ready;
    },10000),
    act('the owner saves a disabled future weekly schedule',async h=>{
      const value=await control(h,'POST','',definition(h),201);
      if(value.enabled || value.next!==undefined) throw new StepFailure('creation activated a schedule');saved.set(h,value);
    }),
    act('the read-only client cannot enable the saved schedule',async h=>{
      const value=saved.get(h);if(value===undefined) throw new StepFailure('schedule missing');
      const answer=await h.gateway({as:'reader',method:'POST',path:`/api/v2/automation/power-schedules/${value.id}/enable`,headers:{'bunny-request':'1'},body:{}});
      if(answer.status!==403) throw new StepFailure('read-only enable was not refused');
    }),
    act('the owner explicitly enables and edits the future definition',async h=>{
      const value=saved.get(h);if(value===undefined) throw new StepFailure('schedule missing');
      await control(h,'POST',`/${value.id}/enable`,{});
      const edited=await control(h,'PUT',`/${value.id}`,{...definition(h),offTime:'21:00'});
      if(!edited.enabled || edited.next===undefined || edited.next.atMs<=h.now()) throw new StepFailure('definition did not retain enabled with a future boundary');
      saved.set(h,edited);
    }),
    holds('saving and enabling send no power command',h=>commands(h)===0 || 'a control operation sent power immediately',300),
    act('the runtime restarts with its saved definitions',h=>h.restart()),
    expect('the restarted core retains the enabled definition and schedules only a future boundary',async h=>{
      const ready=await running(h,['core','lifx']);if(ready!==true) return ready;
      const value=saved.get(h);if(value===undefined) return 'schedule missing';
      const current=await control(h,'GET',`/${value.id}`);
      return current.enabled && current.offTime==='21:00' && current.next!==undefined && current.next.atMs>h.now() || 'saved definition or future boundary missing';
    },10000),
    holds('restart and SDK resync dispatch no catch-up command',h=>commands(h)===0 || 'restart replayed power',300),
    act('the owner disables and removes the schedule',async h=>{
      const value=saved.get(h);if(value===undefined) throw new StepFailure('schedule missing');
      const disabled=await control(h,'POST',`/${value.id}/disable`,{});
      if(disabled.enabled || disabled.next!==undefined) throw new StepFailure('disabled schedule retained a next switch');
      await control(h,'DELETE',`/${value.id}`);
    }),
  ],
}];
