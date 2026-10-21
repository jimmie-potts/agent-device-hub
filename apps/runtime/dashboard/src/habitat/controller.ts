import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {CHIP_TEXT,clientName,sessionName} from '../sessions.ts';
import {mountHabitat,type HabitatRenderer} from './renderer.js';
import {assignSession,conversationFor,eligibleSessions,presentation,reconcileBindings,settingsFrom,type Binding} from './session.ts';
const KEY='bunny.burrow.live-bindings.v2';
export type HabitatController={update:(records:readonly SessionRecord[],synced:boolean)=>void;destroy:()=>void};
/** Presentation over the shell's copy: no participant, API client, timer or second reducer. */
export function createHabitat(root:HTMLElement,unavailable:()=>void):HabitatController{
 const el=<T extends HTMLElement>(id:string):T=>{const element=root.querySelector<T>(`[id="${id}"]`);if(element===null)throw new Error('habitat-template-unavailable');return element;};
 let storage:Storage|undefined;
 let settings=settingsFrom(null),storageFailed=false;
 try{storage=root.ownerDocument.defaultView?.localStorage;if(storage!==undefined)settings=settingsFrom(storage.getItem(KEY),storage.getItem('bunny.burrow.live-binding.v1'));}catch{storageFailed=true;}
 let records:readonly SessionRecord[]=[],synced=false,mode:'live'|'demo'='live',destroyed=false,ready=false;
 const abort=new AbortController();let renderer:HabitatRenderer|null=null;
 const bindingFor=(id:number):Binding|undefined=>settings.bindings.find(b=>b.bunnyId===id);
 const persist=():void=>{try{if(storage===undefined){storageFailed=true;return;}storage.setItem(KEY,JSON.stringify(settings));storageFailed=false;}catch{storageFailed=true;}};
 const render=():void=>{
  if(!ready||renderer===null||destroyed)return;
  if(mode==='live'&&synced){const next=settings.automatic?reconcileBindings(settings.bindings,records):settings.bindings.filter(b=>eligibleSessions(records).some(r=>r.id===b.sessionId));if(JSON.stringify(next)!==JSON.stringify(settings.bindings)){settings={...settings,bindings:next};persist();}}
  const selected=renderer.snapshot().selected,select=el<HTMLSelectElement>('live-session'),chosen=select.value!==''?select.value:bindingFor(selected)?.sessionId??'';
  const eligible=eligibleSessions(records),options=[new Option('Choose a session',''),...eligible.slice().sort((a,b)=>b.lastEvidenceAtMs!==a.lastEvidenceAtMs?b.lastEvidenceAtMs-a.lastEvidenceAtMs:a.id.localeCompare(b.id)).map(r=>new Option(`${sessionName(r)} · ${clientName(r.identity)}`,r.id))];
  if(chosen!==''&&!eligible.some(r=>r.id===chosen))options.push(new Option('Saved session · unavailable',chosen));
  select.replaceChildren(...options);select.value=chosen;select.disabled=mode!=='live'||!synced;
  el('live-status').textContent=mode==='demo'?'Demo mode':synced?'Live · dashboard session feed':'Session evidence uncertain';
  el<HTMLButtonElement>('live-bind').disabled=mode!=='live'||!synced||!eligible.some(r=>r.id===chosen);
  el<HTMLButtonElement>('live-unbind').disabled=mode!=='live'||bindingFor(Number(el<HTMLSelectElement>('live-bunny').value))===undefined;
  el<HTMLButtonElement>('live-unbind').title='Unbinding pauses automatic filling until you turn it back on.';
  el<HTMLSelectElement>('live-mode').value=mode;el<HTMLInputElement>('live-auto').checked=settings.automatic;el<HTMLInputElement>('live-auto').disabled=mode!=='live';
  const heading=root.querySelector('.sidebar-heading span');if(heading!==null)heading.textContent=mode==='live'?`${settings.bindings.length} assigned · ${10-settings.bindings.length} unassigned`:'10 demo agents';
  for(let id=0;id<10;id++){
   if(mode==='demo'){renderer.unbind(id);continue;}
   const binding=bindingFor(id),record=binding===undefined?undefined:records.find(r=>r.id===binding.sessionId);
   if(record!==undefined)renderer.apply(id,presentation(record,synced));
   else if(binding!==undefined)renderer.apply(id,{state:'unknown',name:'Assigned session',client:'Live session',uncertain:true});
   else renderer.unassigned(id);
  }
  const binding=bindingFor(selected),record=binding===undefined?undefined:records.find(r=>r.id===binding.sessionId);
  el('live-detail').textContent=mode==='demo'?'Simulated residents; live assignments are kept.':record===undefined?`Bunny ${selected+1} · ${binding===undefined?'No session assigned · resting.':'Waiting for current session evidence.'}`:`Bunny ${selected+1} · ${sessionName(record)} · ${presentation(record,synced).uncertain?'Evidence uncertain · last observed: ':''}${CHIP_TEXT[presentation(record,synced).state]}`;
  const waiting=eligible.filter(r=>!settings.bindings.some(b=>b.sessionId===r.id)).length;
  el('live-capacity').textContent=mode==='demo'?'Music remains simulated.':`${settings.bindings.length} assigned · ${10-settings.bindings.length} free spots · ${synced?`${waiting} waiting`:'waiting count unknown'}${settings.automatic?'':' · Automatic filling paused'}${storageFailed?' · Assignments available for this visit; browser storage is unavailable.':''}`;
  renderer.refresh();
  const hint=root.querySelector('.scene-hint');if(hint!==null)hint.textContent='Click once for details and again for a qualified Codex Windows conversation. Room previews move the camera. Music remains simulated.';
 };
 renderer=mountHabitat(root,{unavailable,selected:id=>{el<HTMLSelectElement>('live-bunny').value=String(id);render();},destination:id=>{
  if(mode!=='live')return {reason:'Demo bunny · no conversation linked.'};const binding=bindingFor(id),record=binding===undefined?undefined:records.find(r=>r.id===binding.sessionId);
  return record===undefined?{reason:'No observed session assigned to this bunny.'}:conversationFor(record,navigator.platform);
 }});
 if(renderer!==null){const mounted=renderer;void mounted.ready.then(loaded=>{
  if(!loaded||destroyed)return;ready=true;
  for(const a of mounted.snapshot().agents)el<HTMLSelectElement>('live-bunny').add(new Option(`${a.id+1}. ${a.name}`,String(a.id)));
  const on=(id:string,event:string,action:()=>void):void=>{el(id).addEventListener(event,action,{signal:abort.signal});};
  on('live-mode','change',()=>{mode=el<HTMLSelectElement>('live-mode').value==='demo'?'demo':'live';render();});
  on('live-auto','change',()=>{settings.automatic=el<HTMLInputElement>('live-auto').checked;persist();render();});
  on('live-session','change',render);on('live-bunny','change',()=>{mounted.select(Number(el<HTMLSelectElement>('live-bunny').value));});
  on('live-bind','click',()=>{const id=el<HTMLSelectElement>('live-session').value,bunny=Number(el<HTMLSelectElement>('live-bunny').value);if(!synced||mode!=='live'||!eligibleSessions(records).some(r=>r.id===id))return;settings.bindings=assignSession(settings.bindings,id,bunny);persist();mounted.select(bunny);render();});
  on('live-unbind','click',()=>{const bunny=Number(el<HTMLSelectElement>('live-bunny').value);settings={...settings,automatic:false,bindings:settings.bindings.filter(b=>b.bunnyId!==bunny)};persist();render();});
  el('live-help').textContent='Sessions keep their bunnies; newest arrivals fill free spots and overflow waits.';
  render();
 });}
 return {update(next,live){records=next;synced=live;render();},destroy(){destroyed=true;abort.abort();renderer?.destroy();}};
}
