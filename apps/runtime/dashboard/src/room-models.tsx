import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {LightingLayout} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError} from '@jimmie-potts/sdk/remote';
import {parseRoomCatalog,parseRoomModel,type RoomAnchor,type RoomModel,type RoomModelCatalog} from '../../src/room-model.ts';
import type {DashboardConnection} from './connection.ts';
import type {LightingDevice} from './lighting.ts';
import {roomBinding,roomObservation} from './room-bindings.ts';
import {createRoomRenderer,type RoomRenderer} from './room-renderer.ts';
import './room-models.css';

function RoomCanvas({model,selected,powers,onSelect}:{model:RoomModel;selected:RoomAnchor|undefined;powers:ReadonlyMap<string,boolean|undefined>;onSelect:(id:string)=>void}):React.JSX.Element {
  const markers=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<RoomRenderer|undefined>(undefined);
  const [failed,setFailed]=useState(false),[cutaway,setCutaway]=useState(true);
  useEffect(()=>{setFailed(false);const node=canvas.current;if(node===null)return;
    try{renderer.current=createRoomRenderer(node,model,()=>{setFailed(true);},points=>{
      const parent=markers.current;if(parent===null)return;const occupied:{x:number;y:number;w:number;h:number}[]=[];
      const clamp=(v:number,a:number,b:number):number=>Math.max(a,Math.min(b,v));
      for(const p of points){const button=parent.querySelector<HTMLButtonElement>('[data-marker="'+p.id+'"]'),line=parent.querySelector<SVGLineElement>('[data-link="'+p.id+'"]'),dot=parent.querySelector<SVGCircleElement>('[data-dot="'+p.id+'"]');if(button===null||line===null||dot===null)continue;
        button.hidden=!p.visible;line.style.display=p.visible?'':'none';dot.style.display=p.visible?'':'none';if(!p.visible)continue;
        const w=button.offsetWidth,h=button.offsetHeight,candidates=[[-w/2,-h-18],[20,-h/2],[-w-20,-h/2],[-w/2,20]];
        let chosen={x:clamp(p.x-w/2,4,node.clientWidth-w-4),y:clamp(p.y-h-18,4,node.clientHeight-h-4),w,h};
        for(const [dx=0,dy=0]of candidates){const rect={x:clamp(p.x+dx,4,node.clientWidth-w-4),y:clamp(p.y+dy,4,node.clientHeight-h-4),w,h};if(!occupied.some(a=>rect.x<a.x+a.w+8&&rect.x+w+8>a.x&&rect.y<a.y+a.h+8&&rect.y+h+8>a.y)){chosen=rect;break;}}
        occupied.push(chosen);button.style.left=String(chosen.x)+'px';button.style.top=String(chosen.y)+'px';line.setAttribute('x1',String(p.x));line.setAttribute('y1',String(p.y));line.setAttribute('x2',String(clamp(p.x,chosen.x,chosen.x+w)));line.setAttribute('y2',String(clamp(p.y,chosen.y,chosen.y+h)));dot.setAttribute('cx',String(p.x));dot.setAttribute('cy',String(p.y));
      }
    });}catch{setFailed(true);}
    return ()=>{renderer.current?.dispose();renderer.current=undefined;};
  },[model]);
  useEffect(()=>{renderer.current?.selection(selected?.group,powers);},[selected,powers,model]);
  useEffect(()=>{renderer.current?.cutaway(cutaway);},[cutaway,model]);
  return <div className="room-inspection">
    <div className="room-stage"><canvas ref={canvas} hidden={failed} role="img" aria-label="Interactive room reconstruction; fixture buttons below provide light status and controls"/>
      <div className="room-markers" ref={markers} hidden={failed}>
        <svg aria-hidden="true">{model.anchors.map(a=><g key={a.id}><line data-link={a.id}/><circle data-dot={a.id} r="4"/></g>)}</svg>
        {model.anchors.map(a=><button key={a.id} type="button" data-marker={a.id} aria-label={'Select '+a.label+' in 3D model'} aria-pressed={selected?.id===a.id} onClick={()=>{onSelect(a.id);}}>{a.label}</button>)}
      </div></div>
    {failed&&<p role="status">3D rendering is unavailable. The fixture list and lighting controls remain available.</p>}
    <div className="actions" role="group" aria-label="Room camera">
      <button type="button" disabled={failed} onClick={()=>{renderer.current?.camera('dollhouse');}}>Dollhouse</button>
      <button type="button" disabled={failed} onClick={()=>{renderer.current?.camera('overhead');}}>Overhead</button>
      <button type="button" disabled={failed} onClick={()=>{renderer.current?.zoom(.8);}}>Zoom in</button>
      <button type="button" disabled={failed} onClick={()=>{renderer.current?.zoom(1.25);}}>Zoom out</button>
      <label><input type="checkbox" checked={cutaway} disabled={failed} onChange={event=>{setCutaway(event.target.checked);}}/> Cutaway</label>
    </div>
  </div>;
}

type Props={connection:DashboardConnection;connected:boolean;layout:LightingLayout;layoutLive:boolean;devices:readonly LightingDevice[];
  renderLight:(anchor:RoomAnchor,model:RoomModel)=>React.ReactNode};
/** Private model content is read on entry/selection/explicit refresh, never polled. Live evidence uses existing copies. */
export function RoomModels({connection,connected,layout,layoutLive,devices,renderLight}:Props):React.JSX.Element {
  const scope=useMemo(()=>connection.openModule('core'),[connection]);
  useEffect(()=>()=>{void scope.close();},[scope]);
  const [catalog,setCatalog]=useState<RoomModelCatalog|undefined>(),[model,setModel]=useState<RoomModel|undefined>(),[selected,setSelected]=useState<string|undefined>();
  const [message,setMessage]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false);
  const pending=useRef(0);
  useEffect(()=>{let active=true;if(!connected)return;setMessage('');
    void scope.api.read('/modules/core/content/room-model-catalog').then(value=>{if(!active)return;const parsed=parseRoomCatalog(value);setCatalog(parsed);if(parsed===undefined)setMessage('The 3D model catalog is invalid.');})
      .catch((error:unknown)=>{if(!active)return;setCatalog(undefined);if(!(error instanceof SdkError&&error.body.error.code==='not-found'))setMessage('3D models are unavailable.');});
    return ()=>{active=false;};
  },[scope,connected,refresh]);
  useEffect(()=>()=>{pending.current++;},[scope]);
  const open=async(id:string,roomId:string):Promise<void>=>{
    const request=++pending.current;setLoading(true);setModel(undefined);setSelected(undefined);setMessage('');
    try{const value=await scope.api.read('/modules/core/content/room-model-'+id);if(request!==pending.current)return;
      const parsed=parseRoomModel(value);if(parsed===undefined||parsed.id!==id||parsed.roomId!==roomId){setMessage('The prepared room model is invalid.');return;}setModel(parsed);
    }catch{if(request===pending.current)setMessage('The prepared room model is unavailable.');}
    finally{if(request===pending.current)setLoading(false);}
  };
  const room=model===undefined?undefined:layout.rooms.find(room=>room.id===model.roomId);
  const selectedAnchor=model?.anchors.find(a=>a.id===selected);
  const observations=model?.anchors.map(anchor=>({anchor,observation:roomObservation(roomBinding(anchor,model.roomId,layout,devices,layoutLive))}))??[];
  const powers=new Map(observations.map(({anchor,observation})=>[anchor.group,observation.power]));
  return <div className="room-models">
    <div className="actions"><button type="button" disabled={!connected} onClick={()=>{pending.current++;setLoading(false);setModel(undefined);setRefresh(n=>n+1);}}>Refresh 3D models</button>
      {catalog?.models.map(entry=>{const room=layout.rooms.find(room=>room.id===entry.roomId);return room===undefined?null:<button type="button" key={entry.id} disabled={!connected} aria-label={'Open 3D model for '+room.name} onClick={()=>{void open(entry.id,entry.roomId);}}>{room.name} · 3D</button>;})}
    </div>
    {message!==''&&<p role="status">{message}</p>}{loading&&<p role="status">Loading room model…</p>}
    {model!==undefined&&room!==undefined&&<section className="room-model" aria-label={room.name+' 3D model'}>
      <h3>{room.name} · 3D</h3>
      <p className="hint">Reconstruction · {model.calibration.source} wall {model.calibration.wallLengthMeters.toFixed(3)} m · other dimensions estimated</p>
      <RoomCanvas model={model} selected={selectedAnchor} powers={powers} onSelect={setSelected}/>
      <p className="hint">Fixture appearance shows reported power schematically. Materials do not reproduce live scene colors or illumination.</p>
      <div className="room-fixtures" role="group" aria-label="Mapped fixtures">{observations.map(({anchor,observation})=><div key={anchor.id}>
        <button type="button" aria-label={'Select '+anchor.label} aria-pressed={selected===anchor.id} onClick={()=>{setSelected(anchor.id);}}>{anchor.label}</button>
        <p data-fixture-status={anchor.id}>{observation.text}</p>
      </div>)}</div>
      {selectedAnchor!==undefined&&<div className="room-selected" aria-live="polite">{renderLight(selectedAnchor,model)}</div>}
    </section>}
  </div>;
}
