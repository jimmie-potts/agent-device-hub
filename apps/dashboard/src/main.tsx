import React, {useEffect,useId,useReducer,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Snapshot as StateSnapshot,SessionSnapshot} from '../../../packages/agent-state/src/types';
import type {Snapshot,Mode,Command,MediaAction} from '../../../packages/contracts/src/types';
import {Api,ApiError,type ReceiptEvidence,makeCommand,safeEditorUrl,generalReasons,brightnessDraft,sceneOptions,nanoleafContentReason,playbackControls,playbackEvidence,playbackRequest,isPlaybackReceipt,lightingCommand,lightingReasons,observedColor,type Lighting,type GeneralReasons,type Context,type Component,type PlaybackAction,type PlaybackReceipt,type PlaybackSnapshot} from './client';
import {actionWording,blocked,commandTransition,formWording,initialCommand,runCommand,unreadable,type Attempt,type Prepared,type ResultOptions} from './lifecycle';
import './style.css';

type Monitor={snapshot:StateSnapshot;nextRequestId:string;ownerId:string};
type Nano={apiVersion:string;identity:Snapshot['identity'];revision:string;configurationRevision:number;mode:string;settings:{style?:string;coverage?:string};source:string;projects:{id:string;color:string}[];tasks:{id:string;projectId:string|null;overrideProjectId:string|null}[];elements:{id:string;projectId:string|null;signature:number}[];pending:unknown[];wallPending:unknown;outcomes:{requestId:{epoch:string;sequence:number};outcome:string;failure?:{code:string}}[];nextRequestId:{epoch:string;sequence:number};scenes?:{id:string;name?:string}[];capabilities:Record<string,{supported:boolean}>};
type Pixoo={apiVersion:string;identity:{controllerId:string;deviceId:string};configurationRevision:number;generation:number;nextRequestId:string;configuration:{mode:string;filter:{q?:string;provider?:string;projectId?:string;session?:SessionSnapshot['identity']};cadenceMs:number};pendingMode:string|null;sourceConnection:string;participating:boolean;inFlight:number;lastOutcome:null|{status:string;code?:string};capabilities:{modes:string[];filters:string[];minimumCadenceMs:number;maximumCadenceMs:number}};
/** A LIFX device keeps its lighting snapshot; its controller part is the device's snapshot. */
type Device={snapshot?:Snapshot;integration?:Nano|Pixoo;lighting?:Lighting;error?:string;received?:number;busy?:boolean};
/** Resolves with the device record from a read that started after the call. */
type Refresh=()=>Promise<Device|undefined>;
const age=(ms:number)=>ms<1000?'less than 1s':ms<60000?`${Math.floor(ms/1000)}s`:`${Math.floor(ms/60000)}m`;
const key=(s:SessionSnapshot)=>JSON.stringify([s.identity,s.generation]);
const text=(value:unknown):string=>value===undefined||value===null?'Unknown':typeof value==='object'&&'status' in value&&(value as {status:string}).status==='unknown'?'Unknown':typeof value==='object'?JSON.stringify(value):String(value);
const nano=(value:Nano|Pixoo|undefined):value is Nano=>value?.apiVersion==='nanoleaf.integration/1.0';
const pixoo=(value:Nano|Pixoo|undefined):value is Pixoo=>value?.apiVersion==='pixoo-integration/1.0';
/** The four Nanoleaf configuration edits. A read-only device, such as the Panels (codex-nanoleaf#113), declares them unsupported, so their forms are not shown and one line names them. */
const nanoEdits=[['settings.set','integration settings'],['elements.assign','element mapping'],['task.assign','task mapping'],['project.color','project colors']] as const;
const editable=(s:Nano,op:typeof nanoEdits[number][0])=>s.capabilities[op]?.supported===true;
/** The fresh read before a configuration edit is sent applies the rendering rule: an operation the device no longer supports sends nothing. */
const nanoSource=(op:typeof nanoEdits[number][0])=>(latest:Device,a:Availability)=>a.disabled??(!nano(latest.integration)?'No integration snapshot':!editable(latest.integration,op)?'This device’s integration no longer supports this edit':{source:latest.integration,revision:latest.integration.revision});
const title=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
const listed=(items:readonly string[])=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items[items.length-1];
/** The Pixoo integration envelope. Mode and view changes share the extension's ticket, revision and generation guards. */
const pixooRequest=(s:Pixoo,component:Component,action:unknown)=>({apiVersion:s.apiVersion,controllerId:component.controllerId,deviceId:component.deviceId,requestId:s.nextRequestId,expectedConfigurationRevision:s.configurationRevision,expectedGeneration:s.generation,action});
/** Disabling the focused control while a command runs would drop keyboard focus to the document. Once the command settles, focus returns to that control, or to the first enabled control of the same group when it is locked or gone. */
function useRestoredFocus(active:boolean){
 const saved=useRef<{control:HTMLElement;group:HTMLElement|null}|null>(null);
 useEffect(()=>{
  if(active||!saved.current)return;
  const {control,group}=saved.current;saved.current=null;
  if(document.activeElement!==document.body)return;
  if(control.isConnected&&!control.matches(':disabled')){control.focus();return;}
  if(group?.isConnected)group.querySelector<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')?.focus();
 },[active]);
 return ()=>{const control=document.activeElement;if(control instanceof HTMLElement&&control!==document.body)saved.current={control,group:control.closest<HTMLElement>('.edit')};};
}
/** The one command lifecycle behind draft forms and one-click actions. Each activation sends at most one request, built by the caller from a fresh read. The control stays busy until the refreshed view arrives. Only an accepted ticket is watched for its terminal outcome. An uncertain or partial result, including one observed later, locks the control until the user reloads current values. Nothing is resubmitted automatically. */
function useCommandLifecycle(source:unknown,options:ResultOptions){
 const [state,dispatch]=useReducer(commandTransition,initialCommand);
 // A second activation can arrive before React re-renders the disabled control.
 const running=useRef(false);
 const keepFocus=useRestoredFocus(state.busy);
 useEffect(()=>dispatch({type:'observed',source,options}),[source,state.watching,options.device,options.sameMode]);
 async function run(attempt:Omit<Attempt,'options'>){
  if(running.current||state.locked)return;
  running.current=true;keepFocus();
  try{await runCommand({...attempt,options},dispatch);}finally{running.current=false;dispatch({type:'finish'});}
 }
 return {...state,run,reload:(refresh:()=>Promise<unknown>)=>{dispatch({type:'reload'});void refresh().catch(()=>{});},dismiss:()=>dispatch({type:'dismiss'})};
}
/** One-click commands read the device again just before sending and carry that read's guards. A rejection leaves the action available for another explicit press. */
function useCommand(api:Api,path:string,refresh:()=>Promise<unknown>,source:unknown,options:{sameMode?:boolean}={}){
 const command=useCommandLifecycle(source,options);
 return {status:command.status,tone:command.tone,busy:command.busy,locked:command.locked,
  run:(label:string,prepare:()=>Promise<Prepared<{request:unknown}>>)=>command.run({wording:actionWording(label),prepare,send:request=>api.request<ReceiptEvidence>(path,request),refresh}),
  unlock:()=>command.reload(refresh)};
}
function Badge({children,warning=false}:{children:React.ReactNode;warning?:boolean}){return <span className={'badge'+(warning?' warning':'')}>{children}</span>;}
function Facts({items}:{items:[string,React.ReactNode][]}){return <dl>{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}

type FormProps<T>={title:string;source:T;revision:string;initial:Record<string,string>;disabled?:string;api:Api;path:string;build:(source:T,values:Record<string,string>)=>unknown;refresh:()=>Promise<unknown>;prepare?:()=>Promise<Prepared<{source:T;revision:string}>>;device?:boolean;submitLabel?:string;extra?:React.ReactNode;children:(values:Record<string,string>,change:(name:string,value:string)=>void)=>React.ReactNode};
/** A draft pins the revision it started from. With prepare, the form reads its source again just before sending and uses that read's guards while the revision still matches. An accepted result clears the draft once the refreshed source arrives, so the form is ready for the next change. A rejection keeps the draft editable. Submission, results and locks follow the shared command lifecycle. */
function EditForm<T>({title,source,revision,initial,disabled,api,path,build,refresh,prepare,device=true,submitLabel,extra,children}:FormProps<T>){
 const heading=useId();
 const [draft,setDraft]=useState<{values:Record<string,string>;source:T;revision:string}|null>(null);
 const command=useCommandLifecycle(source,{device}),{status,tone,busy,locked}=command;
 const values=draft?.values??initial,dirty=draft!==null;
 const conflict=dirty&&!locked&&draft.revision!==revision;
 function change(name:string,value:string){setDraft(old=>old?{...old,values:{...old.values,[name]:value}}:{source:structuredClone(source),revision,values:{...initial,[name]:value}});}
 function reload(){setDraft(null);command.reload(refresh);}
 function submit(e:React.FormEvent){e.preventDefault();if(disabled||busy||locked||!draft||conflict)return;const pinned=draft;
  void command.run({wording:formWording,refresh,send:request=>api.request<ReceiptEvidence>(path,request),
   prepare:async()=>{
    if(!prepare)return {request:build(pinned.source,pinned.values)};
    const latest=await prepare();
    if(blocked(latest))return latest;
    if(latest.revision!==pinned.revision)return {blocked:'another client changed this setting while you were editing'};
    return {request:build(latest.source,pinned.values)};
   },
   settled:outcome=>{if(outcome==='accepted')setDraft(null);}});
 }
 return <form className="edit" aria-labelledby={heading} onSubmit={submit}><h3 id={heading}>{title}</h3><fieldset disabled={!!disabled||busy||locked}>{children(values,change)}</fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}{conflict&&<p className="warning">Another client changed this setting while you were editing. Your edit is kept but won’t be sent. Discard it to see current values.</p>}<div className="actions"><button disabled={!!disabled||busy||locked||!dirty||conflict} type="submit">{submitLabel??`Apply ${title.toLowerCase()}`}</button>{locked?<button type="button" className="secondary" disabled={busy} onClick={reload}>Reload current values</button>:dirty&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setDraft(null);command.dismiss();}}>Discard my edit</button>}</div><p role="status" data-tone={tone}>{status}</p>{extra}</form>;
}
function Select({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[]}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;}
const options=(values:string[])=>values.map(value=>({value,label:value}));
type Availability={disabled?:string;content?:string;reasons:GeneralReasons;pixooMode?:{mode:string;pending:string|null;participating:boolean}};
/** One device read decides what is available. Rendering and the fresh read taken just before a command is sent apply the same rules. */
function availability(component:Component,device:Device,control:boolean):Availability{
 const snapshot=device.snapshot,integr=device.integration;
 const external=snapshot?.state.externalControl.status==='known'&&snapshot.state.externalControl.owner==='external';
 const disabled=!control?'Your credential is read-only':device.error?'Controller observations are stale':!snapshot?'No controller snapshot':external?'Device is externally controlled':undefined;
 // Pixoo presents agent status in Monitor. Content controls wait for the observed Media mode; nothing switches or restores on its own.
 const pixooMode=pixoo(integr)?{mode:integr.configuration.mode,pending:integr.pendingMode,participating:integr.participating}:undefined;
 // Nanoleaf presents agent status in Work and Quiet. Scenes wait for the observed Free mode from the same controller v1 snapshot that guards the scene command.
 const content=pixooMode?(pixooMode.pending?`Pixoo is switching to ${title(pixooMode.pending)}; wait for the observed mode`:pixooMode.mode!=='media'?'Pixoo is in Monitor and presents agent status; playlist and playback controls need Media':undefined):component.kind==='nanoleaf'&&snapshot?nanoleafContentReason(snapshot):undefined;
 const reasons=generalReasons({snapshot,control,common:device.error?'Controller observations are stale':external?'Device is externally controlled':undefined,content});
 return {disabled,content,reasons,pixooMode};
}
type Reread=<T extends object>(pick:(latest:Device,available:Availability)=>T|string)=>Promise<Prepared<T>>;
const modePending=(snapshot:Snapshot)=>snapshot.state.pending.some(p=>p.command.kind==='mode.set');
const screenOff='The screen is off. Turn it on first; Monitor shows only while the screen is on';
function ComponentView({component,device,context,api,refresh,now,sessions}:{component:Component;device:Device;context:Context;api:Api;refresh:Refresh;now:number;sessions:SessionSnapshot[]}){
 const snapshot=device.snapshot,integr=device.integration;
 const {disabled,reasons,pixooMode}=availability(component,device,context.control);
 const path=`/api/controllers/v1/${encodeURIComponent(component.id)}`;
 const modes=snapshot?.capabilities.modes;
 const supportedModes=modes?.supported?modes.values.filter(m=>component.kind==='nanoleaf'?['Work','Quiet','Free'].includes(m):component.kind==='pixoo'?['Monitor','Media'].includes(m):false):[];
 const editor=safeEditorUrl(component.editorUrl);
 // Tidbyt and LIFX run in the local controller host: no integration settings or advanced editor.
 const local=component.kind==='tidbyt'||component.kind==='lifx',observed=device.lighting?observedColor(device.lighting.lighting):undefined;
 const elapsed=device.received?Math.max(0,now-device.received):0;
 /** Reads the device again just before a command is sent, so the command carries that read's ticket, revision and generation. A failed read or a control that is no longer available sends nothing. */
 const reread:Reread=async pick=>{
  const latest=await refresh();
  if(!latest||latest.error)return {blocked:unreadable};
  const picked=pick(latest,availability(component,latest,context.control));
  return typeof picked==='string'?{blocked:picked}:picked;
 };
 const switchCommand=useCommand(api,path+'/integration/commands',refresh,integr);
 const freeCommand=useCommand(api,path+'/commands',refresh,snapshot);
 const reapplyCommand=useCommand(api,path+'/commands',refresh,snapshot,{sameMode:true});
 const monitorCommand=useCommand(api,path+'/integration/commands',refresh,integr);
 const switchToFree=component.kind==='nanoleaf'&&snapshot&&supportedModes.includes('Free')&&snapshot.state.desired.mode.status==='known'&&snapshot.state.desired.mode.value!=='Free'&&!modePending(snapshot)?<div className="switch"><div className="actions"><button type="button" disabled={!!disabled||freeCommand.busy||freeCommand.locked} onClick={()=>void freeCommand.run('Switch to Free',()=>reread((latest,a)=>{const s=latest.snapshot;return a.disabled??(!s||s.state.desired.mode.status!=='known'||s.state.desired.mode.value==='Free'||modePending(s)?'Nanoleaf is already in Free or switching mode':{request:makeCommand(s,{kind:'mode.set',mode:'Free'})});}))}>Switch to Free</button>{freeCommand.locked&&<button type="button" className="secondary" onClick={freeCommand.unlock}>Reload current values</button>}</div><p className="hint">One explicit controller v1 mode command through the existing mode control. Returning to Work or Quiet uses the same control.{disabled?` Unavailable: ${disabled}`:''}</p><p role="status" data-tone={freeCommand.tone}>{freeCommand.status}</p></div>:undefined;
 const switchToMedia=pixoo(integr)&&pixooMode&&pixooMode.mode!=='media'&&!pixooMode.pending?<div className="switch"><div className="actions"><button type="button" disabled={!!disabled||switchCommand.busy||switchCommand.locked} onClick={()=>void switchCommand.run('Switch to Media',()=>reread((latest,a)=>{const i=latest.integration;return a.disabled??(!pixoo(i)||i.configuration.mode==='media'||i.pendingMode?'Pixoo is already in Media or switching mode':{request:pixooRequest(i,component,{operation:'mode',mode:'media'})});}))}>Switch to Media</button>{switchCommand.locked&&<button type="button" className="secondary" onClick={switchCommand.unlock}>Reload current values</button>}</div><p className="hint">One explicit mode command through the existing mode control. Returning to Monitor uses the same control.{disabled?` Unavailable: ${disabled}`:''}</p><p role="status" data-tone={switchCommand.tone}>{switchCommand.status}</p></div>:undefined;
 // Sending the active mode again is an explicit mode command. On Nanoleaf it ends power and brightness overrides and reapplies that mode's policy.
 const activeMode=snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:undefined;
 const reapplyPending=!!snapshot&&modePending(snapshot);
 const reapply=snapshot&&!pixoo(integr)&&activeMode&&supportedModes.includes(activeMode)?<div className="switch"><div className="actions"><button type="button" disabled={!!disabled||reapplyPending||reapplyCommand.busy||reapplyCommand.locked} onClick={()=>void reapplyCommand.run(`Reapply ${activeMode}`,()=>reread((latest,a)=>{const s=latest.snapshot;return a.disabled??(!s||s.state.desired.mode.status!=='known'||s.state.desired.mode.value!==activeMode?'the mode changed after this view loaded':modePending(s)?'a mode change is already pending':{request:makeCommand(s,{kind:'mode.set',mode:activeMode})});}))}>Reapply {activeMode}</button>{reapplyCommand.locked&&<button type="button" className="secondary" onClick={reapplyCommand.unlock}>Reload current values</button>}</div><p className="hint">Sends {activeMode} again as one mode command.{component.kind==='nanoleaf'?` This ends any power or brightness override and reapplies ${activeMode}’s brightness policy.`:''}{disabled?` Unavailable: ${disabled}`:reapplyPending?' Unavailable: a mode change is pending.':''}</p><p role="status" data-tone={reapplyCommand.tone}>{reapplyCommand.status}</p></div>:undefined;
 // Pixoo can be configured for Monitor without presenting it, for example after the app restarts or the screen turns off and on. Start Monitor sends the Monitor mode command again.
 const off=snapshot?.state.desired.power.status==='known'&&!snapshot.state.desired.power.value;
 const startReason=disabled??(off?screenOff:pixooMode?.pending?`Pixoo is switching to ${title(pixooMode.pending)}`:undefined);
 const startMonitor=pixoo(integr)&&pixooMode?.mode==='monitor'&&(!pixooMode.participating||monitorCommand.status||monitorCommand.locked)?<div className="switch">{!pixooMode.participating&&<div className="actions"><button type="button" disabled={!!startReason||monitorCommand.busy||monitorCommand.locked} onClick={()=>void monitorCommand.run('Start Monitor',()=>reread((latest,a)=>{const i=latest.integration,s=latest.snapshot;return a.disabled??(!pixoo(i)||i.configuration.mode!=='monitor'?'Pixoo is no longer set to Monitor':i.participating?'Monitor is already showing':i.pendingMode?'a mode change is pending':s?.state.desired.power.status==='known'&&!s.state.desired.power.value?screenOff:{request:pixooRequest(i,component,{operation:'mode',mode:'monitor'})});}))}>Start Monitor</button></div>}{monitorCommand.locked&&<div className="actions"><button type="button" className="secondary" onClick={monitorCommand.unlock}>Reload current values</button></div>}{!pixooMode.participating&&<p className="hint">Pixoo is set to Monitor but isn’t showing agent status. Start Monitor sends one Monitor mode command and doesn’t start playback.{startReason?` Unavailable: ${startReason}.`:''}</p>}<p role="status" data-tone={monitorCommand.tone}>{monitorCommand.status}</p></div>:undefined;
 return <><header className="section-heading"><div><p className="eyebrow">COMPONENT / {component.kind}</p><h2>{component.id}</h2></div><Badge warning={!!device.error}>{device.error?'Stale / unavailable':snapshot?.serviceHealth??'Unknown'}</Badge></header>
 <p className="muted">{component.controllerId} / {component.deviceId}</p>
 <Facts items={[
 ['Selected mode',nano(integr)?integr.mode:pixooMode?`${title(pixooMode.mode)}${pixooMode.pending?` (switching to ${title(pixooMode.pending)})`:''}`:snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:'Unknown'],
 ['Desired state',snapshot?`Mode ${snapshot.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:'unknown'} · Power ${snapshot.state.desired.power.status==='known'?(snapshot.state.desired.power.value?'on':'off'):'unknown'} · Brightness ${snapshot.state.desired.brightness.status==='known'?snapshot.state.desired.brightness.value+'%':'unknown'}`:'Unknown'],['Pending changes',snapshot?snapshot.state.pending.length?`${snapshot.state.pending.length} queued: ${snapshot.state.pending.map(p=>p.command.kind).join(', ')}`:'None':'Unknown'],
 ['Last successful transmission',snapshot?.state.lastSuccessfulSend.status==='known'?`Sent ${snapshot.state.lastSuccessfulSend.operationIds.join(', ')} · physical result unknown`:'Unknown'],['Last outcome',snapshot?.state.lastOutcome.status==='known'?`${snapshot.state.lastOutcome.receipt.outcome}${snapshot.state.lastOutcome.receipt.failure?' · '+snapshot.state.lastOutcome.receipt.failure.code:''}`:'Unknown'],
 ['External control',snapshot?.state.externalControl.status==='known'?snapshot.state.externalControl.owner:'Unknown'],['Observation age',snapshot?.state.observation.status==='known'?age(snapshot.state.observation.evidenceAgeMs+elapsed):'Unknown'],
 ...(component.kind==='lifx'?[['Observed color',observed?`Hue ${observed.hue}° · saturation ${observed.saturation}% · ${observed.kelvin} K · read ${age(observed.ageMs+elapsed)} ago`:'Unknown'],['Lighting pending',device.lighting?`${device.lighting.lighting.pending.length} queued`:'Unknown']] as [string,React.ReactNode][]:[]),
 ['Snapshot fetched',device.received?`${age(elapsed)} ago`:'Never'],...(local?[]:[['Integration outcomes',nano(integr)?integr.outcomes.length?integr.outcomes.map(r=>`${r.outcome}${r.failure?' · '+r.failure.code:''}`).join('; '):'None recorded':pixoo(integr)?integr.lastOutcome?`${integr.lastOutcome.status}${integr.lastOutcome.code?' · '+integr.lastOutcome.code:''}`:'None recorded':'Unknown'],['Integration pending',nano(integr)?`${integr.pending.length} commands; wall edits ${integr.wallPending?'pending':'none'}`:pixoo(integr)?integr.pendingMode??'None':'Unknown']] as [string,React.ReactNode][])
 ]}/>{device.error&&<p role="status" className="warning">{device.error}. Last evidence is retained. Other components remain independent.</p>}
 {component.kind==='tidbyt'&&<p className="hint">The local controller host publishes the agent status and now-playing tiles to this Tidbyt. They follow agent activity and what is playing; this view has nothing to change on the display.</p>}
 {!local&&<><h3>Available integration</h3><p>{pixoo(integr)?integr.capabilities.modes.map(title).join(' · '):supportedModes.length?supportedModes.join(' · '):'Mode control unavailable: no supported integration mode declared.'}</p></>}
 {pixoo(integr)&&<EditForm title="Mode" source={integr} revision={String(integr.configurationRevision)} initial={{mode:integr.configuration.mode}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>pixooRequest(s,component,{operation:'mode',mode:v.mode})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(pixoo(latest.integration)?{source:latest.integration,revision:String(latest.integration.configurationRevision)}:'No integration snapshot'))} extra={startMonitor}>{(v,c)=><><Select label="Device mode" value={v.mode} onChange={x=>c('mode',x)} options={integr.capabilities.modes.map(m=>({value:m,label:title(m)}))}/><p className="hint">Monitor presents agent activity. Media opts out; collection continues. This does not start playback. Pending mode: {integr.pendingMode?title(integr.pendingMode):'none'}.</p></>}</EditForm>}
 {snapshot&&supportedModes.length>0&&!pixoo(integr)&&<EditForm title="Mode" source={snapshot} revision={String(snapshot.configurationRevision)} initial={{mode:snapshot.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:supportedModes[0]}} disabled={disabled} api={api} path={path+'/commands'} build={(s,v)=>makeCommand(s,{kind:'mode.set',mode:v.mode as Mode})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(latest.snapshot?{source:latest.snapshot,revision:String(latest.snapshot.configurationRevision)}:'No controller snapshot'))} extra={reapply}>{(v,c)=><><Select label="Device mode" value={v.mode} onChange={x=>c('mode',x)} options={options(supportedModes)}/><p className="hint">{component.kind==='nanoleaf'?'Work participates; Quiet and Free preserve the owning controller’s policies.':'Monitor presents agent activity. Media opts out; collection continues. This does not start playback.'}</p></>}</EditForm>}
 {nano(integr)&&<>
 {editable(integr,'settings.set')&&<EditForm title="Integration settings" source={integr} revision={integr.revision} initial={{style:integr.settings.style??'classic',coverage:integr.settings.coverage??'whole'}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>({apiVersion:s.apiVersion,controllerId:s.identity.controllerId,deviceId:s.identity.deviceId,requestId:s.nextRequestId,expectedRevision:s.revision,command:{kind:'settings.set',style:v.style,coverage:v.coverage}})} refresh={refresh} prepare={()=>reread(nanoSource('settings.set'))}>{(v,c)=><><Select label="Layout style" value={v.style} onChange={x=>c('style',x)} options={options(['classic','project'])}/><Select label="Coverage" value={v.coverage} onChange={x=>c('coverage',x)} options={options(['whole','status'])}/></>}</EditForm>}
 <p className="hint">Session source: {integr.source}.{nanoEdits.some(([op])=>editable(integr,op))?' Mappings use controller-declared neutral identifiers.':''}</p>
 <NanoMappings integration={integr} disabled={disabled} api={api} path={path} refresh={refresh} reread={reread}/>
 {nanoEdits.some(([op])=>!editable(integr,op))&&<p className="hint undeclared">Not supported by this device’s integration: {listed(nanoEdits.filter(([op])=>!editable(integr,op)).map(([,name])=>name))}.</p>}
 </>}
 {pixoo(integr)&&<EditForm title="Monitor view" source={integr} revision={String(integr.configurationRevision)} initial={{q:integr.configuration.filter.q??'',provider:integr.configuration.filter.provider??'',projectId:integr.configuration.filter.projectId??'',session:integr.configuration.filter.session?JSON.stringify(integr.configuration.filter.session):'',cadence:String(integr.configuration.cadenceMs)}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>({apiVersion:s.apiVersion,controllerId:component.controllerId,deviceId:component.deviceId,requestId:s.nextRequestId,expectedConfigurationRevision:s.configurationRevision,expectedGeneration:s.generation,action:{operation:'view',filter:{...(v.q?{q:v.q}:{}),...(v.provider?{provider:v.provider}:{}),...(v.projectId?{projectId:v.projectId}:{}),...(v.session?{session:JSON.parse(v.session)}:{})},cadenceMs:Number(v.cadence)}})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(pixoo(latest.integration)?{source:latest.integration,revision:String(latest.integration.configurationRevision)}:'No integration snapshot'))}>{(v,c)=><><label>Label / ID filter<input maxLength={120} value={v.q} onChange={e=>c('q',e.target.value)}/></label><Select label="Monitor provider" value={v.provider} onChange={x=>c('provider',x)} options={[{value:'',label:'All providers'},...options(['codex','claude'])]}/><label>Project ID<input maxLength={128} pattern="[A-Za-z0-9_.-]*" value={v.projectId} onChange={e=>c('projectId',e.target.value)}/></label><Select label="Monitor session" value={v.session} onChange={x=>c('session',x)} options={[{value:'',label:'All sessions'},...(v.session&&!sessions.some(s=>JSON.stringify(s.identity)===v.session)?[{value:v.session,label:'Previously selected session'}]:[]),...sessions.map(s=>({value:JSON.stringify(s.identity),label:s.label??s.identity.sessionId}))]}/><label>Update interval (ms)<input type="number" min={integr.capabilities.minimumCadenceMs} max={integr.capabilities.maximumCadenceMs} step="1" value={v.cadence} onChange={e=>c('cadence',e.target.value)}/></label><p className="hint">Filters can produce an empty monitor view. Participation: {integr.participating?'yes':'no'}; source: {integr.sourceConnection}.</p></>}</EditForm>}
 {!local&&!nano(integr)&&!pixoo(integr)&&<p className="hint">Settings unavailable: this component has no supported integration extension.</p>}
 <p className="eyebrow general">GENERAL CONTROLS</p>
 {snapshot?<GeneralControls component={component} snapshot={snapshot} integration={integr} reasons={reasons} api={api} path={path+'/commands'} refresh={refresh} reread={reread} mediaExtra={switchToMedia} sceneExtra={switchToFree}/>:<p className="hint">General controls unavailable: no controller snapshot.</p>}
 {component.kind==='lifx'&&<><p className="eyebrow general">LIGHTING</p><LightingControls lighting={device.lighting} disabled={disabled} api={api} path={path+'/lighting/commands'} refresh={refresh} reread={reread}/></>}
 {!local&&<><p className="hint">Rendition selection is not part of this view. Exact previews are not available.</p>{editor?<a href={editor} target="_blank" rel="noopener noreferrer">Open advanced {component.kind==='pixoo'?'playlist':'wall'} editor ↗</a>:<p className="hint">Advanced editor unavailable: no validated link configured.</p>}</>}
 </>;
}
/** LIFX color and color temperature. Each form sends one guarded `lifx-light` request through the hub's lighting route, built from a lighting read taken just before sending. Neither turns the bulb on or changes power or brightness. */
function LightingControls({lighting,disabled,api,path,refresh,reread}:{lighting?:Lighting;disabled?:string;api:Api;path:string;refresh:Refresh;reread:Reread}){
 if(!lighting)return <p className="hint">Lighting controls unavailable: no lighting snapshot.</p>;
 if(!lighting.lighting.capabilities.color&&!lighting.lighting.capabilities.temperature)return <p className="hint">No lighting controls: this bulb’s model is not qualified for color or color temperature.</p>;
 const reasons=lightingReasons(lighting,disabled),observed=observedColor(lighting.lighting),source=lighting.controller,revision=String(source.configurationRevision);
 const range=lighting.lighting.capabilities.temperature??{minimum:1500,maximum:9000};
 const kelvin=observed?Math.min(range.maximum,Math.max(range.minimum,observed.kelvin)):2700;
 const prepare=(name:'color'|'temperature')=>()=>reread((latest,a)=>{const reason=lightingReasons(latest.lighting,a.disabled)[name];return reason??{source:latest.lighting!.controller,revision:String(latest.lighting!.controller.configurationRevision)};});
 return <>
 <EditForm title="Color" source={source} revision={revision} initial={{hue:String(observed?.hue??0),saturation:String(observed?.saturation??100)}} disabled={reasons.color} api={api} path={path} build={(s,v)=>lightingCommand(s,{kind:'lifx.color.set',hue:Number(v.hue),saturation:Number(v.saturation)})} refresh={refresh} prepare={prepare('color')}>{(v,c)=><><label>Hue (°)<input type="range" min={0} max={360} step={1} value={v.hue} onChange={e=>c('hue',e.target.value)}/></label><label>Saturation (%)<input type="range" min={0} max={100} step={1} value={v.saturation} onChange={e=>c('saturation',e.target.value)}/></label><p className="hint">Selected hue {v.hue}° at {v.saturation}% saturation. {observed?'The sliders start at the last color the bulb reported.':'No color has been read yet; the sliders start at a placeholder, not an observed value.'} Brightness and power stay as they are.</p></>}</EditForm>
 <EditForm title="Color temperature" source={source} revision={revision} initial={{kelvin:String(kelvin)}} disabled={reasons.temperature} api={api} path={path} build={(s,v)=>lightingCommand(s,{kind:'lifx.temperature.set',kelvin:Number(v.kelvin)})} refresh={refresh} prepare={prepare('temperature')}>{(v,c)=><><label>Color temperature (K)<input type="range" min={range.minimum} max={range.maximum} step={1} value={v.kelvin} onChange={e=>c('kelvin',e.target.value)}/></label><p className="hint">Selected {v.kelvin} K of {range.minimum}–{range.maximum} K. Hue and saturation are kept, so the light looks white only at 0% saturation. Brightness and power stay as they are.</p></>}</EditForm>
 <p className="hint">B.U.N.N.Y. can’t see the bulb. The observed color is the last one it reported, read before any later change.</p>
 </>;
}
const actionLabels:Record<string,string>={pause:'Pause',resume:'Resume',stop:'Stop',next:'Next',previous:'Previous',clear:'Clear','restart-with-changes':'Restart with changes'};
/** Capability-driven general controls. Each control submits one guarded controller v1 command; a disabled control names its reason. */
function GeneralControls({component,snapshot,integration,reasons,api,path,refresh,reread,mediaExtra,sceneExtra}:{component:Component;snapshot:Snapshot;integration:Nano|Pixoo|undefined;reasons:GeneralReasons;api:Api;path:string;refresh:Refresh;reread:Reread;mediaExtra?:React.ReactNode;sceneExtra?:React.ReactNode}){
 // A draft conflicts when another client changed the configuration. The generation retires output work and advances without any edit, for example on every Pixoo playlist item, so the fresh read supplies it.
 const revision=String(snapshot.configurationRevision),pixel=component.kind==='pixoo';
 const prepare=(name:'power'|'brightness')=>()=>reread((latest,a)=>a.reasons[name]??(latest.snapshot?{source:latest.snapshot,revision:String(latest.snapshot.configurationRevision)}:'No controller snapshot'));
 const brightness=snapshot.capabilities.brightness,range=brightness.supported?brightness:{minimum:0,maximum:100},draft=brightnessDraft(snapshot);
 const power=pixel?'Screen power':'Power',wall=component.kind==='nanoleaf';
 const override=snapshot.state.desired.brightness;
 const caps=snapshot.capabilities;
 // Only declared capabilities get a form; one line names the rest, so no form is dead for lack of a capability.
 const undeclared=(['power','brightness','media','scenes'] as const).filter(name=>!caps[name].supported);
 if(undeclared.length===4)return <p className="hint undeclared">No general controls: this controller declares no power, brightness, media or scenes.</p>;
 // Power starts from the desired value, then the last observed value, then no choice at all: an unknown state is never shown as On or Off.
 const desiredPower=snapshot.state.desired.power,observation=snapshot.state.observation;
 const observedPower=observation.status==='known'&&observation.power.status==='known'?observation.power.value:undefined;
 const initialPower=desiredPower.status==='known'?(desiredPower.value?'on':'off'):observedPower===undefined?'':observedPower?'on':'off';
 const powerNote=desiredPower.status==='known'?undefined:observedPower===undefined?'Current power is unknown; choose On or Off.':`Last read: ${observedPower?'on':'off'}, ${age(observation.status==='known'?observation.evidenceAgeMs:0)} ago.`;
 const powerOptions=(value:string)=>[...(value===''?[{value:'',label:'Choose on or off'}]:[]),{value:'on',label:'On'},{value:'off',label:'Off'}];
 return <>
 {caps.power.supported&&<EditForm title={power} source={snapshot} revision={revision} initial={{on:initialPower}} disabled={reasons.power} api={api} path={path} build={(s,v)=>makeCommand(s,{kind:'power.set',on:v.on==='on'})} refresh={refresh} prepare={prepare('power')}>{(v,c)=><><Select label={power} value={v.on} onChange={x=>c('on',x)} options={powerOptions(v.on)}/>{powerNote&&<p className="hint">{powerNote}</p>}<p className="hint">{pixel?'Screen off pauses playback; screen on does not resume it. Power works in Monitor and Media and does not change the mode.':wall?'Power works in Work, Quiet and Free and does not change the mode. While off, Nanoleaf keeps tracking tasks and writes nothing to this device until the next explicit mode command.':'Power does not change the device mode.'}</p></>}</EditForm>}
 {caps.brightness.supported&&<EditForm title="Brightness" source={snapshot} revision={revision} initial={{percent:String(draft.value)}} disabled={reasons.brightness} api={api} path={path} build={(s,v)=>makeCommand(s,{kind:'brightness.set',percent:Number(v.percent)})} refresh={refresh} prepare={prepare('brightness')}>{(v,c)=><><label>Brightness (%)<input type="range" min={range.minimum} max={range.maximum} step={1} value={v.percent} onChange={e=>c('percent',e.target.value)}/></label><p className="hint">Selected {v.percent}% of {range.minimum}–{range.maximum}. {wall?(override.status==='known'?`Brightness override active: ${override.value}% until the next explicit mode command, which reapplies that mode’s brightness policy.`:'No brightness override is active; this device uses its mode’s brightness policy and the slider starts at a placeholder, not an observed value.'):draft.source==='unknown'?'Current brightness is unknown; the slider starts at a placeholder, not an observed value.':`Current ${draft.source} brightness is ${draft.value}%.`} Brightness works in every mode and does not change the mode.</p></>}</EditForm>}
 {caps.media.supported&&<MediaControls snapshot={snapshot} reason={reasons.media} api={api} path={path} refresh={refresh} reread={reread} extra={mediaExtra}/>}
 {caps.scenes.supported&&<SceneControls snapshot={snapshot} integration={integration} reason={reasons.scenes} api={api} path={path} refresh={refresh} reread={reread} extra={sceneExtra}/>}
 {undeclared.length>0&&<p className="hint undeclared">Not declared by this controller: {listed(undeclared)}.</p>}
 </>;
}
/** Saved scenes are one-click actions with a parameter: the controller-declared ID list, labelled by user-chosen names when the integration supplies them. One guarded scene command; the mode never changes as a side effect. */
function SceneControls({snapshot,integration,reason,api,path,refresh,reread,extra}:{snapshot:Snapshot;integration:Nano|Pixoo|undefined;reason?:string;api:Api;path:string;refresh:Refresh;reread:Reread;extra?:React.ReactNode}){
 const heading=useId();
 const scenes=sceneOptions(snapshot,nano(integration)?integration:undefined);
 const [sceneId,setSceneId]=useState('');const selected=scenes.some(s=>s.value===sceneId)?sceneId:scenes[0]?.value??'';
 const command=useCommand(api,path,refresh,snapshot);
 const disabled=reason??(!scenes.length?'No saved scenes are discovered by this controller':undefined);
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Scenes</h3><fieldset disabled={!!disabled||command.busy||command.locked}><Select label="Saved scene" value={selected} onChange={setSceneId} options={scenes.length?scenes:[{value:'',label:'No saved scenes discovered'}]}/><p className="hint">Scenes come from the controller’s discovery; names are the user-chosen Nanoleaf app names when supplied, IDs otherwise. Activating a scene is one write in Free and does not change the mode.</p><div className="actions"><button type="button" disabled={!selected} onClick={()=>void command.run('Activate scene',()=>reread((latest,a)=>{const s=latest.snapshot;return a.reasons.scenes??(!s||!s.capabilities.scenes.supported||!s.capabilities.scenes.sceneIds.includes(selected)?'this scene is no longer declared':{request:makeCommand(s,{kind:'scene.activate',sceneId:selected})});}))}>Activate scene</button></div></fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}{extra}{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p></div>;
}
function MediaControls({snapshot,reason,api,path,refresh,reread,extra}:{snapshot:Snapshot;reason?:string;api:Api;path:string;refresh:Refresh;reread:Reread;extra?:React.ReactNode}){
 const heading=useId();
 const media=snapshot.capabilities.media,playlists=media.supported?media.playlistIds:[],actions:MediaAction[]=media.supported?media.actions:[];
 const [playlistId,setPlaylistId]=useState('');const selected=playlists.includes(playlistId)?playlistId:playlists[0]??'';
 const command=useCommand(api,path,refresh,snapshot);
 const disabled=reason??(!playlists.length&&!actions.length?'No playlists or playback actions are declared':undefined);
 const declared=(s:Snapshot,cmd:Command)=>s.capabilities.media.supported&&(cmd.kind==='media.start'?s.capabilities.media.playlistIds.includes(cmd.playlistId):cmd.kind==='media.control'&&s.capabilities.media.actions.includes(cmd.action));
 const run=(label:string,cmd:Command)=>void command.run(label,()=>reread((latest,a)=>{const s=latest.snapshot;return a.reasons.media??(!s||!declared(s,cmd)?'this playlist or action is no longer declared':{request:makeCommand(s,cmd)});}));
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Media</h3><fieldset disabled={!!disabled||command.busy||command.locked}><Select label="Saved playlist" value={selected} onChange={setPlaylistId} options={playlists.length?playlists.map(id=>({value:id,label:id})):[{value:'',label:'No saved playlists declared'}]}/><p className="hint">Playlists are listed by controller-declared ID. Starting a playlist or a playback action does not change the mode.{!playlists.length&&!disabled?' Unavailable: Start playlist has no declared saved playlist; playback actions remain available.':''}</p><div className="actions"><button type="button" disabled={!selected} onClick={()=>run('Start playlist',{kind:'media.start',playlistId:selected})}>Start playlist</button>{actions.map(action=><button key={action} type="button" className="secondary" onClick={()=>run(actionLabels[action]??action,{kind:'media.control',action})}>{actionLabels[action]??action}</button>)}</div></fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}{extra}{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p></div>;
}
function NanoMappings({integration:s,disabled,api,path,refresh,reread}:{integration:Nano;disabled?:string;api:Api;path:string;refresh:Refresh;reread:Reread}){
 const [elementId,setElementId]=useState(''),[taskId,setTaskId]=useState(''),[projectId,setProjectId]=useState('');
 const element=s.elements.some(e=>e.id===elementId)?elementId:s.elements[0]?.id??'',task=s.tasks.some(t=>t.id===taskId)?taskId:s.tasks[0]?.id??'',project=s.projects.some(p=>p.id===projectId)?projectId:s.projects[0]?.id??'';
 const projects=[{value:'',label:'Shared pool'},...s.projects.map(p=>({value:p.id,label:p.id}))];
 const base={source:s,revision:s.revision,api,path:path+'/integration/commands',refresh};
 const command=(state:Nano,cmd:unknown)=>({apiVersion:state.apiVersion,controllerId:state.identity.controllerId,deviceId:state.identity.deviceId,requestId:state.nextRequestId,expectedRevision:state.revision,command:cmd});
 if(!nanoEdits.slice(1).some(([op])=>editable(s,op)))return null;
 return <div className="mapping-views">{editable(s,'elements.assign')&&<><h3>Element assignments</h3><Select label="Element" value={element} onChange={setElementId} options={options(s.elements.map(e=>e.id))}/>{!s.elements.length&&<p>No elements declared.</p>}
 {s.elements.map(e=><div key={e.id} hidden={element!==e.id}><EditForm {...base} prepare={()=>reread(nanoSource('elements.assign'))} title="Element mapping" initial={{project:e.projectId??'',signature:String(e.signature)}} disabled={disabled} build={(state,v)=>command(state,{kind:'elements.assign',elements:[{id:e.id,projectId:v.project||null,signature:Number(v.signature)}]})}>{(v,c)=><><Select label="Element project" value={v.project} onChange={x=>c('project',x)} options={projects}/><Select label="Signature" value={v.signature} onChange={x=>c('signature',x)} options={[{value:'0',label:'Off'},{value:'1',label:'On'}]}/><p className="hint">Current assignment: {e.projectId??'Shared pool'}; signature {e.signature?'on':'off'}.</p></>}</EditForm></div>)}</>}
 {editable(s,'task.assign')&&<><h3>Task assignments</h3><Select label="Task" value={task} onChange={setTaskId} options={options(s.tasks.map(t=>t.id))}/>{!s.tasks.length&&<p>No tasks declared.</p>}
 {s.tasks.map(t=><div key={t.id} hidden={task!==t.id}><EditForm {...base} prepare={()=>reread(nanoSource('task.assign'))} title="Task mapping" initial={{project:t.overrideProjectId??''}} disabled={disabled} build={(state,v)=>command(state,{kind:'task.assign',taskId:t.id,projectId:v.project||null})}>{(v,c)=><><Select label="Task project" value={v.project} onChange={x=>c('project',x)} options={[{value:'',label:'No override'},...projects.slice(1)]}/><p className="hint">Current override: {t.overrideProjectId??'None'}; source project: {t.projectId??'Unknown'}.</p></>}</EditForm></div>)}</>}
 {editable(s,'project.color')&&<><h3>Project appearance</h3><Select label="Color project" value={project} onChange={setProjectId} options={projects.slice(1)}/>{!s.projects.length&&<p>No projects declared.</p>}
 {s.projects.map(p=><div key={p.id} hidden={project!==p.id}><EditForm {...base} prepare={()=>reread(nanoSource('project.color'))} title="Project color" initial={{color:p.color}} disabled={disabled} build={(state,v)=>command(state,{kind:'project.color',projectId:p.id,color:v.color})}>{(v,c)=><label>Color<input type="color" value={v.color} onChange={e=>c('color',e.target.value)}/></label>}</EditForm></div>)}</>}
 </div>;
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
 const command=useCommandLifecycle(read.snapshot,playbackOptions);
 const {snapshot,error}=read,playback=snapshot?.playback??null,available=playbackControls(error?undefined:snapshot,control);
 const labels:Record<PlaybackAction,string>={play:'Play',pause:'Pause',next:'Next',previous:'Previous'};
 const send=(request:unknown)=>api.request<PlaybackReceipt>('/api/playback/v1/commands',request).then(playbackEvidence,(e:unknown)=>{if(e instanceof ApiError&&isPlaybackReceipt(e.detail))return playbackEvidence(e.detail);throw e;});
 const run=(action:PlaybackAction)=>void command.run({wording:actionWording(labels[action]),send,refresh:()=>refresh.current(),
  prepare:async()=>{const fresh=await refresh.current();const result=playbackRequest(fresh,{sourceId,action,control,requestId:'bunny-'+crypto.randomUUID()});return 'blocked' in result?result:{request:result.request};}});
 const elapsed=read.received?Math.max(0,now-read.received):0;
 const availability=snapshot?title(snapshot.availability):'Unknown';
 return <><header className="section-heading"><div><p className="eyebrow">NOW PLAYING / {sourceId}</p><h2>{playback?.title??(playback?'Untitled':'No track information')}</h2></div><Badge warning={!!error||snapshot?.availability!=='available'}>{error?'Stale / unavailable':availability}</Badge></header>
 <p className="muted">{[playback?.artist,playback?.album].filter(Boolean).join(' · ')||'Artist not reported'}</p>
 <Facts items={[['Status',playback?title(playback.status):'Unknown'],['Title',playback?.title??'Not reported'],['Artist',playback?.artist??'Not reported'],['Album',playback?.album??'Not reported'],['Source',sourceId],['Availability',availability],
  ['Observation age',snapshot?.ageMs!=null?age(snapshot.ageMs+elapsed):'Never observed'],['Snapshot fetched',read.received?`${age(elapsed)} ago`:'Never']]}/>
 {error&&<p role="status" className="warning">{error}. Last evidence is retained.</p>}
 {snapshot?.availability==='stale'&&<p className="hint">The receiver hasn’t answered for a few seconds; these are its last values.</p>}
 {snapshot?.availability==='unavailable'&&<p className="hint">The receiver hasn’t answered for 30 seconds or more, or not yet, so no track is shown. A silent receiver is never treated as paused.</p>}
 {playback?.status==='inactive'&&<p className="hint">The receiver is answering, but AirPlay isn’t its current input.</p>}
 <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Playback controls</h3>
 {available.actions.length>0&&<div className="actions">{available.actions.map(action=><button key={action} type="button" className={action==='pause'?undefined:'secondary'} disabled={command.busy||command.locked} onClick={()=>run(action)}>{labels[action]}</button>)}</div>}
 {available.reason&&<p className="hint">Unavailable: {available.reason}</p>}
 {!!available.undeclared?.length&&<p className="hint">Not offered by this source: {available.undeclared.map(a=>labels[a]).join(', ')}.</p>}
 {playback?.status==='paused'&&available.actions.length>0&&<p className="hint">The receiver may keep showing the previous title after Next or Previous until playback resumes.</p>}
 {available.actions.length>0&&<p className="hint">Commands go only to {sourceId}. A sent command reached the receiver; check the phone to confirm.</p>}
 {command.locked&&<div className="actions"><button type="button" className="secondary" onClick={()=>command.reload(()=>refresh.current())}>Reload current values</button></div>}
 <p role="status" data-tone={command.tone}>{command.status}</p></div>
 </>;
}
function SessionView({session:s,monitor,context,api,refresh,stale,elapsed}:{session:SessionSnapshot;monitor:Monitor;context:Context;api:Api;refresh:()=>Promise<void>;stale:boolean;elapsed:number}){
 return <article className="session"><div className="section-heading"><h3>{s.label??s.identity.sessionId}</h3><Badge warning={s.freshness!=='current'||stale}>{stale?'Stale connection':s.freshness}</Badge></div><p className="muted">{s.identity.provider} · {s.identity.client} · {s.identity.hostId} / {s.identity.sourceId}</p>
 <Facts items={[
 ['Activity',s.activity],['Attention',s.attention.length?s.attention.map((a,i)=><span key={i} className="attention">{a.kind==='question'?'Question · continuing':`${a.kind} · blocked attention`} </span>):'None observed'],['Observation age',age(s.observationAgeMs+elapsed)],['Read evidence',s.read],['Parent',s.parent.status==='known'?s.parent.identity.sessionId:s.parent.status==='top-level'?'Top-level session':'Unknown'],['Attributable children',`${s.children.active} active / ${s.children.uncertain} uncertain`]
 ]}/><EditForm title="Label" source={monitor} revision={s.label??''} initial={{label:s.label??''}} disabled={!context.control?'Read-only credential':stale?'Snapshot is stale':undefined} api={api} path="/api/monitor/v1/commands" device={false} build={(m,v)=>({operation:'label',requestId:m.nextRequestId,identity:s.identity,label:v.label||null})} refresh={refresh}>{(v,c)=><label>Chosen label<input maxLength={160} value={v.label} placeholder="Choose a label" onChange={e=>c('label',e.target.value)}/></label>}</EditForm>
 {s.notices.length>0&&<h4>Retained notices</h4>}{s.notices.map(n=><div className="notice" key={n.id}><p>{n.kind} · {n.id}</p><p className="hint">Acknowledged by: {n.acknowledgedBy.join(', ')||'none'}. This does not establish success or readership.</p><EditForm title="Monitor acknowledgment" source={monitor} revision={n.id+':'+n.acknowledgedBy.join(',')} initial={{consumer:''}} disabled={!context.control?'Read-only credential':stale?'Snapshot is stale':!context.consumers.length?'No configured consumer':undefined} api={api} path="/api/monitor/v1/commands" device={false} build={(m,v)=>({operation:'acknowledge',requestId:m.nextRequestId,identity:s.identity,noticeId:n.id,consumerId:v.consumer})} refresh={refresh}>{(v,c)=><Select label="Acknowledge for" value={v.consumer} onChange={x=>c('consumer',x)} options={[{value:'',label:'Choose a consumer'},...context.consumers.filter(x=>!n.acknowledgedBy.includes(x)).map(x=>({value:x,label:x}))]}/>}</EditForm></div>)}
 </article>;
}
/** renew is offered only for a trusted-loopback session: one explicit click asks the hub for a new session after this one ended. */
function Dashboard({api,disconnect,renew}:{api:Api;disconnect:()=>void;renew?:()=>void}){
 const [context,setContext]=useState<Context>(),[monitor,setMonitor]=useState<Monitor>(),[devices,setDevices]=useState<Record<string,Device>>({}),[view,setView]=useState('activity'),[q,setQ]=useState(''),[provider,setProvider]=useState(''),[error,setError]=useState(''),[feed,setFeed]=useState(false),[now,setNow]=useState(Date.now()),[received,setReceived]=useState(0);
 const refreshRef=useRef<()=>Promise<void>>(async()=>{}),deviceRefresh=useRef<(id:string)=>Promise<Device|undefined>>(async()=>undefined);
 useEffect(()=>{
  const stop=new AbortController();let busy=false,again=false,waiters:(()=>void)[]=[];const deviceBusy=new Set<string>(),deviceAgain=new Set<string>(),deviceWaiters=new Map<string,(()=>void)[]>(),latest=new Map<string,Device>();let current:Context|undefined,latestMonitor:Monitor|undefined;
  const update=(id:string,value:Partial<Device>)=>{latest.set(id,{...latest.get(id),...value});if(!stop.signal.aborted)setDevices(old=>({...old,[id]:{...old[id],...value}}));};
  // Resolves with the device record after a read that started after this call, so a caller can build a command from authoritative guards.
  async function refreshDevice(c:Component):Promise<Device|undefined>{if(stop.signal.aborted)return latest.get(c.id);
   if(deviceBusy.has(c.id)){deviceAgain.add(c.id);return new Promise<Device|undefined>(resolve=>{const waiting=deviceWaiters.get(c.id)??[];waiting.push(()=>resolve(latest.get(c.id)));deviceWaiters.set(c.id,waiting);});}
   deviceBusy.add(c.id);
   // A LIFX read is one lighting snapshot; its controller part guards the general and lighting controls alike.
   try {if(c.kind==='lifx'){const lighting=await api.request<Lighting>(`/api/controllers/v1/${c.id}/lighting/snapshot`,undefined,stop.signal);update(c.id,{snapshot:lighting.controller,lighting,error:undefined,received:Date.now()});}
    else {const snapshot=await api.request<Snapshot>(`/api/controllers/v1/${c.id}/snapshot`,undefined,stop.signal);let integration:Nano|Pixoo|undefined;
    if(['nanoleaf','pixoo'].includes(c.kind))integration=await api.request<Nano|Pixoo>(`/api/controllers/v1/${c.id}/integration/snapshot`,undefined,stop.signal);
    update(c.id,{snapshot,integration,error:undefined,received:Date.now()});}
   }catch(e){update(c.id,{error:e instanceof ApiError?e.code:'unavailable'});}finally{deviceBusy.delete(c.id);if(deviceAgain.delete(c.id)&&!stop.signal.aborted)void refreshDevice(c);else{const waiting=deviceWaiters.get(c.id)??[];deviceWaiters.delete(c.id);waiting.forEach(resolve=>resolve());}}
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
 const sessions=monitor?.snapshot.sessions??[],filtered=sessions.filter(s=>(!provider||s.identity.provider===provider)&&(!q||(s.label??s.identity.sessionId).toLowerCase().includes(q.toLowerCase())));
 return <div className="shell"><a className="skip" href="#main">Skip to content</a><aside><div className="brand"><span className="rabbit">◈</span><div>B.U.N.N.Y.<small>LOCAL INTEGRATION</small></div></div><nav aria-label="Main navigation"><button aria-current={view==='activity'?'page':undefined} onClick={()=>setView('activity')}>Activity <span>{sessions.length}</span></button><p className="nav-label">COMPONENTS</p>{context?.components.map(c=><button key={c.id} aria-current={view===c.id?'page':undefined} onClick={()=>setView(c.id)}>{c.id}<small>{c.kind}</small></button>)}{context?.playback&&<><p className="nav-label">MUSIC</p><button aria-current={view==='playback:'+context.playback.sourceId?'page':undefined} onClick={()=>setView('playback:'+context.playback!.sourceId)}>{context.playback.sourceId}<small>now playing</small></button></>}<button aria-current={view==='connections'?'page':undefined} onClick={()=>setView('connections')}>Connections</button></nav><div className="sidebar-foot"><Badge warning={!feed||!!error}>{error?'Connection stale':feed?'Feed connected':'Reconnecting'}</Badge><p>Inspection sends no device commands.</p>{renew&&error==='unauthenticated'&&<button onClick={renew}>Sign in again</button>}<button className="secondary" onClick={disconnect}>Disconnect</button></div></aside><main id="main" tabIndex={-1} data-revision={monitor?.snapshot.revision} data-received={received}><header className="top"><span>YOUR WORKSPACE / INTEGRATION</span><span>{context?.control?'Control enabled':'Read only'} · Local</span></header>
 <section hidden={view!=='activity'}><header className="hero"><p className="eyebrow">CODEX & CONNECTED COMPONENTS</p><h1>Your work, at a glance.</h1><p>Activity, attention and device participation. Every action stays explicit.</p></header><div className="stats"><div><strong>{sessions.filter(s=>s.activity==='active').length}</strong><span>Active sessions</span></div><div><strong>{sessions.reduce((n,s)=>n+s.attention.length,0)}</strong><span>Attention signals</span></div><div><strong>{context?.components.length??0}</strong><span>Components</span></div><div><strong>{monitor?.snapshot.collector??'Unknown'}</strong><span>Collector health</span></div></div><div className="filters"><label>Find a session<input type="search" maxLength={120} value={q} onChange={e=>setQ(e.target.value)} placeholder="Chosen label or session ID"/></label><Select label="Provider" value={provider} onChange={setProvider} options={[{value:'',label:'All providers'},...options(['codex','claude'])]}/></div>{error&&<p role="alert" className="warning">{error}. Last observations are stale; edits are disabled.</p>}{!filtered.length&&<div className="empty"><h2>{q||provider?'No matching sessions':'No sessions observed'}</h2><p>{q||provider?'Change the filters to see other observations.':'Component status and supported integration controls remain available.'}</p></div>}<div className="sessions">{sessions.map(s=><div key={key(s)} hidden={!filtered.includes(s)}><SessionView session={s} monitor={monitor!} context={context!} api={api} refresh={()=>refreshRef.current()} stale={!!error||!received||now-received>10000} elapsed={Math.max(0,now-received)} /></div>)}</div></section>
 {context?.components.map(c=><section key={c.id} hidden={view!==c.id}><ComponentView component={c} device={devices[c.id]??{}} context={{...context,control:context.control&&!error}} api={api} refresh={()=>deviceRefresh.current(c.id)} now={now} sessions={sessions}/></section>)}
 {context?.playback&&<section key={'playback:'+context.playback.sourceId} hidden={view!=='playback:'+context.playback.sourceId}><PlaybackView api={api} sourceId={context.playback.sourceId} control={context.control&&!error} now={now}/></section>}
 <section hidden={view!=='connections'}><header className="hero"><p className="eyebrow">SOURCES & CONNECTIONS</p><h1>Evidence, not assumptions.</h1></header><Facts items={[
 ['Collector',monitor?.snapshot.collector??'Unknown'],['State owner',monitor?.ownerId??'Unknown'],['Feed',feed?'Connected':'Reconnecting'],['Snapshot age',received?age(now-received):'Unknown'],['Lost observations',monitor?.snapshot.lossCount??'Unknown'],['Connection error',error||'None observed']
 ]}/><h2>Observed sources</h2>{[...new Set(sessions.map(s=>`${s.identity.provider} / ${s.identity.hostId} / ${s.identity.sourceId}`))].map(s=><p key={s}>{s}</p>)}{!sessions.length&&<p>No source evidence yet.</p>}<p className="hint">A connected collector does not prove a fresh session, successful task, read chat or physical device result.</p></section><footer>B.U.N.N.Y. / Source observations and deliberate controls</footer></main></div>;
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
 useEffect(()=>{
  if(!location.hash){void signIn();return;}
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
 return api?<Dashboard api={api} disconnect={disconnect} renew={trusted?()=>void signIn():undefined}/>:<main className="login"><p className="eyebrow">B.U.N.N.Y. / LOCAL INTEGRATION</p><h1>Your workspace.<br/>One clear view.</h1><p>{launching?'Connecting to the local Hub…':trusted?'You’re signed out.':'Open B.U.N.N.Y. with the Hub launcher.'}</p>{trusted&&!launching&&<button onClick={()=>void signIn()}>Sign in</button>}{signInError&&<p role="alert">B.U.N.N.Y. couldn’t sign you in. Reload to try again, or use the launcher.</p>}{launchError&&<p role="alert">That launch expired or failed. Run the launcher again.</p>}{!trusted&&<p className="hint">The launcher opens this page and connects automatically. After a reload, run it again.</p>}<details><summary>Use a separately provisioned access token</summary><form onSubmit={e=>{e.preventDefault();if(/^[A-Za-z0-9_-]{43}$/.test(token)){attempt.current++;setTrusted(false);setApi(new Api(token));setToken('');}}}><label>Hub browser access token<input type="password" autoComplete="off" required pattern="[A-Za-z0-9_-]{43}" value={token} onChange={e=>setToken(e.target.value)}/></label><button>Connect</button></form><p className="hint">Never use a native controller token. Browser access stays in page memory and clears on disconnect or reload.</p></details></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
