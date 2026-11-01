import {REACHY_SIMULATED_SECTION,type ReachyState} from '@jimmie-potts/reachy-mini';
import {act,answers,deviceState,dispatchOnce,expect,holds,recorded,running,type Harness,type Scenario} from '../framework.js';
const owner='bunny/modules/reachy-mini';
const status=(h:Harness)=>h.reader.states<ReachyState>('reachy-state',owner)[0]?.data;
const moves=(h:Harness)=>deviceState<{moves:number}>(h,'reachy-mini').moves;
const command=(h:Harness,family:string,data:object)=>({key:`bunny.cmd.${family}.reachy-sim`,draft:{type:`org.bunny.reachy.${family.slice(7)}.requested`,subject:'reachy-sim',dataschema:`https://bunny.invalid/events/${family}/2.0`,data:{...data,expectedConfigurationRevision:status(h)?.configurationRevision,expectedGeneration:status(h)?.generation}}});
export const scenarios:readonly Scenario[]=[{
 id:'reachy-simulator-controls',title:'Reachy tracked simulator controls are bounded, passive on inspection and restart without replay',
 seed:{modules:['core','reachy-mini'],sections:{'reachy-mini':REACHY_SIMULATED_SECTION},follows:[{owner,families:['device','reachy-state']},{owner:'bunny/core',families:['operation']}]},
 steps:[
  expect('core and Reachy have fresh simulated state',async h=>await running(h,['core','reachy-mini'])===true&&status(h)?.connection==='available'||'simulator unavailable'),
  holds('inspection never moves the robot',h=>moves(h)===0||'inspection moved robot',100),
  expect('read-only credential cannot move',answers({as:'reader',method:'POST',path:'/api/v2/commands/reachy-gesture',body:{target:'reachy-sim',data:{gesture:'notice'},requestId:'reachy-readonly'}},answer=>answer.status===403||'reader mutation admitted')),
  act('owner explicitly takes over',h=>dispatchOnce(h,'operator','reachy-takeover',command(h,'reachy-control',{action:'takeover'}),'reachy-takeover')),
  expect('takeover has a tracked completion',h=>recorded(h,'reachy-takeover','succeeded','observed')),
  act('owner selects a finite notice',h=>dispatchOnce(h,'operator','reachy-notice',command(h,'reachy-gesture',{gesture:'notice'}),'reachy-notice')),
  expect('notice has truthful transport evidence',h=>recorded(h,'reachy-notice','succeeded','transmitted')),
  expect('only catalog and neutral stages are sent',h=>moves(h)===2||'unexpected move count'),
  act('runtime restarts using latest private state',h=>h.restart()),
  expect('restarted state remains under takeover',h=>status(h)?.connection==='available'&&status(h)?.takeover===true||'takeover/freshness missing'),
  holds('restart does not replay a stage',h=>moves(h)===2||'motion replayed',200),
 ],
}];
