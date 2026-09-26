import React, {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import type {SessionSnapshot} from '../../../packages/agent-state/src/types';
import type {Snapshot} from '../../../packages/contracts/src/types';
import {Api,ApiError,safeEditorUrl,playbackControls,playbackEvidence,playbackRequest,isPlaybackReceipt,observedColor,type Lighting,type Context,type Component,type PlaybackAction,type PlaybackReceipt,type PlaybackSnapshot} from './client';
import {actionWording} from './lifecycle';
import {age,nano,pixoo,title,listed,Badge,Facts,EditForm,TextField,Select,options,useCommandLifecycle,resetLifecycles,deviceControls,hasModeControl,undeclaredCapabilities,lightingNote,ModeCard,PowerCard,BrightnessCard,MediaCard,SceneCard,LightingCards,NanoAssignments,PixooMonitor,type Monitor,type Nano,type Pixoo,type Device,type Refresh,type DeviceControls} from './controls';
import {parseRoute,routeHash,type Route} from './routes';
import {NanoleafArt} from './art/NanoleafArt';
import {geometryRead,type Geometry} from './art/nanoleaf';
import {homeLayout,widgetDefinition,type WidgetSize} from './widgets';
import './style.css';

const key=(s:SessionSnapshot)=>JSON.stringify([s.identity,s.generation]);
/** The current page comes from the location hash, so every page has a URL and the back button walks the history. A link click applies its route in the same event, ahead of the browser's later hashchange, so two pages are never shown at once. */
const routeListeners=new Set<()=>void>();
const emitRoute=()=>routeListeners.forEach(listener=>listener());
addEventListener('hashchange',emitRoute);
const subscribeRoute=(listener:()=>void)=>{routeListeners.add(listener);return ()=>{routeListeners.delete(listener);};};
const useRoute=():Route=>parseRoute(useSyncExternalStore(subscribeRoute,()=>location.hash));
/** Setting the hash updates `location.hash` at once; only the hashchange event is deferred, so the listeners are told now. */
function navigate(hash:string){if(location.hash!==hash)location.hash=hash;emitRoute();}
/** A navigation link: a plain anchor with the route's hash, so it opens in a new tab with a modifier key, and an in-page route change otherwise. */
function NavLink({route,current,children}:{route:Route;current?:Route;children:React.ReactNode}){
 const href=routeHash(route);
 return <a href={href} aria-current={current&&routeHash(current)===href?'page':undefined} onClick={e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(href);}}>{children}</a>;
}
/** The status strip a component shows on its page and in its home widget: the everyday readouts, with the rare facts left to the Details disclosure. */
function statusItems(d:DeviceControls,now:number):[string,React.ReactNode][]{
 const {snapshot,integr,pixooMode,device,component}=d;
 const elapsed=device.received?Math.max(0,now-device.received):0,observed=device.lighting?observedColor(device.lighting.lighting):undefined;
 const items:[string,React.ReactNode][]=[
  ['Mode',nano(integr)?integr.mode:pixooMode?`${title(pixooMode.mode)}${pixooMode.pending?` (switching to ${title(pixooMode.pending)})`:''}`:snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:'Unknown'],
  ['Power',snapshot?.state.desired.power.status==='known'?(snapshot.state.desired.power.value?'On':'Off'):'Unknown'],
  ['Brightness',snapshot?.state.desired.brightness.status==='known'?snapshot.state.desired.brightness.value+'%':'Unknown'],
  ['Observation age',snapshot?.state.observation.status==='known'?age(snapshot.state.observation.evidenceAgeMs+elapsed):'Unknown'],
  ['Pending',snapshot?String(snapshot.state.pending.length):'Unknown']];
 if(component.kind==='lifx')items.push(['Observed color',observed?`Hue ${observed.hue}° · saturation ${observed.saturation}% · ${observed.kelvin} K · read ${age(observed.ageMs+elapsed)} ago`:'Unknown']);
 return items;
}
const health=(d:DeviceControls)=><Badge warning={!!d.device.error}>{d.device.error?'Stale / unavailable':d.snapshot?.serviceHealth??'Unknown'}</Badge>;
/** One component's page: identity and health, the status strip, the rare facts behind Details, every control as a card, and the device's own panels. */
function ComponentView({component,device,context,api,refresh,now,sessions}:{component:Component;device:Device;context:Context;api:Api;refresh:Refresh;now:number;sessions:SessionSnapshot[]}){
 const d=deviceControls(component,device,context,api,refresh);
 const {snapshot,integr,local}=d;
 // The shared device art keeps its own selection; picking an element there also selects it in the Assignments panel.
 const [pickedElement,setPickedElement]=useState<string>(),artSelection=useMemo(()=>pickedElement?[pickedElement]:[],[pickedElement]);
 const editor=safeEditorUrl(component.editorUrl);
 const elapsed=device.received?Math.max(0,now-device.received):0;
 const undeclared=snapshot?undeclaredCapabilities(snapshot):[];
 const note=component.kind==='lifx'?lightingNote(d):undefined;
 const cards=!!snapshot&&(hasModeControl(d)||undeclared.length<4||(component.kind==='lifx'&&!note));
 return <><header className="section-heading"><div><p className="eyebrow">COMPONENT / {component.kind}</p><h2>{component.id}</h2><p className="muted">{component.controllerId} / {component.deviceId}</p></div>{health(d)}</header>
 <Facts className="strip" items={statusItems(d,now)}/>
 {device.error&&<p role="status" className="warning">{device.error}. Last evidence is retained. Other components remain independent.</p>}
 <details className="details"><summary>Details</summary><Facts items={[
 ['Desired state',snapshot?`Mode ${snapshot.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:'unknown'} · Power ${snapshot.state.desired.power.status==='known'?(snapshot.state.desired.power.value?'on':'off'):'unknown'} · Brightness ${snapshot.state.desired.brightness.status==='known'?snapshot.state.desired.brightness.value+'%':'unknown'}`:'Unknown'],['Pending changes',snapshot?snapshot.state.pending.length?`${snapshot.state.pending.length} queued: ${snapshot.state.pending.map(p=>p.command.kind).join(', ')}`:'None':'Unknown'],
 ['Last successful transmission',snapshot?.state.lastSuccessfulSend.status==='known'?`Sent ${snapshot.state.lastSuccessfulSend.operationIds.join(', ')} · physical result unknown`:'Unknown'],['Last outcome',snapshot?.state.lastOutcome.status==='known'?`${snapshot.state.lastOutcome.receipt.outcome}${snapshot.state.lastOutcome.receipt.failure?' · '+snapshot.state.lastOutcome.receipt.failure.code:''}`:'Unknown'],
 ['External control',snapshot?.state.externalControl.status==='known'?snapshot.state.externalControl.owner:'Unknown'],['Snapshot fetched',device.received?`${age(elapsed)} ago`:'Never'],
 ...(component.kind==='lifx'?[['Lighting pending',device.lighting?`${device.lighting.lighting.pending.length} queued`:'Unknown']] as [string,React.ReactNode][]:[]),
 ...(local?[]:[['Integration outcomes',nano(integr)?integr.outcomes.length?integr.outcomes.map(r=>`${r.outcome}${r.failure?' · '+r.failure.code:''}`).join('; '):'None recorded':pixoo(integr)?integr.lastOutcome?`${integr.lastOutcome.status}${integr.lastOutcome.code?' · '+integr.lastOutcome.code:''}`:'None recorded':'Unknown'],['Integration pending',nano(integr)?`${integr.pending.length} commands; wall edits ${integr.wallPending?'pending':'none'}`:pixoo(integr)?integr.pendingMode??'None':'Unknown']] as [string,React.ReactNode][])
 ]}/></details>
 {component.kind==='nanoleaf'&&<NanoleafArt title={component.id} read={device.geometry} snapshot={nano(integr)?integr:undefined} stale={!!device.error} selection={artSelection} onSelect={setPickedElement}/>}
 {component.kind==='tidbyt'&&<p className="hint">The local controller host publishes the agent status and now-playing tiles to this Tidbyt. They follow agent activity and what is playing; this view has nothing to change on the display.</p>}
 <p className="eyebrow general">CONTROLS</p>
 {cards&&<div className="cards"><ModeCard d={d}/><PowerCard d={d}/><BrightnessCard d={d}/><MediaCard d={d}/><SceneCard d={d}/>{component.kind==='lifx'&&<LightingCards d={d}/>}</div>}
 {snapshot?<>
  {!local&&!hasModeControl(d)&&<p className="hint">Mode control unavailable: no supported integration mode declared.</p>}
  {undeclared.length===4?<p className="hint undeclared">No general controls: this controller declares no power, brightness, media or scenes.</p>:undeclared.length>0&&<p className="hint undeclared">Not declared by this controller: {listed(undeclared)}.</p>}
 </>:<p className="hint">General controls unavailable: no controller snapshot.</p>}
 {note&&<p className="hint">{note}</p>}
 {!local&&!nano(integr)&&!pixoo(integr)&&<p className="hint">Settings unavailable: this component has no supported integration extension.</p>}
 {nano(integr)&&<NanoAssignments d={d} integration={integr} picked={pickedElement} onPick={setPickedElement}/>}
 {pixoo(integr)&&<PixooMonitor d={d} integration={integr} sessions={sessions}/>}
 {!local&&<p className="hint">{editor?<a href={editor} target="_blank" rel="noopener noreferrer">Open advanced {component.kind==='pixoo'?'playlist':'wall'} editor ↗</a>:'Advanced editor unavailable: no validated link configured.'} Rendition selection is not part of this view. Exact previews are not available.</p>}
 </>;
}
type PlaybackRead={snapshot?:PlaybackSnapshot;error?:string;received?:number};
const playbackPoll=2000;
// Results name no device check: the view itself shows the receiver's next report.
const playbackOptions={device:false,unreadable:'B.U.N.N.Y. couldn’t read the playback source'};
/** Text-only now playing for the one granted source. It polls the hub's snapshot at the source's read cadence. Buttons appear only for actions the source declares now, for a control-scoped caller while the source is available; each press reads again and sends one command bound to this source. */
function PlaybackView({api,sourceId,control,now}:{api:Api;sourceId:string;control:boolean;now:number}){
 const heading=useId();
 const [read,setRead]=useState<PlaybackRead>({});
 const latest=useRef<PlaybackRead>({}),stop=useRef<AbortSignal|undefined>(undefined);
 // Resolves with this call's own read. A failed read keeps the last snapshot for display and records the error.
 const refresh=useRef(async():Promise<PlaybackRead>=>({}));
 refresh.current=async()=>{
  let next:PlaybackRead;
  try{const snapshot=await api.request<PlaybackSnapshot>('/api/playback/v1/snapshot',undefined,stop.current);next=snapshot.sourceId===sourceId?{snapshot,received:Date.now()}:{...latest.current,error:'unknown-source'};}
  catch(e){next={...latest.current,error:e instanceof ApiError?e.code:'unavailable'};}
  if(!stop.current?.aborted){latest.current=next;setRead(next);}
  return next;
 };
 useEffect(()=>{
  const abort=new AbortController();stop.current=abort.signal;
  void refresh.current();const timer=setInterval(()=>void refresh.current(),playbackPoll);
  return ()=>{abort.abort();clearInterval(timer);};
 },[api,sourceId]);
 const command=useCommandLifecycle(read.snapshot,playbackOptions,'playback:'+sourceId);
 const {snapshot,error}=read,playback=snapshot?.playback??null,available=playbackControls(error?undefined:snapshot,control);
 const labels:Record<PlaybackAction,string>={play:'Play',pause:'Pause',next:'Next',previous:'Previous'};
 const send=(request:unknown)=>api.request<PlaybackReceipt>('/api/playback/v1/commands',request).then(playbackEvidence,(e:unknown)=>{if(e instanceof ApiError&&isPlaybackReceipt(e.detail))return playbackEvidence(e.detail);throw e;});
 const run=(action:PlaybackAction)=>void command.run({wording:actionWording(labels[action]),send,refresh:()=>refresh.current(),
  prepare:async()=>{const fresh=await refresh.current();const result=playbackRequest(fresh,{sourceId,action,control,requestId:'bunny-'+crypto.randomUUID()});return 'blocked' in result?result:{request:result.request};}});
 const elapsed=read.received?Math.max(0,now-read.received):0;
 const availability=snapshot?title(snapshot.availability):'Unknown';
 return <><header className="section-heading"><div><p className="eyebrow">NOW PLAYING / {sourceId}</p><h2>{playback?.title??(playback?'Untitled':'No track information')}</h2><p className="muted">{[playback?.artist,playback?.album].filter(Boolean).join(' · ')||'Artist not reported'}</p></div><Badge warning={!!error||snapshot?.availability!=='available'}>{error?'Stale / unavailable':availability}</Badge></header>
 <Facts className="strip" items={[['Status',playback?title(playback.status):'Unknown'],['Title',playback?.title??'Not reported'],['Artist',playback?.artist??'Not reported'],['Album',playback?.album??'Not reported'],['Source',sourceId],['Availability',availability],
  ['Observation age',snapshot?.ageMs!=null?age(snapshot.ageMs+elapsed):'Never observed'],['Snapshot fetched',read.received?`${age(elapsed)} ago`:'Never']]}/>
 {error&&<p role="status" className="warning">{error}. Last evidence is retained.</p>}
 {snapshot?.availability==='stale'&&<p className="hint">The receiver hasn’t answered for a few seconds; these are its last values.</p>}
 {snapshot?.availability==='unavailable'&&<p className="hint">The receiver hasn’t answered for 30 seconds or more, or not yet, so no track is shown. A silent receiver is never treated as paused.</p>}
 {playback?.status==='inactive'&&<p className="hint">The receiver is answering, but AirPlay isn’t its current input.</p>}
 <div className="edit wide" role="group" aria-labelledby={heading}><h3 id={heading}>Playback controls</h3>
 {available.actions.length>0&&<div className="actions">{available.actions.map(action=><button key={action} type="button" className={action==='pause'?undefined:'secondary'} disabled={command.busy||command.locked} onClick={()=>run(action)}>{labels[action]}</button>)}</div>}
 {available.reason&&<p className="hint">Unavailable: {available.reason}</p>}
 {!!available.undeclared?.length&&<p className="hint">Not offered by this source: {available.undeclared.map(a=>labels[a]).join(', ')}.</p>}
 {playback?.status==='paused'&&available.actions.length>0&&<p className="hint">The receiver may keep showing the previous title after Next or Previous until playback resumes.</p>}
 {available.actions.length>0&&<p className="hint">Commands go only to {sourceId}. A sent command reached the receiver; check the phone to confirm.</p>}
 {command.locked&&<div className="actions"><button type="button" className="secondary" onClick={()=>command.reload(()=>refresh.current())}>Reload current values</button></div>}
 <p role="status" data-tone={command.tone}>{command.status}</p></div>
 </>;
}
/** One session as a compact row: badge, identity, the inline facts, the label form, and any retained notices under it. */
function SessionRow({session:s,monitor,context,api,refresh,stale,elapsed}:{session:SessionSnapshot;monitor:Monitor;context:Context;api:Api;refresh:()=>Promise<void>;stale:boolean;elapsed:number}){
 return <article className="session"><div className="session-head"><Badge warning={s.freshness!=='current'||stale}>{stale?'Stale connection':s.freshness}</Badge><div className="session-id"><h3>{s.label??s.identity.sessionId}</h3><p className="muted">{s.identity.provider} · {s.identity.client} · {s.identity.hostId} / {s.identity.sourceId}</p></div></div>
 <Facts className="strip" items={[
 ['Activity',s.activity],['Attention',s.attention.length?s.attention.map((a,i)=><span key={i} className="attention">{a.kind==='question'?'Question · continuing':`${a.kind} · blocked attention`} </span>):'None observed'],['Observation age',age(s.observationAgeMs+elapsed)],['Read evidence',s.read],['Parent',s.parent.status==='known'?s.parent.identity.sessionId:s.parent.status==='top-level'?'Top-level session':'Unknown'],['Attributable children',`${s.children.active} active / ${s.children.uncertain} uncertain`]
 ]}/><EditForm title="Label" className="inline" source={monitor} initial={{label:s.label??''}} disabled={!context.control?'Read-only credential':stale?'Snapshot is stale':undefined} api={api} path="/api/monitor/v1/commands" device={false} build={(m,v)=>({operation:'label',requestId:m.nextRequestId,identity:s.identity,label:v.label||null})} refresh={refresh}>{f=><TextField label="Chosen label" name="label" field={f} maxLength={160} placeholder="Choose a label"/>}</EditForm>
 {s.notices.length>0&&<h4>Retained notices</h4>}{s.notices.map(n=><div className="notice" key={n.id}><p>{n.kind} · {n.id}</p><p className="hint">Acknowledged by: {n.acknowledgedBy.join(', ')||'none'}. This does not establish success or readership.</p><EditForm title="Monitor acknowledgment" className="inline" source={monitor} initial={{consumer:''}} disabled={!context.control?'Read-only credential':stale?'Snapshot is stale':!context.consumers.length?'No configured consumer':undefined} api={api} path="/api/monitor/v1/commands" device={false} build={(m,v)=>({operation:'acknowledge',requestId:m.nextRequestId,identity:s.identity,noticeId:n.id,consumerId:v.consumer})} refresh={refresh}>{f=><Select label="Acknowledge for" deliberate value={f.values.consumer} onChange={x=>f.set('consumer',x)} options={[{value:'',label:'Choose a consumer'},...context.consumers.filter(x=>!n.acknowledgedBy.includes(x)).map(x=>({value:x,label:x}))]}/>}</EditForm></div>)}
 </article>;
}
/** The frame every widget renders in, whatever page places it: a labelled region, so assistive technology groups its controls under the widget's name. */
function Widget({id,size,title,link,children}:{id:string;size:WidgetSize;title?:string;link?:{route:Route;label:string};children:React.ReactNode}){
 const heading=useId();
 return <article className="widget" role="region" data-widget={id} data-size={size} aria-labelledby={heading}><header className="widget-head"><h2 id={heading}>{title??widgetDefinition(id)?.name??id}</h2>{link&&<NavLink route={link.route}>{link.label}</NavLink>}</header>{children}</article>;
}
/** One registered component on the home: health, the status strip and the everyday mode and power actions, rendered by the same cards as the component page. */
function ComponentWidget({component,device,context,api,refresh,now,size}:{component:Component;device:Device;context:Context;api:Api;refresh:Refresh;now:number;size:WidgetSize}){
 const d=deviceControls(component,device,context,api,refresh);
 const quick=!!d.snapshot&&(hasModeControl(d)||d.snapshot.capabilities.power.supported);
 return <Widget id="component-status" size={size} title={component.id} link={{route:{kind:'component',id:component.id},label:`Open ${component.id}`}}>
 <p className="muted">{component.kind} {health(d)}</p>
 <Facts className="strip" items={statusItems(d,now).slice(0,4)}/>
 {device.error&&<p className="hint warning">{device.error}. Last evidence is retained.</p>}
 {quick?<div className="cards"><ModeCard d={d}/><PowerCard d={d}/></div>:<p className="hint">{d.snapshot?'No quick actions: this controller declares no mode or power control.':'Quick actions unavailable: no controller snapshot.'}</p>}
 </Widget>;
}
function AttentionWidget({sessions,size}:{sessions:SessionSnapshot[];size:WidgetSize}){
 const waiting=sessions.filter(s=>s.attention.length);
 return <Widget id="attention" size={size}>{waiting.length?<ul className="plain">{waiting.map(s=><li key={key(s)}><span className="attention">{s.attention.map(a=>a.kind==='question'?'Question':title(a.kind)).join(', ')}</span> · {s.label??s.identity.sessionId}</li>)}</ul>:<p className="hint">No session is waiting on a question or an approval.</p>}</Widget>;
}
function CollectorWidget({monitor,feed,received,now,error,size}:{monitor?:Monitor;feed:boolean;received:number;now:number;error:string;size:WidgetSize}){
 return <Widget id="collector" size={size}><Facts className="strip" items={[['Collector',monitor?.snapshot.collector??'Unknown'],['State owner',monitor?.ownerId??'Unknown'],['Feed',feed?'Connected':'Reconnecting'],['Snapshot age',received?age(now-received):'Unknown'],['Lost observations',monitor?.snapshot.lossCount??'Unknown'],['Connection error',error||'None observed']]}/></Widget>;
}
function SessionsWidget({sessions,monitor,context,api,refresh,stale,elapsed,size}:{sessions:SessionSnapshot[];monitor?:Monitor;context?:Context;api:Api;refresh:()=>Promise<void>;stale:boolean;elapsed:number;size:WidgetSize}){
 const [q,setQ]=useState(''),[provider,setProvider]=useState('');
 const filtered=sessions.filter(s=>(!provider||s.identity.provider===provider)&&(!q||(s.label??s.identity.sessionId).toLowerCase().includes(q.toLowerCase())));
 return <Widget id="sessions" size={size}>
 <div className="filters"><label>Find a session<input type="search" maxLength={120} value={q} onChange={e=>setQ(e.target.value)} placeholder="Chosen label or session ID"/></label><Select label="Provider" value={provider} onChange={setProvider} options={[{value:'',label:'All providers'},...options(['codex','claude'])]}/></div>
 {!filtered.length&&<div className="empty"><h3>{q||provider?'No matching sessions':'No sessions observed'}</h3><p>{q||provider?'Change the filters to see other observations.':'Component status and supported integration controls remain available.'}</p></div>}
 {monitor&&context&&<div className="sessions">{sessions.map(s=><div key={key(s)} hidden={!filtered.includes(s)}><SessionRow session={s} monitor={monitor} context={context} api={api} refresh={refresh} stale={stale} elapsed={elapsed}/></div>)}</div>}
 </Widget>;
}
/** renew is offered only for a trusted-loopback session: one explicit click asks the hub for a new session after this one ended. */
function Dashboard({api,disconnect,renew}:{api:Api;disconnect:()=>void;renew?:()=>void}){
 const [context,setContext]=useState<Context>(),[monitor,setMonitor]=useState<Monitor>(),[devices,setDevices]=useState<Record<string,Device>>({}),[error,setError]=useState(''),[feed,setFeed]=useState(false),[now,setNow]=useState(Date.now()),[received,setReceived]=useState(0);
 const route=useRoute();
 // One session's shared control state never shows in the next: disconnecting unmounts the dashboard and forgets it. Signing in again keeps the dashboard mounted, so a lock from before the session ended stays until its explicit reload.
 useEffect(()=>()=>resetLifecycles(),[]);
 const refreshRef=useRef<()=>Promise<void>>(async()=>{}),deviceRefresh=useRef<(id:string)=>Promise<Device|undefined>>(async()=>undefined);
 useEffect(()=>{
  const stop=new AbortController();let busy=false,again=false,waiters:(()=>void)[]=[];const deviceBusy=new Set<string>(),deviceAgain=new Set<string>(),deviceWaiters=new Map<string,(()=>void)[]>(),latest=new Map<string,Device>();let current:Context|undefined,latestMonitor:Monitor|undefined;
  const update=(id:string,value:Partial<Device>)=>{latest.set(id,{...latest.get(id),...value});if(!stop.signal.aborted)setDevices(old=>({...old,[id]:{...old[id],...value}}));};
  // Resolves with the device record after a read that started after this call, so a caller can build a command from authoritative guards.
  async function refreshDevice(c:Component):Promise<Device|undefined>{if(stop.signal.aborted)return latest.get(c.id);
   if(deviceBusy.has(c.id)){deviceAgain.add(c.id);return new Promise<Device|undefined>(resolve=>{const waiting=deviceWaiters.get(c.id)??[];waiting.push(()=>resolve(latest.get(c.id)));deviceWaiters.set(c.id,waiting);});}
   deviceBusy.add(c.id);let polled=false;
   // A LIFX read is one lighting snapshot; its controller part guards the general and lighting controls alike.
   try {if(c.kind==='lifx'){const lighting=await api.request<Lighting>(`/api/controllers/v1/${c.id}/lighting/snapshot`,undefined,stop.signal);update(c.id,{snapshot:lighting.controller,lighting,error:undefined,received:Date.now()});polled=true;}
    else {const snapshot=await api.request<Snapshot>(`/api/controllers/v1/${c.id}/snapshot`,undefined,stop.signal);let integration:Nano|Pixoo|undefined;
    if(['nanoleaf','pixoo'].includes(c.kind))integration=await api.request<Nano|Pixoo>(`/api/controllers/v1/${c.id}/integration/snapshot`,undefined,stop.signal);
    update(c.id,{snapshot,integration,error:undefined,received:Date.now()});polled=true;}
   }catch(e){update(c.id,{error:e instanceof ApiError?e.code:'unavailable'});}
   // The device art draws from the geometry route (codex-nanoleaf#169). One read per session after a successful poll, through the same per-device queue; a device without a layout or an owner without the route is final, any other failure is retried after the next successful poll.
   if(polled&&c.kind==='nanoleaf'&&!latest.get(c.id)?.geometry?.final&&!stop.signal.aborted){try{const geometry=await api.request<Geometry>(`/api/controllers/v1/${c.id}/integration/geometry`,undefined,stop.signal);update(c.id,{geometry:geometryRead({geometry})});}catch(e){update(c.id,{geometry:geometryRead(e instanceof ApiError?{error:e.code,status:e.status}:{error:'unavailable',status:0})});}}
   deviceBusy.delete(c.id);if(deviceAgain.delete(c.id)&&!stop.signal.aborted)void refreshDevice(c);else{const waiting=deviceWaiters.get(c.id)??[];deviceWaiters.delete(c.id);waiting.forEach(resolve=>resolve());}
   return latest.get(c.id);
  }
  // Resolves after a read that started after this call, so a settled form starts again from current values.
  async function refresh():Promise<void>{if(busy){again=true;return new Promise<void>(resolve=>waiters.push(resolve));}busy=true;
   try {const ctx=await api.request<Context>('/api/dashboard/v1/context',undefined,stop.signal);const next=await api.request<Monitor>('/api/monitor/v1/sessions?snapshotVersion=1.1',undefined,stop.signal);if(stop.signal.aborted)return;current=ctx;setContext(ctx);if(latestMonitor&&latestMonitor.ownerId===next.ownerId&&latestMonitor.snapshot.revision>next.snapshot.revision){setError('stale-snapshot');return;}if(next.snapshot.apiVersion!=='1.1'||next.snapshot.sessions.some(s=>typeof s.generation!=='number'||!Number.isSafeInteger(s.generation)||s.generation<0||s.generation>next.snapshot.revision))throw new ApiError('unsupported-snapshot');latestMonitor=next;setMonitor(next);setReceived(Date.now());setError('');}
   catch(e){if(!stop.signal.aborted)setError(e instanceof ApiError?e.code:'unavailable');}finally{busy=false;if(again&&!stop.signal.aborted){again=false;void refresh();}else{const waiting=waiters;waiters=[];waiting.forEach(resolve=>resolve());}}
  }
  refreshRef.current=refresh;deviceRefresh.current=id=>{const c=current?.components.find(c=>c.id===id);return c?refreshDevice(c):Promise.resolve(undefined);};
  void refresh().then(()=>current?.components.forEach(c=>void refreshDevice(c)));
  void api.feed(stop.signal,()=>void refresh(),value=>{if(!stop.signal.aborted)setFeed(value);});
  const interval=setInterval(()=>{void refresh();current?.components.forEach(c=>void refreshDevice(c));},5000),clock=setInterval(()=>setNow(Date.now()),1000);
  return ()=>{stop.abort();clearInterval(interval);clearInterval(clock);};
 },[api]);
 const sessions=monitor?.snapshot.sessions??[],stale=!!error||!received||now-received>10000,elapsed=Math.max(0,now-received);
 const components=context?.components??[],playback=context?.playback;
 const known=route.kind==='home'||route.kind==='connections'||(route.kind==='component'&&components.some(c=>c.id===route.id))||(route.kind==='playback'&&playback?.sourceId===route.sourceId);
 const view={context,control:context?{...context,control:context.control&&!error}:undefined};
 return <div className="shell"><a className="skip" href="#main" onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>Skip to content</a><aside><div className="brand"><span className="rabbit">◈</span><div>B.U.N.N.Y.<small>LOCAL INTEGRATION</small></div></div><nav aria-label="Main navigation"><NavLink route={{kind:'home'}} current={route}>Home <span>{sessions.length}</span></NavLink><p className="nav-label">COMPONENTS</p>{components.map(c=><NavLink key={c.id} route={{kind:'component',id:c.id}} current={route}>{c.id}<small>{c.kind}</small></NavLink>)}{playback&&<><p className="nav-label">MUSIC</p><NavLink route={{kind:'playback',sourceId:playback.sourceId}} current={route}>{playback.sourceId}<small>now playing</small></NavLink></>}<NavLink route={{kind:'connections'}} current={route}>Connections</NavLink></nav><div className="sidebar-foot"><Badge warning={!feed||!!error}>{error?'Connection stale':feed?'Feed connected':'Reconnecting'}</Badge><p>Inspection sends no device commands.</p>{renew&&error==='unauthenticated'&&<button onClick={renew}>Sign in again</button>}<button className="secondary" onClick={disconnect}>Disconnect</button></div></aside><main id="main" tabIndex={-1} data-revision={monitor?.snapshot.revision} data-received={received}><header className="top"><span>YOUR WORKSPACE / INTEGRATION</span><span>{context?.control?'Control enabled':'Read only'} · Local</span></header>
 {components.map(c=><section key={c.id} hidden={!(route.kind==='component'&&route.id===c.id)} aria-label={c.id}>{view.control&&<ComponentView component={c} device={devices[c.id]??{}} context={view.control} api={api} refresh={()=>deviceRefresh.current(c.id)} now={now} sessions={sessions}/>}</section>)}
 {playback&&<section key={'playback:'+playback.sourceId} hidden={!(route.kind==='playback'&&route.sourceId===playback.sourceId)} aria-label="Now playing"><PlaybackView api={api} sourceId={playback.sourceId} control={!!context?.control&&!error} now={now}/></section>}
 <section hidden={route.kind!=='home'} aria-label="Home"><header className="page"><h1>Home</h1><Facts className="strip stats" items={[['Active sessions',sessions.filter(s=>s.activity==='active').length],['Attention signals',sessions.reduce((n,s)=>n+s.attention.length,0)],['Components',components.length],['Collector health',monitor?.snapshot.collector??'Unknown']]}/></header>{error&&<p role="alert" className="warning">{error}. Last observations are stale; edits are disabled.</p>}
  <div className="widgets">{homeLayout(components).map(p=>{
   if(p.widget==='component-status'){const c=components.find(c=>c.id===p.instance);return c&&view.control?<ComponentWidget key={'component:'+c.id} component={c} device={devices[c.id]??{}} context={view.control} api={api} refresh={()=>deviceRefresh.current(c.id)} now={now} size={p.size}/>:null;}
   if(p.widget==='attention')return <AttentionWidget key="attention" sessions={sessions} size={p.size}/>;
   if(p.widget==='collector')return <CollectorWidget key="collector" monitor={monitor} feed={feed} received={received} now={now} error={error} size={p.size}/>;
   if(p.widget==='sessions')return <SessionsWidget key="sessions" sessions={sessions} monitor={monitor} context={context} api={api} refresh={()=>refreshRef.current()} stale={stale} elapsed={elapsed} size={p.size}/>;
   return null;})}</div></section>
 {route.kind==='connections'&&<section aria-label="Connections"><header className="page"><h1>Connections</h1></header><div className="cards two"><div className="card"><h2>Connection</h2><Facts items={[
 ['Collector',monitor?.snapshot.collector??'Unknown'],['State owner',monitor?.ownerId??'Unknown'],['Feed',feed?'Connected':'Reconnecting'],['Snapshot age',received?age(now-received):'Unknown'],['Lost observations',monitor?.snapshot.lossCount??'Unknown'],['Connection error',error||'None observed']
 ]}/></div><div className="card"><h2>Observed sources</h2>{[...new Set(sessions.map(s=>`${s.identity.provider} / ${s.identity.hostId} / ${s.identity.sourceId}`))].map(s=><p key={s}>{s}</p>)}{!sessions.length&&<p>No source evidence yet.</p>}<p className="hint">A connected collector does not prove a fresh session, successful task, read chat or physical device result.</p></div></div></section>}
 {context&&!known&&<section aria-label="Not found"><div className="empty"><h2>{route.kind==='component'?`No component named ${route.id}`:'Nothing at this address'}</h2><p>Only registered components and the built-in pages have addresses. <NavLink route={{kind:'home'}}>Go to the home</NavLink>.</p></div></section>}
 <footer>B.U.N.N.Y. / Source observations and deliberate controls</footer></main></div>;
}
const bearer=(value:unknown)=>value&&typeof value==='object'&&'token' in value&&typeof value.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.token)?value.token:undefined;
function App(){
 const [api,setApi]=useState<Api>(),[token,setToken]=useState(''),[launching,setLaunching]=useState(false),[launchError,setLaunchError]=useState(false);
 // trusted: the hub signed this page in without a code (Hub #276). The bearer stays in page memory; nothing is stored.
 const [trusted,setTrusted]=useState(false),[signInError,setSignInError]=useState(false),signing=useRef(false);
 // Disconnect and a manual Connect supersede a sign-in still in flight, so its late answer never overrides the user's last action.
 const attempt=useRef(0);
 /** Asks the hub for a trusted-loopback session. A 404 means the option is off, so the login page shows as before. Only a page load or an explicit click calls this. */
 async function signIn(){
  if(signing.current)return;signing.current=true;const mine=++attempt.current;setLaunching(true);setSignInError(false);
  try{
   const response=await fetch('/api/dashboard/v1/session',{method:'POST',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-pixoo-request':'1'},body:'{}'});
   if(mine!==attempt.current)return;
   if(response.status===404){setTrusted(false);setApi(undefined);return;}
   const value=response.ok?bearer(await response.json()):undefined;if(mine!==attempt.current)return;if(!value)throw new Error('sign-in-failed');
   setTrusted(true);setApi(new Api(value));
  }catch{if(mine===attempt.current){setApi(undefined);setSignInError(true);}}finally{signing.current=false;setLaunching(false);}
 }
 // A page address (`#/...`) is a route, not a launch code: a bookmarked page signs in like an empty hash and keeps its address. Only a `#launch=` fragment is exchanged.
 useEffect(()=>{
  if(!location.hash||location.hash.startsWith('#/')){void signIn();return;}
  const fragment=new URLSearchParams(location.hash.slice(1));
  history.replaceState(null,'',location.pathname+location.search);
  const code=fragment.get('launch');
  if(fragment.size!==1||!code||!/^[A-Za-z0-9_-]{43}$/.test(code)){setLaunchError(true);return;}
  setLaunching(true);
  void fetch('/api/dashboard/v1/launch',{method:'POST',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-pixoo-request':'1'},body:JSON.stringify({code})})
   .then(async response=>{if(!response.ok)throw new Error('launch-failed');const value=bearer(await response.json());if(!value)throw new Error('launch-failed');setApi(new Api(value));})
   .catch(()=>setLaunchError(true)).finally(()=>setLaunching(false));
 },[]);
 // A trusted page ends its session as it unloads, so reloads never pile up against the session limit. A page restored from the back-forward cache signs in again.
 useEffect(()=>{
  if(!api||!trusted)return;
  const hide=()=>api.release(),show=(event:PageTransitionEvent)=>{if(event.persisted)void signIn();};
  addEventListener('pagehide',hide);addEventListener('pageshow',show);
  return ()=>{removeEventListener('pagehide',hide);removeEventListener('pageshow',show);};
 },[api,trusted]);
 const disconnect=()=>{attempt.current++;if(api)void api.request('/api/dashboard/v1/logout',{}).catch(()=>{});setApi(undefined);setToken('');};
 return api?<Dashboard api={api} disconnect={disconnect} renew={trusted?()=>void signIn():undefined}/>:<main className="login"><p className="eyebrow">B.U.N.N.Y. / LOCAL INTEGRATION</p><h1>{launching?'Connecting to the local Hub…':trusted?'You’re signed out.':'Open B.U.N.N.Y. with the Hub launcher.'}</h1>{trusted&&!launching&&<button onClick={()=>void signIn()}>Sign in</button>}{signInError&&<p role="alert">B.U.N.N.Y. couldn’t sign you in. Reload to try again, or use the launcher.</p>}{launchError&&<p role="alert">That launch expired or failed. Run the launcher again.</p>}{!trusted&&<p className="hint">The launcher opens this page and connects automatically. After a reload, run it again.</p>}<details><summary>Use a separately provisioned access token</summary><form onSubmit={e=>{e.preventDefault();if(/^[A-Za-z0-9_-]{43}$/.test(token)){attempt.current++;setTrusted(false);setApi(new Api(token));setToken('');}}}><label>Hub browser access token<input type="password" autoComplete="off" required pattern="[A-Za-z0-9_-]{43}" value={token} onChange={e=>setToken(e.target.value)}/></label><button>Connect</button></form><p className="hint">Never use a native controller token. Browser access stays in page memory and clears on disconnect or reload.</p></details></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
