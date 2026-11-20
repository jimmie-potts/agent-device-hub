import {FAMILY, SOURCE, type Occupancy, type PresenceObservation, type Tagged, type Target} from '@jimmie-potts/presence-pro/contracts';
import {apartmentContains, type ApartmentModel, type ApartmentVector} from '../../src/apartment-model.ts';
import type {RuntimeCopy} from './runtime-feeds.ts';

export type PresencePoint = {id:string;label:string;sensorId:string;slot:number;roomId:string;position:ApartmentVector;held:boolean|undefined};
export type ApartmentMapPoint = Pick<PresencePoint,'id'|'roomId'|'position'>;
type CombinedPresencePoint = ApartmentMapPoint & {expiresAtMs:number};
export type PresenceContributor = {sensorId:string;channel:string;value:Occupancy;reported:Occupancy;receivedAtMs:Tagged<number>};
export type RoomPresence = {value:Occupancy;disagreement:boolean;contributors:PresenceContributor[]};
export type PresenceSlot = {target:Target;point?:PresencePoint;reason:string};
export type PresenceSensor = {record:PresenceObservation;current:boolean;slots:PresenceSlot[]};
export type ApartmentPresence = {synced:boolean;sensors:PresenceSensor[];rooms:Map<string,RoomPresence>;points:PresencePoint[]};

const maximumSeparationMeters=.65;
const receiptWindowMs=2500;
const maximumReceiptSpreadMs=1200;

/** Geometry locates a floor marker only. It never creates an occupancy or identity observation. */
export function apartmentPresence(model:ApartmentModel,copies:readonly RuntimeCopy[],connected:boolean):ApartmentPresence {
  const copy=copies.find(item=>item.owner===SOURCE&&item.family===FAMILY),synced=connected&&copy?.synced===true;
  const records=(copy?.records as readonly PresenceObservation[]|undefined)??[];
  const rooms=new Map<string,RoomPresence>(model.rooms.map(room=>[room.id,{value:'unknown',disagreement:false,contributors:[]}]));
  const points:PresencePoint[]=[];
  const sensors=[...records].sort((a,b)=>a.sensorId.localeCompare(b.sensorId)).map((record,index):PresenceSensor=>{
    const current=synced&&record.connection==='connected';
    const contribute=(roomId:string,channel:string,reported:Occupancy,receivedAtMs:Tagged<number>):void=>{
      rooms.get(roomId)?.contributors.push({sensorId:record.sensorId,channel,value:current?reported:'unknown',reported,receivedAtMs});
    };
    contribute(record.roomId,'Occupancy',record.occupancy.value,record.occupancy.receivedAtMs);
    for(const zone of record.zones)contribute(zone.roomId,`Zone ${zone.id}`,zone.value,zone.receivedAtMs);
    const slots=record.targets.map((target):PresenceSlot=>{
      const unavailable=(reason:string):PresenceSlot=>({target,reason});
      if(!current)return unavailable(synced?'Source is not connected.':'Last-known reports only.');
      if(!rooms.has(record.roomId))return unavailable('Source room is not in this model.');
      const point=target.apartmentMeters;
      if(point.status!=='known'||target.calibrationRevision.status!=='known'||target.active.value.status!=='known'||!target.active.value.value
        ||!Number.isFinite(point.value.x)||!Number.isFinite(point.value.z))return unavailable('No usable calibrated point reported.');
      const containing=model.rooms.filter(room=>apartmentContains(room.footprint,[point.value.x,point.value.z]));
      if(containing.length>1)return unavailable('Room boundary is ambiguous.');
      const room=containing[0];
      if(room===undefined)return unavailable('Point is outside the prepared rooms.');
      const marker:PresencePoint={id:JSON.stringify([record.sensorId,target.slot]),label:`${index+1}·${target.slot}`,sensorId:record.sensorId,slot:target.slot,
        roomId:room.id,position:[point.value.x,room.floorY+.04,point.value.z],held:record.held.value.status==='known'?record.held.value.value:undefined};
      points.push(marker);return {target,point:marker,reason:''};
    });
    return {record,current,slots};
  });
  for(const room of rooms.values()){
    const values=room.contributors.map(item=>item.value);
    room.value=values.includes('occupied')?'occupied':values.length>0&&values.every(value=>value==='vacant')?'vacant':'unknown';
    room.disagreement=values.includes('occupied')&&values.includes('vacant');
  }
  return {synced,sensors,rooms,points};
}

/** Combine one compatible pair for display. A receipt bounds the estimate, not the sensor's measurement time. */
export function combinedApartmentPoint(model:ApartmentModel,presence:ApartmentPresence,nowMs:number):CombinedPresencePoint|undefined {
  const slots=presence.sensors.flatMap(sensor=>sensor.slots.filter(slot=>slot.point!==undefined));
  const [first,second]=slots;
  const a=first?.point,b=second?.point;
  if(slots.length!==2||a===undefined||b===undefined||a.sensorId===b.sensorId||a.roomId!==b.roomId
    ||a.held===true||b.held===true)return undefined;
  const [ax,y,az]=a.position,[bx,,bz]=b.position;
  if(Math.hypot(ax-bx,az-bz)>maximumSeparationMeters)return undefined;
  const receipts=slots.flatMap(({target:{rawMm}})=>[rawMm.xReceivedAtMs,rawMm.yReceivedAtMs])
    .flatMap(receipt=>receipt.status==='known'?[receipt.value]:[]);
  if(receipts.length!==4||!receipts.every(Number.isFinite))return undefined;
  const oldest=Math.min(...receipts),latest=Math.max(...receipts),expiresAtMs=oldest+receiptWindowMs;
  if(latest>nowMs||nowMs>=expiresAtMs||latest-oldest>maximumReceiptSpreadMs)return undefined;
  const x=(ax+bx)/2,z=(az+bz)/2;
  const rooms=model.rooms.filter(room=>apartmentContains(room.footprint,[x,z]));
  if(rooms.length!==1||rooms[0]?.id!==a.roomId)return undefined;
  return {id:'combined-presence',roomId:a.roomId,position:[x,y,z],expiresAtMs};
}

export function presenceReceipt(value:Tagged<number>):string {
  return value.status==='known'&&Number.isFinite(value.value)&&Math.abs(value.value)<=8.64e15?new Date(value.value).toISOString():'unknown';
}
