import {approvalPrompt,sessionStarted,turnStarted} from '../../fixtures/agents.js';
import {MICRODUCK_SIMULATED_SECTION,type MicroDuckState} from '@jimmie-potts/microduck';
import {act,answers,deviceState,dispatchOnce,expect,holds,recorded,running,publish,type Harness,type Scenario} from '../framework.js';
const owner='bunny/modules/microduck';
const status=(h:Harness)=>h.reader.states<MicroDuckState>('microduck-state',owner)[0]?.data;
const moves=(h:Harness)=>deviceState<{moves:number}>(h,'microduck').moves;
const command=(h:Harness,family:string,data:object)=>({key:`bunny.cmd.${family}.microduck-sim`,draft:{type:`org.bunny.microduck.${family.slice(10)}.requested`,subject:'microduck-sim',dataschema:`https://bunny.invalid/events/${family}/2.0`,data:{...data,expectedConfigurationRevision:status(h)?.configurationRevision,expectedGeneration:status(h)?.generation}}});
export const scenarios:readonly Scenario[]=[{
 id:'microduck-simulator-controls',title:'MicroDuck tracked simulator controls are bounded, passive on inspection and restart without replay',
 seed:{modules:['core','microduck'],sections:{'microduck':MICRODUCK_SIMULATED_SECTION},follows:[{owner,families:['device','microduck-state']},{owner:'bunny/core',families:['operation']}]},
 steps:[
  expect('core and MicroDuck have fresh simulated state',async h=>await running(h,['core','microduck'])===true&&status(h)?.connection==='available'||'simulator unavailable'),
  holds('inspection never moves the robot',h=>moves(h)===0||'inspection moved robot',100),
  expect('read-only credential cannot move',answers({as:'reader',method:'POST',path:'/api/v2/commands/microduck-gesture',body:{target:'microduck-sim',data:{gesture:'notice'},requestId:'microduck-readonly'}},answer=>answer.status===403||'reader mutation admitted')),
  act('owner explicitly takes over',h=>dispatchOnce(h,'operator','microduck-takeover',command(h,'microduck-control',{action:'takeover'}),'microduck-takeover')),
  expect('takeover has a tracked completion',h=>recorded(h,'microduck-takeover','succeeded','observed')),
  act('owner selects a finite notice',h=>dispatchOnce(h,'operator','microduck-notice',command(h,'microduck-gesture',{gesture:'notice'}),'microduck-notice')),
  expect('notice has truthful transport evidence',h=>recorded(h,'microduck-notice','succeeded','transmitted')),
  expect('only catalog and neutral stages are sent',h=>moves(h)===2||'unexpected move count'),
  act('runtime restarts using latest private state',h=>h.restart()),
  expect('restarted state remains under takeover',h=>status(h)?.connection==='available'&&status(h)?.takeover===true||'takeover/freshness missing'),
  holds('restart does not replay a stage',h=>moves(h)===2||'motion replayed',200),
  act('operator explicitly resumes future automatic expression',h=>dispatchOnce(h,'operator','microduck-resume',command(h,'microduck-control',{action:'resume-auto'}),'microduck-resume')),
  expect('resume completes locally',h=>recorded(h,'microduck-resume','succeeded','observed')),
  act('one fresh coding session raises live attention',async h=>{await publish(h,sessionStarted);await publish(h,turnStarted);await publish(h,approvalPrompt('microduck-live'));}),
  expect('the core tracks one automatic head program',h=>moves(h)===4&&status(h)?.active===null||'automatic program missing'),

 ],
}];
