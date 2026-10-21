import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {deviceBlocked} from './devices.ts';

/** A selected button is evidence from the plug, never a local optimistic value. */
export function wemoCardState(record:DeviceRecord,live:boolean,control:boolean,operationsLive:boolean,locked:boolean,now:number):{
  power:boolean|undefined;status:string;disabled:boolean;reason:string|undefined;
}{
  const observation=record.observed.status==='known'?record.observed:undefined;
  const stale=!live||(observation!==undefined&&now-observation.observedAtMs>15000);
  const available=record.availability==='available';
  const power=available&&observation?.power.status==='known'?observation.power.value:undefined;
  const status=stale?'Stale':!available?'Unavailable':record.held!==undefined?'Held':power===undefined?'Power unknown':!control?'Read-only':'';
  const reason=deviceBlocked(record,live,control)??(!operationsLive?'Operation records are stale':!available?'Plug unavailable':stale?'Observation is stale':record.held!==undefined?'Release the hold before another power change':!record.capabilities.power.supported?'Power is unsupported':record.pending>0?'A change is pending':locked?'A command is unresolved':undefined);
  return {power,status,disabled:reason!==undefined,reason};
}
