import React,{useEffect,useRef,useState} from 'react';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {CHIP_TEXT,chipOf,sessionName} from './sessions.ts';
import {createHabitat,type HabitatController} from './habitat/controller.ts';
import {markup} from './habitat/template.js';
import {exportPreferences,importPreferences} from './habitat/preferences.ts';

/** A native dashboard view over the shell's session copy. Preferences never leave this browser. */
export function HabitatPage({records,live}:{records:readonly SessionRecord[];live:boolean}):React.JSX.Element{
 const root=useRef<HTMLDivElement>(null),controller=useRef<HabitatController|null>(null),importGeneration=useRef({generation:0});
 const [epoch,setEpoch]=useState(0),[unavailable,setUnavailable]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  const pending=importGeneration.current;const element=root.current;if(element===null)return;
  setUnavailable(false);const habitat=createHabitat(element,()=>{setUnavailable(true);});controller.current=habitat;
  return ()=>{pending.generation++;habitat.destroy();controller.current=null;};
 },[epoch]);
 useEffect(()=>{controller.current?.update(records,live);},[records,live,epoch]);
 const exportSettings=():void=>{
  try{
   const data=exportPreferences(localStorage),url=URL.createObjectURL(new Blob([data],{type:'application/json'})),anchor=document.createElement('a');
   anchor.href=url;anchor.download='bunny-habitat-settings.json';anchor.click();URL.revokeObjectURL(url);setMessage('Settings exported. Keep this file private.');
  }catch{setMessage('Browser storage is unavailable. Settings could not be exported.');}
 };
 const importSettings=async(file:File):Promise<void>=>{
  const generation=++importGeneration.current.generation;
  if(file.size>65536){setMessage('Choose a Bunny habitat settings file smaller than 64 KiB.');return;}
  try{
   const data=await file.text();if(generation!==importGeneration.current.generation)return;
   if(!importPreferences(data,localStorage)){setMessage('Settings could not be imported. Check the file and browser storage.');return;}
   setMessage('Settings imported. Previous settings are backed up in this browser.');setEpoch(value=>value+1);
  }catch{if(generation===importGeneration.current.generation)setMessage('Settings could not be read. Your current settings are kept.');}
 };
 return <section aria-label="Shared bunny habitat">
  <header className="page"><h1>Habitat</h1><p>Ten bunnies, one shared home. Activity follows the dashboard’s session evidence.</p></header>
  <details className="habitat-settings"><summary>Move your habitat settings</summary><p>Export settings from the preview, then import that file here to keep your positions and apron colors. Files stay on your device.</p>
   <button type="button" onClick={exportSettings}>Export habitat settings</button>{' '}
   <label>Import habitat settings <input type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file!==undefined)void importSettings(file);}}/></label>
  </details>
  <p role="status">{message}</p>
  <div key={epoch} ref={root} className="habitat-root" hidden={unavailable} dangerouslySetInnerHTML={{__html:markup}}/>
  {unavailable&&<section aria-label="Habitat session list"><h2>Session activity</h2><p>The habitat artwork is unavailable. Session evidence remains available below.</p><ul>{records.map(record=><li key={record.id}>{sessionName(record)} · {CHIP_TEXT[chipOf(record)]}{!live||record.freshness!=='current'||record.restartUncertain?' · Evidence uncertain':''}</li>)}</ul>{records.length===0&&<p>No observed sessions.</p>}</section>}
 </section>;
}
