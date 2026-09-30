import React, {useEffect,useId,useRef,useState} from 'react';
import type {ReceiptEvidence} from './client';
import {Help,Select,useCommandLifecycle,type Device,type DeviceControls} from './controls';
import {momentWording} from './lifecycle';
import {DEFAULT_MOMENT_MS,declaredMoments,durationPresets,momentLine,momentMessage,momentReceiptMessage,moodChoices,moodLabel} from './moments';

/** Moods of the moments this page sent, by component and moment ID, so the live line can name them. In page memory only. */
const sentMoods=new Map<string,string>();
/** Forgets the sent moods: called with the lifecycle reset when the dashboard unmounts. */
export const resetMoments=()=>sentMoods.clear();
/** While a moment is scheduled or playing the page re-reads the device this often, and keeps doing so this long after it ends. */
const FAST_READ_MS=1000,LINGER_MS=5000;
const modeOf=(device:Device|undefined)=>{const mode=device?.snapshot?.state.desired.mode;return mode?.status==='known'?mode.value:undefined;};

/**
 * The Moments card (Hub #336): play one of the device's declared moods now and watch how it ends. It shows only when the device's 1.1
 * snapshot declares moments supported. Each press reads the device again and sends exactly one moment through the hub's moment route and
 * the shared command lifecycle; an uncertain result locks the card until Reload current values, and nothing is ever resent. The live line
 * is the device's own `state.moment`, never the hub's intent.
 */
export function MomentsCard({d,now,visible}:{d:DeviceControls;now:number;/** The component page is the current page; a hidden card makes no extra reads. */visible:boolean}){
 const {component,device,api,path,refresh,reread,disabled}=d;
 const snapshot=device.momentSnapshot,moments=declaredMoments(snapshot);
 const heading=useId();
 const [duration,setDuration]=useState<number>(DEFAULT_MOMENT_MS),[cover,setCover]=useState(true),[moreMood,setMoreMood]=useState('');
 // The watched ticket belongs to the last press; its later receipt is worded with that press's mood and the device's current mode.
 const pressed=useRef(''),latest=useRef(device);latest.current=device;
 const describe=(receipt:ReceiptEvidence)=>momentReceiptMessage(receipt,{device:component.id,mood:pressed.current,mode:modeOf(latest.current)});
 const command=useCommandLifecycle(snapshot,{describe},component.id+':moments');
 // The faster refresh: every second while a moment is current, then until 5 s after the last read that still showed it.
 const current=!!snapshot&&snapshot.state.moment.current.status!=='none';
 const [lingerUntil,setLingerUntil]=useState(0);
 useEffect(()=>{if(current)setLingerUntil((device.received??Date.now())+LINGER_MS);},[current,device.received]);
 const fast=visible&&!!moments&&(current||now<lingerUntil);
 const state=useRef({refresh,current,lingerUntil});state.current={refresh,current,lingerUntil};
 useEffect(()=>{
  if(!fast)return;
  const timer=setInterval(()=>{const s=state.current;if(s.current||Date.now()<s.lingerUntil)void s.refresh().catch(()=>{});},FAST_READ_MS);
  return ()=>clearInterval(timer);
 },[fast]);
 if(!moments||!snapshot)return null;
 const {core,more}=moodChoices(moments),presets=durationPresets(moments.maxDurationMs);
 const chosen=presets.includes(duration as typeof presets[number])?duration:presets.filter(ms=>ms<=DEFAULT_MOMENT_MS).at(-1)??presets[0];
 const reason=disabled??(chosen===undefined?'this device allows no moment of 5 s or more':undefined);
 const line=momentLine(snapshot,device.received?Math.max(0,now-device.received):0,id=>sentMoods.get(component.id+':'+id));
 const play=(mood:string)=>{
  if(chosen===undefined)return Promise.resolve();
  pressed.current=mood;
  const durationMs=chosen,wanted=cover;
  // The mode from the read taken just before sending words a blocked result.
  let mode:string|undefined;
  return command.run({wording:momentWording(moodLabel(mood)),refresh,
   prepare:()=>reread((fresh,available)=>{
    const declared=declaredMoments(fresh.momentSnapshot);mode=modeOf(fresh);
    return available.disabled??(!declared?'this device no longer declares moments':!declared.moods.includes(mood)?`this device no longer declares ${moodLabel(mood)}`:
     durationMs>declared.maxDurationMs?'this duration is now longer than the device allows':{request:{mood,durationMs,coversStatus:declared.coversStatus&&wanted}});
   }),
   send:request=>api.request<unknown>(path+'/moment',request),
   interpret:answer=>{
    const value=answer as {kind?:unknown;momentId?:unknown}|null;
    if(value&&typeof value.momentId==='string'&&value.kind!=='not-sent')sentMoods.set(component.id+':'+value.momentId,mood);
    return momentMessage(answer,{device:component.id,mood,mode});
   }});
 };
 return <div className="edit" role="group" aria-labelledby={heading}><h3 id={heading}>Moments</h3><p className="hint moment-line">{line}</p>
  <fieldset disabled={!!reason||command.busy||command.locked}>
   <div className="actions">{core.map(mood=><button key={mood} type="button" className="secondary" onClick={()=>void play(mood)}>{moodLabel(mood)}</button>)}</div>
   {more.length>0&&<Select label="More moods" deliberate value={moreMood} onChange={mood=>{setMoreMood(mood);if(mood)void play(mood).finally(()=>setMoreMood(''));}} options={[{value:'',label:'Choose a mood to play'},...more.map(mood=>({value:mood,label:moodLabel(mood)}))]}/>}
   {chosen!==undefined&&<Select label="Duration" value={String(chosen)} onChange={value=>setDuration(Number(value))} options={presets.map(ms=>({value:String(ms),label:`${ms/1000} s`}))}/>}
   {moments.coversStatus&&<label className="check"><input type="checkbox" role="switch" checked={cover} onChange={e=>setCover(e.target.checked)}/>Play over agent status</label>}
  </fieldset>
  {reason&&<p className="hint">Unavailable: {reason}.</p>}
  {command.locked&&<div className="actions"><button type="button" className="secondary" disabled={command.busy} onClick={()=>command.reload(refresh)}>Reload current values</button></div>}
  <p role="status" data-tone={command.tone}>{command.status}</p>
  <Help>Each press plays one moment of that mood on {component.id} now, in the device’s own look for it, and a new press replaces a moment that is still playing. The device decides whether it plays: Quiet blocks it, and {moments.coversStatus?'it plays over agent status only while Play over agent status is on':'this device can’t play over agent status'}. The line under the heading is what the device reports; B.U.N.N.Y. can’t see the device.</Help>
 </div>;
}
