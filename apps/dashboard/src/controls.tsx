import React, {useEffect,useId,useReducer,useRef,useState} from 'react';
import type {Snapshot as StateSnapshot,SessionSnapshot} from '../../../packages/agent-state/src/types';
import type {Snapshot,Mode,Command,MediaAction} from '../../../packages/contracts/src/types';
import {Api,type ReceiptEvidence,makeCommand,generalReasons,brightnessDraft,sceneOptions,nanoleafContentReason,lightingCommand,lightingReasons,observedColor,type Lighting,type GeneralReasons,type Context,type Component} from './client';
import {actionWording,blocked,commandTransition,formWording,initialCommand,runCommand,unreadable,type Attempt,type Prepared,type ResultOptions} from './lifecycle';

export type Monitor={snapshot:StateSnapshot;nextRequestId:string;ownerId:string};
export type Nano={apiVersion:string;identity:Snapshot['identity'];revision:string;configurationRevision:number;mode:string;settings:{style?:string;coverage?:string};source:string;projects:{id:string;color:string}[];tasks:{id:string;projectId:string|null;overrideProjectId:string|null}[];elements:{id:string;projectId:string|null;signature:number}[];pending:unknown[];wallPending:unknown;outcomes:{requestId:{epoch:string;sequence:number};outcome:string;failure?:{code:string}}[];nextRequestId:{epoch:string;sequence:number};scenes?:{id:string;name?:string}[];capabilities:Record<string,{supported:boolean}>};
export type Pixoo={apiVersion:string;identity:{controllerId:string;deviceId:string};configurationRevision:number;generation:number;nextRequestId:string;configuration:{mode:string;filter:{q?:string;provider?:string;projectId?:string;session?:SessionSnapshot['identity']};cadenceMs:number};pendingMode:string|null;sourceConnection:string;participating:boolean;inFlight:number;lastOutcome:null|{status:string;code?:string};capabilities:{modes:string[];filters:string[];minimumCadenceMs:number;maximumCadenceMs:number}};
/** A LIFX device keeps its lighting snapshot; its controller part is the device's snapshot. */
export type Device={snapshot?:Snapshot;integration?:Nano|Pixoo;lighting?:Lighting;error?:string;received?:number;busy?:boolean};
/** Resolves with the device record from a read that started after the call. */
export type Refresh=()=>Promise<Device|undefined>;
export const age=(ms:number)=>ms<1000?'less than 1s':ms<60000?`${Math.floor(ms/1000)}s`:`${Math.floor(ms/60000)}m`;
export const nano=(value:Nano|Pixoo|undefined):value is Nano=>value?.apiVersion==='nanoleaf.integration/1.0';
export const pixoo=(value:Nano|Pixoo|undefined):value is Pixoo=>value?.apiVersion==='pixoo-integration/1.0';
export const title=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
export const listed=(items:readonly string[])=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items[items.length-1];
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
export function useCommandLifecycle(source:unknown,options:ResultOptions){
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
export function useCommand(api:Api,path:string,refresh:()=>Promise<unknown>,source:unknown,options:{sameMode?:boolean}={}){
 const command=useCommandLifecycle(source,options);
 return {status:command.status,tone:command.tone,busy:command.busy,locked:command.locked,
  run:(label:string,prepare:()=>Promise<Prepared<{request:unknown}>>)=>command.run({wording:actionWording(label),prepare,send:request=>api.request<ReceiptEvidence>(path,request),refresh}),
  unlock:()=>command.reload(refresh)};
}
type CommandHandle=ReturnType<typeof useCommand>;
export function Badge({children,warning=false}:{children:React.ReactNode;warning?:boolean}){return <span className={'badge'+(warning?' warning':'')}>{children}</span>;}
/** Label and value pairs. `strip` lays them out as one wrapping line; `facts` as the two-column list. */
export function Facts({items,className='facts'}:{items:[string,React.ReactNode][];className?:string}){return <dl className={className}>{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
/** Longer guidance sits behind a disclosure, so a card keeps one short visible line. */
export function Help({children}:{children:React.ReactNode}){return <details className="help"><summary>Help</summary><p className="hint">{children}</p></details>;}

type FormProps<T>={title:string;source:T;revision:string;initial:Record<string,string>;disabled?:string;api:Api;path:string;build:(source:T,values:Record<string,string>)=>unknown;refresh:()=>Promise<unknown>;prepare?:()=>Promise<Prepared<{source:T;revision:string}>>;device?:boolean;submitLabel?:string;extra?:React.ReactNode;help?:React.ReactNode;className?:string;children:(values:Record<string,string>,change:(name:string,value:string)=>void)=>React.ReactNode};
/** A draft pins the revision it started from. With prepare, the form reads its source again just before sending and uses that read's guards while the revision still matches. An accepted result clears the draft once the refreshed source arrives, so the form is ready for the next change. A rejection keeps the draft editable. Submission, results and locks follow the shared command lifecycle. */
export function EditForm<T>({title,source,revision,initial,disabled,api,path,build,refresh,prepare,device=true,submitLabel,extra,help,className,children}:FormProps<T>){
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
 return <form className={'edit'+(className?' '+className:'')} aria-labelledby={heading} onSubmit={submit}><h3 id={heading} className={className==='inline'?'vh':undefined}>{title}</h3><fieldset disabled={!!disabled||busy||locked}>{children(values,change)}</fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}{conflict&&<p className="warning">Another client changed this setting while you were editing. Your edit is kept but won’t be sent. Discard it to see current values.</p>}<div className="actions"><button disabled={!!disabled||busy||locked||!dirty||conflict} type="submit">{submitLabel??`Apply ${title.toLowerCase()}`}</button>{locked?<button type="button" className="secondary" disabled={busy} onClick={reload}>Reload current values</button>:dirty&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setDraft(null);command.dismiss();}}>Discard my edit</button>}</div><p role="status" data-tone={tone}>{status}</p>{extra}{help&&<Help>{help}</Help>}</form>;
}
export function Select({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[]}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;}
export const options=(values:string[])=>values.map(value=>({value,label:value}));
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
/** What one device read allows, shared by every card that renders this component, on its page or in a home widget. */
export type DeviceControls={component:Component;device:Device;api:Api;refresh:Refresh;snapshot?:Snapshot;integr?:Nano|Pixoo;disabled?:string;reasons:GeneralReasons;pixooMode?:Availability['pixooMode'];path:string;supportedModes:string[];/** Tidbyt and LIFX run in the local controller host: no integration settings or advanced editor. */local:boolean;reread:Reread};
export function deviceControls(component:Component,device:Device,context:Context,api:Api,refresh:Refresh):DeviceControls{
 const snapshot=device.snapshot,integr=device.integration;
 const {disabled,reasons,pixooMode}=availability(component,device,context.control);
 const path=`/api/controllers/v1/${encodeURIComponent(component.id)}`;
 const modes=snapshot?.capabilities.modes;
 const supportedModes=modes?.supported?modes.values.filter(m=>component.kind==='nanoleaf'?['Work','Quiet','Free'].includes(m):component.kind==='pixoo'?['Monitor','Media'].includes(m):false):[];
 /** Reads the device again just before a command is sent, so the command carries that read's ticket, revision and generation. A failed read or a control that is no longer available sends nothing. */
 const reread:Reread=async pick=>{
  const latest=await refresh();
  if(!latest||latest.error)return {blocked:unreadable};
  const picked=pick(latest,availability(component,latest,context.control));
  return typeof picked==='string'?{blocked:picked}:picked;
 };
 return {component,device,api,refresh,snapshot,integr,disabled,reasons,pixooMode,path,supportedModes,local:component.kind==='tidbyt'||component.kind==='lifx',reread};
}
/** The four Nanoleaf configuration edits. A read-only device, such as the Panels (codex-nanoleaf#113), declares them unsupported, so their forms are not shown and one line names them. */
const nanoEdits=[['settings.set','integration settings'],['elements.assign','element mapping'],['task.assign','task mapping'],['project.color','project colors']] as const;
const editable=(s:Nano,op:typeof nanoEdits[number][0])=>s.capabilities[op]?.supported===true;
/** The fresh read before a configuration edit is sent applies the rendering rule: an operation the device no longer supports sends nothing. */
const nanoSource=(op:typeof nanoEdits[number][0])=>(latest:Device,a:Availability)=>a.disabled??(!nano(latest.integration)?'No integration snapshot':!editable(latest.integration,op)?'This device’s integration no longer supports this edit':{source:latest.integration,revision:latest.integration.revision});
export const hasModeControl=(d:DeviceControls)=>pixoo(d.integr)||(!!d.snapshot&&d.supportedModes.length>0);
/** The general capabilities the controller v1 snapshot does not declare, so no form is dead for lack of a capability. */
export const undeclaredCapabilities=(snapshot:Snapshot)=>(['power','brightness','media','scenes'] as const).filter(name=>!snapshot.capabilities[name].supported);
/** A one-click block inside a card: its button, the reload after an uncertain result, one short visible line, its status and its help. */
function ActionBlock({label,reason,command,onRun,note}:{label:string;reason?:string;command:CommandHandle;onRun:()=>void;note?:string}){
 return <div className="switch"><div className="actions"><button type="button" disabled={!!reason||command.busy||command.locked} onClick={onRun}>{label}</button>{command.locked&&<button type="button" className="secondary" onClick={command.unlock}>Reload current values</button>}</div>{(note||reason)&&<p className="hint">{note}{note&&reason?' ':''}{reason?`Unavailable: ${reason}.`:''}</p>}<p role="status" data-tone={command.tone}>{command.status}</p></div>;
}
/** The guidance for the action blocks; each joins its card's help so a card shows one Help line. */
const reapplyHelp=(mode:string,wall:boolean)=>`Reapply ${mode} sends ${mode} again as one mode command.${wall?` This ends any power or brightness override and reapplies ${mode}’s brightness policy.`:''}`;
const startMonitorHelp='Start Monitor sends one Monitor mode command and doesn’t start playback.';
const switchHelp=(label:string,back:string)=>`${label} is one explicit mode command through the existing mode control; returning to ${back} uses the same control.`;
/** Sending the active mode again is an explicit mode command. On Nanoleaf it ends power and brightness overrides and reapplies that mode's policy. */
function Reapply({d}:{d:DeviceControls}){
 const {snapshot,integr,supportedModes,disabled,api,path,refresh,reread,component}=d;
 const command=useCommand(api,path+'/commands',refresh,snapshot,{sameMode:true});
 const activeMode=snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:undefined;
 if(!snapshot||pixoo(integr)||!activeMode||!supportedModes.includes(activeMode))return null;
 const reason=disabled??(modePending(snapshot)?'a mode change is pending':undefined);
 return <ActionBlock label={`Reapply ${activeMode}`} reason={reason} command={command} onRun={()=>void command.run(`Reapply ${activeMode}`,()=>reread((latest,a)=>{const s=latest.snapshot;return a.disabled??(!s||s.state.desired.mode.status!=='known'||s.state.desired.mode.value!==activeMode?'the mode changed after this view loaded':modePending(s)?'a mode change is already pending':{request:makeCommand(s,{kind:'mode.set',mode:activeMode})});}))}/>;
}
/** Pixoo can be configured for Monitor without presenting it, for example after the app restarts or the screen turns off and on. Start Monitor sends the Monitor mode command again. */
function StartMonitor({d}:{d:DeviceControls}){
 const {snapshot,integr,pixooMode,disabled,api,path,refresh,reread,component}=d;
 const command=useCommand(api,path+'/integration/commands',refresh,integr);
 if(!pixoo(integr)||pixooMode?.mode!=='monitor')return null;
 if(pixooMode.participating&&!command.status&&!command.locked)return null;
 const off=snapshot?.state.desired.power.status==='known'&&!snapshot.state.desired.power.value;
 const reason=disabled??(off?screenOff:pixooMode.pending?`Pixoo is switching to ${title(pixooMode.pending)}`:undefined);
 const run=()=>void command.run('Start Monitor',()=>reread((latest,a)=>{const i=latest.integration,s=latest.snapshot;return a.disabled??(!pixoo(i)||i.configuration.mode!=='monitor'?'Pixoo is no longer set to Monitor':i.participating?'Monitor is already showing':i.pendingMode?'a mode change is pending':s?.state.desired.power.status==='known'&&!s.state.desired.power.value?screenOff:{request:pixooRequest(i,component,{operation:'mode',mode:'monitor'})});}));
 if(pixooMode.participating)return <div className="switch">{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p></div>;
 return <ActionBlock label="Start Monitor" reason={reason} command={command} onRun={run} note="Pixoo is set to Monitor but isn’t showing agent status."/>;
}
/** The explicit switch out of a status-presenting mode, through the existing mode control. Returning uses the same control. */
function SwitchToFree({d}:{d:DeviceControls}){
 const {snapshot,supportedModes,disabled,api,path,refresh,reread,component}=d;
 const command=useCommand(api,path+'/commands',refresh,snapshot);
 if(component.kind!=='nanoleaf'||!snapshot||!supportedModes.includes('Free')||snapshot.state.desired.mode.status!=='known'||snapshot.state.desired.mode.value==='Free'||modePending(snapshot))return null;
 return <ActionBlock label="Switch to Free" reason={disabled} command={command} onRun={()=>void command.run('Switch to Free',()=>reread((latest,a)=>{const s=latest.snapshot;return a.disabled??(!s||s.state.desired.mode.status!=='known'||s.state.desired.mode.value==='Free'||modePending(s)?'Nanoleaf is already in Free or switching mode':{request:makeCommand(s,{kind:'mode.set',mode:'Free'})});}))}/>;
}
function SwitchToMedia({d}:{d:DeviceControls}){
 const {integr,pixooMode,disabled,api,path,refresh,reread,component}=d;
 const command=useCommand(api,path+'/integration/commands',refresh,integr);
 if(!pixoo(integr)||!pixooMode||pixooMode.mode==='media'||pixooMode.pending)return null;
 return <ActionBlock label="Switch to Media" reason={disabled} command={command} onRun={()=>void command.run('Switch to Media',()=>reread((latest,a)=>{const i=latest.integration;return a.disabled??(!pixoo(i)||i.configuration.mode==='media'||i.pendingMode?'Pixoo is already in Media or switching mode':{request:pixooRequest(i,component,{operation:'mode',mode:'media'})});}))}/>;
}
const pixooGuidance='Monitor presents agent activity. Media opts out; collection continues. This does not start playback.';
/** The mode form. Pixoo declares no controller v1 modes, so its Monitor/Media control uses the integration extension's mode operation with that extension's guards. */
export function ModeCard({d}:{d:DeviceControls}){
 const {snapshot,integr,supportedModes,disabled,api,path,refresh,reread,component}=d;
 if(pixoo(integr))return <EditForm title="Mode" source={integr} revision={String(integr.configurationRevision)} initial={{mode:integr.configuration.mode}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>pixooRequest(s,component,{operation:'mode',mode:v.mode})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(pixoo(latest.integration)?{source:latest.integration,revision:String(latest.integration.configurationRevision)}:'No integration snapshot'))} extra={<StartMonitor d={d}/>} help={`${pixooGuidance} ${startMonitorHelp}`}>{(v,c)=><><Select label="Device mode" value={v.mode} onChange={x=>c('mode',x)} options={integr.capabilities.modes.map(m=>({value:m,label:title(m)}))}/><p className="hint">Pending mode: {integr.pendingMode?title(integr.pendingMode):'none'}.</p></>}</EditForm>;
 const activeMode=snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:undefined;
 if(snapshot&&supportedModes.length>0)return <EditForm title="Mode" source={snapshot} revision={String(snapshot.configurationRevision)} initial={{mode:snapshot.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:supportedModes[0]}} disabled={disabled} api={api} path={path+'/commands'} build={(s,v)=>makeCommand(s,{kind:'mode.set',mode:v.mode as Mode})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(latest.snapshot?{source:latest.snapshot,revision:String(latest.snapshot.configurationRevision)}:'No controller snapshot'))} extra={<Reapply d={d}/>} help={`${component.kind==='nanoleaf'?'Work participates; Quiet and Free preserve the owning controller’s policies.':pixooGuidance}${activeMode?' '+reapplyHelp(activeMode,component.kind==='nanoleaf'):''}`}>{(v,c)=><Select label="Device mode" value={v.mode} onChange={x=>c('mode',x)} options={options(supportedModes)}/>}</EditForm>;
 return null;
}
// A draft conflicts when another client changed the configuration. The generation retires output work and advances without any edit, for example on every Pixoo playlist item, so the fresh read supplies it.
const prepareGeneral=(d:DeviceControls,name:'power'|'brightness')=>()=>d.reread((latest,a)=>a.reasons[name]??(latest.snapshot?{source:latest.snapshot,revision:String(latest.snapshot.configurationRevision)}:'No controller snapshot'));
/** Power starts from the desired value, then the last observed value, then no choice at all: an unknown state is never shown as On or Off. */
export function PowerCard({d}:{d:DeviceControls}){
 const {snapshot,component,reasons,api,path,refresh}=d;
 if(!snapshot||!snapshot.capabilities.power.supported)return null;
 const pixel=component.kind==='pixoo',wall=component.kind==='nanoleaf',power=pixel?'Screen power':'Power';
 const desiredPower=snapshot.state.desired.power,observation=snapshot.state.observation;
 const observedPower=observation.status==='known'&&observation.power.status==='known'?observation.power.value:undefined;
 const initialPower=desiredPower.status==='known'?(desiredPower.value?'on':'off'):observedPower===undefined?'':observedPower?'on':'off';
 const powerNote=desiredPower.status==='known'?undefined:observedPower===undefined?'Current power is unknown; choose On or Off.':`Last read: ${observedPower?'on':'off'}, ${age(observation.status==='known'?observation.evidenceAgeMs:0)} ago.`;
 const powerOptions=(value:string)=>[...(value===''?[{value:'',label:'Choose on or off'}]:[]),{value:'on',label:'On'},{value:'off',label:'Off'}];
 return <EditForm title={power} source={snapshot} revision={String(snapshot.configurationRevision)} initial={{on:initialPower}} disabled={reasons.power} api={api} path={path+'/commands'} build={(s,v)=>makeCommand(s,{kind:'power.set',on:v.on==='on'})} refresh={refresh} prepare={prepareGeneral(d,'power')} help={pixel?'Screen off pauses playback; screen on does not resume it. Power works in Monitor and Media and does not change the mode.':wall?'Power works in Work, Quiet and Free and does not change the mode. While off, Nanoleaf keeps tracking tasks and writes nothing to this device until the next explicit mode command.':'Power does not change the device mode.'}>{(v,c)=><><Select label={power} value={v.on} onChange={x=>c('on',x)} options={powerOptions(v.on)}/>{powerNote&&<p className="hint">{powerNote}</p>}</>}</EditForm>;
}
/** The brightness draft starts from desired evidence, then observed evidence; missing evidence stays visibly unknown. On Nanoleaf a brightness command is an override until the next explicit mode command. */
export function BrightnessCard({d}:{d:DeviceControls}){
 const {snapshot,component,reasons,api,path,refresh}=d;
 if(!snapshot||!snapshot.capabilities.brightness.supported)return null;
 const brightness=snapshot.capabilities.brightness,range=brightness.supported?brightness:{minimum:0,maximum:100},draft=brightnessDraft(snapshot),wall=component.kind==='nanoleaf',override=snapshot.state.desired.brightness;
 return <EditForm title="Brightness" source={snapshot} revision={String(snapshot.configurationRevision)} initial={{percent:String(draft.value)}} disabled={reasons.brightness} api={api} path={path+'/commands'} build={(s,v)=>makeCommand(s,{kind:'brightness.set',percent:Number(v.percent)})} refresh={refresh} prepare={prepareGeneral(d,'brightness')} help="Brightness works in every mode and does not change the mode.">{(v,c)=><><label>Brightness (%)<input type="range" min={range.minimum} max={range.maximum} step={1} value={v.percent} onChange={e=>c('percent',e.target.value)}/></label><p className="hint">Selected {v.percent}% of {range.minimum}–{range.maximum}. {wall?(override.status==='known'?`Brightness override active: ${override.value}% until the next explicit mode command, which reapplies that mode’s brightness policy.`:'No brightness override is active; this device uses its mode’s brightness policy and the slider starts at a placeholder, not an observed value.'):draft.source==='unknown'?'Current brightness is unknown; the slider starts at a placeholder, not an observed value.':`Current ${draft.source} brightness is ${draft.value}%.`}</p></>}</EditForm>;
}
const actionLabels:Record<string,string>={pause:'Pause',resume:'Resume',stop:'Stop',next:'Next',previous:'Previous',clear:'Clear','restart-with-changes':'Restart with changes'};
/** Saved playlists and the declared playback actions are one-click commands; the explicit Media switch sits in the same card. */
export function MediaCard({d}:{d:DeviceControls}){
 const {snapshot,reasons,api,path,refresh,reread}=d;
 const heading=useId();
 const media=snapshot?.capabilities.media,playlists=media?.supported?media.playlistIds:[],actions:MediaAction[]=media?.supported?media.actions:[];
 const [playlistId,setPlaylistId]=useState('');const selected=playlists.includes(playlistId)?playlistId:playlists[0]??'';
 const command=useCommand(api,path+'/commands',refresh,snapshot);
 if(!snapshot||!media?.supported)return null;
 const disabled=reasons.media??(!playlists.length&&!actions.length?'No playlists or playback actions are declared':undefined);
 const declared=(s:Snapshot,cmd:Command)=>s.capabilities.media.supported&&(cmd.kind==='media.start'?s.capabilities.media.playlistIds.includes(cmd.playlistId):cmd.kind==='media.control'&&s.capabilities.media.actions.includes(cmd.action));
 const run=(label:string,cmd:Command)=>void command.run(label,()=>reread((latest,a)=>{const s=latest.snapshot;return a.reasons.media??(!s||!declared(s,cmd)?'this playlist or action is no longer declared':{request:makeCommand(s,cmd)});}));
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Media</h3><fieldset disabled={!!disabled||command.busy||command.locked}><Select label="Saved playlist" value={selected} onChange={setPlaylistId} options={playlists.length?playlists.map(id=>({value:id,label:id})):[{value:'',label:'No saved playlists declared'}]}/>{!playlists.length&&!disabled&&<p className="hint">Unavailable: Start playlist has no declared saved playlist; playback actions remain available.</p>}<div className="actions"><button type="button" disabled={!selected} onClick={()=>run('Start playlist',{kind:'media.start',playlistId:selected})}>Start playlist</button>{actions.map(action=><button key={action} type="button" className="secondary" onClick={()=>run(actionLabels[action]??action,{kind:'media.control',action})}>{actionLabels[action]??action}</button>)}</div></fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}<SwitchToMedia d={d}/>{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p><Help>Playlists are listed by controller-declared ID. Starting a playlist or a playback action does not change the mode. {switchHelp('Switch to Media','Monitor')}</Help></div>;
}
/** Saved scenes are one-click actions with a parameter: the controller-declared ID list, labelled by user-chosen names when the integration supplies them. One guarded scene command; the mode never changes as a side effect. */
export function SceneCard({d}:{d:DeviceControls}){
 const {snapshot,integr,reasons,api,path,refresh,reread}=d;
 const heading=useId();
 const scenes=snapshot?sceneOptions(snapshot,nano(integr)?integr:undefined):[];
 const [sceneId,setSceneId]=useState('');const selected=scenes.some(s=>s.value===sceneId)?sceneId:scenes[0]?.value??'';
 const command=useCommand(api,path+'/commands',refresh,snapshot);
 if(!snapshot||!snapshot.capabilities.scenes.supported)return null;
 const disabled=reasons.scenes??(!scenes.length?'No saved scenes are discovered by this controller':undefined);
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Scenes</h3><fieldset disabled={!!disabled||command.busy||command.locked}><Select label="Saved scene" value={selected} onChange={setSceneId} options={scenes.length?scenes:[{value:'',label:'No saved scenes discovered'}]}/><div className="actions"><button type="button" disabled={!selected} onClick={()=>void command.run('Activate scene',()=>reread((latest,a)=>{const s=latest.snapshot;return a.reasons.scenes??(!s||!s.capabilities.scenes.supported||!s.capabilities.scenes.sceneIds.includes(selected)?'this scene is no longer declared':{request:makeCommand(s,{kind:'scene.activate',sceneId:selected})});}))}>Activate scene</button></div></fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}<SwitchToFree d={d}/>{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p><Help>Scenes come from the controller’s discovery; names are the user-chosen Nanoleaf app names when supplied, IDs otherwise. Activating a scene is one write in Free and does not change the mode. {switchHelp('Switch to Free','Work or Quiet')}</Help></div>;
}
/** The line shown instead of lighting cards when a LIFX device has none, or nothing when it has them. */
export function lightingNote(d:DeviceControls):string|undefined{
 const lighting=d.device.lighting;
 if(!lighting)return 'Lighting controls unavailable: no lighting snapshot.';
 if(!lighting.lighting.capabilities.color&&!lighting.lighting.capabilities.temperature)return 'No lighting controls: this bulb’s model is not qualified for color or color temperature.';
}
/** LIFX color and color temperature. Each form sends one guarded `lifx-light` request through the hub's lighting route, built from a lighting read taken just before sending. Neither turns the bulb on or changes power or brightness. */
export function LightingCards({d}:{d:DeviceControls}){
 const {disabled,api,refresh,reread}=d,lighting=d.device.lighting,path=d.path+'/lighting/commands';
 if(!lighting||lightingNote(d))return null;
 const reasons=lightingReasons(lighting,disabled),observed=observedColor(lighting.lighting),source=lighting.controller,revision=String(source.configurationRevision);
 const range=lighting.lighting.capabilities.temperature??{minimum:1500,maximum:9000};
 const kelvin=observed?Math.min(range.maximum,Math.max(range.minimum,observed.kelvin)):2700;
 const prepare=(name:'color'|'temperature')=>()=>reread((latest,a)=>{const reason=lightingReasons(latest.lighting,a.disabled)[name];return reason??{source:latest.lighting!.controller,revision:String(latest.lighting!.controller.configurationRevision)};});
 return <>
 <EditForm title="Color" source={source} revision={revision} initial={{hue:String(observed?.hue??0),saturation:String(observed?.saturation??100)}} disabled={reasons.color} api={api} path={path} build={(s,v)=>lightingCommand(s,{kind:'lifx.color.set',hue:Number(v.hue),saturation:Number(v.saturation)})} refresh={refresh} prepare={prepare('color')} help={<>{observed?'The sliders start at the last color the bulb reported.':'No color has been read yet; the sliders start at a placeholder, not an observed value.'} Brightness and power stay as they are. B.U.N.N.Y. can’t see the bulb: the observed color is the last one it reported, read before any later change.</>}>{(v,c)=><><label>Hue (°)<input type="range" min={0} max={360} step={1} value={v.hue} onChange={e=>c('hue',e.target.value)}/></label><label>Saturation (%)<input type="range" min={0} max={100} step={1} value={v.saturation} onChange={e=>c('saturation',e.target.value)}/></label><p className="hint">Selected hue {v.hue}° at {v.saturation}% saturation.</p></>}</EditForm>
 <EditForm title="Color temperature" source={source} revision={revision} initial={{kelvin:String(kelvin)}} disabled={reasons.temperature} api={api} path={path} build={(s,v)=>lightingCommand(s,{kind:'lifx.temperature.set',kelvin:Number(v.kelvin)})} refresh={refresh} prepare={prepare('temperature')} help="Hue and saturation are kept, so the light looks white only at 0% saturation. Brightness and power stay as they are.">{(v,c)=><><label>Color temperature (K)<input type="range" min={range.minimum} max={range.maximum} step={1} value={v.kelvin} onChange={e=>c('kelvin',e.target.value)}/></label><p className="hint">Selected {v.kelvin} K of {range.minimum}–{range.maximum} K.</p></>}</EditForm>
 </>;
}
/** The Nanoleaf assignments panel: layout style and coverage, element assignments, task mappings and project colors, in one place. Each form sends one guarded integration command. */
export function NanoAssignments({d,integration:s}:{d:DeviceControls;integration:Nano}){
 const {disabled,api,path,refresh,reread}=d;
 const heading=useId();
 const [elementId,setElementId]=useState(''),[taskId,setTaskId]=useState(''),[projectId,setProjectId]=useState('');
 const element=s.elements.some(e=>e.id===elementId)?elementId:s.elements[0]?.id??'',task=s.tasks.some(t=>t.id===taskId)?taskId:s.tasks[0]?.id??'',project=s.projects.some(p=>p.id===projectId)?projectId:s.projects[0]?.id??'';
 const projects=[{value:'',label:'Shared pool'},...s.projects.map(p=>({value:p.id,label:p.id}))];
 const base={source:s,revision:s.revision,api,path:path+'/integration/commands',refresh};
 const command=(state:Nano,cmd:unknown)=>({apiVersion:state.apiVersion,controllerId:state.identity.controllerId,deviceId:state.identity.deviceId,requestId:state.nextRequestId,expectedRevision:state.revision,command:cmd});
 const unsupported=nanoEdits.filter(([op])=>!editable(s,op)).map(([,name])=>name),any=unsupported.length<nanoEdits.length;
 return <div className="panel" role="group" aria-labelledby={heading}><h3 id={heading}>Assignments</h3><p className="hint">Session source: {s.source}.{any?' Mappings use controller-declared neutral identifiers.':''}</p>{any&&<div className="cards">
 {editable(s,'settings.set')&&<EditForm {...base} title="Integration settings" initial={{style:s.settings.style??'classic',coverage:s.settings.coverage??'whole'}} disabled={disabled} build={(state,v)=>({apiVersion:state.apiVersion,controllerId:state.identity.controllerId,deviceId:state.identity.deviceId,requestId:state.nextRequestId,expectedRevision:state.revision,command:{kind:'settings.set',style:v.style,coverage:v.coverage}})} prepare={()=>reread(nanoSource('settings.set'))}>{(v,c)=><><Select label="Layout style" value={v.style} onChange={x=>c('style',x)} options={options(['classic','project'])}/><Select label="Coverage" value={v.coverage} onChange={x=>c('coverage',x)} options={options(['whole','status'])}/></>}</EditForm>}
 {editable(s,'elements.assign')&&<div className="stack"><Select label="Element" value={element} onChange={setElementId} options={options(s.elements.map(e=>e.id))}/>{!s.elements.length&&<p className="hint">No elements declared.</p>}
 {s.elements.map(e=><div key={e.id} hidden={element!==e.id}><EditForm {...base} prepare={()=>reread(nanoSource('elements.assign'))} title="Element mapping" initial={{project:e.projectId??'',signature:String(e.signature)}} disabled={disabled} build={(state,v)=>command(state,{kind:'elements.assign',elements:[{id:e.id,projectId:v.project||null,signature:Number(v.signature)}]})}>{(v,c)=><><Select label="Element project" value={v.project} onChange={x=>c('project',x)} options={projects}/><Select label="Signature" value={v.signature} onChange={x=>c('signature',x)} options={[{value:'0',label:'Off'},{value:'1',label:'On'}]}/><p className="hint">Current assignment: {e.projectId??'Shared pool'}; signature {e.signature?'on':'off'}.</p></>}</EditForm></div>)}</div>}
 {editable(s,'task.assign')&&<div className="stack"><Select label="Task" value={task} onChange={setTaskId} options={options(s.tasks.map(t=>t.id))}/>{!s.tasks.length&&<p className="hint">No tasks declared.</p>}
 {s.tasks.map(t=><div key={t.id} hidden={task!==t.id}><EditForm {...base} prepare={()=>reread(nanoSource('task.assign'))} title="Task mapping" initial={{project:t.overrideProjectId??''}} disabled={disabled} build={(state,v)=>command(state,{kind:'task.assign',taskId:t.id,projectId:v.project||null})}>{(v,c)=><><Select label="Task project" value={v.project} onChange={x=>c('project',x)} options={[{value:'',label:'No override'},...projects.slice(1)]}/><p className="hint">Current override: {t.overrideProjectId??'None'}; source project: {t.projectId??'Unknown'}.</p></>}</EditForm></div>)}</div>}
 {editable(s,'project.color')&&<div className="stack"><Select label="Color project" value={project} onChange={setProjectId} options={projects.slice(1)}/>{!s.projects.length&&<p className="hint">No projects declared.</p>}
 {s.projects.map(p=><div key={p.id} hidden={project!==p.id}><EditForm {...base} prepare={()=>reread(nanoSource('project.color'))} title="Project color" initial={{color:p.color}} disabled={disabled} build={(state,v)=>command(state,{kind:'project.color',projectId:p.id,color:v.color})}>{(v,c)=><label>Color<input type="color" value={v.color} onChange={e=>c('color',e.target.value)}/></label>}</EditForm></div>)}</div>}
 </div>}{unsupported.length>0&&<p className="hint undeclared">Not supported by this device’s integration: {listed(unsupported)}.</p>}</div>;
}
/** The Pixoo Monitor panel: the filters and cadence of the agent-status view, sent as one guarded view operation. */
export function PixooMonitor({d,integration:integr,sessions}:{d:DeviceControls;integration:Pixoo;sessions:SessionSnapshot[]}){
 const {component,disabled,api,path,refresh,reread}=d;
 const heading=useId();
 return <div className="panel" role="group" aria-labelledby={heading}><h3 id={heading}>Monitor</h3><EditForm title="Monitor view" className="wide" source={integr} revision={String(integr.configurationRevision)} initial={{q:integr.configuration.filter.q??'',provider:integr.configuration.filter.provider??'',projectId:integr.configuration.filter.projectId??'',session:integr.configuration.filter.session?JSON.stringify(integr.configuration.filter.session):'',cadence:String(integr.configuration.cadenceMs)}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>({apiVersion:s.apiVersion,controllerId:component.controllerId,deviceId:component.deviceId,requestId:s.nextRequestId,expectedConfigurationRevision:s.configurationRevision,expectedGeneration:s.generation,action:{operation:'view',filter:{...(v.q?{q:v.q}:{}),...(v.provider?{provider:v.provider}:{}),...(v.projectId?{projectId:v.projectId}:{}),...(v.session?{session:JSON.parse(v.session)}:{})},cadenceMs:Number(v.cadence)}})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(pixoo(latest.integration)?{source:latest.integration,revision:String(latest.integration.configurationRevision)}:'No integration snapshot'))} help="Filters can produce an empty monitor view.">{(v,c)=><><label>Label / ID filter<input maxLength={120} value={v.q} onChange={e=>c('q',e.target.value)}/></label><Select label="Monitor provider" value={v.provider} onChange={x=>c('provider',x)} options={[{value:'',label:'All providers'},...options(['codex','claude'])]}/><label>Project ID<input maxLength={128} pattern="[A-Za-z0-9_.-]*" value={v.projectId} onChange={e=>c('projectId',e.target.value)}/></label><Select label="Monitor session" value={v.session} onChange={x=>c('session',x)} options={[{value:'',label:'All sessions'},...(v.session&&!sessions.some(s=>JSON.stringify(s.identity)===v.session)?[{value:v.session,label:'Previously selected session'}]:[]),...sessions.map(s=>({value:JSON.stringify(s.identity),label:s.label??s.identity.sessionId}))]}/><label>Update interval (ms)<input type="number" min={integr.capabilities.minimumCadenceMs} max={integr.capabilities.maximumCadenceMs} step="1" value={v.cadence} onChange={e=>c('cadence',e.target.value)}/></label><p className="hint">Participation: {integr.participating?'yes':'no'}; source: {integr.sourceConnection}.</p></>}</EditForm></div>;
}
