import type {SessionSnapshot} from '@jimmie-potts/agent-state';
import type {MonitorView} from './sources.js';
import {DashboardPager} from './agent-dashboard.js';
import {DASHBOARD_FRAME_MS,renderDashboard} from './dashboard-pixels.js';
import type {DashboardRendition} from './dashboard-service.js';
type Example={provider:'codex'|'claude';label:string;activity:SessionSnapshot['activity'];attention?:'approval'|'input'|'question';notice?:boolean;children?:SessionSnapshot['children']};
// Attention-first order: approval and input, the question, the notice, then the rest by session ID.
const examples:Example[]=[
 {provider:'codex',label:'Build',activity:'active',attention:'approval',children:{active:2,uncertain:0}},
 {provider:'claude',label:'Review',activity:'idle',attention:'question'},
 {provider:'codex',label:'Docs',activity:'interrupted',notice:true},
 {provider:'claude',label:'résumé-long-running-migration-7',activity:'ended'},
 {provider:'codex',label:'Test',activity:'unknown'},
 {provider:'claude',label:'pixoo-layout-98',activity:'active',children:{active:12,uncertain:1}},
 {provider:'codex',label:'Deploy',activity:'idle',attention:'input'},
];
function session({provider,label,activity,attention,notice,children}:Example,index:number):SessionSnapshot {
 return {identity:{provider,client:provider==='claude'?'code':'cli',hostId:'synthetic',sourceId:'example',sessionId:`s${index}`},
  turn:{status:'known',id:'t1'},parent:{status:'top-level'},label,activity,
  attention:attention?[{kind:attention,id:{status:'known',id:'a'},turn:{status:'known',id:'t1'}}]:[],
  notices:notice?[{id:'notice',kind:'turn-ended',turn:{status:'known',id:'t0'},acknowledgedBy:[]}]:[],
  read:'unknown',unavailable:[{kind:'evidence.unavailable',dimension:'ordering',reason:'missing'}],ordering:{status:'unknown'},lastEvidenceAtMs:1000,observedAtMs:1000,observationAgeMs:0,freshness:'current',restartUncertain:false,children:children??{active:0,uncertain:0}};
}
/** Named synthetic views; each is paged from zero to `atMs` so every legend state appears on some page. */
export function syntheticDashboardViews():Array<{name:string;view:MonitorView;atMs:number}>{
 const sessions=examples.map(session);
 const base:MonitorView={apiVersion:'1.0',ownerId:'synthetic',connection:'current',admissionRejected:0,nextRequestId:null,snapshot:{apiVersion:'1.2',revision:1,asOfMs:1000,collector:'running',lossCount:0,sessions}};
 const variant=(change:(view:MonitorView)=>void)=>{const view=structuredClone(base);change(view);return view;};
 // Time-ordered session IDs from the same period share a long prefix; unlabeled sessions show their ends.
 const unlabeled=variant(view=>{view.snapshot!.sessions=['01a0d3e2-7c4b-7f10-9a3e-5b1c2d4e8f01','01a0d3e2-7c4b-7f10-b1c4-02d9e6a7c3b2','01a0d3e2-91f0-7a22-8d05-c7e3f1a09d43','01a0d3e4-0b6a-7c31-a7f2-4e8b9c2d1f54']
  .map((sessionId,i)=>{const unnamed=session({provider:'codex',label:'',activity:i%2?'idle':'active'},i);delete unnamed.label;unnamed.identity={provider:'codex',client:'desktop',hostId:'synthetic',sourceId:'example',sessionId};return unnamed;});});
 const titled=(patch:Partial<SessionSnapshot>)=>variant(view=>{const item=session({provider:'codex',label:'',activity:'active'},0);delete item.label;view.snapshot!.sessions=[{...item,title:{value:'Résumé monitor',source:'provider'},...patch}];});
 const many=variant(view=>{view.snapshot!.sessions=Array.from({length:12},(_,i)=>session({provider:i%2?'claude':'codex',label:`Task ${i+1}`,activity:'active'},i));});
 return [
  {name:'Approval first, pulsing',view:base,atMs:0},
  {name:'Overflow: blocking input after ten seconds',view:base,atMs:10000},
  {name:'Stale source, running collector',view:variant(view=>{view.connection='stale';}),atMs:20000},
  {name:'Empty',view:variant(view=>{view.snapshot!.sessions=[];}),atMs:0},
  {name:'Unlabeled sessions with a shared ID prefix',view:unlabeled,atMs:0},
  {name:'Retained turn-ended notice, stopped session',view:base,atMs:30000},
  {name:'Ended runtime, long label, collector closed',view:variant(view=>{view.snapshot!.collector='closed';}),atMs:40000},
  {name:'Subagents, collector faulted',view:variant(view=>{view.snapshot!.collector='faulted';}),atMs:50000},
  {name:'Unknown activity, collector quiesced',view:variant(view=>{view.snapshot!.collector='quiesced';}),atMs:60000},
  {name:'Source unavailable',view:variant(view=>{view.connection='unavailable';view.snapshot=null;}),atMs:0},
  {name:'More than eight sessions',view:many,atMs:0},
  {name:'Shared title, accents folded; missing ordering without a warning',view:titled({}),atMs:0},
  {name:'Owner label wins; project and missing ordering without a warning',view:titled({label:'Owner choice',labelOrigin:'user',project:'DIVOOM-APP-UPGRADE'}),atMs:0},
  {name:'Ordering conflict without a project',view:titled({unavailable:[{kind:'evidence.unavailable',dimension:'ordering',reason:'ambiguous'}]}),atMs:0},
  {name:'Project with missing ordering and lost read evidence',view:titled({project:'DIVOOM-APP-UPGRADE',unavailable:[{kind:'evidence.unavailable',dimension:'ordering',reason:'missing'},{kind:'evidence.unavailable',dimension:'read',reason:'lost'}]}),atMs:0},
  {name:'Title and project, uncertain subagents and approval',view:titled({project:'DIVOOM-APP-UPGRADE',freshness:'uncertain',children:{active:2,uncertain:1},attention:[{kind:'approval',id:{status:'known',id:'a'},turn:{status:'known',id:'t1'}}]}),atMs:0},
 ];
}
export function syntheticDashboardRenditions():Array<{name:string;rendition:DashboardRendition}>{
 return syntheticDashboardViews().map(({name,view,atMs},index)=>{
  const pager=new DashboardPager();pager.layout(view,0);
  const layout=pager.layout(view,atMs),frames=renderDashboard(layout).map(rgb=>Array.from(rgb));
  return {name,rendition:{version:1,generation:index,width:64,height:64,format:'rgb888',layout,rgb:frames[0]!,frames,frameDelayMs:DASHBOARD_FRAME_MS}};
 });
}
