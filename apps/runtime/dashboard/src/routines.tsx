// Hub #483, #1297: the weekly routines editor. A routine is an ordered list of typed device actions at one Hub-clock
// time on chosen weekdays. The page only reads and writes definitions through the Automation page's explicit mutations.
import React,{useEffect,useId,useRef,useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {Badge,Facts} from './ui.tsx';

// The core's route shapes (`apps/runtime/src/core/power-schedules.ts`), kept browser-safe.
export const ROUTINE_FAMILIES=['power-set','brightness-set','scene-activate','media-start','media-control','device-mode-set','pixoo-media-show','lifx-color-set'] as const;
export type RoutineFamily=(typeof ROUTINE_FAMILIES)[number];
/** `runsOnlyIn`: the Hub mode the device must report for the action to run, which the core checks (ADR 0014). */
export type RoutineAction={target:string;family:RoutineFamily;data:Record<string,unknown>;runsOnlyIn?:string};
export type RoutineInput={name:string;days:number[];time:string;actions:RoutineAction[];enabled?:boolean};
export type Routine=Omit<RoutineInput,'enabled'> & {id:string;enabled:boolean;definitionId:string;createdAtMs:number;updatedAtMs:number;next?:{atMs:number}};
export type RoutineDevice={record:DeviceRecord;current:boolean};
type ActionDraft=Omit<RoutineAction,'family'> & {family:RoutineFamily|''};
type RoutineDraft={name:string;days:number[];time:string;actions:ActionDraft[]};

const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ACTION_LIMIT=16;
/**
 * This editor still gives a content action its kind's content mode, Free for both kinds since the Pixoo follows the Hub
 * mode (ADR 0014); the core no longer requires one. Its visible redesign is #1575's.
 */
const CONTENT_FAMILIES:readonly RoutineFamily[]=['scene-activate','media-start','media-control','pixoo-media-show'];
const DEFAULT_CONTENT_MODE:Readonly<Record<string,string>>={pixoo:'free',nanoleaf:'free'};
/** The exact payload keys each family's schema takes. */
const FIELDS:Readonly<Record<RoutineFamily,readonly string[]>>={'power-set':['on'],'brightness-set':['percent'],'scene-activate':['sceneId'],'media-start':['playlistId'],
  'media-control':['action'],'device-mode-set':['mode'],'pixoo-media-show':['renditionId'],'lifx-color-set':['hue','saturation']};
const FAMILY_LABELS:Readonly<Record<RoutineFamily,string>>={'power-set':'Power','brightness-set':'Brightness','scene-activate':'Scene','media-start':'Start playlist',
  'media-control':'Media control','device-mode-set':'Device mode','pixoo-media-show':'Show rendition','lifx-color-set':'Color'};
const title=(value:string):string=>value.charAt(0).toUpperCase()+value.slice(1);
const short=(id:string):string=>id.length>12?`${id.slice(0,8)}…`:id;
const content=(family:RoutineFamily|''):boolean=>family!=='' && CONTENT_FAMILIES.includes(family);
/** The one mode a content action on this device may require, when the device offers it. */
const contentMode=(record:DeviceRecord|undefined):string|undefined=>{
  const mode=record===undefined?undefined:DEFAULT_CONTENT_MODE[record.kind];
  return mode!==undefined && modesOf(record).includes(mode)?mode:undefined;
};
const integer=(value:unknown,minimum:number,maximum:number):boolean=>typeof value==='number' && Number.isInteger(value) && value>=minimum && value<=maximum;
const numeric=(value:string):number|string=>value===''?'':Number(value);
const text=(value:unknown):string=>typeof value==='string' || typeof value==='number'?String(value):'';
const blank=():ActionDraft=>({target:'',family:'',data:{}});
const fresh=():RoutineDraft=>({name:'',days:[1,2,3,4,5],time:'07:00',actions:[blank()]});

// Hub #1585: the viewer's reading of a Hub-clock time. The stored value stays the Hub host's local HH:MM; this is derived text.
const DAY_MS=86_400_000;
type Wall={year:number;month:number;day:number;hour:number;minute:number;second:number;weekday:string};
const pad=(value:number):string=>String(value).padStart(2,'0');
/** The browser's own zone. */
export const browserZone=():string=>Intl.DateTimeFormat().resolvedOptions().timeZone;
/** The zone's canonical name; throws for an unknown zone. */
const canonical=(zone:string):string=>new Intl.DateTimeFormat('en-US',{timeZone:zone}).resolvedOptions().timeZone;
function wall(atMs:number,zone:string):Wall {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',weekday:'short',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(atMs);
  const part=(type:Intl.DateTimeFormatPartTypes):string=>parts.find(item=>item.type===type)?.value??'';
  return {year:Number(part('year')),month:Number(part('month')),day:Number(part('day')),hour:Number(part('hour')),minute:Number(part('minute')),second:Number(part('second')),weekday:part('weekday')};
}
/** The zone's offset from UTC at an instant, in milliseconds. */
function offset(atMs:number,zone:string):number {
  const at=wall(atMs,zone);
  return Date.UTC(at.year,at.month-1,at.day,at.hour,at.minute,at.second)-(atMs-(((atMs%1000)+1000)%1000));
}
/**
 * The instant a Hub-local date and time names. A repeated hour takes its earlier reading and a skipped hour moves forward,
 * as the host clock's `setHours` resolves them in the core's `nextOccurrence`.
 */
function instant(year:number,month:number,day:number,hour:number,minute:number,zone:string):number {
  const guess=Date.UTC(year,month-1,day,hour,minute),before=guess-offset(guess-DAY_MS,zone);
  const matches=[...new Set([before,guess-offset(guess+DAY_MS,zone)])].filter(atMs=>{
    const at=wall(atMs,zone);return at.day===day && at.hour===hour && at.minute===minute;
  }).sort((a,b)=>a-b);
  return matches[0]??before;
}
/** The first occurrence of a Hub-local weekly time strictly after `afterMs`, by the core's selection rule on the Hub's clock. */
export function nextHubOccurrence(days:readonly number[],time:string,zone:string,afterMs:number):number|undefined {
  if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) return undefined;
  try {
    const today=wall(afterMs,zone),hour=Number(time.slice(0,2)),minute=Number(time.slice(3));
    for(let ahead=0;ahead<=7;ahead++) {
      const date=new Date(Date.UTC(today.year,today.month-1,today.day+ahead));
      if(!days.includes(date.getUTCDay())) continue;
      const atMs=instant(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),hour,minute,zone);
      if(atMs>afterMs) return atMs;
    }
  } catch {/* An unknown zone has no reading. */}
  return undefined;
}
/** The browser's zone when it differs from the Hub's, else undefined (also for an unknown zone). */
export function distinctZone(hubZone:string,localZone:string):string|undefined {
  try {
    const local=canonical(localZone);
    return canonical(hubZone)===local?undefined:local;
  } catch {return undefined;}
}
/** One Hub instant in the browser's zone, such as "11:00 your time (America/Chicago)", naming the weekday when the dates differ. */
export function localEquivalent(atMs:number,hubZone:string,localZone:string):string|undefined {
  const local=distinctZone(hubZone,localZone);
  if(local===undefined) return undefined;
  const hub=wall(atMs,hubZone),here=wall(atMs,local);
  const shifted=hub.year!==here.year || hub.month!==here.month || hub.day!==here.day;
  return `${shifted?`${here.weekday} `:''}${pad(here.hour)}:${pad(here.minute)} your time (${local})`;
}

/** A definition never enables on create or changes `enabled` as a side effect of editing; each action keeps exactly its family's keys. */
export function routineInput(draft:Omit<RoutineInput,'enabled'>,creating:boolean):RoutineInput {
  return {name:draft.name,days:[...draft.days],time:draft.time,
    actions:draft.actions.map(action=>({target:action.target,family:action.family,data:Object.fromEntries(FIELDS[action.family].map(key=>[key,action.data[key]])),
      ...(action.runsOnlyIn===undefined?{}:{runsOnlyIn:action.runsOnlyIn})})),
    ...(creating?{enabled:false}:{})};
}

/** The families a current record offers, by the capability rule the modules admit. Content families need the kind's content mode. */
export function routineFamilies(record:DeviceRecord):RoutineFamily[] {
  const {power,brightness,scenes,media,modes}=record.capabilities,mode=contentMode(record);
  return ROUTINE_FAMILIES.filter(family=>{
    switch(family) {
      case 'power-set': return power.supported;
      case 'brightness-set': return brightness.supported;
      case 'device-mode-set': return modes.supported;
      case 'scene-activate': return scenes.supported && mode!==undefined;
      case 'media-start': case 'media-control': return media.supported && mode!==undefined;
      case 'pixoo-media-show': return media.supported && mode!==undefined && record.kind==='pixoo';
      case 'lifx-color-set': return record.kind==='lifx';
    }
  });
}
const modesOf=(record:DeviceRecord|undefined):readonly string[]=>record?.capabilities.modes.supported===true?record.capabilities.modes.values:[];
type Media={actions:readonly string[];playlistIds:readonly string[];renditionIds:readonly string[]};
const mediaOf=(record:DeviceRecord|undefined):Media=>record?.capabilities.media.supported===true?record.capabilities.media:{actions:[],playlistIds:[],renditionIds:[]};
const scenesOf=(record:DeviceRecord|undefined):readonly string[]=>record?.capabilities.scenes.supported===true?record.capabilities.scenes.sceneIds:[];
function defaults(record:DeviceRecord,family:RoutineFamily):Pick<ActionDraft,'data'|'runsOnlyIn'> {
  const media=mediaOf(record),modes=modesOf(record);
  const mode=contentMode(record),runsOnlyIn=content(family)?mode:undefined;
  const data=((): Record<string,unknown>=>{
    switch(family) {
      case 'power-set': return {on:true};
      case 'brightness-set': return {percent:50};
      case 'scene-activate': return {sceneId:scenesOf(record)[0]??''};
      case 'media-start': return {playlistId:media.playlistIds[0]??''};
      case 'media-control': return {action:media.actions[0]??''};
      case 'device-mode-set': return {mode:modes[0]??''};
      case 'pixoo-media-show': return {renditionId:media.renditionIds[0]??''};
      case 'lifx-color-set': return {hue:0,saturation:100};
    }
  })();
  return {data,...(runsOnlyIn===undefined?{}:{runsOnlyIn})};
}
/** An action is complete when its device is current and offers the family, and its payload and precondition are among the device's values. */
function complete(action:ActionDraft,devices:readonly RoutineDevice[]):RoutineAction|undefined {
  const device=devices.find(item=>item.record.id===action.target),family=action.family;
  if(device?.current!==true || family==='' || !routineFamilies(device.record).includes(family)) return undefined;
  const {data}=action,media=mediaOf(device.record),modes=modesOf(device.record);
  const valid=((): boolean=>{
    switch(family) {
      case 'power-set': return typeof data.on==='boolean';
      case 'brightness-set': return integer(data.percent,0,100);
      case 'scene-activate': return typeof data.sceneId==='string' && scenesOf(device.record).includes(data.sceneId);
      case 'media-start': return typeof data.playlistId==='string' && media.playlistIds.includes(data.playlistId);
      case 'media-control': return media.actions.some(value=>value===data.action);
      case 'device-mode-set': return typeof data.mode==='string' && modes.includes(data.mode);
      case 'pixoo-media-show': return typeof data.renditionId==='string' && media.renditionIds.includes(data.renditionId);
      case 'lifx-color-set': return integer(data.hue,0,360) && integer(data.saturation,0,100);
    }
  })();
  if(!valid) return undefined;
  // A content action requires exactly its kind's content mode; any other action may require any mode the device offers, or none.
  if(content(family) ? action.runsOnlyIn!==contentMode(device.record) : action.runsOnlyIn!==undefined && !modes.includes(action.runsOnlyIn)) return undefined;
  return {...action,family};
}
/** One saved action in words, such as "start playlist 3f2a… (requires media)". */
export function actionSummary(action:RoutineAction):string {
  const {data}=action;
  const words=((): string=>{
    switch(action.family) {
      case 'power-set': return data.on===true?'power on':'power off';
      case 'brightness-set': return `brightness ${text(data.percent)}%`;
      case 'scene-activate': return `scene ${short(text(data.sceneId))}`;
      case 'media-start': return `start playlist ${short(text(data.playlistId))}`;
      case 'media-control': return `media ${text(data.action)}`;
      case 'device-mode-set': return `mode ${text(data.mode)}`;
      case 'pixoo-media-show': return `show rendition ${short(text(data.renditionId))}`;
      case 'lifx-color-set': return `color hue ${text(data.hue)} / saturation ${text(data.saturation)}`;
    }
  })();
  return action.runsOnlyIn===undefined?words:`${words} (requires ${action.runsOnlyIn})`;
}
// Each select repeats its visible label as `aria-label`: a wrapping label's text would otherwise include every option.
/** A select's options, keeping a saved value the device no longer offers so editing never silently changes it. */
const choices=(values:readonly string[],current:string,label:(value:string)=>string=title):React.JSX.Element[]=>
  [...(current!=='' && !values.includes(current)?[current]:[]),...values].map(value=><option key={value} value={value}>{label(value)}</option>);

function ActionFields({action,record,change}:{action:ActionDraft;record:DeviceRecord|undefined;change:(data:Record<string,unknown>)=>void}):React.JSX.Element|null {
  const media=mediaOf(record),modes=modesOf(record),{data}=action;
  switch(action.family) {
    case '': return null;
    case 'power-set': return <label>Power<select aria-label="Power" value={data.on===false?'off':'on'} onChange={event=>{change({on:event.target.value==='on'});}}>
      <option value="on">On</option><option value="off">Off</option></select></label>;
    case 'brightness-set': return <label>Brightness percent<input type="number" required min={0} max={100} step={1} value={text(data.percent)}
      onChange={event=>{change({percent:numeric(event.target.value)});}}/></label>;
    case 'scene-activate': return <label>Scene<select aria-label="Scene" required value={text(data.sceneId)} onChange={event=>{change({sceneId:event.target.value});}}>
      <option value="">Choose a scene</option>{choices(scenesOf(record),text(data.sceneId),short)}</select></label>;
    case 'media-start': return <label>Playlist<select aria-label="Playlist" required value={text(data.playlistId)} onChange={event=>{change({playlistId:event.target.value});}}>
      <option value="">Choose a playlist</option>{choices(media.playlistIds,text(data.playlistId),short)}</select></label>;
    case 'media-control': return <label>Media action<select aria-label="Media action" required value={text(data.action)} onChange={event=>{change({action:event.target.value});}}>
      <option value="">Choose a media action</option>{choices(media.actions,text(data.action))}</select></label>;
    case 'device-mode-set': return <label>Mode<select aria-label="Mode" required value={text(data.mode)} onChange={event=>{change({mode:event.target.value});}}>
      <option value="">Choose a mode</option>{choices(modes,text(data.mode))}</select></label>;
    case 'pixoo-media-show': return <label>Rendition<select aria-label="Rendition" required value={text(data.renditionId)} onChange={event=>{change({renditionId:event.target.value});}}>
      <option value="">Choose a rendition</option>{choices(media.renditionIds,text(data.renditionId),short)}</select></label>;
    case 'lifx-color-set': return <>
      <label>Hue<input type="number" required min={0} max={360} step={1} value={text(data.hue)} onChange={event=>{change({...data,hue:numeric(event.target.value)});}}/></label>
      <label>Saturation<input type="number" required min={0} max={100} step={1} value={text(data.saturation)} onChange={event=>{change({...data,saturation:numeric(event.target.value)});}}/></label>
    </>;
  }
}

export function RoutinesEditor({routines,timeZone,devices,available,mutate,localZone=browserZone()}: {
  routines:readonly Routine[];timeZone:string;devices:readonly RoutineDevice[];available:boolean;
  mutate:(path:string,method:string,value?:object,after?:()=>void)=>Promise<void>;
  /** The viewer's zone; the browser's own unless a test fixes it. */
  localZone?:string;
}):React.JSX.Element {
  const [draft,setDraft]=useState(fresh),[editing,setEditing]=useState<string>();
  const [open,setOpen]=useState(false);
  const nameInput=useRef<HTMLInputElement>(null),newButton=useRef<HTMLButtonElement>(null),opener=useRef<HTMLButtonElement|null>(null);
  const returnFocus=useRef(false),timeHint=useId();
  const local=distinctZone(timeZone,localZone);
  /** The viewer's reading of a routine's next occurrence: the core's planned instant when enabled, else the next one on the Hub clock. */
  const equivalent=(days:readonly number[],time:string,plannedMs?:number):string|undefined=>{
    if(local===undefined) return undefined;
    const atMs=plannedMs??nextHubOccurrence(days,time,timeZone,Date.now());
    return atMs===undefined?undefined:localEquivalent(atMs,timeZone,local);
  };
  const draftEquivalent=equivalent(draft.days,draft.time);
  const reset=():void=>{
    setEditing(undefined);setDraft(fresh());setOpen(false);
    returnFocus.current=true;
  };
  useEffect(()=>{
    if(!returnFocus.current||open||!available) return;
    returnFocus.current=false;
    const target=opener.current?.isConnected===true?opener.current:newButton.current;
    if(target!==null&&target.closest('[hidden]')===null) target.focus();
  },[open,available]);
  useEffect(()=>{if(open) nameInput.current?.focus();},[open,editing]);
  const recordOf=(target:string):RoutineDevice|undefined=>devices.find(item=>item.record.id===target);
  const labelOf=(target:string):string=>recordOf(target)?.record.label??target;
  const targets=[...new Set([...devices.map(item=>item.record.id),...draft.actions.map(action=>action.target).filter(target=>target!=='')])];
  const completed=draft.actions.map(action=>complete(action,devices));
  const actions=completed.filter((action):action is RoutineAction=>action!==undefined);
  const valid=draft.name.trim()!=='' && draft.days.length>0 && draft.time!=='' && actions.length>0 && actions.length===draft.actions.length;
  const setActions=(change:(list:ActionDraft[])=>ActionDraft[]):void=>{setDraft(value=>({...value,actions:change(value.actions)}));};
  const setAction=(index:number,change:(action:ActionDraft)=>ActionDraft):void=>{setActions(list=>list.map((action,position)=>position===index?change(action):action));};
  const move=(index:number,offset:number):void=>{setActions(list=>{
    const next=[...list],moved=next[index],other=next[index+offset];
    if(moved===undefined || other===undefined) return list;
    next[index]=other;next[index+offset]=moved;return next;
  });};
  return <section aria-label="Weekly routines">
    <div className="cards two automation-collection"><article className="card"><header className="automation-section-heading"><h2>Routines</h2>
      <button type="button" ref={newButton} disabled={!available} onClick={event=>{
        opener.current=event.currentTarget;setEditing(undefined);setDraft(fresh());setOpen(true);nameInput.current?.focus();
      }}>New routine</button></header>
      <p className="hint">Hub time · {timeZone}{local!==undefined && ` · your time (${local}) is shown for each routine's next occurrence; the difference can change across the year`}</p>
      {routines.length===0 && <p>No routines yet.</p>}
      {routines.map(saved=>{const reading=equivalent(saved.days,saved.time,saved.enabled?saved.next?.atMs:undefined);return <article className="session" key={saved.id}><h4>{saved.name} <Badge>{saved.enabled?'Enabled':'Disabled'}</Badge></h4>
        <p>{saved.days.map(day=>DAYS[day]).join(', ')} · {saved.time}{reading!==undefined && ` · ${reading}`}</p>
        <ol className="routine-summary">{saved.actions.map((action,index)=><li key={index}>{labelOf(action.target)}: {actionSummary(action)}</li>)}</ol>
        <details className="automation-evidence"><summary>Timing and device status</summary><Facts items={[
          ['Next run at last refresh',!saved.enabled?'None while disabled':saved.next===undefined?'None'
            :`${new Date(saved.next.atMs).toLocaleString(undefined,{timeZone})} (${timeZone})${local===undefined?'':` · ${new Date(saved.next.atMs).toLocaleString(undefined,{timeZone:local})} (${local})`}`],
          ...saved.actions.map((action,index)=>{
            const device=recordOf(action.target);
            return [`Action ${String(index+1)} device path`,device?.current===true?device.record.availability:'Unknown or stale'] as const;
          }),
        ]}/></details>
        <div className="actions"><button type="button" className="secondary" disabled={!available} aria-label={`Edit routine ${saved.name}`} onClick={event=>{
          opener.current=event.currentTarget;setEditing(saved.id);setDraft({name:saved.name,days:[...saved.days],time:saved.time,actions:routineInput(saved,false).actions});setOpen(true);nameInput.current?.focus();
        }}>Edit</button>
          <button type="button" disabled={!available} aria-label={`${saved.enabled?'Disable':'Enable'} routine ${saved.name}`} onClick={()=>{void mutate(`routines/${encodeURIComponent(saved.id)}/${saved.enabled?'disable':'enable'}`,'POST',{});}}>{saved.enabled?'Disable':'Enable'}</button>
          <button type="button" className="secondary" disabled={!available} aria-label={`Run now: ${saved.name}`} onClick={()=>{void mutate(`routines/${encodeURIComponent(saved.id)}/run`,'POST',{});}}>Run now</button>
          <button type="button" className="secondary" disabled={!available} aria-label={`Delete routine ${saved.name}`} onClick={()=>{void mutate(`routines/${encodeURIComponent(saved.id)}`,'DELETE',undefined,()=>{if(editing===saved.id){opener.current=newButton.current;reset();}});}}>Delete</button></div>
      </article>;})}
      <details className="automation-help"><summary>How routines work</summary><p>The Hub must be running and each device reachable. Missed runs are skipped. Actions run in order; a device outside its required mode is skipped and logged. Saving or enabling runs nothing; Run now runs one occurrence.</p></details>
    </article><article className="card automation-editor" hidden={!open}><h3>{editing===undefined?'Create routine':'Edit routine'}</h3>
      <form className="edit wide routine-form" onSubmit={event=>{
        event.preventDefault();if(!valid) return;
        void mutate(editing===undefined?'routines':`routines/${encodeURIComponent(editing)}`,editing===undefined?'POST':'PUT',
          routineInput({name:draft.name,days:draft.days,time:draft.time,actions},editing===undefined),reset);
      }}><fieldset disabled={!available}><legend className="vh">Routine definition</legend>
        <label>Routine name<input ref={nameInput} required maxLength={80} value={draft.name} onChange={event=>{setDraft({...draft,name:event.target.value});}}/></label>
        <fieldset className="routine-days"><legend>Days</legend>{DAYS.map((day,index)=><label className="check" key={day}><input type="checkbox" checked={draft.days.includes(index)}
          onChange={event=>{setDraft({...draft,days:event.target.checked?[...draft.days,index].sort((a,b)=>a-b):draft.days.filter(value=>value!==index)});}}/>{day}</label>)}</fieldset>
        <label>Time<input type="time" required value={draft.time} aria-describedby={draftEquivalent===undefined?undefined:timeHint} onChange={event=>{setDraft({...draft,time:event.target.value});}}/></label>
        {draftEquivalent!==undefined && <p className="hint" id={timeHint}>{draft.time} Hub time is {draftEquivalent} at the next occurrence.</p>}
        <ol className="routine-actions">{draft.actions.map((action,index)=>{
          const device=recordOf(action.target),record=device?.record,position=String(index+1);
          const families=record===undefined?[]:routineFamilies(record),modes=modesOf(record);
          const familyChoices=action.family!=='' && !families.includes(action.family)?[action.family,...families]:families;
          return <li key={index}><fieldset><legend>Action {position}</legend>
            <label>Device<select aria-label="Device" required value={action.target} onChange={event=>{
              const target=event.target.value,next=recordOf(target)?.record;
              setAction(index,current=>{
                if(next===undefined) return {...blank(),target};
                const offered=routineFamilies(next),family=current.family!=='' && offered.includes(current.family)?current.family:offered[0];
                return family===undefined?{...blank(),target}:{target,family,...defaults(next,family)};
              });
            }}><option value="">Choose a device</option>
              {targets.map(id=>{const item=recordOf(id);return <option value={id} key={id}>{item?.record.label??id}{item?.current===true?'':' (unavailable)'}</option>;})}</select></label>
            <label>Action<select aria-label="Action" required value={action.family} onChange={event=>{
              const family=familyChoices.find(value=>value===event.target.value);
              if(family!==undefined && record!==undefined) setAction(index,current=>({target:current.target,family,...defaults(record,family)}));
            }}>{action.family==='' && <option value="">Choose an action</option>}
              {familyChoices.map(family=><option key={family} value={family}>{FAMILY_LABELS[family]}</option>)}</select></label>
            <ActionFields action={action} record={record} change={data=>{setAction(index,current=>({...current,data}));}}/>
            {content(action.family) && <p>Runs only in {action.runsOnlyIn??contentMode(record)??'its content mode'}; the device's status presentation is never displaced.</p>}
            {action.family!=='' && !content(action.family) && <label>Required mode<select aria-label="Required mode" value={action.runsOnlyIn??''} onChange={event=>{
              const mode=event.target.value;
              setAction(index,current=>{const {runsOnlyIn:_previous,...rest}=current;return mode===''?rest:{...rest,runsOnlyIn:mode};});
            }}><option value="">No precondition</option>
              {choices(modes,action.runsOnlyIn??'')}</select></label>}
            {completed[index]===undefined && <p>Choose a current device and complete this action.</p>}
            <div className="actions">
              <button type="button" className="secondary" aria-label={`Move action ${position} up`} disabled={index===0} onClick={()=>{move(index,-1);}}>↑</button>
              <button type="button" className="secondary" aria-label={`Move action ${position} down`} disabled={index===draft.actions.length-1} onClick={()=>{move(index,1);}}>↓</button>
              <button type="button" className="secondary" aria-label={`Remove action ${position}`} onClick={()=>{setActions(list=>list.filter((_action,item)=>item!==index));}}>Remove</button></div>
          </fieldset></li>;
        })}</ol>
        {draft.actions.length===0 && <p>Add at least one action.</p>}
        <div className="actions"><button type="button" className="secondary" disabled={draft.actions.length>=ACTION_LIMIT}
          onClick={()=>{setActions(list=>[...list,blank()]);}}>Add action</button></div>
        <div className="actions"><button disabled={!valid}>{editing===undefined?'Create disabled routine':'Save routine'}</button>
          <button type="button" className="secondary" aria-label="Cancel routine edit" onClick={reset}>Cancel</button></div>
      </fieldset></form>
    </article></div>
  </section>;
}
