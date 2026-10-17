import type {LightingLayout} from '@jimmie-potts/event-contracts/v2/families';
import type {RoomAnchor} from '../../src/room-model.ts';
import type {LightingCard,LightingDevice} from './lighting.ts';

export type RoomBinding={reason:string}|{device:LightingDevice;card:LightingCard};
/** An anchor is only an alias. Current room membership and unique owner evidence select authority. */
export function roomBinding(anchor:RoomAnchor,roomId:string,layout:LightingLayout,devices:readonly LightingDevice[],layoutLive:boolean):RoomBinding {
  if(!layoutLive)return {reason:'Room assignments are stale.'};
  if(anchor.deviceId===null||anchor.owner===null)return {reason:'No device is bound to this fixture.'};
  if(!layout.rooms.some(room=>room.id===roomId)||!layout.assignments.some(a=>a.room===roomId&&a.device===anchor.deviceId))return {reason:'This device is not assigned to this room.'};
  const matches=devices.filter(d=>d.record.id===anchor.deviceId),device=matches[0];
  if(matches.length!==1||device===undefined||device.owner!==anchor.owner)return {reason:'The bound device is missing or has conflicting ownership.'};
  return {device,card:{selection:{kind:'device',id:anchor.deviceId},name:anchor.label,members:[anchor.deviceId]}};
}

export function roomObservation(binding:RoomBinding):{text:string;power:boolean|undefined} {
  if('reason' in binding)return {text:binding.reason,power:undefined};
  const d=binding.device;
  if(!d.live)return {text:'Device records are stale.',power:undefined};
  if(d.record.availability!=='available')return {text:'Device unavailable; current light state is unknown.',power:undefined};
  const o=d.record.observed;
  if(o.status!=='known')return {text:'Reported light state is unknown.',power:undefined};
  const power=o.power.status==='known'?o.power.value:undefined;
  const text=(power===undefined?'Power unknown':power?'On':'Off')+' · reported'+(o.brightness.status==='known'?' · '+String(o.brightness.value)+'%':'')+' · '+new Date(o.observedAtMs).toLocaleTimeString();
  return {text,power};
}
