import React,{useEffect,useRef,useState} from 'react';
import type {OperationRecord,PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import {automationRequest} from './automation.tsx';
import {operationView} from './devices.ts';
export type PowerLimitProps={record:PowerLimitRecord|undefined;live:boolean;control:boolean;target:string;operations:readonly OperationRecord[];operationsLive:boolean;refresh:()=>Promise<void>};
/** Settings are explicit mutations; current enforcement follows the core's SDK state copy. */
export function PowerLimitPanel(props:PowerLimitProps&{concise?:boolean}):React.JSX.Element {
  const {record,live,control,target,operations,operationsLive,refresh}=props;
  const [enabled,setEnabled]=useState(record?.enabled??false),[minutes,setMinutes]=useState(String((record?.durationMs??14400000)/60000));
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[text,setText]=useState('');
  const inFlight=useRef(false),mounted=useRef(false),latest=useRef(props);latest.current=props;
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!dirty){setEnabled(record?.enabled??false);setMinutes(String((record?.durationMs??14400000)/60000));}},[record?.settingsRevision,record?.enabled,record?.durationMs,dirty]);
  const save=async():Promise<void>=>{
    const current=latest.current,durationMs=Number(minutes)*60000;
    if(inFlight.current||locked||!current.live||!current.control||!Number.isSafeInteger(durationMs)||durationMs<60000||durationMs>604800000)return;
    inFlight.current=true;setBusy(true);
    try{await automationRequest(`power-limits/${target}`,'PUT',{enabled,durationMs,expectedSettingsRevision:current.record?.settingsRevision??0});if(mounted.current){setDirty(false);setText(current.concise===true?'Saved.':'Settings saved. Enforcement follows the Hub’s observations.');}}
    catch{if(mounted.current){setLocked(true);setText('Settings have no confirmed reply. Refresh before another attempt.');}}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  const attempt=record?.lastAttempt,operation=operations.find(value=>value.requestId===attempt?.requestId&&value.target===target&&value.family==='power-set'&&value.requestedBy==='bunny/core');
  return <section aria-label="Maximum on time" className={props.concise===true?'wemo-limit':'edit'}>{props.concise!==true&&<><h3>Maximum on time</h3>
    <p className="hint">Independent of weekly schedules. Requires the Hub running and the plug reachable. An enabled limit turns off an on plug when its elapsed time is unknown.</p>
    <p>Limit: {!live?'Stale evidence':record?.status??'Disabled (not configured)'}</p>
    {record?.enabled===true&&<p>Observed run start: {record.startedAtMs===null?'Unknown':new Date(record.startedAtMs).toLocaleString()}</p>}
    {record?.deadlineMs!==undefined&&record.deadlineMs!==null&&<p>Run deadline: {new Date(record.deadlineMs).toLocaleString()}</p>}</>}
    {props.concise===true&&!live&&<p className="warning">Limit evidence is stale.</p>}
    {attempt!==undefined&&attempt!==null&&<p>Shutoff attempt: {!operationsLive?'Operation evidence is stale.':operation===undefined?`${attempt.outcome}${attempt.reason===undefined?'':` (${attempt.reason})`}; no current operation record.`:operationView(operation).text}</p>}
    {(control||props.concise===true)&&<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={!control||!live||busy||locked}>
      <label className={props.concise===true?'wemo-limit-toggle':undefined}><span>{props.concise===true?'Maximum on time':'Enable maximum on time'}</span><input type="checkbox" aria-label="Enable maximum on time" checked={enabled} onChange={event=>{setEnabled(event.target.checked);setDirty(true);}}/></label>
      <label className={props.concise===true?'wemo-duration':undefined}><span>{props.concise===true?'Duration':'Maximum on time (minutes)'}</span><span><input aria-label="Maximum on time (minutes)" type="number" min="1" max="10080" step="1" required value={minutes} onChange={event=>{setMinutes(event.target.value);setDirty(true);}}/>{props.concise===true&&<span>minutes</span>}</span></label>
      <button type="submit" disabled={!dirty}>{props.concise===true?'Save limit':'Save maximum on time'}</button>
    </fieldset></form>}
    <p role="status">{text}</p>
    {locked&&<button type="button" disabled={!live||busy} onClick={()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);void refresh().then(()=>{if(mounted.current&&latest.current.live){setLocked(false);setDirty(false);setText('Current settings refreshed. Nothing was sent again.');}}).catch(()=>{if(mounted.current)setText('Current settings could not be synced. Nothing was sent again.');}).finally(()=>{inFlight.current=false;if(mounted.current)setBusy(false);});}}>Refresh current limit</button>}
  </section>;
}
