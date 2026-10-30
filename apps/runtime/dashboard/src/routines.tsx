// Hub #483, #1297: the weekly routines editor. A routine is an ordered list of typed device actions at one Hub-clock
// time on chosen weekdays. The page only reads and writes definitions through the Automation page's explicit mutations.
import React,{useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {Badge,Facts} from './ui.tsx';

// The core's route shapes (`apps/runtime/src/core/power-schedules.ts`), kept browser-safe.
export const ROUTINE_FAMILIES=['power-set','brightness-set','scene-activate','media-start','media-control','device-mode-set','pixoo-media-show','lifx-color-set'] as const;
export type RoutineFamily=(typeof ROUTINE_FAMILIES)[number];
export type RoutineAction={target:string;family:RoutineFamily;data:Record<string,unknown>;requireMode?:string};
export type RoutineInput={name:string;days:number[];time:string;actions:RoutineAction[];enabled?:boolean};
export type Routine=Omit<RoutineInput,'enabled'> & {id:string;enabled:boolean;definitionId:string;createdAtMs:number;updatedAtMs:number;next?:{atMs:number}};
export type RoutineDevice={record:DeviceRecord;current:boolean};
type ActionDraft=Omit<RoutineAction,'family'> & {family:RoutineFamily|''};
type RoutineDraft={name:string;days:number[];time:string;actions:ActionDraft[]};

const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ACTION_LIMIT=16;
/** Content actions always require their device kind's content mode, and only that mode; the core fills it when omitted. */
const CONTENT_FAMILIES:readonly RoutineFamily[]=['scene-activate','media-start','media-control','pixoo-media-show'];
const DEFAULT_CONTENT_MODE:Readonly<Record<string,string>>={pixoo:'media',nanoleaf:'free'};
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

/** A definition never enables on create or changes `enabled` as a side effect of editing; each action keeps exactly its family's keys. */
export function routineInput(draft:Omit<RoutineInput,'enabled'>,creating:boolean):RoutineInput {
  return {name:draft.name,days:[...draft.days],time:draft.time,
    actions:draft.actions.map(action=>({target:action.target,family:action.family,data:Object.fromEntries(FIELDS[action.family].map(key=>[key,action.data[key]])),
      ...(action.requireMode===undefined?{}:{requireMode:action.requireMode})})),
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
function defaults(record:DeviceRecord,family:RoutineFamily):Pick<ActionDraft,'data'|'requireMode'> {
  const media=mediaOf(record),modes=modesOf(record);
  const mode=contentMode(record),requireMode=content(family)?mode:undefined;
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
  return {data,...(requireMode===undefined?{}:{requireMode})};
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
  if(content(family) ? action.requireMode!==contentMode(device.record) : action.requireMode!==undefined && !modes.includes(action.requireMode)) return undefined;
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
  return action.requireMode===undefined?words:`${words} (requires ${action.requireMode})`;
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

export function RoutinesEditor({routines,timeZone,devices,available,mutate}: {
  routines:readonly Routine[];timeZone:string;devices:readonly RoutineDevice[];available:boolean;
  mutate:(path:string,method:string,value?:object,after?:()=>void)=>Promise<void>;
}):React.JSX.Element {
  const [draft,setDraft]=useState(fresh),[editing,setEditing]=useState<string>();
  const reset=():void=>{setEditing(undefined);setDraft(fresh());};
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
  return <section aria-label="Weekly routines"><h2>Weekly routines</h2>
    <p>Times use the Hub clock ({timeZone}). The Hub must be running and each device reachable. Missed runs are skipped.
      Actions run in order; an action whose device is not in its required mode is skipped and logged.</p>
    <div className="cards two"><article className="card"><h3>Saved routines</h3>
      {routines.length===0 && <p>No routines yet.</p>}
      {routines.map(saved=><article className="session" key={saved.id}><h4>{saved.name} <Badge>{saved.enabled?'Enabled':'Disabled'}</Badge></h4>
        <p>{saved.days.map(day=>DAYS[day]).join(', ')} · {saved.time}</p>
        <ol className="routine-summary">{saved.actions.map((action,index)=><li key={index}>{labelOf(action.target)}: {actionSummary(action)}</li>)}</ol>
        <Facts items={[
          ['Next run at last refresh',!saved.enabled?'None while disabled':saved.next===undefined?'None'
            :`${new Date(saved.next.atMs).toLocaleString(undefined,{timeZone})} (${timeZone})`],
          ...saved.actions.map((action,index)=>{
            const device=recordOf(action.target);
            return [`Action ${String(index+1)} device path`,device?.current===true?device.record.availability:'Unknown or stale'] as const;
          }),
        ]}/>
        <div className="actions"><button type="button" className="secondary" disabled={!available} onClick={()=>{
          setEditing(saved.id);setDraft({name:saved.name,days:[...saved.days],time:saved.time,actions:routineInput(saved,false).actions});
        }}>Edit routine {saved.name}</button>
          <button type="button" disabled={!available} onClick={()=>{void mutate(`routines/${encodeURIComponent(saved.id)}/${saved.enabled?'disable':'enable'}`,'POST',{});}}>{saved.enabled?'Disable':'Enable'} routine {saved.name}</button>
          <button type="button" className="secondary" disabled={!available} onClick={()=>{void mutate(`routines/${encodeURIComponent(saved.id)}/run`,'POST',{});}}>Run routine {saved.name} now</button>
          <button type="button" className="secondary" disabled={!available} onClick={()=>{void mutate(`routines/${encodeURIComponent(saved.id)}`,'DELETE',undefined,()=>{if(editing===saved.id) reset();});}}>Delete routine {saved.name}</button></div>
      </article>)}
    </article><article className="card"><h3>{editing===undefined?'Create routine':'Edit routine'}</h3>
      <form className="edit wide routine-form" onSubmit={event=>{
        event.preventDefault();if(!valid) return;
        void mutate(editing===undefined?'routines':`routines/${encodeURIComponent(editing)}`,editing===undefined?'POST':'PUT',
          routineInput({name:draft.name,days:draft.days,time:draft.time,actions},editing===undefined),reset);
      }}><fieldset disabled={!available}><legend className="vh">Routine definition</legend>
        <label>Routine name<input required maxLength={80} value={draft.name} onChange={event=>{setDraft({...draft,name:event.target.value});}}/></label>
        <fieldset className="routine-days"><legend>Days</legend>{DAYS.map((day,index)=><label className="check" key={day}><input type="checkbox" checked={draft.days.includes(index)}
          onChange={event=>{setDraft({...draft,days:event.target.checked?[...draft.days,index].sort((a,b)=>a-b):draft.days.filter(value=>value!==index)});}}/>{day}</label>)}</fieldset>
        <label>Time<input type="time" required value={draft.time} onChange={event=>{setDraft({...draft,time:event.target.value});}}/></label>
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
            {content(action.family) && <p className="routine-mode">Runs only in {action.requireMode??contentMode(record)??'its content mode'}; the device's status presentation is never displaced.</p>}
            {action.family!=='' && !content(action.family) && <label>Required mode<select aria-label="Required mode" value={action.requireMode??''} onChange={event=>{
              const mode=event.target.value;
              setAction(index,current=>{const {requireMode:_previous,...rest}=current;return mode===''?rest:{...rest,requireMode:mode};});
            }}><option value="">No precondition</option>
              {choices(modes,action.requireMode??'')}</select></label>}
            {completed[index]===undefined && <p>Choose a current device and complete this action.</p>}
            <div className="actions">
              <button type="button" className="secondary" disabled={index===0} onClick={()=>{move(index,-1);}}>Move action {position} up</button>
              <button type="button" className="secondary" disabled={index===draft.actions.length-1} onClick={()=>{move(index,1);}}>Move action {position} down</button>
              <button type="button" className="secondary" onClick={()=>{setActions(list=>list.filter((_action,item)=>item!==index));}}>Remove action {position}</button></div>
          </fieldset></li>;
        })}</ol>
        {draft.actions.length===0 && <p>Add at least one action.</p>}
        <div className="actions"><button type="button" className="secondary" disabled={draft.actions.length>=ACTION_LIMIT}
          onClick={()=>{setActions(list=>[...list,blank()]);}}>Add action</button></div>
        <p>New routines are disabled. Saving or enabling runs nothing; Run now runs one occurrence.</p>
        <div className="actions"><button disabled={!valid}>{editing===undefined?'Create disabled routine':'Save routine'}</button>
          {editing!==undefined && <button type="button" className="secondary" onClick={reset}>Cancel routine edit</button>}</div>
      </fieldset></form>
    </article></div>
  </section>;
}
