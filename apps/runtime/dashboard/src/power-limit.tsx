import React,{useEffect,useRef,useState} from 'react';
import type {OperationRecord,PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import {saveAutomation} from './automation.tsx';
import {useSaveLifecycle} from './save-lifecycle.ts';
import {operationView} from './devices.ts';
export type PowerLimitProps={record:PowerLimitRecord|undefined;live:boolean;control:boolean;target:string;operations:readonly OperationRecord[];operationsLive:boolean;refresh:()=>Promise<boolean>};
/** Settings are explicit mutations; current enforcement follows the core's SDK state copy. */
export function PowerLimitPanel(props:PowerLimitProps&{concise?:boolean}):React.JSX.Element {
  const {record,live,control,target,operations,operationsLive,refresh}=props;
  const [draft,setDraft]=useState<{enabled:boolean;minutes:string}>();
  const [reading,setReading]=useState(false),[refreshText,setRefreshText]=useState('');
  const latest=useRef(props);latest.current=props;
  const enabled=draft?.enabled??record?.enabled??false;
  const minutes=draft?.minutes??String((record?.durationMs??14400000)/60000);
  const dirty=draft!==undefined;
  type Settings = {target:string;enabled:boolean;durationMs:number;expectedSettingsRevision:number};
  // A lost reply requires an explicit refresh. A successful reply requires the synced settings from that save.
  const lifecycle=useSaveLifecycle<Settings,number>({
    accepted:()=>true,uncertain:()=>true,
    confirm:state=>state.kind==='accepted'&&live&&record!==undefined&&record.id===state.input.target&&
      record.settingsRevision===state.value&&record.enabled===state.input.enabled&&record.durationMs===state.input.durationMs,
  });
  const phase=lifecycle.state;
  useEffect(()=>{if(phase.kind==='confirmed')setDraft(undefined);},[phase.kind]);
  const superseded=phase.kind==='accepted'&&live&&record!==undefined&&record.settingsRevision>=phase.value;
  const save=async():Promise<void>=>{
    const current=latest.current,durationMs=Number(minutes)*60000;
    if(!dirty||reading||!current.live||!current.control||!Number.isSafeInteger(durationMs)||durationMs<60000||durationMs>604800000)return;
    setRefreshText('');
    const input={target:current.target,enabled,durationMs,expectedSettingsRevision:current.record?.settingsRevision??0};
    await lifecycle.run(input,async()=>{
      const reply=await saveAutomation(`power-limits/${input.target}`,'PUT',{enabled,durationMs,expectedSettingsRevision:input.expectedSettingsRevision});
      if(reply.kind!=='accepted')return reply;
      const revision=reply.value.settingsRevision;
      return typeof revision==='number'&&Number.isSafeInteger(revision)&&revision>input.expectedSettingsRevision&&
        reply.value.enabled===enabled&&reply.value.durationMs===durationMs ? {kind:'accepted',value:revision} : {kind:'uncertain'};
    });
  };
  const refreshCurrent=async():Promise<void>=>{
    if(reading||!latest.current.live)return;
    setReading(true);
    try{
      if(!await refresh()||!latest.current.live)throw new Error('Power limit copy unavailable');
      lifecycle.reset();setDraft(undefined);setRefreshText('Current settings refreshed. Nothing was sent again.');
    }catch{setRefreshText('Current settings could not be synced. Nothing was sent again.');}
    finally{setReading(false);}
  };
  let text=refreshText;
  switch(phase.kind){
    case 'accepted': text=refreshText!==''?refreshText:(superseded?'Settings changed elsewhere. Refresh before another attempt.':'Waiting for the saved settings to sync…');break;
    case 'confirmed': text=props.concise===true?'Saved.':'Settings saved. Enforcement follows the Hub’s observations.';break;
    case 'refused': text=`Settings were refused: ${phase.code}.`;break;
    case 'uncertain': text=refreshText!==''?refreshText:'Settings have no confirmed reply. Refresh before another attempt.';break;
    case 'idle': case 'sending': break;
  }
  const attempt=record?.lastAttempt,operation=operations.find(value=>value.requestId===attempt?.requestId&&value.target===target&&value.family==='power-set'&&value.requestedBy==='bunny/core');
  return <section aria-label="Maximum on time" className={props.concise===true?'wemo-limit':'edit'}>{props.concise!==true&&<><h3>Maximum on time</h3>
    <p className="hint">Independent of weekly schedules. Requires the Hub running and the plug reachable. An enabled limit turns off an on plug when its elapsed time is unknown.</p>
    <p>Limit: {!live?'Stale evidence':record?.status??'Disabled (not configured)'}</p>
    {record?.enabled===true&&<p>Observed run start: {record.startedAtMs===null?'Unknown':new Date(record.startedAtMs).toLocaleString()}</p>}
    {record?.deadlineMs!==undefined&&record.deadlineMs!==null&&<p>Run deadline: {new Date(record.deadlineMs).toLocaleString()}</p>}</>}
    {props.concise===true&&!live&&<p className="warning">Limit evidence is stale.</p>}
    {attempt!==undefined&&attempt!==null&&<p>Shutoff attempt: {!operationsLive?'Operation evidence is stale.':operation===undefined?`${attempt.outcome}${attempt.reason===undefined?'':` (${attempt.reason})`}; no current operation record.`:operationView(operation).text}</p>}
    {(control||props.concise===true)&&<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={!control||!live||reading||lifecycle.blocked}>
      <label className={props.concise===true?'wemo-limit-toggle':undefined}><span>{props.concise===true?'Maximum on time':'Enable maximum on time'}</span><input type="checkbox" aria-label="Enable maximum on time" checked={enabled} onChange={event=>{setDraft({enabled:event.target.checked,minutes});}}/></label>
      <label className={props.concise===true?'wemo-duration':undefined}><span>{props.concise===true?'Duration':'Maximum on time (minutes)'}</span><span><input aria-label="Maximum on time (minutes)" type="number" min="1" max="10080" step="1" required value={minutes} onChange={event=>{setDraft({enabled,minutes:event.target.value});}}/>{props.concise===true&&<span>minutes</span>}</span></label>
      <button type="submit" disabled={!dirty}>{props.concise===true?'Save limit':'Save maximum on time'}</button>
    </fieldset></form>}
    <p role="status">{text}</p>
    {(phase.kind==='uncertain'||superseded)&&<button type="button" disabled={!live||reading} onClick={()=>{void refreshCurrent();}}>Refresh current limit</button>}
  </section>;
}
