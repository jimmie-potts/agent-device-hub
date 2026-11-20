import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {LightingLayout} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError} from '@jimmie-potts/sdk/remote';
import {apartmentArtPath,apartmentModelPath,apartmentPngSize,parseApartmentModel,type ApartmentFixture,type ApartmentModel} from '../../src/apartment-model.ts';
import {createApartmentRenderer,type ApartmentRenderer,type CameraView} from './apartment-renderer.ts';
import {composeApartment} from './apartment-scene.ts';
import type {DashboardConnection} from './connection.ts';
import type {LightingDevice} from './lighting.ts';
import {roomBinding,roomObservation} from './room-bindings.ts';
import type {RuntimeCopy} from './runtime-feeds.ts';
import {apartmentPresence,combinedApartmentPoint} from './apartment-presence.ts';
import {ApartmentPresenceView} from './apartment-presence-view.tsx';
import {ApartmentSensorTools,ApartmentZoneOverlays,applyZoneProjection,useApartmentSensorLayer} from './apartment-sensor-layer.tsx';
import './apartment-view.css';

type Content = {kind:'missing'|'loading'|'unavailable'|'invalid'}|{kind:'ready';model:ApartmentModel};
type ArtStatus = 'ready' | 'missing';
type FixtureView = {fixture:ApartmentFixture;roomName:string;observation:ReturnType<typeof roomObservation>;number:number};
type Props = {connection:DashboardConnection;connected:boolean;layout:LightingLayout;layoutLive:boolean;devices:readonly LightingDevice[];copies:readonly RuntimeCopy[];
  renderLight:(item:ApartmentFixture,roomId:string,currentObservationsOnly:true)=>React.ReactNode;refresh:number};

/** A private content read on entry and explicit refresh. Live device evidence comes from Rooms. */
export function ApartmentView({connection,connected,layout,layoutLive,devices,copies,renderLight,refresh}:Props):React.JSX.Element|null {
  const [content,setContent]=useState<Content>({kind:'missing'});
  const [attempt,setAttempt]=useState(0);
  const revision=`${refresh}/${attempt}`;
  const request=useRef<{connection:DashboardConnection;revision:string}|undefined>(undefined);
  useEffect(()=>{
    if(!connected||request.current?.connection===connection&&request.current.revision===revision)return;
    const scope=connection.openModule('core');let active=true;
    setContent({kind:'loading'});
    void scope.api.read(apartmentModelPath).then((value)=>{
      if(!active)return;
      const model=parseApartmentModel(value);
      request.current={connection,revision};
      setContent(model===undefined?{kind:'invalid'}:{kind:'ready',model});
    }).catch((error:unknown)=>{
      if(!active)return;
      request.current={connection,revision};
      setContent({kind:error instanceof SdkError&&error.body.error.code==='not-found'?'missing':'unavailable'});
    }).finally(()=>{void scope.close();});
    return ()=>{active=false;void scope.close();};
  },[connection,connected,revision]);
  if(content.kind==='missing')return null;
  if(content.kind==='ready')return <ApartmentInspection key={revision} {...{connection,connected,layout,layoutLive,devices,copies,renderLight}} model={content.model}/>;
  if(content.kind==='loading')return <p role="status" className="apartment-note">Loading the apartment model…</p>;
  return <div className="apartment-note" role="status"><span>{content.kind==='invalid'?'The prepared apartment model is invalid.':'The apartment model is unavailable.'} Room controls remain available.</span>
    <button type="button" disabled={!connected} onClick={()=>{setAttempt(n=>n+1);}}>Retry apartment model</button></div>;
}

function ApartmentInspection({connection,connected,model,layout,layoutLive,devices,copies,renderLight}:
  Pick<Props,'connection'|'connected'|'layout'|'layoutLive'|'devices'|'copies'|'renderLight'>&{model:ApartmentModel}):React.JSX.Element {
  const [room,setRoom]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[view,setView]=useState<CameraView>('dollhouse');
  const [cutaway,setCutaway]=useState(true),[failed,setFailed]=useState(false),[artStatus,setArtStatus]=useState<ReadonlyMap<string,ArtStatus>>(new Map());
  const canvas=useRef<HTMLCanvasElement>(null),marks=useRef<HTMLDivElement>(null),presenceMarks=useRef<HTMLDivElement>(null),renderer=useRef<ApartmentRenderer|undefined>(undefined);
  const zoneMarks=useRef<HTMLDivElement>(null);
  const presence=useMemo(()=>apartmentPresence(model,copies,connected),[model,copies,connected]);
  const [expiredAtMs,expirePresence]=useState(0);
  const sensorLayer=useApartmentSensorLayer(model,presence,room,id=>{
    setRoom(id);setSelected(null);setView('overhead');
  });
  const combined=useMemo(()=>sensorLayer.enabled?undefined:combinedApartmentPoint(model,presence,Math.max(Date.now(),expiredAtMs)),
    [model,presence,sensorLayer.enabled,expiredAtMs]);
  const combinedExpiry=combined?.expiresAtMs;
  useEffect(()=>{
    if(combinedExpiry===undefined)return;
    const deadline=combinedExpiry;
    let timer:number;
    function expire():void{
      const remaining=deadline-Date.now();
      if(remaining>0){timer=window.setTimeout(expire,remaining);return;}
      expirePresence(deadline);
    }
    timer=window.setTimeout(expire,Math.max(0,deadline-Date.now()));
    return ()=>{window.clearTimeout(timer);};
  },[combinedExpiry]);
  const roomNames=new Map(layout.rooms.map(r=>[r.id,r.name]));
  const roomName=(id:string):string=>roomNames.get(id)??(model.rooms.some(r=>r.id===id)?'Unlisted room '+String(model.rooms.findIndex(r=>r.id===id)+1):'Unlisted room');
  const fixtures:FixtureView[]=model.objects.filter(item=>item.kind==='fixture').map((fixture,i)=>({fixture,number:i+1,roomName:roomName(fixture.roomId),
    observation:roomObservation(roomBinding(fixture,fixture.roomId,layout,devices,layoutLive))}));
  const powers=useMemo(()=>new Map(model.objects.filter(item=>item.kind==='fixture').map(item=>[item.id,
    roomObservation(roomBinding(item,item.roomId,layout,devices,layoutLive)).power])),[model,layout,devices,layoutLive]);
  const visibleFixtures=fixtures.filter(({fixture})=>room===null||fixture.roomId===room);
  const chosen=visibleFixtures.find(({fixture})=>fixture.id===selected)?.fixture;
  const art=model.objects.filter(item=>item.kind==='artwork').filter(item=>room===null||item.roomId===room);
  const missingArt=art.filter(item=>item.asset===null||failed||artStatus.get(item.asset)==='missing');
  const loadingArt=art.some(item=>item.asset!==null&&!failed&&!artStatus.has(item.asset));
  const focusRoom=model.rooms.find(item=>item.id===room);
  useEffect(()=>{
    const target=canvas.current;if(target===null)return;
    let current:ApartmentRenderer;
    try{
      current=createApartmentRenderer({canvas:target,scene:composeApartment(model),unavailable:()=>{setFailed(true);},projectPresence:points=>{
        const byId=new Map(points.map(point=>[point.id,point]));
        for(const marker of presenceMarks.current?.querySelectorAll<HTMLElement>('[data-presence-marker]')??[]){
          const point=byId.get(marker.dataset.presenceMarker??'');marker.hidden=point?.visible!==true;
          if(point?.visible===true){marker.style.left=String(point.x)+'px';marker.style.top=String(point.y)+'px';}
        }
      },projectZones:zones=>{applyZoneProjection(zoneMarks.current,zones);},project:points=>{
        const region=marks.current;if(region===null)return;
        const byId=new Map(points.map(point=>[point.id,point]));
        for(const button of region.querySelectorAll<HTMLButtonElement>('[data-apartment-marker]')){
          const point=byId.get(button.dataset.apartmentMarker??'');
          button.hidden=point?.visible!==true;
          if(point?.visible!==true)continue;
          button.style.left=String(point.x)+'px';button.style.top=String(point.y)+'px';
        }
      }});
      renderer.current=current;
    }catch{setFailed(true);return;}
    return ()=>{current.dispose();renderer.current=undefined;};
  },[model]);
  useEffect(()=>{renderer.current?.frame(room,view,cutaway);},[model,room,view,cutaway]);
  useEffect(()=>{renderer.current?.lights(selected,powers);},[model,selected,powers]);
  useEffect(()=>{renderer.current?.presence(sensorLayer.enabled?presence.rooms:new Map(),combined===undefined?sensorLayer.points:[combined]);},
    [model,presence.rooms,sensorLayer.enabled,sensorLayer.points,combined]);
  useEffect(()=>{renderer.current?.zones(sensorLayer.overlays);},[model,sensorLayer.overlays]);
  useEffect(()=>{
    const current=renderer.current;if(failed||current===undefined||model.artwork.length===0)return;
    const scope=connection.openModule('core');let active=true;
    // Decode one image at a time; metadata and PNG headers bound work before decoding.
    const load=async():Promise<void>=>{
      for(const asset of model.artwork){
        if(!active)return;
        let status:ArtStatus='missing';
        try{
          const blob=await scope.api.image(apartmentArtPath(asset.id));
          if(!active)return;
          if(blob.type==='image/png'&&blob.size===asset.bytes){
            const header=apartmentPngSize(new Uint8Array(await blob.arrayBuffer()));
            if(active&&header?.width===asset.width&&header.height===asset.height){
              const decoded=await createImageBitmap(blob,{imageOrientation:'flipY'});
              try{
                if(active&&decoded.width===asset.width&&decoded.height===asset.height){current.artwork(asset.id,decoded);status='ready';}
              }finally{decoded.close();}
            }
          }
        }catch{ /* The frame stays visible if this image cannot be loaded. */ }
        if(active)setArtStatus(previous=>new Map(previous).set(asset.id,status));
      }
    };
    void load().finally(()=>{void scope.close();});
    return ()=>{active=false;void scope.close();};
  },[connection,model,failed]);
  return <section className="apartment-panel" aria-label="Apartment 3D model">
    <header className="apartment-heading">
      <div><p className="apartment-kicker">Room models</p><h3>Apartment</h3></div>
      <div className="apartment-framing">
        <label>Frame<select aria-label="Frame the apartment or a room" disabled={sensorLayer.draft!==null} value={room??''} onChange={event=>{
          setRoom(event.target.value===''?null:event.target.value);setSelected(null);
        }}><option value="">Whole apartment</option>{model.rooms.map(item=><option key={item.id} value={item.id}>{roomName(item.id)}</option>)}</select></label>
      </div>
    </header>
    <div className="apartment-stage">
      <div className="apartment-view-controls">
        <div className="apartment-segment" role="group" aria-label="Apartment camera">
          <button type="button" aria-pressed={view==='dollhouse'} disabled={failed||sensorLayer.draft!==null} onClick={()=>{setView('dollhouse');}}>Dollhouse</button>
          <button type="button" aria-pressed={view==='overhead'} disabled={failed} onClick={()=>{setView('overhead');}}>Overhead</button>
        </div>
        <div className="apartment-segment" role="group" aria-label="Apartment zoom">
          <button type="button" aria-label="Zoom out" disabled={failed} onClick={()=>{renderer.current?.zoom(1.25);}}>−</button>
          <button type="button" aria-label="Zoom in" disabled={failed} onClick={()=>{renderer.current?.zoom(.8);}}>+</button>
        </div>
        <div className="apartment-segment">
          <button type="button" aria-pressed={sensorLayer.enabled} onClick={sensorLayer.toggle}>Sensors</button>
        </div>
      </div>
      {sensorLayer.enabled&&<ApartmentSensorTools layer={sensorLayer} failed={failed} sensorCount={presence.sensors.length}/>}
      <div className="apartment-viewport" hidden={failed}>
        <canvas ref={canvas} role="img" aria-label="Furnished apartment diagram; numbered light fixtures and reported anonymous presence are listed below"/>
        {sensorLayer.enabled&&<ApartmentZoneOverlays layer={sensorLayer} region={zoneMarks}/>}
        <div className="apartment-markers" ref={marks}>
          {visibleFixtures.map(({fixture,number})=><button key={fixture.id} type="button" data-apartment-marker={fixture.id} hidden
            aria-pressed={selected===fixture.id} aria-label={'Select '+fixture.label+' in apartment model'} onClick={()=>{setSelected(fixture.id);}}>{number}</button>)}
        </div>
        <div className="apartment-presence-markers" ref={presenceMarks} aria-hidden="true">
          {sensorLayer.points.filter(point=>room===null||point.roomId===room).map(point=><span key={point.id} data-presence-marker={point.id} data-held={point.held===undefined?'unknown':String(point.held)} hidden>{point.label}</span>)}
          {combined!==undefined&&(room===null||combined.roomId===room)&&<span data-presence-marker={combined.id} data-presence-combined hidden/>}
        </div>
        {sensorLayer.draft!==null&&<button type="button" className="apartment-floor-pick" aria-label="Pick floor corners"
          onClick={event=>{sensorLayer.pick(renderer.current,event);}}/>}
      </div>
      {failed&&<p className="apartment-fallback" role="status">3D rendering is unavailable. The fixture list and lighting controls remain available.</p>}
      <div className="apartment-stage-footer">
        <p>{room===null?`${model.rooms.length} ${model.rooms.length===1?'room':'rooms'}`:roomName(room)}{!failed&&<span> · Drag to orbit, pinch to zoom</span>}</p>
        <label><input type="checkbox" checked={cutaway} disabled={failed} onChange={event=>{setCutaway(event.target.checked);}}/> Cutaway walls</label>
      </div>
    </div>
    <div className="apartment-caption">
      <p>Plan scale {model.calibration.source} · orientation {model.calibration.orientation}{focusRoom===undefined?'':` · room geometry ${focusRoom.source}`}. Furniture and finishes are simplified.</p>
      {loadingArt&&<p role="status">Loading artwork…</p>}
      {missingArt.length>0&&<p role="status">Artwork unavailable: {missingArt.map(item=>item.label).join(', ')}.</p>}
    </div>
    {sensorLayer.enabled&&<details className="apartment-sensor-details">
      <summary>Sensor details</summary>
      <ApartmentPresenceView presence={presence} roomName={roomName} room={room}/>
    </details>}
    <div className="apartment-lights">
      <div className="apartment-fixture-list">
        <h4>Light fixtures</h4><p className="apartment-fixture-note">Reported power is shown schematically. The model does not show live scene colors or illumination.</p>
        {visibleFixtures.length===0?<p>No light fixtures are placed here.</p>:<ul>{visibleFixtures.map(({fixture,roomName:name,observation,number})=><li key={fixture.id}>
          <button type="button" aria-pressed={selected===fixture.id} aria-label={'Select '+fixture.label} onClick={()=>{setSelected(fixture.id);}}>
            <span className="apartment-number" aria-hidden="true">{number}</span><span>{fixture.label}
              <small data-apartment-fixture-status={fixture.id}>{name} · {observation.text}</small></span>
          </button>
        </li>)}</ul>}
      </div>
      {chosen!==undefined&&<div className="room-selected apartment-selection" aria-live="polite">{renderLight(chosen,chosen.roomId,true)}</div>}
    </div>
  </section>;
}
