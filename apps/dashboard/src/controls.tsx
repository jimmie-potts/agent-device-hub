import React, {useCallback,useEffect,useId,useReducer,useRef,useState,useSyncExternalStore} from 'react';
import type {Snapshot as StateSnapshot,SessionSnapshot} from '../../../packages/agent-state/src/types';
import type {Snapshot,Mode,Command,MediaAction} from '../../../packages/contracts/src/types';
import {Api,type ReceiptEvidence,makeCommand,generalReasons,brightnessDraft,sceneOptions,nanoleafContentReason,lightingCommand,lightingReasons,observedColor,type Lighting,type GeneralReasons,type Context,type Component} from './client';
import type {GeometryRead} from './art/nanoleaf';
import {actionWording,blocked,commandTransition,formWording,initialCommand,runCommand,unreadable,type Attempt,type CommandEvent,type CommandState,type Prepared,type ResultOptions} from './lifecycle';

export type Monitor={snapshot:StateSnapshot;nextRequestId:string;ownerId:string};
export type Nano={apiVersion:string;identity:Snapshot['identity'];revision:string;configurationRevision:number;mode:string;settings:{style?:string;coverage?:string};source:string;projects:{id:string;color:string}[];tasks:{id:string;projectId:string|null;overrideProjectId:string|null}[];elements:{id:string;projectId:string|null;signature:number}[];pending:unknown[];wallPending:unknown;outcomes:{requestId:{epoch:string;sequence:number};outcome:string;failure?:{code:string}}[];nextRequestId:{epoch:string;sequence:number};scenes?:{id:string;name?:string}[];capabilities:Record<string,{supported:boolean}>};
export type Pixoo={apiVersion:string;identity:{controllerId:string;deviceId:string};configurationRevision:number;generation:number;nextRequestId:string;configuration:{mode:string;filter:{q?:string;provider?:string;projectId?:string;session?:SessionSnapshot['identity']};cadenceMs:number};pendingMode:string|null;sourceConnection:string;participating:boolean;inFlight:number;lastOutcome:null|{status:string;code?:string};capabilities:{modes:string[];filters:string[];minimumCadenceMs:number;maximumCadenceMs:number}};
/** A LIFX device keeps its lighting snapshot; its controller part is the device's snapshot. */
export type Device={snapshot?:Snapshot;integration?:Nano|Pixoo;lighting?:Lighting;error?:string;received?:number;busy?:boolean;
 /** Nanoleaf only: the saved element geometry for the shared device art, read once per session after the first poll and again only after a non-final failure (Hub #355). */
 geometry?:GeometryRead};
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
/** Lifecycle state shared by every instance of one control, keyed by component and control. The home widget and the component page render the same control twice, so a running command, a watched ticket and an uncertain lock on one instance are the same on the other, and neither instance can send while the other is busy. */
type SharedLifecycle={state:CommandState;running:boolean;listeners:Set<()=>void>};
const sharedLifecycles=new Map<string,SharedLifecycle>();
const sharedLifecycle=(key:string)=>{let entry=sharedLifecycles.get(key);if(!entry){entry={state:initialCommand,running:false,listeners:new Set()};sharedLifecycles.set(key,entry);}return entry;};
/** Forgets every shared control state: called when the dashboard unmounts, so one session's locks, tickets and status never show in the next. */
export const resetLifecycles=()=>sharedLifecycles.clear();
const noSubscription=()=>()=>{};
/** The one command lifecycle behind draft forms and one-click actions. Each activation sends at most one request, built by the caller from a fresh read. The control stays busy until the refreshed view arrives. Only an accepted ticket is watched for its terminal outcome. An uncertain or partial result, including one observed later, locks the control until the user reloads current values. Nothing is resubmitted automatically. With a key, the state is shared by every mounted instance of that control. */
export function useCommandLifecycle(source:unknown,options:ResultOptions,key?:string){
 const [local,dispatchLocal]=useReducer(commandTransition,initialCommand);
 const shared=key?sharedLifecycle(key):undefined;
 const subscribe=useCallback((listener:()=>void)=>{if(!shared)return noSubscription();shared.listeners.add(listener);return ()=>{shared.listeners.delete(listener);};},[shared]);
 const sharedState=useSyncExternalStore(subscribe,()=>shared?.state??initialCommand);
 const state=shared?sharedState:local;
 const dispatch=(event:CommandEvent)=>{if(shared){shared.state=commandTransition(shared.state,event);shared.listeners.forEach(listener=>listener());}else dispatchLocal(event);};
 // A second activation can arrive before React re-renders the disabled control.
 const running=useRef(false);
 const isRunning=()=>shared?shared.running:running.current,setRunning=(value:boolean)=>{if(shared)shared.running=value;else running.current=value;};
 const keepFocus=useRestoredFocus(state.busy);
 useEffect(()=>dispatch({type:'observed',source,options}),[source,state.watching,options.device,options.sameMode]);
 async function run(attempt:Omit<Attempt,'options'>){
  if(isRunning()||(shared?shared.state.locked:state.locked))return;
  setRunning(true);keepFocus();
  try{await runCommand({...attempt,options},dispatch);}finally{setRunning(false);dispatch({type:'finish'});}
 }
 return {...state,run,reload:(refresh:()=>Promise<unknown>)=>{dispatch({type:'reload'});void refresh().catch(()=>{});},dismiss:()=>dispatch({type:'dismiss'})};
}
/** One-click commands read the device again just before sending and carry that read's guards. A rejection leaves the action available for another explicit press. */
export function useCommand(api:Api,path:string,refresh:()=>Promise<unknown>,source:unknown,options:{sameMode?:boolean}={},key?:string){
 const command=useCommandLifecycle(source,options,key);
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

type FormProps<T>={title:string;source:T;initial:Record<string,string>;disabled?:string;api:Api;path:string;build:(source:T,values:Record<string,string>)=>unknown;refresh:()=>Promise<unknown>;prepare?:()=>Promise<Prepared<{source:T;revision:string}>>;device?:boolean;extra?:React.ReactNode;help?:React.ReactNode;className?:string;/** Shares the lifecycle with every other instance of this control. */lifecycleKey?:string;children:(field:Field)=>React.ReactNode};
/** How a form's fields send. `set` sends the change at once (selects and toggles). `adjust` keeps it as a draft until `settle` (a slider or picker released, a text field left or submitted) or `settleSoon` (a keyboard step, after a short pause) sends it. Every send is one guarded command built from a fresh read. */
export type Field={values:Record<string,string>;set:(name:string,value:string)=>void;adjust:(name:string,value:string)=>void;settle:()=>void;settleSoon:()=>void};
const settleDelay=300;
/** A form with no Apply button: a change is sent as soon as its gesture settles, with the guards of a read taken just before sending. The control shows the current value again once the result and the refreshed source arrive, so a rejected change is visible as the unchanged value plus its status. Submission, results and locks follow the shared command lifecycle; an uncertain result locks the form until an explicit reload. */
export function EditForm<T>({title,source,initial,disabled,api,path,build,refresh,prepare,device=true,extra,help,className,lifecycleKey,children}:FormProps<T>){
 const heading=useId();
 const [draft,setDraft]=useState<Record<string,string>|null>(null);
 const command=useCommandLifecycle(source,{device},lifecycleKey),{status,tone,busy,locked}=command;
 const values=draft??initial;
 const latest=useRef(values);latest.current=values;
 const pending=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 function send(next:Record<string,string>){
  clearTimeout(timer.current);pending.current=false;
  if(disabled||busy||locked){setDraft(null);return;}
  void command.run({wording:formWording,refresh,send:request=>api.request<ReceiptEvidence>(path,request),
   prepare:async()=>{
    if(!prepare)return {request:build(source,next)};
    const fresh=await prepare();
    return blocked(fresh)?fresh:{request:build(fresh.source,next)};
   },
   // Only the draft that was sent clears; a field edited meanwhile in the same form keeps its value.
   settled:()=>{if(latest.current===next)setDraft(null);}});
 }
 const change=(name:string,value:string)=>{const next={...latest.current,[name]:value};latest.current=next;pending.current=true;setDraft(next);return next;};
 const settle=()=>{if(pending.current)send(latest.current);};
 const field:Field={values,set:(name,value)=>send(change(name,value)),adjust:change,settle,settleSoon:()=>{clearTimeout(timer.current);timer.current=setTimeout(settle,settleDelay);}};
 function reload(){setDraft(null);command.reload(refresh);}
 return <form className={'edit'+(className?' '+className:'')} aria-labelledby={heading} onSubmit={e=>{e.preventDefault();settle();}}><h3 id={heading} className={className==='inline'?'vh':undefined}>{title}</h3><fieldset disabled={!!disabled||busy||locked}>{children(field)}</fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}{locked&&<div className="actions"><button type="button" className="secondary" disabled={busy} onClick={reload}>Reload current values</button></div>}<p role="status" data-tone={tone}>{status}</p>{extra}{help&&<Help>{help}</Help>}</form>;
}
/** A text or number field that sends when it is left or when Enter is pressed, and only while the browser's own constraints (pattern, range, required) hold. */
export function TextField({label,name,field,...rest}:{label:string;name:string;field:Field}&Omit<React.InputHTMLAttributes<HTMLInputElement>,'name'|'value'|'onChange'|'onBlur'|'onKeyDown'>){
 return <label>{label}<input {...rest} value={field.values[name]} onChange={e=>field.adjust(name,e.target.value)} onBlur={e=>{if(e.currentTarget.checkValidity())field.settle();}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(e.currentTarget.reportValidity())field.settle();}}}/></label>;
}
/** A slider sends once when the pointer releases it, or after a pause when it is stepped from the keyboard or set by a script; a drag never sends mid-gesture. A color picker sends on its native change event, which fires when the picker closes. */
export function RangeField({label,name,field,...rest}:{label:string;name:string;field:Field}&Omit<React.InputHTMLAttributes<HTMLInputElement>,'name'|'value'|'onChange'>){
 const pointer=useRef(false),input=useRef<HTMLInputElement>(null),latest=useRef(field);latest.current=field;
 const picker=rest.type==='color';
 useEffect(()=>{const el=input.current;if(!el||!picker)return;const changed=()=>latest.current.settle();el.addEventListener('change',changed);return ()=>el.removeEventListener('change',changed);},[picker]);
 const release=()=>{pointer.current=false;field.settle();};
 return <label>{label}<input {...rest} ref={input} value={field.values[name]} onChange={e=>{field.adjust(name,e.target.value);if(!pointer.current&&!picker)field.settleSoon();}} onPointerDown={()=>{pointer.current=true;}} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyUp={picker?undefined:field.settleSoon}/></label>;
}
/** A select reports a pointer choice at once. A keyboard step changes only what it shows until the user pauses, presses Enter or leaves it, so arrowing through the options reports the one the user stops on. */
export function Select({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[]}){
 const [draft,setDraft]=useState<string|null>(null);
 const keyboard=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const commit=(next:string)=>{clearTimeout(timer.current);setDraft(null);if(next!==value)onChange(next);};
 return <label>{label}<select value={draft??value} onPointerDown={()=>{keyboard.current=false;}} onKeyDown={e=>{keyboard.current=true;if(e.key==='Enter'&&draft!==null){e.preventDefault();commit(draft);}}} onChange={e=>{const next=e.target.value;if(!keyboard.current){commit(next);return;}setDraft(next);clearTimeout(timer.current);timer.current=setTimeout(()=>commit(next),settleDelay);}} onBlur={()=>{if(draft!==null)commit(draft);}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
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
 const command=useCommand(api,path+'/commands',refresh,snapshot,{sameMode:true},component.id+':reapply');
 const activeMode=snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:undefined;
 if(!snapshot||pixoo(integr)||!activeMode||!supportedModes.includes(activeMode))return null;
 const reason=disabled??(modePending(snapshot)?'a mode change is pending':undefined);
 return <ActionBlock label={`Reapply ${activeMode}`} reason={reason} command={command} onRun={()=>void command.run(`Reapply ${activeMode}`,()=>reread((latest,a)=>{const s=latest.snapshot;return a.disabled??(!s||s.state.desired.mode.status!=='known'||s.state.desired.mode.value!==activeMode?'the mode changed after this view loaded':modePending(s)?'a mode change is already pending':{request:makeCommand(s,{kind:'mode.set',mode:activeMode})});}))}/>;
}
/** Pixoo can be configured for Monitor without presenting it, for example after the app restarts or the screen turns off and on. Start Monitor sends the Monitor mode command again. */
function StartMonitor({d}:{d:DeviceControls}){
 const {snapshot,integr,pixooMode,disabled,api,path,refresh,reread,component}=d;
 const command=useCommand(api,path+'/integration/commands',refresh,integr,{},component.id+':start-monitor');
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
 const command=useCommand(api,path+'/commands',refresh,snapshot,{},component.id+':switch-free');
 if(component.kind!=='nanoleaf'||!snapshot||!supportedModes.includes('Free')||snapshot.state.desired.mode.status!=='known'||snapshot.state.desired.mode.value==='Free'||modePending(snapshot))return null;
 return <ActionBlock label="Switch to Free" reason={disabled} command={command} onRun={()=>void command.run('Switch to Free',()=>reread((latest,a)=>{const s=latest.snapshot;return a.disabled??(!s||s.state.desired.mode.status!=='known'||s.state.desired.mode.value==='Free'||modePending(s)?'Nanoleaf is already in Free or switching mode':{request:makeCommand(s,{kind:'mode.set',mode:'Free'})});}))}/>;
}
function SwitchToMedia({d}:{d:DeviceControls}){
 const {integr,pixooMode,disabled,api,path,refresh,reread,component}=d;
 const command=useCommand(api,path+'/integration/commands',refresh,integr,{},component.id+':switch-media');
 if(!pixoo(integr)||!pixooMode||pixooMode.mode==='media'||pixooMode.pending)return null;
 return <ActionBlock label="Switch to Media" reason={disabled} command={command} onRun={()=>void command.run('Switch to Media',()=>reread((latest,a)=>{const i=latest.integration;return a.disabled??(!pixoo(i)||i.configuration.mode==='media'||i.pendingMode?'Pixoo is already in Media or switching mode':{request:pixooRequest(i,component,{operation:'mode',mode:'media'})});}))}/>;
}
const pixooGuidance='Monitor presents agent activity. Media opts out; collection continues. This does not start playback.';
/** The mode form. Pixoo declares no controller v1 modes, so its Monitor/Media control uses the integration extension's mode operation with that extension's guards. */
export function ModeCard({d}:{d:DeviceControls}){
 const {snapshot,integr,supportedModes,disabled,api,path,refresh,reread,component}=d;
 if(pixoo(integr))return <EditForm title="Mode" lifecycleKey={component.id+':mode'} source={integr} initial={{mode:integr.configuration.mode}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>pixooRequest(s,component,{operation:'mode',mode:v.mode})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(pixoo(latest.integration)?{source:latest.integration,revision:String(latest.integration.configurationRevision)}:'No integration snapshot'))} extra={<StartMonitor d={d}/>} help={`${pixooGuidance} ${startMonitorHelp}`}>{f=><><Select label="Device mode" value={f.values.mode} onChange={x=>f.set('mode',x)} options={integr.capabilities.modes.map(m=>({value:m,label:title(m)}))}/><p className="hint">Pending mode: {integr.pendingMode?title(integr.pendingMode):'none'}.</p></>}</EditForm>;
 const activeMode=snapshot?.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:undefined;
 if(snapshot&&supportedModes.length>0)return <EditForm title="Mode" lifecycleKey={component.id+':mode'} source={snapshot} initial={{mode:snapshot.state.desired.mode.status==='known'?snapshot.state.desired.mode.value:supportedModes[0]}} disabled={disabled} api={api} path={path+'/commands'} build={(s,v)=>makeCommand(s,{kind:'mode.set',mode:v.mode as Mode})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(latest.snapshot?{source:latest.snapshot,revision:String(latest.snapshot.configurationRevision)}:'No controller snapshot'))} extra={<Reapply d={d}/>} help={`${component.kind==='nanoleaf'?'Work participates; Quiet and Free preserve the owning controller’s policies.':pixooGuidance}${activeMode?' '+reapplyHelp(activeMode,component.kind==='nanoleaf'):''}`}>{f=><Select label="Device mode" value={f.values.mode} onChange={x=>f.set('mode',x)} options={options(supportedModes)}/>}</EditForm>;
 return null;
}
// A draft conflicts when another client changed the configuration. The generation retires output work and advances without any edit, for example on every Pixoo playlist item, so the fresh read supplies it.
const prepareGeneral=(d:DeviceControls,name:'power'|'brightness')=>()=>d.reread((latest,a)=>a.reasons[name]??(latest.snapshot?{source:latest.snapshot,revision:String(latest.snapshot.configurationRevision)}:'No controller snapshot'));
/** Power is one button that names the action: Turn off while the device is on and Turn on while it is off. The current value comes from the desired state, then the last observed value; when both are unknown the card offers both buttons, so an unknown state is never shown as On or Off. */
export function PowerCard({d}:{d:DeviceControls}){
 const {snapshot,component,reasons,api,path,refresh,reread}=d;
 const heading=useId();
 const command=useCommand(api,path+'/commands',refresh,snapshot,{},component.id+':power');
 if(!snapshot||!snapshot.capabilities.power.supported)return null;
 const pixel=component.kind==='pixoo',wall=component.kind==='nanoleaf',power=pixel?'Screen power':'Power';
 const desiredPower=snapshot.state.desired.power,observation=snapshot.state.observation;
 const observedPower=observation.status==='known'&&observation.power.status==='known'?observation.power.value:undefined;
 const current=desiredPower.status==='known'?desiredPower.value:observedPower;
 const note=desiredPower.status==='known'?`${power} is ${current?'on':'off'}.`:observedPower===undefined?'Current power is unknown; press Turn on or Turn off.':`Last read: ${observedPower?'on':'off'}, ${age(observation.status==='known'?observation.evidenceAgeMs:0)} ago.`;
 const run=(on:boolean)=>void command.run(on?'Turn on':'Turn off',()=>reread((latest,a)=>a.reasons.power??(latest.snapshot?{request:makeCommand(latest.snapshot,{kind:'power.set',on})}:'No controller snapshot')));
 const choices=current===undefined?[true,false]:[!current];
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>{power}</h3><fieldset disabled={!!reasons.power||command.busy||command.locked}><p className="hint">{note}</p><div className="actions">{choices.map(on=><button key={String(on)} type="button" className={on?undefined:'secondary'} onClick={()=>run(on)}>{on?'Turn on':'Turn off'}</button>)}</div></fieldset>{reasons.power&&<p className="hint">Unavailable: {reasons.power}</p>}{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p><Help>{pixel?'Screen off pauses playback; screen on does not resume it. Power works in Monitor and Media and does not change the mode.':wall?'Power works in Work, Quiet and Free and does not change the mode. While off, Nanoleaf keeps tracking tasks and writes nothing to this device until the next explicit mode command.':'Power does not change the device mode.'}</Help></div>;
}
/** The brightness draft starts from desired evidence, then observed evidence; missing evidence stays visibly unknown. On Nanoleaf a brightness command is an override until the next explicit mode command. */
export function BrightnessCard({d}:{d:DeviceControls}){
 const {snapshot,component,reasons,api,path,refresh}=d;
 if(!snapshot||!snapshot.capabilities.brightness.supported)return null;
 const brightness=snapshot.capabilities.brightness,range=brightness.supported?brightness:{minimum:0,maximum:100},draft=brightnessDraft(snapshot),wall=component.kind==='nanoleaf',override=snapshot.state.desired.brightness;
 return <EditForm title="Brightness" lifecycleKey={component.id+':brightness'} source={snapshot} initial={{percent:String(draft.value)}} disabled={reasons.brightness} api={api} path={path+'/commands'} build={(s,v)=>makeCommand(s,{kind:'brightness.set',percent:Number(v.percent)})} refresh={refresh} prepare={prepareGeneral(d,'brightness')} help="Brightness works in every mode and does not change the mode. The slider sends once when it is released.">{f=><><RangeField label="Brightness (%)" name="percent" field={f} type="range" min={range.minimum} max={range.maximum} step={1}/><p className="hint">Selected {f.values.percent}% of {range.minimum}–{range.maximum}. {wall?(override.status==='known'?`Brightness override active: ${override.value}% until the next explicit mode command, which reapplies that mode’s brightness policy.`:'No brightness override is active; this device uses its mode’s brightness policy and the slider starts at a placeholder, not an observed value.'):draft.source==='unknown'?'Current brightness is unknown; the slider starts at a placeholder, not an observed value.':`Current ${draft.source} brightness is ${draft.value}%.`}</p></>}</EditForm>;
}
const actionLabels:Record<string,string>={pause:'Pause',resume:'Resume',stop:'Stop',next:'Next',previous:'Previous',clear:'Clear','restart-with-changes':'Restart with changes'};
/** Saved playlists and the declared playback actions are one-click commands; the explicit Media switch sits in the same card. */
export function MediaCard({d}:{d:DeviceControls}){
 const {snapshot,reasons,api,path,refresh,reread,component}=d;
 const heading=useId();
 const media=snapshot?.capabilities.media,playlists=media?.supported?media.playlistIds:[],actions:MediaAction[]=media?.supported?media.actions:[];
 const [playlistId,setPlaylistId]=useState('');
 const command=useCommand(api,path+'/commands',refresh,snapshot,{},component.id+':media');
 if(!snapshot||!media?.supported)return null;
 const disabled=reasons.media??(!playlists.length&&!actions.length?'No playlists or playback actions are declared':undefined);
 const declared=(s:Snapshot,cmd:Command)=>s.capabilities.media.supported&&(cmd.kind==='media.start'?s.capabilities.media.playlistIds.includes(cmd.playlistId):cmd.kind==='media.control'&&s.capabilities.media.actions.includes(cmd.action));
 const run=(label:string,cmd:Command)=>command.run(label,()=>reread((latest,a)=>{const s=latest.snapshot;return a.reasons.media??(!s||!declared(s,cmd)?'this playlist or action is no longer declared':{request:makeCommand(s,cmd)});}));
 // Choosing a playlist starts it; the choice clears once the command settles, so the same playlist can be started again.
 const start=(id:string)=>{setPlaylistId(id);if(id)void run('Start playlist',{kind:'media.start',playlistId:id}).finally(()=>setPlaylistId(''));};
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Media</h3><fieldset disabled={!!disabled||command.busy||command.locked}><Select label="Saved playlist" value={playlistId} onChange={start} options={playlists.length?[{value:'',label:'Choose a playlist to start'},...playlists.map(id=>({value:id,label:id}))]:[{value:'',label:'No saved playlists declared'}]}/>{!playlists.length&&!disabled&&<p className="hint">Unavailable: no declared saved playlist to start; playback actions remain available.</p>}<div className="actions">{actions.map(action=><button key={action} type="button" className="secondary" onClick={()=>void run(actionLabels[action]??action,{kind:'media.control',action})}>{actionLabels[action]??action}</button>)}</div></fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}<SwitchToMedia d={d}/>{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p><Help>Playlists are listed by controller-declared ID; choosing one starts it. Starting a playlist or a playback action does not change the mode. {switchHelp('Switch to Media','Monitor')}</Help></div>;
}
/** Saved scenes are one-click actions with a parameter: the controller-declared ID list, labelled by user-chosen names when the integration supplies them. One guarded scene command; the mode never changes as a side effect. */
export function SceneCard({d}:{d:DeviceControls}){
 const {snapshot,integr,reasons,api,path,refresh,reread,component}=d;
 const heading=useId();
 const scenes=snapshot?sceneOptions(snapshot,nano(integr)?integr:undefined):[];
 const [sceneId,setSceneId]=useState('');
 const command=useCommand(api,path+'/commands',refresh,snapshot,{},component.id+':scenes');
 if(!snapshot||!snapshot.capabilities.scenes.supported)return null;
 const disabled=reasons.scenes??(!scenes.length?'No saved scenes are discovered by this controller':undefined);
 // Choosing a scene activates it; the choice clears once the command settles, so the same scene can be activated again.
 const activate=(id:string)=>{setSceneId(id);if(id)void command.run('Activate scene',()=>reread((latest,a)=>{const s=latest.snapshot;return a.reasons.scenes??(!s||!s.capabilities.scenes.supported||!s.capabilities.scenes.sceneIds.includes(id)?'this scene is no longer declared':{request:makeCommand(s,{kind:'scene.activate',sceneId:id})});})).finally(()=>setSceneId(''));};
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Scenes</h3><fieldset disabled={!!disabled||command.busy||command.locked}><Select label="Saved scene" value={sceneId} onChange={activate} options={scenes.length?[{value:'',label:'Choose a scene to activate'},...scenes]:[{value:'',label:'No saved scenes discovered'}]}/></fieldset>{disabled&&<p className="hint">Unavailable: {disabled}</p>}<SwitchToFree d={d}/>{command.locked&&<div className="actions"><button type="button" className="secondary" onClick={command.unlock}>Reload current values</button></div>}<p role="status" data-tone={command.tone}>{command.status}</p><Help>Scenes come from the controller’s discovery; names are the user-chosen Nanoleaf app names when supplied, IDs otherwise. Choosing a scene activates it: one write in Free that does not change the mode. {switchHelp('Switch to Free','Work or Quiet')}</Help></div>;
}
/** The line shown instead of lighting cards when a LIFX device has none, or nothing when it has them. */
export function lightingNote(d:DeviceControls):string|undefined{
 const lighting=d.device.lighting;
 if(!lighting)return 'Lighting controls unavailable: no lighting snapshot.';
 if(!lighting.lighting.capabilities.color&&!lighting.lighting.capabilities.temperature)return 'No lighting controls: this bulb’s model is not qualified for color or color temperature.';
}
/** LIFX color and color temperature. Each form sends one guarded `lifx-light` request through the hub's lighting route, built from a lighting read taken just before sending. Neither turns the bulb on or changes power or brightness. */
export function LightingCards({d}:{d:DeviceControls}){
 const {disabled,api,refresh,reread,component}=d,lighting=d.device.lighting,path=d.path+'/lighting/commands';
 if(!lighting||lightingNote(d))return null;
 const reasons=lightingReasons(lighting,disabled),observed=observedColor(lighting.lighting),source=lighting.controller,revision=String(source.configurationRevision);
 const range=lighting.lighting.capabilities.temperature??{minimum:1500,maximum:9000};
 const kelvin=observed?Math.min(range.maximum,Math.max(range.minimum,observed.kelvin)):2700;
 const prepare=(name:'color'|'temperature')=>()=>reread((latest,a)=>{const reason=lightingReasons(latest.lighting,a.disabled)[name];return reason??{source:latest.lighting!.controller,revision:String(latest.lighting!.controller.configurationRevision)};});
 return <>
 <EditForm title="Color" lifecycleKey={component.id+':color'} source={source} initial={{hue:String(observed?.hue??0),saturation:String(observed?.saturation??100)}} disabled={reasons.color} api={api} path={path} build={(s,v)=>lightingCommand(s,{kind:'lifx.color.set',hue:Number(v.hue),saturation:Number(v.saturation)})} refresh={refresh} prepare={prepare('color')} help={<>{observed?'The sliders start at the last color the bulb reported.':'No color has been read yet; the sliders start at a placeholder, not an observed value.'} Each slider sends once when it is released. Brightness and power stay as they are. B.U.N.N.Y. can’t see the bulb: the observed color is the last one it reported, read before any later change.</>}>{f=><><RangeField label="Hue (°)" name="hue" field={f} type="range" min={0} max={360} step={1}/><RangeField label="Saturation (%)" name="saturation" field={f} type="range" min={0} max={100} step={1}/><p className="hint">Selected hue {f.values.hue}° at {f.values.saturation}% saturation.</p></>}</EditForm>
 <EditForm title="Color temperature" lifecycleKey={component.id+':temperature'} source={source} initial={{kelvin:String(kelvin)}} disabled={reasons.temperature} api={api} path={path} build={(s,v)=>lightingCommand(s,{kind:'lifx.temperature.set',kelvin:Number(v.kelvin)})} refresh={refresh} prepare={prepare('temperature')} help="Hue and saturation are kept, so the light looks white only at 0% saturation. Brightness and power stay as they are.">{f=><><RangeField label="Color temperature (K)" name="kelvin" field={f} type="range" min={range.minimum} max={range.maximum} step={1}/><p className="hint">Selected {f.values.kelvin} K of {range.minimum}–{range.maximum} K.</p></>}</EditForm>
 </>;
}
/** The Nanoleaf assignments panel: layout style and coverage, element assignments, task mappings and project colors, in one place. Each form sends one guarded integration command. */
export function NanoAssignments({d,integration:s,picked,onPick}:{d:DeviceControls;integration:Nano;/** The element chosen in the shared device art, when a page supplies one. */picked?:string;onPick?:(id:string)=>void}){
 const {disabled,api,path,refresh,reread,component}=d;
 const heading=useId();
 const [ownElement,setOwnElement]=useState(''),[taskId,setTaskId]=useState(''),[projectId,setProjectId]=useState('');
 // The element choice is shared with the device art when a page supplies one.
 const elementId=picked??ownElement,setElementId=(id:string)=>{setOwnElement(id);onPick?.(id);};
 const element=s.elements.some(e=>e.id===elementId)?elementId:s.elements[0]?.id??'',task=s.tasks.some(t=>t.id===taskId)?taskId:s.tasks[0]?.id??'',project=s.projects.some(p=>p.id===projectId)?projectId:s.projects[0]?.id??'';
 const projects=[{value:'',label:'Shared pool'},...s.projects.map(p=>({value:p.id,label:p.id}))];
 const base={source:s,api,path:path+'/integration/commands',refresh};
 const command=(state:Nano,cmd:unknown)=>({apiVersion:state.apiVersion,controllerId:state.identity.controllerId,deviceId:state.identity.deviceId,requestId:state.nextRequestId,expectedRevision:state.revision,command:cmd});
 const unsupported=nanoEdits.filter(([op])=>!editable(s,op)).map(([,name])=>name),any=unsupported.length<nanoEdits.length;
 return <div className="panel" role="group" aria-labelledby={heading}><h3 id={heading}>Assignments</h3><p className="hint">Session source: {s.source}.{any?' Mappings use controller-declared neutral identifiers.':''}</p>{any&&<div className="cards">
 {editable(s,'settings.set')&&<EditForm {...base} lifecycleKey={component.id+':settings'} title="Integration settings" initial={{style:s.settings.style??'classic',coverage:s.settings.coverage??'whole'}} disabled={disabled} build={(state,v)=>({apiVersion:state.apiVersion,controllerId:state.identity.controllerId,deviceId:state.identity.deviceId,requestId:state.nextRequestId,expectedRevision:state.revision,command:{kind:'settings.set',style:v.style,coverage:v.coverage}})} prepare={()=>reread(nanoSource('settings.set'))}>{f=><><Select label="Layout style" value={f.values.style} onChange={x=>f.set('style',x)} options={options(['classic','project'])}/><Select label="Coverage" value={f.values.coverage} onChange={x=>f.set('coverage',x)} options={options(['whole','status'])}/></>}</EditForm>}
 {editable(s,'elements.assign')&&<div className="stack"><Select label="Element" value={element} onChange={setElementId} options={options(s.elements.map(e=>e.id))}/>{!s.elements.length&&<p className="hint">No elements declared.</p>}
 {s.elements.map(e=><div key={e.id} hidden={element!==e.id}><EditForm {...base} lifecycleKey={component.id+':element:'+e.id} prepare={()=>reread(nanoSource('elements.assign'))} title="Element mapping" initial={{project:e.projectId??'',signature:String(e.signature)}} disabled={disabled} build={(state,v)=>command(state,{kind:'elements.assign',elements:[{id:e.id,projectId:v.project||null,signature:Number(v.signature)}]})}>{f=><><Select label="Element project" value={f.values.project} onChange={x=>f.set('project',x)} options={projects}/><Select label="Signature" value={f.values.signature} onChange={x=>f.set('signature',x)} options={[{value:'0',label:'Off'},{value:'1',label:'On'}]}/><p className="hint">Current assignment: {e.projectId??'Shared pool'}; signature {e.signature?'on':'off'}.</p></>}</EditForm></div>)}</div>}
 {editable(s,'task.assign')&&<div className="stack"><Select label="Task" value={task} onChange={setTaskId} options={options(s.tasks.map(t=>t.id))}/>{!s.tasks.length&&<p className="hint">No tasks declared.</p>}
 {s.tasks.map(t=><div key={t.id} hidden={task!==t.id}><EditForm {...base} lifecycleKey={component.id+':task:'+t.id} prepare={()=>reread(nanoSource('task.assign'))} title="Task mapping" initial={{project:t.overrideProjectId??''}} disabled={disabled} build={(state,v)=>command(state,{kind:'task.assign',taskId:t.id,projectId:v.project||null})}>{f=><><Select label="Task project" value={f.values.project} onChange={x=>f.set('project',x)} options={[{value:'',label:'No override'},...projects.slice(1)]}/><p className="hint">Current override: {t.overrideProjectId??'None'}; source project: {t.projectId??'Unknown'}.</p></>}</EditForm></div>)}</div>}
 {editable(s,'project.color')&&<div className="stack"><Select label="Color project" value={project} onChange={setProjectId} options={projects.slice(1)}/>{!s.projects.length&&<p className="hint">No projects declared.</p>}
 {s.projects.map(p=><div key={p.id} hidden={project!==p.id}><EditForm {...base} lifecycleKey={component.id+':project:'+p.id} prepare={()=>reread(nanoSource('project.color'))} title="Project color" initial={{color:p.color}} disabled={disabled} build={(state,v)=>command(state,{kind:'project.color',projectId:p.id,color:v.color})}>{f=><RangeField label="Color" name="color" field={f} type="color"/>}</EditForm></div>)}</div>}
 </div>}{unsupported.length>0&&<p className="hint undeclared">Not supported by this device’s integration: {listed(unsupported)}.</p>}</div>;
}
/** The Pixoo Monitor panel: the filters and cadence of the agent-status view, sent as one guarded view operation. */
export function PixooMonitor({d,integration:integr,sessions}:{d:DeviceControls;integration:Pixoo;sessions:SessionSnapshot[]}){
 const {component,disabled,api,path,refresh,reread}=d;
 const heading=useId();
 return <div className="panel" role="group" aria-labelledby={heading}><h3 id={heading}>Monitor</h3><EditForm title="Monitor view" className="wide" lifecycleKey={component.id+':monitor-view'} source={integr} initial={{q:integr.configuration.filter.q??'',provider:integr.configuration.filter.provider??'',projectId:integr.configuration.filter.projectId??'',session:integr.configuration.filter.session?JSON.stringify(integr.configuration.filter.session):'',cadence:String(integr.configuration.cadenceMs)}} disabled={disabled} api={api} path={path+'/integration/commands'} build={(s,v)=>({apiVersion:s.apiVersion,controllerId:component.controllerId,deviceId:component.deviceId,requestId:s.nextRequestId,expectedConfigurationRevision:s.configurationRevision,expectedGeneration:s.generation,action:{operation:'view',filter:{...(v.q?{q:v.q}:{}),...(v.provider?{provider:v.provider}:{}),...(v.projectId?{projectId:v.projectId}:{}),...(v.session?{session:JSON.parse(v.session)}:{})},cadenceMs:Number(v.cadence)}})} refresh={refresh} prepare={()=>reread((latest,a)=>a.disabled??(pixoo(latest.integration)?{source:latest.integration,revision:String(latest.integration.configurationRevision)}:'No integration snapshot'))} help="Filters can produce an empty monitor view. A text field sends when it is left or submitted; a select sends at once.">{f=><><TextField label="Label / ID filter" name="q" field={f} maxLength={120}/><Select label="Monitor provider" value={f.values.provider} onChange={x=>f.set('provider',x)} options={[{value:'',label:'All providers'},...options(['codex','claude'])]}/><TextField label="Project ID" name="projectId" field={f} maxLength={128} pattern="[A-Za-z0-9_.\-]*"/><Select label="Monitor session" value={f.values.session} onChange={x=>f.set('session',x)} options={[{value:'',label:'All sessions'},...(f.values.session&&!sessions.some(s=>JSON.stringify(s.identity)===f.values.session)?[{value:f.values.session,label:'Previously selected session'}]:[]),...sessions.map(s=>({value:JSON.stringify(s.identity),label:s.label??s.identity.sessionId}))]}/><TextField label="Update interval (ms)" name="cadence" field={f} type="number" required min={integr.capabilities.minimumCadenceMs} max={integr.capabilities.maximumCadenceMs} step="1"/><p className="hint">Participation: {integr.participating?'yes':'no'}; source: {integr.sourceConnection}.</p></>}</EditForm></div>;
}
