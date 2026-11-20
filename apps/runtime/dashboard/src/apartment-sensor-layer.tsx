import React,{useMemo,useState} from 'react';
import {apartmentContains,type ApartmentModel,type ApartmentPoint} from '../../src/apartment-model.ts';
import type {ApartmentPresence,PresencePoint} from './apartment-presence.ts';
import type {ApartmentRenderer,ApartmentZoneOverlay,ProjectedZone} from './apartment-renderer.ts';
import {floorZone,readFloorZones,saveFloorZone,ZONE_IDS,ZONE_NAMES,zoneTracking,type FloorZone,type ZoneId,type ZoneTracking} from './apartment-zones.ts';

type Filter=0|1|null;
type Draft={id:ZoneId;roomId:string;first?:ApartmentPoint;zone?:FloorZone};
type ZoneRow={id:ZoneId;zone?:FloorZone;tracking?:ZoneTracking};
const filterOptions=[{label:'Pro 1',value:0},{label:'Pro 2',value:1},{label:'Both',value:null}] as const;
const zoneLabels:Record<ZoneTracking,string>={tracked:'Tracked point',none:'No tracked point',unavailable:'Position unavailable'};

export function useApartmentSensorLayer(model:ApartmentModel,presence:ApartmentPresence,room:string|null,focusFloor:(id:string)=>void){
  const [enabled,setEnabled]=useState(false),[filter,setFilter]=useState<Filter>(null);
  const [zones,setZones]=useState(()=>readFloorZones(model)),[draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState('');
  const sources=useMemo(()=>filter===null?presence.sensors:presence.sensors.slice(filter,filter+1),[filter,presence.sensors]);
  const points:readonly PresencePoint[]=useMemo(()=>enabled?presence.points.filter(point=>sources.some(source=>source.record.sensorId===point.sensorId)):[],
    [enabled,presence.points,sources]);
  const rows=useMemo(()=>ZONE_IDS.map((id):ZoneRow=>{
    const zone=zones[id];
    return zone===undefined?{id}:{id,zone,tracking:zoneTracking(zone,points,sources)};
  }),[zones,points,sources]);
  const overlays:ApartmentZoneOverlay[]=useMemo(()=>enabled?ZONE_IDS.flatMap(id=>{
    const zone=zones[id];
    const shape=draft?.id===id?draft.zone??zone:zone;
    const floor=model.rooms.find(item=>item.id===shape?.roomId);
    return shape===undefined||floor===undefined?[]:[{id,zone:shape,floorY:floor.floorY}];
  }):[],[enabled,zones,draft,model]);

  function openEdit(id:ZoneId):void{
    const mapped=new Set(presence.sensors.map(source=>source.record.roomId));
    const selected=zones[id]?.roomId??room??(mapped.size===1?[...mapped][0]:undefined)??(model.rooms.length===1?model.rooms[0]?.id:undefined);
    if(selected===undefined||!model.rooms.some(item=>item.id===selected)){
      setError('Frame a room to draw a zone.');
      return;
    }
    focusFloor(selected);
    setDraft({id,roomId:selected});
    setError('');
  }

  function pick(renderer:ApartmentRenderer|undefined,event:React.MouseEvent<HTMLButtonElement>):void{
    if(draft===null)return;
    const floor=model.rooms.find(item=>item.id===draft.roomId);
    if(floor===undefined)return;
    const value=renderer?.floorPoint(event.clientX,event.clientY,floor.floorY);
    if(value===undefined||!apartmentContains(floor.footprint,value)){setError('Pick a corner inside the room.');return;}
    if(draft.first===undefined||draft.zone!==undefined){
      setDraft({id:draft.id,roomId:draft.roomId,first:value});setError('');return;
    }
    const zone=floorZone(floor,draft.first,value);
    if(zone===undefined){setError('Keep the whole zone inside the room.');return;}
    setDraft({...draft,zone});setError('');
  }

  function cancel():void{setDraft(null);setError('');}
  function save():void{
    if(draft?.zone===undefined)return;
    try{setZones(saveFloorZone(model,draft.id,draft.zone));cancel();}
    catch{setError('Could not save the zone. Try again.');}
  }
  function clear():void{
    if(draft===null)return;
    try{setZones(saveFloorZone(model,draft.id,undefined));cancel();}
    catch{setError('Could not clear the zone. Try again.');}
  }
  return {enabled,filter,points,rows,overlays,draft,error,
    toggle:()=>{setEnabled(value=>!value);cancel();},setFilter,openEdit,pick,cancel,save,clear};
}

type Layer=ReturnType<typeof useApartmentSensorLayer>;

export function ApartmentSensorTools({layer,failed,sensorCount}:{layer:Layer;failed:boolean;sensorCount:number}):React.JSX.Element{
  const {draft}=layer;
  return <section className="apartment-sensor-tools" aria-label="Sensor layer">
    <div className="apartment-segment" role="group" aria-label="Sensor filter">
      {filterOptions.map(({label,value})=><button key={label} type="button" aria-pressed={layer.filter===value}
        disabled={value!==null&&value>=sensorCount} onClick={()=>{layer.setFilter(value);}}>{label}</button>)}
    </div>
    <ul className="apartment-zone-list">
      {layer.rows.map(({id,zone,tracking})=><li key={id} data-zone-status={id} data-tracking={tracking}>
        <span>{ZONE_NAMES[id]}</span>
        {tracking!==undefined&&<small>{zoneLabels[tracking]}</small>}
        <button type="button" disabled={failed||draft!==null} onClick={()=>{layer.openEdit(id);}}
          aria-label={(zone===undefined?'Draw ':'Edit ')+ZONE_NAMES[id]}>{zone===undefined?'Draw':'Edit'}</button>
      </li>)}
    </ul>
    {draft!==null&&<div className="apartment-zone-editor">
      <span>{draft.zone!==undefined?'Review the zone':draft.first===undefined?'Pick the first floor corner':'Pick the opposite corner'}</span>
      <button type="button" disabled={draft.zone===undefined} onClick={layer.save}>Save zone</button>
      <button type="button" onClick={layer.cancel}>Cancel</button>
      {layer.rows.some(({id,zone})=>id===draft.id&&zone!==undefined)&&<button type="button" onClick={layer.clear}>Clear zone</button>}
    </div>}
    {layer.error!==''&&<p role="status" className="apartment-zone-error">{layer.error}</p>}
  </section>;
}

export function applyZoneProjection(region:HTMLDivElement|null,zones:ProjectedZone[]):void{
  if(region===null)return;
  const byId=new Map(zones.map(zone=>[zone.id,zone]));
  for(const shape of region.querySelectorAll<HTMLElement>('[data-floor-zone]')){
    const zone=byId.get(shape.dataset.floorZone??'');
    shape.hidden=zone===undefined;
    if(zone!==undefined)shape.style.clipPath='polygon('+zone.corners.map(({x,y})=>x+'px '+y+'px').join(',')+')';
  }
  for(const label of region.querySelectorAll<HTMLElement>('[data-floor-zone-label]')){
    const center=byId.get(label.dataset.floorZoneLabel??'')?.center;
    label.hidden=center?.visible!==true;
    if(center?.visible===true){label.style.left=center.x+'px';label.style.top=center.y+'px';}
  }
}

export function ApartmentZoneOverlays({layer,region}:{layer:Layer;region:React.Ref<HTMLDivElement>}):React.JSX.Element{
  return <div className="apartment-floor-zones" ref={region} aria-hidden="true">
    {layer.overlays.map(({id})=><div key={id} className="apartment-floor-zone-item">
      <div data-floor-zone={id} data-tracking={layer.rows.find(row=>row.id===id)?.tracking} hidden/>
      <span data-floor-zone-label={id} hidden>{ZONE_NAMES[id]}</span>
    </div>)}
  </div>;
}
