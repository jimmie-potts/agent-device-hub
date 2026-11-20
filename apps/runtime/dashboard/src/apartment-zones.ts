import {apartmentContainsShape,type ApartmentModel,type ApartmentPoint,type ApartmentRoom} from '../../src/apartment-model.ts';
import type {PresencePoint,PresenceSensor} from './apartment-presence.ts';

export const ZONE_NAMES={couch:'Couch',kitchen:'Kitchen work area'} as const;
export type ZoneId=keyof typeof ZONE_NAMES;
export const ZONE_IDS:readonly ZoneId[]=['couch','kitchen'];
export type FloorZone={roomId:string;start:ApartmentPoint;end:ApartmentPoint};
export type FloorZones=Partial<Record<ZoneId,FloorZone>>;
export type ZoneTracking='tracked'|'none'|'unavailable';

export function zoneCorners({start:[x1,z1],end:[x2,z2]}:FloorZone):[ApartmentPoint,ApartmentPoint,ApartmentPoint,ApartmentPoint]{
  return [[x1,z1],[x2,z1],[x2,z2],[x1,z2]];
}

export function floorZone(room:ApartmentRoom,a:ApartmentPoint,b:ApartmentPoint):FloorZone|undefined{
  const start:ApartmentPoint=[Math.min(a[0],b[0]),Math.min(a[1],b[1])],end:ApartmentPoint=[Math.max(a[0],b[0]),Math.max(a[1],b[1])];
  if(![...start,...end].every(Number.isFinite)||start[0]===end[0]||start[1]===end[1])return undefined;
  const zone={roomId:room.id,start,end};
  return apartmentContainsShape(room.footprint,zoneCorners(zone))?zone:undefined;
}

export function zoneTracking(zone:FloorZone,points:readonly PresencePoint[],sensors:readonly PresenceSensor[]):ZoneTracking{
  const {roomId,start:[x1,z1],end:[x2,z2]}=zone;
  if(points.some(({roomId:id,position:[x,,z]})=>id===roomId&&x>=x1&&x<=x2&&z>=z1&&z<=z2))return 'tracked';
  if(sensors.length===0||sensors.some(source=>!source.current||
    (source.record.roomId===roomId&&source.record.occupancy.value!=='vacant'&&!points.some(point=>point.sensorId===source.record.sensorId))))return 'unavailable';
  return 'none';
}

function object(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

function point(value:unknown):ApartmentPoint|undefined{
  if(!Array.isArray(value)||value.length!==2)return undefined;
  const a:unknown=value[0],b:unknown=value[1];
  return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)?[a,b]:undefined;
}

function storageKey(model:ApartmentModel):string{
  return 'bunny.rooms.floor-zones.v1:'+model.calibration.planId;
}

function readStoredZones(model:ApartmentModel):FloorZones{
  const text=window.localStorage.getItem(storageKey(model));
  if(text===null||text.length>4096)return {};
  const value:unknown=JSON.parse(text);
  if(!object(value))return {};
  const zones:FloorZones={};
  for(const id of ZONE_IDS){
    const zone=value[id];
    if(!object(zone))continue;
    const room=model.rooms.find(item=>item.id===zone.roomId),start=point(zone.start),end=point(zone.end);
    if(room===undefined||start===undefined||end===undefined)continue;
    const valid=floorZone(room,start,end);
    if(valid!==undefined)zones[id]=valid;
  }
  return zones;
}

export function readFloorZones(model:ApartmentModel):FloorZones{
  try{return readStoredZones(model);}catch{return {};}
}

export function saveFloorZone(model:ApartmentModel,id:ZoneId,zone:FloorZone|undefined):FloorZones{
  const next={...readFloorZones(model)};
  if(zone===undefined)delete next[id];
  else next[id]=zone;
  window.localStorage.setItem(storageKey(model),JSON.stringify(next));
  return next;
}
