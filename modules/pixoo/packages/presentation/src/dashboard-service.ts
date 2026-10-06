import {DashboardPager,type DashboardLayout,type DashboardFilter} from './agent-dashboard.js';
import {DASHBOARD_FRAME_MS,renderDashboard} from './dashboard-pixels.js';
import type {MonitorView} from './monitor-source.js';
/** `frames` play in order at `frameDelayMs`; `rgb` is the first frame, for readers of a single picture. */
export type DashboardRendition={version:1;generation:number;width:64;height:64;format:'rgb888';layout:DashboardLayout;rgb:number[];frames:number[][];frameDelayMs:number};
export type DashboardOptions={clock?:()=>number;cadenceMs?:number;consumerId?:string;render?:(layout:DashboardLayout)=>Uint8Array[]|Promise<Uint8Array[]>};
export class DashboardService {
 private readonly clock:()=>number;
 private readonly cadence:number;
 private readonly render:(layout:DashboardLayout)=>Uint8Array[]|Promise<Uint8Array[]>;
 private readonly pager:DashboardPager;
 private generation=0;
 private signature='';
 private input:{view:MonitorView;filter:DashboardFilter}|null=null;
 private pending:{generation:number;layout:DashboardLayout}|null=null;
 private active=false;
 private closed=false;
 private failed=false;
 private nextStart=0;
 private rendition:DashboardRendition|null=null;
 constructor(options:DashboardOptions={}){
  this.clock=options.clock??(()=>performance.now());this.cadence=options.cadenceMs??3000;
  if(!Number.isInteger(this.cadence)||this.cadence<1||this.cadence>60000)throw new Error('invalid-render-cadence');
  this.render=options.render??renderDashboard;this.pager=new DashboardPager(options.consumerId??'pixoo');
 }
 submit(view:MonitorView,filter:DashboardFilter={}):void {
  if(this.closed)return;
  this.input={view:structuredClone(view),filter:{...filter}};this.tick();
 }
 tick():void {
  if(this.closed||!this.input)return;
  const layout=this.pager.layout(this.input.view,this.clock(),this.input.filter);
  // A source read's asOf changes without new evidence. Do not invalidate an
  // otherwise identical rendition merely because somebody read the source.
  const signature=JSON.stringify({...layout,asOfMs:null});
  if(signature!==this.signature){this.signature=signature;this.generation++;this.pending={generation:this.generation,layout};this.rendition=null;this.failed=false;}
  if(this.active||!this.pending||this.clock()<this.nextStart)return;
  const job=this.pending;this.pending=null;this.active=true;this.nextStart=this.clock()+this.cadence;
  void Promise.resolve().then(()=>this.render(structuredClone(job.layout))).then(frames=>{
   if(this.closed||job.generation!==this.generation)return;
   if(!Array.isArray(frames)||frames.length<1||frames.length>2||frames.some(rgb=>!(rgb instanceof Uint8Array)||rgb.length!==12288))throw new Error('invalid-dashboard-pixels');
   const copies=frames.map(rgb=>Array.from(rgb));
   this.rendition={version:1,generation:job.generation,width:64,height:64,format:'rgb888',layout:job.layout,rgb:copies[0]!,frames:copies,frameDelayMs:DASHBOARD_FRAME_MS};this.failed=false;
  }).catch(()=>{
   if(!this.closed&&job.generation===this.generation){this.failed=true;this.pending=job;}
  }).finally(()=>{this.active=false;});
 }
 status(){
  return {state:this.closed?'closed':this.failed?'error':this.rendition?'current':'pending',active:this.active?1:0,pending:this.pending?1:0,cadenceMs:this.cadence,rendition:structuredClone(this.rendition)};
 }
 close():void{this.closed=true;this.generation++;this.pending=null;this.input=null;this.rendition=null;}
}
