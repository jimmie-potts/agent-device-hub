import {WEMO_SIMULATED_SECTION} from '@jimmie-potts/wemo';
import type {PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {act,answers,bodyOf,deviceState,dispatchOnce,expect,holds,recorded,running,type Harness,type Scenario} from '../framework.js';
const owner='bunny/modules/wemo';
const state=(h:Harness)=>deviceState<Record<string,{power:boolean;writes:number}>>(h,'wemo');
const device=(h:Harness)=>h.reader.states<DeviceRecord>('device',owner).find(value=>value.subject==='desk-lamp')?.data;
export const scenarios:readonly Scenario[]=[{
 id:'wemo-power-limit',title:'two local plug writers use independent Hub maximum-on limits without replay',
 seed:{modules:['core','wemo'],sections:{wemo:WEMO_SIMULATED_SECTION},follows:[{owner,families:['device']},{owner:'bunny/core',families:['power-limit','operation']}]},
 steps:[
  expect('core and Wemo are running with observed off',async h=>await running(h,['core','wemo'])===true&&device(h)?.availability==='available'&&device(h)?.observed.status==='known'||'fresh plug evidence missing'),
  holds('initial inspection writes no power',h=>Object.values(state(h)).every(value=>value.writes===0)||'inspection wrote power',100),
  expect('reader cannot configure a limit',answers({as:'reader',method:'PUT',path:'/api/v2/automation/power-limits/desk-lamp',headers:{'bunny-request':'1'},body:{enabled:true,durationMs:1000}},answer=>answer.status===403||'reader mutation admitted')),
  expect('owner explicitly saves an enabled short synthetic limit',answers({as:'operator',method:'PUT',path:'/api/v2/automation/power-limits/desk-lamp',headers:{'bunny-request':'1'},body:{enabled:true,durationMs:1000,expectedSettingsRevision:0}},answer=>answer.status===200&&bodyOf<PowerLimitRecord>(answer)?.enabled===true||'limit save refused')),
  act('operator turns on only the first plug',h=>dispatchOnce(h,'operator','power-on',{key:'bunny.cmd.power-set.desk-lamp',draft:{type:'org.bunny.power.set.requested',subject:'desk-lamp',dataschema:'https://bunny.invalid/events/power-set/2.0',data:{on:true}}},'wemo-on')),
  expect('power transmission has a tracked outcome',h=>recorded(h,'wemo-on','succeeded','transmitted')),
  act('a read interval and maximum-on evaluation pass',h=>h.wait(6200)),
  expect('the first plug is off after exactly one limit write; the second is untouched',h=>state(h)['desk-lamp']?.power===false&&state(h)['desk-lamp']?.writes===2&&(state(h)['shelf-lamp']?.writes??0)===0||'independent maximum-on effect missing'),
  act('runtime restarts on the latest store',h=>h.restart()),
  expect('the configured limit is retained through SDK sync',h=>h.reader.states<PowerLimitRecord>('power-limit','bunny/core').some(value=>value.data.id==='desk-lamp'&&value.data.enabled)||'limit state missing'),
  holds('restart replays no power effect',h=>state(h)['desk-lamp']?.writes===2||'a power effect replayed',300),
 ],
}];
