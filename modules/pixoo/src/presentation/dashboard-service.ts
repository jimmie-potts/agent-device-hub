import {DashboardPager,type DashboardLayout,type DashboardFilter} from './agent-dashboard.js';
import {DASHBOARD_FRAME_MS,renderDashboard} from './dashboard-pixels.js';
import type {MonitorView} from './sources.js';
/** `frames` play in order at `frameDelayMs`; `rgb` is the first frame, for readers of a single picture. */
export type DashboardRendition={version:1;generation:number;width:64;height:64;format:'rgb888';layout:DashboardLayout;rgb:number[];frames:number[][];frameDelayMs:number};
/** `onChange` hears each new rendition, which lands after its render. */
export type DashboardOptions={clock?:()=>number;cadenceMs?:number;consumerId?:string;render?:(layout:DashboardLayout)=>Uint8Array[]|Promise<Uint8Array[]>;onChange?:()=>void};
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
 /** The layout of the latest input, rendered or not. */
 private latest:DashboardLayout|null=null;
 private readonly onChange:()=>void;
 constructor(options:DashboardOptions={}){
  this.clock=options.clock??(()=>performance.now());this.cadence=options.cadenceMs??3000;this.onChange=options.onChange??(()=>{});
  if(!Number.isInteger(this.cadence)||this.cadence<1||this.cadence>60000)throw new Error('invalid-render-cadence');
  this.render=options.render??renderDashboard;this.pager=new DashboardPager(options.consumerId??'pixoo');
 }
 /** Takes a new input; `render` is false while nobody shows the dashboard, so its layout stays current unrendered. */
 submit(view:MonitorView,filter:DashboardFilter={},render=true):boolean {
  if(this.closed)return false;
  this.input={view:structuredClone(view),filter:{...filter}};return this.tick(render);
 }
 /**
  * Lays the input out again, as paging needs, and starts the render of a changed layout when `render` allows and the
  * cadence has passed. Returns whether the layout changed.
  */
 tick(render=true):boolean {
  if(this.closed||!this.input)return false;
  const layout=this.pager.layout(this.input.view,this.clock(),this.input.filter);
  // An identical layout keeps its rendition, so an unchanged picture is never rendered or sent again.
  const signature=JSON.stringify(layout);
  const changed=signature!==this.signature;
  if(changed){this.signature=signature;this.generation++;this.latest=layout;this.pending={generation:this.generation,layout};this.rendition=null;this.failed=false;}
  if(!render||this.active||!this.pending||this.clock()<this.nextStart)return changed;
  const job=this.pending;this.pending=null;this.active=true;this.nextStart=this.clock()+this.cadence;
  void Promise.resolve().then(()=>this.render(structuredClone(job.layout))).then(frames=>{
   if(this.closed||job.generation!==this.generation)return;
   if(!Array.isArray(frames)||frames.length<1||frames.length>2||frames.some(rgb=>!(rgb instanceof Uint8Array)||rgb.length!==12288))throw new Error('invalid-dashboard-pixels');
   const copies=frames.map(rgb=>Array.from(rgb));
   const [first]=copies;if(first===undefined)throw new Error('invalid-dashboard-pixels');
   this.rendition={version:1,generation:job.generation,width:64,height:64,format:'rgb888',layout:job.layout,rgb:first,frames:copies,frameDelayMs:DASHBOARD_FRAME_MS};this.failed=false;
   this.onChange();
  }).catch(()=>{
   if(!this.closed&&job.generation===this.generation){this.failed=true;this.pending=job;}
  }).finally(()=>{this.active=false;});
  return changed;
 }
 /** The current rendition, not copied: for readers in this process that never change it. */
 current():Readonly<DashboardRendition>|null{return this.rendition;}
 /** The latest layout, rendered or not, not copied. */
 layout():Readonly<DashboardLayout>|null{return this.latest;}
 status(){
  return {state:this.closed?'closed':this.failed?'error':this.rendition?'current':'pending',active:this.active?1:0,pending:this.pending?1:0,cadenceMs:this.cadence,rendition:structuredClone(this.rendition)};
 }
 close():void{this.closed=true;this.generation++;this.pending=null;this.input=null;this.rendition=null;this.latest=null;}
}
