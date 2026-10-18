/** Private prepared geometry contract. Pure data only; shared by the owner and browser. */
export type RoomAnchor = {id:string;label:string;position:number[];group:string;deviceId:string|null;owner:string|null};
export type RoomBatch = {group:string;material:number;count:number;vertices:string;indices:string};
export type RoomScene = {width:number;depth:number;height:number;materials:{color:number[];roughness:number}[];batches:RoomBatch[]};
export type RoomModel = {schema:'room-model/1.0';id:string;roomId:string;
  calibration:{wallLengthMeters:number;source:'measured'|'estimated';otherDimensions:'estimated'};anchors:RoomAnchor[];scene:RoomScene};
export type RoomModelCatalog = {schema:'room-model-catalog/1.0';models:{id:string;roomId:string}[]};
export const MAX_ROOM_MODEL_BYTES=2*1024*1024;
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OWNER=/^bunny\/modules\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BASE64=/^[A-Za-z0-9+/]*={0,2}$/;
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,names:string[]):boolean=>Object.keys(v).length===names.length&&Object.keys(v).every(k=>names.includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&v.length<=128&&ID.test(v);
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v:unknown,min:number,max:number):v is number=>finite(v,min,max)&&Number.isInteger(v);
const vector=(v:unknown,min:number,max:number):v is number[]=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));
const encoded=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length%4===0&&v.length<=MAX_ROOM_MODEL_BYTES&&BASE64.test(v);
export const roomModelId=(v:unknown):v is string=>id(v)&&v.length<=64&&v!=='catalog';

export function parseRoomCatalog(value:unknown):RoomModelCatalog|undefined {
  if(!object(value)||!keys(value,['schema','models'])||value.schema!=='room-model-catalog/1.0'||!Array.isArray(value.models)||value.models.length>32)return undefined;
  const ids=new Set<string>(),rooms=new Set<string>();
  for(const entry of value.models){
    if(!object(entry)||!keys(entry,['id','roomId'])||!roomModelId(entry.id)||!id(entry.roomId)||ids.has(entry.id)||rooms.has(entry.roomId))return undefined;
    ids.add(entry.id);rooms.add(entry.roomId);
  }
  return value as RoomModelCatalog;
}

/** Called only after encoded lengths and alphabet were bounded. */
export function roomBytes(value:string):Uint8Array {return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}

function validBatch(value:unknown,materials:number):value is RoomBatch {
  if(!object(value)||!keys(value,['group','material','count','vertices','indices'])||!id(value.group)||!integer(value.material,0,materials-1)
    ||!integer(value.count,3,300_000)||value.count%3!==0||!encoded(value.vertices)||!encoded(value.indices))return false;
  const vertices=roomBytes(value.vertices),indices=roomBytes(value.indices),count=vertices.byteLength/24;
  if(!Number.isInteger(count)||count<3||count>65_535||indices.byteLength!==value.count*2)return false;
  const positions=new DataView(vertices.buffer),faces=new DataView(indices.buffer);
  for(let i=0;i<vertices.byteLength;i+=4){if(!finite(positions.getFloat32(i,true),-100,100))return false;}
  for(let i=0;i<indices.byteLength;i+=2){if(faces.getUint16(i,true)>=count)return false;}
  return true;
}

export function parseRoomModel(value:unknown):RoomModel|undefined {
  if(!object(value)||!keys(value,['schema','id','roomId','calibration','anchors','scene'])||value.schema!=='room-model/1.0'||!roomModelId(value.id)||!id(value.roomId))return undefined;
  const c=value.calibration,s=value.scene;
  if(!object(c)||!keys(c,['wallLengthMeters','source','otherDimensions'])||!finite(c.wallLengthMeters,.1,100)
    ||(c.source!=='measured'&&c.source!=='estimated')||c.otherDimensions!=='estimated')return undefined;
  if(!object(s)||!keys(s,['width','depth','height','materials','batches'])||![s.width,s.depth,s.height].every(n=>finite(n,.1,100))
    ||!Array.isArray(s.materials)||s.materials.length<1||s.materials.length>64||!Array.isArray(s.batches)||s.batches.length<1||s.batches.length>128)return undefined;
  if(!s.materials.every(m=>object(m)&&keys(m,['color','roughness'])&&vector(m.color,0,1)&&finite(m.roughness,0,1)))return undefined;
  const materials:unknown[]=s.materials;
  if(!s.batches.every(b=>validBatch(b,materials.length))||s.batches.reduce((n,b:RoomBatch)=>n+b.count,0)>300_000)return undefined;
  if(!Array.isArray(value.anchors)||value.anchors.length>64)return undefined;
  const anchors=new Set<string>(),anchorGroups=new Set<string>(),bindings=new Set<string>(),groups=new Set(s.batches.map((b:RoomBatch)=>b.group));
  for(const a of value.anchors){
    if(!object(a)||!keys(a,['id','label','position','group','deviceId','owner'])||!id(a.id)||anchors.has(a.id)||typeof a.label!=='string'
      ||a.label.trim()===''||a.label.length>80||!vector(a.position,-100,100)||!id(a.group)||!groups.has(a.group)||anchorGroups.has(a.group))return undefined;
    if(a.deviceId!==null||a.owner!==null){
      if(!id(a.deviceId)||typeof a.owner!=='string'||!OWNER.test(a.owner)||a.owner.length>128||bindings.has(a.deviceId))return undefined;
      bindings.add(a.deviceId);
    }
    anchors.add(a.id);anchorGroups.add(a.group);
  }
  return value as RoomModel;
}
