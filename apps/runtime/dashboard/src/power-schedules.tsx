import React,{useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {Badge,Facts} from './ui.tsx';

export type PowerInput={name:string;target:string;days:number[];onTime:string;offTime:string;enabled?:boolean};
export type PowerSchedule=PowerInput & {id:string;enabled:boolean;next?:{atMs:number;on:boolean}};
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const fresh=():PowerInput=>({name:'',target:'',days:[1,2,3,4,5],onTime:'17:00',offTime:'20:00'});
export function powerScheduleInput(draft:PowerInput,creating:boolean):PowerInput {
  return {name:draft.name,target:draft.target,days:[...draft.days],onTime:draft.onTime,offTime:draft.offTime,...(creating?{enabled:false}:{})};
}
export function PowerSchedulesEditor({schedules,timeZone,devices,available,mutate}: {
  schedules:readonly PowerSchedule[];timeZone:string;devices:readonly {record:DeviceRecord;current:boolean}[];available:boolean;
  mutate:(path:string,method:string,value?:object,after?:()=>void)=>Promise<void>;
}):React.JSX.Element {
  const [draft,setDraft]=useState(fresh),[editing,setEditing]=useState<string>();
  const targets=[...new Set([...devices.map(item=>item.record.id),...(draft.target===''?[]:[draft.target])])];
  const valid=draft.name.trim()!=='' && draft.target!=='' && draft.days.length>0 && draft.onTime!=='' && draft.onTime<draft.offTime;
  const reset=():void=>{setEditing(undefined);setDraft(fresh());};
  const target=devices.find(item=>item.record.id===draft.target);
  return <section aria-label="Weekly power schedules"><h2>Weekly power schedules</h2>
    <p>Times use the Hub clock ({timeZone}). The Hub must be running and the device reachable. Missed switches are skipped.
      Manual changes last until the next scheduled switch or a separately enabled device limit.</p>
    <div className="cards two"><article className="card"><h3>Saved schedules</h3>
      {schedules.length===0 && <p>No power schedules yet.</p>}
      {schedules.map(saved=>{
        const device=devices.find(item=>item.record.id===saved.target),observed=device?.record.observed;
        const observation=observed?.status==='known' && observed.power.status==='known'
          ?`${observed.power.value?'On':'Off'} · observed ${new Date(observed.observedAtMs).toLocaleString()}${device?.current===true?'':' · stale'}`:'Unknown';
        return <article className="session" key={saved.id}><h4>{saved.name} <Badge>{saved.enabled?'Enabled':'Disabled'}</Badge></h4>
          <p>{saved.days.map(day=>DAYS[day]).join(', ')} · {saved.onTime}–{saved.offTime} · {saved.target}</p>
          <Facts items={[
            ['Next switch at last refresh',saved.enabled && saved.next!==undefined?`${saved.next.on?'On':'Off'} · ${new Date(saved.next.atMs).toLocaleString(undefined,{timeZone})} (${timeZone})`:'None while disabled'],
            ['Observed power',observation],['Device path',device?.current===true?(device.record.availability):'Unknown or stale'],
          ]}/>
          <div className="actions"><button type="button" className="secondary" disabled={!available} onClick={()=>{setEditing(saved.id);setDraft(powerScheduleInput(saved,false));}}>Edit schedule {saved.name}</button>
            <button type="button" disabled={!available} onClick={()=>{void mutate(`power-schedules/${encodeURIComponent(saved.id)}/${saved.enabled?'disable':'enable'}`,'POST',{});}}>{saved.enabled?'Disable':'Enable'} schedule {saved.name}</button>
            <button type="button" className="secondary" disabled={!available} onClick={()=>{void mutate(`power-schedules/${encodeURIComponent(saved.id)}`,'DELETE',undefined,()=>{if(editing===saved.id) reset();});}}>Delete schedule {saved.name}</button></div>
        </article>;
      })}
    </article><article className="card"><h3>{editing===undefined?'Create power schedule':'Edit power schedule'}</h3>
      <form className="edit wide" onSubmit={event=>{
        event.preventDefault();if(!valid) return;
        void mutate(editing===undefined?'power-schedules':`power-schedules/${encodeURIComponent(editing)}`,editing===undefined?'POST':'PUT',powerScheduleInput(draft,editing===undefined),reset);
      }}><fieldset disabled={!available}><legend className="vh">Power schedule definition</legend>
        <label>Schedule name<input required maxLength={80} value={draft.name} onChange={event=>{setDraft({...draft,name:event.target.value});}}/></label>
        <label htmlFor="power-schedule-device">Power device</label><select id="power-schedule-device" required value={draft.target} onChange={event=>{setDraft({...draft,target:event.target.value});}}><option value="">Choose a device</option>
          {targets.map(id=><option value={id} key={id}>{devices.find(item=>item.record.id===id)?.record.label??id}</option>)}</select>
        {target===undefined && <p>No current power-capable device selected.</p>}
        <fieldset><legend>Days</legend>{DAYS.map((day,index)=><label className="check" key={day}><input type="checkbox" checked={draft.days.includes(index)}
          onChange={event=>{setDraft({...draft,days:event.target.checked?[...draft.days,index].sort():draft.days.filter(value=>value!==index)});}}/>{day}</label>)}</fieldset>
        <label>On time<input type="time" required value={draft.onTime} onChange={event=>{setDraft({...draft,onTime:event.target.value});}}/></label>
        <label>Off time<input type="time" required value={draft.offTime} onChange={event=>{setDraft({...draft,offTime:event.target.value});}}/></label>
        {draft.offTime<=draft.onTime && <p role="alert">Off time must be later on the same day.</p>}
        <p>New schedules are disabled. Saving or enabling does not switch a device immediately.</p>
        <div className="actions"><button disabled={!valid || target===undefined || !target.current}>{editing===undefined?'Create disabled schedule':'Save schedule'}</button>
          {editing!==undefined && <button type="button" className="secondary" onClick={reset}>Cancel schedule edit</button>}</div>
      </fieldset></form>
    </article></div>
  </section>;
}
